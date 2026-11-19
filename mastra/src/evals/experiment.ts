/**
 * Phase 5 experiment: the labeled dataset, run through Mastra datasets and
 * experiments, on several models and several runs each, then reported with
 * bootstrap confidence intervals and the judge's agreement with human labels.
 *
 *   npm run evals                                    sonnet and haiku, 3 runs each (needs a key)
 *   npm run evals -- --models opus,sonnet --runs 5
 *   npm run evals -- --models oracle,cheapest,sloppy --no-judge   scripted, no API calls
 *   npm run evals -- --calibrate-only                 judge vs hand labels on 10 cards only
 *
 * Results land in Mastra storage (Studio: Datasets > cartkeeper-purchases > Experiments)
 * and in evals/results/ as JSON and Markdown.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MastraScorer } from '@mastra/core/evals';
import type { MastraModelConfig } from '@mastra/core/llm';
import { Mastra } from '@mastra/core/mastra';
import { anthropicModel, apiKey, createAgents } from '../mastra/agents';
import { makeStorage } from '../mastra/storage';
import { agentModel, type PurchaseModel } from '../purchase/model';
import { CALIBRATION_CARDS } from './calibration';
import { EVAL_ITEMS, type EvalItem } from './dataset';
import { cheapestModel, oracleModel, sloppyModel } from './models';
import { runEvalItem } from './runner';
import { CODE_SCORERS, createApproverExplanationScorer, createCardRubric, judgeCard } from './scorers';
import { bootstrapMean, type Interval } from './stats';

export const DATASET_NAME = 'cartkeeper-purchases';

export const MODELS: Record<string, `${string}/${string}`> = {
  opus: 'anthropic/claude-opus-5-5',
  sonnet: 'anthropic/claude-sonnet-5-5',
  haiku: 'anthropic/claude-haiku-5-5',
};
const SCRIPTED: Record<string, (items: EvalItem[]) => PurchaseModel> = {
  oracle: oracleModel,
  cheapest: cheapestModel,
  sloppy: sloppyModel,
};

export interface Target {
  label: string;
  model: PurchaseModel;
}

export function resolveTarget(label: string, items: EvalItem[] = EVAL_ITEMS): Target {
  if (SCRIPTED[label]) return { label, model: SCRIPTED[label](items) };
  const id = MODELS[label] ?? (label.includes('/') ? (label as `${string}/${string}`) : undefined);
  if (!id) throw new Error(`unknown model '${label}'. Use ${[...Object.keys(MODELS), ...Object.keys(SCRIPTED)].join(', ')} or provider/model.`);
  const { intakeAgent, proposeAgent } = createAgents(id);
  return { label, model: agentModel(intakeAgent, proposeAgent) };
}

async function getOrCreateDataset(mastra: Mastra, items: EvalItem[]) {
  const { datasets } = await mastra.datasets.list();
  const name = `${DATASET_NAME} (${items.length} items)`;
  const existing = datasets.find((d: { name: string }) => d.name === name);
  if (existing) return mastra.datasets.get({ id: existing.id });
  const dataset = await mastra.datasets.create({
    name,
    description: 'Labeled purchase requests for the textile pack: line-down, storeroom, approval tiers, rejection, budget blocks, unapproved suppliers, missing approvers, stale approvals, ambiguous requests.',
  });
  await dataset.addItems({
    items: items.map((i) => ({ input: i.input, groundTruth: i.label, metadata: { id: i.id, category: i.category } })),
  });
  return dataset;
}

export interface ScorerSummary extends Interval {
  scorer: string;
  /** Items that scored below 1 in any run, with the reason. */
  misses: { item: string; run: number; score: number; reason: string | null }[];
  errors: number;
  /** Judge scorers only: how many judged cards missed each rubric criterion (across all runs). */
  unmetCriteria?: Record<string, number>;
  judgedCards?: number;
}

export interface ModelReport {
  label: string;
  runs: number;
  experimentIds: string[];
  failedItems: number;
  scorers: ScorerSummary[];
}

export interface JudgeAgreement {
  agreement: number;
  n: number;
  disagreements: { id: string; label: number; judge: number | null; why: string; unmet: string[]; notes: { id: string; reasoning: string }[] }[];
}

export interface EvalReport {
  createdAt: string;
  datasetItems: number;
  judgeModel: string | null;
  models: ModelReport[];
  judgeAgreement: JudgeAgreement | null;
}

