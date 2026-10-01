"""Graph nodes.

The LLM reads the request and picks among options. Code finds the options and
builds the proposal from catalog data, so prices and SKUs in a proposal always
come from the pack, never from model output.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END
from langgraph.types import Send, interrupt
from pydantic import BaseModel, Field, create_model

from .packs import Pack
from .payments import PaymentError
from .policy import check_policy

MAX_OPTION_ITEMS = 5

log = logging.getLogger("cartkeeper")


def _structured(llm, schema):
    # json_schema = Claude's native structured outputs; nothing is parsed from free text.
    return llm.with_structured_output(schema, method="json_schema")


# --- intake -----------------------------------------------------------------

def need_schema(pack: Pack) -> type[BaseModel]:
    urgency = Literal[tuple(pack.config.urgency_levels)]
    machine_ids = tuple(m.machine_id for m in pack.machines)
    machine = Optional[Literal[machine_ids]] if machine_ids else Optional[str]
    return create_model(
        "Need",
        item_need=(str, Field(description="What needs to be bought, in plain words.")),
        search_terms=(list[str], Field(description="1 to 6 short catalog search terms, e.g. part names.")),
        machine_id=(machine, Field(description="Machine the part is for, if the request names one in the registry.")),
        urgency=(urgency, Field(description="How urgent the request is.")),
        qty=(int, Field(description="Quantity requested in the catalog's unit. 1 if not stated.")),
    )


def intake(state: dict, *, llm, pack: Pack) -> dict:
    urgency_lines = "\n".join(f"- {k}: {u.label}" for k, u in pack.config.urgency_levels.items())
    machine_lines = "\n".join(f"- {m.machine_id}: {m.model} ({m.type}, {m.line})" for m in pack.machines)
    system = (
        f"You turn purchase requests from a {pack.config.name} floor into a structured need.\n\n"
        f"Urgency levels:\n{urgency_lines}\n\n"
        "A machine that has stopped or a line that is down means the most urgent level.\n\n"
        f"Machine registry:\n{machine_lines}"
    )
    result = _structured(llm, need_schema(pack)).invoke(
        [SystemMessage(system), HumanMessage(state["raw_request"])]
    )
    need = result.model_dump()
    need["qty"] = max(1, int(need["qty"]))
    need["search_terms"] = [t.strip() for t in need["search_terms"] if t.strip()][:6]
    return {"need": need}


# --- sourcing: resolve -> parallel inventory + supplier quotes -> merge ---------

def _match_score(item, terms: list[str]) -> int:
    haystack = [item.name.lower(), item.sku.lower(), *(k.lower() for k in item.keywords)]
    return sum(1 for term in (t.lower() for t in terms) for h in haystack if term in h or h in term)


def resolve_items(state: dict, *, pack: Pack) -> dict:
    """Find the catalog items that best match the need and fit the named machine."""
    need = state["need"]
    terms = need["search_terms"] or [need["item_need"]]
    machine = pack.machine(need["machine_id"]) if need.get("machine_id") else None
    scored = []
    for item in pack.catalog:
        if machine and item.compatible_models and machine.model not in item.compatible_models:
            continue
        if (s := _match_score(item, terms)) > 0:
            scored.append((s, item))
    best = max((s for s, _ in scored), default=0)
    candidates = [
        {"sku": i.sku, "name": i.name, "category": i.category, "unit": i.unit,
         "compatible_models": i.compatible_models}
        for s, i in scored if s == best
    ][:MAX_OPTION_ITEMS]
    return {
        "candidates": candidates,
        "inventory_hit": None,
        "quotes": None,  # clear any earlier round
        "sourcing": {"started": time.perf_counter()},
    }


def fan_out(state: dict, *, pack: Pack):
    """Conditional edge: one inventory check plus one quote request per supplier, all in parallel."""
    candidates = state["candidates"]
    if not candidates:
        return "propose"
    skus = [c["sku"] for c in candidates]
    qty = state["need"]["qty"]
    sends = [Send("check_inventory", {"candidates": candidates, "qty": qty})]
    for sup in pack.suppliers:
        if pack.config.policy.approved_suppliers_only and not sup.approved:
            continue
        carried = [sku for sku in skus if sku in sup.price_list]
        if carried:
            sends.append(Send("quote_supplier", {"supplier_id": sup.supplier_id, "skus": carried, "qty": qty}))
    return sends


def check_inventory(payload: dict, *, pack: Pack) -> dict:
    # Only a request that resolves to exactly one item can be filled from stock;
    # otherwise we'd be guessing which part the technician meant.
    if len(payload["candidates"]) != 1:
        return {}
    item = payload["candidates"][0]
    stock = pack.inventory.get(item["sku"])
    if stock is None or stock.on_hand < payload["qty"]:
        return {}
    return {"inventory_hit": {
        "sku": item["sku"], "name": item["name"], "qty": payload["qty"],
        "on_hand": stock.on_hand, "location": stock.location,
    }}


def quote_supplier(payload: dict, *, pack: Pack, latency: float) -> dict:
    """Ask one supplier for a quote. Simulated: price list lookup plus network-like latency."""
    started = time.perf_counter()
    time.sleep(latency)
    sup = pack.supplier(payload["supplier_id"])
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    quotes = []
    for sku in payload["skus"]:
        item, price = pack.item(sku), sup.price_list[sku]
        quotes.append({
            "sku": sku, "name": item.name, "category": item.category, "unit": item.unit,
            "compatible_models": item.compatible_models,
            "supplier_id": sup.supplier_id, "supplier_name": sup.name,
            "unit_price": price.unit_price, "lead_days": price.lead_days,
            "latency_ms": elapsed_ms,
        })
    return {"quotes": quotes}


def merge_quotes(state: dict) -> dict:
    quotes = state.get("quotes") or []
    per_supplier = {q["supplier_id"]: q["latency_ms"] for q in quotes}
    round_ms = round((time.perf_counter() - state["sourcing"]["started"]) * 1000)
    sourcing = {
        "suppliers_quoted": len(per_supplier),
        "round_ms": round_ms,
        "sequential_ms": sum(per_supplier.values()),
        "per_supplier_ms": per_supplier,
    }
    log.info("sourcing round: %d suppliers in %d ms (sequential would be ~%d ms)",
             sourcing["suppliers_quoted"], round_ms, sourcing["sequential_ms"])
    return {"sourcing": sourcing}


def after_merge(state: dict) -> str:
    return "reserve_from_storeroom" if state.get("inventory_hit") else "score_quotes"


def reserve_from_storeroom(state: dict, *, ledger) -> dict:
    hit = state["inventory_hit"]
    ledger.audit(state["request_id"], "reserve_from_storeroom", "reserved", actor="agent",
                 rationale=f"{hit['on_hand']} on hand at {hit['location']}", detail=hit)
    return {
        "proposal": None,
        "status": "reserved",
        "final_message": (
            f"In stock: {hit['qty']} x {hit['name']} reserved from {hit['location']} "
            f"({hit['on_hand']} on hand). Nothing to buy."
        ),
    }


def score_quotes(state: dict, *, scores) -> dict:
    """Attach each supplier's reliability (computed in code from order history) to its quotes."""
    supplier_scores = scores()
    ordered = sorted(state.get("quotes") or [], key=lambda q: (q["sku"], q["unit_price"], q["supplier_id"]))
    scored = []
    for n, q in enumerate(ordered, 1):
        r = supplier_scores[q["supplier_id"]]
        scored.append({
            "option_id": f"opt-{n}",
            **{k: v for k, v in q.items() if k != "latency_ms"},
            "reliability": {
                "score": r["score"], "on_time_rate": r["on_time_rate"],
                "avg_days_late": r["avg_days_late"], "defect_rate": r["defect_rate"],
                "orders": r["orders"], "low_confidence": r["low_confidence"],
            },
        })
    return {"scored_quotes": scored}


