"""Day 1: storeroom short-circuit, parallel sourcing, reliability-aware proposals."""

import json

import pytest

from backend.core.graph import run, supplier_scores_from_seed
from backend.core.packs import load_pack

from .fakes import FakeLLM


@pytest.fixture(scope="module")
def pack():
    return load_pack("manufacturing_textile")


@pytest.fixture(scope="module")
def scores(pack):
    return supplier_scores_from_seed(pack)


def need_llm(need, pick=None):
    def choice(schema, messages):
        options = json.loads(messages[-1].content)["options"]
        opt = pick(options) if pick else options[0]
        return {"option_id": opt["option_id"], "qty": need["qty"], "rationale": "test pick"}
    return FakeLLM({"Need": lambda *_: need, "Choice": choice})


BEARINGS = {"item_need": "6205 bearings", "search_terms": ["6205 bearing"],
            "machine_id": "S-04", "urgency": "line_down", "qty": 2}
HEALD = {"item_need": "heald wires", "search_terms": ["heald wire"],
         "machine_id": "L-07", "urgency": "line_down", "qty": 500}
MOTOR = {"item_need": "drive motor", "search_terms": ["drive motor"],
         "machine_id": "L-03", "urgency": "line_down", "qty": 1}


def test_t1_storeroom_short_circuits(pack, scores):
    llm = need_llm(BEARINGS)
    result = run("Need 2 x 6205 bearings for spinning frame S-04", pack=pack, llm=llm,
                 supplier_scores=scores, quote_latency=0)
    assert result["inventory_hit"]["sku"] == "BRG-6205-2RS"
    assert result["proposal"] is None
    assert "Nothing to buy" in result["final_message"]
    assert [name for name, _ in llm.calls] == ["Need"]  # propose never ran


def test_not_enough_stock_goes_to_suppliers(pack, scores):
    need = {**BEARINGS, "qty": 50}
    result = run("50 x 6205 bearings", pack=pack, llm=need_llm(need),
                 supplier_scores=scores, quote_latency=0)
    assert result["inventory_hit"] is None
    assert result["proposal"]["sku"] == "BRG-6205-2RS"


def test_machine_compatibility_narrows_candidates(pack, scores):
    result = run("heald wires for L-07", pack=pack, llm=need_llm(HEALD),
                 supplier_scores=scores, quote_latency=0)
    assert {c["sku"] for c in result["candidates"]} == {"HW-330-OMNI"}  # not the OptiMax wire


def test_quotes_arrive_in_one_parallel_round(pack, scores):
    latency = 0.3
    result = run("drive motor for L-03", pack=pack, llm=need_llm(MOTOR),
                 supplier_scores=scores, quote_latency=latency)
    s = result["sourcing"]
    assert s["suppliers_quoted"] >= 2
    assert set(s["per_supplier_ms"]) == {"SUP-02", "SUP-03"}
    # Parallel: the round takes about one quote's latency, not the sum of all of them.
    assert s["round_ms"] < s["sequential_ms"] * 0.75, s


def test_options_carry_reliability_scores(pack, scores):
    result = run("heald wires", pack=pack, llm=need_llm(HEALD), supplier_scores=scores, quote_latency=0)
    by_supplier = {q["supplier_id"]: q for q in result["scored_quotes"]}
    cheap, reliable = by_supplier["SUP-01"], by_supplier["SUP-02"]
    assert cheap["unit_price"] < reliable["unit_price"]
    assert cheap["reliability"]["score"] < reliable["reliability"]["score"]
    assert [q["option_id"] for q in result["scored_quotes"]] == [f"opt-{i}" for i in range(1, len(by_supplier) + 1)]


def test_t3_proposal_records_score_of_the_pick(pack, scores):
    most_reliable = lambda options: max(options, key=lambda o: o["reliability"]["score"])
    result = run("heald wires", pack=pack, llm=need_llm(HEALD, pick=most_reliable),
                 supplier_scores=scores, quote_latency=0)
    p = result["proposal"]
    assert p["supplier_id"] == "SUP-02"
    assert p["supplier_score"] == scores["SUP-02"]["score"]
    assert p["total"] == round(0.19 * 500, 2)


def test_propose_prompt_tells_model_to_cite_scores(pack, scores):
    llm = need_llm(HEALD)
    run("heald wires", pack=pack, llm=llm, supplier_scores=scores, quote_latency=0)
    system = next(msgs for name, msgs in llm.calls if name == "Choice")[0].content
    assert "reliability score" in system and "cite" in system
