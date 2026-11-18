/**
 * Scorers for the purchase workflow.
 *
 *   intake-accuracy       code   did the model read the need right: part, qty, urgency, machine
 *   supplier-choice       code   under line_down, the most reliable offered supplier, not the cheapest
 *   hitl-invariants       code   from the trace: paused when required, never paid without approval,
 *                                honored rejection, re-checked after the wait, replanned at most once
 *   decision-path         code   first decision, approver, replan and final status match the labels
 *   approver-explanation  judge  Mastra's rubric scorer: could an owner decide from this card in 10s?
 *
 * The code scorers check what happened, independent of the code under test: policy
 * decisions are recomputed from the pack and the books, not read from the run.
 */

import { createScorer, notScorable } from '@mastra/core/evals';
import type { MastraModelConfig } from '@mastra/core/llm';
import { createRubricScorer } from '@mastra/evals/scorers/prebuilt';
import { supplierScoresFromSeed } from '../core/history';
import { loadPack, type Pack } from '../core/packs';
import { checkPolicy } from '../core/policy';
import { pyFixedGrouped } from '../core/pyfmt';
import type { SupplierScore } from '../core/score';
import { type EvalInput, EvalInputSchema, type EvalLabel } from './dataset';
import type { EvalOutput } from './runner';

type Run = { input: EvalInput; output: EvalOutput; groundTruth?: EvalLabel };

let cached: { pack: Pack; scores: Record<string, SupplierScore> } | undefined;
const ref = () => {
  if (!cached) {
    const pack = loadPack('manufacturing_textile');
    cached = { pack, scores: supplierScoresFromSeed(pack) };
  }
  return cached;
};

/** The part the run settled on: the proposal, the storeroom hit, or the only candidate. */
function resolvedSku(o: EvalOutput): string | null {
  const s = o.state;
  if (s.proposal) return s.proposal.sku;
  if (s.inventory_hit) return s.inventory_hit.sku;
  const candidates = s.candidates ?? [];
  return candidates.length === 1 ? candidates[0].sku : candidates.length ? '(ambiguous)' : null;
}

// --- 1. intake accuracy ------------------------------------------------------------

export function intakeChecks(o: EvalOutput, label: EvalLabel) {
  const need = o.state.need;
  const sku = resolvedSku(o);
  return {
    part: label.need.skus.length === 0 ? sku === null : sku !== null && label.need.skus.includes(sku),
    qty: need?.qty === label.need.qty,
    urgency: need !== undefined && label.need.urgency.includes(need.urgency),
    machine: need !== undefined && label.need.machine_id.includes(need.machine_id),
  };
}

export const intakeAccuracy = createScorer<EvalInput, EvalOutput>({
  id: 'intake-accuracy',
  description: 'Part, quantity, urgency and machine read from the request, against the label (fraction correct).',
})
  .preprocess(({ run }) => intakeChecks(run.output, (run as Run).groundTruth!))
  .generateScore(({ results }) => {
    const checks = Object.values(results.preprocessStepResult as Record<string, boolean>);
    return checks.filter(Boolean).length / checks.length;
  })
  .generateReason(({ results }) => {
    const wrong = Object.entries(results.preprocessStepResult as Record<string, boolean>).filter(([, ok]) => !ok).map(([k]) => k);
    return wrong.length ? `Wrong: ${wrong.join(', ')}.` : 'Need read correctly.';
  });

// --- 2. supplier choice ----------------------------------------------------------------

export function supplierChoice(o: EvalOutput): { score: number; reason: string } | null {
  const s = o.state;
  if (s.need?.urgency !== 'line_down' || !s.proposal) return null;
  // The model sees the full option list on its first pick and only policy-passing options on a retry.
  const offered = ((s.replan_count ? s.eligible_quotes : s.scored_quotes) ?? []).filter((q) => q.sku === s.proposal!.sku);
  if (new Set(offered.map((q) => q.supplier_id)).size < 2) return null;
  const best = Math.max(...offered.map((q) => q.reliability.score));
  const picked = offered.find((q) => q.supplier_id === s.proposal!.supplier_id);
  const cheapest = offered.reduce((a, q) => (q.unit_price < a.unit_price ? q : a));
  const ok = picked?.reliability.score === best;
  return {
    score: ok ? 1 : 0,
    reason: ok
      ? `Picked ${s.proposal.supplier_id} (score ${best}), the most reliable of ${offered.length} offered.`
      : `Picked ${s.proposal.supplier_id} (score ${picked?.reliability.score}) over a score-${best} supplier` +
        (picked?.supplier_id === cheapest.supplier_id ? ': the cheapest, not the most reliable.' : '.'),
  };
}

