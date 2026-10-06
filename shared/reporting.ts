/**
 * Dashboards, reports, exports, search and notifications (Milestone 6).
 *
 * Shared by the server and the browser so a report's name, its date basis and
 * its columns are defined once (FR-081, FR-082, BR-060).
 */

// ---------------------------------------------------------------------------
// Dashboard date range (the approved filter; FR-080 uses the real clock)
// ---------------------------------------------------------------------------

export const DASHBOARD_RANGES = ['all', 'last30', 'quarter', 'year'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  last30: 'Last 30 days',
  quarter: 'This quarter',
  year: 'This year',
  all: 'All time',
};

// ---------------------------------------------------------------------------
// Date bases (BR-060): every date filter names the date it applies to
// ---------------------------------------------------------------------------

export const DATE_BASES = [
  'opportunity_created',
  'expected_award',
  'activity_occurred',
  'follow_up_due',
  'tender_deadline',
  'outcome_date',
  'lost_date',
] as const;
export type DateBasis = (typeof DATE_BASES)[number];

export const DATE_BASIS_LABELS: Record<DateBasis, string> = {
  opportunity_created: 'Opportunity created date',
  expected_award: 'Expected award date',
  activity_occurred: 'Activity date',
  follow_up_due: 'Follow-up due date',
  tender_deadline: 'Tender submission deadline',
  outcome_date: 'Award date (Awarded) or lost date (Lost)',
  lost_date: 'Lost date',
};

// ---------------------------------------------------------------------------
// Reports (FR-082). Names follow the approved prototype (§20).
// ---------------------------------------------------------------------------

export const REPORT_KEYS = [
  'pipeline',
  'section_owner',
  'overdue_follow_ups',
  'upcoming_tenders',
  'outcomes',
  'lost_reasons',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export interface ReportDefinition {
  key: ReportKey;
  label: string;
  dateBasis: DateBasis;
}

export const REPORTS: readonly ReportDefinition[] = [
  { key: 'pipeline', label: 'Pipeline by stage', dateBasis: 'opportunity_created' },
  { key: 'section_owner', label: 'Opportunities by section and owner', dateBasis: 'opportunity_created' },
  { key: 'overdue_follow_ups', label: 'Overdue follow-ups', dateBasis: 'follow_up_due' },
  { key: 'upcoming_tenders', label: 'Upcoming tender submissions', dateBasis: 'tender_deadline' },
  { key: 'outcomes', label: 'Awarded and lost opportunities', dateBasis: 'outcome_date' },
  { key: 'lost_reasons', label: 'Lost reasons', dateBasis: 'lost_date' },
];

export function reportDefinition(key: ReportKey): ReportDefinition {
  return REPORTS.find((report) => report.key === key) as ReportDefinition;
}

/** A CSV export is either one of the reports or the filtered opportunity list. */
export const EXPORT_KINDS = [...REPORT_KEYS, 'opportunities'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  ...(Object.fromEntries(REPORTS.map((report) => [report.key, report.label])) as Record<ReportKey, string>),
  opportunities: 'Opportunities',
};

/**
 * Column kinds decide alignment on screen and encoding in CSV: money is an
 * unformatted decimal string (FR-083), instants are ISO 8601 with the Dhaka
 * offset, and only `text` cells — the user-entered ones — can carry a formula.
 */
export type ReportColumnKind = 'text' | 'count' | 'money' | 'date' | 'instant' | 'percent';

export const EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Search (FR-091)
// ---------------------------------------------------------------------------

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_RESULT_TYPES = ['opportunity', 'tender', 'contact', 'organization'] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export const ADMIN_SEARCH_RESULT_TYPES = ['account', 'section'] as const;
export type AdminSearchResultType = (typeof ADMIN_SEARCH_RESULT_TYPES)[number];

export const SEARCH_GROUP_LABELS: Record<SearchResultType | AdminSearchResultType, string> = {
  opportunity: 'Opportunities',
  tender: 'Tenders',
  contact: 'Contacts',
  organization: 'Organizations',
  account: 'Accounts',
  section: 'Sections',
};

// ---------------------------------------------------------------------------
// Notifications (FR-090, BR-070)
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  'follow_up_due_today',
  'follow_up_overdue',
  'tender_deadline',
  'ownership_changed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  follow_up_due_today: 'Follow-up due today',
  follow_up_overdue: 'Overdue follow-up',
  tender_deadline: 'Tender deadline within 72 hours',
  ownership_changed: 'Ownership changed',
};
