/**
 * Empties a development or test database, then reloads the synthetic fixtures.
 *
 *   npm run db:reset
 *
 * Uses the same guard as the seed script, so it cannot touch production or any
 * database outside the explicit development/test allowlist.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { seedDatabase } from './seed.js';

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const useTestDatabase = process.argv.includes('--test');
  const variable = useTestDatabase ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';
  const connectionString = process.env[variable]?.trim();

  if (!connectionString) {
    console.error(`${variable} is not set. See .env.example.`);
    process.exit(1);
  }

  seedDatabase(connectionString)
    .then((summary) => {
      console.log(`Reset "${summary.databaseName}" to the synthetic fixture baseline.`);
    })
    .catch((error: unknown) => {
      console.error('Reset failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
