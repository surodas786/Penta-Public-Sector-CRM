/**
 * Validation shared by the React forms and the Express routes.
 *
 * One schema per operation, imported by both sides, so the §4.1 field rules
 * cannot drift apart. The server treats these as authoritative; the client uses
 * them only to show field errors earlier (SEC-001).
 */
import { z } from 'zod';

import {
  LOSS_REASONS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  PRIORITIES,
  SOLUTION_CATEGORIES,
  USER_ROLES,
  isTerminalStage,
  type OpportunityStage,
} from './enums.js';
import { isValidMoneyString } from './money.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const uuidField = z.string().regex(UUID_PATTERN, 'Must be a valid identifier.');

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter an email address.')
  .max(320, 'Email address is too long.')
  .regex(EMAIL_PATTERN, 'Enter a valid email address.');

/** Date-only business field. Rejects impossible calendar dates such as 2026-02-31. */
export const calendarDateField = z
  .string()
  .regex(CALENDAR_DATE_PATTERN, 'Use the date picker (YYYY-MM-DD).')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }, 'That date does not exist.');

/** BDT as a decimal string. Zero is permitted and means "not yet estimated" (§4.1). */
export const moneyField = z
  .string()
  .trim()
  .min(1, 'Enter an estimated value.')
  .refine(isValidMoneyString, 'Enter a non-negative amount with at most two decimal places.');

/** Treats '' and null the same as absent, so optional form inputs round-trip cleanly. */
function optionalText(max: number) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    })
    .refine((value) => value === undefined || value.length <= max, `Use at most ${max} characters.`);
}

function optionalDate() {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => (value === null || value === undefined || value.trim() === '' ? undefined : value.trim()))
    .refine(
      (value) => value === undefined || calendarDateField.safeParse(value).success,
      'Use the date picker (YYYY-MM-DD).',
    );
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export const loginSchema = z
  .object({
    email: emailField,
    password: z.string().min(1, 'Enter your password.').max(512),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * New passwords (SEC-030). Length is the control that matters; composition
 * rules are not imposed. 12 is a proposed default for Penta to confirm, and it
 * does not apply if Penta's identity provider replaces local sign-in.
 */
export const PASSWORD_MIN_LENGTH = 12;

export const setPasswordSchema = z
  .object({
    token: z.string().trim().min(20, 'This link is incomplete. Open the full link you were sent.').max(200),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      .max(256, 'Use at most 256 characters.'),
  })
  .strict();

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

// ---------------------------------------------------------------------------
// Ownership transfer (FR-070, BR-050)
// ---------------------------------------------------------------------------

export const transferOpportunitySchema = z
  .object({
    version: z.number().int().positive('Reload the record and try again.'),
    newOwnerId: uuidField,
    reason: z
      .string()
      .trim()
      .min(3, 'Explain why the opportunity is being transferred.')
      .max(2000, 'Use at most 2000 characters.'),
  })
  .strict();

export type TransferOpportunityInput = z.input<typeof transferOpportunitySchema>;

// ---------------------------------------------------------------------------
// Account and section administration (FR-071, BR-051, BR-052)
// ---------------------------------------------------------------------------

const personName = z.string().trim().min(2, 'Enter the full name.').max(200, 'Use at most 200 characters.');
const optionalId = z.union([uuidField, z.null()]).optional();
const adminReason = z.string().trim().max(2000, 'Use at most 2000 characters.').optional();

/**
 * Section and reporting line are validated against the database by the
 * server; for a salesperson the reporting line is derived from the section's
 * active lead and any supplied value is only checked against it.
 */
export const createUserSchema = z
  .object({
    fullName: personName,
    email: emailField,
    role: z.enum(USER_ROLES),
    sectionId: optionalId,
    managerId: optionalId,
  })
  .strict();

export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    version: z.number().int().positive('Reload the account and try again.'),
    fullName: personName.optional(),
    email: emailField.optional(),
    role: z.enum(USER_ROLES).optional(),
    sectionId: optionalId,
    managerId: optionalId,
  })
  .strict();

export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const accountStateSchema = z
  .object({
    version: z.number().int().positive('Reload the account and try again.'),
    reason: adminReason,
  })
  .strict();

