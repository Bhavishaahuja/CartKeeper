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
pytest -m stripe       # T2, T7, T8 against Stripe test mode (needs STRIPE_SECRET_KEY)

# SQL view, durable-pause and Postgres store tests run when a Postgres URL is set:
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

## Payments, audit, history (Day 3)

Every purchase gets a **single-use Stripe Issuing virtual card** whose all-time spending limit is
the approved total. The supplier's charge is simulated with Issuing test helpers (authorize, then capture).
The card itself refuses an overcharge, and because the limit is used up it refuses any reuse too.
Every Stripe write uses an idempotency key `ck-{request_id}-{step}`.

- `STRIPE_SECRET_KEY` unset: payments are simulated in memory (same behaviour, no Stripe calls).
- Set: must be a test key (`sk_test_` or `rk_test_`), or the app refuses to boot.
- Accounts that fund Issuing from a v2 financial account: the account is found automatically
  (or set `STRIPE_FINANCIAL_ACCOUNT_ID`). It must be **open**; a pending one can't issue cards.

With `DATABASE_URL` set, the API applies `db/schema.sql` + `db/views.sql` and seeds the demo company on
startup (idempotent; or run `python -m backend.core.db setup`). Executed orders are written to
`purchase_orders`, and every step goes to `audit_log`. Supplier scores are recomputed from history on each
run, so recording a delivery changes the next run's scores.

```bash
# T7: the supplier tries to charge more than the card allows (owner/finance, test mode)
curl -X POST localhost:8000/requests/<id>/supplier-charge -H 'X-User-Id: u-owner-1' \
     -H 'Content-Type: application/json' -d '{"amount": 120}'          # -> approved: false, spending_controls
# Goods arrived: late and/or defective deliveries lower the supplier's score
curl -X POST localhost:8000/requests/<id>/receipt -H 'X-User-Id: u-tech-1' \
     -H 'Content-Type: application/json' -d '{"defect": true}'
curl localhost:8000/suppliers/scorecard -H 'X-User-Id: u-owner-1'
curl localhost:8000/requests/<id>/audit -H 'X-User-Id: u-owner-1'    # the "why" trail

pytest -m stripe     # T2, T7, T8 against Stripe test mode (shows up under Issuing in the dashboard)
```
