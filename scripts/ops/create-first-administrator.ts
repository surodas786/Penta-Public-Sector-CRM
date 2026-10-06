/**
 * Creates the first System Administrator of an empty deployment (FR-001) and
 * prints a single-use invitation link, once. Refuses when an active
 * administrator already exists.
 *
 *   npm run ops:create-first-administrator -- --name "Full Name" --email person@penta.example
 *
 * Uses DATABASE_URL (the runtime role) and APP_ORIGIN. Deliver the link to the
 * person out of band; it expires in 72 hours and works once.
 */
import { randomUUID } from 'node:crypto';

import { createDatabase } from '../../server/db/client.js';
import { loadServerConfig } from '../../server/env.js';
import { bootstrapAdministrator } from '../../server/services/bootstrap.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Production supplies the environment directly.
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Usage: npm run ops:create-first-administrator -- --name "Full Name" --email person@example.com (missing --${name})`);
  return value;
}

async function main(): Promise<void> {
  const config = loadServerConfig();
  const database = createDatabase(config.databaseUrl);
  const requestId = `bootstrap-cli-${randomUUID()}`;
  try {
    const result = await bootstrapAdministrator(database.db, {
      fullName: argument('name'),
      email: argument('email'),
      appOrigin: config.appOrigin,
      requestId,
    });
    console.log(`Created the first System Administrator (audit request id ${requestId}).`);
    console.log(`Invitation link — shown once, valid until ${result.expiresAt}:`);
    console.log(result.invitationUrl);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('Not created:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
