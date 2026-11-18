/**
 * The real agent path (agent.generate with structured output and per-call
 * instructions) against a mock language model, so it runs without an API key.
 */
import { Agent } from '@mastra/core/agent';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { describe, expect, it } from 'vitest';
import { apiKey } from '../../src/mastra/agents';
import { agentModel, choiceSchema, needSchema } from '../../src/purchase/model';
import { harness, HEALD, MOTOR, pack } from './harness';

function mockAgent(id: string, reply: Record<string, unknown>, prompts: unknown[]) {
  return new Agent({
    id,
    name: id,
    instructions: 'default instructions that every call overrides',
    model: createMockModel({ version: 'v2', mockText: reply, spyStream: (p) => prompts.push(p), spyGenerate: (p) => prompts.push(p) }) as never,
  });
}

describe('agentModel', () => {
  it('returns structured output and sends the per-call instructions', async () => {
    const prompts: unknown[] = [];
    const model = agentModel(mockAgent('intake', HEALD, prompts), mockAgent('propose', {}, prompts));
    const need = await model.extractNeed({ system: 'SYSTEM-FROM-PACK', user: 'heald wires for L-07' }, needSchema(pack()));
    expect(needSchema(pack()).parse(need)).toEqual(HEALD);
    const sent = JSON.stringify(prompts);
    expect(sent).toContain('SYSTEM-FROM-PACK');
    expect(sent).toContain('heald wires for L-07');
    expect(sent).not.toContain('default instructions that every call overrides');
  });

  it('drives the whole workflow through agents', async () => {
    const prompts: unknown[] = [];
    // The mock answers every Choice call the same way; opt-1 exists for the motor (two quotes).
    const model = agentModel(
      mockAgent('intake', MOTOR, prompts),
      mockAgent('propose', { option_id: 'opt-1', qty: 1, rationale: 'Most reliable.' }, prompts),
    );
    const h = harness(MOTOR, { model: model as never });
    const view = await h.service.start('Replace drive motor on loom L-03');
    expect(view.status).toBe('awaiting_approval');
    expect(view.state.proposal!.rationale).toBe('Most reliable.');
    expect(choiceSchema(['opt-1']).shape.option_id.options).toEqual(['opt-1']);
  });
});

describe('API key', () => {
  it('prefers CARTKEEPER_ANTHROPIC_API_KEY over ANTHROPIC_API_KEY', () => {
    const saved = { ...process.env };
    try {
      process.env.ANTHROPIC_API_KEY = 'host-key';
      process.env.CARTKEEPER_ANTHROPIC_API_KEY = 'app-key';
      expect(apiKey()).toBe('app-key');
      delete process.env.CARTKEEPER_ANTHROPIC_API_KEY;
      expect(apiKey()).toBe('host-key');
      delete process.env.ANTHROPIC_API_KEY;
      expect(apiKey()).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});
