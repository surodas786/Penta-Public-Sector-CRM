/**
 * Runs due background jobs once and exits — for operators, cron, or a
 * deployment that keeps the worker out of the API process (JOBS_ENABLED=false).
 *
 *   npm run jobs:run              queue scheduled jobs, run everything due
 *   npm run jobs:run -- --status  counts by state and the latest failures
 *   npm run jobs:run -- --check   exit 1 if a job failed in 24 h or due work waited > 1 h (for monitoring)
 */
import { randomUUID } from 'node:crypto';

import { createDatabase } from '../db/client.js';
import { loadServerConfig } from '../env.js';
import { createJobHandlers, enqueueScheduledJobs, jobHealth, jobStatus } from './handlers.js';
import { runDueJobs } from './queue.js';

async function main(): Promise<void> {
  const config = loadServerConfig();
  const database = createDatabase(config.databaseUrl);
  try {
    if (process.argv.includes('--check')) {
      const health = await jobHealth(database.db);
      console.log(
        `${health.healthy ? 'OK' : 'UNHEALTHY'}: ${health.recentFailures} jobs failed in the last 24 hours; ` +
          `${health.overdue} due jobs waiting over an hour.`,
      );
      process.exitCode = health.healthy ? 0 : 1;
      return;
    }
    if (process.argv.includes('--status')) {
      const status = await jobStatus(database.db);
      for (const row of status.counts) console.log(`${row.kind.padEnd(24)} ${row.status.padEnd(10)} ${row.value}`);
      for (const failure of status.failures) {
        console.log(`FAILED ${failure.kind} ${failure.id} after ${failure.attempts} attempts: ${failure.lastError ?? ''}`);
      }
      return;
    }
    await enqueueScheduledJobs(database.db);
    const summary = await runDueJobs(database.db, createJobHandlers(database.db, config.jobs), {
      workerId: `cli-${randomUUID()}`,
      log: (line) => console.warn(line),
    });
    console.log(`Jobs: ${summary.succeeded} succeeded, ${summary.retried} will be retried, ${summary.failed} failed.`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('Job run failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
