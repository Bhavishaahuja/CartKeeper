"""Where paused graph runs live.

With DATABASE_URL set, checkpoints go to Postgres (Supabase), so a request waiting
for approval survives a server restart. Without it, they live in memory and are
lost on restart, which is fine for local experiments only.
"""

from __future__ import annotations

import logging

from langgraph.checkpoint.memory import InMemorySaver

log = logging.getLogger("cartkeeper")


def make_checkpointer(database_url: str | None):
    """Return (checkpointer, close). Call close() on shutdown."""
    if not database_url:
        log.warning("DATABASE_URL not set: paused requests are kept in memory and lost on restart")
        return InMemorySaver(), lambda: None

    from langgraph.checkpoint.postgres import PostgresSaver
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool

    pool = ConnectionPool(
        database_url,
        min_size=1,
        max_size=5,
        open=True,
        # prepare_threshold=0 keeps it working behind Supabase's connection pooler.
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    )
    saver = PostgresSaver(pool)
    saver.setup()  # creates the checkpoint tables if they don't exist
    return saver, pool.close
