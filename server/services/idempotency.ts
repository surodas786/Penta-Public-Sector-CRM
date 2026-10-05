/**
 * Durable idempotency for create-style operations (BR-091, plan section 5).
 *
 * Design notes:
 *
 *  - The claim is committed BEFORE the business transaction, so a genuinely
 *    concurrent duplicate collides on the unique index instead of racing
 *    through to a second insert.
 *  - Keys are scoped by actor AND operation; the same key under a different
 *    actor or operation is a different key.
 *  - A fingerprint of the request body is stored. Reusing a key with a
 *    different payload is a 409 rather than a silent replay.
 *  - No response body is stored. A replay re-reads the entity through the
 *    normal scoped query, so a caller whose access was revoked after the first
 *    call gets a 404 on replay instead of cached commercial data.
 */
import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { idempotencyRecords } from '../db/schema.js';
import { conflict } from '../http/errors.js';

/** Orphaned in-progress claims and completed records are prunable after this. */
export const IDEMPOTENCY_RETENTION_HOURS = 24;

export type IdempotencyClaim =
  | { kind: 'proceed'; claimId: string }
  | { kind: 'replay'; entityId: string };

/** Stable JSON so key order in the request body cannot change the fingerprint. */
export function fingerprintPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export async function claimIdempotencyKey(options: {
  db: Database;
  actorId: string;
  operation: string;
  key: string;
  payload: unknown;
}): Promise<IdempotencyClaim> {
  const { db, actorId, operation, key, payload } = options;
  const fingerprint = fingerprintPayload(payload);
  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + IDEMPOTENCY_RETENTION_HOURS * 3_600_000);

  const inserted = await db
    .insert(idempotencyRecords)
    .values({
      actorId,
      operation,
      idempotencyKey: key,
      requestFingerprint: fingerprint,
      state: 'in_progress',
      createdAt: issuedAt,
      expiresAt,
    })
    .onConflictDoNothing({
      target: [
        idempotencyRecords.actorId,
        idempotencyRecords.operation,
        idempotencyRecords.idempotencyKey,
      ],
    })
    .returning({ id: idempotencyRecords.id });

  const claim = inserted[0];
  if (claim) return { kind: 'proceed', claimId: claim.id };

  // The key already exists for this actor and operation.
  const [existing] = await db
    .select({
      id: idempotencyRecords.id,
      fingerprint: idempotencyRecords.requestFingerprint,
      state: idempotencyRecords.state,
      resultEntityId: idempotencyRecords.resultEntityId,
    })
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.actorId, actorId),
        eq(idempotencyRecords.operation, operation),
        eq(idempotencyRecords.idempotencyKey, key),
      ),
    )
    .limit(1);

  if (!existing) {
    // Vanished between the insert and the read (expiry sweep). Ask for a retry
    // rather than risking a duplicate.
    throw conflict(
      'That request could not be completed. Retry with a new idempotency key.',
      'idempotency_in_progress',
    );
  }

  if (existing.fingerprint !== fingerprint) {
    throw conflict(
      'This idempotency key was already used for a different request. Use a new key.',
      'idempotency_key_reuse',
    );
  }

  if (existing.state === 'completed' && existing.resultEntityId) {
    return { kind: 'replay', entityId: existing.resultEntityId };
  }

  // A concurrent attempt with the same key and payload is still running.
  throw conflict(
    'An identical request is still being processed. Wait a moment and check the result.',
    'idempotency_in_progress',
  );
}

export async function completeIdempotencyClaim(options: {
  db: Database;
  claimId: string;
  entityId: string;
}): Promise<void> {
  await options.db
    .update(idempotencyRecords)
    .set({ state: 'completed', resultEntityId: options.entityId, completedAt: now() })
    .where(eq(idempotencyRecords.id, options.claimId));
}

/**
 * Releases a claim whose business transaction failed, so an immediate retry is
 * not blocked by a key that produced nothing.
 */
export async function releaseIdempotencyClaim(options: {
  db: Database;
  claimId: string;
}): Promise<void> {
  await options.db
    .delete(idempotencyRecords)
    .where(
      and(eq(idempotencyRecords.id, options.claimId), eq(idempotencyRecords.state, 'in_progress')),
    );
}

/** Housekeeping entry point; see the ADR for the scheduled-cleanup decision. */
export async function pruneExpiredIdempotencyRecords(db: Database): Promise<number> {
  const deleted = await db
    .delete(idempotencyRecords)
    .where(sql`${idempotencyRecords.expiresAt} < ${now()}`)
    .returning({ id: idempotencyRecords.id });
  return deleted.length;
}
