"""PostgresStore + db setup against a real Postgres. Set CARTKEEPER_TEST_DATABASE_URL to run."""

import os
import uuid
from datetime import timedelta

import pytest

from backend.core.graph import build_graph, decide, start
from backend.core.history import aggregate, seed_rows
from backend.core.packs import load_pack
from backend.core.payments import StubPayments
from backend.core.store import PostgresStore, demo_company_id

from .test_conscience import HEALD, MOTOR, make_llm

DSN = os.environ.get("CARTKEEPER_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="CARTKEEPER_TEST_DATABASE_URL not set")


@pytest.fixture(scope="module")
def pack():
    return load_pack("manufacturing_textile")


@pytest.fixture(scope="module")
def pool(pack):
    """A throwaway schema, set up twice to prove setup is idempotent."""
    import psycopg
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool

    from backend.core.db import setup

    schema = f"t_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(DSN, autocommit=True) as c:
        c.execute(f"create schema {schema}")
    p = ConnectionPool(DSN, min_size=1, max_size=4, open=True, kwargs={
        "autocommit": True, "prepare_threshold": 0, "row_factory": dict_row,
        "options": f"-c search_path={schema}"})
    setup(p, pack)
    setup(p, pack)
    yield p
    p.close()
    with psycopg.connect(DSN, autocommit=True) as c:
        c.execute(f"drop schema {schema} cascade")


@pytest.fixture
def store(pool, pack):
    s = PostgresStore(pool, demo_company_id(pack))
    yield s
    with pool.connection() as conn:     # each test starts with only the seed history
        conn.execute("delete from purchase_orders where source = 'cartkeeper'")
        conn.execute("delete from audit_log")
        conn.execute("delete from requests")


def test_setup_seeds_the_demo_company_once(store, pack):
    with store.pool.connection() as conn:
        n = conn.execute("select count(*) as n from purchase_orders where source = 'seed'").fetchone()["n"]
        assert n == len(seed_rows(pack))
        assert conn.execute("select count(*) as n from companies").fetchone()["n"] == 1
    assert store.budget("line_2") == 3000
    assert store.budget("nope") is None
    assert store.member("u-mm-1")["role"] == "maintenance_manager"
    assert [m["user_id"] for m in store.members_with_role("owner")] == ["u-owner-1"]
    assert store.spent("line_2") == 0                     # seed history doesn't eat this month's budget


def test_supplier_stats_come_from_the_view(store, pack):
    assert store.supplier_stats() == aggregate(seed_rows(pack))


def test_t2_end_to_end_on_postgres(store, pack):
    payments = StubPayments()
    graph = build_graph(pack, make_llm(HEALD), store=store, payments=payments, quote_latency=0)
    view = start(graph, "Loom L-07 heald wires snapped, need 500 today", requester_id="u-tech-1")
    assert view["status"] == "executed"
    rid = view["request_id"]
    assert store.spent("line_2") == 95.0

    order = store.order(rid)
    assert order["card_id"] == view["state"]["payment"]["card_id"] and order["delivered_at"] is None
    assert not store.record_order({**order, "total": 1})  # once per request

    rows = store.audit_rows(rid)
    assert [r["action"] for r in rows] == [
        "proposed", "auto_approve", "card_issued", "charge_approved", "order_recorded"]
    assert rows[2]["stripe_ref"] == order["card_id"]
    assert rows[-1]["detail"]["sku"] == order["sku"]

    # Received late and defective: the next run sees a lower score for that supplier.
    sup = order["supplier_id"]
    before = next(q["reliability"] for q in view["state"]["scored_quotes"] if q["supplier_id"] == sup)
    store.record_delivery(rid, delivered_at=order["promised_at"] + timedelta(days=6), defect=True)
    again = start(graph, "heald wires again")
    after = next(q["reliability"] for q in again["state"]["scored_quotes"] if q["supplier_id"] == sup)
    assert after["orders"] == before["orders"] + 1 and after["score"] < before["score"]


def test_approval_flow_and_request_index(store, pack):
    graph = build_graph(pack, make_llm(MOTOR), store=store, payments=StubPayments(), quote_latency=0)
    view = start(graph, "Replace drive motor on loom L-03", requester_id="u-tech-1")
    rid = view["request_id"]
    store.upsert_request(rid, status=view["status"], requester_id="u-tech-1", approver_id="u-mm-1",
                         raw_request="Replace drive motor on loom L-03", total=890.0)
    assert [r["request_id"] for r in store.list_requests(status="awaiting_approval", approver_id="u-mm-1")] == [rid]

    decide(graph, rid, approval="approved", decided_by="u-mm-1")
    row = store.upsert_request(rid, status="executed", approver_id=None)
    assert row["status"] == "executed" and row["raw_request"].startswith("Replace")
    assert store.list_requests(status="awaiting_approval") == []
    assert [r["actor"] for r in store.audit_rows(rid) if r["action"] == "approved"] == ["u-mm-1"]
    with pytest.raises(ValueError):
        store.list_requests(**{"1=1; drop table requests; --": "x"})


def test_api_boots_on_postgres(pack, monkeypatch):
    """DATABASE_URL set: the API applies the schema, seeds, and serves from Postgres."""
    from fastapi.testclient import TestClient

    from backend.main import create_app

    from .test_api import OWNER, TECH, fake_llm

    monkeypatch.setenv("DATABASE_URL", DSN)
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    with TestClient(create_app(pack=pack, llm=fake_llm(), quote_latency=0)) as client:
        assert isinstance(client.app.state.store, PostgresStore)
        body = client.post("/requests", json={"raw_request": "heald wires L-07"}, headers=TECH).json()
        assert body["status"] == "executed"
        audit = client.get(f"/requests/{body['request_id']}/audit", headers=OWNER).json()
        assert audit[-1]["action"] == "order_recorded"
        assert client.get("/suppliers/scorecard", headers=OWNER).json()[0]["orders"] > 0
