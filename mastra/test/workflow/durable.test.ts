/**
 * T5 and the idempotency guarantee.
 *
 * Restart: a request paused for approval survives a brand-new Mastra instance
 * with its own storage connection, sharing nothing in memory but the company
 * store. Runs against a LibSQL file always, and against Postgres when
 * CARTKEEPER_TEST_DATABASE_URL is set (port of backend/tests/test_durable.py).
 *
 * Idempotency: resuming twice, one after the other or at the same moment,
 * pays once and records one order.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibSQLStore } from '@mastra/libsql';
import { PostgresStore } from '@mastra/pg';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { StubPayments } from '../../src/core/payments';
import { InMemoryStore } from '../../src/core/store';
import { harness, MOTOR, pack } from './harness';

type StorageFactory = () => { storage: unknown; close: () => Promise<void> };

async function survivesRestart(makeStorage: StorageFactory) {
  const store = InMemoryStore.fromDemo(pack());
  const payments = new StubPayments();

  // Process 1: start the request; it pauses for the maintenance manager.
  const first = makeStorage();
  const a = harness(MOTOR, { store, payments, storage: first.storage });
  const view = await a.service.start('Replace drive motor on loom L-03');
  expect(view.status).toBe('awaiting_approval');
  await first.close(); // "server stops"

  // Process 2: a new Mastra, workflow and connection. Nothing shared in memory but the company store.
  const second = makeStorage();
  try {
    const b = harness(MOTOR, { store, payments, storage: second.storage });
    const restored = await b.service.snapshot(view.request_id);
    expect(restored!.status).toBe('awaiting_approval');
    expect(restored!.pending_approval!.proposal.total).toBe(890.0);
    expect(restored!.state.scored_quotes!.length).toBeGreaterThan(0);

    const done = await b.service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    expect(done.status).toBe('executed');
    expect(payments.payments.size).toBe(1);
    expect(store.orders).toHaveLength(1);
    expect(await b.service.snapshot('does-not-exist')).toBeNull();
  } finally {
    await second.close();
  }
}

describe('T5: a paused request survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ck-durable-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('LibSQL file', async () => {
    const url = `file:${join(dir, 'mastra.db')}`;
    let n = 0;
    await survivesRestart(() => {
      const storage = new LibSQLStore({ id: `durable-${++n}`, url });
      return { storage, close: async () => {} };
    });
  });

  const dsn = process.env.CARTKEEPER_TEST_DATABASE_URL;
  it.skipIf(!dsn)('Postgres', async () => {
    const schemaName = `ck_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    let n = 0;
    try {
      await survivesRestart(() => {
        const storage = new PostgresStore({ id: `durable-pg-${++n}`, connectionString: dsn!, schemaName, max: 2 });
        return { storage, close: () => storage.close() };
      });
      // The paused-then-finished run really lives in Postgres, in this test's schema.
      const pool = new Pool({ connectionString: dsn, max: 1 });
      try {
        const rows = await pool.query(`SELECT count(*)::int AS n FROM ${schemaName}.mastra_workflow_snapshot`);
        expect(rows.rows[0].n).toBeGreaterThan(0);
      } finally {
        await pool.end();
      }
    } finally {
      const pool = new Pool({ connectionString: dsn, max: 1 });
      await pool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await pool.end();
    }
  });
});

describe('idempotency', () => {
  it('resuming twice in a row pays once', async () => {
    const h = harness(MOTOR);
    const view = await h.service.start('Replace drive motor on loom L-03');
    await h.service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    await expect(h.service.decide(view.request_id, { approval: 'approved', decided_by: 'u-mm-1' })).rejects.toThrow();
    expect(h.payments.calls).toBe(1);
    expect(h.store.orders).toHaveLength(1);
  });

  it('two resumes at the same moment pay once', async () => {
    const h = harness(MOTOR);
    const view = await h.service.start('Replace drive motor on loom L-03');
    const decision = { approval: 'approved' as const, decided_by: 'u-mm-1' };
    const results = await Promise.allSettled([
      h.service.decide(view.request_id, decision),
      h.service.decide(view.request_id, decision),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(h.payments.payments.size).toBe(1); // the idempotency key absorbs any second call
    expect(h.store.orders).toHaveLength(1);
    expect((await h.service.snapshot(view.request_id))!.status).toBe('executed');
  });

  it('resuming the raw Mastra run twice, past the service guard, still pays once', async () => {
    const h = harness(MOTOR);
    const view = await h.service.start('Replace drive motor on loom L-03');
    const wf = h.mastra.getWorkflow('purchase');
    const resume = async () => {
      const run = await wf.createRun({ runId: view.request_id });
      return run.resume({ resumeData: { approval: 'approved', decided_by: 'u-mm-1' } }).catch((e: Error) => e);
    };
    await Promise.all([resume(), resume()]);
    await resume();
    expect(h.payments.payments.size).toBe(1);
    expect(h.store.orders).toHaveLength(1);
  });

  it('the payment idempotency key is per request', async () => {
    const h = harness(MOTOR);
    const v1 = await h.service.start('motor 1');
    const v2 = await h.service.start('motor 2');
    await h.service.decide(v1.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    await h.service.decide(v2.request_id, { approval: 'approved', decided_by: 'u-mm-1' });
    expect([...h.payments.payments.keys()].sort()).toEqual(
      [`ck-${v1.request_id}-execute`, `ck-${v2.request_id}-execute`].sort(),
    );
  });
});

describe('request id', () => {
  it('is the workflow run id, whatever the input says', async () => {
    const h = harness(MOTOR);
    const run = await h.mastra.getWorkflow('purchase').createRun({ runId: 'run-abc' });
    await run.start({ inputData: { request_id: 'something-else', raw_request: 'motor', requester_id: null } });
    const view = await h.service.snapshot('run-abc');
    expect(view!.state.request_id).toBe('run-abc');
    expect(view!.pending_approval!.request_id).toBe('run-abc');
  });
});
