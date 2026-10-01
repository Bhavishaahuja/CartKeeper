"""Postgres (Supabase) setup: connection pool, schema, demo company seed.

    python -m backend.core.db setup      # apply db/*.sql and seed the demo company (idempotent)
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from .history import seed_rows
from .packs import Pack, load_pack
from .store import demo_company_id

DB_DIR = Path(__file__).resolve().parents[2] / "db"

log = logging.getLogger("cartkeeper")


def make_pool(database_url: str, *, max_size: int = 5):
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool

    return ConnectionPool(
        database_url,
        min_size=1,
        max_size=max_size,
        open=True,
        # prepare_threshold=0 keeps it working behind Supabase's connection pooler.
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    )


def apply_schema(pool) -> None:
    with pool.connection() as conn:
        for name in ("schema.sql", "views.sql"):
            # Multi-statement scripts can't be prepared (the pool prepares everything by default).
            conn.execute((DB_DIR / name).read_text(), prepare=False)


def seed_demo_company(pool, pack: Pack, company_id: str | None = None) -> str:
    """Create the pack's demo company with members, budgets, suppliers and seed order history.

    Re-running changes nothing that's already there, including budgets edited since.
    """
    demo = pack.demo_company
    if demo is None:
        raise ValueError(f"pack {pack.key!r} has no demo_company.json")
    company_id = company_id or demo_company_id(pack)
    with pool.connection() as conn, conn.transaction():
        conn.execute("insert into companies (id, name, industry_pack) values (%s, %s, %s)"
                     " on conflict (id) do nothing", (company_id, demo.name, pack.key))
        with conn.cursor() as cur:
            cur.executemany(
                "insert into members (company_id, user_id, name, role) values (%s, %s, %s, %s)"
                " on conflict do nothing",
                [(company_id, m.user_id, m.name, m.role) for m in demo.members])
            cur.executemany(
                "insert into budgets (company_id, scope_key, amount) values (%s, %s, %s) on conflict do nothing",
                [(company_id, k, v) for k, v in demo.budgets.items()])
            cur.executemany(
                "insert into suppliers (company_id, supplier_id, name, categories, approved)"
                " values (%s, %s, %s, %s, %s) on conflict do nothing",
                [(company_id, s.supplier_id, s.name, list(s.categories), s.approved) for s in pack.suppliers])
        has_seed = conn.execute("select 1 from purchase_orders where company_id = %s and source = 'seed' limit 1",
                                (company_id,)).fetchone()
        if not has_seed:
            rows = seed_rows(pack)
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into purchase_orders (company_id, scope_key, supplier_id, sku, machine_id, qty, total,"
                    " ordered_at, promised_at, delivered_at, defect, source)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    [(company_id, pack.scope_key(r["machine_id"]), r["supplier_id"], r["sku"], r["machine_id"],
                      r["qty"], r["total"], r["ordered_at"], r["promised_at"], r["delivered_at"], r["defect"],
                      r["source"]) for r in rows])
            log.info("seeded %d historical purchase orders", len(rows))
    return company_id


def setup(pool, pack: Pack) -> str:
    apply_schema(pool)
    return seed_demo_company(pool, pack)


def main(argv: list[str]) -> int:
    from dotenv import load_dotenv

    if argv != ["setup"]:
        print("usage: python -m backend.core.db setup", file=sys.stderr)
        return 2
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2
    pack = load_pack(os.environ.get("CARTKEEPER_PACK", "manufacturing_textile"))
    pool = make_pool(url)
    try:
        company_id = setup(pool, pack)
    finally:
        pool.close()
    print(f"Schema applied. Demo company {company_id} ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
