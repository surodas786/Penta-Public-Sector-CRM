/**
 * Server entry point.
 *
 *   npm run dev:server     tsx watch, reads .env
 *   node dist-server/server/index.js   after `npm run build:server`
 */
import { createApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadServerConfig } from './env.js';

async function main(): Promise<void> {
  const config = loadServerConfig();
  const database = createDatabase(config.databaseUrl);

  // Fail fast on a bad connection rather than at the first request.
  const probe = await database.pool.connect();
  probe.release();

  const app = createApp({ database, config });

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
