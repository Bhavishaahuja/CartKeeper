// Port of backend/tests/test_api.py, through Mastra's own Hono server (the one `mastra dev` runs).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibSQLStore } from '@mastra/libsql';
import { createHonoServer } from '@mastra/deployer/server';
import { afterAll, describe, expect, it } from 'vitest';
import { StubPayments } from '../../src/core/payments';
import { InMemoryStore } from '../../src/core/store';
import type { ScoredQuote } from '../../src/purchase/schema';
import { FakeModel, type Harness, harness, HEALD, MOTOR, pack } from '../workflow/harness';

const TECH = { 'X-User-Id': 'u-tech-1' };
const MANAGER = { 'X-User-Id': 'u-mm-1' };
const OWNER = { 'X-User-Id': 'u-owner-1' };
const FINANCE = { 'X-User-Id': 'u-fin-1' };

/** Like fake_llm() in test_api.py: the need depends on the text, the pick is the most reliable option. */
function fakeModel(override?: Record<string, unknown>) {
  return new FakeModel({
    Need: (call) => override ?? (call.user.toLowerCase().includes('motor') ? MOTOR : HEALD),
    Choice: (call) => {
      const ctx = JSON.parse(call.user);
      const best = (ctx.options as ScoredQuote[]).reduce((a, o) => (o.reliability.score > a.reliability.score ? o : a));
      return { option_id: best.option_id, qty: ctx.need.qty, rationale: 'most reliable' };
    },
  });
}

async function client(opts: Parameters<typeof harness>[1] = {}) {
  const h = harness(MOTOR, { model: fakeModel(), ...opts });
  const app = await createHonoServer(h.mastra, { tools: {} } as never);
  const call = async (method: 'GET' | 'POST', path: string, headers: Record<string, string> = {}, body?: unknown) => {
    const r = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  };
  const submit = async (raw: string, headers = TECH) => call('POST', '/requests', headers, { raw_request: raw });
  return { ...h, call, submit } as Harness & { call: typeof call; submit: typeof submit };
}

