# CartKeeper on Mastra

The CartKeeper purchase graph, ported from LangGraph (Python, `../backend`) to a
Mastra workflow in TypeScript. Same packs, same policy, same numbers. The Python
version stays as the reference.

## Status

- **Phase 0 (done):** the deterministic core, with no LLM in it.
  - `src/core/packs.ts` loads `../packs/<pack>` with strict zod schemas plus the
    same cross-file checks as `packs.py`.
  - `src/core/score.ts` has the CartLens supplier scores with shrinkage toward the pooled rate.
  - `src/core/policy.ts` is the policy gate. The model proposes; this decides.
  - `src/core/history.ts` aggregates order history into the inputs for scoring.
- **Phase 1 (done):** the purchase workflow, in `src/purchase/`.
  - `workflow.ts` maps each LangGraph node to a Mastra step (the diagram is at the top of the file).
    - Supplier quotes fan out in `.parallel()` with a `.foreach()`.
    - Propose, policy check and replan form a nested workflow looped by `.dountil()`, at most two rounds.
    - The outcomes are a `.branch()`.
    - The approval wait is a `suspend()` with `suspendSchema` and `resumeSchema`.
  - `steps.ts` is the node logic, ported line by line from `nodes.py`.
  - `model.ts` holds the only two model calls: read a request into a Need, and pick one option id. Neither
    schema can carry a price, a total or a decision. In production these go through the
    `intake-agent` and `propose-agent` (no tools, structured output); tests use a fake.
  - `service.ts` is start / decide / snapshot. The request id is the run id, and every view is read
    back from storage, so a paused request looks the same after a restart.
  - `execute` re-checks policy before paying and pays with the idempotency key `ck-<runId>-execute`.
- **Phase 2 (done):** the FastAPI contract as Mastra custom routes, in `src/api/routes.ts`.
  - `POST /requests`, `GET /requests/:id`, `POST /requests/:id/decision` and `GET /approvals`, with
    the same `X-User-Id` demo users, visibility rules, approver checks, status codes and
    `{"detail": ...}` errors.
  - `GET /approvals` reads the stored suspended runs, so an approver's inbox survives a restart.
  - A per-request lock makes a double click resume once, and the payment idempotency key backs it up.
  - One difference: `/health` is Mastra's built-in route and answers `{"success": true}`.
  - Studio (`npm run dev`) shows the run fan out, pause and resume.
- Next: Phase 3, the remaining parity tests (most of the Day 2 behavior tests are already ported).

## Parity with Python

`test/parity.test.ts` checks that the TS port returns exactly what the Python
code returns, byte for byte, including reason strings and rounding. The
reference outputs come from Python:

```bash
npm run parity      # runs scripts/export_parity.py; needs the backend's Python deps
```

That script also writes `packs/<pack>/seed_history.json`, the seed order history
as plain rows, so the TS side doesn't have to replicate Python's RNG. Run it
again whenever `score.py`, `policy.py` or the pack's seed history changes.

`src/core/pyfmt.ts` holds the rounding helpers. Python rounds exact ties to
even, and JS `toFixed` rounds them up.

## Storage

Paused runs live in Mastra storage. With `DATABASE_URL` set (Supabase: use the Session pooler URL)
that is Postgres. Without it, it is a local LibSQL file. Budgets, members and orders are still in
memory, as in the Python Day 2 backend.

`test/workflow/durable.test.ts` pauses a request, closes the storage, then approves it from a new
Mastra instance with a new connection. It always runs on LibSQL, and also on Postgres when
`CARTKEEPER_TEST_DATABASE_URL` is set.

## Trying the API

```bash
curl -X POST localhost:4111/requests -H 'content-type: application/json' -H 'X-User-Id: u-tech-1' \
  -d '{"raw_request": "Replace drive motor on loom L-03"}'
```

```bash
curl localhost:4111/approvals -H 'X-User-Id: u-mm-1'
```

```bash
curl -X POST localhost:4111/requests/<id>/decision -H 'content-type: application/json' \
  -H 'X-User-Id: u-mm-1' -d '{"approval": "approved"}'
```

Demo users: `u-tech-1` (requester), `u-mm-1` (maintenance manager), `u-owner-1` (owner), `u-fin-1` (finance).

## Commands

```bash
npm install
npm test            # vitest
npm run typecheck
npm run dev         # Studio at http://localhost:4111 (needs CARTKEEPER_ANTHROPIC_API_KEY to run requests)
```
