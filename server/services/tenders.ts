/**
 * Tender cycles and bid submission (FR-050, FR-051, FR-052, BR-040).
 *
 * Every read is located through the parent opportunity's scope, and every
 * write locks the opportunity first (the same lock order as the follow-up,
 * transition and transfer services), then the tender. The tender's responsible
 * owner is never stored: it is the opportunity's current owner, so a transfer
 * moves it with no extra write (BR-050).
 *
 * Mark Submitted records the bid. Moving the opportunity to Bid Submitted is a
 * separate, explicit choice made by the user in the same request; the stage is
 * never advanced silently and never set to Awarded (FR-051, AT-10).
 */
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { Paginated, TenderDto, TenderSubmissionResultDto } from '../../shared/api.js';
import {
  NOTICE_STATE_LABELS,
  PIPELINE_STAGES,
  STAGE_LABELS,
  TENDER_DUE_SOON_HOURS,
  isTerminalStage,
  offersBidSubmittedStage,
  type TenderIndicator,
} from '../../shared/enums.js';
import type {
  cancelTenderSchema,
  createTenderSchema,
  listTendersQuerySchema,
  submitTenderSchema,
  tenderNoticeSchema,
  updateTenderSchema,
} from '../../shared/validation.js';
import { dhakaToday, now } from '../clock.js';
import type { Database } from '../db/client.js';
import { auditEvents, opportunities, organizations, sections, tenders, users } from '../db/schema.js';
import { conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canManageTenders, opportunityScope, scopedWhere } from '../policy/scope.js';
import { diffRecords, recordAuditEvent } from './audit.js';
import { lockOpportunity, type LockedOpportunity } from './followUps.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { assertOpportunityVisible } from './opportunities.js';

type CreateCommand = z.output<typeof createTenderSchema>;
type UpdateCommand = z.output<typeof updateTenderSchema>;
type SubmitCommand = z.output<typeof submitTenderSchema>;

/** Clock differences between the browser and the server. */
const FUTURE_ALLOWANCE_MS = 5 * 60_000;

const invalidTransition = (message: string) => conflict(message, 'invalid_transition');

const procuring = alias(organizations, 'procuring_organization');
const owner = alias(users, 'tender_owner');
const creator = alias(users, 'tender_creator');

const selection = {
  id: tenders.id,
  opportunityId: opportunities.id,
  opportunityReference: opportunities.reference,
  opportunityName: opportunities.name,
  opportunityStage: opportunities.stage,
  opportunityStatus: opportunities.status,
  opportunityOrganizationId: opportunities.organizationId,
  procuringOrganizationId: procuring.id,
  procuringOrganizationName: procuring.name,
  title: tenders.title,
  reference: tenders.reference,
  procurementMethod: tenders.procurementMethod,
  noticeUrl: tenders.noticeUrl,
  publicationDate: tenders.publicationDate,
  clarificationDeadline: tenders.clarificationDeadline,
  submissionDeadline: tenders.submissionDeadline,
  bidStatus: tenders.bidStatus,
  submittedAt: tenders.submittedAt,
  participationReason: tenders.participationReason,
  lateSubmissionNote: tenders.lateSubmissionNote,
  isCurrent: tenders.isCurrent,
  noticeState: tenders.noticeState,
  notes: tenders.notes,
  ownerId: owner.id,
  ownerName: owner.fullName,
  sectionId: sections.id,
  sectionName: sections.name,
  createdByName: creator.fullName,
  createdAt: tenders.createdAt,
  updatedAt: tenders.updatedAt,
  version: tenders.version,
} as const;

function baseQuery(db: Database) {
  return db
    .select(selection)
    .from(tenders)
    .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
    .innerJoin(procuring, eq(procuring.id, tenders.procuringOrganizationId))
    .innerJoin(owner, eq(owner.id, opportunities.ownerId))
    .innerJoin(sections, eq(sections.id, opportunities.sectionId))
    .innerJoin(creator, eq(creator.id, tenders.createdBy));
}

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