# --- propose ----------------------------------------------------------------

def choice_schema(option_ids: list[str]) -> type[BaseModel]:
    return create_model(
        "Choice",
        option_id=(Literal[tuple(option_ids)], Field(description="The option to buy.")),
        qty=(int, Field(description="How many units to buy.")),
        rationale=(str, Field(description="1 to 3 sentences on why this option, in plain words.")),
    )


def propose(state: dict, *, llm, pack: Pack, ledger) -> dict:
    need = state["need"]
    retrying = state.get("replan_count", 0) > 0
    quotes = state.get("eligible_quotes") if retrying else state.get("scored_quotes")
    quotes = quotes or []
    if not quotes:
        return {
            "proposal": None,
            "status": "no_match",
            "final_message": f"Nothing in stock and no approved supplier carries anything matching {need['item_need']!r}.",
        }

    machine = pack.machine(need["machine_id"]) if need.get("machine_id") else None
    urgency = pack.config.urgency_levels[need["urgency"]]
    context = {
        "need": need,
        "machine": machine.model_dump() if machine else None,
        "urgency": {"level": need["urgency"], **urgency.model_dump()},
        "options": quotes,
    }
    if retrying:
        context["previous_attempt"] = state.get("previous_attempt")
    system = (
        "You are the purchasing agent for a manufacturer. Pick the single best option for the need. "
        "Only pick a part that fits the named machine (compatible_models null means it fits anything). "
        "Weigh speed against price using the urgency weights. Each option carries the supplier's "
        "reliability score (0-100) and on-time rate, learned from this company's own order history: "
        "a late or defective delivery costs more than the price difference when a machine is stopped, "
        "so treat reliability as part of speed. If you pick a pricier option over a cheaper one, say "
        "why and cite both suppliers' on-time rates or scores. Keep qty as requested unless the unit "
        "makes that impossible. Explain the pick in 1 to 3 plain sentences."
    )
    if retrying:
        system += (
            " Your previous pick was blocked by company policy for the reasons in previous_attempt; "
            "the options left all pass those checks. Mention briefly why you switched."
        )
    choice = _structured(llm, choice_schema([q["option_id"] for q in quotes])).invoke(
        [SystemMessage(system), HumanMessage(json.dumps(context, indent=2))]
    )

    # Rebuild the proposal from catalog data. The model only chose an option id.
    picked = next(q for q in quotes if q["option_id"] == choice.option_id)
    qty = max(1, int(choice.qty))
    unit_price = pack.supplier(picked["supplier_id"]).price_list[picked["sku"]].unit_price
    proposal = {
        "supplier_id": picked["supplier_id"],
        "supplier_name": picked["supplier_name"],
        "sku": picked["sku"],
        "name": picked["name"],
        "qty": qty,
        "unit_price": unit_price,
        "total": round(unit_price * qty, 2),
        "lead_days": picked["lead_days"],
        "supplier_score": picked["reliability"]["score"],
        "rationale": choice.rationale.strip(),
    }
    ledger.audit(state["request_id"], "propose", "replanned" if retrying else "proposed", actor="agent",
                 rationale=proposal["rationale"],
                 detail={k: proposal[k] for k in ("supplier_id", "sku", "qty", "unit_price", "total", "supplier_score")})
    return {"proposal": proposal}