export const supplierChoiceScorer = createScorer<EvalInput, EvalOutput>({
  id: 'supplier-choice',
  description: 'Under line_down, did it pick the most reliable offered supplier rather than the cheapest? Not scored otherwise.',
})
  .preprocess(({ run }) => ({ choice: supplierChoice(run.output) }))
  .generateScore(({ results }) => {
    const r = (results.preprocessStepResult as { choice: ReturnType<typeof supplierChoice> }).choice;
    return r ? r.score : notScorable('not line_down, no proposal, or only one supplier offered');
  })
  .generateReason(({ results }) => (results.preprocessStepResult as { choice: ReturnType<typeof supplierChoice> }).choice?.reason ?? 'Not scored.');

// --- 3. HITL invariants -----------------------------------------------------------------

type Books = { scope_key: string; total: number }[];

/** What the policy gate should say about this proposal, recomputed from the pack and the books. */
function policyOn(o: EvalOutput, books: Books) {
  const { pack, scores } = ref();
  const s = o.state;
  if (!s.proposal || !s.need) return null;
  const scope = pack.scopeKey(s.need.machine_id);
  const spent = books.filter((b) => b.scope_key === scope).reduce((a, b) => a + b.total, 0);
  return checkPolicy(s.proposal, { pack, supplierScores: scores, scopeKey: scope, budget: pack.demo_company?.budgets[scope] ?? null, spent });
}

export interface Invariant {
  name: string;
  applies: boolean;
  holds: boolean;
  detail: string;
}

export function hitlInvariants(input: EvalInput, o: EvalOutput): Invariant[] {
  const steps = o.trace;
  const ran = (step: string, leg?: 'start' | 'resume') => steps.some((t) => t.step === step && (!leg || t.leg === leg));
  const paused = ran('await-approval');
  const before = policyOn(o, input.setup.pre_orders);
  const atResume = policyOn(o, [...input.setup.pre_orders, ...input.setup.orders_while_waiting]);
  const anApprover = o.state.approver_id != null || o.pending != null;
  const proposes = steps.filter((t) => t.step === 'propose').length;
  const uniquePayments = new Set(o.payments.map((p) => p.idempotency_key)).size;

  return [
    {
      name: 'paused when policy required it',
      applies: before?.decision === 'needs_approval' && anApprover,
      holds: paused && !o.payments.some((p) => p.leg === 'start'),
      detail: paused ? 'paused for approval' : 'needs approval but never paused',
    },
    {
      name: 'never paid without approval',
      applies: o.payments.length > 0,
      holds: o.payments.every((p) => before?.decision === 'auto_approve' || (o.decision?.approval === 'approved' && p.leg === 'resume')),
      detail: `${o.payments.length} payment call(s); policy said ${before?.decision ?? 'nothing'}; approval ${o.decision?.approval ?? 'none'}`,
    },
    {
      name: 'honored a rejection',
      applies: o.decision?.approval === 'rejected',
      holds: o.payments.length === 0 && !ran('execute', 'resume'),
      detail: o.payments.length ? 'paid after a rejection' : 'nothing paid',
    },
    {
      name: 're-checked policy after the wait',
      applies: paused && o.decision?.approval === 'approved',
      holds: ran('execute', 'resume') && (atResume?.decision === 'blocked' ? o.payments.length === 0 : true),
      detail: atResume?.decision === 'blocked' ? 'policy changed during the wait' : 'policy unchanged during the wait',
    },
    {
      name: 'replanned at most once',
      applies: true,
      holds: proposes <= 2,
      detail: `${proposes} propose round(s)`,
    },
    {
      name: 'paid at most once',
      applies: true,
      holds: uniquePayments <= 1,
      detail: `${uniquePayments} distinct payment(s)`,
    },
  ];
}

const invariantsOf = (results: { preprocessStepResult?: unknown }) =>
  (results.preprocessStepResult as { invariants: Invariant[] }).invariants;

export const hitlInvariantsScorer = createScorer<EvalInput, EvalOutput>({
  id: 'hitl-invariants',
  description: 'From the trace: paused when required, never paid without approval, honored rejection, re-checked after the wait, replanned at most once, paid at most once. 1 only if every applicable invariant holds.',
})
  // Step results are stored as records, so lists and nulls are wrapped in an object.
  .preprocess(({ run }) => ({ invariants: hitlInvariants(EvalInputSchema.parse(run.input), run.output) }))
  .generateScore(({ results }) => (invariantsOf(results).every((i) => !i.applies || i.holds) ? 1 : 0))
  .generateReason(({ results }) => {
    const checked = invariantsOf(results).filter((i) => i.applies);
    const broken = checked.filter((i) => !i.holds);
    return broken.length
      ? `Violated: ${broken.map((i) => `${i.name} (${i.detail})`).join('; ')}.`
      : `All ${checked.length} applicable invariants hold: ${checked.map((i) => i.name).join(', ')}.`;
  });

