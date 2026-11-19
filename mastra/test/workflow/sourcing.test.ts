// Port of backend/tests/test_sourcing.py and test_graph.py: storeroom, parallel sourcing, proposals.
import { describe, expect, it } from 'vitest';
import { needSchema } from '../../src/purchase/model';
import { FakeModel, harness, HEALD, makeModel, mostReliable, MOTOR, pack, scores } from './harness';

const BEARINGS = { item_need: '6205 bearings', search_terms: ['6205 bearing'], machine_id: 'S-04', urgency: 'line_down', qty: 2 };
const first = <T>(options: T[]) => options[0];

async function run(need: Record<string, unknown>, opts: Parameters<typeof harness>[1] = {}, text = 'request') {
  const h = harness(need, { model: makeModel(need, first), ...opts });
  const view = await h.service.start(text);
  return { ...h, view, s: view.state };
}

describe('storeroom', () => {
  it('T1: a part in stock short-circuits, with no propose call', async () => {
    const { s, model } = await run(BEARINGS, {}, 'Need 2 x 6205 bearings for spinning frame S-04');
    expect(s.inventory_hit?.sku).toBe('BRG-6205-2RS');
    expect(s.proposal).toBeNull();
    expect(s.final_message).toContain('Nothing to buy');
    expect(model.calls.map(([n]) => n)).toEqual(['Need']);
  });

  it('not enough stock goes to suppliers', async () => {
    const { s } = await run({ ...BEARINGS, qty: 50 });
    expect(s.inventory_hit).toBeNull();
    expect(s.proposal?.sku).toBe('BRG-6205-2RS');
  });
});

describe('sourcing', () => {
  it('machine compatibility narrows candidates', async () => {
    const { s } = await run(HEALD);
    expect(new Set(s.candidates!.map((c) => c.sku))).toEqual(new Set(['HW-330-OMNI'])); // not the OptiMax wire
  });

  it('quotes arrive in one parallel round', async () => {
    const { s } = await run(MOTOR, { quoteLatencyMs: 300 });
    const src = s.sourcing!;
    expect(src.suppliers_quoted).toBeGreaterThanOrEqual(2);
    expect(new Set(Object.keys(src.per_supplier_ms!))).toEqual(new Set(['SUP-02', 'SUP-03']));
    // Parallel: the round takes about one quote's latency, not the sum of all of them.
    expect(src.round_ms!).toBeLessThan(src.sequential_ms! * 0.75);
  });

  it('options carry reliability scores', async () => {
    const { s } = await run(HEALD);
    const bySupplier = Object.fromEntries(s.scored_quotes!.map((q) => [q.supplier_id, q]));
    const cheap = bySupplier['SUP-01'];
    const reliable = bySupplier['SUP-02'];
    expect(cheap.unit_price).toBeLessThan(reliable.unit_price);
    expect(cheap.reliability.score).toBeLessThan(reliable.reliability.score);
    expect(s.scored_quotes!.map((q) => q.option_id)).toEqual(s.scored_quotes!.map((_, i) => `opt-${i + 1}`));
  });

  it('unapproved suppliers are not offered', async () => {
    const { s } = await run(HEALD);
    expect(s.quotes!.length).toBeGreaterThan(0);
    for (const q of s.quotes!) expect(pack().supplier(q.supplier_id)!.approved).toBe(true);
  });
});

describe('propose', () => {
  it('returns the need and a proposal', async () => {
    const { s } = await run(HEALD, {}, 'Loom L-07 heald wires snapped, need 500 today');
    expect(s.need!.machine_id).toBe('L-07');
    expect(s.need!.urgency).toBe('line_down');
    const p = s.proposal!;
    expect(p.qty).toBe(500);
    expect(p.total).toBe(Math.round(p.unit_price * 500 * 100) / 100);
    expect(p.rationale).toBeTruthy();
  });

  it('price comes from the catalog, not the model', async () => {
    const { s } = await run(HEALD);
    const p = s.proposal!;
    expect(p.unit_price).toBe(pack().supplier(p.supplier_id)!.price_list[p.sku].unit_price);
  });

  it('T3: the proposal records the score of the pick', async () => {
    const { s } = await run(HEALD, { model: makeModel(HEALD, mostReliable) });
    const p = s.proposal!;
    expect(p.supplier_id).toBe('SUP-02');
    expect(p.supplier_score).toBe(scores()['SUP-02'].score);
    expect(p.total).toBe(95.0);
  });

  it('the propose prompt tells the model to cite scores', async () => {
    const { model } = await run(HEALD);
    const system = model.calls.find(([n]) => n === 'Choice')![1].system;
    expect(system).toContain('reliability score');
    expect(system).toContain('cite');
  });

  it('the model cannot pick an option that does not exist', async () => {
    const model = new FakeModel({ Need: () => HEALD, Choice: () => ({ option_id: 'opt-999', qty: 500, rationale: 'x' }) });
    const { view, payments } = await run(HEALD, { model });
    expect(view.status).toBe('failed');
    expect(payments.calls).toBe(0);
  });

  it('no match returns a message, not a proposal, and never asks the model to choose', async () => {
    const need = { item_need: 'espresso machine', search_terms: ['espresso'], machine_id: null, urgency: 'restock', qty: 1 };
    const model = new FakeModel({ Need: () => need });
    const { view, s } = await run(need, { model }, 'buy an espresso machine');
    expect(view.status).toBe('no_match');
    expect(s.proposal).toBeNull();
    expect(s.final_message).toContain("'espresso machine'");
    expect(model.calls.map(([n]) => n)).toEqual(['Need']);
  });

  it('the need schema only allows the pack’s urgencies and machines', () => {
    const schema = needSchema(pack());
    expect(schema.shape.urgency.options).toEqual(Object.keys(pack().config.urgency_levels));
    expect(schema.safeParse({ ...HEALD, machine_id: 'L-99' }).success).toBe(false);
    expect(schema.safeParse({ ...HEALD, urgency: 'yesterday' }).success).toBe(false);
  });
});
