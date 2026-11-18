"""Run the shared behavior scenarios through the Python LangGraph backend.

Run from the repo root:  python mastra/scripts/export_behavior.py

Reads mastra/test/fixtures/scenarios.json, writes mastra/test/fixtures/behavior.json.
The TS workflow must produce the same outcome for every scenario.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from backend.core.graph import build_graph, decide, start, supplier_scores_from_seed  # noqa: E402
from backend.core.packs import load_pack  # noqa: E402
from backend.core.payments import StubPayments  # noqa: E402
from backend.core.store import InMemoryStore  # noqa: E402
from fakes import FakeLLM  # noqa: E402

FIXTURES = ROOT / "mastra" / "test" / "fixtures"


def pick(rule: str, options: list[dict]) -> dict:
    if rule == "first":
        return options[0]
    if rule == "most_reliable":
        return max(options, key=lambda o: (o["reliability"]["score"], -o["unit_price"]))
    if rule == "cheapest":
        return min(options, key=lambda o: (o["unit_price"], o["option_id"]))
    return next(o for o in options if o["supplier_id"] == rule)


def project(view: dict, llm: FakeLLM, store: InMemoryStore, payments: StubPayments) -> dict:
    s = view["state"]
    return {
        "status": view["status"],
        "need": s.get("need"),
        "candidates": [c["sku"] for c in s.get("candidates") or []],
        "inventory_hit": s.get("inventory_hit"),
        "options": [
            {k: q[k] for k in ("option_id", "sku", "supplier_id", "unit_price", "lead_days", "reliability")}
            for q in s.get("scored_quotes") or []
        ],
        "proposal": s.get("proposal"),
        "policy_result": s.get("policy_result"),
        "previous_attempt": s.get("previous_attempt"),
        "eligible": [q["supplier_id"] for q in s.get("eligible_quotes") or []],
        "replan_count": s.get("replan_count", 0),
        "approver_id": (view.get("pending_approval") or {}).get("approver_id") or s.get("approver_id"),
        "approver_role": (view.get("pending_approval") or {}).get("approver_role") or s.get("approver_role"),
        "decided_by": s.get("decided_by"),
        "paid": (s.get("payment") or {}).get("amount"),
        "message": s.get("final_message"),
        "model_calls": [name for name, _ in llm.calls],
        "payments": len(payments.payments),
        "orders": [{"scope_key": o["scope_key"], "total": o["total"]} for o in store.orders if o["request_id"] == "req-1"],
    }


def run(sc: dict, pack, scores) -> dict:
    rounds = {"n": 0}

    def choice(schema, messages):
        i = rounds["n"]
        rounds["n"] += 1
        options = json.loads(messages[-1].content)["options"]
        qty = (sc.get("qtys") or [])[i] if i < len(sc.get("qtys") or []) else sc["need"]["qty"]
        return {"option_id": pick(sc["picks"][i], options)["option_id"], "qty": qty, "rationale": "scenario pick"}

    llm = FakeLLM({"Need": lambda *_: sc["need"], "Choice": choice})
    store, payments = InMemoryStore.from_demo(pack), StubPayments()
    store.budgets.update(sc.get("budgets") or {})
    store.members = [m for m in store.members if m["role"] not in set(sc.get("remove_roles") or [])]
    for i, o in enumerate(sc.get("pre_orders") or []):
        store.record_order({"request_id": f"pre-{i}", **o})
    graph = build_graph(pack, llm, store=store, payments=payments, supplier_scores=scores, quote_latency=0)
    view = start(graph, sc["raw_request"], requester_id="u-tech-1", request_id="req-1")
    paused = {"status": view["status"], "approver_id": (view.get("pending_approval") or {}).get("approver_id")}
    if sc.get("decision"):
        assert view["status"] == "awaiting_approval", (sc["id"], view["status"])
        for i, o in enumerate(sc.get("orders_while_waiting") or []):
            store.record_order({"request_id": f"meanwhile-{i}", **o})
        view = decide(graph, "req-1", **sc["decision"])
    return {"paused": paused, **project(view, llm, store, payments)}


def main() -> None:
    pack = load_pack("manufacturing_textile")
    scores = supplier_scores_from_seed(pack)
    scenarios = json.loads((FIXTURES / "scenarios.json").read_text())["scenarios"]
    out = {sc["id"]: run(sc, pack, scores) for sc in scenarios}
    (FIXTURES / "behavior.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    for k, v in out.items():
        print(f"{k:28} {v['status']:18} {v['message'] or ''}"[:150])


if __name__ == "__main__":
    main()
