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
4. **Mastra's built-in workflow API can resume a run without the app's approval checks**
   (`/api/workflows/purchase/resume`). This needs auth or blocking before deployment.

## Mapped cleanly

- `interrupt()` and `Command(resume=...)` map to `suspend()` / `resume()` with typed `suspendSchema` and
  `resumeSchema`. They survive a restart on LibSQL and Postgres, even three nested workflows deep.
- A suspended and resumed run stays a single trace, including when the resume happens in a new
  process (`test/workflow/tracing.test.ts`). The resumed root carries `resumedFromSpanId`.
- `Send` fan-out maps to `.parallel()` plus `.foreach({ concurrency })`.
- The checkpointer maps to `PostgresStore` / `LibSQLStore`, with no setup call.

## Didn't map directly

- A LangGraph conditional edge back to `propose` (the replan cycle) became a nested workflow in
  `.dountil()` with an explicit `retry` flag, since Mastra workflows are acyclic otherwise.
- LangGraph reducers (`add_quotes`) have no equivalent. The parallel outputs are merged in a
  `.map()`.
