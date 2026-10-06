/**
 * One-off document maintenance (SEC-010): removes abandoned staged uploads and
 * orphaned files, then retries scans still pending. The API server also runs
 * this every 15 minutes.
 *
 *   npm run documents:maintain
 */
import { randomUUID } from 'node:crypto';

import { createDocumentServices } from '../app.js';
import { loadServerConfig } from '../env.js';
import { cleanupAbandonedUploads, scanPendingRevisions } from '../services/documents.js';
import { createDatabase } from './client.js';

async function main(): Promise<void> {
  const config = loadServerConfig();
  const database = createDatabase(config.databaseUrl);
  try {
    const services = createDocumentServices(database, config);
    const cleaned = await cleanupAbandonedUploads(services);
    const rescanned = await scanPendingRevisions(services, `maintenance-${randomUUID()}`);
    console.log(
      `Removed ${cleaned.expiredUploads} expired uploads and ${cleaned.orphanedFiles} orphaned files. ` +
        (services.scanner.available
          ? `Retried ${rescanned} pending scans with ${services.scanner.name}.`
          : 'No scanner is configured, so pending files stay unavailable.'),
    );
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('Document maintenance failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
