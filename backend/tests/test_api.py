import json

import pytest
from fastapi.testclient import TestClient

from backend.core.graph import supplier_scores_from_seed
from backend.core.packs import load_pack
from backend.core.payments import StubPayments
from backend.core.store import InMemoryStore
from backend.main import create_app

from .fakes import FakeLLM

TECH, MANAGER, OWNER, FINANCE = {"X-User-Id": "u-tech-1"}, {"X-User-Id": "u-mm-1"}, \
    {"X-User-Id": "u-owner-1"}, {"X-User-Id": "u-fin-1"}

NEEDS = {
    "motor": {"item_need": "drive motor", "search_terms": ["drive motor"],
              "machine_id": "L-03", "urgency": "line_down", "qty": 1},
    "heald": {"item_need": "heald wires", "search_terms": ["heald wire"],
              "machine_id": "L-07", "urgency": "line_down", "qty": 500},
}


def fake_llm():
    def need(schema, messages):
        text = messages[-1].content.lower()
        return NEEDS["motor"] if "motor" in text else NEEDS["heald"]

    def choice(schema, messages):
        ctx = json.loads(messages[-1].content)
        best = max(ctx["options"], key=lambda o: o["reliability"]["score"])
        return {"option_id": best["option_id"], "qty": ctx["need"]["qty"], "rationale": "most reliable"}

    return FakeLLM({"Need": need, "Choice": choice})


@pytest.fixture
def ctx():
    pack = load_pack("manufacturing_textile")
    store, payments = InMemoryStore.from_demo(pack), StubPayments()
    app = create_app(pack=pack, llm=fake_llm(), store=store, payments=payments,
                     supplier_scores=supplier_scores_from_seed(pack), quote_latency=0)
    with TestClient(app) as client:
        yield client, store, payments


def test_health(ctx):
    client, *_ = ctx
    assert client.get("/health").json() == {"ok": True}


def test_requires_known_user(ctx):
    client, *_ = ctx
    assert client.post("/requests", json={"raw_request": "motor"}).status_code == 401
    assert client.post("/requests", json={"raw_request": "motor"},
                       headers={"X-User-Id": "nobody"}).status_code == 401


def test_t2_auto_approved_over_api(ctx):
    client, _, payments = ctx
    r = client.post("/requests", json={"raw_request": "Loom L-07 heald wires snapped, need 500 today"},
                    headers=TECH)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "executed"
    assert body["payment"]["amount"] == 95.0
    assert body["sourcing"]["suppliers_quoted"] == 2


def test_t4_pause_and_approve_over_api(ctx):
    client, store, payments = ctx
    body = client.post("/requests", json={"raw_request": "Replace drive motor on loom L-03"},
                       headers=TECH).json()
    rid = body["request_id"]
    assert body["status"] == "awaiting_approval"
    assert body["approver_id"] == "u-mm-1"
    assert body["policy_result"]["decision"] == "needs_approval"

    inbox = client.get("/approvals", headers=MANAGER).json()
    assert [r["request_id"] for r in inbox] == [rid]
    assert client.get("/approvals", headers=OWNER).json() == []

    r = client.post(f"/requests/{rid}/decision", json={"approval": "approved"}, headers=MANAGER)
    assert r.status_code == 200 and r.json()["status"] == "executed"
    assert client.get("/approvals", headers=MANAGER).json() == []
    assert len(payments.payments) == 1


def test_t8_second_decision_is_refused(ctx):
    client, _, payments = ctx
    rid = client.post("/requests", json={"raw_request": "drive motor L-03"}, headers=TECH).json()["request_id"]
    assert client.post(f"/requests/{rid}/decision", json={"approval": "approved"},
                       headers=MANAGER).status_code == 200
    r = client.post(f"/requests/{rid}/decision", json={"approval": "approved"}, headers=MANAGER)
    assert r.status_code == 409
    assert len(payments.payments) == 1


def test_reject_over_api(ctx):
    client, _, payments = ctx
    rid = client.post("/requests", json={"raw_request": "drive motor L-03"}, headers=TECH).json()["request_id"]
    r = client.post(f"/requests/{rid}/decision", json={"approval": "rejected"}, headers=MANAGER)
    assert r.json()["status"] == "rejected"
    assert payments.payments == {}


def test_only_the_right_people_can_decide(ctx):
    client, *_ = ctx
    rid = client.post("/requests", json={"raw_request": "drive motor L-03"}, headers=TECH).json()["request_id"]
    assert client.post(f"/requests/{rid}/decision", json={"approval": "approved"},
                       headers=TECH).status_code == 403          # requester can't approve own request
    assert client.post(f"/requests/{rid}/decision", json={"approval": "approved"},
                       headers=FINANCE).status_code == 403       # finance isn't an approver
    assert client.post(f"/requests/{rid}/decision", json={"approval": "approved"},
                       headers=OWNER).status_code == 200         # a higher tier may approve


def test_bad_approval_value_is_422(ctx):
    client, *_ = ctx
    rid = client.post("/requests", json={"raw_request": "drive motor L-03"}, headers=TECH).json()["request_id"]
    assert client.post(f"/requests/{rid}/decision", json={"approval": "sure"},
                       headers=MANAGER).status_code == 422


def test_visibility(ctx):
    client, store, _ = ctx
    store.members.append({"user_id": "u-tech-2", "name": "Other tech", "role": "requester"})
    rid = client.post("/requests", json={"raw_request": "drive motor L-03"}, headers=TECH).json()["request_id"]
    assert client.get(f"/requests/{rid}", headers=TECH).status_code == 200
    assert client.get(f"/requests/{rid}", headers=OWNER).status_code == 200
    assert client.get(f"/requests/{rid}", headers={"X-User-Id": "u-tech-2"}).status_code == 404
    assert client.get("/requests/nope", headers=OWNER).status_code == 404
