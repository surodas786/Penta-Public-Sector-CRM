/**
 * Activities: calls, meetings, emails, visits and notes (FR-040, FR-041).
 *
 * Every read goes through the parent opportunity's scope (SEC-004), so the
 * original author of an activity on a record that has since been transferred
 * away sees nothing — authorship is history, not access. Activities are never
 * deleted (the runtime role has no DELETE on the table); an edit bumps the
 * version, records who edited and when, and leaves before/after values in the
 * audit trail.
 */
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { ActivityDto, Paginated } from '../../shared/api.js';
import { isTerminalStage } from '../../shared/enums.js';
import type {
  createActivitySchema,
  listActivitiesQuerySchema,
  updateActivitySchema,
} from '../../shared/validation.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { activities, contacts, opportunities, opportunityContacts, users } from '../db/schema.js';
import { forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canAccessSalesRecords, canEditActivity, scopedWhere } from '../policy/scope.js';
import { diffRecords, recordAuditEvent } from './audit.js';
import { insertFollowUp, lockOpportunity } from './followUps.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { assertOpportunityVisible } from './opportunities.js';

/**
 * An activity records something that happened. A small allowance covers clock
 * differences between the browser and the server.
 */
const FUTURE_ALLOWANCE_MS = 5 * 60_000;

const author = alias(users, 'activity_author');
const editor = alias(users, 'activity_editor');

const selection = {
  id: activities.id,
  opportunityId: opportunities.id,
  opportunityReference: opportunities.reference,
  opportunityName: opportunities.name,
  type: activities.type,
  occurredAt: activities.occurredAt,
  subject: activities.subject,
  notes: activities.notes,
  contactId: contacts.id,
  contactName: contacts.fullName,
  authorId: activities.authorId,
  authorName: author.fullName,
  createdAt: activities.createdAt,
  editedAt: activities.editedAt,
  editedByName: editor.fullName,
  version: activities.version,
} as const;

function baseQuery(db: Database) {
  return db
    .select(selection)
    .from(activities)
    .innerJoin(opportunities, eq(opportunities.id, activities.opportunityId))
    .innerJoin(author, eq(author.id, activities.authorId))
    .leftJoin(editor, eq(editor.id, activities.editedBy))
    .leftJoin(contacts, eq(contacts.id, activities.contactId));
}

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

