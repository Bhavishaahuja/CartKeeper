/**
 * Phase 4: one trace per request. Every step, both agent calls, and the pause
 * and resume for approval land in a single trace, including when the resume
 * happens in a different Mastra instance after a restart.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { LibSQLStore } from '@mastra/libsql';
import { TestExporter } from '@mastra/observability';
import { afterAll, describe, expect, it } from 'vitest';
import { StubPayments } from '../../src/core/payments';
import { InMemoryStore } from '../../src/core/store';
import { langfuseFromEnv, makeObservability } from '../../src/mastra/observability';
import { agentModel } from '../../src/purchase/model';
import { harness, MOTOR, pack } from './harness';

interface Span {
  traceId: string;
  metadata?: Record<string, unknown>;
  id: string;
  parentSpanId?: string;
  type: string;
  name: string;
  resumedFromSpanId?: string;
}

/** The real agent path on a mock model, so the trace has agent and model spans. */
function mockAgents() {
  const agent = (id: string, reply: object) =>
    new Agent({ id, name: id, instructions: 'x', model: createMockModel({ version: 'v2', mockText: reply }) as never });
  return agentModel(
    agent('intake-agent', MOTOR),
    agent('propose-agent', { option_id: 'opt-1', qty: 1, rationale: 'Most reliable.' }),
  );
}

async function flush(exporter: TestExporter): Promise<Span[]> {
  await new Promise((r) => setTimeout(r, 200)); // exporters are async
  return exporter.getByEventType('span_ended' as never).map((e) => (e as unknown as { exportedSpan: Span }).exportedSpan);
}

const stepNames = (spans: Span[]) => new Set(spans.filter((s) => s.type === 'workflow_step').map((s) => s.name.replace(/^workflow step: '|'$/g, '')));

describe('one trace per request', () => {
  it('covers every step, both agents, the pause and the resume', async () => {
    const exporter = new TestExporter();
    const h = harness(MOTOR, { model: mockAgents(), observability: makeObservability([exporter], {}) });
    const view = await h.service.start('Replace drive motor on loom L-03');
    await h.service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    const spans = await flush(exporter);

    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    const steps = stepNames(spans);
    for (const step of ['intake', 'resolve-items', 'check-inventory', 'quote-supplier', 'merge-quotes', 'score-quotes',
      'propose', 'policy-check', 'replan', 'route-approver', 'await-approval', 'execute', 'confirm-and-log']) {
      expect(steps, step).toContain(step);
    }
    const agentRuns = spans.filter((s) => s.type === 'agent_run').map((s) => s.name);
    expect(agentRuns.some((n) => n.includes('intake-agent'))).toBe(true);
    expect(agentRuns.some((n) => n.includes('propose-agent'))).toBe(true);
    // The resumed run hangs off the original root rather than starting its own tree.
    const roots = spans.filter((s) => !s.parentSpanId);
    expect(roots).toHaveLength(1);
    const resumed = spans.find((s) => s.name === "workflow run: 'purchase' (resumed)");
    expect(resumed?.resumedFromSpanId).toBe(roots[0].id);
    // Findable by request, requester and approver.
    expect(roots[0].metadata).toMatchObject({ request_id: view.request_id, requester_id: null });
    expect(resumed?.metadata).toMatchObject({ request_id: view.request_id, approval: 'approved', decided_by: 'u-mm-1' });
  });

  it('different requests get different traces', async () => {
    const exporter = new TestExporter();
    const h = harness(MOTOR, { observability: makeObservability([exporter], {}) });
    await h.service.start('motor 1');
    await h.service.start('motor 2');
    const spans = await flush(exporter);
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(2);
  });
});

describe('the trace survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ck-trace-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('resume in a new Mastra instance continues the same trace', async () => {
    const url = `file:${join(dir, 'mastra.db')}`;
    const store = InMemoryStore.fromDemo(pack());
    const payments = new StubPayments();

    const before = new TestExporter();
    const a = harness(MOTOR, { store, payments, storage: new LibSQLStore({ id: 't1', url }), observability: makeObservability([before], {}) });
    const view = await a.service.start('Replace drive motor on loom L-03');
    const first = await flush(before);
    const traceId = first[0].traceId;
    const root = first.find((s) => !s.parentSpanId)!;

    const after = new TestExporter();
    const b = harness(MOTOR, { store, payments, storage: new LibSQLStore({ id: 't2', url }), observability: makeObservability([after], {}) });
    const done = await b.service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    expect(done.status).toBe('executed');
    const second = await flush(after);

    expect(second.length).toBeGreaterThan(0);
    expect(new Set(second.map((s) => s.traceId))).toEqual(new Set([traceId]));
    expect(stepNames(second)).toContain('execute');
    const resumedRoot = second.find((s) => s.name === "workflow run: 'purchase' (resumed)")!;
    expect(resumedRoot.resumedFromSpanId).toBe(root.id);
  });
});

describe('Langfuse', () => {
  it('is only configured when both keys are set', () => {
    expect(langfuseFromEnv({})).toBeUndefined();
    expect(langfuseFromEnv({ LANGFUSE_PUBLIC_KEY: 'pk' })).toBeUndefined();
    expect(langfuseFromEnv({ LANGFUSE_PUBLIC_KEY: 'pk-lf-x', LANGFUSE_SECRET_KEY: 'sk-lf-x' })?.name).toMatch(/langfuse/i);
  });
});
