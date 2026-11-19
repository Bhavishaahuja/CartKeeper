// Port of backend/tests/test_conscience.py (Day 2): policy routing, approval pause, bounded replan.
import { describe, expect, it } from 'vitest';
import { choiceSchema, needSchema } from '../../src/purchase/model';
import { InvalidDecision, NotAwaitingApproval } from '../../src/purchase/service';
import { FakeModel, harness, HEALD, makeModel, MOTOR, pack } from './harness';

describe('auto approve', () => {
  it('T2: pays without asking', async () => {
    const { service, store, payments } = harness(HEALD);
    const view = await service.start('Loom L-07 heald wires snapped, need 500 today');
    expect(view.status).toBe('executed');
    expect(view.state.policy_result!.decision).toBe('auto_approve');
    expect(view.state.payment!.amount).toBe(95.0);
    expect(store.spent('line_2')).toBe(95.0);
    expect(payments.payments.size).toBe(1);
  });
});

describe('approval', () => {
  it('T4: the manager tier pauses, then pays', async () => {
    const { service, store, payments } = harness(MOTOR);
    let view = await service.start('Replace drive motor on loom L-03', { requesterId: 'u-tech-1' });
    expect(view.status).toBe('awaiting_approval');
    const pending = view.pending_approval!;
    expect(pending.approver_id).toBe('u-mm-1');
    expect(pending.approver_role).toBe('maintenance_manager');
    expect(pending.proposal.total).toBe(890.0);
    expect(payments.calls).toBe(0); // nothing paid while waiting

    view = await service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    expect(view.status).toBe('executed');
    expect(view.state.decided_by).toBe('u-mm-1');
    expect(store.spent('line_2')).toBe(890.0);
    expect(payments.payments.size).toBe(1);
  });

  it('T4: a rejection ends with no payment', async () => {
    const { service, store, payments } = harness(MOTOR);
    let view = await service.start('Replace drive motor on loom L-03');
    view = await service.decide(view.request_id, { approval: 'rejected', decided_by: 'u-mm-1' });
    expect(view.status).toBe('rejected');
    expect(view.state.payment ?? null).toBeNull();
    expect(payments.calls).toBe(0);
    expect(store.orders).toEqual([]);
  });

  it('a bad approval value is refused and the request stays paused', async () => {
    const { service } = harness(MOTOR);
    const view = await service.start('Replace drive motor on loom L-03');
    await expect(
      service.decide(view.request_id, { approval: 'yes please' as 'approved', decided_by: 'u-mm-1' }),
    ).rejects.toThrow(InvalidDecision);
    expect((await service.snapshot(view.request_id))!.status).toBe('awaiting_approval');
  });

  it('the owner tier routes to the owner', async () => {
    const { service } = harness({ ...MOTOR, qty: 2 }); // $1,780
    const view = await service.start('two drive motors for L-03');
    expect(view.pending_approval!.approver_id).toBe('u-owner-1');
  });

  it('a missing manager escalates to the owner', async () => {
    const h = harness(MOTOR);
    h.store.members = h.store.members.filter((m) => m.role !== 'maintenance_manager');
    const view = await h.service.start('Replace drive motor on loom L-03');
    expect(view.pending_approval!.approver_id).toBe('u-owner-1');
    expect(view.pending_approval!.approver_role).toBe('owner');
  });

  it('nobody to approve explains and stops', async () => {
    const h = harness(MOTOR);
    h.store.members = h.store.members.filter((m) => !['maintenance_manager', 'owner'].includes(m.role));
    const view = await h.service.start('Replace drive motor on loom L-03');
    expect(view.status).toBe('blocked');
    expect(h.payments.calls).toBe(0);
  });
});

