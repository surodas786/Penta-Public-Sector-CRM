/**
 * Server entry point.
 *
 *   npm run dev:server     tsx watch, reads .env
 *   node dist-server/server/index.js   after `npm run build:server`
 */
import { randomUUID } from 'node:crypto';

import { createApp, createDocumentServices } from './app.js';
import { createDatabase } from './db/client.js';
import { loadServerConfig } from './env.js';
import { describeForLog } from './http/errors.js';
import { cleanupAbandonedUploads, scanPendingRevisions } from './services/documents.js';

/** Abandoned-upload cleanup and pending-scan retry (SEC-010). */
const DOCUMENT_MAINTENANCE_INTERVAL_MS = 15 * 60_000;

async function main(): Promise<void> {
  const config = loadServerConfig();
  const database = createDatabase(config.databaseUrl);

  // Fail fast on a bad connection rather than at the first request.
  const probe = await database.pool.connect();
  probe.release();

  const app = createApp({ database, config });

  if (config.documents.scanner === 'none') {
    console.warn(
      'DOCUMENT_SCANNER=none: uploaded documents are stored but stay unavailable until a scanner is configured.',
    );
  } else {
    console.warn('DOCUMENT_SCANNER=test: development test scanner only. It does not detect malware.');
  }
  const documentServices = createDocumentServices(database, config);
  const maintainDocuments = () => {
    const requestId = `maintenance-${randomUUID()}`;
    void (async () => {
      const cleaned = await cleanupAbandonedUploads(documentServices);
      const rescanned = await scanPendingRevisions(documentServices, requestId);
      if (cleaned.expiredUploads + cleaned.orphanedFiles + rescanned > 0) {
        console.log(
          `[${requestId}] Documents: removed ${cleaned.expiredUploads} expired uploads and ` +
            `${cleaned.orphanedFiles} orphaned files; retried ${rescanned} pending scans.`,
        );
      }
    })().catch((error: unknown) => console.error(`[${requestId}] Document maintenance failed: ${describeForLog(error)}`));
  };
  setInterval(maintainDocuments, DOCUMENT_MAINTENANCE_INTERVAL_MS).unref();
  maintainDocuments();

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `Penta CRM API listening on http://${config.host}:${config.port} ` +
        `(${config.nodeEnv}, trusted origin ${config.appOrigin})`,
    );
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Stop the other process or set PORT.`);
    } else if (error.code === 'EACCES') {
      console.error(
        `Permission denied binding ${config.host}:${config.port}. On Windows, Hyper-V, WSL and ` +
          'Docker reserve blocks of ports; check "netsh interface ipv4 show excludedportrange ' +
          'protocol=tcp" and set PORT to a value outside those ranges.',
      );
    } else {
      console.error('The API server could not start:', error.message);
    }
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => {
      void database.close().then(() => process.exit(0));
    });
    // Do not let a hung connection block the shutdown indefinitely.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Failed to start the API server:', error instanceof Error ? error.message : error);
  process.exit(1);
});
