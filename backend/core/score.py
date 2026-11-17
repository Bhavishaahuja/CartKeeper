"""CartLens layer: supplier reliability scores from the company's own order history.

Pure functions, no I/O. Inputs are per-supplier counts (the shape of
vw_supplier_reliability); output is a 0-100 score per supplier.

Two corrections keep small samples honest:
- Rates are ratios of totals (sum of on-time orders / sum of orders), not an
  average of per-month ratios, so every order counts once.
- Each supplier's rates are shrunk toward the pooled rate across all suppliers,
  with the pull fading as its order count grows. A supplier with 2 lucky orders
  sits near the pooled average; one with 200 solid orders keeps its own record.
"""

from __future__ import annotations

from dataclasses import dataclass

PRIOR_STRENGTH = 20        # orders' worth of pull toward the pooled rate
LATE_DAYS_CAP = 5.0        # avg days late at or above this scores 0 on that component
DEFECT_RATE_CAP = 0.25     # defect rate at or above this scores 0 on that component
NEUTRAL_PRIOR = (0.85, 1.0, 0.05)  # (on_time_rate, avg_days_late, defect_rate) when no history at all


@dataclass(frozen=True)
class SupplierStats:
    supplier_id: str
    orders: int            # delivered orders
    on_time_orders: int
    late_days_sum: float   # sum of days late across all delivered orders (on-time = 0)
    defect_orders: int


def _pooled(stats: list[SupplierStats]) -> tuple[float, float, float]:
    n = sum(s.orders for s in stats)
    if n == 0:
        return NEUTRAL_PRIOR
    return (
        sum(s.on_time_orders for s in stats) / n,
        sum(s.late_days_sum for s in stats) / n,
        sum(s.defect_orders for s in stats) / n,
    )


def _shrink(total: float, n: int, prior: float) -> float:
    return (total + PRIOR_STRENGTH * prior) / (n + PRIOR_STRENGTH)


def score_suppliers(
    stats: list[SupplierStats],
    weights: dict[str, float],
    supplier_ids: list[str] | None = None,
) -> dict[str, dict]:
    """Score every supplier in `stats`, plus any id in `supplier_ids` with no history."""
    by_id = {s.supplier_id: s for s in stats}
    for sid in supplier_ids or []:
        by_id.setdefault(sid, SupplierStats(sid, 0, 0, 0.0, 0))

    p_on_time, p_late, p_defect = _pooled(stats)
    out = {}
    for sid, s in by_id.items():
        on_time = _shrink(s.on_time_orders, s.orders, p_on_time)
        late = _shrink(s.late_days_sum, s.orders, p_late)
        defect = _shrink(s.defect_orders, s.orders, p_defect)
        components = {
            "on_time_rate": on_time,
            "avg_days_late": 1 - min(late / LATE_DAYS_CAP, 1.0),
            "defect_rate": 1 - min(defect / DEFECT_RATE_CAP, 1.0),
        }
        score = 100 * sum(weights[k] * components[k] for k in components)
        out[sid] = {
            "score": round(score, 1),
            "on_time_rate": round(on_time, 3),
            "avg_days_late": round(late, 2),
            "defect_rate": round(defect, 3),
            "orders": s.orders,
            "raw_on_time_rate": round(s.on_time_orders / s.orders, 3) if s.orders else None,
            "low_confidence": s.orders < PRIOR_STRENGTH,
        }
    return out
