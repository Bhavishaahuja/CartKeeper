import { Mastra } from '@mastra/core/mastra';
import { cartkeeperRoutes } from '../api/routes';
import { supplierScoresFromSeed } from '../core/history';
import { loadPack } from '../core/packs';
import { StubPayments } from '../core/payments';
import { InMemoryStore } from '../core/store';
import { agentModel } from '../purchase/model';
import { createPurchaseWorkflow } from '../purchase/workflow';
import { intakeAgent, proposeAgent } from './agents';
import { makeObservability } from './observability';
import { makeStorage } from './storage';

/**
 * CartKeeper on Mastra: the purchase workflow, its two agents, and durable
 * storage for runs paused on approval (Postgres when DATABASE_URL is set).
 *
 * Budgets, members and orders are in memory for now, as in the Python Day 2
 * backend, so they reset on restart; paused runs do not.
 */

export const PACK_KEY = process.env.CARTKEEPER_PACK ?? 'manufacturing_textile';

const pack = loadPack(PACK_KEY);
export const store = InMemoryStore.fromDemo(pack);
export const payments = new StubPayments();

export const purchase = createPurchaseWorkflow({
  pack,
  store,
  payments,
  model: agentModel(intakeAgent, proposeAgent),
  supplierScores: supplierScoresFromSeed(pack),
});

export const mastra = new Mastra({
  agents: { intakeAgent, proposeAgent },
  workflows: { purchase },
  storage: makeStorage(),
  observability: makeObservability(),
  server: { apiRoutes: cartkeeperRoutes({ pack, store }) },
});
