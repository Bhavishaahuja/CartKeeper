import operator
from typing import Annotated, TypedDict


class PurchaseState(TypedDict, total=False):
    company_id: str
    request_id: str
    requester_id: str
    raw_request: str
    need: dict                                    # {item_need, search_terms, machine_id, urgency, qty}
    inventory_hit: dict | None
    quotes: Annotated[list[dict], operator.add]   # reducer, ready for Day 1's parallel fan-out
    scored_quotes: list[dict]
    proposal: dict | None                         # {supplier_id, sku, qty, unit_price, total, rationale}
    policy_result: dict | None                    # {decision, reasons, budget_scope, remaining}
    approver_id: str | None
    approval: str | None
    replan_count: int
    payment: dict | None                          # {card_id, authorization_id, status}
    final_message: str
