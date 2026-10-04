/**
 * Drizzle schema — Milestone 1 tables only (plan section 5).
 *
 * Deliberately absent until their milestone: contacts, opportunity_contacts,
 * activities, tenders, documents, notifications. Tables are introduced with the
 * feature that uses them, not in advance.
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
  FOLLOW_UP_STATES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  ORGANIZATION_TYPES,
  PRIORITIES,
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
    passwordHash: text('password_hash').notNull(),
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
