# Porting CartKeeper from LangGraph to Mastra

CartKeeper is an agentic purchasing system for small manufacturers. A technician types "loom L-03 is
down, drive motor burned out", and CartKeeper:
- reads the request into a structured need
- checks the storeroom
- asks every approved supplier for a quote, in parallel
- scores suppliers from the company's own order history
- lets a model pick, then puts the pick through a plain-code policy gate
- pauses for a human approval when policy requires one, re-checks policy before paying, and pays once

The Python version runs on LangGraph. I ported it to a Mastra workflow in TypeScript, kept every
safety guarantee, then added the piece Mastra doesn't have yet: evals for human-in-the-loop
behavior.

## How I know it's the same system

- **Unit parity:** the policy gate and supplier scoring return byte-identical results to the Python
  code on about 700 cases, including the reason strings. Python rounds ties to even and JS doesn't,
  so the port carries a small `pyRound`.
- **Behavior parity:** 17 shared scenarios run through both the LangGraph graph and the Mastra
  workflow with the same scripted model. They must match on status, options and scores, proposal,
  policy result, replan, approver, payment, final message, which model calls ran, and what reached
  the ledger. All 17 match.
- **Approvals survive a restart:** a request paused for approval survives a restart on LibSQL and on
  Postgres. Resuming twice, even at the same moment, pays once.

## What mapped cleanly

| LangGraph | Mastra |
| --- | --- |
| `interrupt()` / `Command(resume=…)` | `suspend()` / `run.resume()` with typed `suspendSchema` / `resumeSchema` |
| Postgres checkpointer | `PostgresStore` (LibSQL locally), no setup call |
| `Send` fan-out to N supplier nodes | `.parallel()` plus a nested workflow with `.foreach({ concurrency })` |
| Conditional edges | `.branch()` |
| FastAPI routes | `registerApiRoute()` on Mastra's own server, same contract and status codes |
| (no tracing in the Python version) | Mastra observability: one trace per request, intact across suspend, resume and a restart; Langfuse export |

The suspend/resume path was the part I expected to fight, and it was the easiest. A pause three
nested workflows deep resumes from a fresh process with the same trace.

## What didn't map directly

- **The replan cycle.** LangGraph allows a back-edge from `replan` to `propose`. Mastra workflows are
  acyclic, so propose, policy-check and replan became a nested workflow inside `.dountil()`, with an
  explicit retry flag and a hard cap of two rounds.
- **Shared state and reducers.** LangGraph merges node outputs into one state with reducers
  (`add_quotes`). In Mastra each step returns its output. I kept one purchase record flowing through
  every step, and merged the parallel outputs in a `.map()`.
- **`.branch()` output is keyed by step id**, so every branch is followed by a small `.map()` that
  unwraps the branch that ran.
- **Mastra's built-in workflow API is a second door.** `/api/workflows/purchase/resume` can resume a
  paused run without the app's approver checks. That's expected, but it has to be closed with server
  auth before deploying.

## The evals

There were 30 labeled requests:
- line-down, storeroom hits, every approval tier
- rejection, budget blocks and replans
- unapproved suppliers and missing approvers
- approvals that go stale while waiting
- ambiguous requests

Each request runs in isolation, and a simulated approver answers (including spend that lands during
the wait). Five scorers:

- **HITL invariants (code, read from the trace).** Paused when policy required it, never paid
  without approval, honored a rejection, re-checked policy after the wait, replanned at most once,
  paid at most once. The policy decision is recomputed independently from the pack, not read from the
  run.
- **Intake accuracy, supplier choice under line-down, decision path** (code).
- **Approver explanation** (Mastra's rubric judge): can an owner decide from the approval card at a
  glance?

The evals were themselves tested before any real run:
- A scripted "oracle" model scores 100% on every code scorer, which validates the labels.
- A cheapest-first buyer scores 0% on supplier choice and still keeps every safety invariant.
- Deliberately broken runs trip each invariant.

### Results (Sonnet vs Haiku, 3 runs each, Opus judge, 95% bootstrap intervals)

| | Sonnet | Haiku |
| --- | --- | --- |
| HITL invariants | 100% | 100% |
| Decision path | 100% | 100% |
| Supplier choice (line-down) | 100% | 100% |
| Intake accuracy | 100% | 97.5% [94.2, 100] |
| Approval card meets every criterion | 55.6% [33.3, 77.8] | 41.7% [19.4, 63.9] |

The judge agreed with hand labels on 9 of 10 calibration cards.

### What the HITL evals caught

- **The safety layer held for both models on every run.** The model can only pick an option id, and
  code re-checks everything else. Even a model that always buys cheapest can't pay without approval,
  ignore a rejection, or pay twice. The cheaper model's mistakes show up in what it buys and how it
  explains it, never in whether a check ran.
- **The first judge was miscalibrated, and the calibration set caught it.** Run 1 scored every
  approval card 0. One criterion ("readable in about 10 seconds") was being timed literally. The judge
  also failed 3 of 5 good hand-labeled cards, at 7/10 agreement. Without the calibration cards, that
  0% would have looked like a finding about the models.
- **Once calibrated, the judge found real product bugs:**
  - The model's explanation cited things the approver never sees: option ids ("opt-1"), supplier ids,
    "price weight 0.9", order counts.
  - After a budget block the card said "only one option remains" while listing two quotes.
  - The owner-tier line said "above every lower tier" instead of naming the limit.

  All of these are fixed: the prompt now writes for the approver, blocked quotes are marked, and the
  limit is stated. The fixes haven't been re-measured yet.
- **Haiku's one consistent misread** ("planned maintenance next month" read as "needed this week")
  was caught twice, independently: by intake accuracy, and by the judge spotting the contradiction on
  the card.

## Rough edges filed (drafts)

Each has a standalone repro in `issues/repros/`:
1. A scorer step result that isn't a record (an array, say) is silently not stored in experiments.
   The summary still reports the score.
2. A custom `/health` route is accepted but never runs; the built-in one answers.
3. An agent that isn't registered with Mastra, called inside a step, is missing from the trace with
   no warning.

## Where it goes next

- Re-run the evals to measure the card fixes.
- Add a held-out set of hand-labeled cards: the rubric was tuned on the 10 calibration cards, so
  agreement on them is optimistic.
- Port the PRD's Day 3+ work (Stripe Issuing, streaming, UI) behind the existing `execute` step.
- Possibly extract the HITL invariant scorer into a small package. It only needs a trace and the
  policy function.
