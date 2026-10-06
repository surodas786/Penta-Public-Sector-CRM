/**
 * Follow-up lifecycle (FR-042, FR-043, BR-013, BR-014, BR-030).
 *
 * Open follow-ups are the single source of truth for an opportunity's next
 * action, so the invariant this module protects is:
 *
 *   every Active, nonterminal opportunity has at least one open follow-up.
 *
 * Each operation locks the parent opportunity row first (SELECT … FOR UPDATE)
 * and only then the follow-up, always in that order. Two people completing the
 * last two open tasks at the same moment are therefore serialised: the second
 * sees that its task is now the last one and must supply a replacement. Stage
 * and status transitions take the same lock, so a transition and a task change
 * cannot interleave either (BR-090).
 */
import { and, asc, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type {
  AssigneeOptionDto,
  FollowUpDto,
  FollowUpListDto,
  FollowUpListItemDto,
  Paginated,
} from '../../shared/api.js';
import { isTerminalStage, type OpportunityStage, type OpportunityStatus } from '../../shared/enums.js';
import type {
  FollowUpDraftInput,
  createFollowUpSchema,
  listFollowUpsQuerySchema,
} from '../../shared/validation.js';
import { dhakaToday, now } from '../clock.js';
import type { Database } from '../db/client.js';
import { followUps, opportunities, sections, users } from '../db/schema.js';
import { conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canManageFollowUps, followUpAssigneeScope, opportunityScope, scopedWhere } from '../policy/scope.js';
import { recordAuditEvent } from './audit.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { signalJobsEnqueued } from '../jobs/queue.js';
import { dueTodayFollowUp, overdueFollowUp } from './metrics.js';
import { alertsChangedInTransaction } from './notifications.js';

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

const assignee = alias(users, 'assignee');
const creator = alias(users, 'creator');
const completer = alias(users, 'completer');
const canceller = alias(users, 'canceller');

const followUpSelection = {
  id: followUps.id,
  opportunityId: followUps.opportunityId,
  title: followUps.title,
  dueDate: followUps.dueDate,
  state: followUps.state,
  priority: followUps.priority,
  assigneeId: followUps.assignedUserId,
  assigneeName: assignee.fullName,
  createdByName: creator.fullName,
  createdAt: followUps.createdAt,
  completedAt: followUps.completedAt,
  completedByName: completer.fullName,
  completionNote: followUps.completionNote,
  cancelledAt: followUps.cancelledAt,
  cancelledByName: canceller.fullName,
  cancellationReason: followUps.cancellationReason,
  version: followUps.version,
} as const;

function followUpQuery(db: Database) {
  return db
    .select(followUpSelection)
    .from(followUps)
    .innerJoin(assignee, eq(assignee.id, followUps.assignedUserId))
    .innerJoin(creator, eq(creator.id, followUps.createdBy))
    .leftJoin(completer, eq(completer.id, followUps.completedBy))
    .leftJoin(canceller, eq(canceller.id, followUps.cancelledBy));
}

type FollowUpRow = Awaited<ReturnType<ReturnType<typeof followUpQuery>['execute']>>[number];

function toFollowUpDto(row: FollowUpRow): FollowUpDto {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    title: row.title,
    dueDate: row.dueDate,
    state: row.state,
    priority: row.priority,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByName: row.completedByName ?? null,
    completionNote: row.completionNote,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByName: row.cancelledByName ?? null,
    cancellationReason: row.cancellationReason,
    version: row.version,
  };
}

/**
 * Reads one follow-up through its parent's scope. A follow-up on an
 * inaccessible opportunity is indistinguishable from one that does not exist.
 */
export async function getScopedFollowUp(
  db: Database,
  actor: Actor,
  followUpId: string,
): Promise<FollowUpDto> {
  const [row] = await followUpQuery(db)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .where(scopedWhere(actor, eq(followUps.id, followUpId)))
    .limit(1);
  if (!row) throw notFound(`follow-up ${followUpId} absent or outside scope for actor ${actor.id}`);
  return toFollowUpDto(row);
}

/** Unscoped read for a row the caller has just written inside its own scope check. */
async function readFollowUp(db: Database, followUpId: string): Promise<FollowUpDto> {
  const [row] = await followUpQuery(db).where(eq(followUps.id, followUpId)).limit(1);
  if (!row) throw notFound(`follow-up ${followUpId} not found`);
  return toFollowUpDto(row);
}

