/**
 * Software Procurement badges (CR6), in the same pill style as the tender
 * badges. The deadline indicator is decided by the server against the real
 * clock; these only present it.
 */
import {
  PROCUREMENT_MILESTONE_LABELS,
  PROCUREMENT_ROUTE_LABELS,
  isClosedMilestone,
  type ProcurementIndicator,
  type ProcurementMilestone,
  type ProcurementRoute,
} from '../../../shared/enums.js';

const pill =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

export function MilestoneBadge({ milestone }: { milestone: ProcurementMilestone }) {
  const tone =
    milestone === 'awarded'
      ? 'bg-green-50 text-green-700 ring-green-600/20'
      : milestone === 'not_shortlisted' || milestone === 'unsuccessful'
        ? 'bg-red-50 text-red-700 ring-red-600/20'
        : isClosedMilestone(milestone)
          ? 'bg-slate-50 text-slate-500 ring-slate-400/30'
          : 'bg-brand-light text-brand-dark ring-brand/20';
  return <span className={`${pill} ${tone}`}>{PROCUREMENT_MILESTONE_LABELS[milestone]}</span>;
}

export function RouteBadge({ route }: { route: ProcurementRoute }) {
  const tone = route === 'direct_rfp' ? 'bg-amber-50 text-amber-800 ring-amber-600/20' : 'bg-slate-100 text-slate-600 ring-slate-500/15';
  return <span className={`${pill} ${tone}`}>{PROCUREMENT_ROUTE_LABELS[route]}</span>;
}

const INDICATOR_STYLES: Record<ProcurementIndicator, { label: string; tone: string; dot: string }> = {
  missed: { label: 'Deadline missed', tone: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-600' },
  due_soon: { label: 'Due within 72 hours', tone: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  upcoming: { label: 'Upcoming', tone: 'bg-slate-100 text-slate-600 ring-slate-500/15', dot: 'bg-slate-400' },
  submitted: { label: 'Submitted', tone: 'bg-green-50 text-green-700 ring-green-600/20', dot: 'bg-green-600' },
  no_deadline: { label: 'No deadline yet', tone: 'bg-slate-50 text-slate-500 ring-slate-400/20', dot: 'bg-slate-300' },
  closed: { label: 'No alert', tone: 'bg-slate-50 text-slate-500 ring-slate-400/20', dot: 'bg-slate-300' },
};

export function ProcurementIndicatorBadge({ indicator }: { indicator: ProcurementIndicator }) {
  const style = INDICATOR_STYLES[indicator];
  return (
    <span className={`${pill} ${style.tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}

const LEGEND: [string, string][] = [
  ['bg-red-600', 'Red — EOI or proposal deadline passed, not submitted'],
  ['bg-amber-500', 'Amber — due within 72 hours'],
  ['bg-slate-400', 'Neutral — later deadline'],
  ['bg-green-600', 'Green — submitted, awaiting the next step'],
  ['bg-slate-300', 'Grey — no deadline yet, cycle ended or replaced, not participating, or opportunity closed'],
];

export function ProcurementLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500" aria-label="Deadline colour key">
      {LEGEND.map(([dot, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
