/**
 * Tender and document badges for API mode, visually identical to the approved
 * demo badges. The deadline indicator is decided by the server against the
 * real clock (FR-052); these only present it.
 */
import {
  BID_STATUS_LABELS,
  NOTICE_STATE_LABELS,
  type BidStatus,
  type NoticeState,
  type ScanState,
  type TenderIndicator,
} from '../../../shared/enums.js';

const pill =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

export function BidStatusBadge({ status }: { status: BidStatus }) {
  const tone =
    status === 'submitted'
      ? 'bg-green-50 text-green-700 ring-green-600/20'
      : status === 'preparing'
        ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
        : 'bg-slate-100 text-slate-600 ring-slate-500/15';
  return <span className={`${pill} ${tone}`}>{BID_STATUS_LABELS[status]}</span>;
}

const INDICATOR_STYLES: Record<TenderIndicator, { label: string; tone: string; dot: string }> = {
  missed: { label: 'Deadline missed', tone: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-600' },
  due_soon: { label: 'Due within 72 hours', tone: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  upcoming: { label: 'Upcoming', tone: 'bg-slate-100 text-slate-600 ring-slate-500/15', dot: 'bg-slate-400' },
  submitted: { label: 'Submitted', tone: 'bg-green-50 text-green-700 ring-green-600/20', dot: 'bg-green-600' },
  not_participating: { label: 'Not participating', tone: 'bg-slate-50 text-slate-500 ring-slate-400/20', dot: 'bg-slate-300' },
  inactive: { label: 'No alert', tone: 'bg-slate-50 text-slate-500 ring-slate-400/20', dot: 'bg-slate-300' },
};

export function TenderIndicatorBadge({ indicator }: { indicator: TenderIndicator }) {
  const style = INDICATOR_STYLES[indicator];
  return (
    <span className={`${pill} ${style.tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}

/** FR-052: the text that explains each colour, shown wherever the colours are. */
const TENDER_LEGEND: [string, string][] = [
  ['bg-red-600', 'Red — deadline passed, bid not submitted'],
  ['bg-amber-500', 'Amber — due within 72 hours'],
  ['bg-slate-400', 'Neutral — later deadline'],
  ['bg-green-600', 'Green — submitted'],
  ['bg-slate-300', 'Grey — not participating, or notice superseded or cancelled'],
];

export function TenderLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500" aria-label="Deadline colour key">
      {TENDER_LEGEND.map(([dot, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function NoticeStateBadge({ state }: { state: NoticeState }) {
  const tone =
    state === 'current'
      ? 'bg-brand-light text-brand-dark ring-brand/20'
      : state === 'cancelled'
        ? 'bg-slate-50 text-slate-500 ring-slate-400/30'
        : 'bg-slate-100 text-slate-600 ring-slate-500/15';
  return <span className={`${pill} ${tone}`}>{NOTICE_STATE_LABELS[state]}</span>;
}

const SCAN_STYLES: Record<ScanState, { label: string; tone: string }> = {
  pending: { label: 'Awaiting scan', tone: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  clean: { label: 'Scanned', tone: 'bg-green-50 text-green-700 ring-green-600/20' },
  infected: { label: 'Rejected by scan', tone: 'bg-red-50 text-red-700 ring-red-600/20' },
  failed: { label: 'Scan failed', tone: 'bg-red-50 text-red-700 ring-red-600/20' },
};

export function ScanStateBadge({ state, scanner }: { state: ScanState; scanner: string | null }) {
  const style = SCAN_STYLES[state];
  const testScan = scanner === 'test-scanner';
  return (
    <span
      className={`${pill} ${style.tone}`}
      title={testScan ? 'Checked by the development test scanner. This is not malware scanning.' : undefined}
    >
      {style.label}
      {testScan && state !== 'pending' ? ' (test scanner)' : ''}
    </span>
  );
}
