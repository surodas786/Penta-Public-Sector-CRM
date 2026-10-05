/**
 * Runs once before the whole suite.
 *
 * Plan 7.6 requires the harness to reject production execution, a missing test
 * configuration, and a TEST_DATABASE_URL that actually points at the
 * development database. It then applies the committed migrations, so the suite
 * always runs against the real schema rather than an ad-hoc one.
 */
import { resolveTestDatabaseUrl, sameDatabase } from '../env.js';
import { runMigrations } from '../db/migrate.js';

export async function setup(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // CI supplies the environment directly.
  }
  process.env.NODE_ENV = 'test';

  // Throws on production, on a missing TEST_DATABASE_URL, and when the test
  // URL resolves to the same database as DATABASE_URL.
  const runtimeUrl = resolveTestDatabaseUrl();

  const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
  if (!migrationUrl) {
    throw new Error(
      'TEST_MIGRATION_DATABASE_URL is not set. Tests apply the committed migrations with the ' +
        'schema-owner role before running. See .env.example.',
    );
  }
  if (!sameDatabase(migrationUrl, runtimeUrl)) {
    throw new Error(
      'TEST_MIGRATION_DATABASE_URL and TEST_DATABASE_URL must address the same database ' +
        '(different roles, same database).',
    );
  }

  await runMigrations(migrationUrl);
}
