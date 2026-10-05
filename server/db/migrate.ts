/**
 * Applies the committed SQL migrations using the schema-owner role.
 *
 *   npm run db:migrate         development database
 *   npm run db:migrate:test    test database
 *
 * Re-running is safe: drizzle records applied migrations and skips them.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, 'migrations');

function resolveConnectionString(useTestDatabase: boolean): string {
  const name = useTestDatabase ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Migrations run as the schema owner, not as the application role. ` +
        'See .env.example.',
    );
  }
  return value;
}

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1, application_name: 'penta-crm-migrate' });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const useTestDatabase = process.argv.includes('--test');
  const connectionString = resolveConnectionString(useTestDatabase);
  const target = new URL(connectionString).pathname.replace(/^\//, '');

  runMigrations(connectionString)
    .then(() => {
      console.log(`Migrations applied to "${target}".`);
    })
    .catch((error: unknown) => {
      console.error('Migration failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
