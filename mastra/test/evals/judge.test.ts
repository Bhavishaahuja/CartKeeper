/**
 * The approver-explanation judge, on a mock judge model: it only runs on paused
 * requests, it scores 1 only when every rubric criterion is met, it names the
 * criteria that failed, and it sees the approval card an owner would see.
 */
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { describe, expect, it } from 'vitest';
import { CALIBRATION_CARDS } from '../../src/evals/calibration';
import { EVAL_ITEMS } from '../../src/evals/dataset';
import { oracleModel } from '../../src/evals/models';
import { runEvalItem } from '../../src/evals/runner';
import { APPROVAL_CARD_RUBRIC, approvalCard, createApproverExplanationScorer } from '../../src/evals/scorers';

function judge(unmetIds: string[] = [], prompts: string[] = []) {
  return createMockModel({
    version: 'v2',
    mockText: {
      criteria: APPROVAL_CARD_RUBRIC.map((c) => ({
        criterion: c.description,
        satisfied: !unmetIds.includes(c.id),
        required: true,
        reasoning: unmetIds.includes(c.id) ? 'missing' : 'present',
      })),
      overallAssessment: 'checked',
    },
    spyGenerate: (p) => prompts.push(JSON.stringify(p)),
    spyStream: (p) => prompts.push(JSON.stringify(p)),
  }) as never;
}

const item = (id: string) => EVAL_ITEMS.find((i) => i.id === id)!;

describe('the approval card', async () => {
  const paused = await runEvalItem(item('ld-motor-l03').input, oracleModel(EVAL_ITEMS));
  const auto = await runEvalItem(item('ld-heald-l07').input, oracleModel(EVAL_ITEMS));
  const card = approvalCard(paused)!;
  const lines = card.split('\n');

  it('leads with the decision: what, how many, supplier, total, arrival', () => {
    expect(lines[0]).toBe('Approve 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00, arriving in 3 days.');
  });

  it('says why approval is needed and how urgent it is, in plain words', () => {
    expect(card).toContain('Why you: $890.00 needs maintenance manager approval (up to $1,500.00).');
    expect(card).toContain('Context: L-03 (Picanol OMNIplus-i, line 2): Machine stopped.');
  });

  it('lists every quote once, chosen first, with the figures a rationale may cite', () => {
    const quotes = lines.slice(lines.indexOf('Quotes:') + 1);
    expect(quotes).toEqual([
      '- Precision Loom Parts Co (chosen): $890.00 each, 3 days, score 93.6, 93.6% on time, 2.3% defects',
      '- National Bearings & Belts: $860.00 each, 6 days, score 88.2, 89.1% on time, 4.6% defects',
    ]);
  });

  it('does not restate the raw request', () => {
    expect(card).not.toContain(paused.state.raw_request);
  });

  it('only exists when the request paused', () => {
    expect(approvalCard(auto)).toBeNull();
  });

  it('the good calibration cards use the same layout as real cards', () => {
    for (const c of CALIBRATION_CARDS.filter((x) => x.label === 1)) {
      const l = c.card.split('\n');
      expect(l[0], c.id).toMatch(/^Approve \d+ x .+ from .+ for \$[\d,]+\.\d\d, arriving in \d+ days?\.$/);
      expect(l.slice(1, 4).map((x) => x.split(':')[0]), c.id).toEqual(['Why you', 'Context', 'Why this supplier']);
      expect(l, c.id).toContain('Quotes:');
    }
  });
});

describe('approver explanation', async () => {
  const paused = await runEvalItem(item('ld-motor-l03').input, oracleModel(EVAL_ITEMS));
  const auto = await runEvalItem(item('ld-heald-l07').input, oracleModel(EVAL_ITEMS));

  it('scores 1 when every criterion is met, and shows the judge the card', async () => {
    const prompts: string[] = [];
    const r = await createApproverExplanationScorer(judge([], prompts)).run({ input: item('ld-motor-l03').input as never, output: paused });
    expect(r.score).toBe(1);
    expect(String(r.reason)).toMatch(/^All criteria met\./);
    expect(prompts.join('')).toContain('Loom main drive motor');
  });

  it('scores 0 when any criterion is missed, and names the criteria that failed', async () => {
    const r = await createApproverExplanationScorer(judge(['why-supplier', 'concise'])).run({ input: item('ld-motor-l03').input as never, output: paused });
    expect(r.score).toBe(0);
    expect(String(r.reason)).toMatch(/^Unmet: why-supplier, concise\./);
  });

  it('is not scored when the request did not pause', async () => {
    const r = await createApproverExplanationScorer(judge()).run({ input: item('ld-heald-l07').input as never, output: auto });
    expect(r.score).toBeUndefined();
    expect(r.notScorable).toBeTruthy();
  });
});
