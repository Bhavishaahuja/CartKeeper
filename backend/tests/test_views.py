"""db/views.sql against a real Postgres. Set CARTKEEPER_TEST_DATABASE_URL to run."""

import os
import uuid
from datetime import date
from pathlib import Path

import pytest

from backend.core.history import aggregate, seed_rows
from backend.core.packs import load_pack
from backend.core.score import SupplierStats

DSN = os.environ.get("CARTKEEPER_TEST_DATABASE_URL")
DB = Path(__file__).resolve().parents[2] / "db"

pytestmark = pytest.mark.skipif(not DSN, reason="CARTKEEPER_TEST_DATABASE_URL not set")


@pytest.fixture(scope="module")
def conn():
    import psycopg

    with psycopg.connect(DSN, autocommit=True) as c:
        schema = f"t_{uuid.uuid4().hex[:8]}"
        c.execute(f"create schema {schema}")
        c.execute(f"set search_path to {schema}")
        c.execute((DB / "schema.sql").read_text())
        c.execute((DB / "views.sql").read_text())
        yield c
        c.execute(f"drop schema {schema} cascade")


@pytest.fixture(scope="module")
def seeded(conn):
    pack = load_pack("manufacturing_textile")
    rows = seed_rows(pack, today=date(2026, 10, 1))
    company = uuid.uuid4()
    with conn.cursor() as cur:
        cur.executemany(
            "insert into purchase_orders (company_id, supplier_id, sku, machine_id, qty, total,"
            " ordered_at, promised_at, delivered_at, defect, source) values"
            " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [(company, r["supplier_id"], r["sku"], r["machine_id"], r["qty"], r["total"],
              r["ordered_at"], r["promised_at"], r["delivered_at"], r["defect"], r["source"]) for r in rows],
        )
    return rows


def test_reliability_view_matches_python_aggregate(conn, seeded):
    got = conn.execute(
        "select supplier_id, orders, on_time_orders, late_days_sum, defect_orders"
        " from vw_supplier_reliability order by supplier_id"
    ).fetchall()
    sql = [SupplierStats(sid, n, ot, float(late), d) for sid, n, ot, late, d in got]
    assert sql == aggregate(seeded)


def test_spend_shares_sum_to_one(conn, seeded):
    total = conn.execute("select sum(spend_share) from vw_spend_by_supplier").fetchone()[0]
    assert abs(float(total) - 1) < 0.001


def test_failure_cadence_finds_the_seeded_patterns(conn, seeded):
    rows = conn.execute("select sku, machine_id, avg_gap_days from vw_part_failure_cadence").fetchall()
    found = {(sku, m): float(gap) for sku, m, gap in rows}
    assert ("NDL-LATCH-28G", "K-02") in found
    assert 38 <= found[("NDL-LATCH-28G", "K-02")] <= 46
    assert ("TAPE-SPN-12", "S-05") in found
