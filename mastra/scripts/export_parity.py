"""Write the Python reference outputs the TypeScript port is tested against.

Run from the repo root:  python mastra/scripts/export_parity.py

Writes:
  packs/<pack>/seed_history.json        the seed order history as plain rows, so the
                                        TS side doesn't need to replicate Python's RNG
  mastra/test/fixtures/parity.json      score_suppliers and check_policy outputs over a
                                        grid of inputs; vitest asserts exact equality
"""

from __future__ import annotations

import itertools
import json
import random
import sys
from dataclasses import asdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.core.history import aggregate, seed_rows  # noqa: E402
from backend.core.packs import PACKS_DIR, load_pack  # noqa: E402
from backend.core.policy import check_policy  # noqa: E402
from backend.core.score import SupplierStats, score_suppliers  # noqa: E402

PACK_KEY = "manufacturing_textile"
SEED_TODAY = date(2026, 10, 1)  # aggregates don't depend on it; fixed so the file is stable


def dump(path: Path, data, *, compact: bool = False) -> None:
    text = json.dumps(data, sort_keys=True, separators=(",", ":")) if compact else json.dumps(data, indent=1)
    path.write_text(text + "\n")


def score_cases(pack) -> list[dict]:
    weights = pack.config.scoring_weights.model_dump()
    alt = {"on_time_rate": 0.1, "avg_days_late": 0.0, "defect_rate": 0.9}
    cases = []
    seed_stats = aggregate(seed_rows(pack, today=SEED_TODAY))
    ids = [s.supplier_id for s in pack.suppliers]
    cases.append({"name": "seed", "stats": seed_stats, "weights": weights, "supplier_ids": ids})
    cases.append({"name": "seed_alt_weights", "stats": seed_stats, "weights": alt, "supplier_ids": ids})
    cases.append({"name": "empty", "stats": [], "weights": weights, "supplier_ids": ["x", "y"]})

    rng = random.Random(11)
    for i in range(40):
        stats = []
        for j in range(rng.randint(1, 6)):
            n = rng.choice([0, 1, 2, 3, 5, 19, 20, 21, 50, 200, 2000])
            on_time = rng.randint(0, n)
            late = round(rng.uniform(0, 8) * (n - on_time), rng.choice([0, 1, 2]))
            defects = rng.randint(0, n)
            stats.append(SupplierStats(f"s{j}", n, on_time, late, defects))
        w = rng.choice([weights, alt, {"on_time_rate": 0.34, "avg_days_late": 0.33, "defect_rate": 0.33}])
        extra = rng.choice([[], ["new"], ["s0", "new", "other"]])
        cases.append({"name": f"random_{i}", "stats": stats, "weights": w, "supplier_ids": extra})

    out = []
    for c in cases:
        out.append({
            "name": c["name"],
            "stats": [asdict(s) for s in c["stats"]],
            "weights": c["weights"],
            "supplier_ids": c["supplier_ids"],
            "expected": score_suppliers(c["stats"], c["weights"], c["supplier_ids"]),
        })
    return out


def policy_cases(pack, seed_scores) -> list[dict]:
    good = {s.supplier_id: {"score": 90} for s in pack.suppliers}
    score_sets = {
        "seed": {k: {"score": v["score"]} for k, v in seed_scores.items()},
        "good": good,
        "sup01_low": {**good, "SUP-01": {"score": 55}},
        "sup02_edge": {**good, "SUP-02": {"score": 60}},
        "sup02_just_under": {**good, "SUP-02": {"score": 59.9}},
        "none": {},
    }
    pairs = [(sku, s.supplier_id) for s in pack.suppliers for sku in s.price_list]
    pairs += [("MADE-UP-SKU", "SUP-02"), ("DYE-RB5-KG", "SUP-02"), ("HW-330-OMNI", "SUP-99")]
    qtys = [0, 1, 2, 7, 20, 62, 200, 789, 790, 2000]
    budgets = [(3000, 0), (3000, 2110), (3000, 2500), (5000, 0), (None, 0), (100, 150)]
    rng = random.Random(5)
    out = []
    for (sku, sup), qty, (budget, spent), (score_name, scores) in itertools.product(
        pairs, qtys, budgets, score_sets.items()
    ):
        if rng.random() > 0.05:  # keep the fixture a sane size
            continue
        proposal = {"sku": sku, "supplier_id": sup, "qty": qty}
        result = check_policy(proposal, pack=pack, supplier_scores=scores,
                              scope_key="line_2", budget=budget, spent=spent)
        out.append({"proposal": proposal, "scores": score_name, "budget": budget,
                    "spent": spent, "scope_key": "line_2", "expected": result})
    return {"score_sets": score_sets, "cases": out}


def main() -> None:
    pack = load_pack(PACK_KEY)
    rows = seed_rows(pack, today=SEED_TODAY)
    dump(PACKS_DIR / PACK_KEY / "seed_history.json", rows)

    seed_scores = score_suppliers(
        aggregate(rows), pack.config.scoring_weights.model_dump(),
        supplier_ids=[s.supplier_id for s in pack.suppliers],
    )
    parity = {
        "pack": PACK_KEY,
        "aggregate": {"rows": len(rows), "expected": [asdict(s) for s in aggregate(rows)]},
        "seed_scores": seed_scores,
        "score": score_cases(pack),
        "policy": policy_cases(pack, seed_scores),
    }
    dump(ROOT / "mastra" / "test" / "fixtures" / "parity.json", parity, compact=True)
    print(f"seed rows: {len(rows)}, score cases: {len(parity['score'])}, "
          f"policy cases: {len(parity['policy']['cases'])}")


if __name__ == "__main__":
    main()