export const sectionNameSchema = z
  .object({
    name: z.string().trim().min(3, 'Use at least 3 characters.').max(200, 'Use at most 200 characters.'),
  })
  .strict();

export const renameSectionSchema = sectionNameSchema
  .extend({ version: z.number().int().positive('Reload the section and try again.') })
  .strict();

export const replaceLeadSchema = z
  .object({
    version: z.number().int().positive('Reload the section and try again.'),
    newLeadId: uuidField,
    reason: z.string().trim().min(3, 'Explain the change of lead.').max(2000, 'Use at most 2000 characters.'),
  })
  .strict();

export const sectionStateSchema = z
  .object({
    version: z.number().int().positive('Reload the section and try again.'),
    reason: adminReason,
  })
  .strict();

export const listUsersQuerySchema = z
  .object({
    page: z
      .string()
      .regex(/^\d{1,6}$/, 'Page must be a whole number.')
      .transform(Number)
      .refine((value) => value >= 1, 'Page must be 1 or greater.')
      .optional()
      .default(1),
    pageSize: z
      .string()
      .regex(/^\d{1,3}$/, 'Page size must be a whole number.')
      .transform(Number)
      .refine((value) => value >= 1 && value <= 100, 'Page size must be between 1 and 100.')
      .optional()
      .default(50),
    q: z.string().trim().max(200).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Opportunity creation (FR-020, BR-001, BR-014)
// ---------------------------------------------------------------------------

/**
 * Opportunities are created Active and nonterminal, with their first follow-up
 * (BR-014). An outcome is then recorded through the stage-change service, so
 * Awarded and Lost always pass through the BR-011 capture rules and leave an
 * audited transition rather than appearing fully formed.
 */
export const M1_CREATABLE_STAGES = OPPORTUNITY_STAGES.filter(
  (stage) => !isTerminalStage(stage),
) as readonly OpportunityStage[];

export const createOpportunitySchema = z
  .object({
    name: z.string().trim().min(3, 'Use at least 3 characters.').max(200, 'Use at most 200 characters.'),
    organizationId: uuidField,
    department: optionalText(200),
    solutionCategory: z.enum(SOLUTION_CATEGORIES),
    description: optionalText(10_000),
    estimatedValue: moneyField,
    fundingSource: optionalText(200),
    ownerId: uuidField,
    sectionId: uuidField,
    stage: z.enum(OPPORTUNITY_STAGES).refine(
      (stage) => !isTerminalStage(stage),
      'Create the opportunity at a working stage, then record Awarded or Lost as a stage change.',
    ),
    priority: z.enum(PRIORITIES).default('medium'),
    expectedPublicationDate: optionalDate(),
    expectedAwardDate: optionalDate(),
    // BR-014: the first follow-up is created in the same transaction.
    initialFollowUpTitle: z
      .string()
      .trim()
      .min(3, 'Describe the next action in at least 3 characters.')
      .max(200, 'Use at most 200 characters.'),
    initialFollowUpDueDate: calendarDateField,
  })
  .strict();

export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>;
export type CreateOpportunityParsed = z.output<typeof createOpportunitySchema>;

// ---------------------------------------------------------------------------
// Opportunity basic edit (plan 7.4)
// ---------------------------------------------------------------------------

/**
 * Explicit allowlist. Owner, section, stage, status, outcome and next-action
 * fields are deliberately absent: they are forbidden here and belong to the
 * dedicated transfer and transition services.
 */
export const patchOpportunitySchema = z
  .object({
    version: z.number().int().positive('Reload the record and try again.'),
    name: z.string().trim().min(3, 'Use at least 3 characters.').max(200).optional(),
    department: optionalText(200),
    solutionCategory: z.enum(SOLUTION_CATEGORIES).optional(),
    description: optionalText(10_000),
    estimatedValue: moneyField.optional(),
    fundingSource: optionalText(200),
    priority: z.enum(PRIORITIES).optional(),
    expectedPublicationDate: optionalDate(),
    expectedAwardDate: optionalDate(),
  })
  .strict();

export type PatchOpportunityInput = z.input<typeof patchOpportunitySchema>;

/** Fields a PATCH may carry besides `version`. Used for error messages and audit diffs. */
export const PATCHABLE_OPPORTUNITY_FIELDS = [
  'name',
  'department',
  'solutionCategory',
  'description',
  'estimatedValue',
  'fundingSource',
  'priority',
  'expectedPublicationDate',
  'expectedAwardDate',
] as const;

/**
 * Fields that exist on an opportunity but must never be set through the basic
 * edit route. Presence of any of these is a forbidden action on a visible
 * record (403), not a validation error.
 */
export const FORBIDDEN_PATCH_FIELDS = [
  'ownerId',
  'sectionId',
  'owner_id',
  'section_id',
  'stage',
  'status',
  'reference',
  'awardedValue',
  'awardDate',
  'lossReason',
  'lossNote',
  'closedDate',
  'statusNote',
  'nextAction',
  'nextActionDue',
  'createdBy',
  'role',
  'userId',
] as const;

// ---------------------------------------------------------------------------
// Stage and status transitions (FR-021, BR-010–012, BR-014)
// ---------------------------------------------------------------------------

/** Reasons, explanations and notes recorded with a transition. */
const reasonText = (requiredMessage: string) =>
  z.string().trim().min(3, requiredMessage).max(2000, 'Use at most 2000 characters.');

/** Positive BDT amount (BR-011: the awarded value must be positive, not merely non-negative). */
export const positiveMoneyField = moneyField.refine(
  (value) => /[1-9]/.test(value),
  'Enter an amount greater than zero.',
);

/**
 * A follow-up created as part of another operation: a replacement next action,
 * or the next action required when an opportunity returns to active work.
 * The assignee defaults server-side to an eligible owner when omitted.
 */
export const followUpDraftSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Describe the next action in at least 3 characters.')
      .max(200, 'Use at most 200 characters.'),
    dueDate: calendarDateField,
    assigneeId: uuidField.optional(),
    priority: z.enum(PRIORITIES).optional(),
  })
  .strict();

