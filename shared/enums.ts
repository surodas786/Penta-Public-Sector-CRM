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
