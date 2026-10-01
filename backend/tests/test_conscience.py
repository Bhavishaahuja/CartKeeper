"""Day 2: policy routing, durable approval, bounded replan."""

import json
from pathlib import Path

import pytest

from backend.core.graph import build_graph, decide, start, supplier_scores_from_seed
from backend.core.packs import load_pack
from backend.core.payments import StubPayments
from backend.core.store import InMemoryStore

from .fakes import FakeLLM


@pytest.fixture(scope="module")
def pack():
    return load_pack("manufacturing_textile")


@pytest.fixture(scope="module")
def scores(pack):
    return supplier_scores_from_seed(pack)


@pytest.fixture
def store(pack):
    return InMemoryStore.from_demo(pack)


@pytest.fixture
def payments():
    return StubPayments()


def most_reliable(options):
    return max(options, key=lambda o: (o["reliability"]["score"], -o["unit_price"]))


def make_llm(need, pick=most_reliable):
    def choice(schema, messages):
        options = json.loads(messages[-1].content)["options"]
        return {"option_id": pick(options)["option_id"], "qty": need["qty"], "rationale": "test pick"}
    return FakeLLM({"Need": lambda *_: need, "Choice": choice})


HEALD = {"item_need": "heald wires", "search_terms": ["heald wire"],
         "machine_id": "L-07", "urgency": "line_down", "qty": 500}
MOTOR = {"item_need": "drive motor", "search_terms": ["drive motor"],
         "machine_id": "L-03", "urgency": "line_down", "qty": 1}


@pytest.fixture
def graph_for(pack, scores, store, payments):
    def _build(need, **kw):
        llm = kw.pop("llm", None) or make_llm(need)
        return build_graph(pack, llm, store=store, payments=payments,
                           supplier_scores=scores, quote_latency=0, **kw), llm
    return _build


def test_t2_auto_approve_pays_without_asking(graph_for, store, payments):
    graph, _ = graph_for(HEALD)
    view = start(graph, "Loom L-07 heald wires snapped, need 500 today")
    assert view["status"] == "executed"
    s = view["state"]
    assert s["policy_result"]["decision"] == "auto_approve"
    assert s["payment"]["amount"] == 95.0
    assert store.spent("line_2") == 95.0
    assert len(payments.payments) == 1


def test_t4_manager_approval_pauses_then_pays(graph_for, store, payments):
    graph, _ = graph_for(MOTOR)
    view = start(graph, "Replace drive motor on loom L-03", requester_id="u-tech-1")
    assert view["status"] == "awaiting_approval"
    pending = view["pending_approval"]
    assert pending["approver_id"] == "u-mm-1"
    assert pending["approver_role"] == "maintenance_manager"
    assert pending["proposal"]["total"] == 890.0
    assert payments.payments == {}                       # nothing paid while waiting

    view = decide(graph, view["request_id"], approval="approved", decided_by="u-mm-1")
    assert view["status"] == "executed"
    assert view["state"]["decided_by"] == "u-mm-1"
    assert store.spent("line_2") == 890.0
    assert len(payments.payments) == 1


def test_t4_reject_ends_with_no_payment(graph_for, store, payments):
    graph, _ = graph_for(MOTOR)
    view = start(graph, "Replace drive motor on loom L-03")
    view = decide(graph, view["request_id"], approval="rejected", decided_by="u-mm-1")
    assert view["status"] == "rejected"
    assert view["state"].get("payment") is None
    assert payments.payments == {} and store.orders == []


def test_bad_approval_value_is_refused(graph_for):
    graph, _ = graph_for(MOTOR)
    view = start(graph, "Replace drive motor on loom L-03")
    with pytest.raises(ValueError):
        decide(graph, view["request_id"], approval="yes please", decided_by="u-mm-1")


def test_owner_tier_routes_to_owner(graph_for):
    graph, _ = graph_for({**MOTOR, "qty": 2})            # $1,780
    view = start(graph, "two drive motors for L-03")
    assert view["pending_approval"]["approver_id"] == "u-owner-1"


