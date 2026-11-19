/**
 * Repro: an agent that is NOT registered with Mastra, called inside a workflow step.
 * Its spans are silently dropped unless the step passes tracingContext. A registered agent
 * (mastra.getAgent) is traced either way. Run: npx tsx issues/repros/unregistered-agent-tracing.mts
 */
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, TestExporter } from '@mastra/observability';
import { z } from 'zod';

const agent = new Agent({ id: 'helper', name: 'helper', instructions: 'Say hi.', model: createMockModel({ version: 'v2', mockText: 'hi' }) as never });

async function run(passTracingContext: boolean) {
  const step = createStep({
    id: 'ask',
    inputSchema: z.object({}),
    outputSchema: z.object({ text: z.string() }),
    execute: async ({ mastra, tracingContext }) => {
      const a = agent; // imported directly, never registered
      const r = await a.generate('hello', passTracingContext ? { tracingContext } : {});
      return { text: r.text };
    },
  });
  const wf = createWorkflow({ id: 'wf', inputSchema: z.object({}), outputSchema: z.object({ text: z.string() }) }).then(step).commit();
  const exporter = new TestExporter();
  const mastra = new Mastra({
    // helper is deliberately not registered
    workflows: { wf },
    storage: new LibSQLStore({ id: `s${passTracingContext}`, url: ':memory:' }),
    observability: new Observability({ configs: { default: { serviceName: 'repro', exporters: [exporter] } } }),
    logger: false,
  });
  const r = await (await mastra.getWorkflow('wf').createRun()).start({ inputData: {} });
  await new Promise((res) => setTimeout(res, 200));
  const spans = exporter.getByEventType('span_ended' as never).map((e: any) => e.exportedSpan);
  const wfTrace = spans.find((s: any) => s.type === 'workflow_run')?.traceId;
  const agentSpans = spans.filter((s: any) => s.type === 'agent_run');
  console.log(
    `tracingContext ${passTracingContext ? 'passed' : 'not passed'}: status=${r.status}, agent_run spans=${agentSpans.length}, ` +
      `in workflow trace=${agentSpans.filter((s: any) => s.traceId === wfTrace).length}, traces=${new Set(spans.map((s: any) => s.traceId)).size}`,
  );
}

await run(false);
await run(true);
