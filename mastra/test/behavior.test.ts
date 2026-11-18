/**
 * Cross-framework parity: the shared scenarios in fixtures/scenarios.json run
 * through the Mastra workflow and must match what the Python LangGraph backend
 * produced for them (fixtures/behavior.json, written by scripts/export_behavior.py).
 *
 * Everything that matters is compared: status, need, candidates, options with
 * scores, the proposal, the policy result, replan details, who approves, what
 * was paid, the message, which model calls ran, and what landed in the ledger.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StubPayments } from '../src/core/payments';
import { InMemoryStore } from '../src/core/store';
import type { ScoredQuote } from '../src/purchase/schema';
import type { RequestView } from '../src/purchase/service';
import { FakeModel, harness, pack } from './workflow/harness';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const { scenarios } = fixture('scenarios.json');
const expected = fixture('behavior.json');

interface Scenario {
  id: string;
  plan: string;
  raw_request: string;
  need: Record<string, unknown> & { qty: number };
  picks: string[];
  qtys?: number[];
  pre_orders?: { scope_key: string; total: number }[];
  orders_while_waiting?: { scope_key: string; total: number }[];
  budgets?: Record<string, number>;
  remove_roles?: string[];
  decision?: { approval: 'approved' | 'rejected'; decided_by: string };
}

function pick(rule: string, options: ScoredQuote[]): ScoredQuote {
  if (rule === 'first') return options[0];
  if (rule === 'most_reliable') {
    return options.reduce((b, o) =>
      o.reliability.score > b.reliability.score || (o.reliability.score === b.reliability.score && o.unit_price < b.unit_price) ? o : b,
    );
  }
  if (rule === 'cheapest') {
    return options.reduce((b, o) => (o.unit_price < b.unit_price || (o.unit_price === b.unit_price && o.option_id < b.option_id) ? o : b));
  }
  return options.find((o) => o.supplier_id === rule)!;
}

function project(view: RequestView, model: FakeModel, store: InMemoryStore, payments: StubPayments) {
  const s = view.state;
  return {
    status: view.status,
    need: s.need ?? null,
    candidates: (s.candidates ?? []).map((c) => c.sku),
    inventory_hit: s.inventory_hit ?? null,
    options: (s.scored_quotes ?? []).map(({ option_id, sku, supplier_id, unit_price, lead_days, reliability }) => ({
      option_id, sku, supplier_id, unit_price, lead_days, reliability,
    })),
    proposal: s.proposal ?? null,
    policy_result: s.policy_result ?? null,
    previous_attempt: s.previous_attempt ?? null,
    eligible: (s.eligible_quotes ?? []).map((q) => q.supplier_id),
    replan_count: s.replan_count ?? 0,
    approver_id: view.pending_approval?.approver_id ?? s.approver_id ?? null,
    approver_role: view.pending_approval?.approver_role ?? s.approver_role ?? null,
    decided_by: s.decided_by ?? null,
    paid: s.payment?.amount ?? null,
    message: s.final_message ?? null,
    model_calls: model.calls.map(([n]) => n),
    payments: payments.payments.size,
    orders: store.orders.filter((o) => o.request_id === 'req-1').map((o) => ({ scope_key: o.scope_key, total: o.total })),
  };
}

async function run(sc: Scenario) {
  let round = 0;
  const model = new FakeModel({
    Need: () => sc.need,
    Choice: (call) => {
      const i = round++;
      const options = JSON.parse(call.user).options as ScoredQuote[];
      return { option_id: pick(sc.picks[i], options).option_id, qty: sc.qtys?.[i] ?? sc.need.qty, rationale: 'scenario pick' };
    },
  });
  const store = InMemoryStore.fromDemo(pack());
  Object.assign(store.budgets, sc.budgets ?? {});
  store.members = store.members.filter((m) => !(sc.remove_roles ?? []).includes(m.role));
  (sc.pre_orders ?? []).forEach((o, i) => store.recordOrder({ request_id: `pre-${i}`, ...o }));
  const payments = new StubPayments();
  const h = harness(sc.need, { model, store, payments });

  let view = await h.service.start(sc.raw_request, { requesterId: 'u-tech-1', requestId: 'req-1' });
  const paused = { status: view.status, approver_id: view.pending_approval?.approver_id ?? null };
  if (sc.decision) {
    expect(view.status).toBe('awaiting_approval');
    (sc.orders_while_waiting ?? []).forEach((o, i) => store.recordOrder({ request_id: `meanwhile-${i}`, ...o }));
    view = await h.service.decide('req-1', sc.decision);
  }
  return { paused, ...project(view, model, store, payments) };
}

describe('same outcome as the Python backend', () => {
  for (const sc of scenarios as Scenario[]) {
    it(`${sc.id} (${sc.plan})`, async () => {
      expect(await run(sc)).toEqual(expected[sc.id]);
    });
  }

  it('covers every behavior in the plan', () => {
    const plans = new Set((scenarios as Scenario[]).map((s) => s.plan));
    expect([...plans].sort()).toEqual(
      [
        'Auto-approve under $150',
        'Maintenance manager up to $1,500',
        'Owner above $1,500',
        'Storeroom hit means nothing gets bought',
        'Blocked, then replans once, then closes with the reason',
        'Rejection means no payment',
        'Policy changes while the run is paused, so execute blocks',
      ].sort(),
    );
  });
});