export async function runEvalSuite(opts: {
  mastra: Mastra;
  targets: Target[];
  runs: number;
  judgeModel?: MastraModelConfig & { id?: string };
  items?: EvalItem[];
  concurrency?: number;
  log?: (line: string) => void;
}): Promise<EvalReport> {
  const items = opts.items ?? EVAL_ITEMS;
  const log = opts.log ?? (() => {});
  const dataset = await getOrCreateDataset(opts.mastra, items);
  const scorers: MastraScorer<any, any, any, any>[] = [...CODE_SCORERS];
  if (opts.judgeModel) scorers.push(createApproverExplanationScorer(opts.judgeModel));
  const idOf = new Map<string, string>(); // dataset item id -> eval item id

  const models: ModelReport[] = [];
  for (const target of opts.targets) {
    // scorer -> eval item id -> score per run
    const perScorer = new Map<string, Map<string, number[]>>();
    const misses = new Map<string, ScorerSummary['misses']>();
    const errors = new Map<string, number>();
    const unmet = new Map<string, Record<string, number>>();
    const judged = new Map<string, number>();
    const experimentIds: string[] = [];
    let failedItems = 0;

    for (let run = 1; run <= opts.runs; run++) {
      log(`${target.label}: run ${run}/${opts.runs}`);
      const summary = await dataset.startExperiment({
        name: `${target.label} run ${run}`,
        metadata: { model: target.label, run },
        maxConcurrency: opts.concurrency ?? 4,
        task: async ({ input }) => runEvalItem(input, target.model),
        scorers,
      });
      experimentIds.push(summary.experimentId);
      failedItems += summary.failedCount;
      for (const result of summary.results) {
        const evalId = idOf.get(result.itemId) ?? ((await dataset.getItem({ itemId: result.itemId }))?.metadata?.id as string);
        idOf.set(result.itemId, evalId);
        if (result.error) log(`  ${evalId}: failed: ${result.error.message}`);
        for (const s of result.scores) {
          if (s.error) errors.set(s.scorerId, (errors.get(s.scorerId) ?? 0) + 1);
          if (s.score === null) continue;
          const head = /^(?:Unmet: (.*)\.|All criteria met\.)/.exec(s.reason ?? '');
          if (head) {
            judged.set(s.scorerId, (judged.get(s.scorerId) ?? 0) + 1);
            const counts = unmet.get(s.scorerId) ?? {};
            for (const c of head[1]?.split(', ') ?? []) counts[c] = (counts[c] ?? 0) + 1;
            unmet.set(s.scorerId, counts);
          }
          const byItem = perScorer.get(s.scorerId) ?? new Map<string, number[]>();
          perScorer.set(s.scorerId, byItem);
          byItem.set(evalId, [...(byItem.get(evalId) ?? []), s.score]);
          if (s.score < 1) misses.set(s.scorerId, [...(misses.get(s.scorerId) ?? []), { item: evalId, run, score: s.score, reason: s.reason }]);
        }
      }
    }

    models.push({
      label: target.label,
      runs: opts.runs,
      experimentIds,
      failedItems,
      scorers: scorers.map((s) => ({
        scorer: s.id,
        ...bootstrapMean([...(perScorer.get(s.id)?.values() ?? [])]),
        misses: misses.get(s.id) ?? [],
        errors: errors.get(s.id) ?? 0,
        ...(judged.has(s.id) ? { unmetCriteria: unmet.get(s.id) ?? {}, judgedCards: judged.get(s.id) } : {}),
      })),
    });
  }

  return {
    createdAt: new Date().toISOString(),
    datasetItems: items.length,
    judgeModel: opts.judgeModel ? String(opts.judgeModel.id ?? 'custom') : null,
    models,
    judgeAgreement: opts.judgeModel ? await judgeAgreement(opts.judgeModel) : null,
  };
}

/** How often the rubric judge agrees with the hand labels on the calibration cards. */
export async function judgeAgreement(judgeModel: MastraModelConfig): Promise<JudgeAgreement> {
  const rubric = createCardRubric(judgeModel);
  const verdicts = await Promise.all(CALIBRATION_CARDS.map(async (c) => ({ c, v: await judgeCard(rubric, c.request, c.card) })));
  const disagreements = verdicts
    .filter(({ c, v }) => v.score !== c.label)
    .map(({ c, v }) => ({ id: c.id, label: c.label, judge: v.score, why: c.why, unmet: v.unmet, notes: v.notes }));
  return { agreement: (verdicts.length - disagreements.length) / verdicts.length, n: verdicts.length, disagreements };
}

