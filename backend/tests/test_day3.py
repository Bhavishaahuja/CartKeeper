"""Day 3: cards and charges in the flow, audit trail, PO write-back, live supplier scores."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from backend.core.graph import build_graph, decide, start
from backend.core.packs import load_pack
from backend.core.payments import PaymentError, StubPayments
from backend.core.store import InMemoryStore
from backend.main import create_app

from .test_api import MANAGER, OWNER, TECH, FINANCE, fake_llm
from .test_conscience import HEALD, MOTOR, make_llm


@pytest.fixture(scope="module")
def pack():
    return load_pack("manufacturing_textile")


@pytest.fixture
def store(pack):
    return InMemoryStore.from_demo(pack)


def actions(store, request_id):
    return [r["action"] for r in store.audit_rows(request_id)]


# --- graph ---------------------------------------------------------------------

def test_t2_pays_with_a_capped_single_use_card(pack, store):
    payments = StubPayments()
    graph = build_graph(pack, make_llm(HEALD), store=store, payments=payments, quote_latency=0)
    view = start(graph, "Loom L-07 heald wires snapped, need 500 today", requester_id="u-tech-1")
    assert view["status"] == "executed"
    pay = view["state"]["payment"]
    assert pay["status"] == "approved" and pay["amount"] == pay["spending_limit"] == 95.0
    assert payments.cards[pay["card_id"]]["metadata"]["request_id"] == view["request_id"]

    order = store.order(view["request_id"])
    assert order["card_id"] == pay["card_id"] and order["source"] == "cartkeeper"
    assert order["promised_at"] - order["ordered_at"] == timedelta(days=view["state"]["proposal"]["lead_days"])
    assert order["delivered_at"] is None

    assert actions(store, view["request_id"]) == [
        "proposed", "auto_approve", "card_issued", "charge_approved", "order_recorded"]
    issued = store.audit_rows(view["request_id"])[2]
    assert issued["stripe_ref"] == pay["card_id"] and issued["actor"] == "stripe"


def test_approval_is_in_the_audit_trail(pack, store):
    graph = build_graph(pack, make_llm(MOTOR), store=store, payments=StubPayments(), quote_latency=0)
    rid = start(graph, "Replace drive motor on loom L-03")["request_id"]
    decide(graph, rid, approval="approved", decided_by="u-mm-1")
    rows = store.audit_rows(rid)
    assert [r["action"] for r in rows] == [
        "proposed", "needs_approval", "approved", "card_issued", "charge_approved", "order_recorded"]
    assert rows[2]["actor"] == "u-mm-1"


class DecliningPayments(StubPayments):
    def create(self, proposal, *, amount, idempotency_prefix, metadata=None):
        p = super().create(proposal, amount=amount, idempotency_prefix=idempotency_prefix, metadata=metadata)
        return {**p, "status": "declined", "decline_reason": "insufficient_funds"}


class BrokenPayments(StubPayments):
    def create(self, *a, **kw):
        raise PaymentError("Stripe: network down")


def test_declined_charge_records_no_order(pack, store):
    graph = build_graph(pack, make_llm(HEALD), store=store, payments=DecliningPayments(), quote_latency=0)
    view = start(graph, "heald wires")
    assert view["status"] == "payment_declined"
    assert "insufficient_funds" in view["state"]["final_message"]
    assert store.orders == [] and store.spent("line_2") == 0
    assert actions(store, view["request_id"])[-1] == "charge_declined"


def test_payment_error_is_reported_and_records_no_order(pack, store):
    graph = build_graph(pack, make_llm(HEALD), store=store, payments=BrokenPayments(), quote_latency=0)
    view = start(graph, "heald wires")
    assert view["status"] == "payment_failed"
    assert "network down" in view["state"]["final_message"]
    assert store.orders == []


def test_storeroom_and_blocked_are_audited_too(pack, store):
    bearings = {"item_need": "6205 bearings", "search_terms": ["6205 bearing"],
                "machine_id": "S-04", "urgency": "line_down", "qty": 2}
    g = build_graph(pack, make_llm(bearings), store=store, quote_latency=0)
    assert actions(store, start(g, "bearings")["request_id"]) == ["reserved"]

    store.record_order({"request_id": "earlier", "scope_key": "line_2", "total": 2500.0})
    g = build_graph(pack, make_llm(MOTOR), store=store, quote_latency=0)
    assert actions(store, start(g, "motor")["request_id"]) == ["proposed", "blocked", "not_purchased"]


def test_executed_purchase_moves_the_supplier_score_on_the_next_run(pack, store):
    graph = build_graph(pack, make_llm(HEALD), store=store, payments=StubPayments(), quote_latency=0)
    first = start(graph, "heald wires")
    sup = first["state"]["proposal"]["supplier_id"]
    before = next(q["reliability"] for q in first["state"]["scored_quotes"] if q["supplier_id"] == sup)

    order = store.order(first["request_id"])
    store.record_delivery(first["request_id"], delivered_at=order["promised_at"] + timedelta(days=6), defect=True)

    second = start(graph, "heald wires again")
    after = next(q["reliability"] for q in second["state"]["scored_quotes"] if q["supplier_id"] == sup)
    assert after["orders"] == before["orders"] + 1
    assert after["score"] < before["score"]
    assert after["defect_rate"] > before["defect_rate"]


# --- API ------------------------------------------------------------------------

@pytest.fixture
def api(pack):
    store, payments = InMemoryStore.from_demo(pack), StubPayments()
    app = create_app(pack=pack, llm=fake_llm(), store=store, payments=payments,
                     checkpointer=InMemorySaver(), quote_latency=0)
    with TestClient(app) as client:
        yield client, store, payments


def test_t7_supplier_overcharge_is_declined_by_the_card(api):
    client, store, payments = api
    body = client.post("/requests", json={"raw_request": "heald wires L-07"}, headers=TECH).json()
    rid, limit = body["request_id"], body["payment"]["spending_limit"]

    assert client.post(f"/requests/{rid}/supplier-charge", json={"amount": 120},
                       headers=TECH).status_code == 403
    r = client.post(f"/requests/{rid}/supplier-charge", json={"amount": limit + 25}, headers=OWNER)
    assert r.status_code == 200
    assert r.json()["approved"] is False and r.json()["decline_reason"] == "spending_controls"
    r = client.post(f"/requests/{rid}/supplier-charge", json={"amount": 1}, headers=FINANCE)
    assert r.json()["approved"] is False                 # single use: the limit is already spent
    assert len(payments.charges) == 3
    assert actions(store, rid)[-2:] == ["test_charge_declined", "test_charge_declined"]


def test_supplier_charge_needs_a_card(api):
    client, *_ = api
    rid = client.post("/requests", json={"raw_request": "drive motor L-03"}, headers=TECH).json()["request_id"]
    assert client.post(f"/requests/{rid}/supplier-charge", json={"amount": 5},
                       headers=OWNER).status_code == 409


def test_t8_double_approve_means_one_card_one_charge(api):
    client, _, payments = api
    rid = client.post("/requests", json={"raw_request": "drive motor L-03"}, headers=TECH).json()["request_id"]
    codes = [client.post(f"/requests/{rid}/decision", json={"approval": "approved"}, headers=MANAGER).status_code
             for _ in range(2)]
    assert codes == [200, 409]
    assert len(payments.cards) == 1 and len(payments.charges) == 1


def test_receipt_updates_the_scorecard(api):
    client, store, _ = api
    body = client.post("/requests", json={"raw_request": "heald wires L-07"}, headers=TECH).json()
    rid, sup = body["request_id"], body["proposal"]["supplier_id"]
    before = next(r for r in client.get("/suppliers/scorecard", headers=OWNER).json() if r["supplier_id"] == sup)

    late = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
    r = client.post(f"/requests/{rid}/receipt", json={"delivered_at": late, "defect": True}, headers=TECH)
    assert r.status_code == 200
    assert r.json()["days_late"] >= 9 and r.json()["defect"] is True

    after = next(r for r in client.get("/suppliers/scorecard", headers=OWNER).json() if r["supplier_id"] == sup)
    assert after["score"] < before["score"] and after["orders"] == before["orders"] + 1
    assert client.post(f"/requests/{rid}/receipt", json={}, headers=TECH).status_code == 409   # once only


def test_receipt_needs_an_executed_order(api):
    client, *_ = api
    rid = client.post("/requests", json={"raw_request": "drive motor L-03"}, headers=TECH).json()["request_id"]
    assert client.post(f"/requests/{rid}/receipt", json={}, headers=MANAGER).status_code == 409


def test_audit_views(api):
    client, *_ = api
    rid = client.post("/requests", json={"raw_request": "heald wires L-07"}, headers=TECH).json()["request_id"]
    rows = client.get(f"/requests/{rid}/audit", headers=TECH).json()
    assert [r["action"] for r in rows][-1] == "order_recorded"
    assert client.get("/audit", headers=TECH).status_code == 403
    assert len(client.get("/audit", headers=FINANCE).json()) == len(rows)


def test_scorecard_is_ranked(api):
    client, *_ = api
    rows = client.get("/suppliers/scorecard", headers=TECH).json()
    assert [r["score"] for r in rows] == sorted((r["score"] for r in rows), reverse=True)
    assert {"supplier_id", "name", "score", "on_time_rate", "orders"} <= set(rows[0])


def test_refuses_to_boot_with_a_live_stripe_key(pack, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_not_a_real_key")
    app = create_app(pack=pack, llm=fake_llm(), checkpointer=InMemorySaver())

    async def boot():
        async with app.router.lifespan_context(app):
            pass

    with pytest.raises(SystemExit, match="test mode"):
        asyncio.run(boot())
