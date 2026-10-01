"""Cartkeeper purchase graph.

intake -> resolve_items -> [check_inventory + quote_supplier x N, in parallel]
       -> merge_quotes -> reserve_from_storeroom  (item in stock: nothing to buy)
                       -> score_quotes -> propose

CLI:  python -m backend.core.graph "loom L-07 heald wires snapped"
"""

from __future__ import annotations

import json
import logging
import sys
import uuid
from functools import partial

from langgraph.graph import END, START, StateGraph

from . import nodes
from .history import aggregate, seed_rows
from .packs import Pack, load_pack
from .score import score_suppliers
from .state import PurchaseState

DEFAULT_PACK = "manufacturing_textile"
QUOTE_LATENCY = 0.4  # seconds per simulated supplier quote


def supplier_scores_from_seed(pack: Pack) -> dict[str, dict]:
    return score_suppliers(
        aggregate(seed_rows(pack)),
        pack.config.scoring_weights.model_dump(),
        supplier_ids=[s.supplier_id for s in pack.suppliers],
    )


def build_graph(pack: Pack, llm, *, supplier_scores: dict[str, dict] | None = None,
                quote_latency: float = QUOTE_LATENCY):
    if supplier_scores is None:
        supplier_scores = supplier_scores_from_seed(pack)
    g = StateGraph(PurchaseState)
    g.add_node("intake", partial(nodes.intake, llm=llm, pack=pack))
    g.add_node("resolve_items", partial(nodes.resolve_items, pack=pack))
    g.add_node("check_inventory", partial(nodes.check_inventory, pack=pack))
    g.add_node("quote_supplier", partial(nodes.quote_supplier, pack=pack, latency=quote_latency))
    g.add_node("merge_quotes", nodes.merge_quotes)
    g.add_node("reserve_from_storeroom", nodes.reserve_from_storeroom)
    g.add_node("score_quotes", partial(nodes.score_quotes, supplier_scores=supplier_scores))
    g.add_node("propose", partial(nodes.propose, llm=llm, pack=pack))

    g.add_edge(START, "intake")
    g.add_edge("intake", "resolve_items")
    g.add_conditional_edges("resolve_items", partial(nodes.fan_out, pack=pack),
                            ["check_inventory", "quote_supplier", "propose"])
    g.add_edge("check_inventory", "merge_quotes")
    g.add_edge("quote_supplier", "merge_quotes")
    g.add_conditional_edges("merge_quotes", nodes.after_merge,
                            ["reserve_from_storeroom", "score_quotes"])
    g.add_edge("reserve_from_storeroom", END)
    g.add_edge("score_quotes", "propose")
    g.add_edge("propose", END)
    return g.compile()


def run(raw_request: str, *, pack: Pack, llm, **graph_kwargs) -> dict:
    graph = build_graph(pack, llm, **graph_kwargs)
    return graph.invoke({
        "request_id": str(uuid.uuid4()),
        "raw_request": raw_request,
        "replan_count": 0,
    })


def main(argv: list[str]) -> int:
    from dotenv import load_dotenv

    from .llm import make_llm

    if len(argv) != 1 or not argv[0].strip():
        print('usage: python -m backend.core.graph "<purchase request>"', file=sys.stderr)
        return 2
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    pack = load_pack(DEFAULT_PACK)
    result = run(argv[0], pack=pack, llm=make_llm())
    out = {
        "need": result.get("need"),
        "inventory_hit": result.get("inventory_hit"),
        "sourcing": {k: v for k, v in (result.get("sourcing") or {}).items() if k != "started"},
        "options": [
            {k: q[k] for k in ("option_id", "sku", "supplier_name", "unit_price", "lead_days", "reliability")}
            for q in result.get("scored_quotes") or []
        ],
        "proposal": result.get("proposal"),
    }
    if result.get("final_message"):
        out["message"] = result["final_message"]
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
