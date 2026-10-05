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

/** BR-011: the six preset lost reasons. `other` requires explanatory text. */
export const LOSS_REASONS = [
  'price',
  'technical_eligibility',
  'competitor_selected',
  'budget_unavailable',
  'no_bid',
  'other',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  price: 'Price',
  technical_eligibility: 'Technical eligibility',
  competitor_selected: 'Competitor selected',
  budget_unavailable: 'Budget unavailable',
  no_bid: 'No bid',
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