/**
 * FR-052, BR-040. Only a current notice on an open opportunity raises a
 * deadline alert; superseded and cancelled notices, and tenders on a Cancelled,
 * Awarded or Lost opportunity, are shown without one. On Hold keeps its alerts
 * (BR-014: the procurement deadline still exists).
 */
export function tenderIndicator(
  tender: Pick<Row, 'noticeState' | 'bidStatus' | 'submissionDeadline' | 'opportunityStage' | 'opportunityStatus'>,
  at: Date = now(),
): TenderIndicator {
  if (tender.noticeState !== 'current') return 'inactive';
  if (tender.bidStatus === 'submitted') return 'submitted';
  if (tender.bidStatus === 'not_participating') return 'not_participating';
  if (isTerminalStage(tender.opportunityStage) || tender.opportunityStatus === 'cancelled') return 'inactive';
  const remaining = tender.submissionDeadline.getTime() - at.getTime();
  if (remaining < 0) return 'missed';
  if (remaining <= TENDER_DUE_SOON_HOURS * 3_600_000) return 'due_soon';
  return 'upcoming';
}

function stageMismatch(row: Row): boolean {
  if (!row.isCurrent || row.bidStatus !== 'submitted') return false;
  const index = PIPELINE_STAGES.indexOf(row.opportunityStage);
  return index >= 0 && index < PIPELINE_STAGES.indexOf('bid_submitted');
}

function opportunityClosed(opportunity: Pick<LockedOpportunity, 'stage' | 'status'>): boolean {
  return isTerminalStage(opportunity.stage) || opportunity.status === 'cancelled';
}

