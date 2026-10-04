/**
 * Append-only audit writes (FR-062).
 *
 * Always called inside the same transaction as the change it records, so a
 * rolled-back mutation leaves no audit event and a committed one always has
 * exactly one. The runtime database role can INSERT and SELECT here but cannot
 * UPDATE or DELETE (SEC-012, enforced by migration 0001).
 */
import type { Database } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { now } from '../clock.js';

export type AuditDomain = 'commercial' | 'administrative';

export interface AuditWrite {
  actorId: string;
  /** Set for commercial events so history inherits opportunity scope. */
  opportunityId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  domain?: AuditDomain;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  requestId: string;
}

/** `tx` is the transaction handle — never the pool — so atomicity holds. */
export async function recordAuditEvent(tx: Database, event: AuditWrite): Promise<void> {
  await tx.insert(auditEvents).values({
    actorId: event.actorId,
    opportunityId: event.opportunityId ?? null,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    domain: event.domain ?? 'commercial',
    beforeData: event.before ?? null,
    afterData: event.after ?? null,
    reason: event.reason ?? null,
    occurredAt: now(),
    requestId: event.requestId,
  });
}

/** Human labels for history rows. Mirrors the approved Change History wording. */
export const OPPORTUNITY_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  organizationId: 'Procuring organization',
  department: 'Department / office',
  solutionCategory: 'Solution category',
  description: 'Description',
  estimatedValue: 'Estimated value',
  fundingSource: 'Funding source',
  ownerId: 'Owner',
  sectionId: 'Section',
  stage: 'Stage',
  status: 'Status',
  priority: 'Priority',
  expectedPublicationDate: 'Expected tender publication',
  expectedAwardDate: 'Expected award date',
  awardedValue: 'Awarded value',
  awardDate: 'Award date',
  lossReason: 'Lost reason',
  closedDate: 'Closed date',
  statusNote: 'Status note',
};

/**
 * Shallow before/after diff limited to the keys actually supplied, so an audit
 * row records the change rather than the whole record.
 */
export function diffRecords<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] } {
  const beforeChanges: Record<string, unknown> = {};
  const afterChanges: Record<string, unknown> = {};
  const changed: string[] = [];

  for (const key of Object.keys(after)) {
    const previous = before[key] ?? null;
    const next = after[key] ?? null;
    if (previous === next) continue;
    beforeChanges[key] = previous;
    afterChanges[key] = next;
    changed.push(key);
  }

  return { before: beforeChanges, after: afterChanges, changed };
}
