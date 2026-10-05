/**
 * Transactional opportunity operations.
 *
 * Every read composes the policy predicate from server/policy/scope.ts into the
 * SQL, so filtering, counting, sorting and pagination all run over permitted
 * rows only (SEC-002). Every write re-validates the proposed associations
 * against current database state rather than trusting the request (SEC-001).
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';

import type {
  BoardDto,
  BoardLaneDto,
  CreateOpportunityResultDto,
  FollowUpDto,
  HistoryEntryDto,
  NextActionDto,
  OpportunityDetailDto,
  OpportunityListItemDto,
  Paginated,
} from '../../shared/api.js';
import {
  BOARD_LANES,
  FOLLOW_UP_STATE_LABELS,
  LOSS_REASON_LABELS,
  PRIORITY_LABELS,
  SOLUTION_CATEGORY_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  boardLane,
  type BoardLane,
} from '../../shared/enums.js';
import { canonicalMoney } from '../../shared/money.js';
import {
  PATCHABLE_OPPORTUNITY_FIELDS,
  type OpportunitySortKey,
  type boardQuerySchema,
  type listOpportunitiesQuerySchema,
} from '../../shared/validation.js';
import type { z } from 'zod';

import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { auditEvents, followUps, opportunities, organizations, sections, users } from '../db/schema.js';
import { forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { eligibleOwnerScope, opportunityScope, scopedWhere } from '../policy/scope.js';
import { OPPORTUNITY_FIELD_LABELS, diffRecords, recordAuditEvent } from './audit.js';
import { getFirstFollowUp, listFollowUpsForOpportunity } from './followUps.js';
import type { CompleteClaimInTransaction } from './idempotency.js';

type ListQuery = z.output<typeof listOpportunitiesQuerySchema>;
type BoardQuery = z.output<typeof boardQuerySchema>;

const SORT_COLUMNS: Record<OpportunitySortKey, SQL | ReturnType<typeof sql>> = {
  createdAt: opportunities.createdAt as unknown as SQL,
  name: opportunities.name as unknown as SQL,
  estimatedValue: opportunities.estimatedValue as unknown as SQL,
  stage: opportunities.stage as unknown as SQL,
  priority: opportunities.priority as unknown as SQL,
  expectedAwardDate: opportunities.expectedAwardDate as unknown as SQL,
};

// ---------------------------------------------------------------------------
// Next action (BR-013)
// ---------------------------------------------------------------------------

/**
 * The earliest due open follow-up per opportunity, with creation time as a
 * stable tie-breaker. There is no separately editable next-action column: this
 * query is the only definition.
 */