def test_missing_manager_escalates_to_owner(graph_for, store):
    store.members = [m for m in store.members if m["role"] != "maintenance_manager"]
    graph, _ = graph_for(MOTOR)
    view = start(graph, "Replace drive motor on loom L-03")
    assert view["pending_approval"]["approver_id"] == "u-owner-1"
    assert view["pending_approval"]["approver_role"] == "owner"


def test_t6_blocked_then_replans_to_cheaper_option(graph_for, store, payments):
    # $870 left on Line 2: SUP-02's $890 motor is blocked, SUP-03's $860 motor fits.
    store.record_order({"request_id": "earlier", "scope_key": "line_2", "total": 2130.0})
    graph, llm = graph_for(MOTOR)
    view = start(graph, "Replace drive motor on loom L-03")
    s = view["state"]
    assert s["replan_count"] == 1
    assert s["previous_attempt"]["proposal"]["supplier_id"] == "SUP-02"
    assert "left in line_2" in s["previous_attempt"]["reasons"][0]
    assert [q["supplier_id"] for q in s["eligible_quotes"]] == ["SUP-03"]
    assert s["proposal"]["supplier_id"] == "SUP-03"
    assert view["status"] == "awaiting_approval"         # $860 still needs the manager
    retry_prompt = json.loads(llm.calls[-1][1][-1].content)
    assert retry_prompt["previous_attempt"]["reasons"]


def test_t6_blocked_with_nothing_cheaper_explains_and_stops(graph_for, store, payments):
    store.record_order({"request_id": "earlier", "scope_key": "line_2", "total": 2500.0})   # $500 left
    graph, llm = graph_for(MOTOR)
    view = start(graph, "Replace drive motor on loom L-03")
    assert view["status"] == "blocked"
    assert "Not purchased" in view["state"]["final_message"]
    assert "none fits" in view["state"]["final_message"]
    assert payments.payments == {}                       # zero payment calls
    assert [name for name, _ in llm.calls] == ["Need", "Choice"]   # no second model call when nothing fits


def test_budget_spent_while_waiting_blocks_at_execute(graph_for, store, payments):
    graph, _ = graph_for(MOTOR)
    view = start(graph, "Replace drive motor on loom L-03")
    store.record_order({"request_id": "meanwhile", "scope_key": "line_2", "total": 2500.0})
    view = decide(graph, view["request_id"], approval="approved", decided_by="u-mm-1")
    assert view["status"] == "blocked"
    assert "changed while this waited" in view["state"]["final_message"]
    assert payments.payments == {}


def test_storeroom_and_no_match_statuses(pack, scores, store):
    bearings = {"item_need": "6205 bearings", "search_terms": ["6205 bearing"],
                "machine_id": "S-04", "urgency": "line_down", "qty": 2}
    g = build_graph(pack, make_llm(bearings), store=store, supplier_scores=scores, quote_latency=0)
    assert start(g, "2 x 6205 bearings for S-04")["status"] == "reserved"
    nothing = {"item_need": "espresso machine", "search_terms": ["espresso"],
               "machine_id": None, "urgency": "restock", "qty": 1}
    g = build_graph(pack, make_llm(nothing), store=store, supplier_scores=scores, quote_latency=0)
    assert start(g, "an espresso machine")["status"] == "no_match"


def test_llm_has_no_way_to_change_a_policy_decision(graph_for):
    """The model only ever gets two output schemas, and neither can carry a decision."""
    graph, llm = graph_for(MOTOR)
    start(graph, "Replace drive motor on loom L-03")
    from backend.core.nodes import choice_schema, need_schema
    from backend.core.packs import load_pack
    pack = load_pack("manufacturing_textile")
    allowed = {
        "Need": set(need_schema(pack).model_fields),
        "Choice": set(choice_schema(["opt-1"]).model_fields),
    }
    assert {name for name, _ in llm.calls} <= set(allowed)
    assert allowed["Choice"] == {"option_id", "qty", "rationale"}
    banned = {"decision", "approval", "approved", "policy_result", "approver_id", "total", "unit_price"}
    assert not any(banned & fields for fields in allowed.values())
    # No tools are bound anywhere in the core: structured output only.
    core = Path(__file__).resolve().parents[1] / "core"
    for src in core.glob("*.py"):
        assert "bind_tools" not in src.read_text(), src.name