/** The opportunity's follow-ups, open first by due date, then the closed ones. */
export async function listFollowUpsForOpportunity(
  db: Database,
  opportunityId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<FollowUpDto>> {
  const where = eq(followUps.opportunityId, opportunityId);
  const [totalRow] = await db.select({ value: count() }).from(followUps).where(where);

  const rows = await followUpQuery(db)
    .where(where)
    .orderBy(
      sql`CASE ${followUps.state} WHEN 'open' THEN 0 ELSE 1 END`,
      asc(followUps.dueDate),
      asc(followUps.createdAt),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items: rows.map(toFollowUpDto), total: totalRow?.value ?? 0, page, pageSize };
}

/** The follow-up created together with the opportunity (BR-014). */
export async function getFirstFollowUp(db: Database, opportunityId: string): Promise<FollowUpDto | null> {
  const [row] = await followUpQuery(db)
    .where(eq(followUps.opportunityId, opportunityId))
    .orderBy(asc(followUps.createdAt), asc(followUps.id))
    .limit(1);
  return row ? toFollowUpDto(row) : null;
}

// ---------------------------------------------------------------------------
// Locking primitives shared with the transition service
// ---------------------------------------------------------------------------

export interface LockedOpportunity {
  id: string;
  ownerId: string;
  sectionId: string;
  stage: OpportunityStage;
  status: OpportunityStatus;
  priority: 'high' | 'medium' | 'low';
  version: number;
  awardedValue: string | null;
  awardDate: string | null;
  lossReason: string | null;
  lossNote: string | null;
  closedDate: string | null;
  statusNote: string | null;
}

/**
 * Locks the opportunity row for the rest of the transaction, through the
 * actor's scope. Absent and inaccessible are the same 404 (SEC-003).
 */
export async function lockOpportunity(
  tx: Database,
  actor: Actor,
  opportunityId: string,
): Promise<LockedOpportunity> {
  const [row] = await tx
    .select({
      id: opportunities.id,
      ownerId: opportunities.ownerId,
      sectionId: opportunities.sectionId,
      stage: opportunities.stage,
      status: opportunities.status,
      priority: opportunities.priority,
      version: opportunities.version,
      awardedValue: opportunities.awardedValue,
      awardDate: opportunities.awardDate,
      lossReason: opportunities.lossReason,
      lossNote: opportunities.lossNote,
      closedDate: opportunities.closedDate,
      statusNote: opportunities.statusNote,
    })
    .from(opportunities)
    .where(and(opportunityScope(actor), eq(opportunities.id, opportunityId)))
    .for('update')
    .limit(1);

  if (!row) {
    throw notFound(`opportunity ${opportunityId} absent or outside scope for actor ${actor.id}`);
  }
  return row;
}

/** Active and nonterminal: the population that must always have a next action. */
export function needsNextAction(opportunity: Pick<LockedOpportunity, 'stage' | 'status'>): boolean {
  return opportunity.status === 'active' && !isTerminalStage(opportunity.stage);
}

export async function countOpenFollowUps(
  tx: Database,
  opportunityId: string,
  excludingFollowUpId?: string,
): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(followUps)
    .where(
      and(
        eq(followUps.opportunityId, opportunityId),
        eq(followUps.state, 'open'),
        excludingFollowUpId ? ne(followUps.id, excludingFollowUpId) : undefined,
      ),
    );
  return row?.value ?? 0;
}

/**
 * Resolves and validates a follow-up assignee (FR-042).
 *
 * An explicit assignee must satisfy `followUpAssigneeScope`. Without one, the
 * current owner is used when eligible, otherwise the actor — which covers a
 * section record whose owner has been deactivated.
 */
async function resolveAssignee(
  tx: Database,
  actor: Actor,
  opportunity: Pick<LockedOpportunity, 'ownerId' | 'sectionId'>,
  requested: string | undefined,
  fieldKey: string,
): Promise<string> {
  const eligible = followUpAssigneeScope(actor, opportunity);
  const candidates = requested ? [requested] : [opportunity.ownerId, actor.id];

  for (const candidate of candidates) {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eligible, eq(users.id, candidate)))
      .limit(1);
    if (row) return row.id;
  }

  // The same wording whatever the reason, so the field cannot be used to probe
  // which accounts exist.
  throw validationFailed({
    [fieldKey]: 'Choose someone who can be assigned follow-ups on this opportunity.',
  });
}

