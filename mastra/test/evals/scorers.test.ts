/**
 * The eval layer is only worth reporting if it can tell good from bad. These
 * tests run the full dataset through scripted models and check that each scorer
 * moves the way it should, and that the HITL scorer catches broken runs.
 */
import { describe, expect, it } from 'vitest';
import { EVAL_ITEMS, EvalInputSchema, type EvalItem } from '../../src/evals/dataset';
import { cheapestModel, oracleModel, sloppyModel } from '../../src/evals/models';
import { type EvalOutput, runEvalItem } from '../../src/evals/runner';
import { CODE_SCORERS, hitlInvariants } from '../../src/evals/scorers';
import type { PurchaseModel } from '../../src/purchase/model';

async function scoreAll(model: PurchaseModel, items: EvalItem[] = EVAL_ITEMS) {
  const rows = await Promise.all(
    items.map(async (item) => {
      const output = await runEvalItem(item.input, model);
      const scores: Record<string, { score?: number; reason?: string }> = {};
      for (const scorer of CODE_SCORERS) {
        const r = await scorer.run({ input: item.input as never, output, groundTruth: item.label });
        scores[scorer.id] = { score: r.score as number | undefined, reason: r.reason as string | undefined };
      }
      return { item, output, scores };
    }),
  );
  return rows;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const scoresOf = (rows: Awaited<ReturnType<typeof scoreAll>>, id: string) =>
  rows.map((r) => r.scores[id].score).filter((s): s is number => typeof s === 'number');

describe('the dataset', () => {
  it('has 30 items covering every category in the plan', () => {
    expect(EVAL_ITEMS).toHaveLength(30);
    expect(new Set(EVAL_ITEMS.map((i) => i.id)).size).toBe(30);
    expect(new Set(EVAL_ITEMS.map((i) => i.category))).toEqual(
      new Set(['line_down', 'storeroom', 'approval_tier', 'rejection', 'budget_block', 'unapproved_supplier', 'missing_approver', 'stale_approval', 'ambiguous']),
    );
    for (const i of EVAL_ITEMS) EvalInputSchema.parse(i.input);
  });
});

describe('the oracle scores 1.0 on every code scorer (this validates the labels)', async () => {
  const rows = await scoreAll(oracleModel(EVAL_ITEMS));
  for (const scorer of CODE_SCORERS) {
    it(scorer.id, () => {
      const misses = rows
        .filter((r) => r.scores[scorer.id].score !== undefined && r.scores[scorer.id].score !== 1)
        .map((r) => `${r.item.id}: ${r.scores[scorer.id].reason}`);
      expect(misses).toEqual([]);
    });
  }
  it('supplier choice is scored on the line-down items with a real choice', () => {
    expect(scoresOf(rows, 'supplier-choice').length).toBeGreaterThanOrEqual(5);
  });
  it('every run is a single trace', () => {
    for (const r of rows) expect(r.output.traceIds, r.item.id).toHaveLength(1);
  });
});

describe('scorers tell a worse model apart', () => {
  it('a cheapest-first buyer loses on supplier choice, but the system still keeps it safe', async () => {
    const rows = await scoreAll(cheapestModel(EVAL_ITEMS));
    expect(mean(scoresOf(rows, 'supplier-choice'))).toBeLessThan(0.5);
    expect(mean(scoresOf(rows, 'hitl-invariants'))).toBe(1);
    expect(mean(scoresOf(rows, 'intake-accuracy'))).toBe(1);
  });

  it('a sloppy reader loses on intake accuracy and on the decision path', async () => {
    const rows = await scoreAll(sloppyModel(EVAL_ITEMS));
    expect(mean(scoresOf(rows, 'intake-accuracy'))).toBeLessThan(0.75);
    expect(mean(scoresOf(rows, 'decision-path'))).toBeLessThan(1);
    expect(mean(scoresOf(rows, 'hitl-invariants'))).toBe(1);
  });
});

describe('the HITL scorer catches broken runs', async () => {
  const item = EVAL_ITEMS.find((i) => i.id === 'ld-motor-l03')!;
  const good = await runEvalItem(item.input, oracleModel(EVAL_ITEMS));
  const input = EvalInputSchema.parse(item.input);
  const broken = (fn: (o: EvalOutput) => EvalOutput) => hitlInvariants(input, fn(structuredClone(good))).filter((i) => i.applies && !i.holds).map((i) => i.name);

  it('the real run holds every invariant', () => {
    expect(broken((o) => o)).toEqual([]);
  });

  it('paying before the pause', () => {
    expect(broken((o) => ({ ...o, payments: o.payments.map((p) => ({ ...p, leg: 'start' as const })) }))).toEqual(
      expect.arrayContaining(['paused when policy required it', 'never paid without approval']),
    );
  });

  it('never pausing', () => {
    expect(broken((o) => ({ ...o, trace: o.trace.filter((t) => t.step !== 'await-approval') }))).toContain('paused when policy required it');
  });

  it('paying after a rejection', () => {
    expect(broken((o) => ({ ...o, decision: { approval: 'rejected', decided_by: 'u-mm-1' } }))).toEqual(
      expect.arrayContaining(['honored a rejection', 'never paid without approval']),
    );
  });

  it('paying although the budget went during the wait', () => {
    const waited = EvalInputSchema.parse({ ...item.input, setup: { orders_while_waiting: [{ scope_key: 'line_2', total: 2500 }] } });
    expect(hitlInvariants(waited, good).filter((i) => i.applies && !i.holds).map((i) => i.name)).toContain('re-checked policy after the wait');
  });

  it('a third propose round', () => {
    expect(broken((o) => ({ ...o, trace: [...o.trace, ...o.trace.filter((t) => t.step === 'propose'), ...o.trace.filter((t) => t.step === 'propose')] }))).toContain('replanned at most once');
  });

  it('paying twice', () => {
    expect(broken((o) => ({ ...o, payments: [...o.payments, { ...o.payments[0], idempotency_key: 'other' }] }))).toContain('paid at most once');
  });
});
