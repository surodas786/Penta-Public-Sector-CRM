/**
 * Dashboard widgets for API mode.
 *
 * The approved prototype's KPI row, stage chart, workload table, section bars
 * and lists (src/components/dashboard), with the same markup and classes,
 * fed by the server's scoped aggregates instead of browser-side arrays. They
 * are separate copies because the originals take demo types and decide
 * "overdue" against the fixed demo date; here every state comes from the
 * server, against the real Dhaka date (FR-080). Money stays a decimal string
 * and becomes a number only for bar geometry.
 */
import { motion } from 'framer-motion';

import type {
  DashboardActivityDto,
  DashboardNextActionDto,
  DashboardSectionDto,
  DashboardStageDto,
  DashboardTenderDto,
  DashboardWorkloadRowDto,
} from '../../../../shared/api.js';
import { ACTIVITY_TYPE_LABELS, STAGE_LABELS, type OpportunityStage } from '../../../../shared/enums.js';
import { formatBdt, formatBdtShort, toPaisa } from '../../../../shared/money.js';
import { EmptyState } from '../../../components/ui/Feedback';
import { Avatar } from '../../ui/ApiBadges.js';
import { formatCalendarDate, formatInstantCompact } from '../../ui/dates.js';
import { BidStatusBadge, TenderIndicatorBadge } from '../../ui/TenderBadges.js';

/** Display boundary only: bar lengths need a number (plan 4.2). */
const displayNumber = (value: string) => Number(toPaisa(value)) / 100;

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

export type KpiTarget = 'pipeline' | 'active' | 'overdue' | 'tenders' | 'awarded';

const ACCENT = {
  teal: 'border-l-brand',
  red: 'border-l-red-600',
  amber: 'border-l-amber-500',
  green: 'border-l-green-600',
};