/**
 * Inserts an open follow-up and its audit event. Used for quick creation, for
 * replacements and for the next action required by a transition.
 */
export async function insertFollowUp(
  tx: Database,
  options: {
    actor: Actor;
    opportunity: Pick<LockedOpportunity, 'id' | 'ownerId' | 'sectionId' | 'priority'>;
    draft: FollowUpDraftInput;
    requestId: string;
    fieldPrefix: string;
    /** Why it was created, for the history view. */
    context: 'created' | 'replacement' | 'transition';
  },
): Promise<string> {
  const { actor, opportunity, draft, requestId, fieldPrefix, context } = options;
  const assigneeKey = fieldPrefix ? `${fieldPrefix}.assigneeId` : 'assigneeId';
  const assignedUserId = await resolveAssignee(tx, actor, opportunity, draft.assigneeId, assigneeKey);
  const timestamp = now();

  const [created] = await tx
    .insert(followUps)
    .values({
      opportunityId: opportunity.id,
      title: draft.title.trim(),
      assignedUserId,
      dueDate: draft.dueDate,
      priority: draft.priority ?? opportunity.priority,
      state: 'open',
      createdBy: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning({ id: followUps.id });
  if (!created) throw new Error('Follow-up insert returned no row.');

  await recordAuditEvent(tx, {
    actorId: actor.id,
    opportunityId: opportunity.id,
    entityType: 'follow_up',
    entityId: created.id,
    action: 'follow_up.created',
    before: null,
    after: {
      task: draft.title.trim(),
      dueDate: draft.dueDate,
      assignedUserId,
      priority: draft.priority ?? opportunity.priority,
      context,
    },
    requestId,
  });

  return created.id;
}

/**
 * BR-014: Cancelled and terminal transitions close every open follow-up as
 * Cancelled with a reason — never as Completed — each with its own audit event.
 */
export async function cancelOpenFollowUps(
  tx: Database,
  options: { actor: Actor; opportunityId: string; reason: string; requestId: string },
): Promise<number> {
  const { actor, opportunityId, reason, requestId } = options;
  const timestamp = now();

  const cancelled = await tx
    .update(followUps)
    .set({
      state: 'cancelled',
      cancelledAt: timestamp,
      cancelledBy: actor.id,
      cancellationReason: reason,
      updatedAt: timestamp,
      version: sql`${followUps.version} + 1`,
    })
    .where(and(eq(followUps.opportunityId, opportunityId), eq(followUps.state, 'open')))
    .returning({ id: followUps.id, title: followUps.title });

  for (const task of cancelled) {
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId,
      entityType: 'follow_up',
      entityId: task.id,
      action: 'follow_up.cancelled',
      before: { task: task.title, state: 'open' },
      after: { task: task.title, state: 'cancelled' },
      reason,
      requestId,
    });
  }
  return cancelled.length;
}

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

type CreateFollowUpCommand = z.output<typeof createFollowUpSchema>;

/** Quick creation (FR-043). Allowed while a record is Active or On Hold and nonterminal. */
export async function createFollowUp(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: CreateFollowUpCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<FollowUpDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;

  const followUpId = await db.transaction(async (tx) => {
    const opportunity = await lockOpportunity(tx, actor, opportunityId);
    if (!canManageFollowUps(actor)) throw forbidden();
    assertAcceptsFollowUps(opportunity);

    const id = await insertFollowUp(tx, {
      actor,
      opportunity,
      draft: command,
      requestId,
      fieldPrefix: '',
      context: 'created',
    });
    await completeClaim(tx, id);
    return id;
  });

  return readFollowUp(db, followUpId);
}

function assertAcceptsFollowUps(opportunity: Pick<LockedOpportunity, 'stage' | 'status'>): void {
  if (isTerminalStage(opportunity.stage) || opportunity.status === 'cancelled') {
    throw conflict(
      'Closed and cancelled opportunities take no new follow-ups. Reopen or return it to active work first.',
      'invalid_transition',
    );
  }
}

/**
 * Locks a follow-up that belongs to an opportunity the caller has already
 * locked. Both the parent scope and the follow-up's own version are checked.
 */
