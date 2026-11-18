/**
 * Running requests: start, decide, snapshot. Port of start/decide/snapshot in
 * backend/core/graph.py. Shared by the API, the CLI and tests.
 *
 * The request id is the workflow run id, and every view is read back from
 * storage, so a request paused before a restart looks the same after it.
 */

import { randomUUID } from 'node:crypto';
import type { Mastra } from '@mastra/core/mastra';
import { createWorkflowStateReader } from '@mastra/core/workflows';
import { type ApprovalDecision, ApprovalDecisionSchema, type ApprovalRequest, type Purchase } from './schema';
import { PURCHASE_WORKFLOW_ID, type PurchaseWorkflow } from './workflow';

export type RequestStatus =
  | 'awaiting_approval'
  | 'running'
  | 'failed'
  | 'unknown'
  | NonNullable<Purchase['status']>;

export interface RequestView {
  request_id: string;
  status: RequestStatus;
  pending_approval: Omit<ApprovalRequest, 'purchase'> | null;
  state: Purchase;
  error?: string;
}

export class InvalidDecision extends Error {}
export class NotAwaitingApproval extends Error {}

export class PurchaseService {
  constructor(private readonly mastra: Mastra) {}

  private get workflow(): PurchaseWorkflow {
    return this.mastra.getWorkflow(PURCHASE_WORKFLOW_ID) as unknown as PurchaseWorkflow;
  }

  /** Run a new request until it finishes or pauses for approval. */
  async start(rawRequest: string, opts: { requesterId?: string | null; requestId?: string } = {}): Promise<RequestView> {
    const requestId = opts.requestId ?? randomUUID();
    const run = await this.workflow.createRun({ runId: requestId });
    await run.start({
      inputData: { request_id: requestId, requester_id: opts.requesterId ?? null, raw_request: rawRequest },
    });
    return (await this.snapshot(requestId))!;
  }

  /** Resume a paused request with the approver's answer. */
  async decide(requestId: string, decision: ApprovalDecision): Promise<RequestView> {
    const parsed = ApprovalDecisionSchema.safeParse(decision);
    if (!parsed.success) {
      throw new InvalidDecision(`approval must be 'approved' or 'rejected', got ${JSON.stringify(decision.approval)}`);
    }
    const current = await this.snapshot(requestId);
    if (current?.status !== 'awaiting_approval') {
      throw new NotAwaitingApproval(`request ${requestId} is not awaiting approval (${current?.status ?? 'not found'})`);
    }
    const state = await this.workflow.getWorkflowRunById(requestId);
    const suspended = createWorkflowStateReader(state!).getSuspendedStep()!;
    const run = await this.workflow.createRun({ runId: requestId });
    await run.resume({ step: suspended.path, resumeData: parsed.data });
    return (await this.snapshot(requestId))!;
  }

  /** Current view of a request, or null if storage has never seen it. */
  async snapshot(requestId: string): Promise<RequestView | null> {
    const state = await this.workflow.getWorkflowRunById(requestId);
    if (!state) return null;
    const reader = createWorkflowStateReader(state);
    const status = reader.getStatus();

    if (status === 'suspended') {
      const payload = reader.getSuspendedStep()?.suspendPayload as ApprovalRequest;
      const { purchase, ...pending } = payload;
      return { request_id: requestId, status: 'awaiting_approval', pending_approval: pending, state: purchase };
    }
    if (status === 'success') {
      const result = reader.getResult() as Purchase;
      return { request_id: requestId, status: result.status ?? 'unknown', pending_approval: null, state: result };
    }
    const input = (state as { payload?: Purchase }).payload ?? ({ request_id: requestId } as Purchase);
    const error = reader.getError() as { message?: string } | undefined;
    return {
      request_id: requestId,
      status: status === 'failed' ? 'failed' : status === 'running' || status === 'pending' ? 'running' : 'unknown',
      pending_approval: null,
      state: input,
      ...(error ? { error: error.message ?? String(error) } : {}),
    };
  }
}
