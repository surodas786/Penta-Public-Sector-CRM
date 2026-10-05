/**
 * Transport shapes returned by the API.
 *
 * These are DTOs, not database rows: they deliberately omit password hashes,
 * session data and any private account field (plan 7.3).
 */
import type {
  ActivityType,
  BoardLane,
  FollowUpState,
  LossReason,
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
  | 'invalid_transition'
  | 'possible_duplicate'
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
    transferOpportunities: boolean;
    teamView: boolean;
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
  /** Decimal string; set only while the stage is Awarded (D-006 shows it on the board). */
  awardedValue: string | null;
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
  /** BR-011 outcome fields. Cleared on reopening; the previous outcome stays in history. */
  awardDate: string | null;
  lossReason: LossReason | null;
  lossNote: string | null;
  /** Lost date, or the date a record was cancelled. */
  closedDate: string | null;
  /** The explanation recorded when the record was put On Hold or Cancelled. */
  statusNote: string | null;
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
  createdByName: string;
  createdAt: string;
  completedAt: string | null;
  completedByName: string | null;
  completionNote: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  version: number;
}

/** A follow-up in the cross-opportunity list, with the parent it belongs to. */
export interface FollowUpListItemDto extends FollowUpDto {
  opportunity: {
    id: string;
    reference: string;
    name: string;
    stage: OpportunityStage;
    status: OpportunityStatus;
    ownerName: string;
    sectionName: string;
  };
}

export interface FollowUpListDto extends Paginated<FollowUpListItemDto> {
  /** Today's Dhaka date, the basis every bucket below was computed against (FR-043). */
  today: string;
  /** Per-view totals over the same scoped, filtered population. */
  counts: Record<'open' | 'overdue' | 'today' | 'upcoming' | 'completed' | 'cancelled' | 'all', number>;
}

/** Minimal assignee option (FR-042). No email, no private account field. */
export interface AssigneeOptionDto {
  id: string;
  fullName: string;
  relation: 'owner' | 'section_lead' | 'management';
}

export interface BoardLaneDto {
  lane: BoardLane;
  /** Permitted records in this lane, which may exceed `items.length`. */
  total: number;
  /** Decimal string. Awarded sums actual awarded value; every other lane sums estimates (D-006). */
  value: string;
  valueBasis: 'awarded' | 'estimated';
  items: OpportunityListItemDto[];
}

export interface BoardDto {
  lanes: BoardLaneDto[];
  /** Cards returned per lane at most; the table view pages through the rest. */
  laneLimit: number;
}

export interface HistoryEntryDto {
  id: string;
  action: string;
  entityType: string;
  actorName: string;
  occurredAt: string;
  reason: string | null;
  /** For follow-up events, the task the event concerns. */
  subject: string | null;
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

// ---------------------------------------------------------------------------
// Milestone 3: administration, invitations and the management team view
// ---------------------------------------------------------------------------

/**
 * An account as the System Administrator sees it (FR-071). Carries no
 * commercial data: no owned-opportunity counts or values, which belong to
 * management's team view. No password hash, token or session field.
 */
export interface AdminUserDto {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  sectionId: string | null;
  sectionName: string | null;
  managerId: string | null;
  managerName: string | null;
  active: boolean;
  /** True until an invited account sets its password. */
  invitationPending: boolean;
  version: number;
}

export interface AdminSectionDto {
  id: string;
  name: string;
  active: boolean;
  leadId: string | null;
  leadName: string | null;
  activeMembers: number;
  version: number;
}

/**
 * A single-use link, shown once to the administrator who issued it and never
 * stored in readable form. Delivered to the person out of band: release one
 * sends no email (requirements §1.3).
 */
export interface AccountLinkDto {
  purpose: 'invitation' | 'password_reset';
  url: string;
  expiresAt: string;
}

export interface CreateUserResultDto {
  user: AdminUserDto;
  /** Null when the request was a replay: the link is never shown twice. */
  link: AccountLinkDto | null;
}

export interface AdminAuditEntryDto {
  id: string;
  action: string;
  actorName: string;
  subject: string | null;
  occurredAt: string;
  reason: string | null;
  changes: HistoryChangeDto[];
}

/** Management's read-only structure and workload view (FR-071). No emails, no account fields. */
export interface TeamDto {
  management: { id: string; fullName: string }[];
  sections: {
    id: string;
    name: string;
    lead: { id: string; fullName: string } | null;
    members: { id: string; fullName: string; active: boolean; reportsToLead: boolean }[];
  }[];
  workload: {
    userId: string;
    fullName: string;
    role: UserRole;
    sectionName: string;
    /** Active pipeline population: status Active, stage neither Awarded nor Lost. */
    activeOpportunities: number;
    /** Decimal string; estimated value of the same population. */
    estimatedPipeline: string;
    openTasks: number;
    overdueTasks: number;
  }[];
  today: string;
}

// ---------------------------------------------------------------------------
// Milestone 4: directory, contacts and activities
// ---------------------------------------------------------------------------

/**
 * A directory entry (FR-030, FR-031). Basic organization information only: no
 * private contact details and no project commentary. The opportunity count
 * covers records the caller may access, and is labelled that way.
 */
export interface OrganizationListItemDto {
  id: string;
  name: string;
  type: OrganizationType;
  parentId: string | null;
  parentName: string | null;
  location: string | null;
  website: string | null;
  archived: boolean;
  accessibleOpportunities: number;
}

export interface OrganizationDetailDto extends OrganizationListItemDto {
  basicNotes: string | null;
  children: { id: string; name: string; archived: boolean }[];
  version: number;
  /** FR-033: management archives; anyone in sales may edit basic details. */
  canArchive: boolean;
}

/** A visible contact. Private details are returned only for contacts the caller may see. */
export interface ContactListItemDto {
  id: string;
  fullName: string;
  designation: string;
  department: string | null;
  email: string | null;
  phone: string | null;
  organizationId: string;
  organizationName: string;
  archived: boolean;
  /** Links the caller can see — never the total. */
  accessibleLinks: number;
}

/** One link the caller can see, with that opportunity's relationship notes (BR-020). */
export interface ContactLinkDto {
  linkId: string;
  opportunity: {
    id: string;
    reference: string;
    name: string;
    stage: OpportunityStage;
    status: OpportunityStatus;
    ownerName: string;
    sectionName: string;
  };
  relationshipNotes: string | null;
  createdByName: string;
  createdAt: string;
  version: number;
}

export interface ContactDetailDto extends ContactListItemDto {
  version: number;
  links: ContactLinkDto[];
  /**
   * BR-021: shared identity fields may be edited only by someone who can see
   * every opportunity the contact is linked to (management always can).
   */
  canEditIdentity: boolean;
  canArchive: boolean;
}

/** A contact as it appears on one opportunity's Contacts tab. */
export interface OpportunityContactDto {
  linkId: string;
  relationshipNotes: string | null;
  version: number;
  contact: {
    id: string;
    fullName: string;
    designation: string;
    department: string | null;
    email: string | null;
    phone: string | null;
    organizationName: string;
    archived: boolean;
  };
}

export interface ActivityDto {
  id: string;
  opportunity: { id: string; reference: string; name: string };
  type: ActivityType;
  occurredAt: string;
  subject: string;
  notes: string | null;
  contact: { id: string; fullName: string } | null;
  authorId: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  editedByName: string | null;
  version: number;
  /** FR-041: salespeople amend their own; leads and management any in scope. */
  canEdit: boolean;
}