export type FollowUpDraftInput = z.input<typeof followUpDraftSchema>;

/**
 * Field presence only. Which fields a particular move requires depends on the
 * record's current stage and status, so the server decides that after reading
 * the record (and the shared `classifyStageMove` tells the browser when to ask).
 */
export const changeStageSchema = z
  .object({
    version: z.number().int().positive('Reload the record and try again.'),
    stage: z.enum(OPPORTUNITY_STAGES),
    explanation: optionalText(2000),
    awardedValue: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => (value === null || value === undefined || value.trim() === '' ? undefined : value.trim()))
      .refine(
        (value) => value === undefined || positiveMoneyField.safeParse(value).success,
        'Enter an amount greater than zero, with at most two decimal places.',
      ),
    awardDate: optionalDate(),
    lossReason: z.enum(LOSS_REASONS).optional(),
    lossNote: optionalText(2000),
    closedDate: optionalDate(),
    nextFollowUp: followUpDraftSchema.optional(),
  })
  .strict();

export type ChangeStageInput = z.input<typeof changeStageSchema>;

export const changeStatusSchema = z
  .object({
    version: z.number().int().positive('Reload the record and try again.'),
    status: z.enum(OPPORTUNITY_STATUSES),
    reason: reasonText('Explain the status change in at least 3 characters.'),
    nextFollowUp: followUpDraftSchema.optional(),
  })
  .strict();

export type ChangeStatusInput = z.input<typeof changeStatusSchema>;

export const reopenOpportunitySchema = z
  .object({
    version: z.number().int().positive('Reload the record and try again.'),
    stage: z
      .enum(OPPORTUNITY_STAGES)
      .refine((stage) => !isTerminalStage(stage), 'Choose the working stage to reopen at.'),
    reason: reasonText('Explain why the opportunity is being reopened.'),
    nextFollowUp: followUpDraftSchema,
  })
  .strict();

export type ReopenOpportunityInput = z.input<typeof reopenOpportunitySchema>;

// ---------------------------------------------------------------------------
// Follow-up lifecycle (FR-042, FR-043, BR-014, BR-030)
// ---------------------------------------------------------------------------

export const createFollowUpSchema = z
  .object({
    title: z.string().trim().min(3, 'Use at least 3 characters.').max(200, 'Use at most 200 characters.'),
    dueDate: calendarDateField,
    assigneeId: uuidField,
    priority: z.enum(PRIORITIES).default('medium'),
  })
  .strict();

