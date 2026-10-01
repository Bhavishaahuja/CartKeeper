"""Cartkeeper purchase graph.

Day 0: intake -> find_options -> propose.

CLI:  python -m backend.core.graph "loom L-07 heald wires snapped"
"""

from __future__ import annotations

import json
import sys
import uuid
from functools import partial

from langgraph.graph import END, START, StateGraph

from . import nodes
from .packs import Pack, load_pack
from .state import PurchaseState

DEFAULT_PACK = "manufacturing_textile"


def build_graph(pack: Pack, llm):
    g = StateGraph(PurchaseState)
    g.add_node("intake", partial(nodes.intake, llm=llm, pack=pack))
    g.add_node("find_options", partial(nodes.find_options, pack=pack))
    g.add_node("propose", partial(nodes.propose, llm=llm, pack=pack))
    g.add_edge(START, "intake")
    g.add_edge("intake", "find_options")
    g.add_edge("find_options", "propose")
    g.add_edge("propose", END)
    return g.compile()


def run(raw_request: str, *, pack: Pack, llm) -> dict:
    graph = build_graph(pack, llm)
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
    pack = load_pack(DEFAULT_PACK)
    result = run(argv[0], pack=pack, llm=make_llm())
    out = {
        "need": result.get("need"),
        "options_considered": len(result.get("quotes") or []),
        "proposal": result.get("proposal"),
    }
    if result.get("final_message"):
        out["message"] = result["final_message"]
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
