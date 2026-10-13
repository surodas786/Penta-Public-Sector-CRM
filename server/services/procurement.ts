/**
 * Software Procurement cycles, EOI then RFP (CR6).
 *
 * A cycle is a child of its opportunity, like a tender: every read is located
 * through the opportunity's scope, and every write locks the opportunity first
 * (ADR 0003), then the cycle. Owner, section, access and documents are the
 * opportunity's; a transfer moves them with no write here.
 *
 * Milestones are kept apart from the opportunity pipeline. Reaching one never
 * moves the opportunity; when the user explicitly accepts the offered stage
 * (PROCUREMENT_PIPELINE_OFFERS), the move goes through the ordinary stage
 * rules in the same transaction (changeStageInTransaction), so Awarded still
 * needs its value and date and Lost its reason.
 *
 * The direct-RFP route is a documented, management-only exception and never
 * carries an EOI. Late submissions are recorded as late, with a note; a
 * deadline cannot be moved once its submission is recorded. The database
 * CHECKs (migration 0011) back up every rule here.
 */
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { Paginated, ProcurementCycleDetailDto, ProcurementCycleDto, ProcurementMilestoneResultDto } from '../../shared/api.js';
import {
  CLOSED_MILESTONES,
  PROCUREMENT_DOCUMENT_ROLE_LABELS,
  PROCUREMENT_MILESTONE_LABELS,
  PROCUREMENT_PIPELINE_OFFERS,
  PROPOSAL_SUBMITTED_MILESTONES,
  RFP_MILESTONES,
  STAGE_LABELS,
  TENDER_DUE_SOON_HOURS,
  isClosedMilestone,
  isTerminalStage,
  nextMilestones,
  type ProcurementIndicator,
  type ProcurementMilestone,
} from '../../shared/enums.js';
import type {
  advanceProcurementCycleSchema,
  createProcurementCycleSchema,
  linkProcurementDocumentSchema,
  listProcurementCyclesQuerySchema,
  updateProcurementCycleSchema,
} from '../../shared/validation.js';
import { dhakaToday, now } from '../clock.js';
import type { Database } from '../db/client.js';
import {
  auditEvents,
  contacts,
  documentRevisions,
  documents,
  opportunities,
  opportunityContacts,
  organizations,
  procurementCycleContacts,
  procurementCycleDocuments,
  procurementCycles,
  sections,
  users,
} from '../db/schema.js';
import { conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import { signalJobsEnqueued } from '../jobs/queue.js';
import type { Actor } from '../policy/actor.js';
import { canApproveDirectRfp, canManageProcurement, opportunityScope, scopedWhere } from '../policy/scope.js';
import { diffRecords, recordAuditEvent } from './audit.js';
import { alertsChangedInTransaction } from './notifications.js';
import { lockOpportunity, type LockedOpportunity } from './followUps.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { SEVEN_DAYS_HOURS, procurementDueWithin, procurementOpenDeadline, procurementOverdue } from './metrics.js';
import { assertOpportunityVisible } from './opportunities.js';
import { changeStageInTransaction } from './transitions.js';

type CreateCommand = z.output<typeof createProcurementCycleSchema>;
type UpdateCommand = z.output<typeof updateProcurementCycleSchema>;
type AdvanceCommand = z.output<typeof advanceProcurementCycleSchema>;
type Cycle = typeof procurementCycles.$inferSelect;

/** Clock differences between the browser and the server. */
const FUTURE_ALLOWANCE_MS = 5 * 60_000;

const invalidTransition = (message: string) => conflict(message, 'invalid_transition');

const procuring = alias(organizations, 'procurement_procuring');
const owner = alias(users, 'procurement_owner');
const creator = alias(users, 'procurement_creator');
const approver = alias(users, 'procurement_approver');

const selection = {
  cycle: procurementCycles,
  opportunityReference: opportunities.reference,
  opportunityName: opportunities.name,
  opportunityStage: opportunities.stage,
  opportunityStatus: opportunities.status,
  procuringOrganizationName: procuring.name,
  ownerId: owner.id,
  ownerName: owner.fullName,
  sectionId: sections.id,
  sectionName: sections.name,
  createdByName: creator.fullName,
  approverName: approver.fullName,
  openDeadline: sql<Date | null>`${procurementOpenDeadline}`.mapWith((value: string | Date | null) =>
    value === null ? null : new Date(value),
  ),
} as const;

function baseQuery(db: Database) {
  return db
    .select(selection)
    .from(procurementCycles)
    .innerJoin(opportunities, eq(opportunities.id, procurementCycles.opportunityId))
    .innerJoin(procuring, eq(procuring.id, procurementCycles.procuringOrganizationId))
    .innerJoin(owner, eq(owner.id, opportunities.ownerId))
    .innerJoin(sections, eq(sections.id, opportunities.sectionId))
    .innerJoin(creator, eq(creator.id, procurementCycles.createdBy))
    .leftJoin(approver, eq(approver.id, procurementCycles.directRfpApprovedBy));
}

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

function opportunityClosed(opportunity: { stage: Row['opportunityStage']; status: Row['opportunityStatus'] }): boolean {
  return isTerminalStage(opportunity.stage) || opportunity.status === 'cancelled';
}

/** The deadline the cycle works towards now (the metric's own definition, in code). */
function openDeadlineOf(cycle: Pick<Cycle, 'milestone' | 'eoiDeadline' | 'proposalDeadline'>): Date | null {
  if (cycle.milestone === 'eoi_preparation') return cycle.eoiDeadline;
  if (cycle.milestone === 'rfp_received' || cycle.milestone === 'proposal_preparation') return cycle.proposalDeadline;
  return null;
}

/**
 * The deadline indicator, against the real clock. Like FR-052: only the
 * current, working cycle of an open record raises one; the 72-hour amber is
 * the tenders' own threshold.
 */
export function procurementIndicator(row: Pick<Row, 'cycle' | 'opportunityStage' | 'opportunityStatus'>, at: Date = now()): ProcurementIndicator {
  const { cycle } = row;
  if (
    !cycle.isCurrent ||
    isClosedMilestone(cycle.milestone) ||
    cycle.participation === 'not_participating' ||
    opportunityClosed({ stage: row.opportunityStage, status: row.opportunityStatus })
  ) {
    return 'closed';
  }
  const deadline = openDeadlineOf(cycle);
  if (!deadline) {
    return ['eoi_submitted', 'shortlisted', 'proposal_submitted', 'evaluation'].includes(cycle.milestone) ? 'submitted' : 'no_deadline';
  }
  const remaining = deadline.getTime() - at.getTime();
  if (remaining < 0) return 'missed';
  // The same window as the 72-hour filter and metric: up to, not including, 72 hours.
  if (remaining < TENDER_DUE_SOON_HOURS * 3_600_000) return 'due_soon';
  return 'upcoming';
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

/** What this user may do next with the cycle. */
function allowedNext(actor: Actor, row: Row): ProcurementMilestone[] {
  if (!canManageProcurement(actor) || !row.cycle.isCurrent) return [];
  const next = nextMilestones(row.cycle.route, row.cycle.milestone);
  // A closed opportunity's cycle can only be brought to its ending.
  return opportunityClosed({ stage: row.opportunityStage, status: row.opportunityStatus })
    ? next.filter((milestone) => isClosedMilestone(milestone))
    : next;
}

function toDto(actor: Actor, row: Row, at: Date): ProcurementCycleDto {
  const { cycle } = row;
  return {
    id: cycle.id,
    opportunity: {
      id: cycle.opportunityId,
      reference: row.opportunityReference,
      name: row.opportunityName,
      stage: row.opportunityStage,
      status: row.opportunityStatus,
    },
    procuringOrganization: { id: cycle.procuringOrganizationId, name: row.procuringOrganizationName },
    title: cycle.title,
    reference: cycle.reference,
    route: cycle.route,
    milestone: cycle.milestone,
    isCurrent: cycle.isCurrent,
    submissionMethod: cycle.submissionMethod,
    participation: cycle.participation,
    participationReason: cycle.participationReason,
    eoiPublicationDate: cycle.eoiPublicationDate,
    eoiDeadline: iso(cycle.eoiDeadline),
    eoiSubmittedAt: iso(cycle.eoiSubmittedAt),
    eoiLateNote: cycle.eoiLateNote,
    eoiOutcome: cycle.eoiOutcome,
    eoiOutcomeDate: cycle.eoiOutcomeDate,
    rfpReference: cycle.rfpReference,
    rfpInvitationDate: cycle.rfpInvitationDate,
    clarificationDeadline: iso(cycle.clarificationDeadline),
    proposalDeadline: iso(cycle.proposalDeadline),
    proposalFormat: cycle.proposalFormat,
    proposalSubmittedAt: iso(cycle.proposalSubmittedAt),
    technicalSubmittedAt: iso(cycle.technicalSubmittedAt),
    financialSubmittedAt: iso(cycle.financialSubmittedAt),
    proposalLateNote: cycle.proposalLateNote,
    directRfpReason: cycle.directRfpReason,
    directRfpApprovedByName: row.approverName ?? null,
    outcomeDate: cycle.outcomeDate,
    outcomeNote: cycle.outcomeNote,
    notes: cycle.notes,
    responsibleOwner: { id: row.ownerId, fullName: row.ownerName },
    section: { id: row.sectionId, name: row.sectionName },
    openDeadline: iso(row.openDeadline),
    indicator: procurementIndicator(row, at),
    nextMilestones: allowedNext(actor, row),
    canEdit:
      canManageProcurement(actor) &&
      cycle.isCurrent &&
      !isClosedMilestone(cycle.milestone) &&
      !opportunityClosed({ stage: row.opportunityStage, status: row.opportunityStatus }),
    createdByName: row.createdByName,
    createdAt: cycle.createdAt.toISOString(),
    updatedAt: cycle.updatedAt.toISOString(),
    version: cycle.version,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every cycle of one opportunity: the current one first, then newest first. */
export async function listOpportunityProcurementCycles(db: Database, actor: Actor, opportunityId: string): Promise<ProcurementCycleDto[]> {
  await assertOpportunityVisible(db, actor, opportunityId);
  const rows = await baseQuery(db)
    .where(scopedWhere(actor, eq(procurementCycles.opportunityId, opportunityId)))
    .orderBy(desc(procurementCycles.isCurrent), desc(procurementCycles.createdAt), desc(procurementCycles.id));
  const at = now();
  return rows.map((row) => toDto(actor, row, at));
}

/** The Software Procurement area: open deadlines first, filtered inside the scope predicate. */
export async function listProcurementCycles(
  db: Database,
  actor: Actor,
  query: z.output<typeof listProcurementCyclesQuerySchema>,
): Promise<Paginated<ProcurementCycleDto>> {
  const at = now();
  const filters: (SQL | undefined)[] = [];
  if (query.cycles === 'current') filters.push(eq(procurementCycles.isCurrent, true));
  if (query.milestone) filters.push(eq(procurementCycles.milestone, query.milestone));
  if (query.route) filters.push(eq(procurementCycles.route, query.route));
  if (query.ownerId) filters.push(eq(opportunities.ownerId, query.ownerId));
  if (query.sectionId) filters.push(eq(opportunities.sectionId, query.sectionId));
  // The metric definitions themselves, so the dashboard and report counts drill down to the same cycles (FR-081).
  if (query.deadline === 'overdue') filters.push(procurementOverdue(at));
  if (query.deadline === '72h') filters.push(procurementDueWithin(at, TENDER_DUE_SOON_HOURS));
  if (query.deadline === '7d') filters.push(procurementDueWithin(at, SEVEN_DAYS_HOURS));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(
        ilike(procurementCycles.title, term),
        ilike(procurementCycles.reference, term),
        ilike(procurementCycles.rfpReference, term),
        ilike(opportunities.name, term),
      ),
    );
  }
  const where = scopedWhere(actor, ...filters);

  const [total] = await db
    .select({ value: count() })
    .from(procurementCycles)
    .innerJoin(opportunities, eq(opportunities.id, procurementCycles.opportunityId))
    .where(where);
  const rows = await baseQuery(db)
    .where(where)
    .orderBy(
      query.dir === 'desc' ? sql`${procurementOpenDeadline} DESC NULLS LAST` : sql`${procurementOpenDeadline} ASC NULLS LAST`,
      desc(procurementCycles.updatedAt),
      asc(procurementCycles.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return { items: rows.map((row) => toDto(actor, row, at)), total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

const NOT_FOUND = (cycleId: string, actor: Actor) => notFound(`procurement cycle ${cycleId} absent or outside scope for actor ${actor.id}`);

async function readRow(db: Database, actor: Actor, cycleId: string): Promise<Row> {
  const [row] = await baseQuery(db).where(scopedWhere(actor, eq(procurementCycles.id, cycleId))).limit(1);
  if (!row) throw NOT_FOUND(cycleId, actor);
  return row;
}

/** Audit actions of a cycle, as one-line history entries. */
const HISTORY_SUMMARIES: Record<string, string> = {
  'procurement.created': 'Cycle recorded',
  'procurement.updated': 'Details changed',
  'procurement.milestone_changed': 'Milestone changed',
  'procurement.superseded': 'Replaced by a newer cycle',
  'procurement.contact_linked': 'Contact linked',
  'procurement.contact_unlinked': 'Contact unlinked',
  'procurement.document_linked': 'Document linked',
  'procurement.document_unlinked': 'Document unlinked',
};

export async function getProcurementCycle(db: Database, actor: Actor, cycleId: string): Promise<ProcurementCycleDetailDto> {
  const row = await readRow(db, actor, cycleId);
  const dto = toDto(actor, row, now());

  const linkedContacts = await db
    .select({ id: contacts.id, fullName: contacts.fullName, designation: contacts.designation })
    .from(procurementCycleContacts)
    .innerJoin(contacts, eq(contacts.id, procurementCycleContacts.contactId))
    .where(eq(procurementCycleContacts.cycleId, cycleId))
    .orderBy(asc(contacts.fullName));

  const linkedDocuments = await db
    .select({
      id: documents.id,
      role: procurementCycleDocuments.role,
      fileName: documentRevisions.fileName,
      category: documents.category,
      archivedAt: documents.archivedAt,
    })
    .from(procurementCycleDocuments)
    .innerJoin(documents, eq(documents.id, procurementCycleDocuments.documentId))
    .innerJoin(
      documentRevisions,
      and(eq(documentRevisions.documentId, documents.id), eq(documentRevisions.revisionNumber, documents.latestRevision)),
    )
    // Belt and braces: a link only ever shows a document of the cycle's own opportunity.
    .where(and(eq(procurementCycleDocuments.cycleId, cycleId), eq(documents.opportunityId, row.cycle.opportunityId)))
    .orderBy(asc(procurementCycleDocuments.role), asc(documentRevisions.fileName));

  const actorUser = alias(users, 'procurement_history_actor');
  const events = await db
    .select({
      occurredAt: auditEvents.occurredAt,
      actorName: actorUser.fullName,
      action: auditEvents.action,
      after: auditEvents.afterData,
    })
    .from(auditEvents)
    .leftJoin(actorUser, eq(actorUser.id, auditEvents.actorId))
    .where(and(eq(auditEvents.entityType, 'procurement_cycle'), eq(auditEvents.entityId, cycleId)))
    .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.sequence));

  return {
    ...dto,
    contacts: linkedContacts.map((contact) => ({ ...contact, designation: contact.designation || null })),
    documents: linkedDocuments.map((document) => ({
      id: document.id,
      role: document.role,
      fileName: document.fileName,
      category: document.category,
      archived: document.archivedAt !== null,
    })),
    history: events.map((event) => {
      const after = (event.after ?? {}) as Record<string, unknown>;
      const milestone = typeof after.milestone === 'string' ? (after.milestone as ProcurementMilestone) : null;
      return {
        occurredAt: event.occurredAt.toISOString(),
        actorName: event.actorName ?? null,
        action: event.action,
        milestone,
        summary:
          event.action === 'procurement.milestone_changed' && milestone
            ? `Moved to ${PROCUREMENT_MILESTONE_LABELS[milestone]}`
            : (HISTORY_SUMMARIES[event.action] ?? event.action),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

async function assertProcuringOrganization(tx: Database, organizationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.archivedAt)))
    .for('share')
    .limit(1);
  if (!row) throw validationFailed({ procuringOrganizationId: 'Choose an organization from the directory.' });
}

/**
 * The facts every cycle must hold together, as field errors, so the user sees
 * them beside the fields; the CHECK constraints refuse the same states.
 */
function factErrors(cycle: Cycle): Record<string, string> {
  const errors: Record<string, string> = {};
  const { milestone } = cycle;
  if (cycle.route === 'direct_rfp' && (cycle.eoiPublicationDate || cycle.eoiDeadline || cycle.eoiSubmittedAt)) {
    errors.eoiDeadline = 'A direct RFP has no EOI. Leave the EOI fields empty.';
  }
  if (cycle.participation === 'not_participating' && !cycle.participationReason) {
    errors.participationReason = 'Give the reason for not participating.';
  }
  if (cycle.eoiPublicationDate && cycle.eoiDeadline && dhakaToday(cycle.eoiDeadline) < cycle.eoiPublicationDate) {
    errors.eoiDeadline = 'The EOI deadline cannot be before the EOI was published.';
  }
  if (cycle.rfpInvitationDate && cycle.proposalDeadline && dhakaToday(cycle.proposalDeadline) < cycle.rfpInvitationDate) {
    errors.proposalDeadline = 'The proposal deadline cannot be before the RFP invitation.';
  }
  if (cycle.clarificationDeadline && cycle.proposalDeadline && cycle.clarificationDeadline > cycle.proposalDeadline) {
    errors.clarificationDeadline = 'The clarification deadline cannot be after the proposal deadline.';
  }
  if (RFP_MILESTONES.includes(milestone)) {
    if (!cycle.rfpReference) errors.rfpReference = 'Enter the RFP reference.';
    if (!cycle.rfpInvitationDate) errors.rfpInvitationDate = 'Enter the date the RFP invitation was received.';
    if (!cycle.proposalDeadline) errors.proposalDeadline = 'Enter the proposal deadline.';
  }
  return errors;
}

/** A recorded time: not in the future, and not before the notice it answers. */
function submissionTimeError(at: Date, notBefore: string | null, label: string): string | null {
  if (at.getTime() > now().getTime() + FUTURE_ALLOWANCE_MS) return `The ${label} time cannot be in the future.`;
  if (notBefore && dhakaToday(at) < notBefore) return `The ${label} time cannot be before the notice was issued.`;
  return null;
}

function assertWritable(opportunity: LockedOpportunity, cycle: Cycle): void {
  if (!cycle.isCurrent) throw invalidTransition('This cycle has been replaced by a newer one and is kept as history.');
  if (isClosedMilestone(cycle.milestone)) {
    throw invalidTransition(`This cycle ended as ${PROCUREMENT_MILESTONE_LABELS[cycle.milestone]} and is kept as history.`);
  }
  if (opportunityClosed(opportunity)) {
    throw invalidTransition('This opportunity is closed. Its procurement cycles can only be brought to their ending.');
  }
}

/**
 * Locates the cycle through scope, then locks the opportunity and the cycle
 * in that order. An inaccessible cycle is the same 404 as a missing one.
 */
async function lockCycle(tx: Database, actor: Actor, cycleId: string) {
  const [located] = await tx
    .select({ opportunityId: procurementCycles.opportunityId })
    .from(procurementCycles)
    .innerJoin(opportunities, eq(opportunities.id, procurementCycles.opportunityId))
    .where(and(opportunityScope(actor), eq(procurementCycles.id, cycleId)))
    .limit(1);
  if (!located) throw NOT_FOUND(cycleId, actor);
  const opportunity = await lockOpportunity(tx, actor, located.opportunityId);
  const [cycle] = await tx
    .select()
    .from(procurementCycles)
    .where(and(eq(procurementCycles.id, cycleId), eq(procurementCycles.opportunityId, opportunity.id)))
    .for('update')
    .limit(1);
  if (!cycle) throw notFound(`procurement cycle ${cycleId} moved during the request`);
  return { opportunity, cycle };
}

async function writeCycle(tx: Database, cycleId: string, expectedVersion: number, changes: Partial<typeof procurementCycles.$inferInsert>) {
  const rows = await tx
    .update(procurementCycles)
    .set({ ...changes, updatedAt: now(), version: sql`${procurementCycles.version} + 1` })
    .where(and(eq(procurementCycles.id, cycleId), eq(procurementCycles.version, expectedVersion)))
    .returning({ id: procurementCycles.id });
  if (rows.length === 0) throw versionConflict();
}

/** What the audit records of a cycle's facts. */
function auditable(cycle: Cycle): Record<string, unknown> {
  return {
    procuringOrganizationId: cycle.procuringOrganizationId,
    title: cycle.title,
    reference: cycle.reference,
    submissionMethod: cycle.submissionMethod,
    participation: cycle.participation,
    participationReason: cycle.participationReason,
    eoiPublicationDate: cycle.eoiPublicationDate,
    eoiDeadline: iso(cycle.eoiDeadline),
    rfpReference: cycle.rfpReference,
    rfpInvitationDate: cycle.rfpInvitationDate,
    clarificationDeadline: iso(cycle.clarificationDeadline),
    proposalDeadline: iso(cycle.proposalDeadline),
    proposalFormat: cycle.proposalFormat,
    notes: cycle.notes,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * A new cycle for an opportunity, which becomes its current one. While the
 * current cycle is still open it must be brought to an ending first, so a
 * reissue after a cancellation is explicit. The direct-RFP route needs a
 * management user and a documented reason, and starts at RFP received.
 */
export async function createProcurementCycle(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: CreateCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<ProcurementCycleDetailDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;

  const id = await db.transaction(async (tx) => {
    const opportunity = await lockOpportunity(tx, actor, opportunityId);
    if (!canManageProcurement(actor)) throw forbidden();
    if (opportunityClosed(opportunity)) {
      throw invalidTransition('This opportunity is closed. A new procurement cycle cannot be recorded on it.');
    }

    const direct = command.route === 'direct_rfp';
    if (direct && !canApproveDirectRfp(actor)) {
      throw forbidden('Only management can record a direct RFP without an EOI.');
    }
    const errors: Record<string, string> = {};
    if (direct && !command.directRfpReason) {
      errors.directRfpReason = 'Document why this RFP is pursued without an EOI.';
    }
    if (!direct && command.directRfpReason) {
      errors.directRfpReason = 'A reason is recorded only for the direct RFP exception.';
    }

    const [previous] = await tx
      .select({ id: procurementCycles.id, reference: procurementCycles.reference, milestone: procurementCycles.milestone, version: procurementCycles.version })
      .from(procurementCycles)
      .where(and(eq(procurementCycles.opportunityId, opportunityId), eq(procurementCycles.isCurrent, true)))
      .for('update')
      .limit(1);
    if (previous && !isClosedMilestone(previous.milestone)) {
      throw invalidTransition(
        `Cycle ${previous.reference} is still open (${PROCUREMENT_MILESTONE_LABELS[previous.milestone]}). Bring it to its ending, for example Cancelled, before recording a new one.`,
      );
    }

    const timestamp = now();
    const draft: Cycle = {
      id: '',
      opportunityId,
      procuringOrganizationId: command.procuringOrganizationId,
      title: command.title,
      reference: command.reference,
      route: command.route,
      milestone: direct ? 'rfp_received' : 'eoi_preparation',
      isCurrent: true,
      submissionMethod: command.submissionMethod ?? null,
      participation: command.participation ?? 'undecided',
      participationReason: command.participation === 'not_participating' ? (command.participationReason ?? null) : null,
      eoiPublicationDate: command.eoiPublicationDate ?? null,
      eoiDeadline: command.eoiDeadline ? new Date(command.eoiDeadline) : null,
      eoiSubmittedAt: null,
      eoiLateNote: null,
      eoiOutcome: null,
      eoiOutcomeDate: null,
      rfpReference: command.rfpReference ?? null,
      rfpInvitationDate: command.rfpInvitationDate ?? null,
      clarificationDeadline: command.clarificationDeadline ? new Date(command.clarificationDeadline) : null,
      proposalDeadline: command.proposalDeadline ? new Date(command.proposalDeadline) : null,
      proposalFormat: command.proposalFormat ?? 'single',
      proposalSubmittedAt: null,
      technicalSubmittedAt: null,
      financialSubmittedAt: null,
      proposalLateNote: null,
      directRfpReason: direct ? (command.directRfpReason ?? null) : null,
      directRfpApprovedBy: direct ? actor.id : null,
      outcomeDate: null,
      outcomeNote: null,
      notes: command.notes ?? null,
      createdBy: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    Object.assign(errors, factErrors(draft));
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    await assertProcuringOrganization(tx, command.procuringOrganizationId);

    if (previous) {
      await writeCycle(tx, previous.id, previous.version, { isCurrent: false });
      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId,
        entityType: 'procurement_cycle',
        entityId: previous.id,
        action: 'procurement.superseded',
        before: { about: previous.reference, isCurrent: true },
        after: { about: previous.reference, isCurrent: false },
        reason: `Replaced by procurement cycle ${command.reference}.`,
        requestId,
      });
    }

    const { id: _id, ...values } = draft;
    const [created] = await tx.insert(procurementCycles).values(values).returning();
    if (!created) throw new Error('Procurement cycle insert returned no row.');

    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId,
      entityType: 'procurement_cycle',
      entityId: created.id,
      action: 'procurement.created',
      after: {
        about: created.reference,
        route: created.route,
        milestone: created.milestone,
        ...auditable(created),
        ...(direct ? { directRfpReason: created.directRfpReason } : {}),
      },
      reason: direct ? `Direct RFP approved by management: ${created.directRfpReason}` : null,
      requestId,
    });
    // Step 6: the new cycle's deadline alert, and the previous cycle's retired.
    await alertsChangedInTransaction(tx, { opportunityId, resolution: 'procurement_changed' });
    await completeClaim(tx, created.id);
    return created.id;
  });

  signalJobsEnqueued();
  return getProcurementCycle(db, actor, id);
}

export async function updateProcurementCycle(options: {
  db: Database;
  actor: Actor;
  cycleId: string;
  command: UpdateCommand;
  requestId: string;
}): Promise<ProcurementCycleDetailDto> {
  const { db, actor, cycleId, command, requestId } = options;

  await db.transaction(async (tx) => {
    const { opportunity, cycle } = await lockCycle(tx, actor, cycleId);
    if (!canManageProcurement(actor)) throw forbidden();
    if (cycle.version !== command.version) throw versionConflict();
    assertWritable(opportunity, cycle);

    const changes: Partial<typeof procurementCycles.$inferInsert> = {};
    if (command.procuringOrganizationId !== undefined) changes.procuringOrganizationId = command.procuringOrganizationId;
    if (command.title !== undefined) changes.title = command.title;
    if (command.reference !== undefined) changes.reference = command.reference;
    if ('submissionMethod' in command) changes.submissionMethod = command.submissionMethod ?? null;
    if (command.participation !== undefined) changes.participation = command.participation;
    if ('eoiPublicationDate' in command) changes.eoiPublicationDate = command.eoiPublicationDate ?? null;
    if ('eoiDeadline' in command) changes.eoiDeadline = command.eoiDeadline ? new Date(command.eoiDeadline) : null;
    if ('rfpReference' in command) changes.rfpReference = command.rfpReference ?? null;
    if ('rfpInvitationDate' in command) changes.rfpInvitationDate = command.rfpInvitationDate ?? null;
    if ('clarificationDeadline' in command) {
      changes.clarificationDeadline = command.clarificationDeadline ? new Date(command.clarificationDeadline) : null;
    }
    if ('proposalDeadline' in command) changes.proposalDeadline = command.proposalDeadline ? new Date(command.proposalDeadline) : null;
    if (command.proposalFormat !== undefined) changes.proposalFormat = command.proposalFormat;
    if ('notes' in command) changes.notes = command.notes ?? null;

    const participation = changes.participation ?? cycle.participation;
    changes.participationReason =
      participation === 'not_participating'
        ? ('participationReason' in command ? (command.participationReason ?? null) : cycle.participationReason)
        : null;

    const merged: Cycle = { ...cycle, ...changes } as Cycle;
    const errors = factErrors(merged);
    // A recorded submission keeps the deadline it was measured against, so
    // lateness is never hidden by moving the deadline afterwards.
    if (cycle.eoiSubmittedAt && 'eoiDeadline' in command && iso(merged.eoiDeadline) !== iso(cycle.eoiDeadline)) {
      errors.eoiDeadline = 'The EOI is already recorded as submitted against this deadline. The deadline cannot change.';
    }
    const proposalRecorded = cycle.proposalSubmittedAt || cycle.technicalSubmittedAt || cycle.financialSubmittedAt;
    if (proposalRecorded && 'proposalDeadline' in command && iso(merged.proposalDeadline) !== iso(cycle.proposalDeadline)) {
      errors.proposalDeadline = 'The proposal is already recorded as submitted against this deadline. The deadline cannot change.';
    }
    if (proposalRecorded && changes.proposalFormat && changes.proposalFormat !== cycle.proposalFormat) {
      errors.proposalFormat = 'The proposal is already recorded; its format cannot change.';
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    if (changes.procuringOrganizationId && changes.procuringOrganizationId !== cycle.procuringOrganizationId) {
      await assertProcuringOrganization(tx, changes.procuringOrganizationId);
    }

    const diff = diffRecords(auditable(cycle), auditable(merged));
    if (diff.changed.length === 0) return;
    await writeCycle(tx, cycleId, command.version, changes);
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'procurement_cycle',
      entityId: cycleId,
      action: 'procurement.updated',
      before: { about: cycle.reference, ...diff.before },
      after: { about: merged.reference, ...diff.after },
      requestId,
    });
    // Step 6: a moved deadline or a Not participating decision retires the
    // old reminder (and its queued email) and queues the new one.
    await alertsChangedInTransaction(tx, { opportunityId: opportunity.id, resolution: 'procurement_changed' });
  });

  signalJobsEnqueued();
  return getProcurementCycle(db, actor, cycleId);
}

/**
 * Moves a cycle to a milestone, recording the facts it needs. The pipeline
 * moves only when the user accepted the offered stage, through the ordinary
 * stage rules, in the same transaction.
 */
export async function advanceProcurementCycle(options: {
  db: Database;
  actor: Actor;
  cycleId: string;
  command: AdvanceCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<ProcurementMilestoneResultDto> {
  const { db, actor, cycleId, command, requestId, completeClaim } = options;

  const stageChanged = await db.transaction(async (tx) => {
    const { opportunity, cycle } = await lockCycle(tx, actor, cycleId);
    if (!canManageProcurement(actor)) throw forbidden();
    if (cycle.version !== command.version) throw versionConflict();
    if (!cycle.isCurrent) throw invalidTransition('This cycle has been replaced by a newer one and is kept as history.');

    const target = command.milestone;
    const closedRecord = opportunityClosed(opportunity);
    const allowed = nextMilestones(cycle.route, cycle.milestone).filter((milestone) => !closedRecord || isClosedMilestone(milestone));
    if (!allowed.includes(target)) {
      throw invalidTransition(
        isClosedMilestone(cycle.milestone)
          ? `This cycle ended as ${PROCUREMENT_MILESTONE_LABELS[cycle.milestone]}.`
          : closedRecord
            ? 'This opportunity is closed. Its cycle can only be brought to its ending.'
            : `A cycle at ${PROCUREMENT_MILESTONE_LABELS[cycle.milestone]} cannot move to ${PROCUREMENT_MILESTONE_LABELS[target]}.`,
      );
    }

    const errors: Record<string, string> = {};
    const changes: Partial<Cycle> = { milestone: target };
    const recorded: Record<string, unknown> = {};
    const today = dhakaToday();

    // EOI submission (needed for every milestone after EOI preparation on the EOI route).
    const needsEoi = cycle.route === 'eoi_rfp' && target !== 'cancelled' && target !== 'eoi_preparation';
    if (needsEoi && !cycle.eoiSubmittedAt) {
      if (!command.eoiSubmittedAt) {
        errors.eoiSubmittedAt = 'Enter when the EOI was submitted.';
      } else {
        const at = new Date(command.eoiSubmittedAt);
        const timeError = submissionTimeError(at, cycle.eoiPublicationDate, 'EOI submission');
        if (timeError) errors.eoiSubmittedAt = timeError;
        const late = cycle.eoiDeadline !== null && at > cycle.eoiDeadline;
        if (late && !command.eoiLateNote) {
          errors.eoiLateNote = 'This time is after the recorded EOI deadline. Explain the late submission to record it.';
        }
        changes.eoiSubmittedAt = at;
        changes.eoiLateNote = late ? (command.eoiLateNote ?? null) : null;
        Object.assign(recorded, { eoiSubmittedAt: at.toISOString(), eoiLateNote: changes.eoiLateNote });
      }
    }

    // Shortlisting outcome.
    const needsOutcome = cycle.route === 'eoi_rfp' && (target === 'shortlisted' || target === 'not_shortlisted' || (RFP_MILESTONES.includes(target) && !cycle.eoiOutcome));
    if (needsOutcome && !cycle.eoiOutcome) {
      if (!command.eoiOutcomeDate) {
        errors.eoiOutcomeDate = 'Enter the date the shortlisting outcome was announced.';
      } else if (command.eoiOutcomeDate > today) {
        errors.eoiOutcomeDate = 'The outcome date cannot be in the future.';
      } else {
        const submitted = changes.eoiSubmittedAt ?? cycle.eoiSubmittedAt;
        if (submitted && command.eoiOutcomeDate < dhakaToday(submitted)) {
          errors.eoiOutcomeDate = 'The outcome date cannot be before the EOI was submitted.';
        }
      }
      changes.eoiOutcome = target === 'not_shortlisted' ? 'not_shortlisted' : 'shortlisted';
      changes.eoiOutcomeDate = command.eoiOutcomeDate ?? null;
      Object.assign(recorded, { eoiOutcome: changes.eoiOutcome, eoiOutcomeDate: changes.eoiOutcomeDate });
    }

    // RFP facts can be completed as the RFP arrives.
    if (RFP_MILESTONES.includes(target)) {
      if (command.rfpReference) changes.rfpReference = command.rfpReference;
      if (command.rfpInvitationDate) changes.rfpInvitationDate = command.rfpInvitationDate;
      if (command.clarificationDeadline) changes.clarificationDeadline = new Date(command.clarificationDeadline);
      if (command.proposalDeadline && !(cycle.proposalSubmittedAt || cycle.technicalSubmittedAt || cycle.financialSubmittedAt)) {
        changes.proposalDeadline = new Date(command.proposalDeadline);
      }
    }

    // Proposal submission, as one proposal or as its two parts.
    if (PROPOSAL_SUBMITTED_MILESTONES.includes(target)) {
      const deadline = (changes.proposalDeadline ?? cycle.proposalDeadline) as Date | null;
      const invited = (changes.rfpInvitationDate ?? cycle.rfpInvitationDate) as string | null;
      const parts =
        cycle.proposalFormat === 'single'
          ? ([['proposalSubmittedAt', 'proposal submission']] as const)
          : ([
              ['technicalSubmittedAt', 'technical proposal submission'],
              ['financialSubmittedAt', 'financial proposal submission'],
            ] as const);
      let late = false;
      for (const [field, label] of parts) {
        if (cycle[field]) {
          late ||= deadline !== null && cycle[field]! > deadline;
          continue;
        }
        const value = command[field];
        if (!value) {
          errors[field] = `Enter when the ${label} was made.`;
          continue;
        }
        const at = new Date(value);
        const timeError = submissionTimeError(at, invited, label);
        if (timeError) errors[field] = timeError;
        changes[field] = at;
        recorded[field] = at.toISOString();
        late ||= deadline !== null && at > deadline;
      }
      if (late && !cycle.proposalLateNote) {
        if (!command.proposalLateNote) {
          errors.proposalLateNote = 'This is after the recorded proposal deadline. Explain the late submission to record it.';
        } else {
          changes.proposalLateNote = command.proposalLateNote;
          recorded.proposalLateNote = command.proposalLateNote;
        }
      }
    }

    // Endings are dated; a cancellation says why.
    if (CLOSED_MILESTONES.includes(target)) {
      const outcomeDate = target === 'not_shortlisted' ? (changes.eoiOutcomeDate ?? command.outcomeDate) : command.outcomeDate;
      if (!outcomeDate) errors.outcomeDate = 'Enter the date of this outcome.';
      else if (outcomeDate > today) errors.outcomeDate = 'The outcome date cannot be in the future.';
      if (target === 'cancelled' && !command.outcomeNote) errors.outcomeNote = 'Explain why the cycle was cancelled or withdrawn.';
      changes.outcomeDate = outcomeDate ?? null;
      changes.outcomeNote = command.outcomeNote ?? null;
      Object.assign(recorded, { outcomeDate: changes.outcomeDate, outcomeNote: changes.outcomeNote });
    }

    // A recorded submission is an act of participation.
    const recordsSubmission = Boolean(
      changes.eoiSubmittedAt || changes.proposalSubmittedAt || changes.technicalSubmittedAt || changes.financialSubmittedAt,
    );
    if (recordsSubmission && cycle.participation === 'not_participating') {
      throw invalidTransition('This cycle is marked Not participating. Change that before recording a submission.');
    }
    if (recordsSubmission && cycle.participation === 'undecided') changes.participation = 'participating';

    const merged = { ...cycle, ...changes } as Cycle;
    Object.assign(errors, Object.fromEntries(Object.entries(factErrors(merged)).filter(([key]) => !(key in errors))));

    // The offered pipeline change, only if the user accepted it.
    const offer = PROCUREMENT_PIPELINE_OFFERS[target];
    if (command.pipeline && command.pipeline.stage !== offer) {
      errors['pipeline.stage'] = offer
        ? `This milestone offers ${STAGE_LABELS[offer]} only. Change the stage separately if something else is needed.`
        : 'This milestone offers no pipeline change. Change the stage separately if needed.';
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);

    await writeCycle(tx, cycleId, command.version, changes);
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'procurement_cycle',
      entityId: cycleId,
      action: 'procurement.milestone_changed',
      before: { about: cycle.reference, milestone: cycle.milestone },
      after: { about: cycle.reference, milestone: target, ...recorded },
      reason: command.pipeline
        ? `The user also moved the opportunity to ${STAGE_LABELS[command.pipeline.stage]}.`
        : offer
          ? 'The user kept the opportunity stage.'
          : null,
      requestId,
    });

    // Step 6: a submission, a cancellation or any other milestone ends the
    // reminder for the deadline it passed.
    await alertsChangedInTransaction(tx, { opportunityId: opportunity.id, resolution: 'procurement_changed' });

    if (command.pipeline) {
      // Re-read the lock's view of the opportunity: the cycle write did not touch it.
      await changeStageInTransaction(tx, {
        actor,
        current: opportunity,
        command: command.pipeline,
        requestId,
        reason: `Procurement cycle ${cycle.reference}: ${PROCUREMENT_MILESTONE_LABELS[target]}.`,
        fieldPrefix: 'pipeline.',
      });
    }
    await completeClaim(tx, cycleId);
    return Boolean(command.pipeline);
  });

  signalJobsEnqueued();
  return { cycle: await getProcurementCycle(db, actor, cycleId), stageChanged };
}

/** Replays a milestone change: whether the stage moved is read back from the audit trail. */
export async function getMilestoneResult(db: Database, actor: Actor, cycleId: string): Promise<ProcurementMilestoneResultDto> {
  const cycle = await getProcurementCycle(db, actor, cycleId);
  const [last] = await db
    .select({ reason: auditEvents.reason })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, cycleId), eq(auditEvents.action, 'procurement.milestone_changed')))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.sequence))
    .limit(1);
  return { cycle, stageChanged: Boolean(last?.reason?.startsWith('The user also moved')) };
}

