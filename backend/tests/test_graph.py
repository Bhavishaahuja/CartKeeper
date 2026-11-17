import json

import pytest

from backend.core.graph import run
from backend.core.packs import load_pack

from .fakes import FakeLLM


@pytest.fixture(scope="module")
def pack():
    return load_pack("manufacturing_textile")


def heald_wire_llm(pick=lambda options: options[0]["option_id"], qty=500):
    def need(schema, messages):
        return {"item_need": "heald wires", "search_terms": ["heald wire"],
                "machine_id": "L-07", "urgency": "line_down", "qty": qty}

    def choice(schema, messages):
        options = json.loads(messages[-1].content)["options"]
        return {"option_id": pick(options), "qty": qty, "rationale": "Fits L-07 and ships today."}

    return FakeLLM({"Need": need, "Choice": choice})


def test_request_returns_need_and_proposal(pack):
    result = run("Loom L-07 heald wires snapped, need 500 today", pack=pack, llm=heald_wire_llm())
    assert result["need"]["machine_id"] == "L-07"
    assert result["need"]["urgency"] == "line_down"
    p = result["proposal"]
    assert set(p) >= {"supplier_id", "sku", "qty", "unit_price", "total", "rationale"}
    assert p["qty"] == 500
    assert p["total"] == round(p["unit_price"] * 500, 2)
    assert p["rationale"]


def test_price_comes_from_catalog_not_model(pack):
    result = run("heald wires", pack=pack, llm=heald_wire_llm())
    p = result["proposal"]
    assert p["unit_price"] == pack.supplier(p["supplier_id"]).price_list[p["sku"]].unit_price


def test_unapproved_suppliers_are_not_offered(pack):
    result = run("heald wires", pack=pack, llm=heald_wire_llm())
    assert result["quotes"]
    assert all(pack.supplier(q["supplier_id"]).approved for q in result["quotes"])


def test_model_cannot_pick_an_option_that_does_not_exist(pack):
    llm = heald_wire_llm(pick=lambda options: "opt-999")
    with pytest.raises(Exception):
        run("heald wires", pack=pack, llm=llm)


def test_no_match_returns_message_not_proposal(pack):
    def need(schema, messages):
        return {"item_need": "espresso machine", "search_terms": ["espresso"],
                "machine_id": None, "urgency": "restock", "qty": 1}

    llm = FakeLLM({"Need": need, "Choice": lambda *_: pytest.fail("propose should not call the LLM")})
    result = run("buy an espresso machine", pack=pack, llm=llm)
    assert result["proposal"] is None
    assert "espresso" in result["final_message"]


def test_need_schema_only_allows_pack_urgencies_and_machines(pack):
    from backend.core.nodes import need_schema

    schema = need_schema(pack).model_json_schema()
    urgency = json.dumps(schema["properties"]["urgency"])
    assert all(k in urgency for k in pack.config.urgency_levels)
    assert "L-07" in json.dumps(schema["properties"]["machine_id"])
