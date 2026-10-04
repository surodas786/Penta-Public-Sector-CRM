/**
 * Badges for API-mode enums.
 *
 * Visually identical to the approved demo badges (same pill, same tones); they
 * exist separately because API records carry snake_case stage plus an
 * independent status, while the demo's badges take a single combined label.
 */
import {
  PRIORITY_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  boardLaneLabel,
  type OpportunityStage,
  type OpportunityStatus,
  type Priority,
} from '../../../shared/enums.js';

const pill =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

/**
 * D-001: one lane per record. On Hold and Cancelled take precedence visually
 * while the pipeline stage stays stored underneath and is shown alongside.
 */
export function StageBadge({ stage, status }: { stage: OpportunityStage; status: OpportunityStatus }) {
  const label = boardLaneLabel(stage, status);
  const tone =
    status === 'on_hold'
      ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
      : status === 'cancelled'
        ? 'bg-slate-50 text-slate-500 ring-slate-400/30'
        : stage === 'awarded'
          ? 'bg-green-50 text-green-700 ring-green-600/20'
          : stage === 'lost'
            ? 'bg-slate-100 text-slate-600 ring-slate-500/20'
            : 'bg-brand-light text-brand-dark ring-brand/20';
  return <span className={`${pill} ${tone}`}>{label}</span>;
}

/** Shown next to the lane badge when a held or cancelled record retains a stage. */
export function RetainedStageNote({
  stage,
  status,
}: {
  stage: OpportunityStage;
  status: OpportunityStatus;
}) {
  if (status === 'active') return null;
  return (
    <span className="text-[11px] text-slate-500">
      {STATUS_LABELS[status]} — stage retained as {STAGE_LABELS[stage]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const tone =
    priority === 'high'
      ? 'bg-red-50 text-red-700 ring-red-600/15'
      : priority === 'medium'
        ? 'bg-amber-50 text-amber-700 ring-amber-600/15'
        : 'bg-slate-100 text-slate-600 ring-slate-500/15';
  return <span className={`${pill} ${tone}`}>{PRIORITY_LABELS[priority]}</span>;
}

/** Overdue is decided against today's Dhaka date, matching the server (FR-043). */
export function DueTag({ dueDate, today }: { dueDate: string; today: string }) {
  if (!dueDate) return null;
  const tone =
    dueDate < today
      ? ['bg-red-50 text-red-700 ring-red-600/20', 'Overdue']
      : dueDate === today
        ? ['bg-amber-50 text-amber-700 ring-amber-600/20', 'Due today']
        : ['bg-slate-100 text-slate-600 ring-slate-500/15', 'Upcoming'];
  return <span className={`${pill} rounded ${tone[0]}`}>{tone[1]}</span>;
}

/**
 * Initials avatar. Visually identical to the demo's, but defined here so the
 * API build does not import the demo badge module, which transitively pulls in
 * the fixed demo clock (NFR-001).
 */
export function Avatar({
  name,
  size = 'sm',
  tone = 'teal',
}: {
  name: string;
  size?: 'sm' | 'md';
  tone?: 'teal' | 'navy';
}) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const sizeClass = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  const toneClass = tone === 'navy' ? 'bg-navy text-white' : 'bg-brand-light text-brand-dark';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${sizeClass} ${toneClass}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
