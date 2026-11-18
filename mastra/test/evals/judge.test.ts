/**
 * The approver-explanation judge, on a mock judge model: it only runs on paused
 * requests, it scores 1 only when every rubric criterion is met, and it sees the
 * approval card an owner would see.
 */
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { describe, expect, it } from 'vitest';
import { EVAL_ITEMS } from '../../src/evals/dataset';
import { oracleModel } from '../../src/evals/models';
import { runEvalItem } from '../../src/evals/runner';
import { APPROVAL_CARD_RUBRIC, approvalCard, createApproverExplanationScorer } from '../../src/evals/scorers';

function judge(satisfied: boolean[], prompts: string[] = []) {
  return createMockModel({
    version: 'v2',
    mockText: {
      criteria: APPROVAL_CARD_RUBRIC.map((c, i) => ({ criterion: c.description, satisfied: satisfied[i], required: true, reasoning: satisfied[i] ? 'present' : 'missing' })),
      overallAssessment: 'checked',
    },
    spyGenerate: (p) => prompts.push(JSON.stringify(p)),
    spyStream: (p) => prompts.push(JSON.stringify(p)),
  }) as never;
}

const item = (id: string) => EVAL_ITEMS.find((i) => i.id === id)!;

describe('approver explanation', async () => {
  const paused = await runEvalItem(item('ld-motor-l03').input, oracleModel(EVAL_ITEMS));
  const auto = await runEvalItem(item('ld-heald-l07').input, oracleModel(EVAL_ITEMS));

  it('the card has what an owner needs', () => {
    const card = approvalCard(paused)!;
    expect(card).toContain('1 x Loom main drive motor');
    expect(card).toContain('$890.00');
    expect(card).toContain('maintenance manager approval');
    expect(card).toMatch(/Other quotes: .*reliability 88\.2/);
    expect(approvalCard(auto)).toBeNull();
  });

  it('scores 1 when every criterion is met, and shows the judge the card', async () => {
    const prompts: string[] = [];
    const r = await createApproverExplanationScorer(judge([true, true, true, true, true], prompts)).run({ input: item('ld-motor-l03').input as never, output: paused });
    expect(r.score).toBe(1);
    expect(prompts.join('')).toContain('Loom main drive motor');
  });

  it('scores 0 when any criterion is missed, and says which', async () => {
    const r = await createApproverExplanationScorer(judge([true, true, false, true, true])).run({ input: item('ld-motor-l03').input as never, output: paused });
    expect(r.score).toBe(0);
    expect(String(r.reason)).toContain('reliability');
  });

  it('is not scored when the request did not pause', async () => {
    const r = await createApproverExplanationScorer(judge([true, true, true, true, true])).run({ input: item('ld-heald-l07').input as never, output: auto });
    expect(r.score).toBeUndefined();
    expect(r.notScorable).toBeTruthy();
  });
});
