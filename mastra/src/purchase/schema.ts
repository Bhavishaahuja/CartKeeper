/**
 * The purchase record that flows through the workflow. Port of
 * backend/core/state.py: every step reads it and returns it with its own
 * fields filled in, so a run's output (or its suspend payload) is the whole
 * story of a request.
 */

import { z } from 'zod';

export const NeedSchema = z.object({
  item_need: z.string(),
  search_terms: z.array(z.string()),
  machine_id: z.string().nullable(),
  urgency: z.string(),
  qty: z.int(),
});

const itemFields = {
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  compatible_models: z.array(z.string()).nullable(),
};

export const CandidateSchema = z.object(itemFields);

export const QuoteSchema = z.object({
  ...itemFields,
  supplier_id: z.string(),
  supplier_name: z.string(),
  unit_price: z.number(),
  lead_days: z.int(),
  latency_ms: z.number(),
});

export const ReliabilitySchema = z.object({
  score: z.number(),
  on_time_rate: z.number(),
  avg_days_late: z.number(),
  defect_rate: z.number(),
  orders: z.int(),
  low_confidence: z.boolean(),
});

export const ScoredQuoteSchema = z.object({
  option_id: z.string(),
  ...itemFields,
  supplier_id: z.string(),
  supplier_name: z.string(),
  unit_price: z.number(),
  lead_days: z.int(),
  reliability: ReliabilitySchema,
});

export const InventoryHitSchema = z.object({
  sku: z.string(),
  name: z.string(),
  qty: z.int(),
  on_hand: z.int(),
  location: z.string(),
});

export const SourcingSchema = z.object({
  started_ms: z.number().optional(),
  suppliers_quoted: z.int().optional(),
  round_ms: z.number().optional(),
  sequential_ms: z.number().optional(),
  per_supplier_ms: z.record(z.string(), z.number()).optional(),
});

export const ProposalSchema = z.object({
  supplier_id: z.string(),
  supplier_name: z.string(),
  sku: z.string(),
  name: z.string(),
  qty: z.int(),
  unit_price: z.number(),
  total: z.number(),
  lead_days: z.int(),
  supplier_score: z.number(),
  rationale: z.string(),
});

export const PolicyResultSchema = z.object({
  decision: z.enum(['auto_approve', 'needs_approval', 'blocked']).nullable(),
  reasons: z.array(z.string()),
  approver_role: z.string().nullable(),
  total: z.number().nullable(),
  budget_scope: z.string(),
  scope_key: z.string(),
  budget: z.number().nullable(),
  spent: z.number(),
  remaining: z.number().nullable(),
});

export const PaymentSchema = z.object({
  provider: z.string(),
  card_id: z.string(),
  amount: z.number(),
  status: z.string(),
  idempotency_key: z.string(),
});

export const STATUSES = ['reserved', 'executed', 'rejected', 'blocked', 'no_match'] as const;

export const PurchaseSchema = z.object({
  request_id: z.string(),
  requester_id: z.string().nullable(),
  raw_request: z.string(),
  need: NeedSchema.optional(),
  candidates: z.array(CandidateSchema).optional(),
  inventory_hit: InventoryHitSchema.nullable().optional(),
  quotes: z.array(QuoteSchema).optional(),
  sourcing: SourcingSchema.optional(),
  scored_quotes: z.array(ScoredQuoteSchema).optional(),
  proposal: ProposalSchema.nullable().optional(),
  policy_result: PolicyResultSchema.nullable().optional(),
  eligible_quotes: z.array(ScoredQuoteSchema).optional(),
  previous_attempt: z
    .object({
      proposal: z.object({ sku: z.string(), supplier_id: z.string(), qty: z.int(), total: z.number() }),
      reasons: z.array(z.string()),
    })
    .nullable()
    .optional(),
  /** Set by the replan step when another propose round should run. */
  retry: z.boolean().optional(),
  approver_id: z.string().nullable().optional(),
  approver_role: z.string().nullable().optional(),
  approval: z.enum(['approved', 'rejected']).nullable().optional(),
  decided_by: z.string().nullable().optional(),
  replan_count: z.int().default(0),
  payment: PaymentSchema.nullable().optional(),
  status: z.enum(STATUSES).optional(),
  final_message: z.string().optional(),
});

export type Purchase = z.infer<typeof PurchaseSchema>;
export type Need = z.infer<typeof NeedSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type ScoredQuote = z.infer<typeof ScoredQuoteSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;

export const StartInputSchema = z.object({
  /** Ignored if it differs: the request id is always the workflow run id. */
  request_id: z.string().optional(),
  requester_id: z.string().nullable().default(null),
  raw_request: z.string().min(1),
});

/** What the approval step hands the approver, and what it waits for. */
export const ApprovalRequestSchema = z.object({
  request_id: z.string(),
  approver_id: z.string(),
  approver_role: z.string(),
  proposal: ProposalSchema,
  policy_result: PolicyResultSchema,
  /** The full record at the pause, so a restarted server can show the request without re-running anything. */
  purchase: PurchaseSchema,
});

export const ApprovalDecisionSchema = z.object({
  approval: z.enum(['approved', 'rejected']),
  decided_by: z.string(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