// ---------------------------------------------------------------------------
// Contacts and documents
// ---------------------------------------------------------------------------

/**
 * Links a contact to the cycle. The contact must already be linked to the
 * cycle's own opportunity; anything else is the standard 404, so a forged id
 * cannot probe for contacts elsewhere.
 */
export async function linkProcurementContact(options: {
  db: Database;
  actor: Actor;
  cycleId: string;
  contactId: string;
  requestId: string;
}): Promise<ProcurementCycleDetailDto> {
  const { db, actor, cycleId, contactId, requestId } = options;
  await db.transaction(async (tx) => {
    const { opportunity, cycle } = await lockCycle(tx, actor, cycleId);
    if (!canManageProcurement(actor)) throw forbidden();
    assertWritable(opportunity, cycle);
    const [link] = await tx
      .select({ name: contacts.fullName })
      .from(opportunityContacts)
      .innerJoin(contacts, eq(contacts.id, opportunityContacts.contactId))
      .where(
        and(
          eq(opportunityContacts.opportunityId, opportunity.id),
          eq(opportunityContacts.contactId, contactId),
          isNull(opportunityContacts.removedAt),
        ),
      )
      .limit(1);
    if (!link) throw notFound(`contact ${contactId} is not linked to opportunity ${opportunity.id}`);
    const inserted = await tx
      .insert(procurementCycleContacts)
      .values({ cycleId, contactId, createdBy: actor.id, createdAt: now() })
      .onConflictDoNothing()
      .returning({ cycleId: procurementCycleContacts.cycleId });
    if (inserted.length === 0) return;
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'procurement_cycle',
      entityId: cycleId,
      action: 'procurement.contact_linked',
      after: { about: cycle.reference, contact: link.name },
      requestId,
    });
  });
  return getProcurementCycle(db, actor, cycleId);
}

