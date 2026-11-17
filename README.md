# Cartkeeper

Agentic purchasing for small and mid-size manufacturers. See [PRD.md](PRD.md).

## Run it locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env          # then add your ANTHROPIC_API_KEY

python -m backend.core.graph "Loom L-07 heald wires snapped, need 500 today"
python -m backend.core.graph "Need 2 x 6205 bearings for spinning frame S-04"   # storeroom hit

uvicorn backend.main:app --reload    # API on http://localhost:8000/docs

pytest                 # offline tests (fake LLM)
pytest -m live         # T1 + T3 against the real model (needs ANTHROPIC_API_KEY)

# SQL view tests run when a Postgres URL is set:
CARTKEEPER_TEST_DATABASE_URL=postgresql://localhost/cartkeeper_test pytest
```

## API (Day 2)

Until login lands (Day 5), send `X-User-Id` with a demo member: `u-tech-1` (technician),
`u-mm-1` (maintenance manager), `u-owner-1` (owner), `u-fin-1` (finance).

```bash
curl -X POST localhost:8000/requests -H 'X-User-Id: u-tech-1' -H 'Content-Type: application/json' \
     -d '{"raw_request": "Replace drive motor on loom L-03"}'
curl localhost:8000/approvals -H 'X-User-Id: u-mm-1'
curl -X POST localhost:8000/requests/<id>/decision -H 'X-User-Id: u-mm-1' \
     -H 'Content-Type: application/json' -d '{"approval": "approved"}'
```

Set `DATABASE_URL` (Supabase **Session pooler**, port 5432) so requests waiting for approval
survive a restart. Without it they're kept in memory.
