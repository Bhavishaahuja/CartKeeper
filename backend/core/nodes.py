"""Graph nodes.

The LLM reads the request and picks among options. Code finds the options and
builds the proposal from catalog data, so prices and SKUs in a proposal always
come from the pack, never from model output.
"""

from __future__ import annotations

import json
from typing import Literal, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field, create_model

from .packs import Pack

MAX_OPTION_ITEMS = 5


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


# --- find_options (Day 1 replaces this with parallel inventory + supplier quotes) ---

def _match_score(item, terms: list[str]) -> int:
    haystack = [item.name.lower(), item.sku.lower(), item.category.lower(), *(k.lower() for k in item.keywords)]
    score = 0
    for term in (t.lower() for t in terms):
        if any(term in h or h in term for h in haystack):
            score += 1
    return score


def find_options(state: dict, *, pack: Pack) -> dict:
    terms = state["need"]["search_terms"] or [state["need"]["item_need"]]
    ranked = sorted(
        ((s, i) for i in pack.catalog if (s := _match_score(i, terms)) > 0),
        key=lambda p: -p[0],
    )[:MAX_OPTION_ITEMS]

    quotes = []
    for _, item in ranked:
        for sup in pack.suppliers:
            if pack.config.policy.approved_suppliers_only and not sup.approved:
                continue
            price = sup.price_list.get(item.sku)
            if price is None:
                continue
            quotes.append({
                "option_id": f"opt-{len(quotes) + 1}",
                "sku": item.sku,
                "name": item.name,
                "category": item.category,
                "unit": item.unit,
                "compatible_models": item.compatible_models,
                "supplier_id": sup.supplier_id,
                "supplier_name": sup.name,
                "unit_price": price.unit_price,
                "lead_days": price.lead_days,
            })
    return {"quotes": quotes}


# --- propose ----------------------------------------------------------------

def choice_schema(option_ids: list[str]) -> type[BaseModel]:
    return create_model(
        "Choice",
        option_id=(Literal[tuple(option_ids)], Field(description="The option to buy.")),
        qty=(int, Field(description="How many units to buy.")),
        rationale=(str, Field(description="1 to 3 sentences on why this option, in plain words.")),
    )


def propose(state: dict, *, llm, pack: Pack) -> dict:
    need, quotes = state["need"], state.get("quotes") or []
    if not quotes:
        return {
            "proposal": None,
            "final_message": f"No approved supplier carries anything matching {need['item_need']!r}.",
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
        "Weigh speed against price using the urgency weights. Keep qty as requested unless the unit "
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
        "rationale": choice.rationale.strip(),
    }
    return {"proposal": proposal}