export async function unlinkProcurementContact(options: {
  db: Database;
  actor: Actor;
  cycleId: string;
  contactId: string;
  requestId: string;
}): Promise<ProcurementCycleDetailDto> {
  const { db, actor, cycleId, contactId, requestId } = options;
  await db.transaction(async (tx) => {
    const { opportunity, cycle } = await lockCycle(tx, actor, cycleId);
    if (!canManageProcurement(actor)) throw forbidden();
    assertWritable(opportunity, cycle);
    const removed = await tx
      .delete(procurementCycleContacts)
      .where(and(eq(procurementCycleContacts.cycleId, cycleId), eq(procurementCycleContacts.contactId, contactId)))
      .returning({ contactId: procurementCycleContacts.contactId });
    if (removed.length === 0) throw notFound(`contact ${contactId} is not linked to cycle ${cycleId}`);
    const [contact] = await tx.select({ name: contacts.fullName }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'procurement_cycle',
      entityId: cycleId,
      action: 'procurement.contact_unlinked',
      before: { about: cycle.reference, contact: contact?.name ?? null },
      requestId,
    });
  });
  return getProcurementCycle(db, actor, cycleId);
}

/**
 * Links one of the opportunity's own documents as the cycle's EOI, shortlist,
 * RFP, proposal or decision document. The document keeps its storage,
 * scanning, revisions and access; a document of any other opportunity is the
 * standard 404.
 */
