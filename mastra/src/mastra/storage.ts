import { LibSQLStore } from '@mastra/libsql';
import { PostgresStore } from '@mastra/pg';

/**
 * Where workflow snapshots live, including runs paused for approval.
 *
 * With DATABASE_URL set (Supabase: use the Session pooler URL), snapshots go to
 * Postgres and a paused request survives a restart. Without it, a local LibSQL
 * file does the same job for development.
 */
export function makeStorage(databaseUrl = process.env.DATABASE_URL, id = 'cartkeeper') {
  if (databaseUrl) {
    return new PostgresStore({ id: `${id}-pg`, connectionString: databaseUrl, max: 5 });
  }
  return new LibSQLStore({ id: `${id}-libsql`, url: process.env.CARTKEEPER_MASTRA_DB_URL ?? 'file:./mastra.db' });
}
