"""Company data the graph reads and writes: budgets, members, executed orders, request index.

Day 2 keeps it in memory. Day 3 adds a Supabase-backed store with the same methods.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from .packs import Pack


def _now() -> datetime:
    return datetime.now(timezone.utc)


class InMemoryStore:
    def __init__(self, *, budgets: dict[str, float], members: list[dict]):
        self._lock = threading.Lock()
        self.budgets = dict(budgets)
        self.members = list(members)
        self.orders: list[dict] = []
        self.requests: dict[str, dict] = {}

    @classmethod
    def from_demo(cls, pack: Pack) -> InMemoryStore:
        demo = pack.demo_company
        if demo is None:
            raise ValueError(f"pack {pack.key!r} has no demo_company.json")
        return cls(budgets=demo.budgets, members=[m.model_dump() for m in demo.members])

    # budgets ---------------------------------------------------------------

    def budget(self, scope_key: str) -> float | None:
        return self.budgets.get(scope_key)

    def spent(self, scope_key: str, now: datetime | None = None) -> float:
        now = now or _now()
        with self._lock:
            return round(sum(
                o["total"] for o in self.orders
                if o["scope_key"] == scope_key
                and (o["ordered_at"].year, o["ordered_at"].month) == (now.year, now.month)
            ), 2)

    # people ----------------------------------------------------------------

    def members_with_role(self, role: str) -> list[dict]:
        return [m for m in self.members if m["role"] == role]

    def member(self, user_id: str) -> dict | None:
        return next((m for m in self.members if m["user_id"] == user_id), None)

    # orders ----------------------------------------------------------------

    def record_order(self, order: dict) -> bool:
        """Record an executed purchase once per request. Returns False if already recorded."""
        with self._lock:
            if any(o["request_id"] == order["request_id"] for o in self.orders):
                return False
            self.orders.append({"ordered_at": _now(), **order})
            return True

    # request index (for listing; the graph checkpoint is the source of truth) -----

    def upsert_request(self, request_id: str, **fields) -> dict:
        with self._lock:
            row = self.requests.setdefault(request_id, {"request_id": request_id, "created_at": _now()})
            row.update(fields, updated_at=_now())
            return dict(row)

    def list_requests(self, **match) -> list[dict]:
        with self._lock:
            rows = [dict(r) for r in self.requests.values()
                    if all(r.get(k) == v for k, v in match.items())]
        return sorted(rows, key=lambda r: r["created_at"], reverse=True)
