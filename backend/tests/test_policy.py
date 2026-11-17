import pytest

from backend.core.packs import load_pack
from backend.core.policy import check_policy


@pytest.fixture(scope="module")
def pack():
    return load_pack("manufacturing_textile")


GOOD_SCORES = {f"SUP-0{i}": {"score": 90} for i in range(1, 6)}


def check(pack, sku, supplier_id, qty, *, budget=3000, spent=0, scores=GOOD_SCORES, pack_override=None):
    return check_policy(
        {"sku": sku, "supplier_id": supplier_id, "qty": qty},
        pack=pack_override or pack, supplier_scores=scores,
        scope_key="line_2", budget=budget, spent=spent,
    )


# SUP-02 sells the OMNI drive motor at $890 and heald wires at $0.19.
@pytest.mark.parametrize("qty,expected,role", [
    (1, "auto_approve", "none"),            # $0.19
    (789, "auto_approve", "none"),          # $149.91
])
def test_auto_approve_tier(pack, qty, expected, role):
    r = check(pack, "HW-330-OMNI", "SUP-02", qty)
    assert (r["decision"], r["approver_role"]) == (expected, role)
    assert r["reasons"]


def test_exact_limit_is_auto_approved(pack):
    # $7.50 V-belt x 20 = exactly $150.
    r = check(pack, "VB-B52", "SUP-03", 20)
    assert r["total"] == 150.00
    assert r["decision"] == "auto_approve"


def test_just_over_auto_limit_needs_manager(pack):
    r = check(pack, "HW-330-OMNI", "SUP-02", 790)     # $150.10
    assert (r["decision"], r["approver_role"]) == ("needs_approval", "maintenance_manager")


def test_manager_tier(pack):
    r = check(pack, "MTR-DRV-OMNI", "SUP-02", 1)      # $890
    assert (r["decision"], r["approver_role"]) == ("needs_approval", "maintenance_manager")
    assert "maintenance manager" in r["reasons"][0]


def test_owner_tier(pack):
    r = check(pack, "MTR-DRV-OMNI", "SUP-02", 2)      # $1,780
    assert (r["decision"], r["approver_role"]) == ("needs_approval", "owner")


def test_exact_manager_limit_stays_with_manager(pack):
    r = check(pack, "SNS-PROX-M18", "SUP-02", 62, budget=5000)   # $24 x 62 = $1,488
    assert r["approver_role"] == "maintenance_manager"
    r = check(pack, "VB-B52", "SUP-03", 200, budget=5000)        # $7.50 x 200 = $1,500.00
    assert r["total"] == 1500.00 and r["approver_role"] == "maintenance_manager"


def test_over_remaining_budget_is_blocked(pack):
    r = check(pack, "MTR-DRV-OMNI", "SUP-02", 1, budget=3000, spent=2500)
    assert r["decision"] == "blocked"
    assert r["remaining"] == 500
    assert "$500.00 left in line_2" in r["reasons"][0]


def test_budget_exactly_used_up_is_allowed(pack):
    r = check(pack, "MTR-DRV-OMNI", "SUP-02", 1, budget=3000, spent=2110)
    assert r["decision"] == "needs_approval"


def test_unapproved_supplier_is_blocked(pack):
    r = check(pack, "HW-330-OMNI", "SUP-05", 10)
    assert r["decision"] == "blocked" and "not an approved supplier" in r["reasons"][0]


def test_low_score_supplier_is_blocked(pack):
    r = check(pack, "HW-330-OMNI", "SUP-01", 10, scores={**GOOD_SCORES, "SUP-01": {"score": 55}})
    assert r["decision"] == "blocked" and "below the minimum of 60" in r["reasons"][0]


def test_missing_score_is_blocked(pack):
    r = check(pack, "HW-330-OMNI", "SUP-01", 10, scores={})
    assert r["decision"] == "blocked"


def test_blocked_category(pack):
    cfg = pack.config.model_copy(update={"policy": pack.config.policy.model_copy(
        update={"blocked_categories": ["motors"]})})
    strict_pack = pack.model_copy(update={"config": cfg})
    r = check(pack, "MTR-DRV-OMNI", "SUP-02", 1, pack_override=strict_pack)
    assert r["decision"] == "blocked" and "motors" in r["reasons"][0]


def test_invented_sku_or_price_is_ignored(pack):
    r = check_policy({"sku": "HW-330-OMNI", "supplier_id": "SUP-02", "qty": 500,
                      "unit_price": 0.01, "total": 5.0},
                     pack=pack, supplier_scores=GOOD_SCORES, scope_key="line_2", budget=3000, spent=0)
    assert r["total"] == 95.0                          # re-read from the catalog, not the proposal
    r = check(pack, "MADE-UP-SKU", "SUP-02", 1)
    assert r["decision"] == "blocked"
    r = check(pack, "DYE-RB5-KG", "SUP-02", 1)         # real sku, but SUP-02 doesn't sell it
    assert r["decision"] == "blocked"


def test_zero_qty_is_blocked(pack):
    assert check(pack, "HW-330-OMNI", "SUP-02", 0)["decision"] == "blocked"


def test_no_budget_for_scope_is_blocked(pack):
    assert check(pack, "HW-330-OMNI", "SUP-02", 1, budget=None)["decision"] == "blocked"
