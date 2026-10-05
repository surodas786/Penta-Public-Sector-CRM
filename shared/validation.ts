/**
 * Validation shared by the React forms and the Express routes.
 *
 * One schema per operation, imported by both sides, so the §4.1 field rules
 * cannot drift apart. The server treats these as authoritative; the client uses
 * them only to show field errors earlier (SEC-001).
 */
import { z } from 'zod';

import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  PRIORITIES,
  SOLUTION_CATEGORIES,
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

// ---------------------------------------------------------------------------
// Opportunity creation (FR-020, BR-001, BR-014)
// ---------------------------------------------------------------------------

/**
 * M1 creates Active, nonterminal opportunities only. Outcome creation needs the
 * award/loss capture rules that arrive with the M2 transition services.
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
      'Awarded and Lost opportunities are created through the stage workflow, which is not available yet.',
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
