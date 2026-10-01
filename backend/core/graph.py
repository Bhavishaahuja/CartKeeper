"""Cartkeeper purchase graph.

intake -> resolve_items -> [check_inventory + quote_supplier x N, in parallel]
       -> merge_quotes -> reserve_from_storeroom                      (in stock: nothing to buy)
                       -> score_quotes -> propose -> policy_check
            auto_approve   -> execute -> confirm_and_log
            needs_approval -> route_approver -> await_approval (durable pause)
                                approved -> execute -> confirm_and_log
                                rejected -> close_rejected
            blocked        -> replan (once) -> propose
                              nothing fits / retry used -> explain_and_close

CLI:  python -m backend.core.graph "loom L-07 heald wires snapped"
"""

from __future__ import annotations

import json
import logging
import sys
import uuid
from functools import partial

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from . import nodes
from .history import aggregate, seed_rows
from .packs import Pack, load_pack
from .payments import StubPayments
from .score import score_suppliers
from .state import PurchaseState
from .store import InMemoryStore

DEFAULT_PACK = "manufacturing_textile"
QUOTE_LATENCY = 0.4  # seconds per simulated supplier quote

log = logging.getLogger("cartkeeper")


def supplier_scores_from_seed(pack: Pack) -> dict[str, dict]:
    return score_suppliers(
        aggregate(seed_rows(pack)),
        pack.config.scoring_weights.model_dump(),
        supplier_ids=[s.supplier_id for s in pack.suppliers],
    )


def build_graph(pack: Pack, llm, *, store=None, payments=None, checkpointer=None,
                supplier_scores: dict[str, dict] | None = None, quote_latency: float = QUOTE_LATENCY):
    store = store if store is not None else InMemoryStore.from_demo(pack)
    payments = payments if payments is not None else StubPayments()
    checkpointer = checkpointer if checkpointer is not None else InMemorySaver()
    if supplier_scores is None:
        supplier_scores = supplier_scores_from_seed(pack)
    gate = {"pack": pack, "supplier_scores": supplier_scores, "ledger": store}

    g = StateGraph(PurchaseState)
    g.add_node("intake", partial(nodes.intake, llm=llm, pack=pack))
    g.add_node("resolve_items", partial(nodes.resolve_items, pack=pack))
    g.add_node("check_inventory", partial(nodes.check_inventory, pack=pack))
    g.add_node("quote_supplier", partial(nodes.quote_supplier, pack=pack, latency=quote_latency))
    g.add_node("merge_quotes", nodes.merge_quotes)
    g.add_node("reserve_from_storeroom", nodes.reserve_from_storeroom)
    g.add_node("score_quotes", partial(nodes.score_quotes, supplier_scores=supplier_scores))
    g.add_node("propose", partial(nodes.propose, llm=llm, pack=pack))
    g.add_node("policy_check", partial(nodes.policy_check, **gate))
    g.add_node("replan", partial(nodes.replan, **gate))
    g.add_node("explain_and_close", nodes.explain_and_close)
    g.add_node("route_approver", partial(nodes.route_approver, pack=pack, ledger=store))
    g.add_node("await_approval", nodes.await_approval)
    g.add_node("close_rejected", nodes.close_rejected)
    g.add_node("execute", partial(nodes.execute, payments=payments, **gate))
    g.add_node("confirm_and_log", partial(nodes.confirm_and_log, pack=pack, ledger=store))

    g.add_edge(START, "intake")
    g.add_edge("intake", "resolve_items")
    g.add_conditional_edges("resolve_items", partial(nodes.fan_out, pack=pack),
                            ["check_inventory", "quote_supplier", "propose"])
    g.add_edge("check_inventory", "merge_quotes")
    g.add_edge("quote_supplier", "merge_quotes")
    g.add_conditional_edges("merge_quotes", nodes.after_merge, ["reserve_from_storeroom", "score_quotes"])
    g.add_edge("reserve_from_storeroom", END)
    g.add_edge("score_quotes", "propose")
    g.add_conditional_edges("propose", nodes.after_propose, ["policy_check", END])
    g.add_conditional_edges("policy_check", nodes.after_policy,
                            ["execute", "route_approver", "replan", "explain_and_close"])
    g.add_conditional_edges("replan", nodes.after_replan, ["propose", "explain_and_close"])
    g.add_edge("explain_and_close", END)
    g.add_conditional_edges("route_approver", nodes.after_route, ["await_approval", "explain_and_close"])
    g.add_conditional_edges("await_approval", nodes.after_approval, ["execute", "close_rejected"])
    g.add_edge("close_rejected", END)
    g.add_conditional_edges("execute", nodes.after_execute, ["confirm_and_log", END])
    g.add_edge("confirm_and_log", END)
    return g.compile(checkpointer=checkpointer)


