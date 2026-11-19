/**
 * CartKeeper HTTP API as Mastra custom routes. Port of backend/main.py, same contract:
 *
 *   GET  /health                                                     -> Mastra's built-in check, {"success": true}
 *   POST /requests                     {raw_request}                 -> 201 request view
 *   GET  /requests/:id                                               -> request view
 *   POST /requests/:id/decision        {approval: approved|rejected} -> request view
 *   GET  /approvals                                                  -> requests waiting on the caller
 *
 * Auth is the same development stand-in: callers send X-User-Id with a demo
 * company member's id. Errors are {"detail": "..."} with FastAPI's status codes.
 *
 * One difference: /health is Mastra's own route (it takes precedence over a
 * custom one), so it answers {"success": true} instead of {"ok": true}.
 */

import type { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Pack } from '../core/packs';
import type { Ledger, Member } from '../core/store';
import type { Purchase } from '../purchase/schema';
import { InvalidDecision, NotAwaitingApproval, PurchaseService, type RequestView } from '../purchase/service';
import { PURCHASE_WORKFLOW_ID } from '../purchase/workflow';

/** Roles that can see every request in the company; requesters see their own. */
export const COMPANY_WIDE_ROLES = new Set(['maintenance_manager', 'owner', 'finance']);

const NewRequestSchema = z.object({ raw_request: z.string().min(3).max(2000) });
const DecisionSchema = z.object({ approval: z.enum(['approved', 'rejected']) });

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiDeps {
  pack: Pack;
  store: Ledger;
}

/** The request as clients see it. Field for field the same as `_public` in main.py. */
export function publicView(view: RequestView) {
  const s = view.state;
  const { started_ms: _started, ...sourcing } = s.sourcing ?? {};
  return {
    request_id: view.request_id,
    status: view.status,
    requester_id: s.requester_id ?? null,
    raw_request: s.raw_request ?? null,
    need: s.need ?? null,
    inventory_hit: s.inventory_hit ?? null,
    sourcing: Object.keys(sourcing).length ? sourcing : null,
    options: s.scored_quotes ?? [],
    proposal: s.proposal ?? null,
    policy_result: s.policy_result ?? null,
    previous_attempt: s.previous_attempt ?? null,
    approver_id: s.approver_id ?? null,
    approver_role: s.approver_role ?? null,
    decided_by: s.decided_by ?? null,
    payment: s.payment ?? null,
    message: s.final_message ?? null,
  };
}

/** One in-process queue per request, so a double click resumes the workflow once. */
class Locks {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.tails.set(key, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }
}

async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(422, 'Body must be JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(422, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

export function cartkeeperRoutes({ pack, store }: ApiDeps) {
  const locks = new Locks();
  const service = (c: Context) => new PurchaseService(c.get('mastra') as Mastra);

  const currentUser = (c: Context): Member => {
    const id = c.req.header('x-user-id') ?? '';
    const member = id ? store.member(id) : undefined;
    if (!member) throw new HttpError(401, "Unknown user. Send X-User-Id with a company member's id.");
    return member;
  };

  const load = async (c: Context, requestId: string, user: Member): Promise<RequestView> => {
    const view = await service(c).snapshot(requestId);
    if (!view) throw new HttpError(404, 'Request not found.');
    const s = view.state;
    const approverId = view.pending_approval?.approver_id ?? s.approver_id;
    const visible = COMPANY_WIDE_ROLES.has(user.role) || s.requester_id === user.user_id || approverId === user.user_id;
    if (!visible) throw new HttpError(404, 'Request not found.');
    return view;
  };

  const failed = (view: RequestView) =>
    new HttpError(500, `Request ${view.request_id} failed: ${view.error ?? 'unknown error'}`);

  const route = (
    path: string,
    method: 'GET' | 'POST',
    fn: (c: Context) => Promise<Response>,
    openapi: { summary: string; description?: string },
  ) =>
    registerApiRoute(path, {
      method,
      openapi: { ...openapi, tags: ['CartKeeper'] },
      handler: async (c) => {
        try {
          return await fn(c);
        } catch (e) {
          if (e instanceof HttpError) return c.json({ detail: e.message }, e.status);
          throw e;
        }
      },
    });

  return [
    route('/requests', 'POST', async (c) => {
      const user = currentUser(c);
      const body = await readJson(c, NewRequestSchema);
      const view = await service(c).start(body.raw_request, { requesterId: user.user_id });
      if (view.status === 'failed') throw failed(view);
      return c.json(publicView(view), 201);
    }, { summary: 'Submit a purchase request', description: 'Runs until the request finishes or pauses for approval.' }),

    route('/requests/:id', 'GET', async (c) => {
      const user = currentUser(c);
      return c.json(publicView(await load(c, c.req.param('id')!, user)));
    }, { summary: 'Get a request' }),

    route('/requests/:id/decision', 'POST', async (c) => {
      const user = currentUser(c);
      const requestId = c.req.param('id')!;
      const body = await readJson(c, DecisionSchema);
      return locks.run(requestId, async () => {
        const view = await load(c, requestId, user);
        if (view.status !== 'awaiting_approval') {
          throw new HttpError(409, `Request is ${view.status}, not awaiting approval.`);
        }
        const pending = view.pending_approval!;
        if (view.state.requester_id === user.user_id) throw new HttpError(403, "You can't approve your own request.");
        const roles = pack.approverRoles();
        const required = pending.approver_role;
        const outranks = roles.includes(user.role) && roles.indexOf(user.role) >= roles.indexOf(required);
        if (pending.approver_id !== user.user_id && !outranks) {
          throw new HttpError(403, `This request needs ${required.replaceAll('_', ' ')} approval.`);
        }
        try {
          const done = await service(c).decide(requestId, { approval: body.approval, decided_by: user.user_id });
          if (done.status === 'failed') throw failed(done);
          return c.json(publicView(done));
        } catch (e) {
          if (e instanceof InvalidDecision) throw new HttpError(422, e.message);
          if (e instanceof NotAwaitingApproval) throw new HttpError(409, e.message);
          throw e;
        }
      });
    }, { summary: 'Approve or reject a paused request', description: 'Only the routed approver or a higher tier, never the requester.' }),

    route('/approvals', 'GET', async (c) => {
      const user = currentUser(c);
      const mastra = c.get('mastra') as Mastra;
      const { runs } = await mastra.getWorkflow(PURCHASE_WORKFLOW_ID).listWorkflowRuns({ status: 'suspended' });
      const svc = service(c);
      const rows = [];
      for (const run of runs) {
        const view = await svc.snapshot(run.runId);
        if (view?.status !== 'awaiting_approval' || view.pending_approval?.approver_id !== user.user_id) continue;
        rows.push(inboxRow(view, run.createdAt, run.updatedAt));
      }
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return c.json(rows);
    }, { summary: 'Requests waiting on the caller', description: 'Read from stored suspended runs, so the inbox survives a restart.' }),
  ];
}

function inboxRow(view: RequestView, createdAt: Date, updatedAt: Date) {
  const s: Purchase = view.state;
  return {
    request_id: view.request_id,
    status: view.status,
    requester_id: s.requester_id ?? null,
    approver_id: view.pending_approval?.approver_id ?? null,
    approver_role: view.pending_approval?.approver_role ?? null,
    raw_request: s.raw_request,
    total: s.proposal?.total ?? null,
    urgency: s.need?.urgency ?? null,
    machine_id: s.need?.machine_id ?? null,
    created_at: new Date(createdAt).toISOString(),
    updated_at: new Date(updatedAt).toISOString(),
  };
}
