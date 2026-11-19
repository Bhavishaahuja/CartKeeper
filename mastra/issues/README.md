# Draft issues for Mastra

Rough edges found while porting CartKeeper to Mastra. Each one has a standalone repro in `repros/`
that runs with no API key:

```bash
npx tsx issues/repros/<name>.mts
```

All of them were reproduced on `@mastra/core` 1.85.0, `@mastra/deployer` 1.85.0, `@mastra/libsql`
1.31.1 and Node 22. These are drafts: check the current Mastra issues for duplicates and re-run the
repro on the latest version before filing.

| Draft | Severity | Repro |
| --- | --- | --- |
| [Scorer step results that aren't records are silently not stored](01-scorer-step-result-not-stored.md) | Data loss, silent | `scorer-array-step-result.mts` |
| [A custom `/health` route is accepted but never runs](02-health-route-shadowed.md) | Surprising, silent | `health-route-shadowed.mts` |
| [An unregistered agent called in a step is missing from the trace](03-unregistered-agent-tracing.md) | Docs / warning | `unregistered-agent-tracing.mts` |

Not filed, because they're by design or specific to this app:
- **`.branch()` returns `{ [stepId]: output }`.** This needs an unwrap `.map()` after every branch.
- **Mastra's built-in `/api/workflows/:id/resume` bypasses an app's own approval checks.** That's
  expected: protect `/api/*` with server auth before deploying.