function toDto(actor: Actor, row: Row, at: Date): TenderDto {
  const closed = opportunityClosed({ stage: row.opportunityStage, status: row.opportunityStatus });
  return {
    id: row.id,
    opportunity: {
      id: row.opportunityId,
      reference: row.opportunityReference,
      name: row.opportunityName,
      stage: row.opportunityStage,
      status: row.opportunityStatus,
      organizationId: row.opportunityOrganizationId,
    },
    procuringOrganization: { id: row.procuringOrganizationId, name: row.procuringOrganizationName },
    procuringDiffersFromOpportunity: row.procuringOrganizationId !== row.opportunityOrganizationId,
    title: row.title,
    reference: row.reference,
    procurementMethod: row.procurementMethod,
    noticeUrl: row.noticeUrl,
    publicationDate: row.publicationDate,
    clarificationDeadline: row.clarificationDeadline?.toISOString() ?? null,
    submissionDeadline: row.submissionDeadline.toISOString(),
    bidStatus: row.bidStatus,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    participationReason: row.participationReason,
    lateSubmissionNote: row.lateSubmissionNote,
    isCurrent: row.isCurrent,
    noticeState: row.noticeState,
    notes: row.notes,
    responsibleOwner: { id: row.ownerId, fullName: row.ownerName },
    section: { id: row.sectionId, name: row.sectionName },
    indicator: tenderIndicator(row, at),
    stageMismatch: stageMismatch(row),
    canOfferBidSubmittedStage:
      row.isCurrent && row.bidStatus !== 'submitted' && offersBidSubmittedStage(row.opportunityStage, row.opportunityStatus),
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    canEdit: canManageTenders(actor) && row.noticeState === 'current' && !closed,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every cycle for one opportunity: the current notice first, then newest deadline first. */
export async function listOpportunityTenders(db: Database, actor: Actor, opportunityId: string): Promise<TenderDto[]> {
  await assertOpportunityVisible(db, actor, opportunityId);
  const rows = await baseQuery(db)
    .where(scopedWhere(actor, eq(tenders.opportunityId, opportunityId)))
    .orderBy(desc(tenders.isCurrent), desc(tenders.submissionDeadline), desc(tenders.createdAt));
  const at = now();
  return rows.map((row) => toDto(actor, row, at));
}

/** The Tender Tracker (FR-052): deadline-sorted, filtered inside the scope predicate. */
export async function listTenders(
  db: Database,
  actor: Actor,
  query: z.output<typeof listTendersQuerySchema>,
): Promise<Paginated<TenderDto>> {
  const dhakaDeadline = sql`(${tenders.submissionDeadline} AT TIME ZONE 'Asia/Dhaka')::date`;
  const filters: (SQL | undefined)[] = [];
  if (query.notice === 'active') filters.push(eq(tenders.isCurrent, true));
  if (query.ownerId) filters.push(eq(opportunities.ownerId, query.ownerId));
  if (query.sectionId) filters.push(eq(opportunities.sectionId, query.sectionId));
  if (query.bidStatus) filters.push(eq(tenders.bidStatus, query.bidStatus));
  if (query.deadlineFrom) filters.push(sql`${dhakaDeadline} >= ${query.deadlineFrom}::date`);
  if (query.deadlineTo) filters.push(sql`${dhakaDeadline} <= ${query.deadlineTo}::date`);
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(tenders.title, term), ilike(tenders.reference, term), ilike(opportunities.name, term)));
  }
  const where = scopedWhere(actor, ...filters);

  const [total] = await db
    .select({ value: count() })
    .from(tenders)
    .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
    .where(where);
  const rows = await baseQuery(db)
    .where(where)
    .orderBy(
      query.dir === 'desc' ? desc(tenders.submissionDeadline) : asc(tenders.submissionDeadline),
      asc(tenders.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const at = now();
  return {
    items: rows.map((row) => toDto(actor, row, at)),
    total: total?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getTender(db: Database, actor: Actor, tenderId: string): Promise<TenderDto> {
  const [row] = await baseQuery(db).where(scopedWhere(actor, eq(tenders.id, tenderId))).limit(1);
  if (!row) throw notFound(`tender ${tenderId} absent or outside scope for actor ${actor.id}`);
  return toDto(actor, row, now());
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface TenderFacts {
  publicationDate: string;
  submissionDeadline: Date;
  clarificationDeadline: Date | null;
  bidStatus: string;
  participationReason: string | null;
  submittedAt: Date | null;
  lateSubmissionNote: string | null;
}

/** BR-040 chronology and reasons, as field errors. The CHECK constraints back these up. */
function chronologyErrors(facts: TenderFacts): Record<string, string> {
  const errors: Record<string, string> = {};
  if (dhakaToday(facts.submissionDeadline) < facts.publicationDate) {
    errors.submissionDeadline = 'The submission deadline cannot be before the publication date.';
  }
  if (facts.clarificationDeadline && facts.clarificationDeadline > facts.submissionDeadline) {
    errors.clarificationDeadline = 'The clarification deadline cannot be after the submission deadline.';
  }
  if (facts.bidStatus === 'not_participating' && !facts.participationReason) {
    errors.participationReason = 'Give the reason for not participating.';
  }
  if (facts.submittedAt && facts.submittedAt > facts.submissionDeadline && !facts.lateSubmissionNote) {
    errors.submissionDeadline =
      'The recorded submission is after this deadline. Keep the deadline, or explain the late submission first.';
  }
  return errors;
}

/** §7.1: the procuring entity is an organization in the directory, not archived. */
async function assertProcuringOrganization(tx: Database, organizationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.archivedAt)))
    .for('share')
    .limit(1);
  if (!row) throw validationFailed({ procuringOrganizationId: 'Choose an organization from the directory.' });
}

function assertOpportunityOpen(opportunity: LockedOpportunity): void {
  if (opportunityClosed(opportunity)) {
    throw invalidTransition('This opportunity is closed. Its tender records are kept as history and cannot change.');
  }
}

/**
 * Locates the tender through scope, then locks the opportunity and the tender
 * in that order. An inaccessible tender is the same 404 as a missing one.
 */
async function lockTender(tx: Database, actor: Actor, tenderId: string) {
  const [located] = await tx
    .select({ opportunityId: tenders.opportunityId })
    .from(tenders)
    .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
    .where(and(opportunityScope(actor), eq(tenders.id, tenderId)))
    .limit(1);
  if (!located) throw notFound(`tender ${tenderId} absent or outside scope for actor ${actor.id}`);

  const opportunity = await lockOpportunity(tx, actor, located.opportunityId);
  const [tender] = await tx
    .select()
    .from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.opportunityId, opportunity.id)))
    .for('update')
    .limit(1);
  if (!tender) throw notFound(`tender ${tenderId} moved during the request`);
  return { opportunity, tender };
}

