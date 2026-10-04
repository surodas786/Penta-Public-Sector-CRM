/**
 * Database access for the application runtime.
 *
 * Connects as the restricted role from DATABASE_URL — no DDL, and no UPDATE or
 * DELETE on audit_events. Migrations use a different role entirely.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema.js';

/**
 * NUMERIC must arrive as a string. node-postgres already does this for
 * OID 1700, but we pin it so a future driver default cannot silently turn BDT
 * amounts into floats (plan 4.2).
 */
pg.types.setTypeParser(1700, (value) => value);
/** DATE (OID 1082) stays a plain YYYY-MM-DD string, never a JS Date. */
pg.types.setTypeParser(1082, (value) => value);

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'penta-crm',
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

export { schema };
