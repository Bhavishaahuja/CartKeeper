"""Graph nodes.

The LLM reads the request and picks among options. Code finds the options and
builds the proposal from catalog data, so prices and SKUs in a proposal always
come from the pack, never from model output.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Literal, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.types import Send
from pydantic import BaseModel, Field, create_model

from .packs import Pack

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


def reserve_from_storeroom(state: dict) -> dict:
    hit = state["inventory_hit"]
    return {
        "proposal": None,
        "final_message": (
            f"In stock: {hit['qty']} x {hit['name']} reserved from {hit['location']} "
            f"({hit['on_hand']} on hand). Nothing to buy."
        ),
    }


def score_quotes(state: dict, *, supplier_scores: dict[str, dict]) -> dict:
    """Attach each supplier's reliability (computed in code from order history) to its quotes."""
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


def propose(state: dict, *, llm, pack: Pack) -> dict:
    need, quotes = state["need"], state.get("scored_quotes") or []
    if not quotes:
        return {
            "proposal": None,
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
    return {"proposal": proposal}
