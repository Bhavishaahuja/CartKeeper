from typing import Annotated, TypedDict


def add_quotes(left: list[dict], right: list[dict] | None) -> list[dict]:
    """Parallel quote_supplier branches append; writing None clears (for a replan round)."""
    return [] if right is None else (left or []) + right


class PurchaseState(TypedDict, total=False):
    company_id: str
    request_id: str
    requester_id: str
    raw_request: str
    need: dict                                    # {item_need, search_terms, machine_id, urgency, qty}
    candidates: list[dict]                        # catalog items that match the need, best first
    inventory_hit: dict | None                    # {sku, name, qty, on_hand, location}
    quotes: Annotated[list[dict], add_quotes]     # merged from parallel supplier branches
    sourcing: dict                                # timings for the parallel round
    scored_quotes: list[dict]
    proposal: dict | None                         # {supplier_id, sku, qty, unit_price, total, rationale}
    policy_result: dict | None                    # {decision, reasons, budget_scope, remaining}
    eligible_quotes: list[dict]                   # options that pass policy, set by replan
    previous_attempt: dict | None                 # the blocked proposal and why, shown on retry
    approver_id: str | None
    approver_role: str | None
    approval: str | None                          # "approved" | "rejected"
    decided_by: str | None
    replan_count: int
    payment: dict | None                          # {card_id, authorization_id, status}
    status: str                                   # reserved | executed | rejected | blocked | no_match
    final_message: str
