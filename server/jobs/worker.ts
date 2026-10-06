/**
 * The in-process worker started by the API server (`JOBS_ENABLED`, default
 * true). Every `JOBS_POLL_SECONDS` it queues the scheduled jobs that are due
 * and runs whatever is waiting; a request that queues work wakes it sooner.
 * One pass runs at a time per process; other instances share the queue
 * safely through row locks.
 */
import { randomUUID } from 'node:crypto';

import type { Database } from '../db/client.js';
import type { JobsConfig } from '../env.js';
import { describeForLog } from '../http/errors.js';
import { createJobHandlers, enqueueScheduledJobs } from './handlers.js';
import { onJobsEnqueued, runDueJobs } from './queue.js';

export function startJobWorker(db: Database, config: JobsConfig): () => void {
  const workerId = `api-${randomUUID()}`;
  const handlers = createJobHandlers(db, config);
  let running = false;
  let again = false;

  const pass = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await enqueueScheduledJobs(db);
        const summary = await runDueJobs(db, handlers, { workerId, log: (line) => console.warn(line) });
        if (summary.failed > 0) console.error(`[${workerId}] ${summary.failed} job(s) failed after their last attempt.`);
      } while (again);
    } catch (error) {
      console.error(`[${workerId}] Job worker pass failed: ${describeForLog(error)}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void pass(), config.pollSeconds * 1000);
  timer.unref();
  // A short delay lets the enqueuing transaction commit before the pass looks.
  const unsubscribe = onJobsEnqueued(() => setTimeout(() => void pass(), 200).unref());
  void pass();

  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
