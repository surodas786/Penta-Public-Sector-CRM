/**
 * Transport shapes returned by the API.
 *
 * These are DTOs, not database rows: they deliberately omit password hashes,
 * session data and any private account field (plan 7.3).
 */
import type {
  FollowUpState,
  OpportunityStage,
  OpportunityStatus,
  OrganizationType,
  Priority,
  SolutionCategory,
  UserRole,
} from './enums.js';

/** SEC-020 error envelope. `requestId` is unique per response. */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
  requestId: string;
}

export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'version_conflict'
  | 'idempotency_key_reuse'
  | 'idempotency_in_progress'
  | 'validation_failed'
  | 'rate_limited'
  | 'invalid_csrf'
  | 'internal_error';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SectionDto {
  id: string;
  name: string;
  active: boolean;
}

/** The authenticated account. Never includes credentials. */
export interface CurrentUserDto {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  section: SectionDto | null;
  /** Server-computed UI affordances. Not a security boundary. */
  capabilities: {
    salesRecords: boolean;
    createOpportunity: boolean;
    accountAdministration: boolean;
  };
}

export interface OrganizationSummaryDto {
  id: string;
  name: string;
  type: OrganizationType;
  location: string | null;
}

/** Minimal owner option. No email, no reporting line, no private account field. */
export interface OwnerOptionDto {
  id: string;
  fullName: string;
  sectionId: string;
  sectionName: string;
}

export interface OpportunityListItemDto {
  id: string;
  reference: string;
  name: string;
  organization: OrganizationSummaryDto;
  solutionCategory: SolutionCategory;
  /** Decimal string. Never a float. */
  estimatedValue: string;
  stage: OpportunityStage;
  status: OpportunityStatus;
  priority: Priority;
  ownerId: string;
  ownerName: string;
  sectionId: string;
  sectionName: string;
  expectedAwardDate: string | null;
  nextAction: NextActionDto | null;
  createdAt: string;
  version: number;
}

/** BR-013: derived from the earliest due open follow-up, never stored separately. */
export interface NextActionDto {
  followUpId: string;
  title: string;
  dueDate: string;
  state: FollowUpState;
  assigneeId: string;
  assigneeName: string;
}

export interface OpportunityDetailDto extends OpportunityListItemDto {
  department: string | null;
  description: string | null;
  fundingSource: string | null;
  expectedPublicationDate: string | null;
  createdByName: string;
  updatedAt: string;
}

export interface FollowUpDto {
  id: string;
  opportunityId: string;
  title: string;
  dueDate: string;
  state: FollowUpState;
  priority: Priority;
  assigneeId: string;
  assigneeName: string;
  createdAt: string;
}

export interface HistoryEntryDto {
  id: string;
  action: string;
  entityType: string;
  actorName: string;
  occurredAt: string;
  reason: string | null;
  changes: HistoryChangeDto[];
}

export interface HistoryChangeDto {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface CreateOpportunityResultDto {
  opportunity: OpportunityDetailDto;
  firstFollowUp: FollowUpDto;
  /** Non-blocking advisories, e.g. an award date earlier than publication (§4.1). */
  warnings: string[];
}

/** Header carrying the client-generated idempotency key (BR-091). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Header carrying the double-submit CSRF token. */
export const CSRF_HEADER = 'x-csrf-token';