# --- the conscience: policy, approval, retry ---------------------------------

MAX_REPLANS = 1


def _check(proposal: dict, *, state: dict, pack: Pack, scores, ledger, supplier_scores: dict | None = None) -> dict:
    scope = pack.scope_key(state["need"].get("machine_id"))
    return check_policy(
        proposal, pack=pack, supplier_scores=supplier_scores if supplier_scores is not None else scores(),
        scope_key=scope, budget=ledger.budget(scope), spent=ledger.spent(scope),
    )


def policy_check(state: dict, *, pack: Pack, scores, ledger) -> dict:
    result = _check(state["proposal"], state=state, pack=pack, scores=scores, ledger=ledger)
    ledger.audit(state["request_id"], "policy_check", result["decision"], actor="policy",
                 rationale=" ".join(result["reasons"]) or None,
                 detail={k: result.get(k) for k in ("total", "budget_scope", "remaining", "approver_role")})
    return {"policy_result": result}


def after_propose(state: dict) -> str:
    return "policy_check" if state.get("proposal") else END


def after_policy(state: dict) -> str:
    decision = state["policy_result"]["decision"]
    if decision == "auto_approve":
        return "execute"
    if decision == "needs_approval":
        return "route_approver"
    return "replan" if state.get("replan_count", 0) < MAX_REPLANS else "explain_and_close"


def replan(state: dict, *, pack: Pack, scores, ledger) -> dict:
    """Keep only the options that would pass policy at the requested qty, then let the model pick again."""
    qty = state["need"]["qty"]
    supplier_scores = scores()
    eligible = [
        q for q in state.get("scored_quotes") or []
        if _check({"sku": q["sku"], "supplier_id": q["supplier_id"], "qty": qty}, state=state, pack=pack,
                  scores=scores, supplier_scores=supplier_scores, ledger=ledger)["decision"] != "blocked"
    ]
    blocked = state["proposal"]
    log.info("replan: %s from %s blocked; %d option(s) pass policy", blocked["sku"], blocked["supplier_id"], len(eligible))
    return {
        "replan_count": state.get("replan_count", 0) + 1,
        "eligible_quotes": eligible,
        "previous_attempt": {
            "proposal": {k: blocked[k] for k in ("sku", "supplier_id", "qty", "total")},
            "reasons": state["policy_result"]["reasons"],
        },
    }


def after_replan(state: dict) -> str:
    return "propose" if state.get("eligible_quotes") else "explain_and_close"


def explain_and_close(state: dict, *, ledger) -> dict:
    reasons = " ".join(state["policy_result"]["reasons"])
    tried = " I looked for another option within policy and none fits." if state.get("replan_count") else ""
    ledger.audit(state["request_id"], "explain_and_close", "not_purchased", actor="policy",
                 rationale=(reasons + tried).strip() or "No approver available.")
    return {
        "status": "blocked",
        "final_message": f"Not purchased. {reasons}{tried}",
    }


def route_approver(state: dict, *, pack: Pack, ledger) -> dict:
    """Find who signs off: the required role, or the next role up if nobody holds it."""
    roles = pack.approver_roles()
    required = state["policy_result"]["approver_role"]
    for role in roles[roles.index(required):]:
        people = ledger.members_with_role(role)
        if people:
            return {"approver_id": people[0]["user_id"], "approver_role": role}
    return {"approver_id": None, "approver_role": required}


