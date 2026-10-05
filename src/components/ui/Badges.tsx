import type { BidStatus, Priority, Stage, Tender } from '../../types/crm';
import { dueState, tenderIndicator, type TenderIndicatorKind } from '../../utils/metrics';

const pill = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

export function StageBadge({ stage }: {stage: Stage;}) {
  const tone =
  stage === 'Awarded' ?
  'bg-green-50 text-green-700 ring-green-600/20' :
  stage === 'Lost' ?
  'bg-slate-100 text-slate-600 ring-slate-500/20' :
  stage === 'Cancelled' ?
  'bg-slate-50 text-slate-500 ring-slate-400/30' :
  stage === 'On Hold' ?
  'bg-amber-50 text-amber-700 ring-amber-600/20' :
  'bg-brand-light text-brand-dark ring-brand/20';
  return <span className={`${pill} ${tone}`}>{stage}</span>;
}

export function PriorityBadge({ priority }: {priority: Priority;}) {
  const tone =
  priority === 'High' ?
  'bg-red-50 text-red-700 ring-red-600/15' :
  priority === 'Medium' ?
  'bg-amber-50 text-amber-700 ring-amber-600/15' :
  'bg-slate-100 text-slate-600 ring-slate-500/15';
  return <span className={`${pill} ${tone}`}>{priority}</span>;
}

export function DueTag({ date }: {date: string;}) {
  if (!date) return null;
  const s = dueState(date);
  const map = {
    overdue: ['bg-red-50 text-red-700 ring-red-600/20', 'Overdue'],
    today: ['bg-amber-50 text-amber-700 ring-amber-600/20', 'Due today'],
    upcoming: ['bg-slate-100 text-slate-600 ring-slate-500/15', 'Upcoming']
  } as const;
  const [tone, label] = map[s];
  return <span className={`${pill} rounded ${tone}`}>{label}</span>;
}

const INDICATORS: Record<TenderIndicatorKind, {label: string;tone: string;dot: string;}> = {
  missed: { label: 'Deadline missed', tone: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-600' },
  'due-soon': { label: 'Due within 3 days', tone: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  neutral: { label: 'Upcoming', tone: 'bg-slate-100 text-slate-600 ring-slate-500/15', dot: 'bg-slate-400' },
  submitted: { label: 'Submitted', tone: 'bg-green-50 text-green-700 ring-green-600/20', dot: 'bg-green-600' },
  'not-participating': { label: 'Not participating', tone: 'bg-slate-50 text-slate-500 ring-slate-400/20', dot: 'bg-slate-300' }
};

export function TenderIndicator({ tender }: {tender: Tender;}) {
  const ind = INDICATORS[tenderIndicator(tender)];
  return (
    <span className={`${pill} ${ind.tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ind.dot}`} aria-hidden="true" />
      {ind.label}
    </span>);

}

export function indicatorDotClass(tender: Tender): string {
  return INDICATORS[tenderIndicator(tender)].dot;
}

export function BidStatusBadge({ status }: {status: BidStatus;}) {
  const tone =
  status === 'Submitted' ?
  'bg-green-50 text-green-700 ring-green-600/20' :
  status === 'Preparing' ?
  'bg-amber-50 text-amber-700 ring-amber-600/20' :
  'bg-slate-100 text-slate-600 ring-slate-500/15';
  return <span className={`${pill} ${tone}`}>{status}</span>;
}

export function Avatar({ name, size = 'sm', tone = 'teal' }: {name: string;size?: 'sm' | 'md';tone?: 'teal' | 'navy';}) {
  const initials = name.
  split(' ').
  filter(Boolean).
  slice(0, 2).
  map((p) => p[0]).
  join('').
  toUpperCase();
  const sz = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  const t = tone === 'navy' ? 'bg-navy text-white' : 'bg-brand-light text-brand-dark';
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${sz} ${t}`} aria-hidden="true">
      {initials}
    </span>);

}