async function lockOpenFollowUp(
  tx: Database,
  actor: Actor,
  followUpId: string,
  expectedVersion: number,
): Promise<{ followUp: { id: string; title: string; dueDate: string }; opportunity: LockedOpportunity }> {
  // Find the parent first without a lock, through scope, so an inaccessible
  // follow-up 404s before anything is locked.
  const [parent] = await tx
    .select({ opportunityId: followUps.opportunityId })
    .from(followUps)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .where(scopedWhere(actor, eq(followUps.id, followUpId)))
    .limit(1);
  if (!parent) throw notFound(`follow-up ${followUpId} absent or outside scope for actor ${actor.id}`);

  // Parent before child, always: the order every writer in this module uses.
  const opportunity = await lockOpportunity(tx, actor, parent.opportunityId);

  const [row] = await tx
    .select({
      id: followUps.id,
      title: followUps.title,
      dueDate: followUps.dueDate,
      state: followUps.state,
      version: followUps.version,
    })
    .from(followUps)
    .where(eq(followUps.id, followUpId))
    .for('update')
    .limit(1);
  if (!row) throw notFound(`follow-up ${followUpId} vanished`);

  if (!canManageFollowUps(actor)) throw forbidden();

  if (row.version !== expectedVersion) throw versionConflict();
  if (row.state !== 'open') {
    throw conflict(`This follow-up is already ${row.state}.`, 'invalid_transition');
  }
  return { followUp: row, opportunity };
}

/**
 * BR-014: closing the last open follow-up of an Active, nonterminal record
 * needs a replacement — or a transition to On Hold, Cancelled, Awarded or Lost,
 * which the caller makes through the transition service instead.
 */
async function requireReplacementIfLast(
  tx: Database,
  opportunity: LockedOpportunity,
  followUpId: string,
  replacement: FollowUpDraftInput | undefined,
): Promise<void> {
  if (replacement || !needsNextAction(opportunity)) return;
  const othersOpen = await countOpenFollowUps(tx, opportunity.id, followUpId);
  if (othersOpen === 0) {
    throw validationFailed(
      {
        replacement:
          'This is the only open follow-up on an active opportunity. Add the next follow-up, or put the opportunity On Hold, cancel it, or record its outcome instead.',
      },
      'An active opportunity always needs a next action.',
    );
  }
}

export async function completeFollowUp(options: {
  db: Database;
  actor: Actor;
  followUpId: string;
  command: { version: number; completionNote?: string | undefined; replacement?: FollowUpDraftInput | undefined };
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<FollowUpDto> {
  const { db, actor, followUpId, command, requestId, completeClaim } = options;

  await db.transaction(async (tx) => {
    const { followUp, opportunity } = await lockOpenFollowUp(tx, actor, followUpId, command.version);
    await requireReplacementIfLast(tx, opportunity, followUpId, command.replacement);

    const timestamp = now();
    const updated = await tx
      .update(followUps)
      .set({
        state: 'completed',
        completedAt: timestamp,
        completedBy: actor.id,
        completionNote: command.completionNote ?? null,
        updatedAt: timestamp,
        version: sql`${followUps.version} + 1`,
      })
      .where(and(eq(followUps.id, followUpId), eq(followUps.version, command.version), eq(followUps.state, 'open')))
      .returning({ id: followUps.id });
    if (updated.length === 0) throw versionConflict();

    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'follow_up',
      entityId: followUpId,
      action: 'follow_up.completed',
      before: { task: followUp.title, state: 'open' },
      after: { task: followUp.title, state: 'completed', completionNote: command.completionNote ?? null },
      requestId,
    });

    if (command.replacement) {
      await insertFollowUp(tx, {
        actor,
        opportunity,
        draft: command.replacement,
        requestId,
        fieldPrefix: 'replacement',
        context: 'replacement',
      });
    }
    await alertsChangedInTransaction(tx, { opportunityId: opportunity.id, resolution: 'completed', followUpId });
    await completeClaim(tx, followUpId);
  });

  signalJobsEnqueued();
  return readFollowUp(db, followUpId);
}

