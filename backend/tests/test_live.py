"""Live checks against the real model. Run with: pytest -m live (needs ANTHROPIC_API_KEY)."""

import os
import re

import pytest
from dotenv import load_dotenv

from backend.core.graph import run
from backend.core.llm import api_key
from backend.core.packs import load_pack

load_dotenv()
pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not api_key(), reason="no Anthropic API key set"),
]


@pytest.fixture(scope="module")
def pack_and_llm():
    from backend.core.llm import make_llm
    return load_pack("manufacturing_textile"), make_llm()


def test_t1_storeroom(pack_and_llm):
    pack, llm = pack_and_llm
    result = run("Need 2 x 6205 bearings for spinning frame S-04", pack=pack, llm=llm)
    assert result["inventory_hit"]["sku"] == "BRG-6205-2RS"
    assert result["proposal"] is None


def test_t3_reliability_beats_price(pack_and_llm):
    pack, llm = pack_and_llm
    result = run("Loom L-07 heald wires snapped, need 500 today", pack=pack, llm=llm)
    p = result["proposal"]
    assert p["sku"] == "HW-330-OMNI"
    assert p["supplier_id"] == "SUP-02", p["rationale"]
    assert re.search(r"\d+(\.\d+)?\s*%|score", p["rationale"], re.I), p["rationale"]
