# A custom `/health` route is accepted but never runs

## Summary

`registerApiRoute('/health', ...)` is accepted without error, but requests to `/health` get the
built-in response `{"success":true}` and the custom handler never runs. Other custom paths, such as
`/healthz`, work. Apps porting an existing API contract that defines `/health` (FastAPI apps often
do) silently get a different body.

## Repro

`@mastra/core` / `@mastra/deployer` 1.85.0:

```ts
const mastra = new Mastra({
  server: {
    apiRoutes: [
      registerApiRoute('/health', { method: 'GET', handler: async (c) => c.json({ ok: true, from: 'custom' }) }),
      registerApiRoute('/healthz', { method: 'GET', handler: async (c) => c.json({ ok: true, from: 'custom' }) }),
    ],
  },
});
const app = await createHonoServer(mastra, { tools: {} });
await app.request('/health');   // 200 {"success":true}             <- built-in
await app.request('/healthz');  // 200 {"ok":true,"from":"custom"}
```

Full script: `repros/health-route-shadowed.mts`.

## Expected

One of these:
- The custom route wins.
- `registerApiRoute` throws or warns that `/health` is reserved, the way the docs already describe
  for the `/api` prefix.

## Actual

The custom route is accepted and silently shadowed.