export async function rescheduleFollowUp(options: {
  db: Database;
  actor: Actor;
  followUpId: string;
  command: { version: number; dueDate: string; reason: string };
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<FollowUpDto> {
  const { db, actor, followUpId, command, requestId, completeClaim } = options;

  await db.transaction(async (tx) => {
    const { followUp, opportunity } = await lockOpenFollowUp(tx, actor, followUpId, command.version);
    if (followUp.dueDate === command.dueDate) {
      throw validationFailed({ dueDate: 'Choose a different date from the current one.' });
    }

    const updated = await tx
      .update(followUps)
      .set({ dueDate: command.dueDate, updatedAt: now(), version: sql`${followUps.version} + 1` })
      .where(and(eq(followUps.id, followUpId), eq(followUps.version, command.version), eq(followUps.state, 'open')))
      .returning({ id: followUps.id });
    if (updated.length === 0) throw versionConflict();

    // FR-043: old date, new date, actor and reason.
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'follow_up',
      entityId: followUpId,
      action: 'follow_up.rescheduled',
      before: { task: followUp.title, dueDate: followUp.dueDate },
      after: { task: followUp.title, dueDate: command.dueDate },
      reason: command.reason,
      requestId,
    });
    await alertsChangedInTransaction(tx, { opportunityId: opportunity.id, resolution: 'rescheduled', followUpId });
    await completeClaim(tx, followUpId);
  });

  signalJobsEnqueued();
  return readFollowUp(db, followUpId);
}