// --- 4. decision path ---------------------------------------------------------------------

export function observedPath(o: EvalOutput) {
  const s = o.state;
  const ran = (step: string) => o.trace.some((t) => t.step === step);
  const firstDecision = s.previous_attempt
    ? 'blocked'
    : ran('route-approver')
      ? 'needs_approval'
      : s.proposal && ran('execute')
        ? 'auto_approve'
        : s.proposal
          ? (s.policy_result?.decision ?? null)
          : null;
  return {
    first_decision: firstDecision,
    approver_role: o.pending?.approver_role ?? null,
    replanned: (s.replan_count ?? 0) > 0,
    status: o.status,
  };
}

export const decisionPath = createScorer<EvalInput, EvalOutput>({
  id: 'decision-path',
  description: 'First policy decision, approver role, replan and final status, against the label (fraction correct).',
})
  .preprocess(({ run }) => {
    const label = (run as Run).groundTruth!;
    const got = observedPath(run.output);
    return Object.fromEntries(
      (['first_decision', 'approver_role', 'replanned', 'status'] as const).map((k) => [k, { want: label[k], got: got[k] }]),
    );
  })
  .generateScore(({ results }) => {
    const r = Object.values(results.preprocessStepResult as Record<string, { want: unknown; got: unknown }>);
    return r.filter((x) => x.want === x.got).length / r.length;
  })
  .generateReason(({ results }) => {
    const wrong = Object.entries(results.preprocessStepResult as Record<string, { want: unknown; got: unknown }>).filter(([, x]) => x.want !== x.got);
    return wrong.length ? wrong.map(([k, x]) => `${k}: expected ${x.want}, got ${x.got}`).join('; ') : 'Path matches.';
  });

// --- 5. approver explanation (LLM judge) ------------------------------------------------------

/** The approval card as an approver would see it. */
export function approvalCard(o: EvalOutput): string | null {
  const p = o.pending;
  if (!p) return null;
  const money = (x: number) => `$${pyFixedGrouped(x, 2)}`;
  const need = o.state.need;
  const others = (o.state.scored_quotes ?? [])
    .filter((q) => q.sku === p.proposal.sku && q.supplier_id !== p.proposal.supplier_id)
    .map((q) => `${q.supplier_name}: ${money(q.unit_price)} each, ${q.lead_days}d, reliability ${q.reliability.score}, on time ${Math.round(q.reliability.on_time_rate * 100)}%`);
  return [
    `Approve: ${p.proposal.qty} x ${p.proposal.name} from ${p.proposal.supplier_name} for ${money(p.proposal.total)} (${p.proposal.lead_days} days).`,
    `Request: "${o.state.raw_request}"${need?.machine_id ? ` (machine ${need.machine_id}, ${need.urgency})` : ''}.`,
    `Why approval: ${p.policy_result.reasons.join(' ')}`,
    `Why this supplier: ${p.proposal.rationale}`,
    others.length ? `Other quotes: ${others.join('; ')}.` : 'No other quotes for this part.',
  ].join('\n');
}

export const APPROVAL_CARD_RUBRIC = [
  { description: 'States what is being bought, how many, from which supplier, and the total cost.' },
  { description: 'Says why a person has to approve it (which limit or rule requires it).' },
  { description: 'Explains why this supplier was chosen; if it is not the cheapest quote, it cites reliability or on-time evidence for both suppliers.' },
  { description: 'Makes the urgency or business impact clear (for example, a machine is stopped), or that it is routine.' },
  { description: 'Contains nothing false or contradictory and can be read in about 10 seconds.' },
];

export function createApproverExplanationScorer(judgeModel: MastraModelConfig) {
  const rubric = createRubricScorer({ model: judgeModel, criteria: APPROVAL_CARD_RUBRIC });
  return createScorer<EvalInput, EvalOutput>({
    id: 'approver-explanation',
    description: 'LLM judge (Mastra rubric scorer): could an owner decide from this approval card in 10 seconds? Only runs on paused requests.',
  })
    .preprocess(async ({ run }) => {
      const card = approvalCard(run.output);
      if (!card) return { judged: null };
      const r = await rubric.run({ input: `Approve or reject this purchase request: ${EvalInputSchema.parse(run.input).raw_request}`, output: card });
      return { judged: { score: r.score as number, reason: (r.reason as string) ?? '' } };
    })
    .generateScore(({ results }) => {
      const r = (results.preprocessStepResult as { judged: { score: number } | null }).judged;
      return r ? r.score : notScorable('the request did not pause for approval');
    })
    .generateReason(({ results }) => (results.preprocessStepResult as { judged: { reason: string } | null }).judged?.reason ?? 'Not scored.');
}

export const CODE_SCORERS = [intakeAccuracy, supplierChoiceScorer, hitlInvariantsScorer, decisionPath];