const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function renderMarkdown(r: EvalReport): string {
  const scorerIds = [...new Set(r.models.flatMap((m) => m.scorers.map((s) => s.scorer)))];
  const lines = [
    '# CartKeeper eval results',
    '',
    `${r.createdAt} · ${r.datasetItems} labeled requests · ${r.models[0]?.runs ?? 0} runs per model · judge: ${r.judgeModel ?? 'not run'}`,
    '',
    'Mean score per scorer with a 95% bootstrap interval (items resampled; each item averaged over runs first). n = items scored.',
    '',
    `| Model | ${scorerIds.join(' | ')} |`,
    `| --- | ${scorerIds.map(() => '---').join(' | ')} |`,
    ...r.models.map((m) => {
      const cells = scorerIds.map((id) => {
        const s = m.scorers.find((x) => x.scorer === id);
        return s && s.n ? `${pct(s.mean)} [${pct(s.low)}, ${pct(s.high)}] n=${s.n}` : 'n/a';
      });
      return `| ${m.label} | ${cells.join(' | ')} |`;
    }),
    '',
  ];
  for (const m of r.models) {
    for (const s of m.scorers.filter((x) => x.judgedCards)) {
      const counts = Object.entries(s.unmetCriteria ?? {}).sort((a, b) => b[1] - a[1]);
      lines.push(
        `${m.label}, ${s.scorer}: ${s.judgedCards} cards judged; unmet criteria: ${counts.length ? counts.map(([c, n]) => `${c} ${n}`).join(', ') : 'none'}.`,
        '',
      );
    }
  }
  for (const m of r.models) {
    const misses = m.scorers.flatMap((s) => s.misses.map((x) => ({ ...x, scorer: s.scorer })));
    lines.push(`## ${m.label}`, '', `${m.failedItems} item run(s) failed. Experiments: ${m.experimentIds.join(', ')}.`, '');
    if (!misses.length) lines.push('No misses.', '');
    else {
      lines.push('| Scorer | Item | Run | Score | Reason |', '| --- | --- | --- | --- | --- |');
      for (const x of misses) lines.push(`| ${x.scorer} | ${x.item} | ${x.run} | ${x.score.toFixed(2)} | ${(x.reason ?? '').replaceAll('|', '/').replaceAll('\n', ' ').slice(0, 200)} |`);
      lines.push('');
    }
  }
  if (r.judgeAgreement) {
    const j = r.judgeAgreement;
    lines.push('## Judge agreement', '', `The rubric judge agreed with the hand labels on ${Math.round(j.agreement * j.n)} of ${j.n} calibration cards (${pct(j.agreement)}).`, '');
    for (const d of j.disagreements) {
      lines.push(`- ${d.id}: label ${d.label}, judge ${d.judge ?? 'error'}${d.unmet.length ? `, unmet: ${d.unmet.join(', ')}` : ''} (${d.why})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function writeReport(r: EvalReport, dir: string) {
  mkdirSync(dir, { recursive: true });
  const stamp = r.createdAt.replaceAll(':', '-').slice(0, 19);
  writeFileSync(join(dir, `${stamp}.json`), `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(join(dir, 'latest.md'), renderMarkdown(r));
  return join(dir, 'latest.md');
}

// --- CLI ---------------------------------------------------------------------------------

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const labels = arg('models', 'sonnet,haiku').split(',').map((s) => s.trim()).filter(Boolean);
  const runs = Number(arg('runs', '3'));
  const noJudge = process.argv.includes('--no-judge');
  const needsKey = labels.some((l) => !SCRIPTED[l]) || !noJudge;
  if (needsKey && !apiKey()) {
    console.error('No Anthropic API key. Set CARTKEEPER_ANTHROPIC_API_KEY, or run scripted models with --models oracle,cheapest,sloppy --no-judge.');
    process.exit(2);
  }
  const judgeLabel = arg('judge', 'opus');
  const judgeModel = noJudge ? undefined : { ...anthropicModel(MODELS[judgeLabel] ?? (judgeLabel as `${string}/${string}`)) };
  if (process.argv.includes('--calibrate-only')) {
    if (!judgeModel) throw new Error('--calibrate-only needs the judge; drop --no-judge');
    const j = await judgeAgreement(judgeModel);
    console.log(`Judge ${judgeModel.id} agreed with the hand labels on ${Math.round(j.agreement * j.n)} of ${j.n} cards.`);
    for (const d of j.disagreements) {
      console.log(`- ${d.id}: label ${d.label}, judge ${d.judge}, unmet: ${d.unmet.join(', ') || '-'} (${d.why})`);
      for (const n of d.notes) console.log(`    ${n.id}: ${n.reasoning}`);
    }
    return;
  }
  const mastra = new Mastra({ storage: makeStorage(), logger: false });
  const report = await runEvalSuite({
    mastra,
    targets: labels.map((l) => resolveTarget(l)),
    runs,
    judgeModel,
    log: (l) => console.log(l),
  });
  const path = writeReport(report, arg('out', 'evals/results'));
  console.log(`\n${renderMarkdown(report)}\nWritten to ${path}`);
}

if (process.argv[1] && /experiment\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
