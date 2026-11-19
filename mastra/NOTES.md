# Porting notes

A running log for the Phase 6 writeup: what mapped cleanly from LangGraph, what didn't, and rough
edges in Mastra worth an issue. Each rough edge has where it showed up and how to reproduce it.

## Rough edges

Drafts with standalone repros for the first, second and fourth are in `issues/`.

1. **An agent that isn't registered with Mastra is missing from the trace when called in a step.**
   It produces no `agent_run` or model spans, with no error or warning. A registered agent fetched
   with `mastra.getAgent()` is traced either way. My first note here blamed agents called from steps in
   general; the minimal repro showed the cause is registration. Our tests built agents per test
   without registering them. The app passes the step's `tracingContext` (`src/purchase/model.ts`), so
   both cases are traced. Repro: `issues/repros/unregistered-agent-tracing.mts`.
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
6. **Third run (rubric fixed, judge 9/10): the judge found product bugs.** Cards meeting every
   criterion: Sonnet 55.6% [33.3, 77.8], Haiku 41.7% [19.4, 63.9]. Most misses were "consistent":
   - **The rationale leaked internal data** the approver never sees: "opt-1", "SUP-02", "price
     weight 0.9", "200 orders", "1 day average lateness". The model reads them in its context. Fix: the
     propose prompt now says the rationale is shown to the approver and may cite only the card's
     figures, by supplier name. This prompt diverges from the Python backend's on purpose; behavior
     parity is unaffected.
   - **After a replan, "only one option remains"** sat next to a card listing two quotes. The card
     now marks quotes that failed policy as "(blocked by policy)".
   - **"Score 93.6" next to "93.6% on time" read as a copying error.** It's a real coincidence in the
     data, so scores now show as "reliability 93.6/100".
   - **Haiku's urgency misread** ("next month" read as "needed this week") showed up on the card, and
     the judge flagged the contradiction independently of the intake scorer.
   - **The one calibration disagreement was fair:** "(above every lower tier)" doesn't name the limit.
     The card now says "$1,680.00 is over the $1,500.00 maintenance manager limit, so it needs owner
     approval", and says when nobody holds a role and who gets it instead.

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