def after_route(state: dict) -> str:
    return "await_approval" if state.get("approver_id") else "explain_and_close"


def await_approval(state: dict, *, ledger) -> dict:
    """Pause until the approver answers. Durable: the checkpointer holds the paused run."""
    answer = interrupt({
        "request_id": state["request_id"],
        "approver_id": state["approver_id"],
        "approver_role": state["approver_role"],
        "proposal": state["proposal"],
        "policy_result": state["policy_result"],
    })
    if not isinstance(answer, dict) or answer.get("approval") not in ("approved", "rejected"):
        raise ValueError(f"approval must be 'approved' or 'rejected', got {answer!r}")
    ledger.audit(state["request_id"], "await_approval", answer["approval"], actor=answer.get("decided_by"),
                 detail={"approver_role": state["approver_role"], "total": state["proposal"]["total"]})
    return {"approval": answer["approval"], "decided_by": answer.get("decided_by")}


def after_approval(state: dict) -> str:
    return "execute" if state["approval"] == "approved" else "close_rejected"


def close_rejected(state: dict) -> dict:
    return {"status": "rejected", "final_message": "Rejected by the approver. Nothing was purchased."}


def execute(state: dict, *, pack: Pack, scores, ledger, payments) -> dict:
    """The only node that moves money. Re-checks policy first: an approval can sit for hours."""
    rid = state["request_id"]
    recheck = _check(state["proposal"], state=state, pack=pack, scores=scores, ledger=ledger)
    if recheck["decision"] == "blocked":
        ledger.audit(rid, "execute", "blocked_at_execute", actor="policy", rationale=" ".join(recheck["reasons"]))
        return {
            "policy_result": recheck,
            "status": "blocked",
            "final_message": "Not purchased: policy changed while this waited. " + " ".join(recheck["reasons"]),
        }
    p = state["proposal"]
    try:
        payment = payments.create(p, amount=recheck["total"], idempotency_prefix=f"ck-{rid}",
                                  metadata={"request_id": rid, "approved_by": state.get("decided_by") or "policy"})
    except PaymentError as e:
        ledger.audit(rid, "execute", "payment_failed", actor="stripe", rationale=str(e))
        return {"status": "payment_failed",
                "final_message": f"Not purchased: the payment didn't go through ({e}). Nothing was charged."}

    ledger.audit(rid, "execute", "card_issued", actor="stripe", stripe_ref=payment["card_id"],
                 rationale=f"Single-use card ending {payment['last4']}, limit {payment['spending_limit']:.2f}",
                 detail={"provider": payment["provider"], "spending_limit": payment["spending_limit"]})
    approved = payment["status"] == "approved"
    ledger.audit(rid, "execute", "charge_approved" if approved else "charge_declined", actor="stripe",
                 stripe_ref=payment["authorization_id"], rationale=payment.get("decline_reason"),
                 detail={"amount": payment["amount"], "merchant": p["supplier_name"],
                         "transaction_id": payment.get("transaction_id")})
    if not approved:
        return {"payment": payment, "status": "payment_declined",
                "final_message": (f"Not purchased: the card issuer declined the supplier's charge "
                                  f"({payment.get('decline_reason') or 'no reason given'}).")}
    return {"payment": payment}


def after_execute(state: dict) -> str:
    payment = state.get("payment")
    return "confirm_and_log" if payment and payment["status"] == "approved" else END


def confirm_and_log(state: dict, *, pack: Pack, ledger) -> dict:
    """Write the purchase order into history. Its delivery, once received, moves the supplier's score."""
    p = state["proposal"]
    ordered_at = datetime.now(timezone.utc)
    recorded = ledger.record_order({
        "request_id": state["request_id"],
        "scope_key": pack.scope_key(state["need"].get("machine_id")),
        "supplier_id": p["supplier_id"],
        "sku": p["sku"],
        "machine_id": state["need"].get("machine_id"),
        "qty": p["qty"],
        "total": state["payment"]["amount"],
        "card_id": state["payment"]["card_id"],
        "ordered_at": ordered_at,
        "promised_at": ordered_at + timedelta(days=p["lead_days"]),
        "source": "cartkeeper",
    })
    if recorded:
        ledger.audit(state["request_id"], "confirm_and_log", "order_recorded", actor="agent",
                     stripe_ref=state["payment"]["card_id"],
                     detail={"supplier_id": p["supplier_id"], "sku": p["sku"], "qty": p["qty"],
                             "total": state["payment"]["amount"], "lead_days": p["lead_days"]})
    return {
        "status": "executed",
        "final_message": (
            f"Ordered {p['qty']} x {p['name']} from {p['supplier_name']} for ${state['payment']['amount']:,.2f}."
        ),
    }