async function writeTender(
  tx: Database,
  tenderId: string,
  expectedVersion: number,
  changes: Partial<typeof tenders.$inferInsert>,
): Promise<void> {
  const rows = await tx
    .update(tenders)
    .set({ ...changes, updatedAt: now(), version: sql`${tenders.version} + 1` })
    .where(and(eq(tenders.id, tenderId), eq(tenders.version, expectedVersion)))
    .returning({ id: tenders.id });
  if (rows.length === 0) throw versionConflict();
}

const auditable = (tender: typeof tenders.$inferSelect) => ({
  procuringOrganizationId: tender.procuringOrganizationId,
  title: tender.title,
  reference: tender.reference,
  procurementMethod: tender.procurementMethod,
  noticeUrl: tender.noticeUrl,
  publicationDate: tender.publicationDate,
  clarificationDeadline: tender.clarificationDeadline?.toISOString() ?? null,
  submissionDeadline: tender.submissionDeadline.toISOString(),
  bidStatus: tender.bidStatus,
  participationReason: tender.participationReason,
  notes: tender.notes,
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * FR-050: a new notice becomes the current one. Any previous current notice is
 * marked Superseded first (the partial unique index would refuse two), and
 * both changes are audited in the same transaction.
 */
export async function createTender(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: CreateCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<TenderDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;

  const id = await db.transaction(async (tx) => {
    const opportunity = await lockOpportunity(tx, actor, opportunityId);
    if (!canManageTenders(actor)) throw forbidden();
    assertOpportunityOpen(opportunity);

    const submissionDeadline = new Date(command.submissionDeadline);
    const clarificationDeadline = command.clarificationDeadline ? new Date(command.clarificationDeadline) : null;
    const participationReason = command.bidStatus === 'not_participating' ? (command.participationReason ?? null) : null;
    const errors = chronologyErrors({
      publicationDate: command.publicationDate,
      submissionDeadline,
      clarificationDeadline,
      bidStatus: command.bidStatus,
      participationReason,
      submittedAt: null,
      lateSubmissionNote: null,
    });
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    await assertProcuringOrganization(tx, command.procuringOrganizationId);

    const [previous] = await tx
      .select({ id: tenders.id, reference: tenders.reference, version: tenders.version })
      .from(tenders)
      .where(and(eq(tenders.opportunityId, opportunityId), eq(tenders.isCurrent, true)))
      .for('update')
      .limit(1);
    if (previous) {
      await writeTender(tx, previous.id, previous.version, { isCurrent: false, noticeState: 'superseded' });
      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId,
        entityType: 'tender',
        entityId: previous.id,
        action: 'tender.superseded',
        before: { about: previous.reference, noticeState: 'current' },
        after: { about: previous.reference, noticeState: 'superseded' },
        reason: `Replaced by tender ${command.reference}.`,
        requestId,
      });
    }

    const timestamp = now();
    const [created] = await tx
      .insert(tenders)
      .values({
        opportunityId,
        procuringOrganizationId: command.procuringOrganizationId,
        title: command.title,
        reference: command.reference,
        procurementMethod: command.procurementMethod ?? null,
        noticeUrl: command.noticeUrl ?? null,
        publicationDate: command.publicationDate,
        clarificationDeadline,
        submissionDeadline,
        bidStatus: command.bidStatus,
        participationReason,
        isCurrent: true,
        noticeState: 'current',
        notes: command.notes ?? null,
        createdBy: actor.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    if (!created) throw new Error('Tender insert returned no row.');

    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId,
      entityType: 'tender',
      entityId: created.id,
      action: 'tender.created',
      after: { about: created.reference, ...auditable(created), noticeState: 'current' },
      requestId,
    });
    await completeClaim(tx, created.id);
    return created.id;
  });

  return getTender(db, actor, id);
}