export async function linkProcurementDocument(options: {
  db: Database;
  actor: Actor;
  cycleId: string;
  command: z.output<typeof linkProcurementDocumentSchema>;
  requestId: string;
}): Promise<ProcurementCycleDetailDto> {
  const { db, actor, cycleId, command, requestId } = options;
  await db.transaction(async (tx) => {
    const { opportunity, cycle } = await lockCycle(tx, actor, cycleId);
    if (!canManageProcurement(actor)) throw forbidden();
    // Decision documents arrive after the ending, so endings stay linkable.
    if (!cycle.isCurrent) throw invalidTransition('This cycle has been replaced by a newer one and is kept as history.');
    const [document] = await tx
      .select({ id: documents.id, archivedAt: documents.archivedAt })
      .from(documents)
      .where(and(eq(documents.id, command.documentId), eq(documents.opportunityId, opportunity.id)))
      .limit(1);
    if (!document) throw notFound(`document ${command.documentId} is not a document of opportunity ${opportunity.id}`);
    if (document.archivedAt) throw validationFailed({ documentId: 'This document is archived. Choose a current document.' });
    const inserted = await tx
      .insert(procurementCycleDocuments)
      .values({ cycleId, documentId: command.documentId, role: command.role, createdBy: actor.id, createdAt: now() })
      .onConflictDoNothing()
      .returning({ cycleId: procurementCycleDocuments.cycleId });
    if (inserted.length === 0) throw validationFailed({ documentId: 'This document is already linked to the cycle.' });
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'procurement_cycle',
      entityId: cycleId,
      action: 'procurement.document_linked',
      after: { about: cycle.reference, documentId: command.documentId, role: PROCUREMENT_DOCUMENT_ROLE_LABELS[command.role] },
      requestId,
    });
  });
  return getProcurementCycle(db, actor, cycleId);
}

export async function unlinkProcurementDocument(options: {
  db: Database;
  actor: Actor;
  cycleId: string;
  documentId: string;
  requestId: string;
}): Promise<ProcurementCycleDetailDto> {
  const { db, actor, cycleId, documentId, requestId } = options;
  await db.transaction(async (tx) => {
    const { opportunity, cycle } = await lockCycle(tx, actor, cycleId);
    if (!canManageProcurement(actor)) throw forbidden();
    if (!cycle.isCurrent) throw invalidTransition('This cycle has been replaced by a newer one and is kept as history.');
    const removed = await tx
      .delete(procurementCycleDocuments)
      .where(and(eq(procurementCycleDocuments.cycleId, cycleId), eq(procurementCycleDocuments.documentId, documentId)))
      .returning({ role: procurementCycleDocuments.role });
    if (removed.length === 0) throw notFound(`document ${documentId} is not linked to cycle ${cycleId}`);
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'procurement_cycle',
      entityId: cycleId,
      action: 'procurement.document_unlinked',
      before: { about: cycle.reference, documentId, role: PROCUREMENT_DOCUMENT_ROLE_LABELS[removed[0]!.role] },
      requestId,
    });
  });
  return getProcurementCycle(db, actor, cycleId);
}

