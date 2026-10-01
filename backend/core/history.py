"""Purchase-order history.

Day 1 reads the pack's synthetic seed history in memory. Day 3 swaps the source
for Supabase, where db/views.sql does the same aggregation as `aggregate()`.
"""

from __future__ import annotations

import importlib.util
from datetime import datetime

from .packs import Pack
from .score import SupplierStats


def seed_rows(pack: Pack, **kwargs) -> list[dict]:
    if pack.seed_history is None:
        return []
    spec = importlib.util.spec_from_file_location(f"cartkeeper_seed_{pack.key}", pack.seed_history)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.generate(pack, **kwargs)


def aggregate(rows: list[dict]) -> list[SupplierStats]:
    """Python mirror of vw_supplier_reliability. Undelivered orders are skipped."""
    acc: dict[str, list] = {}
    for r in rows:
        if not r.get("delivered_at"):
            continue
        days_late = (
            datetime.fromisoformat(r["delivered_at"]).date()
            - datetime.fromisoformat(r["promised_at"]).date()
        ).days
        a = acc.setdefault(r["supplier_id"], [0, 0, 0.0, 0])
        a[0] += 1
        a[1] += days_late <= 0
        a[2] += max(days_late, 0)
        a[3] += bool(r["defect"])
    return [SupplierStats(sid, *a) for sid, a in sorted(acc.items())]