export async function updateTender(options: {
  db: Database;
  actor: Actor;
  tenderId: string;
  command: UpdateCommand;
  requestId: string;
}): Promise<TenderDto> {
  const { db, actor, tenderId, command, requestId } = options;

  await db.transaction(async (tx) => {
    const { opportunity, tender } = await lockTender(tx, actor, tenderId);
    if (!canManageTenders(actor)) throw forbidden();
    if (tender.version !== command.version) throw versionConflict();
    assertOpportunityOpen(opportunity);
    if (tender.noticeState !== 'current') {
      throw invalidTransition(
        `This notice is ${NOTICE_STATE_LABELS[tender.noticeState]} and is kept as history. Designate it current to change it.`,
      );
    }
    if (command.bidStatus !== undefined && tender.bidStatus === 'submitted') {
      throw invalidTransition('The bid is recorded as Submitted. A recorded submission is not reversed by editing.');
    }

    const changes: Partial<typeof tenders.$inferInsert> = {};
    if (command.procuringOrganizationId !== undefined) changes.procuringOrganizationId = command.procuringOrganizationId;
    if (command.title !== undefined) changes.title = command.title;
    if (command.reference !== undefined) changes.reference = command.reference;
    if ('procurementMethod' in command) changes.procurementMethod = command.procurementMethod ?? null;
    if ('noticeUrl' in command) changes.noticeUrl = command.noticeUrl ?? null;
    if (command.publicationDate !== undefined) changes.publicationDate = command.publicationDate;
    if ('clarificationDeadline' in command) {
      changes.clarificationDeadline = command.clarificationDeadline ? new Date(command.clarificationDeadline) : null;
    }
    if (command.submissionDeadline !== undefined) changes.submissionDeadline = new Date(command.submissionDeadline);
    if (command.bidStatus !== undefined) changes.bidStatus = command.bidStatus;
    if ('notes' in command) changes.notes = command.notes ?? null;

    const bidStatus = changes.bidStatus ?? tender.bidStatus;
    // A reason belongs to Not Participating only; leaving that status clears it.
    changes.participationReason =
      bidStatus === 'not_participating'
        ? ('participationReason' in command ? (command.participationReason ?? null) : tender.participationReason)
        : null;

    const merged = { ...tender, ...changes };
    const errors = chronologyErrors({
      publicationDate: merged.publicationDate,
      submissionDeadline: merged.submissionDeadline,
      clarificationDeadline: merged.clarificationDeadline ?? null,
      bidStatus: merged.bidStatus,
      participationReason: merged.participationReason ?? null,
      submittedAt: tender.submittedAt,
      lateSubmissionNote: tender.lateSubmissionNote,
    });
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    if (changes.procuringOrganizationId && changes.procuringOrganizationId !== tender.procuringOrganizationId) {
      await assertProcuringOrganization(tx, changes.procuringOrganizationId);
    }

    const diff = diffRecords(auditable(tender), auditable(merged as typeof tenders.$inferSelect));
    if (diff.changed.length === 0) return;

    await writeTender(tx, tenderId, command.version, changes);
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'tender',
      entityId: tenderId,
      action: 'tender.updated',
      before: { about: tender.reference, ...diff.before },
      after: { about: merged.reference, ...diff.after },
      requestId,
    });
  });

  return getTender(db, actor, tenderId);
}

