/**
 * Canonical enum values shared by the database, the API and the browser.
 *
 * Storage values are snake_case and stable; display labels reproduce the
 * approved demo wording (FR-010). Never persist a label.
 */

export const OPPORTUNITY_STAGES = [
  'identified',
  'initial_engagement',
  'requirements_discussion',
  'awaiting_tender',
  'tender_published',
  'bid_preparation',
  'bid_submitted',
  'evaluation',
  'awarded',
  'lost',
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  identified: 'Identified',
  initial_engagement: 'Initial Engagement',
  requirements_discussion: 'Requirements Discussion',
  awaiting_tender: 'Awaiting Tender',
  tender_published: 'Tender Published',
  bid_preparation: 'Bid Preparation',
  bid_submitted: 'Bid Submitted',
  evaluation: 'Evaluation',
  awarded: 'Awarded',
  lost: 'Lost',
};

/** BR-010: Awarded and Lost are terminal regardless of status. */
export const TERMINAL_STAGES: readonly OpportunityStage[] = ['awarded', 'lost'];

export function isTerminalStage(stage: OpportunityStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

/** The eight working stages, in pipeline order. Skips and backward moves are measured against this. */
export const PIPELINE_STAGES = OPPORTUNITY_STAGES.filter(
  (stage) => !TERMINAL_STAGES.includes(stage),
) as readonly OpportunityStage[];

/**
 * BR-011: the preset lost reasons. `other` requires explanatory text.
 * `not_shortlisted` (CR6) is offered when a Software Procurement cycle ends
 * at its EOI; it is an ordinary reason, open to any record.
 */
export const LOSS_REASONS = [
  'price',
  'technical_eligibility',
  'competitor_selected',
  'budget_unavailable',
  'no_bid',
  'not_shortlisted',
  'other',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  price: 'Price',
  technical_eligibility: 'Technical eligibility',
  competitor_selected: 'Competitor selected',
  budget_unavailable: 'Budget unavailable',
  no_bid: 'No bid',
  not_shortlisted: 'Not shortlisted',
  other: 'Other',
};

export type StageMoveKind = 'same' | 'forward' | 'skip' | 'backward' | 'outcome';

/**
 * Classifies a stage change between two stages (FR-021).
 *
 *   forward   the next pipeline stage; no explanation needed
 *   skip      forward by more than one stage; explanation required
 *   backward  any earlier pipeline stage; explanation required
 *   outcome   to Awarded or Lost, which have their own required fields
 *             (BR-011) rather than a skip explanation
 *
 * Moves out of a terminal stage are reopenings, decided separately (BR-012).
 */
export function classifyStageMove(from: OpportunityStage, to: OpportunityStage): StageMoveKind {
  if (from === to) return 'same';
  if (isTerminalStage(to)) return 'outcome';
  const fromIndex = PIPELINE_STAGES.indexOf(from);
  const toIndex = PIPELINE_STAGES.indexOf(to);
  if (toIndex < fromIndex) return 'backward';
  return toIndex - fromIndex === 1 ? 'forward' : 'skip';
}

export const OPPORTUNITY_STATUSES = ['active', 'on_hold', 'cancelled'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
};

/**
 * D-001: the approved board keeps visible On Hold and Cancelled lanes while
 * stage and status are stored separately. A record appears in exactly one lane,
 * and returning from hold restores its stored stage.
 */
export function boardLaneLabel(stage: OpportunityStage, status: OpportunityStatus): string {
  if (status === 'on_hold') return STATUS_LABELS.on_hold;
  if (status === 'cancelled') return STATUS_LABELS.cancelled;
  return STAGE_LABELS[stage];
}

/**
 * Active pipeline population (FR §10.1): status Active and stage neither
 * Awarded nor Lost. On Hold and Cancelled are excluded (D-002).
 */
export function isActivePipeline(stage: OpportunityStage, status: OpportunityStatus): boolean {
  return status === 'active' && !isTerminalStage(stage);
}

/**
 * Kanban lanes (D-001): the ten stages plus the On Hold and Cancelled status
 * lanes. A record sits in exactly one lane, chosen by `boardLane`.
 */
export const BOARD_LANES = [...OPPORTUNITY_STAGES, 'on_hold', 'cancelled'] as const;
export type BoardLane = (typeof BOARD_LANES)[number];

export function boardLane(stage: OpportunityStage, status: OpportunityStatus): BoardLane {
  if (status === 'on_hold' || status === 'cancelled') return status;
  return stage;
}

export function boardLaneTitle(lane: BoardLane): string {
  if (lane === 'on_hold' || lane === 'cancelled') return STATUS_LABELS[lane];
  return STAGE_LABELS[lane];
}

export const SOLUTION_CATEGORIES = [
  'erp',
  'custom_software',
  'data_platform_analytics',
  'cloud_infrastructure',
  'cybersecurity',
  'system_integration',
  'amc_renewal',
  'other',
] as const;
export type SolutionCategory = (typeof SOLUTION_CATEGORIES)[number];

export const SOLUTION_CATEGORY_LABELS: Record<SolutionCategory, string> = {
  erp: 'ERP',
  custom_software: 'Custom Software',
  data_platform_analytics: 'Data Platform & Analytics',
  cloud_infrastructure: 'Cloud & Infrastructure',
  cybersecurity: 'Cybersecurity',
  system_integration: 'System Integration',
  amc_renewal: 'AMC / Renewal',
  other: 'Other',
};

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const USER_ROLES = ['management', 'lead', 'sales', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  management: 'Management',
  lead: 'Section Lead',
  sales: 'Salesperson',
  admin: 'System Administrator',
};

export const ORGANIZATION_TYPES = [
  'ministry',
  'department',
  'directorate',
  'authority',
  'public_corporation',
  'local_government',
  'other',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  ministry: 'Ministry',
  department: 'Department',
  directorate: 'Directorate',
  authority: 'Authority',
  public_corporation: 'Public Corporation',
  local_government: 'Local Government',
  other: 'Other',
};

export const FOLLOW_UP_STATES = ['open', 'completed', 'cancelled'] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];

