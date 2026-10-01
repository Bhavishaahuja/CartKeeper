"""Company data the graph reads and writes: budgets, members, purchase history,
the request index and the audit log.

Two stores with the same methods:
- InMemoryStore: tests and keyless local runs. Order history starts from the pack's seed.
- PostgresStore: Supabase. purchase_orders holds seed and executed orders together, and
  supplier stats come from vw_supplier_reliability (db/views.sql).

Budgets count Cartkeeper's own orders only: seed history is there to learn supplier
reliability from, not to spend this month's budget.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone

from .history import aggregate, seed_rows
from .packs import Pack
from .score import SupplierStats


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(v) -> str | None:
    return v.isoformat() if isinstance(v, datetime) else v


def demo_company_id(pack: Pack) -> str:
    """Stable id for the pack's demo company, so every process and table agree on it."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"cartkeeper:{pack.key}:demo"))


class InMemoryStore:
    def __init__(self, *, budgets: dict[str, float], members: list[dict], history: list[dict] | None = None):
        self._lock = threading.Lock()
        self.budgets = dict(budgets)
        self.members = list(members)
        self.history = list(history or [])      # past purchase orders (seed), purchase_orders shape
        self.orders: list[dict] = []             # orders Cartkeeper executed
        self.requests: dict[str, dict] = {}
        self.audit_log: list[dict] = []

    @classmethod
    def from_demo(cls, pack: Pack) -> InMemoryStore:
        demo = pack.demo_company
        if demo is None:
            raise ValueError(f"pack {pack.key!r} has no demo_company.json")
        return cls(budgets=demo.budgets, members=[m.model_dump() for m in demo.members],
                   history=seed_rows(pack))

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

    # orders + history ------------------------------------------------------

    def record_order(self, order: dict) -> bool:
        """Record an executed purchase once per request. Returns False if already recorded."""
        with self._lock:
            if any(o["request_id"] == order["request_id"] for o in self.orders):
                return False
            self.orders.append({"ordered_at": _now(), "delivered_at": None, "defect": False, **order})
            return True

    def order(self, request_id: str) -> dict | None:
        with self._lock:
            return next((dict(o) for o in self.orders if o["request_id"] == request_id), None)

    def record_delivery(self, request_id: str, *, delivered_at: datetime, defect: bool) -> dict | None:
        """Goods received: this is what moves the supplier's reliability score."""
        with self._lock:
            for o in self.orders:
                if o["request_id"] == request_id:
                    o.update(delivered_at=delivered_at, defect=defect)
                    return dict(o)
        return None

    def history_rows(self) -> list[dict]:
        with self._lock:
            own = [
                {**o, "ordered_at": _iso(o["ordered_at"]), "promised_at": _iso(o["promised_at"]),
                 "delivered_at": _iso(o.get("delivered_at"))}
                for o in self.orders if o.get("supplier_id") and o.get("promised_at")
            ]
            return [*self.history, *own]

    def supplier_stats(self) -> list[SupplierStats]:
        return aggregate(self.history_rows())

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

    # audit -------------------------------------------------------------------

    def audit(self, request_id: str | None, node: str, action: str, *, rationale: str | None = None,
              actor: str | None = None, stripe_ref: str | None = None, detail: dict | None = None) -> None:
        with self._lock:
            self.audit_log.append({
                "id": len(self.audit_log) + 1, "request_id": request_id, "node": node, "action": action,
                "rationale": rationale, "actor": actor, "stripe_ref": stripe_ref, "detail": detail,
                "created_at": _now(),
            })

    def audit_rows(self, request_id: str | None = None) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self.audit_log if request_id is None or r["request_id"] == request_id]


# --- Postgres (Supabase) ---------------------------------------------------------

REQUEST_COLUMNS = ("status", "requester_id", "approver_id", "raw_request", "total", "urgency", "machine_id")