export type CreateFollowUpInput = z.input<typeof createFollowUpSchema>;

export const completeFollowUpSchema = z
  .object({
    version: z.number().int().positive('Reload the follow-up and try again.'),
    completionNote: optionalText(2000),
    replacement: followUpDraftSchema.optional(),
  })
  .strict();

export type CompleteFollowUpInput = z.input<typeof completeFollowUpSchema>;

export const rescheduleFollowUpSchema = z
  .object({
    version: z.number().int().positive('Reload the follow-up and try again.'),
    dueDate: calendarDateField,
    reason: reasonText('Give a reason for the new date.'),
  })
  .strict();

export type RescheduleFollowUpInput = z.input<typeof rescheduleFollowUpSchema>;

export const cancelFollowUpSchema = z
  .object({
    version: z.number().int().positive('Reload the follow-up and try again.'),
    reason: reasonText('Give a reason for cancelling this follow-up.'),
    replacement: followUpDraftSchema.optional(),
  })
  .strict();

export type CancelFollowUpInput = z.input<typeof cancelFollowUpSchema>;

/** FR-043 filters. Buckets are decided against today's Dhaka date on the server. */
export const FOLLOW_UP_VIEWS = ['open', 'overdue', 'today', 'upcoming', 'completed', 'cancelled', 'all'] as const;
export type FollowUpView = (typeof FOLLOW_UP_VIEWS)[number];

// ---------------------------------------------------------------------------
// List queries
// ---------------------------------------------------------------------------

const pageNumber = z
  .string()
  .regex(/^\d{1,6}$/, 'Page must be a whole number.')
  .transform(Number)
  .refine((value) => value >= 1, 'Page must be 1 or greater.');

const pageSizeNumber = z
  .string()
  .regex(/^\d{1,3}$/, 'Page size must be a whole number.')
  .transform(Number)
  .refine((value) => value >= 1 && value <= 100, 'Page size must be between 1 and 100.');

export const OPPORTUNITY_SORT_KEYS = [
  'createdAt',
  'name',
  'estimatedValue',
  'stage',
  'priority',
  'expectedAwardDate',
] as const;
export type OpportunitySortKey = (typeof OPPORTUNITY_SORT_KEYS)[number];

export const listOpportunitiesQuerySchema = z
  .object({
    page: pageNumber.optional().default(1),
    pageSize: pageSizeNumber.optional().default(25),
    q: z.string().trim().max(200).optional(),
    stage: z.enum(OPPORTUNITY_STAGES).optional(),
    status: z.enum(OPPORTUNITY_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    solutionCategory: z.enum(SOLUTION_CATEGORIES).optional(),
    organizationId: uuidField.optional(),
    ownerId: uuidField.optional(),
    sectionId: uuidField.optional(),
    expectedAwardFrom: optionalDate(),
    expectedAwardTo: optionalDate(),
    sort: z.enum(OPPORTUNITY_SORT_KEYS).optional().default('createdAt'),
    dir: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .strict();

/** The board takes no stage or status filter: those are its lanes. */
export const boardQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    priority: z.enum(PRIORITIES).optional(),
    solutionCategory: z.enum(SOLUTION_CATEGORIES).optional(),
    organizationId: uuidField.optional(),
    ownerId: uuidField.optional(),
    sectionId: uuidField.optional(),
  })
  .strict();

export const listFollowUpsQuerySchema = z
  .object({
    page: pageNumber.optional().default(1),
    pageSize: pageSizeNumber.optional().default(25),
    view: z.enum(FOLLOW_UP_VIEWS).optional().default('open'),
    /** `me`, or a user id. Narrows within scope; never widens it. */
    assignedTo: z.union([z.literal('me'), uuidField]).optional(),
    q: z.string().trim().max(200).optional(),
  })
  .strict();

export const listOrganizationsQuerySchema = z
  .object({
    page: pageNumber.optional().default(1),
    pageSize: pageSizeNumber.optional().default(25),
    q: z.string().trim().max(200).optional(),
  })
  .strict();

export const paginationQuerySchema = z
  .object({
    page: pageNumber.optional().default(1),
    pageSize: pageSizeNumber.optional().default(25),
  })
  .strict();
