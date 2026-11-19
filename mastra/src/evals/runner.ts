/**
 * Runs one eval item end to end, in isolation.
 *
 * Every item gets its own Mastra instance (in-memory storage), ledger, payments
 * and trace exporter, so items can run concurrently without sharing budgets.
 * The runner plays the approver: if the run pauses, it applies any spend that
 * lands during the wait, then answers as the routed approver.
 *
 * The output carries the request's final state plus the trace of steps that
 * actually ran, which the HITL invariant scorer reads.
 */

import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { TestExporter } from '@mastra/observability';
import { supplierScoresFromSeed } from '../core/history';
import { loadPack, type Pack } from '../core/packs';
import { type Payment, StubPayments } from '../core/payments';
import type { SupplierScore } from '../core/score';
import { InMemoryStore } from '../core/store';
import { makeObservability } from '../mastra/observability';
import type { PurchaseModel } from '../purchase/model';
import type { Purchase } from '../purchase/schema';
import { PurchaseService, type RequestView } from '../purchase/service';
import { createPurchaseWorkflow } from '../purchase/workflow';
import { type EvalInput, EvalInputSchema } from './dataset';

export interface TraceStep {
  step: string;
  /** Milliseconds since the run started; orders steps across the pause. */
  at: number;
  /** Which leg of the run: before the pause or after the resume. */
  leg: 'start' | 'resume';
}

export interface EvalOutput {
  status: string;
  state: Purchase;
  /** What the approver was shown, if the run paused. */
  pending: RequestView['pending_approval'];
  /** Who answered and how, if the run paused. */
  decision: { approval: 'approved' | 'rejected'; decided_by: string } | null;
  /** Every payment create() call, in order, with when it happened. */
  payments: (Payment & { at: number; leg: 'start' | 'resume' })[];
  /** Workflow steps that ran, in order. Read from the request's trace. */
  trace: TraceStep[];
  traceIds: string[];
  error?: string;
}

let pack: Pack | undefined;
let scores: Record<string, SupplierScore> | undefined;
let counter = 0;

class RecordingPayments extends StubPayments {
  log: EvalOutput['payments'] = [];
  constructor(private readonly clock: () => { at: number; leg: 'start' | 'resume' }) {
    super();
  }
  override async create(proposal: Record<string, unknown>, opts: { amount: number; idempotencyKey: string }) {
    const p = await super.create(proposal, opts);
    this.log.push({ ...p, ...this.clock() });
    return p;
  }
}

export async function runEvalItem(rawInput: unknown, model: PurchaseModel): Promise<EvalOutput> {
  const input: EvalInput = EvalInputSchema.parse(rawInput);
  const { setup } = input;
  pack ??= loadPack('manufacturing_textile');
  scores ??= supplierScoresFromSeed(pack);

  const store = InMemoryStore.fromDemo(pack);
  store.members = store.members.filter((m) => !setup.remove_roles.includes(m.role));
  setup.pre_orders.forEach((o, i) => store.recordOrder({ request_id: `pre-${i}`, ...o }));

  const t0 = Date.now();
  let resumedAt = Number.POSITIVE_INFINITY;
  const legAt = (ms: number): 'start' | 'resume' => (ms >= resumedAt ? 'resume' : 'start');
  const clock = () => {
    const now = Date.now();
    return { at: now - t0, leg: legAt(now) };
  };
  const payments = new RecordingPayments(clock);
  const exporter = new TestExporter();
  const mastra = new Mastra({
    workflows: {
      purchase: createPurchaseWorkflow({ pack, store, payments, model, supplierScores: scores, quoteLatencyMs: 0 }),
    },
    storage: new LibSQLStore({ id: `eval-${++counter}`, url: ':memory:' }),
    observability: makeObservability([exporter], {}),
    logger: false,
  });
  const service = new PurchaseService(mastra);

  let view = await service.start(input.raw_request, { requesterId: 'u-tech-1' });
  const pending = view.status === 'awaiting_approval' ? view.pending_approval : null;
  let decision: EvalOutput['decision'] = null;
  if (pending) {
    setup.orders_while_waiting.forEach((o, i) => store.recordOrder({ request_id: `meanwhile-${i}`, ...o }));
    decision = { approval: setup.decision, decided_by: pending.approver_id };
    resumedAt = Date.now();
    view = await service.decide(view.request_id, decision);
  }
  await new Promise((r) => setTimeout(r, 50)); // let the exporter receive the last span events

  const spans = exporter
    .getByEventType('span_started' as never)
    .map((e) => (e as unknown as { exportedSpan: { type: string; name: string; startTime: Date; traceId: string } }).exportedSpan)
    .filter((s) => s.type === 'workflow_step');
  const trace: TraceStep[] = spans
    .map((s) => ({ step: s.name.replace(/^workflow step: '|'$/g, ''), ms: new Date(s.startTime).getTime() }))
    .sort((a, b) => a.ms - b.ms)
    .map(({ step, ms }) => ({ step, at: ms - t0, leg: legAt(ms) }));

  return {
    status: view.status,
    state: view.state,
    pending,
    decision,
    payments: payments.log,
    trace,
    traceIds: [...new Set(spans.map((s) => s.traceId))],
    ...(view.error ? { error: view.error } : {}),
  };
}