describe('blocked and replan', () => {
  it('T6: blocked, then replans once to a cheaper option', async () => {
    // $870 left on Line 2: SUP-02's $890 motor is blocked, SUP-03's $860 motor fits.
    const h = harness(MOTOR);
    h.store.recordOrder({ request_id: 'earlier', scope_key: 'line_2', total: 2130.0 });
    const view = await h.service.start('Replace drive motor on loom L-03');
    const s = view.state;
    expect(s.replan_count).toBe(1);
    expect(s.previous_attempt!.proposal.supplier_id).toBe('SUP-02');
    expect(s.previous_attempt!.reasons[0]).toContain('left in line_2');
    expect(s.eligible_quotes!.map((q) => q.supplier_id)).toEqual(['SUP-03']);
    expect(s.proposal!.supplier_id).toBe('SUP-03');
    expect(view.status).toBe('awaiting_approval'); // $860 still needs the manager
    const retry = JSON.parse(h.model.calls.at(-1)![1].user);
    expect(retry.previous_attempt.reasons.length).toBeGreaterThan(0);
    expect(h.model.calls.at(-1)![1].system).toContain('previous pick was blocked');
  });

  it('T6: blocked with nothing cheaper explains and stops', async () => {
    const h = harness(MOTOR);
    h.store.recordOrder({ request_id: 'earlier', scope_key: 'line_2', total: 2500.0 }); // $500 left
    const view = await h.service.start('Replace drive motor on loom L-03');
    expect(view.status).toBe('blocked');
    expect(view.state.final_message).toContain('Not purchased');
    expect(view.state.final_message).toContain('none fits');
    expect(h.payments.calls).toBe(0);
    expect(h.model.calls.map(([n]) => n)).toEqual(['Need', 'Choice']); // no second model call when nothing fits
  });

  it('replans at most once: a second block explains instead of looping', async () => {
    // $870 left. Round 1 picks SUP-02 ($890): blocked. The replan offers only SUP-03 ($860),
    // but the model asks for 2 ($1,720): blocked again. With the retry used up, the run must stop.
    const store = harness(MOTOR).store;
    store.recordOrder({ request_id: 'earlier', scope_key: 'line_2', total: 2130.0 });
    let round = 0;
    const model = new FakeModel({
      Need: () => MOTOR,
      Choice: (call) => {
        round += 1;
        const options = JSON.parse(call.user).options;
        const pick = options.find((o: { supplier_id: string }) => o.supplier_id === (round === 1 ? 'SUP-02' : 'SUP-03'));
        return { option_id: pick.option_id, qty: round, rationale: 'x' };
      },
    });
    const h = harness(MOTOR, { model, store });
    const view = await h.service.start('Replace drive motor on loom L-03');
    expect(round).toBe(2);
    expect(view.status).toBe('blocked');
    expect(view.state.replan_count).toBe(1);
    expect(view.state.proposal!.total).toBe(1720.0);
    expect(view.state.final_message).toContain('none fits');
    expect(h.payments.calls).toBe(0);
  });
});

describe('re-check before paying', () => {
  it('budget spent while waiting blocks at execute', async () => {
    const h = harness(MOTOR);
    let view = await h.service.start('Replace drive motor on loom L-03');
    h.store.recordOrder({ request_id: 'meanwhile', scope_key: 'line_2', total: 2500.0 });
    view = await h.service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    expect(view.status).toBe('blocked');
    expect(view.state.final_message).toContain('changed while this waited');
    expect(h.payments.calls).toBe(0);
  });

  it('a supplier score dropping below the minimum while waiting blocks at execute', async () => {
    const h = harness(MOTOR);
    let view = await h.service.start('Replace drive motor on loom L-03');
    const supplier = view.pending_approval!.proposal.supplier_id;
    const { scores } = await import('./harness');
    const original = scores()[supplier];
    scores()[supplier] = { ...original, score: 10 };
    try {
      view = await h.service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    } finally {
      scores()[supplier] = original;
    }
    expect(view.status).toBe('blocked');
    expect(view.state.final_message).toContain('below the minimum');
    expect(h.payments.calls).toBe(0);
  });
});

describe('statuses', () => {
  it('storeroom and no-match', async () => {
    const bearings = { item_need: '6205 bearings', search_terms: ['6205 bearing'], machine_id: 'S-04', urgency: 'line_down', qty: 2 };
    expect((await harness(bearings).service.start('2 x 6205 bearings for S-04')).status).toBe('reserved');
    const nothing = { item_need: 'espresso machine', search_terms: ['espresso'], machine_id: null, urgency: 'restock', qty: 1 };
    expect((await harness(nothing).service.start('an espresso machine')).status).toBe('no_match');
  });

  it('deciding a request that is not paused is refused', async () => {
    const { service } = harness(HEALD);
    const view = await service.start('heald wires');
    await expect(service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' })).rejects.toThrow(
      NotAwaitingApproval,
    );
    await expect(service.decide('no-such-request', { approval: 'approved', decided_by: 'u-mm-1' })).rejects.toThrow(
      NotAwaitingApproval,
    );
  });
});

describe('the model has no way to change a policy decision', () => {
  it('only two output schemas, and neither can carry a decision', async () => {
    const h = harness(MOTOR, { model: makeModel(MOTOR) });
    await h.service.start('Replace drive motor on loom L-03');
    const allowed = {
      Need: Object.keys(needSchema(pack()).shape),
      Choice: Object.keys(choiceSchema(['opt-1']).shape),
    };
    expect(new Set(h.model.calls.map(([n]) => n))).toEqual(new Set(Object.keys(allowed)));
    expect(allowed.Choice.sort()).toEqual(['option_id', 'qty', 'rationale']);
    const banned = ['decision', 'approval', 'approved', 'policy_result', 'approver_id', 'total', 'unit_price'];
    for (const fields of Object.values(allowed)) for (const b of banned) expect(fields).not.toContain(b);
  });

  it('neither agent has tools', async () => {
    const { intakeAgent, proposeAgent } = await import('../../src/mastra/agents');
    for (const agent of [intakeAgent, proposeAgent]) {
      expect(Object.keys(await agent.listTools()), agent.id).toEqual([]);
    }
  });
});
