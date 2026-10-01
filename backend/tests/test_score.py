from datetime import date

from backend.core.history import aggregate, seed_rows
from backend.core.packs import load_pack
from backend.core.score import PRIOR_STRENGTH, SupplierStats, score_suppliers

W = {"on_time_rate": 0.5, "avg_days_late": 0.2, "defect_rate": 0.3}


def test_scores_are_0_to_100():
    out = score_suppliers([SupplierStats("a", 10, 10, 0, 0), SupplierStats("b", 10, 0, 50, 10)], W)
    assert all(0 <= v["score"] <= 100 for v in out.values())
    assert out["a"]["score"] > out["b"]["score"]


def test_volume_weighting_two_lucky_orders_do_not_beat_two_hundred_solid():
    lucky = SupplierStats("lucky", orders=2, on_time_orders=2, late_days_sum=0, defect_orders=0)
    solid = SupplierStats("solid", orders=200, on_time_orders=190, late_days_sum=15, defect_orders=4)
    weak = SupplierStats("weak", orders=150, on_time_orders=100, late_days_sum=160, defect_orders=15)
    out = score_suppliers([lucky, solid, weak], W)
    assert out["lucky"]["raw_on_time_rate"] == 1.0
    assert out["solid"]["score"] > out["lucky"]["score"]
    assert out["lucky"]["low_confidence"] and not out["solid"]["low_confidence"]


def test_lots_of_history_keeps_its_own_rate():
    big = SupplierStats("big", orders=2000, on_time_orders=1000, late_days_sum=2000, defect_orders=0)
    other = SupplierStats("other", orders=2000, on_time_orders=2000, late_days_sum=0, defect_orders=0)
    out = score_suppliers([big, other], W)
    assert abs(out["big"]["on_time_rate"] - 0.5) < 0.01


def test_supplier_without_history_gets_pooled_rate():
    stats = [SupplierStats("a", 100, 90, 20, 5)]
    out = score_suppliers(stats, W, supplier_ids=["a", "new"])
    assert out["new"]["orders"] == 0
    assert out["new"]["on_time_rate"] == 0.9
    assert out["new"]["low_confidence"]


def test_no_history_at_all_still_scores():
    out = score_suppliers([], W, supplier_ids=["x"])
    assert 0 < out["x"]["score"] < 100


def test_weights_change_the_ranking():
    fast_but_defective = SupplierStats("f", 100, 100, 0, 20)
    slow_but_clean = SupplierStats("s", 100, 60, 80, 0)
    timing = score_suppliers([fast_but_defective, slow_but_clean],
                             {"on_time_rate": 0.9, "avg_days_late": 0.1, "defect_rate": 0.0})
    quality = score_suppliers([fast_but_defective, slow_but_clean],
                              {"on_time_rate": 0.1, "avg_days_late": 0.0, "defect_rate": 0.9})
    assert timing["f"]["score"] > timing["s"]["score"]
    assert quality["s"]["score"] > quality["f"]["score"]


def test_seed_history_scoring_rediscovers_hidden_reliability():
    pack = load_pack("manufacturing_textile")
    rows = seed_rows(pack, today=date(2026, 10, 1))
    out = score_suppliers(aggregate(rows), pack.config.scoring_weights.model_dump())
    # SUP-02 is dependable and SUP-01 is often late in the hidden truth.
    assert out["SUP-02"]["score"] > out["SUP-01"]["score"] + 15
    # SUP-05 has 3 perfect orders: it must not outrank the proven suppliers.
    assert out["SUP-05"]["orders"] == 3
    assert out["SUP-05"]["score"] < out["SUP-02"]["score"]
    assert out["SUP-05"]["score"] < out["SUP-03"]["score"]


def test_aggregate_counts():
    rows = [
        {"supplier_id": "a", "promised_at": "2026-01-10T10:00:00+00:00",
         "delivered_at": "2026-01-10T18:00:00+00:00", "defect": False},
        {"supplier_id": "a", "promised_at": "2026-01-10T10:00:00+00:00",
         "delivered_at": "2026-01-13T10:00:00+00:00", "defect": True},
        {"supplier_id": "a", "promised_at": "2026-01-10T10:00:00+00:00",
         "delivered_at": None, "defect": False},
    ]
    assert aggregate(rows) == [SupplierStats("a", orders=2, on_time_orders=1, late_days_sum=3, defect_orders=1)]
    assert PRIOR_STRENGTH > 2
