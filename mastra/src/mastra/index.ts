import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';

/**
 * CartKeeper on Mastra.
 *
 * Phase 0 ports the deterministic core (pack loading, CartLens supplier scores,
 * the policy gate) in src/core. The purchase workflow, agents and Postgres
 * storage arrive in Phase 1; until then Studio runs on a local LibSQL file.
 */
export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: 'cartkeeper-storage',
    url: process.env.CARTKEEPER_MASTRA_DB_URL ?? 'file:./mastra.db',
  }),
});
