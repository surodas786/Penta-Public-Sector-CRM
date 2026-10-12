/**
 * Transport shapes returned by the API.
 *
 * These are DTOs, not database rows: they deliberately omit password hashes,
 * session data and any private account field (plan 7.3).
 */
import type { EmailDeliveryStatus, EmailSecurityMode, EmailTemplateKey, EmailTransportKind } from './email.js';
import type {
  ActivityType,
  BidStatus,
  BoardLane,
  DocumentCategory,
  FollowUpState,
  LossReason,
  NoticeState,
  OpportunityStage,
  OpportunityStatus,
  OrganizationType,
  Priority,
  ScanState,
  SolutionCategory,
  TenderIndicator,
  UserRole,
  Workflow,
  EoiOutcome,
  TenderPhase,
} from './enums.js';
import type {
  AdminSearchResultType,
  DashboardRange,
  DateBasis,
  ExportKind,
  ExportStatus,
  NotificationType,
  ReportColumnKind,
  ReportKey,
  SearchResultType,
} from './reporting.js';

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
  | 'document_unavailable'
  | 'payload_too_large'
  | 'export_unavailable'
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
  /**
   * The sections the account works in now: those a lead leads, or those a
   * salesperson belongs to (CR4, CR5). Empty for management and administrators.
   */
  sections: SectionDto[];
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
  /** CR6: which stages the record follows; fixed at creation. */
  workflow: Workflow;
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

export interface OpportunityListDto extends Paginated<OpportunityListItemDto> {
  /**
   * BR-060: with an expected-award date range applied, how many otherwise
   * matching records have no expected award date and are therefore not
   * listed. Null when no range is applied.
   */
  undatedExpectedAward: number | null;
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
  /** CR6: the workflow whose lanes these are. */
  workflow: Workflow;
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

/**
 * Marks a request the browser makes on its own (the notification count poll).
 * Such a request is authenticated as usual but is not user activity, so it
 * never extends the idle window (SEC-031). It can only shorten a session's
 * life, never lengthen it, so a forged value gains nothing.
 */
export const BACKGROUND_REQUEST_HEADER = 'x-background-request';

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
  /**
   * For a salesperson, the sections they currently belong to; for a lead, the
   * sections they currently lead (CR4, CR5). Empty otherwise.
   */
  sections: { id: string; name: string; active: boolean }[];
  /** A lead's management manager. Salespeople report to the lead of each section. */
  managerId: string | null;
  managerName: string | null;
  active: boolean;
  /** True until an invited account sets its password. */
  invitationPending: boolean;
  /** An unused, unexpired invitation or reset link exists (never the link itself). */
  linkActive: boolean;
  /** The latest invitation or reset email for this account, if any (CR1). */
  accountEmail: {
    purpose: 'invitation' | 'password_reset';
    status: EmailDeliveryStatus;
    statusDetail: string | null;
    at: string;
  } | null;
  version: number;
}

export interface AdminSectionDto {
  id: string;
  name: string;
  active: boolean;
  leadId: string | null;
  leadName: string | null;
  /** Active salespeople who are current members. The lead is not counted. */
  activeMembers: number;
  version: number;
}

/**
 * A single-use link, shown once to the administrator who issued it and never
 * stored in readable form. Delivered to the person out of band: release one
 * sends no email (requirements §1.3).
 */
/**
 * What an opened invitation or reset link can do (CR1). Opening a link never
 * spends it. `used` also covers a link replaced by a newer one.
 */
export interface AccountLinkStatusDto {
  state: 'valid' | 'expired' | 'used' | 'invalid';
  purpose: 'invitation' | 'password_reset' | null;
}

/** Whether the sign-in page offers "Forgot your password?" (CR3). */
export interface RecoveryOptionsDto {
  selfServiceReset: boolean;
}

export type AccountLinkDto =
  | {
      purpose: 'invitation' | 'password_reset';
      /** Shown once, for the administrator to deliver by hand. */
      delivery: 'manual';
      url: string;
      expiresAt: string;
    }
  | {
      purpose: 'invitation' | 'password_reset';
      /**
       * Queued as an email (CR1). The link is created only when the email is
       * sent, so neither the administrator nor the database ever sees it.
       */
      delivery: 'email';
      url: null;
      expiresAt: null;
    };