/**
 * FR-051: records the bid as Submitted with its time. When — and only when —
 * the user explicitly chose to, the opportunity moves to Bid Submitted in the
 * same transaction. Declining keeps the stage, and the tender then shows a
 * mismatch indicator. Nothing here can mark the opportunity Awarded.
 */
export async function submitTender(options: {
  db: Database;
  actor: Actor;
  tenderId: string;
  command: SubmitCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<TenderSubmissionResultDto> {
  const { db, actor, tenderId, command, requestId, completeClaim } = options;

  const stageChanged = await db.transaction(async (tx) => {
    const { opportunity, tender } = await lockTender(tx, actor, tenderId);
    if (!canManageTenders(actor)) throw forbidden();
    if (tender.version !== command.version) throw versionConflict();
    assertOpportunityOpen(opportunity);
    if (!tender.isCurrent) {
      throw invalidTransition('Only the current tender can be marked Submitted.');
    }
    if (tender.bidStatus === 'submitted') {
      throw invalidTransition('This bid is already recorded as Submitted.');
    }
    if (tender.bidStatus === 'not_participating') {
      throw invalidTransition('This tender is marked Not Participating. Change its bid status before recording a submission.');
    }

    const submittedAt = new Date(command.submittedAt);
    const errors: Record<string, string> = {};
    if (submittedAt.getTime() > now().getTime() + FUTURE_ALLOWANCE_MS) {
      errors.submittedAt = 'The submission time cannot be in the future.';
    } else if (dhakaToday(submittedAt) < tender.publicationDate) {
      errors.submittedAt = 'The submission time cannot be before the notice was published.';
    }
    const late = submittedAt > tender.submissionDeadline;
    // BR-040: the CRM records the fact and asks for an explanation; it does not
    // decide whether a late bid was accepted.
    if (late && !command.lateSubmissionNote) {
      errors.lateSubmissionNote =
        'This time is after the recorded submission deadline. Explain the late submission to record it.';
    }
    if (command.moveOpportunityToBidSubmitted && !offersBidSubmittedStage(opportunity.stage, opportunity.status)) {
      throw invalidTransition(
        opportunity.status !== 'active'
          ? 'The opportunity is not Active, so its stage cannot change. Record the submission without moving the stage.'
          : `The opportunity is already at ${STAGE_LABELS[opportunity.stage]}. Record the submission without moving the stage.`,
      );
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);

    const lateSubmissionNote = late ? (command.lateSubmissionNote ?? null) : null;
    await writeTender(tx, tenderId, command.version, { bidStatus: 'submitted', submittedAt, lateSubmissionNote });
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'tender',
      entityId: tenderId,
      action: 'tender.submitted',
      before: { about: tender.reference, bidStatus: tender.bidStatus },
      after: {
        about: tender.reference,
        bidStatus: 'submitted',
        submittedAt: submittedAt.toISOString(),
        lateSubmissionNote,
      },
      reason: command.moveOpportunityToBidSubmitted
        ? 'Opportunity moved to Bid Submitted at the user\'s request.'
        : 'The user chose to keep the opportunity stage.',
      requestId,
    });

    if (command.moveOpportunityToBidSubmitted) {
      const moved = await tx
        .update(opportunities)
        .set({ stage: 'bid_submitted', updatedAt: now(), version: sql`${opportunities.version} + 1` })
        .where(and(eq(opportunities.id, opportunity.id), eq(opportunities.version, opportunity.version)))
        .returning({ id: opportunities.id });
      if (moved.length === 0) throw versionConflict();
      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId: opportunity.id,
        entityType: 'opportunity',
        entityId: opportunity.id,
        action: 'opportunity.stage_changed',
        before: { stage: opportunity.stage },
        after: { stage: 'bid_submitted', tenderId },
        reason: `Bid submitted for tender ${tender.reference}.`,
        requestId,
      });
    }

    await completeClaim(tx, tenderId);
    return command.moveOpportunityToBidSubmitted;
  });

  return { tender: await getTender(db, actor, tenderId), stageChanged };
}