describe('API contract (test_api.py)', () => {
  it('requires a known user', async () => {
    const c = await client();
    expect((await c.call('POST', '/requests', {}, { raw_request: 'motor' })).status).toBe(401);
    expect((await c.call('POST', '/requests', { 'X-User-Id': 'nobody' }, { raw_request: 'motor' })).status).toBe(401);
    expect((await c.call('GET', '/approvals')).json).toEqual({ detail: "Unknown user. Send X-User-Id with a company member's id." });
  });

  it('T2: auto-approved over the API', async () => {
    const c = await client();
    const r = await c.submit('Loom L-07 heald wires snapped, need 500 today');
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('executed');
    expect(r.json.payment.amount).toBe(95.0);
    expect(r.json.sourcing.suppliers_quoted).toBe(2);
    expect(r.json.sourcing).not.toHaveProperty('started_ms');
  });

  it('T4: pause and approve over the API', async () => {
    const c = await client();
    const body = (await c.submit('Replace drive motor on loom L-03')).json;
    const rid = body.request_id;
    expect(body.status).toBe('awaiting_approval');
    expect(body.approver_id).toBe('u-mm-1');
    expect(body.policy_result.decision).toBe('needs_approval');

    const inbox = (await c.call('GET', '/approvals', MANAGER)).json;
    expect(inbox.map((r: { request_id: string }) => r.request_id)).toEqual([rid]);
    expect(inbox[0]).toMatchObject({ total: 890, urgency: 'line_down', machine_id: 'L-03', requester_id: 'u-tech-1' });
    expect((await c.call('GET', '/approvals', OWNER)).json).toEqual([]);

    const r = await c.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'approved' });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('executed');
    expect(r.json.decided_by).toBe('u-mm-1');
    expect((await c.call('GET', '/approvals', MANAGER)).json).toEqual([]);
    expect(c.payments.payments.size).toBe(1);
  });

  it('T8: a second decision is refused', async () => {
    const c = await client();
    const rid = (await c.submit('drive motor L-03')).json.request_id;
    expect((await c.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'approved' })).status).toBe(200);
    const r = await c.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'approved' });
    expect(r.status).toBe(409);
    expect(r.json.detail).toBe('Request is executed, not awaiting approval.');
    expect(c.payments.payments.size).toBe(1);
  });

  it('reject over the API', async () => {
    const c = await client();
    const rid = (await c.submit('drive motor L-03')).json.request_id;
    const r = await c.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'rejected' });
    expect(r.json.status).toBe('rejected');
    expect(c.payments.calls).toBe(0);
  });

  it('only the right people can decide', async () => {
    const c = await client();
    const rid = (await c.submit('drive motor L-03')).json.request_id;
    const decide = (who: Record<string, string>) => c.call('POST', `/requests/${rid}/decision`, who, { approval: 'approved' });
    expect((await decide(TECH)).status).toBe(403); // requester can't approve own request
    expect((await decide(FINANCE)).status).toBe(403); // finance isn't an approver
    expect((await decide(OWNER)).status).toBe(200); // a higher tier may approve
  });

  it('a manager cannot approve an owner-tier request', async () => {
    const c = await client({ model: fakeModel({ ...MOTOR, qty: 2 }) }); // $1,780
    const rid = (await c.submit('two drive motors for L-03')).json.request_id;
    const r = await c.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'approved' });
    expect(r.status).toBe(403);
    expect(r.json.detail).toBe('This request needs owner approval.');
  });

  it('a bad approval value is 422', async () => {
    const c = await client();
    const rid = (await c.submit('drive motor L-03')).json.request_id;
    expect((await c.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'sure' })).status).toBe(422);
    expect((await c.call('POST', `/requests/${rid}/decision`, MANAGER, 'not json')).status).toBe(422);
    expect((await c.call('POST', '/requests', TECH, { raw_request: 'x' })).status).toBe(422);
  });

  it('visibility', async () => {
    const c = await client();
    c.store.members.push({ user_id: 'u-tech-2', name: 'Other tech', role: 'requester' });
    const rid = (await c.submit('drive motor L-03')).json.request_id;
    expect((await c.call('GET', `/requests/${rid}`, TECH)).status).toBe(200);
    expect((await c.call('GET', `/requests/${rid}`, OWNER)).status).toBe(200);
    expect((await c.call('GET', `/requests/${rid}`, MANAGER)).status).toBe(200);
    expect((await c.call('GET', `/requests/${rid}`, { 'X-User-Id': 'u-tech-2' })).status).toBe(404);
    expect((await c.call('GET', '/requests/nope', OWNER)).status).toBe(404);
  });
});

describe('beyond the Python contract', () => {
  it('a double click pays once', async () => {
    const c = await client();
    const rid = (await c.submit('drive motor L-03')).json.request_id;
    const [a, b] = await Promise.all([
      c.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'approved' }),
      c.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'approved' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(c.payments.calls).toBe(1);
  });

  it('a workflow failure is a 500 with the reason, not a 201', async () => {
    const c = await client({ model: new FakeModel({ Need: () => { throw new Error('model unavailable'); } }) });
    const r = await c.submit('drive motor L-03');
    expect(r.status).toBe(500);
    expect(r.json.detail).toContain('model unavailable');
  });

  it('the approval inbox survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ck-api-'));
    try {
      const url = `file:${join(dir, 'mastra.db')}`;
      const store = InMemoryStore.fromDemo(pack());
      const payments = new StubPayments();
      const before = await client({ store, payments, storage: new LibSQLStore({ id: 'api-1', url }) });
      const rid = (await before.submit('drive motor L-03')).json.request_id;

      const after = await client({ store, payments, storage: new LibSQLStore({ id: 'api-2', url }) });
      expect((await after.call('GET', '/approvals', MANAGER)).json.map((r: { request_id: string }) => r.request_id)).toEqual([rid]);
      const r = await after.call('POST', `/requests/${rid}/decision`, MANAGER, { approval: 'approved' });
      expect(r.json.status).toBe('executed');
      expect(payments.payments.size).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Mastra’s own routes are still served next to ours', async () => {
    const c = await client();
    const app = await createHonoServer(c.mastra, { tools: {} } as never);
    const workflows = await (await app.request('/api/workflows')).json();
    expect(Object.keys(workflows)).toContain('purchase');
    // Mastra's built-in /health wins over a custom route, so the body differs from FastAPI's {"ok": true}.
    expect(await (await app.request('/health')).json()).toEqual({ success: true });
  });
});