function toDto(actor: Actor, row: Row): ActivityDto {
  return {
    id: row.id,
    opportunity: { id: row.opportunityId, reference: row.opportunityReference, name: row.opportunityName },
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    subject: row.subject,
    notes: row.notes,
    contact: row.contactId && row.contactName ? { id: row.contactId, fullName: row.contactName } : null,
    authorId: row.authorId,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    editedByName: row.editedByName ?? null,
    version: row.version,
    canEdit: canEditActivity(actor, row),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** FR-041: chronological, newest first, within one opportunity. */
export async function listOpportunityActivities(
  db: Database,
  actor: Actor,
  opportunityId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<ActivityDto>> {
  await assertOpportunityVisible(db, actor, opportunityId);
  const where = eq(activities.opportunityId, opportunityId);
  const [total] = await db.select({ value: count() }).from(activities).where(where);
  const rows = await baseQuery(db)
    .where(where)
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items: rows.map((row) => toDto(actor, row)), total: total?.value ?? 0, page, pageSize };
}

/** The Activity Log: every activity on an opportunity the actor can see. */
export async function listActivities(
  db: Database,
  actor: Actor,
  query: z.output<typeof listActivitiesQuerySchema>,
): Promise<Paginated<ActivityDto>> {
  const filters: (SQL | undefined)[] = [];
  if (query.type) filters.push(eq(activities.type, query.type));
  if (query.organizationId) filters.push(eq(opportunities.organizationId, query.organizationId));
  if (query.contactId) filters.push(eq(activities.contactId, query.contactId));
  if (query.authoredBy === 'me') filters.push(eq(activities.authorId, actor.id));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(activities.subject, term), ilike(activities.notes, term), ilike(opportunities.name, term)));
  }
  const where = scopedWhere(actor, ...filters);

  const [total] = await db
    .select({ value: count() })
    .from(activities)
    .innerJoin(opportunities, eq(opportunities.id, activities.opportunityId))
    .where(where);
  const rows = await baseQuery(db)
    .where(where)
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return { items: rows.map((row) => toDto(actor, row)), total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

/**
 * One activity through its parent's scope. Also the replay of a retried
 * creation, so it must not depend on which page the activity falls on.
 */
export async function getActivity(db: Database, actor: Actor, activityId: string): Promise<ActivityDto> {
  const [row] = await baseQuery(db).where(scopedWhere(actor, eq(activities.id, activityId))).limit(1);
  if (!row) throw notFound(`activity ${activityId} absent or outside scope for actor ${actor.id}`);
  return toDto(actor, row);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function assertNotFuture(occurredAt: string): void {
  if (Date.parse(occurredAt) > now().getTime() + FUTURE_ALLOWANCE_MS) {
    throw validationFailed({
      occurredAt: 'An activity records something that has happened. Plan future work as a follow-up instead.',
    });
  }
}

/**
 * FR-040: an optional contact must be linked to the same opportunity. The
 * live link is share-locked so it cannot be removed mid-transaction.
 */
async function assertLinkedContact(tx: Database, opportunityId: string, contactId: string): Promise<string> {
  const [row] = await tx
    .select({ fullName: contacts.fullName })
    .from(opportunityContacts)
    .innerJoin(contacts, eq(contacts.id, opportunityContacts.contactId))
    .where(
      and(
        eq(opportunityContacts.opportunityId, opportunityId),
        eq(opportunityContacts.contactId, contactId),
        isNull(opportunityContacts.removedAt),
      ),
    )
    .for('share', { of: opportunityContacts })
    .limit(1);
  if (!row) throw validationFailed({ contactId: 'Choose a contact linked to this opportunity.' });
  return row.fullName;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createActivity(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: z.output<typeof createActivitySchema>;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<ActivityDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;

  const id = await db.transaction(async (tx) => {
    const opportunity = await lockOpportunity(tx, actor, opportunityId);
    if (!canAccessSalesRecords(actor)) throw forbidden();
    assertNotFuture(command.occurredAt);
    if (command.contactId) await assertLinkedContact(tx, opportunityId, command.contactId);

    const timestamp = now();
    const [created] = await tx
      .insert(activities)
      .values({
        opportunityId,
        occurredAt: new Date(command.occurredAt),
        type: command.type,
        subject: command.subject,
        notes: command.notes ?? null,
        contactId: command.contactId ?? null,
        authorId: actor.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: activities.id });
    if (!created) throw new Error('Activity insert returned no row.');

    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId,
      entityType: 'activity',
      entityId: created.id,
      action: 'activity.logged',
      after: {
        about: command.subject,
        type: command.type,
        occurredAt: new Date(command.occurredAt).toISOString(),
        contactId: command.contactId ?? null,
      },
      requestId,
    });
    if (command.nextFollowUp) {
      // Same rules as any follow-up: none on a closed record (BR-014).
      if (isTerminalStage(opportunity.stage) || opportunity.status === 'cancelled') {
        throw validationFailed({ 'nextFollowUp.title': 'Closed opportunities take no new follow-ups.' });
      }
      await insertFollowUp(tx, {
        actor,
        opportunity,
        draft: command.nextFollowUp,
        requestId,
        fieldPrefix: 'nextFollowUp',
        context: 'created',
      });
    }

    await completeClaim(tx, created.id);
    return created.id;
  });

  return getActivity(db, actor, id);
}

export async function updateActivity(options: {
  db: Database;
  actor: Actor;
  activityId: string;
  command: z.output<typeof updateActivitySchema>;
  requestId: string;
}): Promise<ActivityDto> {
  const { db, actor, activityId, command, requestId } = options;

  await db.transaction(async (tx) => {
    // Through scope first: an author who has lost access gets a 404 (FR-041).
    const [located] = await tx
      .select({ opportunityId: activities.opportunityId })
      .from(activities)
      .innerJoin(opportunities, eq(opportunities.id, activities.opportunityId))
      .where(scopedWhere(actor, eq(activities.id, activityId)))
      .limit(1);
    if (!located) throw notFound(`activity ${activityId} absent or outside scope for actor ${actor.id}`);
    // Parent before child, as every writer does: a transfer that commits while
    // this waits is seen, and the previous owner's edit becomes a 404 (SEC-005).
    await lockOpportunity(tx, actor, located.opportunityId);

    const [current] = await tx
      .select({
        id: activities.id,
        opportunityId: activities.opportunityId,
        authorId: activities.authorId,
        type: activities.type,
        occurredAt: activities.occurredAt,
        subject: activities.subject,
        notes: activities.notes,
        contactId: activities.contactId,
        version: activities.version,
      })
      .from(activities)
      .innerJoin(opportunities, eq(opportunities.id, activities.opportunityId))
      .where(scopedWhere(actor, eq(activities.id, activityId)))
      .for('update', { of: activities })
      .limit(1);
    if (!current) throw notFound(`activity ${activityId} absent or outside scope for actor ${actor.id}`);
    if (!canEditActivity(actor, current)) {
      throw forbidden('Salespeople can amend only the activities they logged.');
    }
    if (current.version !== command.version) throw versionConflict();

    const changes: Record<string, unknown> = {};
    if (command.type !== undefined) changes.type = command.type;
    if (command.subject !== undefined) changes.subject = command.subject;
    if ('notes' in command) changes.notes = command.notes ?? null;
    if (command.occurredAt !== undefined) {
      assertNotFuture(command.occurredAt);
      changes.occurredAt = new Date(command.occurredAt);
    }
    if ('contactId' in command) {
      const contactId = command.contactId ?? null;
      if (contactId && contactId !== current.contactId) await assertLinkedContact(tx, current.opportunityId, contactId);
      changes.contactId = contactId;
    }

    const comparable = { ...current, occurredAt: current.occurredAt.toISOString() } as Record<string, unknown>;
    const proposed = {
      ...changes,
      ...(changes.occurredAt instanceof Date ? { occurredAt: (changes.occurredAt as Date).toISOString() } : {}),
    };
    const diff = diffRecords(comparable, proposed);
    if (diff.changed.length === 0) return;

    const timestamp = now();
    const updated = await tx
      .update(activities)
      .set({ ...changes, editedAt: timestamp, editedBy: actor.id, updatedAt: timestamp, version: sql`${activities.version} + 1` })
      .where(and(eq(activities.id, activityId), eq(activities.version, command.version)))
      .returning({ id: activities.id });
    if (updated.length === 0) throw versionConflict();

    // FR-041: the edit history, append-only.
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: current.opportunityId,
      entityType: 'activity',
      entityId: activityId,
      action: 'activity.updated',
      before: { about: current.subject, ...diff.before },
      after: { about: (changes.subject as string | undefined) ?? current.subject, ...diff.after },
      requestId,
    });
  });

  return getActivity(db, actor, activityId);
}
