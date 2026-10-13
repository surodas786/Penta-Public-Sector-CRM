/**
 * Drizzle schema (plan section 5).
 *
 * Tables are introduced with the feature that uses them, not in advance.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import {
  ACTIVITY_TYPES,
  BID_STATUSES,
  DOCUMENT_CATEGORIES,
  EOI_OUTCOMES,
  FOLLOW_UP_STATES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  ORGANIZATION_TYPES,
  PARTICIPATION_DECISIONS,
  PRIORITIES,
  PROCUREMENT_DOCUMENT_ROLES,
  PROCUREMENT_MILESTONES,
  PROCUREMENT_ROUTES,
  PROPOSAL_FORMATS,
  SCAN_STATES,
  SOLUTION_CATEGORIES,
  STORED_NOTICE_STATES,
  STORED_OPPORTUNITY_STAGES,
  USER_ROLES,
  type NoticeState,
  type OpportunityStage,
} from '../../shared/enums.js';
import {
  DEADLINE_REMINDER_MAX_HOURS,
  EMAIL_DELIVERY_STATUSES,
  EMAIL_SECURITY_MODES,
  EMAIL_TEMPLATE_KEYS,
  MANDATORY_EMAIL_KEYS,
  NOTIFICATION_TIMING_DEFAULTS,
  SUMMARY_FREQUENCIES,
} from '../../shared/email.js';
import { EXPORT_KINDS, EXPORT_STATUSES, NOTIFICATION_TYPES } from '../../shared/reporting.js';

// ---------------------------------------------------------------------------
// Enum types
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
// The stored lists keep values retired by migration 0011 (see shared/enums.ts);
// the columns are typed with the live lists, and CHECKs refuse the rest.
export const opportunityStageEnum = pgEnum('opportunity_stage', STORED_OPPORTUNITY_STAGES);
export const opportunityStatusEnum = pgEnum('opportunity_status', OPPORTUNITY_STATUSES);
export const priorityEnum = pgEnum('priority', PRIORITIES);
export const solutionCategoryEnum = pgEnum('solution_category', SOLUTION_CATEGORIES);
export const organizationTypeEnum = pgEnum('organization_type', ORGANIZATION_TYPES);
export const followUpStateEnum = pgEnum('follow_up_state', FOLLOW_UP_STATES);
export const idempotencyStateEnum = pgEnum('idempotency_state', ['in_progress', 'completed']);
export const activityTypeEnum = pgEnum('activity_type', ACTIVITY_TYPES);
export const accountTokenPurposeEnum = pgEnum('account_token_purpose', ['invitation', 'password_reset']);
export const bidStatusEnum = pgEnum('bid_status', BID_STATUSES);
export const noticeStateEnum = pgEnum('notice_state', STORED_NOTICE_STATES);
export const eoiOutcomeEnum = pgEnum('eoi_outcome', EOI_OUTCOMES);
export const procurementRouteEnum = pgEnum('procurement_route', PROCUREMENT_ROUTES);
export const procurementMilestoneEnum = pgEnum('procurement_milestone', PROCUREMENT_MILESTONES);
export const proposalFormatEnum = pgEnum('proposal_format', PROPOSAL_FORMATS);
export const participationDecisionEnum = pgEnum('participation_decision', PARTICIPATION_DECISIONS);
export const procurementDocumentRoleEnum = pgEnum('procurement_document_role', PROCUREMENT_DOCUMENT_ROLES);

/** A SQL list of names, for a CHECK that compares an enum as text. */
const textList = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '));
export const documentCategoryEnum = pgEnum('document_category', DOCUMENT_CATEGORIES);
export const scanStateEnum = pgEnum('scan_state', SCAN_STATES);
export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);
export const reportExportStatusEnum = pgEnum('report_export_status', EXPORT_STATUSES);
export const reportExportKindEnum = pgEnum('report_export_kind', EXPORT_KINDS);
export const backgroundJobStatusEnum = pgEnum('background_job_status', ['queued', 'running', 'succeeded', 'failed']);
export const emailSecurityEnum = pgEnum('email_security', EMAIL_SECURITY_MODES);
export const emailTemplateKeyEnum = pgEnum('email_template_key', EMAIL_TEMPLATE_KEYS);
export const emailDeliveryStatusEnum = pgEnum('email_delivery_status', EMAIL_DELIVERY_STATUSES);