# --- running requests (shared by the API, the CLI and tests) -------------------

def _config(request_id: str) -> dict:
    return {"configurable": {"thread_id": request_id}}


def snapshot(graph, request_id: str) -> dict | None:
    """Current view of a request, or None if the checkpointer has never seen it."""
    state = graph.get_state(_config(request_id))
    if not state.values:
        return None
    values = dict(state.values)
    pending = [i.value for i in state.interrupts]
    if pending:
        status = "awaiting_approval"
    elif state.next:
        status = "running"
    else:
        status = values.get("status", "unknown")
    return {"status": status, "pending_approval": pending[0] if pending else None, "state": values}


def start(graph, raw_request: str, *, requester_id: str | None = None, request_id: str | None = None) -> dict:
    """Run a new request until it finishes or pauses for approval."""
    request_id = request_id or str(uuid.uuid4())
    graph.invoke(
        {"request_id": request_id, "requester_id": requester_id, "raw_request": raw_request, "replan_count": 0},
        _config(request_id),
    )
    return {"request_id": request_id, **snapshot(graph, request_id)}


def decide(graph, request_id: str, *, approval: str, decided_by: str) -> dict:
    """Resume a paused request with the approver's answer."""
    graph.invoke(Command(resume={"approval": approval, "decided_by": decided_by}), _config(request_id))
    return {"request_id": request_id, **snapshot(graph, request_id)}


def run(raw_request: str, *, pack: Pack, llm, **graph_kwargs) -> dict:
    """Run one request and return its final state values (paused requests return as-is)."""
    graph = build_graph(pack, llm, **graph_kwargs)
    return start(graph, raw_request)["state"]


# --- CLI -----------------------------------------------------------------------

def _summary(view: dict) -> dict:
    s = view["state"]
    out = {
        "request_id": view["request_id"],
        "status": view["status"],
        "need": s.get("need"),
        "inventory_hit": s.get("inventory_hit"),
        "sourcing": {k: v for k, v in (s.get("sourcing") or {}).items() if k != "started"},
        "options": [
            {k: q[k] for k in ("option_id", "sku", "supplier_name", "unit_price", "lead_days", "reliability")}
            for q in s.get("scored_quotes") or []
        ],
        "proposal": s.get("proposal"),
        "policy_result": s.get("policy_result"),
        "payment": s.get("payment"),
    }
    if s.get("final_message"):
        out["message"] = s["final_message"]
    return out


def main(argv: list[str]) -> int:
    from dotenv import load_dotenv

    from .llm import make_llm

    if len(argv) != 1 or not argv[0].strip():
        print('usage: python -m backend.core.graph "<purchase request>"', file=sys.stderr)
        return 2
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    pack = load_pack(DEFAULT_PACK)
    store = InMemoryStore.from_demo(pack)
    graph = build_graph(pack, make_llm(), store=store)
    view = start(graph, argv[0], requester_id="u-tech-1")
    print(json.dumps(_summary(view), indent=2, default=str))

    if view["status"] == "awaiting_approval" and sys.stdin.isatty():
        pending = view["pending_approval"]
        who = store.member(pending["approver_id"])["name"]
        answer = input(f"\nApprove as {who}? [y/N] ").strip().lower()
        view = decide(graph, view["request_id"], approval="approved" if answer == "y" else "rejected",
                      decided_by=pending["approver_id"])
        print(json.dumps({"status": view["status"], "payment": view["state"].get("payment"),
                          "message": view["state"].get("final_message")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
