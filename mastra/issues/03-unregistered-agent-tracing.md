# An unregistered agent called inside a workflow step is missing from the trace, with no warning

## Summary

When a step calls an `Agent` that was never registered on the `Mastra` instance, for example one
imported from a module or built per test, the agent run produces no spans at all. Nothing errors or
warns, and the workflow's step spans look complete. Passing the step's `tracingContext` to
`generate()` fixes it, and so does registering the agent and using `mastra.getAgent()`.

That makes sense once you know it, but it's easy to miss. We only noticed because a test asserted
on `agent_run` spans. In production the agent was registered, so tracing worked there.

## Repro

`@mastra/core` 1.85.0, `@mastra/observability` 1.24.2:

```ts
const agent = new Agent({ id: 'helper', name: 'helper', instructions: 'Say hi.', model });  // not registered
const step = createStep({
  id: 'ask', inputSchema: z.object({}), outputSchema: z.object({ text: z.string() }),
  execute: async ({ tracingContext }) => ({ text: (await agent.generate('hello' /*, { tracingContext } */)).text }),
});
// Mastra with this workflow and an Observability TestExporter.
// Without tracingContext: agent_run spans = 0. With it: 1, in the workflow's trace.
```

Full script: `repros/unregistered-agent-tracing.mts`.

## Suggestion

One of these:
- When `generate()` runs inside a step's async context with no `tracingContext`, inherit the
  current span.
- Log a one-time warning that the agent has no observability instance.
- Add a line to the "Agents in workflows" docs: call registered agents through `mastra.getAgent()`,
  or pass `tracingContext`.