export const FOLLOW_UP_STATE_LABELS: Record<FollowUpState, string> = {
  open: 'Open',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Business timezone for every date-only calculation (FR-080). */
export const BUSINESS_TIME_ZONE = 'Asia/Dhaka';

/** §20 requires this wording instead of the ambiguous "BST". */
export const BUSINESS_TIME_LABEL = 'Bangladesh time (UTC+6)';

/** FR-040. "Email" is a manual log of an email, never a sent message. */
export const ACTIVITY_TYPES = [
  'meeting',
  'phone_call',
  'email',
  'office_visit',
  'internal_discussion',
  'other',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  meeting: 'Meeting',
  phone_call: 'Phone Call',
  email: 'Email',
  office_visit: 'Office Visit',
  internal_discussion: 'Internal Discussion',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Tenders and documents (Milestone 5)
// ---------------------------------------------------------------------------

export const BID_STATUSES = ['reviewing', 'preparing', 'submitted', 'not_participating'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const BID_STATUS_LABELS: Record<BidStatus, string> = {
  reviewing: 'Reviewing',
  preparing: 'Preparing',
  submitted: 'Submitted',
  not_participating: 'Not Participating',
};

/** FR-050: a production addition. Superseded and cancelled notices raise no deadline alerts. */
export const NOTICE_STATES = ['current', 'superseded', 'cancelled'] as const;
export type NoticeState = (typeof NOTICE_STATES)[number];

export const NOTICE_STATE_LABELS: Record<NoticeState, string> = {
  current: 'Current',
  superseded: 'Superseded',
  cancelled: 'Cancelled',
};

/**
 * FR-052 deadline indicator, decided by the server against the real clock:
 *   missed       current, participating, deadline passed, not submitted (red)
 *   due_soon     the same, deadline within 72 hours (amber)
 *   upcoming     the same, later deadline (neutral)
 *   submitted    bid submitted (green)
 *   not_participating, inactive (superseded or cancelled notice): grey
 */
export const TENDER_INDICATORS = ['missed', 'due_soon', 'upcoming', 'submitted', 'not_participating', 'inactive'] as const;
export type TenderIndicator = (typeof TENDER_INDICATORS)[number];

export const DOCUMENT_CATEGORIES = [
  'tender_document',
  'requirements',
  'meeting_notes',
  'proposal',
  'correspondence',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  tender_document: 'Tender Document',
  requirements: 'Requirements',
  meeting_notes: 'Meeting Notes',
  proposal: 'Proposal',
  correspondence: 'Correspondence',
  other: 'Other',
};

/**
 * SEC-010: a file is downloadable only when `clean`. `pending` covers both
 * "being scanned" and "no scanner available"; `infected` is rejected;
 * `failed` means the scanner could not decide.
 */
export const SCAN_STATES = ['pending', 'clean', 'infected', 'failed'] as const;
export type ScanState = (typeof SCAN_STATES)[number];

/**
 * FR-051: Mark Submitted offers "move to Bid Submitted" only while the
 * opportunity is active and at an earlier pipeline stage. It never offers a
 * move backwards and never Awarded.
 */
export function offersBidSubmittedStage(stage: OpportunityStage, status: OpportunityStatus): boolean {
  const index = PIPELINE_STAGES.indexOf(stage);
  return status === 'active' && index >= 0 && index < PIPELINE_STAGES.indexOf('bid_submitted');
}

/** FR-052: amber means a deadline within this many hours. */
export const TENDER_DUE_SOON_HOURS = 72;

export const TENDER_INDICATOR_LABELS: Record<TenderIndicator, string> = {
  missed: 'Deadline passed, not submitted',
  due_soon: 'Due within 72 hours',
  upcoming: 'Due later',
  submitted: 'Submitted',
  not_participating: 'Not participating',
  inactive: 'No alert: notice superseded or cancelled, or opportunity closed',
};

// ---------------------------------------------------------------------------
// Stored enum values (database only)
// ---------------------------------------------------------------------------

/**
 * The `opportunity_stage` and `notice_state` types as stored. Migration 0010
 * added Software Procurement stages to the pipeline and a `closed` notice
 * state; 0011 retired them when CR6 moved to its own procurement cycles.
 * PostgreSQL cannot drop enum values, so they remain in the types, unused, and
 * CHECK constraints refuse them. Only the schema declares these lists; every
 * other module uses OPPORTUNITY_STAGES and NOTICE_STATES.
 */
export const STORED_OPPORTUNITY_STAGES = [
  'identified',
  'initial_engagement',
  'requirements_discussion',
  'awaiting_tender',
  'tender_published',
  'bid_preparation',
  'bid_submitted',
  'evaluation',
  'eoi_published',
  'eoi_submitted',
  'shortlisted',
  'rfp_issued',
  'proposal_preparation',
  'proposal_submitted',
  'technical_evaluation',
  'financial_evaluation',
  'awarded',
  'lost',
] as const;

export const STORED_NOTICE_STATES = [...NOTICE_STATES, 'closed'] as const;

// ---------------------------------------------------------------------------
// Software Procurement: EOI then RFP (CR6)
// ---------------------------------------------------------------------------

/**
 * How a procurement reached the RFP. `direct_rfp` is the documented,
 * management-only exception for an RFP invitation without an EOI; it never
 * carries an EOI.
 */
export const PROCUREMENT_ROUTES = ['eoi_rfp', 'direct_rfp'] as const;
export type ProcurementRoute = (typeof PROCUREMENT_ROUTES)[number];

export const PROCUREMENT_ROUTE_LABELS: Record<ProcurementRoute, string> = {
  eoi_rfp: 'EOI then RFP',
  direct_rfp: 'Direct RFP (management exception)',
};

/**
 * A cycle's milestones. Kept apart from the opportunity pipeline: reaching a
 * milestone never moves the opportunity; a matching pipeline change is only
 * offered (PROCUREMENT_PIPELINE_OFFERS).
 */
export const PROCUREMENT_MILESTONES = [
  'eoi_preparation',
  'eoi_submitted',
  'shortlisted',
  'not_shortlisted',
  'rfp_received',
  'proposal_preparation',
  'proposal_submitted',
  'evaluation',
  'awarded',
  'unsuccessful',
  'cancelled',
] as const;
export type ProcurementMilestone = (typeof PROCUREMENT_MILESTONES)[number];

export const PROCUREMENT_MILESTONE_LABELS: Record<ProcurementMilestone, string> = {
  eoi_preparation: 'EOI preparation',
  eoi_submitted: 'EOI submitted',
  shortlisted: 'Shortlisted',
  not_shortlisted: 'Not shortlisted',
  rfp_received: 'RFP received',
  proposal_preparation: 'Proposal preparation',
  proposal_submitted: 'Proposal submitted',
  evaluation: 'Evaluation',
  awarded: 'Awarded',
  unsuccessful: 'Unsuccessful',
  cancelled: 'Cancelled',
};

/** A cycle that has ended. */
export const CLOSED_MILESTONES: readonly ProcurementMilestone[] = ['not_shortlisted', 'awarded', 'unsuccessful', 'cancelled'];

/** The EOI part of a cycle, before shortlisting is known. */
export const EOI_MILESTONES: readonly ProcurementMilestone[] = ['eoi_preparation', 'eoi_submitted', 'shortlisted', 'not_shortlisted'];

/** The RFP part: these need the RFP's reference, invitation date and proposal deadline. */
export const RFP_MILESTONES: readonly ProcurementMilestone[] = [
  'rfp_received',
  'proposal_preparation',
  'proposal_submitted',
  'evaluation',
  'awarded',
  'unsuccessful',
];

/** These need the proposal (or both its parts) submitted. */
export const PROPOSAL_SUBMITTED_MILESTONES: readonly ProcurementMilestone[] = ['proposal_submitted', 'evaluation', 'awarded', 'unsuccessful'];

/** The working order of a cycle on each route; endings are reached from it. */
export const PROCUREMENT_SEQUENCE: Record<ProcurementRoute, readonly ProcurementMilestone[]> = {
  eoi_rfp: ['eoi_preparation', 'eoi_submitted', 'shortlisted', 'rfp_received', 'proposal_preparation', 'proposal_submitted', 'evaluation'],
  direct_rfp: ['rfp_received', 'proposal_preparation', 'proposal_submitted', 'evaluation'],
};

export function isClosedMilestone(milestone: ProcurementMilestone): boolean {
  return CLOSED_MILESTONES.includes(milestone);
}

/**
 * Where a cycle may go next: any later working milestone on its route (the
 * fields a milestone needs are checked separately), Not shortlisted once the
 * EOI is submitted, Awarded or Unsuccessful once the proposal is submitted,
 * and Cancelled from any open milestone. Never backwards; never out of an
 * ending.
 */
export function nextMilestones(route: ProcurementRoute, current: ProcurementMilestone): ProcurementMilestone[] {
  if (isClosedMilestone(current)) return [];
  const sequence = PROCUREMENT_SEQUENCE[route];
  const index = sequence.indexOf(current);
  const later = sequence.slice(index + 1);
  const endings: ProcurementMilestone[] = [];
  if (current === 'eoi_submitted') endings.push('not_shortlisted');
  if (current === 'proposal_submitted' || current === 'evaluation') endings.push('awarded', 'unsuccessful');
  return [...later, ...endings, 'cancelled'];
}

/**
 * The opportunity pipeline change a milestone may offer (never applied
 * without the user's explicit choice, and then under the usual stage rules:
 * Awarded needs its value and date, Lost its reason).
 */
export const PROCUREMENT_PIPELINE_OFFERS: Partial<Record<ProcurementMilestone, OpportunityStage>> = {
  rfp_received: 'tender_published',
  proposal_preparation: 'bid_preparation',
  proposal_submitted: 'bid_submitted',
  evaluation: 'evaluation',
  awarded: 'awarded',
  unsuccessful: 'lost',
  not_shortlisted: 'lost',
};

export const PROPOSAL_FORMATS = ['single', 'separate'] as const;
export type ProposalFormat = (typeof PROPOSAL_FORMATS)[number];

export const PROPOSAL_FORMAT_LABELS: Record<ProposalFormat, string> = {
  single: 'One proposal',
  separate: 'Separate technical and financial proposals',
};

export const PARTICIPATION_DECISIONS = ['undecided', 'participating', 'not_participating'] as const;
export type ParticipationDecision = (typeof PARTICIPATION_DECISIONS)[number];

export const PARTICIPATION_DECISION_LABELS: Record<ParticipationDecision, string> = {
  undecided: 'Not decided',
  participating: 'Participating',
  not_participating: 'Not participating',
};

export const EOI_OUTCOMES = ['shortlisted', 'not_shortlisted'] as const;
export type EoiOutcome = (typeof EOI_OUTCOMES)[number];

/** The cycle documents a link can name; each is one of the opportunity's own documents. */
export const PROCUREMENT_DOCUMENT_ROLES = ['eoi', 'shortlist', 'rfp', 'proposal', 'decision'] as const;
export type ProcurementDocumentRole = (typeof PROCUREMENT_DOCUMENT_ROLES)[number];

export const PROCUREMENT_DOCUMENT_ROLE_LABELS: Record<ProcurementDocumentRole, string> = {
  eoi: 'EOI',
  shortlist: 'Shortlist',
  rfp: 'RFP',
  proposal: 'Proposal',
  decision: 'Decision',
};

/**
 * The deadline indicator for a cycle, decided by the server against the real
 * clock, like FR-052 for tenders: the deadline that matters now is the EOI
 * deadline until the EOI is submitted, then the proposal deadline until the
 * proposal is submitted.
 */
export const PROCUREMENT_INDICATORS = ['missed', 'due_soon', 'upcoming', 'submitted', 'no_deadline', 'closed'] as const;
export type ProcurementIndicator = (typeof PROCUREMENT_INDICATORS)[number];

export const PROCUREMENT_INDICATOR_LABELS: Record<ProcurementIndicator, string> = {
  missed: 'Deadline passed, not submitted',
  due_soon: 'Due within 72 hours',
  upcoming: 'Due later',
  submitted: 'Submitted, awaiting the next step',
  no_deadline: 'No deadline recorded yet',
  closed: 'Cycle ended',
};