async function loadNextActions(
  db: Database,
  opportunityIds: readonly string[],
): Promise<Map<string, NextActionDto>> {
  const result = new Map<string, NextActionDto>();
  if (opportunityIds.length === 0) return result;

  const rows = await db.execute<{
    opportunity_id: string;
    id: string;
    title: string;
    due_date: string;
    state: 'open' | 'completed' | 'cancelled';
    assigned_user_id: string;
    assignee_name: string;
  }>(sql`
    SELECT DISTINCT ON (f.opportunity_id)
      f.opportunity_id,
      f.id,
      f.title,
      f.due_date,
      f.state,
      f.assigned_user_id,
      u.full_name AS assignee_name
    FROM ${followUps} f
    JOIN ${users} u ON u.id = f.assigned_user_id
    WHERE f.state = 'open'
      AND f.opportunity_id IN (${sql.join(
        opportunityIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    ORDER BY f.opportunity_id, f.due_date ASC, f.created_at ASC
  `);

  for (const row of rows.rows) {
    result.set(row.opportunity_id, {
      followUpId: row.id,
      title: row.title,
      dueDate: row.due_date,
      state: row.state,
      assigneeId: row.assigned_user_id,
      assigneeName: row.assignee_name,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

const listSelection = {
  id: opportunities.id,
  reference: opportunities.reference,
  name: opportunities.name,
  organizationId: organizations.id,
  organizationName: organizations.name,
  organizationType: organizations.type,
  organizationLocation: organizations.location,
  solutionCategory: opportunities.solutionCategory,
  estimatedValue: opportunities.estimatedValue,
  stage: opportunities.stage,
  status: opportunities.status,
  priority: opportunities.priority,
  ownerId: opportunities.ownerId,
  ownerName: users.fullName,
  sectionId: opportunities.sectionId,
  sectionName: sections.name,
  expectedAwardDate: opportunities.expectedAwardDate,
  awardedValue: opportunities.awardedValue,
  createdAt: opportunities.createdAt,
  version: opportunities.version,
} as const;

type ListRow = {
  [K in keyof typeof listSelection]: (typeof listSelection)[K] extends { _: { data: infer D } }
    ? D
    : never;
};

function toListItem(row: ListRow, nextAction: NextActionDto | null): OpportunityListItemDto {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    organization: {
      id: row.organizationId,
      name: row.organizationName,
      type: row.organizationType,
      location: row.organizationLocation,
    },
    solutionCategory: row.solutionCategory,
    estimatedValue: canonicalMoney(row.estimatedValue),
    stage: row.stage,
    status: row.status,
    priority: row.priority,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    sectionId: row.sectionId,
    sectionName: row.sectionName,
    expectedAwardDate: row.expectedAwardDate,
    awardedValue: row.awardedValue === null ? null : canonicalMoney(row.awardedValue),
    nextAction,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function baseQuery(db: Database) {
  return db
    .select(listSelection)
    .from(opportunities)
    .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
    .innerJoin(users, eq(users.id, opportunities.ownerId))
    .innerJoin(sections, eq(sections.id, opportunities.sectionId));
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listOpportunities(
  db: Database,
  actor: Actor,
  query: ListQuery,
): Promise<Paginated<OpportunityListItemDto>> {
  const filters: (SQL | undefined)[] = [];

  if (query.q) {
    // Parameterised: the term is bound, never concatenated, and it is combined
    // with the scope predicate rather than replacing it.
    const term = `%${query.q}%`;
    filters.push(
      or(
        ilike(opportunities.name, term),
        ilike(opportunities.reference, term),
        ilike(organizations.name, term),
      ),
    );
  }
  if (query.stage) filters.push(eq(opportunities.stage, query.stage));
  if (query.status) filters.push(eq(opportunities.status, query.status));
  if (query.priority) filters.push(eq(opportunities.priority, query.priority));
  if (query.solutionCategory) filters.push(eq(opportunities.solutionCategory, query.solutionCategory));
  if (query.organizationId) filters.push(eq(opportunities.organizationId, query.organizationId));
  if (query.ownerId) filters.push(eq(opportunities.ownerId, query.ownerId));
  if (query.sectionId) filters.push(eq(opportunities.sectionId, query.sectionId));
  if (query.expectedAwardFrom) filters.push(gte(opportunities.expectedAwardDate, query.expectedAwardFrom));
  if (query.expectedAwardTo) filters.push(lte(opportunities.expectedAwardDate, query.expectedAwardTo));

  const where = scopedWhere(actor, ...filters);

  // The total counts permitted rows only; an inaccessible record can never
  // appear in it, not even as a number.
  const totalRows = await db
    .select({ value: count() })
    .from(opportunities)
    .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
    .where(where);
  const total = totalRows[0]?.value ?? 0;

  const sortColumn = SORT_COLUMNS[query.sort];
  const direction = query.dir === 'asc' ? asc : desc;

  const rows = (await baseQuery(db)
    .where(where)
    .orderBy(direction(sortColumn), desc(opportunities.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)) as ListRow[];

  const nextActions = await loadNextActions(db, rows.map((row) => row.id));

  return {
    items: rows.map((row) => toListItem(row, nextActions.get(row.id) ?? null)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getOpportunityDetail(
  db: Database,
  actor: Actor,
  opportunityId: string,
): Promise<OpportunityDetailDto> {
  const [row] = await db
    .select({
      ...listSelection,
      department: opportunities.department,
      description: opportunities.description,
      fundingSource: opportunities.fundingSource,
      expectedPublicationDate: opportunities.expectedPublicationDate,
      awardDate: opportunities.awardDate,
      lossReason: opportunities.lossReason,
      lossNote: opportunities.lossNote,
      closedDate: opportunities.closedDate,
      statusNote: opportunities.statusNote,
      createdById: opportunities.createdBy,
      updatedAt: opportunities.updatedAt,
    })
    .from(opportunities)
    .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
    .innerJoin(users, eq(users.id, opportunities.ownerId))
    .innerJoin(sections, eq(sections.id, opportunities.sectionId))
    .where(scopedWhere(actor, eq(opportunities.id, opportunityId)))
    .limit(1);

  if (!row) {
    throw notFound(`opportunity ${opportunityId} absent or outside scope for actor ${actor.id}`);
  }

  const [creatorRow] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, row.createdById))
    .limit(1);

  const nextActions = await loadNextActions(db, [row.id]);

  return {
    ...toListItem(row as unknown as ListRow, nextActions.get(row.id) ?? null),
    department: row.department,
    description: row.description,
    fundingSource: row.fundingSource,
    expectedPublicationDate: row.expectedPublicationDate,
    awardDate: row.awardDate,
    // Constrained to the presets by migration 0002.
    lossReason: row.lossReason as OpportunityDetailDto['lossReason'],
    lossNote: row.lossNote,
    closedDate: row.closedDate,
    statusNote: row.statusNote,
    createdByName: creatorRow?.fullName ?? 'Unknown',
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Throws 404 unless the opportunity is visible to the actor. */
export async function assertOpportunityVisible(
  db: Database,
  actor: Actor,
  opportunityId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(scopedWhere(actor, eq(opportunities.id, opportunityId)))
    .limit(1);

  if (!row) {
    throw notFound(`opportunity ${opportunityId} absent or outside scope for actor ${actor.id}`);
  }
}

// ---------------------------------------------------------------------------
// Create (FR-020, BR-001, BR-014, BR-091)
// ---------------------------------------------------------------------------

export interface CreateOpportunityCommand {
  name: string;
  organizationId: string;
  department?: string | undefined;
  solutionCategory: OpportunityDetailDto['solutionCategory'];
  description?: string | undefined;
  estimatedValue: string;
  fundingSource?: string | undefined;
  ownerId: string;
  sectionId: string;
  stage: OpportunityDetailDto['stage'];
  priority: OpportunityDetailDto['priority'];
  expectedPublicationDate?: string | undefined;
  expectedAwardDate?: string | undefined;
  initialFollowUpTitle: string;
  initialFollowUpDueDate: string;
}

export async function createOpportunity(options: {
  db: Database;
  actor: Actor;
  command: CreateOpportunityCommand;
  requestId: string;
  /** Completes the idempotency claim in the same transaction as the insert. */
  completeClaim?: CompleteClaimInTransaction;
}): Promise<CreateOpportunityResultDto> {
  const { db, actor, command, requestId, completeClaim } = options;

  // --- Validate proposed associations against the database, not the request ---

  // BR-001: the owner must be an eligible active owner the actor may assign.
  // One response for every rejection reason so an unauthorised caller cannot
  // learn whether a given account exists.
  const [owner] = await db
    .select({ id: users.id, sectionId: users.sectionId })
    .from(users)
    .where(and(eligibleOwnerScope(actor), eq(users.id, command.ownerId)))
    .limit(1);

  if (!owner || !owner.sectionId) {
    throw forbidden('You cannot assign an opportunity to that owner.');
  }

  // BR-001: the opportunity's section must equal its owner's section.
  if (owner.sectionId !== command.sectionId) {
    throw validationFailed({
      sectionId: 'The section must match the selected owner’s section.',
    });
  }

  const [organization] = await db
    .select({ id: organizations.id, archivedAt: organizations.archivedAt })
    .from(organizations)
    .where(eq(organizations.id, command.organizationId))
    .limit(1);

  if (!organization || organization.archivedAt) {
    throw validationFailed({ organizationId: 'Select a current procuring organization.' });
  }

  // §4.1: an award date earlier than publication is flagged, not rejected.
  const warnings: string[] = [];
  if (
    command.expectedPublicationDate &&
    command.expectedAwardDate &&
    command.expectedAwardDate < command.expectedPublicationDate
  ) {
    warnings.push(
      'The expected award date is earlier than the expected tender publication date. Saved as entered — check the dates.',
    );
  }

  const estimatedValue = canonicalMoney(command.estimatedValue);
  const timestamp = now();

  // --- One transaction: opportunity + first follow-up + audit (BR-014) ---
  const created = await db.transaction(async (tx) => {
    const referenceResult = await tx.execute<{ reference: string }>(
      sql`SELECT 'OPP-' || lpad(nextval('opportunity_reference_seq')::text, 6, '0') AS reference`,
    );
    const reference = referenceResult.rows[0]?.reference;
    if (!reference) throw new Error('Failed to allocate an opportunity reference.');

    const [opportunity] = await tx
      .insert(opportunities)
      .values({
        reference,
        name: command.name,
        organizationId: command.organizationId,
        department: command.department ?? null,
        solutionCategory: command.solutionCategory,
        description: command.description ?? null,
        estimatedValue,
        fundingSource: command.fundingSource ?? null,
        ownerId: command.ownerId,
        sectionId: command.sectionId,
        stage: command.stage,
        // M1 creates Active, nonterminal records only.
        status: 'active',
        priority: command.priority,
        expectedPublicationDate: command.expectedPublicationDate ?? null,
        expectedAwardDate: command.expectedAwardDate ?? null,
        createdBy: actor.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: opportunities.id, reference: opportunities.reference });

    if (!opportunity) throw new Error('Opportunity insert returned no row.');

    // BR-014: the first follow-up is created in the same transaction and is
    // assigned to the validated eligible owner (plan 7.4).
    const [followUp] = await tx
      .insert(followUps)
      .values({
        opportunityId: opportunity.id,
        title: command.initialFollowUpTitle,
        assignedUserId: command.ownerId,
        dueDate: command.initialFollowUpDueDate,
        priority: command.priority,
        state: 'open',
        createdBy: actor.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: followUps.id });

    if (!followUp) throw new Error('Follow-up insert returned no row.');

    // Exactly one creation audit event. The first follow-up is recorded inside
    // it rather than as a second event, so a retry can be checked for
    // duplicates unambiguously.
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'opportunity',
      entityId: opportunity.id,
      action: 'opportunity.created',
      domain: 'commercial',
      before: null,
      after: {
        reference: opportunity.reference,
        name: command.name,
        organizationId: command.organizationId,
        solutionCategory: command.solutionCategory,
        estimatedValue,
        ownerId: command.ownerId,
        sectionId: command.sectionId,
        stage: command.stage,
        status: 'active',
        priority: command.priority,
        firstFollowUp: {
          id: followUp.id,
          title: command.initialFollowUpTitle,
          dueDate: command.initialFollowUpDueDate,
          assignedUserId: command.ownerId,
        },
      },
      requestId,
    });

    if (completeClaim) await completeClaim(tx, opportunity.id);

    return { opportunityId: opportunity.id };
  });

  return getCreationResult(db, actor, created.opportunityId, warnings);
}

/**
 * The canonical creation result, also used to answer a replayed create. Read
 * through scope, so a replay after access was revoked is a 404. The first
 * follow-up is found by creation order, not by state: once M2 lets it be
 * completed, "the earliest open one" would be a different task.
 */
export async function getCreationResult(
  db: Database,
  actor: Actor,
  opportunityId: string,
  warnings: string[] = [],
): Promise<CreateOpportunityResultDto> {
  const opportunity = await getOpportunityDetail(db, actor, opportunityId);
  const firstFollowUp = await getFirstFollowUp(db, opportunityId);
  if (!firstFollowUp) throw new Error(`Opportunity ${opportunityId} has no first follow-up.`);
  return { opportunity, firstFollowUp, warnings };
}

// ---------------------------------------------------------------------------
// Basic edit (plan 7.4, BR-090)
// ---------------------------------------------------------------------------

export type PatchOpportunityCommand = {
  version: number;
} & Partial<Record<(typeof PATCHABLE_OPPORTUNITY_FIELDS)[number], unknown>>;

export async function patchOpportunity(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: PatchOpportunityCommand;
  requestId: string;
}): Promise<OpportunityDetailDto> {
  const { db, actor, opportunityId, command, requestId } = options;

  // 404 before anything else: an invisible record must not produce a 403, a
  // validation error, or any other distinguishable response.
  const [current] = await db
    .select({
      id: opportunities.id,
      version: opportunities.version,
      stage: opportunities.stage,
      status: opportunities.status,
      name: opportunities.name,
      department: opportunities.department,
      solutionCategory: opportunities.solutionCategory,
      description: opportunities.description,
      estimatedValue: opportunities.estimatedValue,
      fundingSource: opportunities.fundingSource,
      priority: opportunities.priority,
      expectedPublicationDate: opportunities.expectedPublicationDate,
      expectedAwardDate: opportunities.expectedAwardDate,
    })
    .from(opportunities)
    .where(scopedWhere(actor, eq(opportunities.id, opportunityId)))
    .limit(1);

  if (!current) {
    throw notFound(`opportunity ${opportunityId} absent or outside scope for actor ${actor.id}`);
  }

  // Closed records are read-only. To correct one, management reopens it
  // (BR-012) or a cancelled one is returned to Active first, so every change
  // to a closed record passes through an audited, reasoned transition.
  if (current.stage === 'awarded' || current.stage === 'lost' || current.status === 'cancelled') {
    throw forbidden(
      'Awarded, Lost and Cancelled opportunities are closed to editing. Reopen it, or return it to Active, first.',
    );
  }

  const changes: Record<string, unknown> = {};
  for (const field of PATCHABLE_OPPORTUNITY_FIELDS) {
    if (field in command && command[field] !== undefined) {
      changes[field] = command[field];
    }
  }
  if ('estimatedValue' in changes && typeof changes.estimatedValue === 'string') {
    changes.estimatedValue = canonicalMoney(changes.estimatedValue);
  }

  if (Object.keys(changes).length === 0) {
    throw validationFailed({ _: 'Provide at least one field to update.' });
  }

  const diff = diffRecords(current as unknown as Record<string, unknown>, changes);
  if (diff.changed.length === 0) {
    // Nothing actually differs; return current state without burning a version.
    return getOpportunityDetail(db, actor, opportunityId);
  }

  const timestamp = now();

  const updated = await db.transaction(async (tx) => {
    // The version check lives in the UPDATE predicate, so two concurrent edits
    // from the same version cannot both win (BR-090).
    const rows = await tx
      .update(opportunities)
      .set({
        ...changes,
        updatedAt: timestamp,
        version: sql`${opportunities.version} + 1`,
      })
      .where(
        and(
          opportunityScope(actor),
          eq(opportunities.id, opportunityId),
          eq(opportunities.version, command.version),
        ),
      )
      .returning({ id: opportunities.id, version: opportunities.version });

    if (rows.length === 0) return null;

    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId,
      entityType: 'opportunity',
      entityId: opportunityId,
      action: 'opportunity.updated',
      domain: 'commercial',
      before: diff.before,
      after: diff.after,
      requestId,
    });

    return rows[0];
  });

  if (!updated) {
    // Still visible (checked above) but the version moved on.
    throw versionConflict();
  }

  return getOpportunityDetail(db, actor, opportunityId);
}

// ---------------------------------------------------------------------------
// Child reads — scope is inherited from the parent opportunity (SEC-004)
// ---------------------------------------------------------------------------

export async function listOpportunityFollowUps(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  page: number;
  pageSize: number;
}): Promise<Paginated<FollowUpDto>> {
  const { db, actor, opportunityId, page, pageSize } = options;
  await assertOpportunityVisible(db, actor, opportunityId);
  return listFollowUpsForOpportunity(db, opportunityId, page, pageSize);
}

export async function listOpportunityHistory(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  page: number;
  pageSize: number;
}): Promise<Paginated<HistoryEntryDto>> {
  const { db, actor, opportunityId, page, pageSize } = options;
  await assertOpportunityVisible(db, actor, opportunityId);

  // Commercial history only. Administrative events are a separate domain and
  // are never returned here (SEC-012).
  const where = and(
    eq(auditEvents.opportunityId, opportunityId),
    eq(auditEvents.domain, 'commercial'),
  ) as SQL;

  const totalRows = await db.select({ value: count() }).from(auditEvents).where(where);
  const total = totalRows[0]?.value ?? 0;

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      actorName: users.fullName,
      occurredAt: auditEvents.occurredAt,
      reason: auditEvents.reason,
      beforeData: auditEvents.beforeData,
      afterData: auditEvents.afterData,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(where)
    .orderBy(desc(auditEvents.occurredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const names = await resolveHistoryNames(
    db,
    rows.flatMap((row) => [row.beforeData, row.afterData]),
  );

  return {
    items: rows.map((row) => {
      const before = (row.beforeData ?? {}) as Record<string, unknown>;
      const after = (row.afterData ?? {}) as Record<string, unknown>;
      const subject = after.task ?? before.task;
      return {
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        actorName: row.actorName ?? 'System',
        occurredAt: row.occurredAt.toISOString(),
        reason: row.reason,
        subject: typeof subject === 'string' ? subject : null,
        changes: toHistoryChanges(before, after, names),
      };
    }),
    total,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// History presentation
// ---------------------------------------------------------------------------

/** Keys kept in audit data for context, not shown as field changes. */
const HISTORY_CONTEXT_KEYS = new Set(['firstFollowUp', 'task', 'context']);

const ID_FIELDS = {
  user: ['ownerId', 'assignedUserId'],
  organization: ['organizationId'],
  section: ['sectionId'],
} as const;

type HistoryNames = Map<string, string>;

/**
 * Audit rows store identifiers and enum values, as they should. History shows
 * people names, organization names and labels instead. Only ids already present
 * in an accessible opportunity's own history are resolved, so this reveals
 * nothing outside the record's scope.
 */
async function resolveHistoryNames(db: Database, payloads: unknown[]): Promise<HistoryNames> {
  const collect = (fields: readonly string[]) => {
    const found = new Set<string>();
    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      for (const field of fields) {
        const value = (payload as Record<string, unknown>)[field];
        if (typeof value === 'string') found.add(value);
      }
    }
    return [...found];
  };

  const names: HistoryNames = new Map();
  const userIds = collect(ID_FIELDS.user);
  const organizationIds = collect(ID_FIELDS.organization);
  const sectionIds = collect(ID_FIELDS.section);

  if (userIds.length > 0) {
    const rows = await db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const row of rows) names.set(row.id, row.name);
  }
  if (organizationIds.length > 0) {
    const rows = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, organizationIds));
    for (const row of rows) names.set(row.id, row.name);
  }
  if (sectionIds.length > 0) {
    const rows = await db
      .select({ id: sections.id, name: sections.name })
      .from(sections)
      .where(inArray(sections.id, sectionIds));
    for (const row of rows) names.set(row.id, row.name);
  }
  return names;
}

const VALUE_LABELS: Record<string, Record<string, string>> = {
  stage: STAGE_LABELS,
  status: STATUS_LABELS,
  priority: PRIORITY_LABELS,
  solutionCategory: SOLUTION_CATEGORY_LABELS,
  lossReason: LOSS_REASON_LABELS,
  state: FOLLOW_UP_STATE_LABELS,
};

function toHistoryChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  names: HistoryNames,
): HistoryEntryDto['changes'] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  return [...keys]
    .filter((key) => !HISTORY_CONTEXT_KEYS.has(key))
    .map((key) => ({
      field: key,
      label: OPPORTUNITY_FIELD_LABELS[key] ?? key,
      before: displayValue(key, before[key], names),
      after: displayValue(key, after[key], names),
    }));
}

function displayValue(field: string, value: unknown, names: HistoryNames): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return VALUE_LABELS[field]?.[value] ?? names.get(value) ?? value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Pipeline board (FR-021, D-001, D-006)
// ---------------------------------------------------------------------------

/** Cards returned per lane. The table view pages through anything beyond. */
export const BOARD_LANE_LIMIT = 50;

/** The lane expression, matching `boardLane` in shared/enums.ts. */
const laneExpression = sql<BoardLane>`CASE
  WHEN ${opportunities.status} IN ('on_hold', 'cancelled') THEN ${opportunities.status}::text
  ELSE ${opportunities.stage}::text END`;

/**
 * The board is bounded per lane rather than downloaded whole (plan 4.2). Lane
 * totals and values are computed in SQL over the permitted rows, so a lane's
 * header counts records the card list may not show, never records outside
 * scope. The Awarded lane sums actual awarded value; every other lane sums
 * estimates, each labelled as such (D-006).
 */
export async function getBoard(db: Database, actor: Actor, query: BoardQuery): Promise<BoardDto> {
  const filters: (SQL | undefined)[] = [];
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(ilike(opportunities.name, term), ilike(opportunities.reference, term), ilike(organizations.name, term)),
    );
  }
  if (query.priority) filters.push(eq(opportunities.priority, query.priority));
  if (query.solutionCategory) filters.push(eq(opportunities.solutionCategory, query.solutionCategory));
  if (query.organizationId) filters.push(eq(opportunities.organizationId, query.organizationId));
  if (query.ownerId) filters.push(eq(opportunities.ownerId, query.ownerId));
  if (query.sectionId) filters.push(eq(opportunities.sectionId, query.sectionId));

  const where = scopedWhere(actor, ...filters);

  const aggregates = await db
    .select({
      lane: laneExpression,
      total: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(CASE WHEN ${opportunities.stage} = 'awarded'
        THEN ${opportunities.awardedValue} ELSE ${opportunities.estimatedValue} END), 0)::numeric(16,2)::text`,
    })
    .from(opportunities)
    .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
    .where(where)
    .groupBy(laneExpression);

  // Newest first within each lane, at most BOARD_LANE_LIMIT per lane.
  const ranked = db
    .select({
      id: opportunities.id,
      rank: sql<number>`row_number() OVER (PARTITION BY ${laneExpression} ORDER BY ${opportunities.createdAt} DESC, ${opportunities.id})`.as(
        'lane_rank',
      ),
    })
    .from(opportunities)
    .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
    .where(where)
    .as('ranked');

  const pageIds = (
    await db.select({ id: ranked.id }).from(ranked).where(sql`${ranked.rank} <= ${BOARD_LANE_LIMIT}`)
  ).map((row) => row.id);

  const rows =
    pageIds.length === 0
      ? []
      : ((await baseQuery(db)
          .where(inArray(opportunities.id, pageIds))
          .orderBy(desc(opportunities.createdAt), asc(opportunities.id))) as ListRow[]);

  const nextActions = await loadNextActions(db, rows.map((row) => row.id));
  const byLane = new Map<BoardLane, OpportunityListItemDto[]>();
  for (const row of rows) {
    const item = toListItem(row, nextActions.get(row.id) ?? null);
    const lane = boardLane(item.stage, item.status);
    byLane.set(lane, [...(byLane.get(lane) ?? []), item]);
  }

  const lanes: BoardLaneDto[] = BOARD_LANES.map((lane) => {
    const aggregate = aggregates.find((row) => row.lane === lane);
    return {
      lane,
      total: aggregate?.total ?? 0,
      value: aggregate?.value ?? '0.00',
      valueBasis: lane === 'awarded' ? 'awarded' : 'estimated',
      items: byLane.get(lane) ?? [],
    };
  });

  return { lanes, laneLimit: BOARD_LANE_LIMIT };
}
