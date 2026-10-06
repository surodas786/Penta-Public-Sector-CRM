/**
 * The API for capacity measurement: the real application (`createApp`, the
 * full middleware chain, sessions in PostgreSQL, the restricted runtime role)
 * against the synthetic capacity database.
 *
 * Two deliberate differences from a deployment, both stated in the results:
 *   - the sign-in rate limit is raised, because every virtual user signs in
 *     from one machine and the production limit (10 per 15 minutes per
 *     address) would otherwise stop the test, not the application;
 *   - the job worker does not run, so background scans do not compete with
 *     the measured requests (a scan is timed separately).
 *
 *   CAPACITY_PORT (default 4810)  CAPACITY_ORIGIN (default http://127.0.0.1:4173)
 */
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db/client.js';
import { loadServerConfig } from '../../server/env.js';
import { assertCapacityTarget, capacityUrls } from './target.js';

try {
  process.loadEnvFile('.env');
} catch {
  // The environment may be supplied directly.
}

const port = Number(process.env.CAPACITY_PORT ?? 4810);
process.env.APP_ORIGIN = process.env.CAPACITY_ORIGIN ?? 'http://127.0.0.1:4173';
const { runtime } = capacityUrls();
assertCapacityTarget(runtime);

const config = loadServerConfig({ databaseUrl: runtime, port, host: '127.0.0.1', requestLog: 'off' });
const database = createDatabase(runtime);
const app = createApp({ database, config, loginRateLimit: { windowMs: 60_000, limit: 100_000 } });

app.listen(port, '127.0.0.1', () => {
  console.log(`capacity API listening on ${port} (origin ${config.appOrigin})`);
});