class PostgresStore:
    """Same methods as InMemoryStore, backed by db/schema.sql. `pool` yields dict-row connections."""

    def __init__(self, pool, company_id: str):
        self.pool = pool
        self.company_id = company_id

    def _all(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.pool.connection() as conn:
            return conn.execute(sql, params).fetchall()

    def _one(self, sql: str, params: tuple = ()) -> dict | None:
        with self.pool.connection() as conn:
            return conn.execute(sql, params).fetchone()

    # budgets ---------------------------------------------------------------

    def budget(self, scope_key: str) -> float | None:
        row = self._one("select amount from budgets where company_id = %s and scope_key = %s and period = 'month'",
                        (self.company_id, scope_key))
        return float(row["amount"]) if row else None

    def spent(self, scope_key: str, now: datetime | None = None) -> float:
        row = self._one(
            "select coalesce(sum(total), 0) as spent from purchase_orders"
            " where company_id = %s and scope_key = %s and source = 'cartkeeper'"
            " and date_trunc('month', ordered_at) = date_trunc('month', %s::timestamptz)",
            (self.company_id, scope_key, now or _now()),
        )
        return round(float(row["spent"]), 2)

    # people ----------------------------------------------------------------

    def members_with_role(self, role: str) -> list[dict]:
        return self._all("select user_id, name, role from members where company_id = %s and role = %s"
                         " order by user_id", (self.company_id, role))

    def member(self, user_id: str) -> dict | None:
        return self._one("select user_id, name, role from members where company_id = %s and user_id = %s",
                         (self.company_id, user_id))

    # orders + history ------------------------------------------------------

    def record_order(self, order: dict) -> bool:
        with self.pool.connection() as conn:
            cur = conn.execute(
                "insert into purchase_orders (company_id, request_id, scope_key, supplier_id, sku, machine_id,"
                " qty, total, card_id, ordered_at, promised_at, delivered_at, defect, source)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, coalesce(%s, now()), %s, %s, %s, 'cartkeeper')"
                " on conflict (request_id) do nothing",
                (self.company_id, order["request_id"], order.get("scope_key"), order["supplier_id"], order["sku"],
                 order.get("machine_id"), order["qty"], order["total"], order.get("card_id"),
                 order.get("ordered_at"), order["promised_at"], order.get("delivered_at"),
                 order.get("defect", False)),
            )
            return cur.rowcount == 1

    def order(self, request_id: str) -> dict | None:
        return self._one("select * from purchase_orders where company_id = %s and request_id = %s",
                         (self.company_id, request_id))

    def record_delivery(self, request_id: str, *, delivered_at: datetime, defect: bool) -> dict | None:
        with self.pool.connection() as conn:
            return conn.execute(
                "update purchase_orders set delivered_at = %s, defect = %s"
                " where company_id = %s and request_id = %s returning *",
                (delivered_at, defect, self.company_id, request_id),
            ).fetchone()

    def supplier_stats(self) -> list[SupplierStats]:
        rows = self._all(
            "select supplier_id, orders, on_time_orders, late_days_sum, defect_orders"
            " from vw_supplier_reliability where company_id = %s order by supplier_id", (self.company_id,))
        return [SupplierStats(r["supplier_id"], r["orders"], r["on_time_orders"], float(r["late_days_sum"]),
                              r["defect_orders"]) for r in rows]

    # request index -----------------------------------------------------------

    def upsert_request(self, request_id: str, **fields) -> dict:
        unknown = set(fields) - set(REQUEST_COLUMNS)
        if unknown:
            raise ValueError(f"unknown request fields: {sorted(unknown)}")
        cols = list(fields)
        sets = ", ".join(f"{c} = excluded.{c}" for c in cols)
        with self.pool.connection() as conn:
            return conn.execute(
                f"insert into requests (id, company_id{''.join(', ' + c for c in cols)})"
                f" values (%s, %s{', %s' * len(cols)})"
                f" on conflict (id) do update set {sets + ', ' if sets else ''}updated_at = now()"
                " returning id as request_id, *",
                (request_id, self.company_id, *fields.values()),
            ).fetchone()

    def list_requests(self, **match) -> list[dict]:
        unknown = set(match) - set(REQUEST_COLUMNS)
        if unknown:
            raise ValueError(f"unknown request fields: {sorted(unknown)}")
        where = "".join(f" and {c} = %s" for c in match)
        return self._all(
            f"select id as request_id, * from requests where company_id = %s{where} order by created_at desc",
            (self.company_id, *match.values()),
        )

    # audit -------------------------------------------------------------------

    def audit(self, request_id: str | None, node: str, action: str, *, rationale: str | None = None,
              actor: str | None = None, stripe_ref: str | None = None, detail: dict | None = None) -> None:
        with self.pool.connection() as conn:
            conn.execute(
                "insert into audit_log (company_id, request_id, node, action, rationale, actor, stripe_ref, detail)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s)",
                (self.company_id, request_id, node, action, rationale, actor, stripe_ref,
                 json.dumps(detail, default=str) if detail is not None else None),
            )

    def audit_rows(self, request_id: str | None = None) -> list[dict]:
        if request_id is None:
            return self._all("select * from audit_log where company_id = %s order by id", (self.company_id,))
        return self._all("select * from audit_log where company_id = %s and request_id = %s order by id",
                         (self.company_id, request_id))
