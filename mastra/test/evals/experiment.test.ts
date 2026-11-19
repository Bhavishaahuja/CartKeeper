/** The experiment pipeline end to end on scripted models and a mock judge, plus the statistics. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { LibSQLStore } from '@mastra/libsql';
import { describe, expect, it } from 'vitest';
import { CALIBRATION_CARDS } from '../../src/evals/calibration';
import { EVAL_ITEMS } from '../../src/evals/dataset';
import { renderMarkdown, resolveTarget, runEvalSuite, writeReport } from '../../src/evals/experiment';
import { APPROVAL_CARD_RUBRIC } from '../../src/evals/scorers';
import { bootstrapMean } from '../../src/evals/stats';

const passEverything = () =>
  createMockModel({
    version: 'v2',
    mockText: {
      criteria: APPROVAL_CARD_RUBRIC.map((c) => ({ criterion: c.description, satisfied: true, required: true, reasoning: 'ok' })), // passes everything
      overallAssessment: 'fine',
    },
  }) as never;

describe('runEvalSuite', () => {
  it('runs every model and run as a Mastra experiment and reports per-scorer intervals', async () => {
    const items = EVAL_ITEMS.filter((i) => ['ld-motor-l03', 'ld-heald-l07', 'reject-motor', 'store-bearings-s04', 'wait-budget-spent', 'ambiguous-belts'].includes(i.id));
    const mastra = new Mastra({ storage: new LibSQLStore({ id: 'exp', url: ':memory:' }), logger: false });
    const report = await runEvalSuite({
      mastra,
      items,
      runs: 2,
      targets: [resolveTarget('oracle', items), resolveTarget('cheapest', items)],
      judgeModel: passEverything(),
    });

    expect(report.models.map((m) => m.label)).toEqual(['oracle', 'cheapest']);
    for (const m of report.models) {
      expect(m.experimentIds).toHaveLength(2);
      expect(m.failedItems).toBe(0);
      expect(m.scorers.map((s) => s.scorer)).toEqual(['intake-accuracy', 'supplier-choice', 'hitl-invariants', 'decision-path', 'approver-explanation']);
    }
    const [oracle, cheapest] = report.models;
    const get = (m: typeof oracle, id: string) => m.scorers.find((s) => s.scorer === id)!;
    expect(get(oracle, 'hitl-invariants')).toMatchObject({ mean: 1, n: 6 });
    expect(get(oracle, 'supplier-choice').mean).toBe(1);
    expect(get(cheapest, 'supplier-choice').mean).toBe(0);
    // The judge only scores requests that paused: the motor items.
    expect(get(oracle, 'approver-explanation').n).toBe(3);
    // Every judged card (3 items x 2 runs) is counted, with the criteria it missed.
    expect(get(oracle, 'approver-explanation')).toMatchObject({ judgedCards: 6, unmetCriteria: {} });
    expect(renderMarkdown(report)).toContain('oracle, approver-explanation: 6 cards judged; unmet criteria: none.');

    // Experiments are stored, so Studio can show and compare them.
    const { datasets } = await mastra.datasets.list();
    const dataset = await mastra.datasets.get({ id: datasets[0].id });
    const { experiments } = await dataset.listExperiments();
    expect(experiments).toHaveLength(4);

    // A judge that passes everything agrees on the five good cards only.
    expect(report.judgeAgreement).toMatchObject({ n: 10, agreement: 0.5 });
    expect(report.judgeAgreement!.disagreements.map((d) => d.id).sort()).toEqual(CALIBRATION_CARDS.filter((c) => c.label === 0).map((c) => c.id).sort());

    const dir = mkdtempSync(join(tmpdir(), 'ck-evals-'));
    try {
      const md = readFileSync(writeReport(report, dir), 'utf8');
      expect(md).toContain('| oracle | 100.0% [100.0%, 100.0%] n=6');
      expect(md).toContain('Judge agreement');
      expect(renderMarkdown(report)).toBe(md);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bootstrapMean', () => {
  it('is exact when every item agrees, and resamples items, not runs', () => {
    expect(bootstrapMean([[1, 1], [1], [1, 1, 1]])).toMatchObject({ mean: 1, low: 1, high: 1, n: 3 });
    const r = bootstrapMean([[1, 0], [1, 1], [0, 0], [1, 1]]); // item means 0.5, 1, 0, 1
    expect(r.mean).toBeCloseTo(0.625);
    expect(r.n).toBe(4);
    expect(r.low).toBeLessThan(r.mean);
    expect(r.high).toBeGreaterThan(r.mean);
  });

  it('is reproducible and narrows with more items', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => [i % 3 === 0 ? 0 : 1]);
    expect(bootstrapMean(items(30))).toEqual(bootstrapMean(items(30)));
    const width = (n: number) => {
      const r = bootstrapMean(items(n));
      return r.high - r.low;
    };
    expect(width(300)).toBeLessThan(width(30));
  });

  it('handles no data', () => {
    expect(bootstrapMean([]).n).toBe(0);
  });
});
