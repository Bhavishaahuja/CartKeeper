"""T5: a request paused for approval survives a backend restart.

Needs Postgres: set CARTKEEPER_TEST_DATABASE_URL.
"""

import json
import os

import pytest

from backend.core.checkpoint import make_checkpointer
from backend.core.graph import build_graph, decide, snapshot, start, supplier_scores_from_seed
from backend.core.packs import load_pack
from backend.core.payments import StubPayments
from backend.core.store import InMemoryStore

from .fakes import FakeLLM

DSN = os.environ.get("CARTKEEPER_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="CARTKEEPER_TEST_DATABASE_URL not set")

MOTOR = {"item_need": "drive motor", "search_terms": ["drive motor"],
         "machine_id": "L-03", "urgency": "line_down", "qty": 1}


def llm():
    def choice(schema, messages):
        options = json.loads(messages[-1].content)["options"]
        best = max(options, key=lambda o: o["reliability"]["score"])
        return {"option_id": best["option_id"], "qty": 1, "rationale": "reliable"}
    return FakeLLM({"Need": lambda *_: MOTOR, "Choice": choice})


def test_t5_paused_request_survives_restart():
    pack = load_pack("manufacturing_textile")
    scores = supplier_scores_from_seed(pack)
    store, payments = InMemoryStore.from_demo(pack), StubPayments()

    # Process 1: start the request; it pauses for the maintenance manager.
    saver, close = make_checkpointer(DSN)
    g1 = build_graph(pack, llm(), store=store, payments=payments, checkpointer=saver,
                     supplier_scores=scores, quote_latency=0)
    view = start(g1, "Replace drive motor on loom L-03")
    request_id = view["request_id"]
    assert view["status"] == "awaiting_approval"
    close()                                              # "server stops"
    del g1, saver

    # Process 2: brand-new graph and connection pool, nothing shared in memory but the store.
    saver2, close2 = make_checkpointer(DSN)
    try:
        g2 = build_graph(pack, llm(), store=store, payments=payments, checkpointer=saver2,
                         supplier_scores=scores, quote_latency=0)
        restored = snapshot(g2, request_id)
        assert restored["status"] == "awaiting_approval"
        assert restored["pending_approval"]["proposal"]["total"] == 890.0

        view = decide(g2, request_id, approval="approved", decided_by="u-mm-1")
        assert view["status"] == "executed"
        assert len(payments.payments) == 1
    finally:
        close2()


def test_unknown_request_has_no_snapshot():
    pack = load_pack("manufacturing_textile")
    saver, close = make_checkpointer(DSN)
    try:
        g = build_graph(pack, llm(), checkpointer=saver, supplier_scores={}, quote_latency=0)
        assert snapshot(g, "does-not-exist") is None
    finally:
        close()
