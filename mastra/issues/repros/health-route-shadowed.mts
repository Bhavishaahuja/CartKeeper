/**
 * Repro: a custom /health route is accepted but never runs; the built-in one answers.
 * Run: npx tsx issues/repros/health-route-shadowed.mts
 */
import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { createHonoServer } from '@mastra/deployer/server';

const mastra = new Mastra({
  logger: false,
  server: {
    apiRoutes: [
      registerApiRoute('/health', { method: 'GET', handler: async (c) => c.json({ ok: true, from: 'custom' }) }),
      registerApiRoute('/healthz', { method: 'GET', handler: async (c) => c.json({ ok: true, from: 'custom' }) }),
    ],
  },
});
const app = await createHonoServer(mastra, { tools: {} } as never);
for (const path of ['/health', '/healthz']) {
  const r = await app.request(path);
  console.log(path, r.status, await r.text());
}
