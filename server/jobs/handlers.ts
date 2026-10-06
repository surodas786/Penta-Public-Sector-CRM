/**
 * What each background job does, and the schedule that queues them.
 *
 *   notifications.scan     hourly (FR-090: tender deadlines at least hourly;
 *                          follow-ups at the start of the Dhaka day, which the
 *                          first scan after 00:00 Asia/Dhaka is). Retires
 *                          obsolete alerts, then adds due ones.
 *   notifications.refresh  queued by a transfer, a reschedule or a tender
 *                          change, so replacement alerts appear without
 *                          waiting for the next scan.
 *   report_export          produces one queued CSV export.
 *   housekeeping           daily: expired exports, expired idempotency
 *                          records, finished jobs older than 30 days.
 *
 * Every handler is idempotent, so a retry after a partial failure is safe.
 */
import { and, inArray, lt, sql } from 'drizzle-orm';

import { dhakaDateOf, now } from '../clock.js';
import type { Database } from '../db/client.js';
import { backgroundJobs } from '../db/schema.js';
import type { JobsConfig } from '../env.js';
import { failExportAfterRetries, generateExport, purgeExpiredExports } from '../services/exports.js';
import { pruneExpiredIdempotencyRecords } from '../services/idempotency.js';
import { generateDeadlineAlerts, generateOwnershipAlerts, runNotificationScan } from '../services/notifications.js';
import { enqueueJob, type JobHandlers } from './queue.js';

const FINISHED_JOB_RETENTION_DAYS = 30;

export function createJobHandlers(db: Database, config: Pick<JobsConfig, 'exportTtlHours' | 'exportMaxRows'>): JobHandlers {
  return {
    'notifications.scan': {
      async run() {
        await runNotificationScan(db);
      },
    },
    'notifications.refresh': {
      async run(job) {
        const opportunityId = String(job.payload.opportunityId ?? '');
        if (!opportunityId) return;
        await generateDeadlineAlerts(db, { opportunityId });
        const ownership = job.payload.ownership as { newOwnerId: string; version: number; actorId: string } | undefined;
        if (ownership) await generateOwnershipAlerts(db, { opportunityId, ...ownership });
      },
    },
    report_export: {
      async run(job) {
        await generateExport(db, String(job.payload.exportId), { ttlHours: config.exportTtlHours, maxRows: config.exportMaxRows });
      },
      async onFinalFailure(job) {
        await failExportAfterRetries(db, String(job.payload.exportId));
      },
    },
    housekeeping: {
      async run() {
        await purgeExpiredExports(db);
        await pruneExpiredIdempotencyRecords(db);
        const cutoff = new Date(now().getTime() - FINISHED_JOB_RETENTION_DAYS * 24 * 3_600_000);
        await db
          .delete(backgroundJobs)
          .where(and(inArray(backgroundJobs.status, ['succeeded', 'failed']), lt(backgroundJobs.finishedAt, cutoff)));
      },
    },
  };
}

/** The Dhaka calendar hour of an instant, e.g. 2026-10-06T09. */
function dhakaHour(at: Date): string {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hourCycle: 'h23' }).format(at);
  return `${dhakaDateOf(at)}T${hour}`;
}

/**
 * Queues the scheduled jobs that are due. The dedupe keys make this safe to
 * call as often as wanted, from any number of API instances: each Dhaka hour
 * gets one scan and each Dhaka day one housekeeping run.
 */
export async function enqueueScheduledJobs(db: Database, at: Date = now()): Promise<void> {
  await enqueueJob(db, { kind: 'notifications.scan', dedupeKey: `notifications.scan:${dhakaHour(at)}`, runAfter: at });
  await enqueueJob(db, { kind: 'housekeeping', dedupeKey: `housekeeping:${dhakaDateOf(at)}`, runAfter: at });
}

/** For `npm run jobs:run -- --status`: counts by state and the latest failures. */
export async function jobStatus(db: Database) {
  const counts = await db
    .select({ status: backgroundJobs.status, kind: backgroundJobs.kind, value: sql<number>`count(*)::int` })
    .from(backgroundJobs)
    .groupBy(backgroundJobs.status, backgroundJobs.kind);
  const failures = await db
    .select({ id: backgroundJobs.id, kind: backgroundJobs.kind, attempts: backgroundJobs.attempts, lastError: backgroundJobs.lastError })
    .from(backgroundJobs)
    .where(sql`${backgroundJobs.status} = 'failed'`)
    .orderBy(sql`${backgroundJobs.finishedAt} DESC NULLS LAST`)
    .limit(10);
  return { counts, failures };
}

/**
 * The monitoring verdict (NFR-003) behind `npm run jobs:run -- --check`:
 * unhealthy when a job failed for good in the last 24 hours, or when due work
 * has waited more than an hour (no worker is running). Counts only — never
 * job payloads.
 */
export async function jobHealth(db: Database, at: Date = now()) {
  const [row] = await db
    .select({
      recentFailures: sql<number>`count(*) FILTER (WHERE ${backgroundJobs.status} = 'failed'
        AND ${backgroundJobs.finishedAt} > ${at.toISOString()}::timestamptz - interval '24 hours')::int`,
      overdue: sql<number>`count(*) FILTER (WHERE ${backgroundJobs.status} = 'queued'
        AND ${backgroundJobs.runAfter} < ${at.toISOString()}::timestamptz - interval '1 hour')::int`,
    })
    .from(backgroundJobs);
  const recentFailures = row?.recentFailures ?? 0;
  const overdue = row?.overdue ?? 0;
  return { healthy: recentFailures === 0 && overdue === 0, recentFailures, overdue };
}
