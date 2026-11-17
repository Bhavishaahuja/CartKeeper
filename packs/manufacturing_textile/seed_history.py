"""Synthetic purchase-order history for the textile mill pack.

Each supplier has a hidden "true" reliability below. The generated orders are
noisy draws from it. Scoring code never reads TRUTH; it has to rediscover
reliability from the orders, the same way it would from a real company's history.

Contract (used by backend.core.history): generate(pack, *, months, seed, today) -> list[dict]
with the columns of the purchase_orders table.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta, timezone

# supplier_id: (orders over the window, P(on time), mean days late when late, P(defect))
TRUTH = {
    "SUP-01": (150, 0.70, 3.5, 0.09),   # cheapest loom/spinning parts, often late
    "SUP-02": (120, 0.95, 1.2, 0.02),   # pricier, dependable
    "SUP-03": (200, 0.89, 1.8, 0.03),
    "SUP-04": (80,  0.91, 2.0, 0.04),
    "SUP-05": (3,   1.00, 0.0, 0.00),   # 3 lucky orders: volume weighting must not over-trust this
}

# Recurring failures the insights view should discover: (sku, machine_id, every_days, jitter_days, supplier_id)
FAILURE_PATTERNS = [
    ("NDL-LATCH-28G", "K-02", 42, 4, "SUP-01"),   # knitting needles on Line 3, roughly every 6 weeks
    ("TAPE-SPN-12",   "S-05", 30, 3, "SUP-01"),
]


def _at(d: date) -> str:
    return datetime.combine(d, time(10, 0), tzinfo=timezone.utc).isoformat()


def _order(rng, pack, supplier_id, sku, ordered, machine_id, truth):
    _, p_on_time, mean_late, p_defect = truth
    price = pack.supplier(supplier_id).price_list[sku]
    qty = rng.choice([1, 2, 4, 10, 50, 200]) if price.unit_price < 5 else rng.choice([1, 1, 2, 4])
    promised = ordered + timedelta(days=price.lead_days)
    late = 0 if rng.random() < p_on_time else max(1, round(rng.expovariate(1 / max(mean_late, 0.5))))
    return {
        "supplier_id": supplier_id,
        "sku": sku,
        "machine_id": machine_id,
        "qty": qty,
        "total": round(qty * price.unit_price, 2),
        "ordered_at": _at(ordered),
        "promised_at": _at(promised),
        "delivered_at": _at(promised + timedelta(days=late)),
        "defect": rng.random() < p_defect,
        "source": "seed",
    }


def generate(pack, *, months: int = 12, seed: int = 7, today: date | None = None) -> list[dict]:
    rng = random.Random(seed)
    end = (today or date.today()) - timedelta(days=7)  # history stops a week before today
    days = months * 30
    by_model = {}
    for m in pack.machines:
        by_model.setdefault(m.model, []).append(m.machine_id)
    all_machines = [m.machine_id for m in pack.machines]

    # Patterned parts are only bought on their cadence, so random orders don't drown the signal.
    patterned = {sku for sku, *_ in FAILURE_PATTERNS}
    rows = []
    for supplier_id, truth in TRUTH.items():
        skus = sorted(set(pack.supplier(supplier_id).price_list) - patterned)
        for _ in range(truth[0]):
            sku = rng.choice(skus)
            fits = pack.item(sku).compatible_models
            machines = [mid for model in fits for mid in by_model.get(model, [])] if fits else all_machines
            ordered = end - timedelta(days=rng.randrange(days))
            rows.append(_order(rng, pack, supplier_id, sku, ordered, rng.choice(machines), truth))

    for sku, machine_id, every, jitter, supplier_id in FAILURE_PATTERNS:
        d = end - timedelta(days=days)
        while (d := d + timedelta(days=every + rng.randint(-jitter, jitter))) <= end:
            rows.append(_order(rng, pack, supplier_id, sku, d, machine_id, TRUTH[supplier_id]))

    rows.sort(key=lambda r: r["ordered_at"])
    return rows