export interface CreateUserResultDto {
  user: AdminUserDto;
  /** How the invitation goes out: emailed while email delivery is on, otherwise a link shown once. */
  delivery: 'email' | 'manual';
  /** The manual link. Null when emailed, or when the request was a replay: a link is never shown twice. */
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
    /** Current members; each reports to this section's lead (CR5). */
    members: { id: string; fullName: string; active: boolean }[];
  }[];
  workload: {
    userId: string;
    fullName: string;
    role: UserRole;
    /** Sections they work in now; a person may work in several (CR4, CR5). */
    sectionNames: string[];
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

// ---------------------------------------------------------------------------
// Milestone 5: tenders and documents
// ---------------------------------------------------------------------------

export interface TenderDto {
  id: string;
  opportunity: {
    id: string;
    reference: string;
    name: string;
    workflow: Workflow;
    stage: OpportunityStage;
    status: OpportunityStatus;
    organizationId: string;
  };
  procuringOrganization: { id: string; name: string };
  /** CR6: EOI or RFP on a Software Procurement record; null on a standard one. */
  phase: TenderPhase | null;
  /** CR6: an EOI's recorded result; recording it closes the notice (D-CR6-6). */
  eoiOutcome: EoiOutcome | null;
  eoiOutcomeDate: string | null;
  /** §7.1: shown with a clear label when it differs from the opportunity's organization. */
  procuringDiffersFromOpportunity: boolean;
  title: string;
  reference: string;
  procurementMethod: string | null;
  noticeUrl: string | null;
  publicationDate: string;
  clarificationDeadline: string | null;
  submissionDeadline: string;
  bidStatus: BidStatus;
  submittedAt: string | null;
  participationReason: string | null;
  lateSubmissionNote: string | null;
  isCurrent: boolean;
  noticeState: NoticeState;
  notes: string | null;
  /** §7.1: always the opportunity's current owner, never stored on the tender. */
  responsibleOwner: { id: string; fullName: string };
  section: { id: string; name: string };
  /** FR-052, decided by the server against the real clock. */
  indicator: TenderIndicator;
  /** FR-051: bid recorded Submitted while the opportunity is still at an earlier stage. */
  stageMismatch: boolean;
  /** FR-051: whether Mark Submitted may offer to move the opportunity to its submitted stage. */
  canOfferBidSubmittedStage: boolean;
  /** The stage that offer moves to: Bid Submitted, or EOI / Proposal Submitted (CR6). */
  offeredStage: OpportunityStage;
  /** CR6: a submitted, current EOI whose outcome can now be recorded. */
  canRecordEoiOutcome: boolean;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  canEdit: boolean;
}

export interface TenderSubmissionResultDto {
  tender: TenderDto;
  /** True only when the user explicitly accepted the stage change (FR-051). */
  stageChanged: boolean;
}

export interface DocumentRevisionDto {
  id: string;
  revisionNumber: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  note: string | null;
  scanState: ScanState;
  /** Which scanner decided. `test-scanner` is never production malware scanning. */
  scanner: string | null;
  scannedAt: string | null;
  uploadedByName: string;
  uploadedAt: string;
  /** SEC-010: only a clean verdict makes a file downloadable. */
  downloadable: boolean;
  /** SEC-011: safe formats may be previewed inline. */
  previewable: boolean;
}

export interface DocumentDto {
  id: string;
  opportunityId: string;
  category: DocumentCategory;
  latest: DocumentRevisionDto;
  revisionCount: number;
  createdAt: string;
  archivedAt: string | null;
  archivedByName: string | null;
  archiveReason: string | null;
  version: number;
  canArchive: boolean;
}

export interface DocumentDetailDto extends DocumentDto {
  revisions: DocumentRevisionDto[];
}

export interface StagedUploadDto {
  uploadId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  expiresAt: string;
}

/** Public facts about the document service, for the upload form. */
export interface DocumentPolicyDto {
  maxUploadBytes: number;
  acceptedExtensions: string[];
  /** `none` means files are stored but stay unavailable (no scanner configured). */
  scanner: 'none' | 'test';
}

/** Header carrying the original filename of a raw upload, URI-encoded. */
export const FILE_NAME_HEADER = 'x-file-name';

// ---------------------------------------------------------------------------
// Milestone 6: dashboards, reports, exports, search and notifications
// ---------------------------------------------------------------------------

/** Dashboard filters as the server applied them (FR-082: narrowing only). */
export interface DashboardFiltersDto {
  sectionId: string | null;
  ownerId: string | null;
  range: DashboardRange;
}

/** One column of the approved stage chart (FR-081). */
export interface DashboardStageDto {
  /** A pipeline stage, or `awarded` / `lost`. */
  stage: OpportunityStage;
  count: number;
  /** Decimal string. Pipeline stages and Lost: estimated value; Awarded: actual awarded value (D-006). */
  value: string;
  valueBasis: 'estimated' | 'awarded';
}

export interface DashboardWorkloadRowDto {
  userId: string;
  fullName: string;
  role: UserRole;
  /** The sections they work in now (CR4, CR5); empty for a former member. */
  sectionNames: string[];
  active: boolean;
  /** Active pipeline records owned (§10.1 "Team workload"). */
  activeOpportunities: number;
  /** Decimal string; estimated value of the same records. */
  estimatedPipeline: string;
  /** Open follow-ups on records they own. */
  openTasks: number;
  overdueTasks: number;
  /** Their records' current notices due in the seven-day window. */
  tendersDueSoon: number;
}

export interface DashboardNextActionDto {
  followUpId: string;
  title: string;
  dueDate: string;
  dueState: 'overdue' | 'today' | 'upcoming';
  opportunityId: string;
  opportunityName: string;
  assigneeName: string;
  onHold: boolean;
}

export interface DashboardTenderDto {
  id: string;
  reference: string;
  title: string;
  opportunityId: string;
  opportunityName: string;
  submissionDeadline: string;
  bidStatus: BidStatus;
  indicator: TenderIndicator;
}

export interface DashboardActivityDto {
  id: string;
  opportunityId: string;
  opportunityName: string;
  type: ActivityType;
  subject: string;
  occurredAt: string;
  authorName: string;
}

export interface DashboardSectionDto {
  id: string;
  name: string;
  activeOpportunities: number;
  /** Decimal string; estimated active pipeline. */
  estimatedPipeline: string;
}

/**
 * Scoped dashboard (FR-080, FR-081, §10.1). Every figure is computed by the
 * server over the actor's scope, with the same definitions the reports, lists
 * and exports use.
 */
export interface DashboardDto {
  /** Dhaka calendar date and instant the figures were computed against. */
  today: string;
  generatedAt: string;
  scopeLabel: string;
  filters: DashboardFiltersDto;
  quarter: { label: string; start: string; end: string };
  /** Dhaka dates the range filter resolved to; null for All time. */
  rangeBounds: { from: string; to: string } | null;
  kpis: {
    activeOpportunities: number;
    /** Decimal string. Not a revenue forecast. */
    estimatedActivePipeline: string;
    /** Open follow-ups due before today, on records that are not On Hold. */
    overdueFollowUps: number;
    /** Shown separately (§10.1). */
    overdueFollowUpsOnHold: number;
    /** Current participating notices due from now up to, not including, now + 7 days. */
    tendersDueNext7Days: number;
    /** Decimal string; sum of actual awarded value, award date in the current Dhaka quarter. */
    awardedValueThisQuarter: string;
    awardedCountThisQuarter: number;
  };
  /** Pipeline stages (active records), then Awarded and Lost for the date range. */
  stages: DashboardStageDto[];
  onHold: { count: number; estimatedValue: string };
  cancelled: { count: number; estimatedValue: string };
  /** Leads and management only. */
  workload: DashboardWorkloadRowDto[] | null;
  /** Management only. */
  sections: DashboardSectionDto[] | null;
  nextActions: { target: { id: string; fullName: string }; items: DashboardNextActionDto[]; total: number };
  upcomingTenders: DashboardTenderDto[];
  recentActivity: DashboardActivityDto[];
  /** Owner choices for the filter: leads see their sections' people, management everyone; salespeople none. */
  ownerOptions: { id: string; fullName: string; active: boolean }[];
  sectionOptions: { id: string; name: string }[];
}

export interface ReportColumnDto {
  key: string;
  label: string;
  kind: ReportColumnKind;
  sortable: boolean;
}

export type ReportCell = string | number | null;

export interface ReportRowDto {
  cells: Record<string, ReportCell>;
  /** Present when the row belongs to one opportunity the reader can open. */
  opportunityId: string | null;
}

export interface ReportSummaryItemDto {
  label: string;
  /** Preformatted for counts and percentages; decimal string for money. */
  value: string;
  kind: ReportColumnKind;
}

/** A scoped, filtered, sorted page of one report (FR-082, BR-060). */
export interface ReportDto extends Paginated<ReportRowDto> {
  report: ReportKey;
  label: string;
  dateBasis: { key: DateBasis; label: string };
  filters: { from: string | null; to: string | null; sectionId: string | null; ownerId: string | null };
  sort: string;
  dir: 'asc' | 'desc';
  columns: ReportColumnDto[];
  /** Computed over every matching record, not just this page. */
  summary: ReportSummaryItemDto[];
  /**
   * BR-060: records that match every other filter but have no value for the
   * date basis, so a date filter would otherwise hide them silently. Null when
   * the basis can never be empty.
   */
  undated: { count: number; note: string } | null;
  today: string;
  scopeLabel: string;
}

export interface ReportExportDto {
  id: string;
  kind: ExportKind;
  label: string;
  status: ExportStatus;
  rowCount: number | null;
  fileName: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  /** Why it failed, in words safe to show. */
  failureReason: string | null;
}

export interface SearchResultDto {
  type: SearchResultType | AdminSearchResultType;
  id: string;
  title: string;
  /** A safe summary: nothing the reader could not open themselves. */
  summary: string;
  /** In-app path to the record. */
  path: string;
  stage?: OpportunityStage;
  status?: OpportunityStatus;
}

export interface SearchGroupDto {
  type: SearchResultType | AdminSearchResultType;
  label: string;
  /** Matching accessible records of this type (may exceed `items.length`). */
  total: number;
  items: SearchResultDto[];
}

export interface SearchResponseDto {
  q: string;
  groups: SearchGroupDto[];
  page: number;
  pageSize: number;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  detail: string;
  tone: 'red' | 'amber' | 'teal';
  /** Opens the record; the server rechecks access when it is followed. */
  path: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationListDto extends Paginated<NotificationDto> {
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// Email administration (CR2)
// ---------------------------------------------------------------------------

/** The mail server settings. The password itself is never returned. */
export interface EmailSettingsDto {
  enabled: boolean;
  host: string | null;
  port: number | null;
  security: EmailSecurityMode;
  username: string | null;
  /** A password is stored. */
  passwordSet: boolean;
  /** False when a stored password can no longer be decrypted (EMAIL_SECRET_KEY changed). */
  passwordReadable: boolean;
  fromName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  /** How this deployment sends, from EMAIL_TRANSPORT. */
  transport: EmailTransportKind;
  /** EMAIL_SECRET_KEY is configured, so a password can be stored. */
  canStorePassword: boolean;
  /** 0 until settings are first saved. */
  version: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface EmailTemplateDto {
  key: EmailTemplateKey;
  label: string;
  sentWhen: string;
  placeholders: string[];
  required: string[];
  subject: string;
  bodyText: string;
  enabled: boolean;
  /** False while the default wording is in use. */
  customized: boolean;
  defaultSubject: string;
  defaultBody: string;
  /** 0 while the default wording is in use. */
  version: number;
  updatedAt: string | null;
}

/** A template rendered with synthetic sample values: never real records. */
export interface EmailPreviewDto {
  subject: string;
  text: string;
}

/** One entry of the delivery log. Never the message body. */
export interface EmailDeliveryDto {
  id: string;
  templateKey: string;
  label: string;
  recipientName: string | null;
  recipientAddress: string | null;
  /**
   * `sent` means the mail server accepted the message, which does not confirm
   * it reached an inbox; `captured` marks one the development capture
   * transport wrote to a folder instead.
   */
  status: EmailDeliveryStatus;
  statusDetail: string | null;
  captured: boolean;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
}

export interface EmailTestResultDto {
  delivery: EmailDeliveryDto;
}

/**
 * A connection check (CR2): the mail server answered and accepted the sign-in,
 * or why not. Nothing is sent.
 */
export interface EmailConnectionCheckDto {
  status: 'ok' | 'failed' | 'not_sending';
  detail: string;
}

/** One saved version of an email's wording, newest first, from the administrative audit. */
export interface EmailTemplateVersionDto {
  occurredAt: string;
  actorName: string | null;
  subject: string;
  bodyText: string;
  enabled: boolean;
  /** Which fields this save changed. */
  changed: ('subject' | 'bodyText' | 'enabled')[];
}

/** At most this many administrator retries of one failed email (CR2). */
export const EMAIL_MANUAL_RETRY_LIMIT = 3;