export async function cancelFollowUp(options: {
  db: Database;
  actor: Actor;
  followUpId: string;
  command: { version: number; reason: string; replacement?: FollowUpDraftInput | undefined };
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<FollowUpDto> {
  const { db, actor, followUpId, command, requestId, completeClaim } = options;

  await db.transaction(async (tx) => {
    const { followUp, opportunity } = await lockOpenFollowUp(tx, actor, followUpId, command.version);
    await requireReplacementIfLast(tx, opportunity, followUpId, command.replacement);

    const timestamp = now();
    const updated = await tx
      .update(followUps)
      .set({
        state: 'cancelled',
        cancelledAt: timestamp,
        cancelledBy: actor.id,
        cancellationReason: command.reason,
        updatedAt: timestamp,
        version: sql`${followUps.version} + 1`,
      })
      .where(and(eq(followUps.id, followUpId), eq(followUps.version, command.version), eq(followUps.state, 'open')))
      .returning({ id: followUps.id });
    if (updated.length === 0) throw versionConflict();

    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'follow_up',
      entityId: followUpId,
      action: 'follow_up.cancelled',
      before: { task: followUp.title, state: 'open' },
      after: { task: followUp.title, state: 'cancelled' },
      reason: command.reason,
      requestId,
    });

    if (command.replacement) {
      await insertFollowUp(tx, {
        actor,
        opportunity,
        draft: command.replacement,
        requestId,
        fieldPrefix: 'replacement',
        context: 'replacement',
      });
    }
    await alertsChangedInTransaction(tx, { opportunityId: opportunity.id, resolution: 'cancelled', followUpId });
    await completeClaim(tx, followUpId);
  });

  signalJobsEnqueued();
  return readFollowUp(db, followUpId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Assignee options for one accessible opportunity, from the same predicate the writes use. */
export async function listAssigneeOptions(
  db: Database,
  actor: Actor,
  opportunityId: string,
): Promise<AssigneeOptionDto[]> {
  const [opportunity] = await db
    .select({ id: opportunities.id, ownerId: opportunities.ownerId, sectionId: opportunities.sectionId })
    .from(opportunities)
    .where(scopedWhere(actor, eq(opportunities.id, opportunityId)))
    .limit(1);
  if (!opportunity) {
    throw notFound(`opportunity ${opportunityId} absent or outside scope for actor ${actor.id}`);
  }

  const rows = await db
    .select({ id: users.id, fullName: users.fullName, role: users.role })
    .from(users)
    .where(followUpAssigneeScope(actor, opportunity))
    .orderBy(asc(users.fullName));

  const relationOrder = { owner: 0, section_lead: 1, management: 2 } as const;
  return rows
    .map((row): AssigneeOptionDto => ({
      id: row.id,
      fullName: row.fullName,
      relation:
        row.id === opportunity.ownerId ? 'owner' : row.role === 'lead' ? 'section_lead' : 'management',
    }))
    .sort((a, b) => relationOrder[a.relation] - relationOrder[b.relation]);
}

type ListFollowUpsQuery = z.output<typeof listFollowUpsQuerySchema>;

/**
 * The cross-opportunity follow-up list (FR-043).
 *
 * Scope is the parent opportunity's (SEC-004); the assignee filter narrows
 * within it and never widens it. Buckets are computed in SQL against today's
 * Dhaka date, so the server — not the browser clock — decides what is overdue.
 */
export async function listFollowUps(
  db: Database,
  actor: Actor,
  query: ListFollowUpsQuery,
): Promise<FollowUpListDto> {
  const today = dhakaToday();
  const filters: (SQL | undefined)[] = [];

  if (query.assignedTo) {
    filters.push(eq(followUps.assignedUserId, query.assignedTo === 'me' ? actor.id : query.assignedTo));
  }
  if (query.ownerId) filters.push(eq(opportunities.ownerId, query.ownerId));
  if (query.sectionId) filters.push(eq(opportunities.sectionId, query.sectionId));
  if (query.hold === 'exclude') filters.push(ne(opportunities.status, 'on_hold'));
  if (query.hold === 'only') filters.push(eq(opportunities.status, 'on_hold'));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(followUps.title, term), ilike(opportunities.name, term), ilike(opportunities.reference, term)));
  }

  const base = scopedWhere(actor, ...filters);

  const bucket: Record<ListFollowUpsQuery['view'], SQL | undefined> = {
    open: eq(followUps.state, 'open'),
    // The dashboard's definitions (FR-081): one meaning of "overdue" everywhere.
    overdue: overdueFollowUp(today),
    today: dueTodayFollowUp(today),
    upcoming: and(eq(followUps.state, 'open'), sql`${followUps.dueDate} > ${today}::date`),
    completed: eq(followUps.state, 'completed'),
    cancelled: eq(followUps.state, 'cancelled'),
    all: undefined,
  };

  const [countRow] = await db
    .select({
      open: sql<number>`count(*) FILTER (WHERE ${bucket.open})::int`,
      overdue: sql<number>`count(*) FILTER (WHERE ${bucket.overdue})::int`,
      today: sql<number>`count(*) FILTER (WHERE ${bucket.today})::int`,
      upcoming: sql<number>`count(*) FILTER (WHERE ${bucket.upcoming})::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${bucket.completed})::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${bucket.cancelled})::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(followUps)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .where(base);

  const counts = {
    open: countRow?.open ?? 0,
    overdue: countRow?.overdue ?? 0,
    today: countRow?.today ?? 0,
    upcoming: countRow?.upcoming ?? 0,
    completed: countRow?.completed ?? 0,
    cancelled: countRow?.cancelled ?? 0,
    all: countRow?.all ?? 0,
  };

  const owner = alias(users, 'opportunity_owner');
  const closedView = query.view === 'completed' || query.view === 'cancelled';
  const rows = await db
    .select({
      ...followUpSelection,
      oppReference: opportunities.reference,
      oppName: opportunities.name,
      oppStage: opportunities.stage,
      oppStatus: opportunities.status,
      oppOwnerName: owner.fullName,
      oppSectionName: sections.name,
    })
    .from(followUps)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .innerJoin(owner, eq(owner.id, opportunities.ownerId))
    .innerJoin(sections, eq(sections.id, opportunities.sectionId))
    .innerJoin(assignee, eq(assignee.id, followUps.assignedUserId))
    .innerJoin(creator, eq(creator.id, followUps.createdBy))
    .leftJoin(completer, eq(completer.id, followUps.completedBy))
    .leftJoin(canceller, eq(canceller.id, followUps.cancelledBy))
    .where(and(base, bucket[query.view]))
    .orderBy(
      ...(closedView
        ? [desc(sql`coalesce(${followUps.completedAt}, ${followUps.cancelledAt})`), desc(followUps.createdAt)]
        : [asc(followUps.dueDate), asc(followUps.createdAt)]),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const items: FollowUpListItemDto[] = rows.map((row) => ({
    ...toFollowUpDto(row),
    opportunity: {
      id: row.opportunityId,
      reference: row.oppReference,
      name: row.oppName,
      stage: row.oppStage,
      status: row.oppStatus,
      ownerName: row.oppOwnerName,
      sectionName: row.oppSectionName,
    },
  }));

  return {
    items,
    total: counts[query.view],
    page: query.page,
    pageSize: query.pageSize,
    today,
    counts,
  };
}
