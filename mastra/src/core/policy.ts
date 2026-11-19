/**
 * The policy gate. Port of backend/core/policy.py. Plain TypeScript, no LLM.
 *
 * The model proposes; this decides. Nothing in a proposal is trusted: price and
 * category are re-read from the pack, supplier reliability from computed scores,
 * and budget from the ledger. Every rule that fires adds a reason a person can read.
 *
 * Order:
 *   1. unknown sku / supplier                 -> blocked
 *   2. supplier not approved (if required)     -> blocked
 *   3. category on the blocked list            -> blocked
 *   4. supplier score below the pack minimum   -> blocked
 *   5. total over the scope's remaining budget -> blocked
 *   6. first approval tier whose max_total covers the total:
 *        approver_role "none" -> auto_approve, otherwise needs_approval
 */

import type { Pack } from './packs';
import { pyFixedGrouped, pyG, pyRound } from './pyfmt';

export const AUTO_APPROVE_ROLE = 'none';

export type Decision = 'auto_approve' | 'needs_approval' | 'blocked';

export interface PolicyResult {
  decision: Decision | null;
  reasons: string[];
  approver_role: string | null;
  total: number | null;
  budget_scope: string;
  scope_key: string;
  budget: number | null;
  spent: number;
  remaining: number | null;
}

/** What the gate reads from a proposal. Any other field (a price, a total) is ignored. */
export interface ProposalInput {
  sku?: unknown;
  supplier_id?: unknown;
  qty?: unknown;
  [other: string]: unknown;
}

export interface CheckPolicyArgs {
  pack: Pack;
  supplierScores: Record<string, { score?: number | null } | undefined>;
  scopeKey: string;
  budget: number | null;
  spent: number;
}

const money = (x: number) => `$${pyFixedGrouped(x, 2)}`;

/** Python `int(x)`: truncate numbers, parse integer strings. Anything else counts as 0 (and is blocked). */
function toInt(x: unknown): number {
  if (typeof x === 'number') return Number.isFinite(x) ? Math.trunc(x) : 0;
  if (typeof x === 'string' && /^\s*[+-]?\d+\s*$/.test(x)) return Number.parseInt(x, 10);
  return 0;
}

export function checkPolicy(proposal: ProposalInput, args: CheckPolicyArgs): PolicyResult {
  const { pack, supplierScores, scopeKey, budget, spent } = args;
  const cfg = pack.config;
  const result: PolicyResult = {
    decision: null,
    reasons: [],
    approver_role: null,
    total: null,
    budget_scope: cfg.budget_scope,
    scope_key: scopeKey,
    budget,
    spent: pyRound(spent, 2),
    remaining: budget === null ? null : pyRound(budget - spent, 2),
  };

  const blocked = (reason: string): PolicyResult => {
    result.decision = 'blocked';
    result.reasons.push(reason);
    return result;
  };

  const item = pack.item(typeof proposal.sku === 'string' ? proposal.sku : '');
  const supplier = pack.supplier(typeof proposal.supplier_id === 'string' ? proposal.supplier_id : '');
  if (!item || !supplier || !Object.hasOwn(supplier.price_list, item.sku)) {
    return blocked("Proposal references a part or supplier that isn't in the catalog.");
  }
  const qty = toInt(proposal.qty ?? 0);
  if (qty < 1) return blocked('Quantity must be at least 1.');

  const total = pyRound(supplier.price_list[item.sku].unit_price * qty, 2);
  result.total = total;

  if (cfg.policy.approved_suppliers_only && !supplier.approved) {
    return blocked(`${supplier.name} is not an approved supplier.`);
  }
  if (cfg.policy.blocked_categories.includes(item.category)) {
    return blocked(`Category '${item.category}' is blocked by company policy.`);
  }

  const score = supplierScores[supplier.supplier_id]?.score ?? null;
  if (score === null || score < cfg.policy.min_supplier_score) {
    const shown = score === null ? 'no score' : `score ${pyG(score)}`;
    return blocked(`${supplier.name} has ${shown}, below the minimum of ${pyG(cfg.policy.min_supplier_score)}.`);
  }

  if (budget === null) return blocked(`No budget is set for ${scopeKey}.`);
  const remaining = budget - spent;
  if (total > remaining) {
    return blocked(
      `${money(total)} is more than the ${money(Math.max(remaining, 0))} left in ${scopeKey}'s budget this month.`,
    );
  }

  for (const rule of cfg.approval_rules) {
    if (rule.max_total === null || total <= rule.max_total) {
      result.approver_role = rule.approver_role;
      if (rule.approver_role === AUTO_APPROVE_ROLE) {
        result.decision = 'auto_approve';
        // Python raises here too: an uncapped auto-approve tier has no limit to quote.
        if (rule.max_total === null) throw new Error('auto-approve tier must have a max_total');
        result.reasons.push(
          `${money(total)} is within the ${money(rule.max_total)} auto-approve limit and the ${scopeKey} budget.`,
        );
      } else {
        result.decision = 'needs_approval';
        const limit = rule.max_total === null ? 'above every lower tier' : `up to ${money(rule.max_total)}`;
        result.reasons.push(`${money(total)} needs ${rule.approver_role.replaceAll('_', ' ')} approval (${limit}).`);
      }
      return result;
    }
  }
  throw new Error('approval rules always end with a catch-all'); // guaranteed by pack validation
}