// ---------------------------------------------------------------------------
// Sections and users
// ---------------------------------------------------------------------------

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // FK added in a follow-up migration: sections and users reference each other.
    /**
     * The section's lead: the single source of truth since migration 0008
     * (CR4). One person may lead several sections. An active section always
     * has an active lead (CHECK below, plus a deferred trigger on the lead's
     * account); deactivating a section clears it.
     */
    leadUserId: uuid('lead_user_id'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('sections_name_unique').on(table.name),
    index('sections_lead_idx').on(table.leadUserId),
    check('sections_active_has_lead', sql`NOT ${table.active} OR ${table.leadUserId} IS NOT NULL`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: text('full_name').notNull(),
    /** Stored already normalised to lower case; uniqueness is case-insensitive. */
    email: text('email').notNull(),
    /**
     * Null until an invited account sets its password (migration 0003). A null
     * hash never authenticates: sign-in spends the same work and fails.
     */
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull(),
    /**
     * Superseded by `section_memberships` and `sections.lead_user_id` (CR4,
     * CR5; migration 0008). Kept, unread and unwritten, so the migration can
     * be rolled back; a later migration drops it. Never use it for access.
     */
    legacySectionId: uuid('section_id').references(() => sections.id, { onDelete: 'restrict' }),
    /** A lead's management manager. Salespeople report to the lead of each of their sections. */
    managerId: uuid('manager_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    active: boolean('active').notNull().default(true),
    /**
     * Bumped on deactivation and on material role/section changes. Any live
     * session carrying an older value is rejected on its next request (SEC-005).
     */
    sessionVersion: integer('session_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    index('users_section_idx').on(table.legacySectionId),
    index('users_manager_idx').on(table.managerId),
    index('users_role_active_idx').on(table.role, table.active),
    check('users_email_lowercase', sql`${table.email} = lower(${table.email})`),
  ],
);

/**
 * A salesperson's sections (CR5). History is kept: leaving a section ends the
 * row rather than deleting it, and a re-join opens a new row. Only an open row
 * (ended_at null) counts for access; former membership grants nothing.
 * Leads are not members; the sections they lead come from `sections`.
 */
export const sectionMemberships = pgTable(
  'section_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    startedBy: uuid('started_by').references(() => users.id, { onDelete: 'restrict' }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: uuid('ended_by').references(() => users.id, { onDelete: 'restrict' }),
    endReason: text('end_reason'),
  },
  (table) => [
    uniqueIndex('section_memberships_open_unique')
      .on(table.userId, table.sectionId)
      .where(sql`${table.endedAt} IS NULL`),
    index('section_memberships_open_section_idx').on(table.sectionId).where(sql`${table.endedAt} IS NULL`),
    index('section_memberships_user_idx').on(table.userId),
    check('section_memberships_ended_consistent', sql`(${table.endedAt} IS NULL) = (${table.endedBy} IS NULL)`),
  ],
);

// ---------------------------------------------------------------------------
// Shared organization directory (FR-030/031)
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: organizationTypeEnum('type').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => organizations.id, {
      onDelete: 'restrict',
    }),
    location: text('location'),
    website: text('website'),
    /** Basic directory notes only. No private contact details, no deal commentary. */
    basicNotes: text('basic_notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('organizations_name_idx').on(table.name),
    index('organizations_parent_idx').on(table.parentId),
    check('organizations_no_self_parent', sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
  ],
);

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human reference from a database sequence; see migration 0001. */
    reference: text('reference').notNull(),
    name: text('name').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    department: text('department'),
    solutionCategory: solutionCategoryEnum('solution_category').notNull(),
    description: text('description'),
    /** BDT. NUMERIC, never a float. Zero means "not yet estimated" (§4.1). */
    estimatedValue: numeric('estimated_value', { precision: 14, scale: 2 }).notNull(),
    fundingSource: text('funding_source'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'restrict' }),
    /** BR-010 / D-001: stage and status are independent from the first migration. */
    stage: opportunityStageEnum('stage').$type<OpportunityStage>().notNull(),
    status: opportunityStatusEnum('status').notNull().default('active'),
    priority: priorityEnum('priority').notNull().default('medium'),
    expectedPublicationDate: date('expected_publication_date'),
    expectedAwardDate: date('expected_award_date'),
    // Outcome columns exist from the start so M2 adds behaviour, not a data migration.
    awardedValue: numeric('awarded_value', { precision: 14, scale: 2 }),
    awardDate: date('award_date'),
    lossReason: text('loss_reason'),
    lossNote: text('loss_note'),
    closedDate: date('closed_date'),
    statusNote: text('status_note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('opportunities_reference_unique').on(table.reference),
    index('opportunities_section_idx').on(table.sectionId),
    index('opportunities_owner_idx').on(table.ownerId),
    index('opportunities_stage_status_idx').on(table.stage, table.status),
    index('opportunities_organization_idx').on(table.organizationId),
    index('opportunities_expected_award_idx').on(table.expectedAwardDate),
    index('opportunities_created_at_idx').on(table.createdAt),
    // Outcome report and quarterly awarded value (Milestone 6).
    index('opportunities_award_date_idx').on(table.awardDate),
    index('opportunities_closed_date_idx').on(table.closedDate),
    check('opportunities_estimated_value_nonnegative', sql`${table.estimatedValue} >= 0`),
    check(
      'opportunities_awarded_value_nonnegative',
      sql`${table.awardedValue} IS NULL OR ${table.awardedValue} >= 0`,
    ),
    // --- Migration 0002: outcome consistency (BR-010, BR-011, BR-012) -------
    // These make an inconsistent outcome unrepresentable even if a future
    // code path bypasses the transition service.
    check(
      'opportunities_awarded_requires_outcome',
      // IS NOT NULL first: a bare `awarded_value > 0` is NULL for a missing
      // value, and a CHECK that evaluates to NULL passes.
      sql`${table.stage} <> 'awarded' OR (${table.awardedValue} IS NOT NULL AND ${table.awardedValue} > 0 AND ${table.awardDate} IS NOT NULL)`,
    ),
    check(
      'opportunities_lost_requires_outcome',
      sql`${table.stage} <> 'lost' OR (${table.lossReason} IS NOT NULL AND ${table.closedDate} IS NOT NULL)`,
    ),
    check(
      'opportunities_loss_reason_preset',
      sql`${table.lossReason} IS NULL OR ${table.lossReason} IN ('price', 'technical_eligibility', 'competitor_selected', 'budget_unavailable', 'no_bid', 'not_shortlisted', 'other')`,
    ),
    // Migration 0011: only the pipeline's own stages; the Software Procurement
    // stages 0010 added are retired (compared as text: see textList).
    check('opportunities_stage_live', sql`${table.stage}::text IN (${textList(OPPORTUNITY_STAGES)})`),
    check(
      'opportunities_loss_other_explained',
      sql`${table.lossReason} IS DISTINCT FROM 'other' OR ${table.lossNote} IS NOT NULL`,
    ),
    // Reopening clears the outcome; the previous one is kept in audit history.
    check(
      'opportunities_award_only_when_awarded',
      sql`${table.stage} = 'awarded' OR (${table.awardedValue} IS NULL AND ${table.awardDate} IS NULL)`,
    ),
    check(
      'opportunities_loss_only_when_lost',
      sql`${table.stage} = 'lost' OR (${table.lossReason} IS NULL AND ${table.lossNote} IS NULL)`,
    ),
    // BR-010: On Hold and Cancelled are never applied to a terminal record.
    check(
      'opportunities_terminal_status_active',
      sql`${table.stage} NOT IN ('awarded', 'lost') OR ${table.status} = 'active'`,
    ),
    check(
      'opportunities_held_or_cancelled_explained',
      sql`${table.status} = 'active' OR ${table.statusNote} IS NOT NULL`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Follow-ups — the single source of truth for "next action" (BR-013)
// ---------------------------------------------------------------------------

export const followUps = pgTable(
  'follow_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    assignedUserId: uuid('assigned_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Date-only: overdue is decided against today's Dhaka date (FR-043). */
    dueDate: date('due_date').notNull(),
    priority: priorityEnum('priority').notNull().default('medium'),
    state: followUpStateEnum('state').notNull().default('open'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'restrict' }),
    completionNote: text('completion_note'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    cancellationReason: text('cancellation_reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('follow_ups_opportunity_idx').on(table.opportunityId),
    index('follow_ups_assignee_idx').on(table.assignedUserId),
    index('follow_ups_state_due_idx').on(table.state, table.dueDate),
    // Supports the "earliest due open follow-up, creation-time tie-breaker" lookup.
    index('follow_ups_next_action_idx').on(table.opportunityId, table.dueDate, table.createdAt),
    // --- Migration 0002: state consistency (FR-042, BR-014) ------------------
    // A completed task records who and when; a cancelled one records why. A
    // task can never be both, so a cancellation cannot pose as a completion.
    check(
      'follow_ups_completed_consistent',
      sql`(${table.state} = 'completed') = (${table.completedAt} IS NOT NULL AND ${table.completedBy} IS NOT NULL)`,
    ),
    check(
      'follow_ups_cancelled_consistent',
      sql`(${table.state} = 'cancelled') = (${table.cancelledAt} IS NOT NULL AND ${table.cancelledBy} IS NOT NULL AND ${table.cancellationReason} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Append-only audit (FR-062, SEC-012)
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, {
      onDelete: 'restrict',
    }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    /** 'commercial' events follow opportunity scope; 'administrative' is admin-only. */
    domain: text('domain').notNull().default('commercial'),
    beforeData: jsonb('before_data'),
    afterData: jsonb('after_data'),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    requestId: text('request_id').notNull(),
    /**
     * Append order. Events written in one transaction can share a timestamp,
     * so history pages order by (occurred_at, sequence) to be stable.
     */
    sequence: bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
  },
  (table) => [
    index('audit_events_entity_idx').on(table.entityType, table.entityId),
    index('audit_events_opportunity_time_idx').on(table.opportunityId, table.occurredAt),
    index('audit_events_actor_time_idx').on(table.actorId, table.occurredAt),
    index('audit_events_domain_idx').on(table.domain),
  ],
);

// ---------------------------------------------------------------------------
// Durable idempotency (BR-091)
// ---------------------------------------------------------------------------

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Keys are scoped per actor AND per operation; they never cross operations. */
    operation: text('operation').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    /** SHA-256 of the canonical request body. A different payload is a 409. */
    requestFingerprint: text('request_fingerprint').notNull(),
    state: idempotencyStateEnum('state').notNull().default('in_progress'),
    resultEntityId: uuid('result_entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Cleanup horizon; see docs/adr/0002-authentication-and-sessions.md. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_actor_operation_key_unique').on(
      table.actorId,
      table.operation,
      table.idempotencyKey,
    ),
    index('idempotency_expires_idx').on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Contacts, opportunity links and activities (Milestone 4, migration 0004)
// ---------------------------------------------------------------------------

/**
 * A person at a government organization (FR-032). Deliberately no notes
 * field: anything about the relationship belongs on the opportunity link,
 * so a contact shared across teams never carries one team's commentary to
 * another (BR-020, SEC-004). Visibility comes only from links.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    fullName: text('full_name').notNull(),
    designation: text('designation').notNull(),
    department: text('department'),
    /** Optional; stored lower-cased. */
    email: text('email'),
    /** A string, never a number: leading zeros and +880 must survive. */
    phone: text('phone'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('contacts_organization_idx').on(table.organizationId),
    index('contacts_name_idx').on(table.fullName),
    check('contacts_email_lowercase', sql`${table.email} IS NULL OR ${table.email} = lower(${table.email})`),
    check('contacts_archive_consistent', sql`(${table.archivedAt} IS NULL) = (${table.archivedBy} IS NULL)`),
  ],
);

/**
 * The link between a contact and an opportunity, carrying the relationship
 * notes for that opportunity only (BR-020). A removed link is kept, marked
 * removed, so history and notes survive; at most one live link per pair.
 */
export const opportunityContacts = pgTable(
  'opportunity_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    relationshipNotes: text('relationship_notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // BR-080: unique opportunity-contact pairs, among live links.
    uniqueIndex('opportunity_contacts_live_pair_unique')
      .on(table.opportunityId, table.contactId)
      .where(sql`${table.removedAt} IS NULL`),
    index('opportunity_contacts_contact_idx').on(table.contactId),
    check('opportunity_contacts_removal_consistent', sql`(${table.removedAt} IS NULL) = (${table.removedBy} IS NULL)`),
  ],
);

/**
 * Something that happened (FR-040). Never deleted (FR-041): the runtime role
 * has no DELETE on this table (migration 0004). Edits bump the version and
 * leave before/after values in the audit trail.
 */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    type: activityTypeEnum('type').notNull(),
    subject: text('subject').notNull(),
    notes: text('notes'),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'restrict' }),
    /** The original author, kept after transfers. Grants no access (FR-041). */
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    editedBy: uuid('edited_by').references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('activities_opportunity_time_idx').on(table.opportunityId, table.occurredAt),
    // Dashboard recent activity across the scope (Milestone 6).
    index('activities_occurred_at_idx').on(table.occurredAt),
    index('activities_contact_idx').on(table.contactId),
    index('activities_author_idx').on(table.authorId),
  ],
);

// ---------------------------------------------------------------------------
// Tenders (Milestone 5, migration 0005)
// ---------------------------------------------------------------------------

/**
 * One procurement notice or bid cycle for an opportunity (FR-050). Earlier
 * cycles are kept with their bid history; at most one is current, enforced by
 * a partial unique index. The responsible owner is not stored: it is always
 * the opportunity's current owner (§7.1), so a transfer moves it for free.
 */
export const tenders = pgTable(
  'tenders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    procuringOrganizationId: uuid('procuring_organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    reference: text('reference').notNull(),
    procurementMethod: text('procurement_method'),
    noticeUrl: text('notice_url'),
    publicationDate: date('publication_date').notNull(),
    clarificationDeadline: timestamp('clarification_deadline', { withTimezone: true }),
    submissionDeadline: timestamp('submission_deadline', { withTimezone: true }).notNull(),
    bidStatus: bidStatusEnum('bid_status').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    participationReason: text('participation_reason'),
    lateSubmissionNote: text('late_submission_note'),
    isCurrent: boolean('is_current').notNull(),
    noticeState: noticeStateEnum('notice_state').$type<NoticeState>().notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // FR-050, BR-080: at most one current notice per opportunity.
    uniqueIndex('tenders_one_current_per_opportunity')
      .on(table.opportunityId)
      .where(sql`${table.isCurrent}`),
    index('tenders_opportunity_idx').on(table.opportunityId),
    index('tenders_submission_deadline_idx').on(table.submissionDeadline),
    index('tenders_procuring_organization_idx').on(table.procuringOrganizationId),
    check('tenders_title_length', sql`char_length(${table.title}) BETWEEN 3 AND 200`),
    check('tenders_reference_length', sql`char_length(${table.reference}) BETWEEN 1 AND 200`),
    check('tenders_notice_url_http', sql`${table.noticeUrl} IS NULL OR ${table.noticeUrl} ~* '^https?://'`),
    check('tenders_current_is_current_notice', sql`${table.isCurrent} = (${table.noticeState} = 'current')`),
    // FR-051: Submitted always has a time, and nothing else does.
    // Migration 0011: the `closed` state 0010 added for EOI notices is retired.
    check('tenders_notice_state_live', sql`${table.noticeState}::text <> 'closed'`),
    check(
      'tenders_submitted_has_time',
      sql`(${table.bidStatus} = 'submitted') = (${table.submittedAt} IS NOT NULL)`,
    ),
    // BR-040: Not Participating requires a reason.
    check(
      'tenders_not_participating_reason',
      sql`${table.bidStatus} <> 'not_participating' OR ${table.participationReason} IS NOT NULL`,
    ),
    // BR-040: chronology. The deadline is compared as a Dhaka calendar date.
    check(
      'tenders_deadline_not_before_publication',
      sql`(${table.submissionDeadline} AT TIME ZONE 'Asia/Dhaka')::date >= ${table.publicationDate}`,
    ),
    check(
      'tenders_clarification_not_after_submission',
      sql`${table.clarificationDeadline} IS NULL OR ${table.clarificationDeadline} <= ${table.submissionDeadline}`,
    ),
    // BR-040: a submission after the recorded deadline carries an explanation.
    check(
      'tenders_late_submission_explained',
      sql`${table.submittedAt} IS NULL OR ${table.submittedAt} <= ${table.submissionDeadline} OR ${table.lateSubmissionNote} IS NOT NULL`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Documents (Milestone 5, migration 0005)
// ---------------------------------------------------------------------------

/**
 * A document belongs to one opportunity (FR-060) and is a series of
 * revisions; a replacement adds a revision and never overwrites one (FR-061).
 * Removal is a management soft-archive with a reason; there is no delete.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    category: documentCategoryEnum('category').notNull(),
    latestRevision: integer('latest_revision').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('documents_opportunity_idx').on(table.opportunityId),
    check(
      'documents_archive_consistent',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedBy} IS NULL) AND (${table.archivedAt} IS NULL) = (${table.archiveReason} IS NULL)`,
    ),
  ],
);

/**
 * A staged upload: the bytes are stored and validated, but nothing is visible
 * until it is finalized into a document revision. Unfinalized uploads expire
 * and are removed, with their stored file, by the cleanup job.
 */
export const documentUploads = pgTable(
  'document_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    /** Generated by the server; never derived from the user's filename. */
    storageKey: text('storage_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('document_uploads_storage_key_unique').on(table.storageKey),
    index('document_uploads_expiry_idx').on(table.expiresAt),
    check('document_uploads_size_positive', sql`${table.byteSize} > 0`),
  ],
);

/**
 * One stored file. Downloadable only when `scan_state = 'clean'` (SEC-010);
 * the scanner that decided is recorded, so a test-scanner verdict is never
 * mistaken for a real one.
 */
export const documentRevisions = pgTable(
  'document_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    revisionNumber: integer('revision_number').notNull(),
    /** Each staged upload becomes at most one revision: finalize is idempotent. */
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => documentUploads.id, { onDelete: 'restrict' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    note: text('note'),
    scanState: scanStateEnum('scan_state').notNull().default('pending'),
    scanner: text('scanner'),
    scanDetail: text('scan_detail'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('document_revisions_number_unique').on(table.documentId, table.revisionNumber),
    uniqueIndex('document_revisions_upload_unique').on(table.uploadId),
    uniqueIndex('document_revisions_storage_key_unique').on(table.storageKey),
    index('document_revisions_scan_state_idx').on(table.scanState),
    check('document_revisions_number_positive', sql`${table.revisionNumber} >= 1`),
    check(
      'document_revisions_verdict_recorded',
      sql`${table.scanState} = 'pending' OR (${table.scannedAt} IS NOT NULL AND ${table.scanner} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Invitation and password-reset tokens (SEC-030, migration 0003)
// ---------------------------------------------------------------------------

/**
 * Single-use, expiring tokens. Only a SHA-256 hash is stored; the token itself
 * is shown once to the administrator who issued it and never again. A token
 * is spent by setting `used_at`, and issuing a new one for the same purpose
 * spends any earlier ones.
 */
export const accountTokens = pgTable(
  'account_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    purpose: accountTokenPurposeEnum('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('account_tokens_hash_unique').on(table.tokenHash),
    index('account_tokens_user_idx').on(table.userId, table.purpose),
  ],
);

// ---------------------------------------------------------------------------
// Software Procurement cycles: EOI then RFP (CR6, migration 0011)
// ---------------------------------------------------------------------------

const RFP_PHASE = PROCUREMENT_MILESTONES.filter((milestone) =>
  ['rfp_received', 'proposal_preparation', 'proposal_submitted', 'evaluation', 'awarded', 'unsuccessful'].includes(milestone),
);
const PROPOSAL_IN = ['proposal_submitted', 'evaluation', 'awarded', 'unsuccessful'] as const;
const EOI_PHASE = ['eoi_preparation', 'eoi_submitted', 'shortlisted', 'not_shortlisted'] as const;
const ENDINGS = ['not_shortlisted', 'awarded', 'unsuccessful', 'cancelled'] as const;

/**
 * One procurement cycle of an opportunity, separate from goods tenders and
 * from the opportunity pipeline. It belongs to the opportunity, so its owner,
 * section, access and documents are the opportunity's. At most one cycle per
 * opportunity is current; earlier ones stay as history. The CHECKs make the
 * milestone's required fields, the direct-RFP exception and late
 * submissions unrepresentable when wrong; the order of milestones is the
 * service's (services/procurement.ts).
 */
export const procurementCycles = pgTable(
  'procurement_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    procuringOrganizationId: uuid('procuring_organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    /** The procurement's own reference (the EOI's, or the RFP's on a direct RFP). */
    reference: text('reference').notNull(),
    route: procurementRouteEnum('route').notNull(),
    milestone: procurementMilestoneEnum('milestone').notNull(),
    isCurrent: boolean('is_current').notNull(),
    submissionMethod: text('submission_method'),
    participation: participationDecisionEnum('participation').notNull().default('undecided'),
    participationReason: text('participation_reason'),
    // EOI
    eoiPublicationDate: date('eoi_publication_date'),
    eoiDeadline: timestamp('eoi_deadline', { withTimezone: true }),
    eoiSubmittedAt: timestamp('eoi_submitted_at', { withTimezone: true }),
    eoiLateNote: text('eoi_late_note'),
    eoiOutcome: eoiOutcomeEnum('eoi_outcome'),
    eoiOutcomeDate: date('eoi_outcome_date'),
    // RFP
    rfpReference: text('rfp_reference'),
    rfpInvitationDate: date('rfp_invitation_date'),
    clarificationDeadline: timestamp('clarification_deadline', { withTimezone: true }),
    proposalDeadline: timestamp('proposal_deadline', { withTimezone: true }),
    proposalFormat: proposalFormatEnum('proposal_format').notNull().default('single'),
    proposalSubmittedAt: timestamp('proposal_submitted_at', { withTimezone: true }),
    technicalSubmittedAt: timestamp('technical_submitted_at', { withTimezone: true }),
    financialSubmittedAt: timestamp('financial_submitted_at', { withTimezone: true }),
    proposalLateNote: text('proposal_late_note'),
    // The management-only exception: an RFP without an EOI.
    directRfpReason: text('direct_rfp_reason'),
    directRfpApprovedBy: uuid('direct_rfp_approved_by').references(() => users.id, { onDelete: 'restrict' }),
    // The ending
    outcomeDate: date('outcome_date'),
    outcomeNote: text('outcome_note'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('procurement_cycles_one_current_per_opportunity')
      .on(table.opportunityId)
      .where(sql`${table.isCurrent}`),
    index('procurement_cycles_opportunity_idx').on(table.opportunityId),
    index('procurement_cycles_milestone_idx').on(table.milestone),
    index('procurement_cycles_eoi_deadline_idx').on(table.eoiDeadline),
    index('procurement_cycles_proposal_deadline_idx').on(table.proposalDeadline),
    index('procurement_cycles_procuring_organization_idx').on(table.procuringOrganizationId),
    check('procurement_cycles_title_length', sql`char_length(${table.title}) BETWEEN 3 AND 200`),
    check('procurement_cycles_reference_length', sql`char_length(${table.reference}) BETWEEN 1 AND 200`),
    check(
      'procurement_cycles_rfp_reference_length',
      sql`${table.rfpReference} IS NULL OR char_length(${table.rfpReference}) BETWEEN 1 AND 200`,
    ),
    check(
      'procurement_cycles_submission_method_length',
      sql`${table.submissionMethod} IS NULL OR char_length(${table.submissionMethod}) BETWEEN 1 AND 100`,
    ),
    // The direct-RFP exception is documented and approved by management, and
    // never carries an EOI: none is invented to satisfy it.
    check(
      'procurement_cycles_direct_rfp_documented',
      sql`${table.route} <> 'direct_rfp' OR (${table.directRfpReason} IS NOT NULL AND ${table.directRfpApprovedBy} IS NOT NULL
        AND ${table.eoiPublicationDate} IS NULL AND ${table.eoiDeadline} IS NULL AND ${table.eoiSubmittedAt} IS NULL
        AND ${table.eoiOutcome} IS NULL AND ${table.milestone}::text NOT IN (${textList(EOI_PHASE)}))`,
    ),
    check(
      'procurement_cycles_exception_only_on_direct_rfp',
      sql`${table.route} = 'direct_rfp' OR (${table.directRfpReason} IS NULL AND ${table.directRfpApprovedBy} IS NULL)`,
    ),
    // EOI: submitted before any later milestone (unless cancelled during
    // preparation); an outcome only on a submitted EOI, always dated; the RFP
    // only after shortlisting.
    check(
      'procurement_cycles_eoi_submitted_when_due',
      sql`${table.route} = 'direct_rfp' OR ${table.milestone}::text IN ('eoi_preparation', 'cancelled') OR ${table.eoiSubmittedAt} IS NOT NULL`,
    ),
    check(
      'procurement_cycles_eoi_outcome_dated',
      sql`(${table.eoiOutcome} IS NULL) = (${table.eoiOutcomeDate} IS NULL) AND (${table.eoiOutcome} IS NULL OR ${table.eoiSubmittedAt} IS NOT NULL)`,
    ),
    check(
      'procurement_cycles_shortlist_milestones',
      sql`(${table.milestone} <> 'shortlisted' OR ${table.eoiOutcome} = 'shortlisted') AND (${table.milestone} <> 'not_shortlisted' OR ${table.eoiOutcome} = 'not_shortlisted')`,
    ),
    check(
      'procurement_cycles_rfp_after_shortlisting',
      sql`${table.route} = 'direct_rfp' OR ${table.milestone}::text NOT IN (${textList(RFP_PHASE)}) OR ${table.eoiOutcome} = 'shortlisted'`,
    ),
    // RFP: its reference, invitation date and proposal deadline from the
    // moment it is received; the proposal (or both its parts) once submitted.
    check(
      'procurement_cycles_rfp_recorded',
      sql`${table.milestone}::text NOT IN (${textList(RFP_PHASE)}) OR (${table.rfpReference} IS NOT NULL AND ${table.rfpInvitationDate} IS NOT NULL AND ${table.proposalDeadline} IS NOT NULL)`,
    ),
    check(
      'procurement_cycles_proposal_parts',
      sql`(${table.proposalFormat} = 'single' AND ${table.technicalSubmittedAt} IS NULL AND ${table.financialSubmittedAt} IS NULL)
        OR (${table.proposalFormat} = 'separate' AND ${table.proposalSubmittedAt} IS NULL)`,
    ),
    check(
      'procurement_cycles_proposal_submitted_when_due',
      sql`${table.milestone}::text NOT IN (${textList(PROPOSAL_IN)}) OR ${table.proposalSubmittedAt} IS NOT NULL
        OR (${table.technicalSubmittedAt} IS NOT NULL AND ${table.financialSubmittedAt} IS NOT NULL)`,
    ),
    check(
      'procurement_cycles_clarification_before_proposal',
      sql`${table.clarificationDeadline} IS NULL OR ${table.proposalDeadline} IS NULL OR ${table.clarificationDeadline} <= ${table.proposalDeadline}`,
    ),
    // Late submissions are recorded as late, never hidden by moving a deadline.
    check(
      'procurement_cycles_late_eoi_explained',
      sql`${table.eoiSubmittedAt} IS NULL OR ${table.eoiDeadline} IS NULL OR ${table.eoiSubmittedAt} <= ${table.eoiDeadline} OR ${table.eoiLateNote} IS NOT NULL`,
    ),
    check(
      'procurement_cycles_late_proposal_explained',
      sql`${table.proposalDeadline} IS NULL OR ${table.proposalLateNote} IS NOT NULL OR (
        COALESCE(${table.proposalSubmittedAt}, '-infinity') <= ${table.proposalDeadline}
        AND COALESCE(${table.technicalSubmittedAt}, '-infinity') <= ${table.proposalDeadline}
        AND COALESCE(${table.financialSubmittedAt}, '-infinity') <= ${table.proposalDeadline})`,
    ),
    check(
      'procurement_cycles_not_participating_reason',
      sql`${table.participation} <> 'not_participating' OR ${table.participationReason} IS NOT NULL`,
    ),
    // An ending is dated; a cancellation says why.
    check(
      'procurement_cycles_ending_dated',
      sql`${table.milestone}::text NOT IN (${textList(ENDINGS)}) OR ${table.outcomeDate} IS NOT NULL`,
    ),
    check(
      'procurement_cycles_cancellation_explained',
      sql`${table.milestone} <> 'cancelled' OR ${table.outcomeNote} IS NOT NULL`,
    ),
  ],
);

/** People relevant to a cycle: contacts already linked to its opportunity. */
export const procurementCycleContacts = pgTable(
  'procurement_cycle_contacts',
  {
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => procurementCycles.id, { onDelete: 'restrict' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.cycleId, table.contactId] }), index('procurement_cycle_contacts_contact_idx').on(table.contactId)],
);

/**
 * The cycle's EOI, shortlist, RFP, proposal and decision documents: links to
 * the opportunity's own protected documents, which keep their storage,
 * scanning, revisions and access unchanged.
 */
export const procurementCycleDocuments = pgTable(
  'procurement_cycle_documents',
  {
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => procurementCycles.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    role: procurementDocumentRoleEnum('role').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.cycleId, table.documentId] }),
    index('procurement_cycle_documents_document_idx').on(table.documentId),
  ],
);

// ---------------------------------------------------------------------------
// Notifications, exports and background jobs (Milestone 6, migration 0006)
// ---------------------------------------------------------------------------

/**
 * In-app alerts (FR-090, BR-070). `trigger_key` deduplicates by recipient,
 * related record, alert type and the deadline or date the alert is about, so
 * a job that runs twice creates one alert. The wording is built when the
 * alert is read, from records the reader can still see; nothing commercial is
 * frozen into the row. An alert is retired (`resolved_at`) when its task is
 * closed or rescheduled, its notice changes, or its recipient loses access —
 * and reads re-check all of that too, so an obsolete alert never shows even
 * before the retirement is written. Reading never touches the task.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    followUpId: uuid('follow_up_id').references(() => followUps.id, { onDelete: 'restrict' }),
    tenderId: uuid('tender_id').references(() => tenders.id, { onDelete: 'restrict' }),
    /** For EOI and RFP deadline alerts (CR6), the procurement cycle. */
    procurementCycleId: uuid('procurement_cycle_id').references(() => procurementCycles.id, { onDelete: 'restrict' }),
    type: notificationTypeEnum('type').notNull(),
    triggerKey: text('trigger_key').notNull(),
    /** The task due date the alert is about. */
    triggerDate: date('trigger_date'),
    /** The submission deadline (tender, EOI or proposal) the alert is about. */
    triggerAt: timestamp('trigger_at', { withTimezone: true }),
    /** For ownership alerts, the owner the record was transferred to. */
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (table) => [
    uniqueIndex('notifications_trigger_key_unique').on(table.triggerKey),
    index('notifications_recipient_idx').on(table.recipientId, table.resolvedAt, table.createdAt),
    index('notifications_follow_up_idx').on(table.followUpId),
    index('notifications_tender_idx').on(table.tenderId),
    index('notifications_procurement_cycle_idx').on(table.procurementCycleId),
    index('notifications_opportunity_idx').on(table.opportunityId),
    // Compared as text: the procurement types are added to the enum by the
    // same migration, and a new enum value cannot be used before it commits.
    check(
      'notifications_subject_present',
      sql`(${table.type}::text IN ('follow_up_due_today', 'follow_up_overdue') AND ${table.followUpId} IS NOT NULL AND ${table.triggerDate} IS NOT NULL)
        OR (${table.type}::text = 'tender_deadline' AND ${table.tenderId} IS NOT NULL AND ${table.triggerAt} IS NOT NULL)
        OR (${table.type}::text = 'ownership_changed' AND ${table.subjectUserId} IS NOT NULL)
        OR (${table.type}::text IN ('eoi_deadline', 'rfp_deadline') AND ${table.procurementCycleId} IS NOT NULL AND ${table.triggerAt} IS NOT NULL)`,
    ),
    check('notifications_resolution_recorded', sql`(${table.resolvedAt} IS NULL) = (${table.resolution} IS NULL)`),
  ],
);

/**
 * Queued CSV exports (FR-083, NFR-011). The file is generated by a background
 * job under the requester's current scope and kept until `expires_at`.
 * Delivery re-checks that the requester may still see every record in it
 * (SEC-005); `opportunity_ids` is what makes that check possible.
 */
export const reportExports = pgTable(
  'report_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: reportExportKindEnum('kind').notNull(),
    /** The validated filters, exactly as the visible report applied them. */
    filters: jsonb('filters').notNull(),
    status: reportExportStatusEnum('status').notNull().default('queued'),
    rowCount: integer('row_count'),
    fileName: text('file_name'),
    content: text('content'),
    opportunityIds: uuid('opportunity_ids').array(),
    failureReason: text('failure_reason'),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('report_exports_requester_idx').on(table.requestedBy, table.createdAt),
    index('report_exports_expiry_idx').on(table.expiresAt),
    check(
      'report_exports_ready_complete',
      sql`${table.status} <> 'ready' OR (${table.content} IS NOT NULL AND ${table.rowCount} IS NOT NULL AND ${table.opportunityIds} IS NOT NULL AND ${table.expiresAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Durable, retryable background work (NFR-003): notification scans, queued
 * exports and housekeeping. Workers claim with `FOR UPDATE SKIP LOCKED`, so
 * several API instances can share the queue; a failure is retried with
 * backoff until `max_attempts`, then left `failed` for monitoring.
 * `dedupe_key` makes a scheduled run idempotent across instances.
 */
export const backgroundJobs = pgTable(
  'background_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: backgroundJobStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    /** A summary safe to log: never request data or record content (SEC-032). */
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('background_jobs_dedupe_unique').on(table.dedupeKey),
    index('background_jobs_due_idx').on(table.status, table.runAfter),
    check('background_jobs_attempts_bounded', sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.maxAttempts}`),
  ],
);

// ---------------------------------------------------------------------------
// Session store (connect-pg-simple)
// ---------------------------------------------------------------------------

/**
 * The mail server an administrator configured (CR2). One row at most; until
 * an administrator saves settings there is no row and delivery is off. The
 * SMTP password is stored only encrypted (AES-256-GCM with EMAIL_SECRET_KEY,
 * which never enters the database) and is never returned by the API.
 */
export const emailSettings = pgTable(
  'email_settings',
  {
    id: integer('id').primaryKey().default(1),
    enabled: boolean('enabled').notNull().default(false),
    host: text('host'),
    port: integer('port'),
    security: emailSecurityEnum('security').notNull().default('starttls'),
    username: text('username'),
    passwordCiphertext: text('password_ciphertext'),
    fromName: text('from_name'),
    fromAddress: text('from_address'),
    replyTo: text('reply_to'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check('email_settings_single_row', sql`${table.id} = 1`),
    check('email_settings_port_range', sql`${table.port} IS NULL OR ${table.port} BETWEEN 1 AND 65535`),
    check(
      'email_settings_enabled_complete',
      sql`NOT ${table.enabled} OR (${table.host} IS NOT NULL AND ${table.port} IS NOT NULL AND ${table.fromAddress} IS NOT NULL)`,
    ),
  ],
);

/**
 * An administrator's wording for one email (CR2). A template with no row uses
 * the default in shared/email.ts, so default wording lives in one place.
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    key: emailTemplateKeyEnum('key').primaryKey(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check('email_templates_subject_length', sql`char_length(${table.subject}) BETWEEN 1 AND 200`),
    // A line break in a subject would be a header injection.
    check(
      'email_templates_subject_single_line',
      sql`position(chr(10) in ${table.subject}) = 0 AND position(chr(13) in ${table.subject}) = 0`,
    ),
    check('email_templates_body_length', sql`char_length(${table.bodyText}) BETWEEN 1 AND 10000`),
    // Security messages stay on while delivery is on (step 6; MANDATORY_EMAIL_KEYS).
    check(
      'email_templates_security_enabled',
      sql`${table.enabled} OR ${table.key}::text NOT IN (${textList(MANDATORY_EMAIL_KEYS)})`,
    ),
  ],
);

/**
 * When notification emails go out and who receives the management summary
 * (CR2, step 6). One row at most; until an administrator saves, the defaults
 * in shared/email.ts apply. The recipient ids are re-checked against the
 * users table when saved and again when each summary is sent, so a stored id
 * grants nothing by itself.
 */
export const emailNotificationSettings = pgTable(
  'email_notification_settings',
  {
    id: integer('id').primaryKey().default(1),
    reminderHour: integer('reminder_hour').notNull().default(NOTIFICATION_TIMING_DEFAULTS.reminderHour),
    tenderReminderHours: integer('tender_reminder_hours').notNull().default(NOTIFICATION_TIMING_DEFAULTS.tenderReminderHours),
    eoiReminderHours: integer('eoi_reminder_hours').notNull().default(NOTIFICATION_TIMING_DEFAULTS.eoiReminderHours),
    rfpReminderHours: integer('rfp_reminder_hours').notNull().default(NOTIFICATION_TIMING_DEFAULTS.rfpReminderHours),
    summaryFrequency: text('summary_frequency').notNull().default(NOTIFICATION_TIMING_DEFAULTS.summaryFrequency),
    summaryWeekday: integer('summary_weekday').notNull().default(NOTIFICATION_TIMING_DEFAULTS.summaryWeekday),
    managementSummaryRecipientIds: uuid('management_summary_recipient_ids').array().notNull().default(sql`'{}'::uuid[]`),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check('email_notification_settings_single_row', sql`${table.id} = 1`),
    check('email_notification_settings_reminder_hour', sql`${table.reminderHour} BETWEEN 0 AND 23`),
    check(
      'email_notification_settings_deadline_hours',
      sql`${table.tenderReminderHours} BETWEEN 1 AND ${sql.raw(String(DEADLINE_REMINDER_MAX_HOURS))}
        AND ${table.eoiReminderHours} BETWEEN 1 AND ${sql.raw(String(DEADLINE_REMINDER_MAX_HOURS))}
        AND ${table.rfpReminderHours} BETWEEN 1 AND ${sql.raw(String(DEADLINE_REMINDER_MAX_HOURS))}`,
    ),
    check('email_notification_settings_frequency', sql`${table.summaryFrequency} IN (${textList(SUMMARY_FREQUENCIES)})`),
    check('email_notification_settings_weekday', sql`${table.summaryWeekday} BETWEEN 0 AND 6`),
  ],
);

/**
 * One email the system means to send, and what became of it (CR2). The
 * message body is never stored: it is rendered when sent, from the current
 * template, and may carry a single-use link that must not rest in a table.
 * `context` holds only non-sensitive references needed to render it.
 */
export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** A template key, or `test` for an administrator's test message. */
    templateKey: text('template_key').notNull(),
    recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'restrict' }),
    /** The address used, recorded when the message is attempted. */
    recipientAddress: text('recipient_address'),
    status: emailDeliveryStatusEnum('status').notNull().default('queued'),
    /** Log-safe outcome, e.g. why it was suppressed or the SMTP error class. */
    statusDetail: text('status_detail'),
    attempts: integer('attempts').notNull().default(0),
    dedupeKey: text('dedupe_key'),
    context: jsonb('context').notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('email_deliveries_dedupe_unique').on(table.dedupeKey),
    index('email_deliveries_created_idx').on(table.createdAt),
    index('email_deliveries_status_idx').on(table.status),
    check('email_deliveries_has_recipient', sql`${table.recipientUserId} IS NOT NULL OR ${table.recipientAddress} IS NOT NULL`),
    check('email_deliveries_sent_has_time', sql`(${table.status} = 'sent') = (${table.sentAt} IS NOT NULL)`),
  ],
);

/**
 * Owned by the migrations rather than created at runtime: the application role
 * has no DDL privileges.
 */
export const sessionStore = pgTable(
  'session',
  {
    sid: varchar('sid').primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire', { precision: 6, withTimezone: false }).notNull(),
  },
  (table) => [index('session_expire_idx').on(table.expire)],
);

export type UserRow = typeof users.$inferSelect;
export type SectionRow = typeof sections.$inferSelect;
export type OrganizationRow = typeof organizations.$inferSelect;
export type OpportunityRow = typeof opportunities.$inferSelect;
export type FollowUpRow = typeof followUps.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type AccountTokenRow = typeof accountTokens.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;
export type TenderRow = typeof tenders.$inferSelect;
export type DocumentRevisionRow = typeof documentRevisions.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type ReportExportRow = typeof reportExports.$inferSelect;
export type BackgroundJobRow = typeof backgroundJobs.$inferSelect;
export type EmailSettingsRow = typeof emailSettings.$inferSelect;
export type EmailDeliveryRow = typeof emailDeliveries.$inferSelect;
