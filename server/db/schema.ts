/**
 * Drizzle schema (plan section 5).
 *
 * Deliberately absent until their milestone: notifications. Tables are
 * introduced with the feature that uses them, not in advance.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
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
  FOLLOW_UP_STATES,
  NOTICE_STATES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  ORGANIZATION_TYPES,
  PRIORITIES,
  SCAN_STATES,
  SOLUTION_CATEGORIES,
  USER_ROLES,
} from '../../shared/enums.js';

// ---------------------------------------------------------------------------
// Enum types
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const opportunityStageEnum = pgEnum('opportunity_stage', OPPORTUNITY_STAGES);
export const opportunityStatusEnum = pgEnum('opportunity_status', OPPORTUNITY_STATUSES);
export const priorityEnum = pgEnum('priority', PRIORITIES);
export const solutionCategoryEnum = pgEnum('solution_category', SOLUTION_CATEGORIES);
export const organizationTypeEnum = pgEnum('organization_type', ORGANIZATION_TYPES);
export const followUpStateEnum = pgEnum('follow_up_state', FOLLOW_UP_STATES);
export const idempotencyStateEnum = pgEnum('idempotency_state', ['in_progress', 'completed']);
export const activityTypeEnum = pgEnum('activity_type', ACTIVITY_TYPES);
export const accountTokenPurposeEnum = pgEnum('account_token_purpose', ['invitation', 'password_reset']);
export const bidStatusEnum = pgEnum('bid_status', BID_STATUSES);
export const noticeStateEnum = pgEnum('notice_state', NOTICE_STATES);
export const documentCategoryEnum = pgEnum('document_category', DOCUMENT_CATEGORIES);
export const scanStateEnum = pgEnum('scan_state', SCAN_STATES);

// ---------------------------------------------------------------------------
// Sections and users
// ---------------------------------------------------------------------------

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // FK added in a follow-up migration: sections and users reference each other.
    leadUserId: uuid('lead_user_id'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('sections_name_unique').on(table.name)],
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
    sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'restrict' }),
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
    index('users_section_idx').on(table.sectionId),
    index('users_manager_idx').on(table.managerId),
    index('users_role_active_idx').on(table.role, table.active),
    check('users_email_lowercase', sql`${table.email} = lower(${table.email})`),
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
    stage: opportunityStageEnum('stage').notNull(),
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
      sql`${table.lossReason} IS NULL OR ${table.lossReason} IN ('price', 'technical_eligibility', 'competitor_selected', 'budget_unavailable', 'no_bid', 'other')`,
    ),
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
    noticeState: noticeStateEnum('notice_state').notNull(),
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
// Session store (connect-pg-simple)
// ---------------------------------------------------------------------------

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
