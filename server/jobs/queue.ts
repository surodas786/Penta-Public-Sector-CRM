/**
 * Durable, retryable background jobs (NFR-003, FR-090).
 *
 * The queue is a database table, so work survives a restart and several API
 * instances can share it: a worker claims one due job at a time with
 * `FOR UPDATE SKIP LOCKED`. A failed attempt is retried with exponential
 * backoff; after `max_attempts` the job stays `failed`, with a log-safe error
 * summary, for monitoring. A job left `running` by a crashed worker is
 * reclaimed once its lease expires. Handlers must therefore be idempotent —
 * the notification generator deduplicates on its trigger key and an export is
 * completed only once.
 */
import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { backgroundJobs } from '../db/schema.js';
import { ApiError, describeForLog } from '../http/errors.js';

export const JOB_KINDS = ['notifications.scan', 'notifications.refresh', 'report_export', 'housekeeping'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** A claimed job that has not reported back within this time is presumed lost. */
export const JOB_LEASE_MINUTES = 10;
const DEFAULT_MAX_ATTEMPTS = 5;

export interface ClaimedJob {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface JobHandler {
  run(job: ClaimedJob, requestId: string): Promise<void>;
  /** Called once when a job has used its last attempt, e.g. to mark an export failed. */
  onFinalFailure?(job: ClaimedJob, requestId: string): Promise<void>;
}

export type JobHandlers = Record<JobKind, JobHandler>;

// ---------------------------------------------------------------------------
// In-process wake-up signal: a worker in this process runs promptly after a
// request enqueues work, instead of waiting for its next poll. Purely an
// optimisation; the poll is the guarantee.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

export function onJobsEnqueued(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call after the enqueuing transaction has committed. */
export function signalJobsEnqueued(): void {
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Enqueue, claim, finish
// ---------------------------------------------------------------------------

/**
 * Adds a job, inside the caller's transaction when given one, so the work is
 * queued if and only if the change that needs it commits. A `dedupeKey`
 * makes the call idempotent: a second enqueue with the same key is a no-op.
 */
export async function enqueueJob(
  tx: Database,
  job: { kind: JobKind; payload?: Record<string, unknown>; dedupeKey?: string; runAfter?: Date; maxAttempts?: number },
): Promise<string | null> {
  const timestamp = now();
  const [row] = await tx
    .insert(backgroundJobs)
    .values({
      kind: job.kind,
      payload: job.payload ?? {},
      dedupeKey: job.dedupeKey ?? null,
      runAfter: job.runAfter ?? timestamp,
      maxAttempts: job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing({ target: backgroundJobs.dedupeKey })
    .returning({ id: backgroundJobs.id });
  return row?.id ?? null;
}

/** 1, 2, 4, 8 … minutes, capped at an hour. */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

/**
 * Claims the oldest due job, or a running job whose lease expired, counting
 * the attempt as it does. Exhausted stale jobs are failed first so they are
 * never claimed again.
 */
export async function claimNextJob(db: Database, workerId: string, at: Date = now()): Promise<ClaimedJob | null> {
  const leaseExpired = new Date(at.getTime() - JOB_LEASE_MINUTES * 60_000).toISOString();

  await db
    .update(backgroundJobs)
    .set({
      status: 'failed',
      finishedAt: at,
      updatedAt: at,
      lockedAt: null,
      lockedBy: null,
      lastError: 'The worker stopped responding on its final attempt.',
    })
    .where(
      and(
        eq(backgroundJobs.status, 'running'),
        sql`${backgroundJobs.lockedAt} < ${leaseExpired}::timestamptz`,
        sql`${backgroundJobs.attempts} >= ${backgroundJobs.maxAttempts}`,
      ),
    );

  const result = await db.execute<{
    id: string;
    kind: JobKind;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE ${backgroundJobs}
    SET status = 'running', attempts = attempts + 1, locked_at = ${at.toISOString()}::timestamptz,
        locked_by = ${workerId}, updated_at = ${at.toISOString()}::timestamptz
    WHERE id = (
      SELECT id FROM ${backgroundJobs}
      WHERE attempts < max_attempts
        AND ((status = 'queued' AND run_after <= ${at.toISOString()}::timestamptz)
          OR (status = 'running' AND locked_at < ${leaseExpired}::timestamptz))
      ORDER BY run_after, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, payload, attempts, max_attempts
  `);
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, kind: row.kind, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts };
}

/** A failure summary safe for the job table and the log (SEC-032). */
export function summariseJobError(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  const line = describeForLog(error).split('\n')[0] ?? 'unknown error';
  return line.slice(0, 500);
}

async function markSucceeded(db: Database, job: ClaimedJob, at: Date): Promise<void> {
  await db
    .update(backgroundJobs)
    .set({ status: 'succeeded', finishedAt: at, updatedAt: at, lockedAt: null, lockedBy: null, lastError: null })
    .where(eq(backgroundJobs.id, job.id));
}

async function markFailed(db: Database, job: ClaimedJob, error: string, at: Date): Promise<'retry' | 'failed'> {
  if (job.attempts >= job.maxAttempts) {
    await db
      .update(backgroundJobs)
      .set({ status: 'failed', finishedAt: at, updatedAt: at, lockedAt: null, lockedBy: null, lastError: error })
      .where(eq(backgroundJobs.id, job.id));
    return 'failed';
  }
  await db
    .update(backgroundJobs)
    .set({
      status: 'queued',
      runAfter: new Date(at.getTime() + retryDelayMinutes(job.attempts) * 60_000),
      updatedAt: at,
      lockedAt: null,
      lockedBy: null,
      lastError: error,
    })
    .where(eq(backgroundJobs.id, job.id));
  return 'retry';
}

export interface JobRunSummary {
  succeeded: number;
  retried: number;
  failed: number;
}

/**
 * Runs due jobs until none remain (or `limit` is reached). Each job runs on
 * its own; one failing job never stops the others.
 */
export async function runDueJobs(
  db: Database,
  handlers: JobHandlers,
  options: { workerId?: string; limit?: number; log?: (line: string) => void } = {},
): Promise<JobRunSummary> {
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const limit = options.limit ?? 100;
  const summary: JobRunSummary = { succeeded: 0, retried: 0, failed: 0 };

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextJob(db, workerId);
    if (!job) break;
    const requestId = `job-${job.kind}-${job.id}`;
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}.`);
      await handler.run(job, requestId);
      await markSucceeded(db, job, now());
      summary.succeeded += 1;
    } catch (error) {
      const message = summariseJobError(error);
      const outcome = await markFailed(db, job, message, now());
      options.log?.(`[${requestId}] attempt ${job.attempts} of ${job.maxAttempts} failed (${outcome}): ${message}`);
      if (outcome === 'failed') {
        summary.failed += 1;
        try {
          await handler?.onFinalFailure?.(job, requestId);
        } catch (followUpError) {
          options.log?.(`[${requestId}] final-failure handling failed: ${summariseJobError(followUpError)}`);
        }
      } else {
        summary.retried += 1;
      }
    }
  }
  return summary;
}
