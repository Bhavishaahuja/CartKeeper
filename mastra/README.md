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
- Next: Phase 1, the purchase workflow (`createWorkflow` / `createStep`, suspend and resume for approval).

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

## Commands

```bash
npm install
npm test            # vitest
npm run typecheck
npm run dev         # Studio at http://localhost:4111
```
