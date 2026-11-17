"""The policy gate. Plain Python, no LLM.

The model proposes; this decides. Nothing in a proposal is trusted: price and
category are re-read from the pack, supplier reliability from computed scores,
and budget from the ledger. Every rule that fires adds a reason a person can read.

Order:
  1. unknown sku / supplier                 -> blocked
  2. supplier not approved (if required)     -> blocked
  3. category on the blocked list            -> blocked
  4. supplier score below the pack minimum   -> blocked
  5. total over the scope's remaining budget -> blocked
  6. first approval tier whose max_total covers the total:
       approver_role "none" -> auto_approve, otherwise needs_approval
"""

from __future__ import annotations

from .packs import Pack

AUTO_APPROVE_ROLE = "none"


def _money(x: float) -> str:
    return f"${x:,.2f}"


def check_policy(
    proposal: dict,
    *,
    pack: Pack,
    supplier_scores: dict[str, dict],
    scope_key: str,
    budget: float | None,
    spent: float,
) -> dict:
    """Return {decision, reasons, approver_role, total, budget_scope, scope_key, budget, spent, remaining}."""
    cfg = pack.config
    result = {
        "decision": None,
        "reasons": [],
        "approver_role": None,
        "total": None,
        "budget_scope": cfg.budget_scope,
        "scope_key": scope_key,
        "budget": budget,
        "spent": round(spent, 2),
        "remaining": None if budget is None else round(budget - spent, 2),
    }

    def blocked(reason: str) -> dict:
        result["decision"] = "blocked"
        result["reasons"].append(reason)
        return result

    item = pack.item(proposal.get("sku", ""))
    supplier = pack.supplier(proposal.get("supplier_id", ""))
    if item is None or supplier is None or item.sku not in supplier.price_list:
        return blocked("Proposal references a part or supplier that isn't in the catalog.")
    qty = int(proposal.get("qty", 0))
    if qty < 1:
        return blocked("Quantity must be at least 1.")

    total = round(supplier.price_list[item.sku].unit_price * qty, 2)
    result["total"] = total

    if cfg.policy.approved_suppliers_only and not supplier.approved:
        return blocked(f"{supplier.name} is not an approved supplier.")
    if item.category in cfg.policy.blocked_categories:
        return blocked(f"Category '{item.category}' is blocked by company policy.")

    score = supplier_scores.get(supplier.supplier_id, {}).get("score")
    if score is None or score < cfg.policy.min_supplier_score:
        shown = "no score" if score is None else f"score {score:g}"
        return blocked(
            f"{supplier.name} has {shown}, below the minimum of {cfg.policy.min_supplier_score:g}."
        )

    if budget is None:
        return blocked(f"No budget is set for {scope_key}.")
    remaining = budget - spent
    if total > remaining:
        return blocked(
            f"{_money(total)} is more than the {_money(max(remaining, 0))} left in "
            f"{scope_key}'s budget this month."
        )

    for rule in cfg.approval_rules:
        if rule.max_total is None or total <= rule.max_total:
            result["approver_role"] = rule.approver_role
            if rule.approver_role == AUTO_APPROVE_ROLE:
                result["decision"] = "auto_approve"
                result["reasons"].append(
                    f"{_money(total)} is within the {_money(rule.max_total)} auto-approve limit "
                    f"and the {scope_key} budget."
                )
            else:
                result["decision"] = "needs_approval"
                limit = "above every lower tier" if rule.max_total is None else f"up to {_money(rule.max_total)}"
                result["reasons"].append(
                    f"{_money(total)} needs {rule.approver_role.replace('_', ' ')} approval ({limit})."
                )
            return result
    raise AssertionError("approval rules always end with a catch-all")  # guaranteed by pack validation
