# Porting notes

A running log for the Phase 6 writeup: what mapped cleanly from LangGraph, what didn't, and rough
edges in Mastra worth an issue. Each rough edge has where it showed up and how to reproduce it.

## Rough edges

1. **An agent called inside a step is missing from the trace unless you pass `tracingContext`.**
   `agent.generate()` inside a step's `execute` produced no `agent_run` or model spans at all.
   Nothing errors, and the step spans look complete, so it's easy to miss. Passing the step's
   `tracingContext` to `generate()` fixes it (`src/purchase/model.ts`). The docs say the option is
   "automatically injected", which is true for agents used as steps but not for agents called from a
   step. Repro: a step that calls `agent.generate('hi')`, plus `TestExporter`; there are no
   `agent_run` spans.
2. **A custom `/health` route is silently shadowed** by Mastra's built-in one, which answers
   `{"success": true}`. `registerApiRoute('/health', ...)` is accepted and never runs.
3. **`.branch()` returns `{ [stepId]: output }`**, so every branch in this workflow is followed by a
   `.map()` that unwraps the one branch that ran (`takenBranch` in `src/purchase/workflow.ts`).
   LangGraph's shared state needs no equivalent.
4. **A scorer step that returns an array or `null` works in `scorer.run()` but fails to persist
   in an experiment.** Score storage validates `preprocessStepResult` as a record. The error is only
   logged (`Failed to save score ... expected record, received array`), and the experiment still
   reports the score, so the stored record is missing without any visible failure. Wrapping the
   result in an object fixes it (`src/evals/scorers.ts`).
5. **Mastra's built-in workflow API can resume a run without the app's approval checks**
   (`/api/workflows/purchase/resume`). This needs auth or blocking before deployment.

## Eval findings

1. **The first judge rubric was miscalibrated, and the calibration set caught it.** On the first real run
   (Sonnet vs Haiku, 3 runs, Opus judge), all 72 approval cards scored 0. Every card failed one criterion:
   "contains nothing false or contradictory and can be read in about 10 seconds". The judge timed it
   literally (about 110 words is "25 to 30 seconds") and failed 3 of the 5 good calibration cards for
   the same reason. Agreement with the hand labels was 7/10. Because the rubric scorer is
   all-or-nothing, one bad criterion zeroed the column. Fix: split it into "consistent with the figures
   shown" and "decision first, nothing repeated", and report unmet counts per criterion so this shows
   up directly next time.
2. **The judge also found real problems with the card.**
   - The card restated the whole request.
   - Its "Other quotes" line repeated figures.
   - The model's rationale cited figures the card didn't show ("half the defect rate" is true, 2.3%
     vs 4.6%, but couldn't be checked).
   - "Needed today" sat next to a 3-day delivery without comment.

   The card now leads with what, how many, supplier, total and arrival. It lists every quote once, with
   score, on-time and defect rates, and names the urgency in plain words.
3. **Second calibration check: 8/10, from two more wording bugs.**
   - "Urgency" only allowed "machine stopped" or "routine", so a card for the pack's middle level,
     "needed this week", couldn't pass it.
   - "Concise" penalized "repeated detail", which contradicted the supplier criterion: that one
     requires the rationale to cite figures shown on the card.

   Both are reworded. Caveat: the rubric has now been revised twice against the same 10 cards, so
   agreement on them is optimistic. A held-out set of fresh hand-labeled cards would give an unbiased
   figure.
4. **My calibration cards had wrong figures** (Precision "95% on time", which is really 93.6%).
   They're rewritten from the seed scores, in the production card layout.
5. **The model results that held up on the first run:**
   - HITL invariants, decision path and supplier choice were 100% for both models.
   - Intake was 100% for Sonnet and 98.1% for Haiku, which sometimes reads "planned maintenance next
     month" as urgent rather than routine.

## Mapped cleanly

- `interrupt()` and `Command(resume=...)` map to `suspend()` / `resume()` with typed `suspendSchema` and
  `resumeSchema`. They survive a restart on LibSQL and Postgres, even three nested workflows deep.
- A suspended and resumed run stays a single trace, including when the resume happens in a new
  process (`test/workflow/tracing.test.ts`). The resumed root carries `resumedFromSpanId`.
- `Send` fan-out maps to `.parallel()` plus `.foreach({ concurrency })`.
- Datasets and experiments with an inline `task` fit an eval that needs per-item setup (a fresh
  ledger, a simulated approver). The experiments show up in Studio for comparison.
- The checkpointer maps to `PostgresStore` / `LibSQLStore`, with no setup call.

## Didn't map directly

- A LangGraph conditional edge back to `propose` (the replan cycle) became a nested workflow in
  `.dountil()` with an explicit `retry` flag, since Mastra workflows are acyclic otherwise.
- LangGraph reducers (`add_quotes`) have no equivalent. The parallel outputs are merged in a
  `.map()`.