function KpiCard({
  label,
  value,
  note,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  accent: keyof typeof ACCENT;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col justify-center rounded-lg border border-l-[3px] border-slate-200 bg-white px-3.5 py-3 text-left transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${ACCENT[accent]}`}
    >
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="mt-1 text-[22px] font-bold tabular-nums text-slate-900">{value}</span>
      <span className="mt-0.5 text-[11px] text-slate-500">{note}</span>
    </button>
  );
}

export function KpiRow({
  pipelineValue,
  activeCount,
  overdueCount,
  overdueOnHold,
  tendersDue7,
  awardedQuarter,
  quarterLabel,
  scopeNote,
  onOpen,
}: {
  pipelineValue: string;
  activeCount: number;
  overdueCount: number;
  overdueOnHold: number;
  tendersDue7: number;
  awardedQuarter: string;
  quarterLabel: string;
  scopeNote: string;
  onOpen: (target: KpiTarget) => void;
}) {
  const overdueNote = [overdueCount ? 'Needs attention' : 'All caught up', overdueOnHold ? `+${overdueOnHold} on On Hold records` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[1.9fr_1fr_1fr_1fr_1fr]">
      <button
        type="button"
        onClick={() => onOpen('pipeline')}
        className="col-span-2 flex flex-col justify-center rounded-lg bg-navy px-5 py-4 text-left transition-colors duration-150 hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:col-span-4 xl:col-span-1"
      >
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#9FB4D1]">Estimated Active Pipeline Value</span>
        <span className="mt-1.5 text-4xl font-extrabold tabular-nums text-white">{formatBdtShort(pipelineValue)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#C9D6E8]">
            Estimate — excludes On Hold / Cancelled / Awarded / Lost
          </span>
          <span className="text-[10.5px] tabular-nums text-[#8FA0BD]">{formatBdt(pipelineValue)}</span>
        </span>
      </button>
      <KpiCard label="Active Opportunities" value={String(activeCount)} note={scopeNote} accent="teal" onClick={() => onOpen('active')} />
      <KpiCard label="Overdue Follow-ups" value={String(overdueCount)} note={overdueNote} accent="red" onClick={() => onOpen('overdue')} />
      <KpiCard
        label="Tenders Due in 7 Days"
        value={String(tendersDue7)}
        note="From now, current open bids"
        accent="amber"
        onClick={() => onOpen('tenders')}
      />
      <KpiCard
        label="Awarded Value This Quarter"
        value={formatBdtShort(awardedQuarter)}
        note={`Actual awarded · ${quarterLabel}`}
        accent="green"
        onClick={() => onOpen('awarded')}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage chart
// ---------------------------------------------------------------------------

const FILL = { open: 'bg-brand', awarded: 'bg-green-600', lost: 'bg-slate-400' };

export function StageFunnel({ stages, onSelect }: { stages: DashboardStageDto[]; onSelect: (stage: OpportunityStage) => void }) {
  const kindOf = (stage: OpportunityStage) => (stage === 'awarded' ? 'awarded' : stage === 'lost' ? 'lost' : 'open');
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[860px] items-stretch px-1.5 pb-2.5 pt-3">
        {stages.map((s, i) => {
          const kind = kindOf(s.stage);
          const next = stages[i + 1];
          const previous = stages[i - 1];
          const closedStart = kind !== 'open' && previous !== undefined && kindOf(previous.stage) === 'open';
          const pct = s.count === 0 ? 6 : Math.max(14, (s.count / max) * 100);
          const valueLabel = s.valueBasis === 'awarded' ? 'actual awarded value' : 'estimated value';
          return (
            <button
              key={s.stage}
              type="button"
              onClick={() => onSelect(s.stage)}
              aria-label={`${STAGE_LABELS[s.stage]}: ${s.count} opportunities, ${formatBdtShort(s.value)} ${valueLabel}. Open filtered list.`}
              title={`${STAGE_LABELS[s.stage]} — ${valueLabel}`}
              className={`group relative flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 rounded-md px-1.5 pb-1 pt-0.5 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                next && !(kindOf(next.stage) !== 'open' && kind === 'open') ? 'border-r border-dashed border-slate-200' : ''
              } ${closedStart ? 'ml-1.5 border-l-2 border-l-slate-200 bg-slate-50/60 pl-2.5' : kind !== 'open' ? 'bg-slate-50/60' : ''}`}
            >
              {kind !== 'open' && (
                <span
                  className={`absolute left-1/2 top-0.5 -translate-x-1/2 rounded-full px-1.5 text-[8.5px] font-bold ${
                    kind === 'awarded' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {kind === 'awarded' ? 'WON' : 'LOST'}
                </span>
              )}
              <span className="flex h-7 items-end justify-center text-center text-[10px] font-bold uppercase leading-tight tracking-wide text-slate-500 group-hover:text-slate-800">
                {STAGE_LABELS[s.stage]}
              </span>
              <span className="flex h-14 w-7 items-end overflow-hidden rounded bg-slate-100">
                <motion.span
                  className={`block w-full rounded-t ${s.count === 0 ? 'bg-slate-200' : FILL[kind]}`}
                  initial={{ height: 0 }}
                  animate={{ height: `${pct}%` }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1], delay: i * 0.03 }}
                />
              </span>
              <span className={`text-lg font-extrabold tabular-nums ${s.count === 0 ? 'text-slate-300' : 'text-slate-900'}`}>{s.count}</span>
              <span className="whitespace-nowrap text-[10.5px] font-semibold tabular-nums text-slate-500">
                {s.count === 0 ? '—' : formatBdtShort(s.value)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team workload
// ---------------------------------------------------------------------------

export function TeamWorkload({
  rows,
  currentUserId,
  showSection,
  onOpenOwner,
  onOpenOverdue,
}: {
  rows: DashboardWorkloadRowDto[];
  currentUserId: string;
  showSection: boolean;
  onOpenOwner: (userId: string) => void;
  onOpenOverdue: (userId: string) => void;
}) {
  if (rows.length === 0) return <EmptyState compact title="No owners in this selection" description="Nobody in your scope owns open work here." />;
  const th = 'pb-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-slate-500';
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={`px-4 ${th} text-left`}>Team member</th>
            <th className={`px-2 ${th}`}>Active opps</th>
            <th className={`px-2 ${th}`}>Est. pipeline</th>
            <th className={`px-2 ${th}`}>Open tasks</th>
            <th className={`px-2 ${th}`}>Overdue</th>
            <th className={`px-4 ${th}`}>Tenders ≤7d</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2">
                <button type="button" onClick={() => onOpenOwner(r.userId)} className="flex items-center gap-2 text-left hover:text-brand-dark">
                  <Avatar name={r.fullName} />
                  <span>
                    <span className="block text-[13px] font-semibold text-slate-800">
                      {r.fullName}
                      {r.userId === currentUserId && <span className="font-normal text-slate-400"> (me)</span>}
                      {!r.active && <span className="ml-1 text-[11px] font-normal text-slate-400">Inactive</span>}
                    </span>
                    {showSection && <span className="block text-[11px] text-slate-500">{r.sectionName}</span>}
                  </span>
                </button>
              </td>
              <td className="px-2 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onOpenOwner(r.userId)}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-700 hover:bg-slate-200"
                >
                  {r.activeOpportunities}
                </button>
              </td>
              <td className="px-2 py-2 text-right text-[13px] tabular-nums text-slate-700" title={formatBdt(r.estimatedPipeline)}>
                {formatBdtShort(r.estimatedPipeline)}
              </td>
              <td className="px-2 py-2 text-right text-[13px] tabular-nums text-slate-700">{r.openTasks}</td>
              <td className="px-2 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onOpenOverdue(r.userId)}
                  className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                    r.overdueTasks ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {r.overdueTasks}
                </button>
              </td>
              <td className="px-4 py-2 text-right text-[13px] tabular-nums text-slate-700">{r.tendersDueSoon}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline value by section
// ---------------------------------------------------------------------------

export function SectionPipeline({ rows, onOpen }: { rows: DashboardSectionDto[]; onOpen: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => displayNumber(r.estimatedPipeline)));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onOpen(r.id)}
            className="-mx-2 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-slate-50"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-slate-800">{r.name}</span>
              <span className="text-[13px] font-bold tabular-nums text-slate-900" title={formatBdt(r.estimatedPipeline)}>
                {formatBdtShort(r.estimatedPipeline)}
              </span>
            </span>
            <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${Math.max(2, (displayNumber(r.estimatedPipeline) / max) * 100)}%` }}
              />
            </span>
            <span className="mt-1 block text-[11px] text-slate-500">{r.activeOpportunities} active opportunities · estimate</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const DUE_LABEL = { overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming' } as const;
const DUE_TONE = {
  overdue: 'bg-red-50 text-red-700',
  today: 'bg-amber-50 text-amber-700',
  upcoming: 'bg-slate-100 text-slate-600',
} as const;

export function NextActionsList({
  items,
  showAssignee,
  onOpen,
}: {
  items: DashboardNextActionDto[];
  showAssignee: boolean;
  onOpen: (opportunityId: string) => void;
}) {
  if (!items.length) return <EmptyState compact title="No open next actions" description="Nothing is due for this selection." />;
  const overdue = items.filter((i) => i.dueState === 'overdue');
  const upcoming = items.filter((i) => i.dueState !== 'overdue');
  const Row = ({ item }: { item: DashboardNextActionDto }) => (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.opportunityId)}
        className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-[12.5px] font-semibold leading-snug text-slate-900">{item.title}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${DUE_TONE[item.dueState]}`}>{DUE_LABEL[item.dueState]}</span>
        </span>
        <span className="text-[11px] text-slate-500">
          {item.opportunityName} · Due {formatCalendarDate(item.dueDate)}
          {showAssignee ? ` · ${item.assigneeName}` : ''}
          {item.onHold ? ' · On Hold' : ''}
        </span>
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-2">
      {overdue.length > 0 && (
        <div>
          <p className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wide text-red-700">Overdue ({overdue.length})</p>
          <ul className="divide-y divide-slate-100">
            {overdue.map((i) => (
              <Row key={i.followUpId} item={i} />
            ))}
          </ul>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className={overdue.length ? 'border-t border-slate-200 pt-2' : ''}>
          <p className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Upcoming ({upcoming.length})</p>
          <ul className="divide-y divide-slate-100">
            {upcoming.map((i) => (
              <Row key={i.followUpId} item={i} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TenderDeadlineList({ tenders, onOpen }: { tenders: DashboardTenderDto[]; onOpen: (tender: DashboardTenderDto) => void }) {
  if (!tenders.length) return <EmptyState compact title="No open tender deadlines" description="All tenders in scope are submitted or closed." />;
  return (
    <ul className="divide-y divide-slate-100">
      {tenders.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onOpen(t)}
            className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-slate-900">{t.opportunityName}</span>
              <BidStatusBadge status={t.bidStatus} />
            </span>
            <span className="text-[11px] text-slate-500">
              Ref {t.reference} · Submission {formatInstantCompact(t.submissionDeadline)} (UTC+6)
            </span>
            <span>
              <TenderIndicatorBadge indicator={t.indicator} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RecentActivityList({ activities, onOpen }: { activities: DashboardActivityDto[]; onOpen: (opportunityId: string) => void }) {
  if (!activities.length) return <EmptyState compact title="No activity in this period" description="Try a wider date range." />;
  return (
    <ul className="divide-y divide-slate-100">
      {activities.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            onClick={() => onOpen(a.opportunityId)}
            className="-mx-2 flex w-[calc(100%+1rem)] gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50"
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[12.5px] leading-snug text-slate-800">
                <strong className="font-semibold">{a.authorName}</strong> logged{' '}
                {a.type === 'other' ? 'an activity' : `a ${ACTIVITY_TYPE_LABELS[a.type]}`} on{' '}
                <span className="font-medium">{a.opportunityName}</span>
              </span>
              <span className="block truncate text-[11.5px] text-slate-500">{a.subject}</span>
              <span className="block text-[10.5px] text-slate-400">{formatInstantCompact(a.occurredAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