/** Replays a submission: the stage change, if any, is read back from the audit trail. */
export async function getSubmissionResult(db: Database, actor: Actor, tenderId: string): Promise<TenderSubmissionResultDto> {
  const tender = await getTender(db, actor, tenderId);
  const [moved] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.opportunityId, tender.opportunity.id),
        eq(auditEvents.action, 'opportunity.stage_changed'),
        sql`${auditEvents.afterData} ->> 'tenderId' = ${tenderId}`,
      ),
    )
    .limit(1);
  return { tender, stageChanged: Boolean(moved) };
}

/**
 * FR-050: makes a superseded notice the current one again. The notice that
 * was current, if any, becomes Superseded first. A cancelled notice stays
 * cancelled: a re-issued notice is recorded as a new tender.
 */
export async function designateCurrentTender(options: {
  db: Database;
  actor: Actor;
  tenderId: string;
  command: z.output<typeof tenderNoticeSchema>;
  requestId: string;
}): Promise<TenderDto> {
  const { db, actor, tenderId, command, requestId } = options;

  await db.transaction(async (tx) => {
    const { opportunity, tender } = await lockTender(tx, actor, tenderId);
    if (!canManageTenders(actor)) throw forbidden();
    if (tender.version !== command.version) throw versionConflict();
    assertOpportunityOpen(opportunity);
    if (tender.isCurrent) throw validationFailed({ isCurrent: 'This is already the current tender.' });
    if (tender.noticeState === 'cancelled') {
      throw invalidTransition('A cancelled notice cannot become current. Record a re-issued notice as a new tender.');
    }

    const [previous] = await tx
      .select({ id: tenders.id, reference: tenders.reference, version: tenders.version })
      .from(tenders)
      .where(and(eq(tenders.opportunityId, opportunity.id), eq(tenders.isCurrent, true)))
      .for('update')
      .limit(1);
    if (previous) {
      await writeTender(tx, previous.id, previous.version, { isCurrent: false, noticeState: 'superseded' });
      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId: opportunity.id,
        entityType: 'tender',
        entityId: previous.id,
        action: 'tender.superseded',
        before: { about: previous.reference, noticeState: 'current' },
        after: { about: previous.reference, noticeState: 'superseded' },
        reason: `Tender ${tender.reference} designated current.`,
        requestId,
      });
    }

    await writeTender(tx, tenderId, command.version, { isCurrent: true, noticeState: 'current' });
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'tender',
      entityId: tenderId,
      action: 'tender.designated_current',
      before: { about: tender.reference, noticeState: tender.noticeState },
      after: { about: tender.reference, noticeState: 'current' },
      requestId,
    });
  });

  return getTender(db, actor, tenderId);
}

/**
 * BR-040: a cancelled notice leaves the deadline alerts and is kept with its
 * history. The opportunity may then have no current tender (FR-050).
 */
export async function cancelTenderNotice(options: {
  db: Database;
  actor: Actor;
  tenderId: string;
  command: z.output<typeof cancelTenderSchema>;
  requestId: string;
}): Promise<TenderDto> {
  const { db, actor, tenderId, command, requestId } = options;

  await db.transaction(async (tx) => {
    const { opportunity, tender } = await lockTender(tx, actor, tenderId);
    if (!canManageTenders(actor)) throw forbidden();
    if (tender.version !== command.version) throw versionConflict();
    assertOpportunityOpen(opportunity);
    if (tender.noticeState === 'cancelled') throw validationFailed({ reason: 'This notice is already cancelled.' });

    await writeTender(tx, tenderId, command.version, { isCurrent: false, noticeState: 'cancelled' });
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'tender',
      entityId: tenderId,
      action: 'tender.cancelled',
      before: { about: tender.reference, noticeState: tender.noticeState },
      after: { about: tender.reference, noticeState: 'cancelled' },
      reason: command.reason,
      requestId,
    });
  });

  return getTender(db, actor, tenderId);
}
