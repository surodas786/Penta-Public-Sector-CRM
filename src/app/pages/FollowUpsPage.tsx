/**
 * Activities & Follow-ups — the approved screen (FR-040–FR-043).
 *
 * Follow-up lists, buckets and counts come from one scoped server query; the
 * server decides what is overdue against today's Dhaka date, so this page
 * never trusts the browser clock for it. The Activity Log tab lists scoped
 * activities. The calendar view is not built yet and says so.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClockIcon, CheckIcon, SearchIcon, XIcon } from 'lucide-react';

import type { FollowUpListItemDto } from '../../../shared/api.js';
import { boardLaneLabel } from '../../../shared/enums.js';
import { fetchFollowUps } from '../../api/endpoints.js';
import { EmptyState } from '../../components/ui/Feedback';
import { FilterSelect, inputCls } from '../../components/ui/FormFields';
import { PageContainer, PageHeader, Pagination, Tabs } from '../../components/ui/Layout';
import { ActivityLogTab } from '../components/ActivityLogTab.js';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import {
  CancelFollowUpDialog,
  CompleteFollowUpDialog,
  RescheduleFollowUpDialog,
} from '../components/FollowUpDialogs.js';
import { DueTag, PriorityBadge } from '../ui/ApiBadges.js';
import { formatCalendarDate, formatInstant } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';

type View = 'open' | 'overdue' | 'today' | 'upcoming' | 'completed' | 'cancelled' | 'all';
const VIEWS: { id: View; label: string }[] = [
  { id: 'open', label: 'All open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];
const PAGE_SIZE = 25;

type TaskAction = { kind: 'complete' | 'reschedule' | 'cancel'; task: FollowUpListItemDto };

export function FollowUpsPage() {
  const [params, setParams] = useSearchParams();
  const [action, setAction] = useState<TaskAction | null>(null);

  const read = (key: string, fallback = '') => params.get(key) ?? fallback;
  const tab = read('tab') === 'log' ? 'log' : 'followups';
  const view = (VIEWS.some((item) => item.id === read('filter')) ? read('filter') : 'open') as View;
  const assignedTo = read('assignee') === 'me' ? 'me' : '';
  const q = read('q');
  const page = Math.max(1, Number(read('page', '1')) || 1);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useMemo(
    () => ({ view, assignedTo: assignedTo || undefined, q: q || undefined, page, pageSize: PAGE_SIZE }),
    [view, assignedTo, q, page],
  );
  const fetcher = useCallback((signal: AbortSignal) => fetchFollowUps(query, signal), [query]);
  const { data, error, loading, reload } = useApiResource(fetcher, [query]);

  const done = () => {
    setAction(null);
    reload();
  };

  return (
    <PageContainer>
      <PageHeader
        title="Activities & Follow-ups"
        subtitle="Daily follow-up work for your accessible opportunities"
      />

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4 pt-2">
          <Tabs
            active={tab}
            onChange={(next) => update({ tab: next === 'followups' ? '' : next })}
            tabs={[
              { id: 'followups', label: 'Follow-ups', count: data?.counts.open },
              { id: 'log', label: 'Activity Log' },
            ]}
          />
        </div>

        {tab === 'log' ? (
          <ActivityLogTab />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 px-4 py-3">
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500">Search</span>
                <span className="relative">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={q}
                    onChange={(event) => update({ q: event.target.value })}
                    placeholder="Task, opportunity or reference…"
                    className={inputCls(undefined, 'h-9 pl-8 text-[13px]')}
                  />
                </span>
              </label>
              <FilterSelect
                label="Assigned to"
                value={assignedTo}
                onChange={(value) => update({ assignee: value })}
                className="w-44"
              >
                <option value="">Everyone in scope</option>
                <option value="me">Me</option>
              </FilterSelect>
            </div>

            <div
              className="flex flex-wrap gap-1.5 border-b border-slate-200 px-4 py-2.5"
              role="group"
              aria-label="Follow-up filter"
            >
              {VIEWS.map((item) => {
                const active = view === item.id;
                const tone = item.id === 'overdue' && (data?.counts.overdue ?? 0) > 0 ? 'text-red-700' : '';
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => update({ filter: item.id === 'open' ? '' : item.id })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 ${
                      active
                        ? 'border-navy bg-navy text-white'
                        : `border-slate-200 bg-white text-slate-600 hover:bg-slate-50 ${tone}`
                    }`}
                  >
                    {item.label}
                    <span className={`tabular-nums ${active ? 'text-white/70' : 'text-slate-400'}`}>
                      {data?.counts[item.id] ?? '·'}
                    </span>
                  </button>
                );
              })}
              {data && (
                <span className="ml-auto self-center text-[11px] text-slate-500">
                  Overdue means due before today in Bangladesh ({formatCalendarDate(data.today)}).
                </span>
              )}
            </div>

            {error ? (
              <div className="p-4">
                <ErrorPanel error={error} onRetry={reload} />
              </div>
            ) : loading && !data ? (
              <div className="p-4">
                <LoadingPanel label="Loading follow-ups…" />
              </div>
            ) : data && data.items.length > 0 ? (
              <>
                <ul className="divide-y divide-slate-100 px-4">
                  {data.items.map((task) => (
                    <FollowUpRow key={task.id} task={task} today={data.today} onAction={setAction} />
                  ))}
                </ul>
                <Pagination
                  page={data.page}
                  pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))}
                  total={data.total}
                  pageSize={data.pageSize}
                  onChange={(next) => update({ page: String(next) })}
                />
              </>
            ) : (
              <EmptyState
                title="No follow-ups in this view"
                description={view === 'overdue' ? 'Nothing overdue — nice work.' : 'Try another filter.'}
              />
            )}
          </>
        )}
      </div>

      <p className="text-[11.5px] text-slate-500">
        Follow-ups are added from an opportunity’s page. The calendar view is not available yet.
      </p>

      {/* The list cannot know whether a task is its opportunity's last open
          one; the server says so, and the dialog then asks for a replacement. */}
      <CompleteFollowUpDialog
        task={action?.kind === 'complete' ? action.task : null}
        isLastOpen={false}
        onClose={() => setAction(null)}
        onDone={done}
        onReload={done}
      />
      <RescheduleFollowUpDialog
        task={action?.kind === 'reschedule' ? action.task : null}
        onClose={() => setAction(null)}
        onDone={done}
        onReload={done}
      />
      <CancelFollowUpDialog
        task={action?.kind === 'cancel' ? action.task : null}
        isLastOpen={false}
        onClose={() => setAction(null)}
        onDone={done}
        onReload={done}
      />
    </PageContainer>
  );
}

function FollowUpRow({
  task,
  today,
  onAction,
}: {
  task: FollowUpListItemDto;
  today: string;
  onAction: (action: TaskAction) => void;
}) {
  const open = task.state === 'open';
  const held = task.opportunity.status === 'on_hold';

  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <button
          type="button"
          onClick={() => open && onAction({ kind: 'complete', task })}
          disabled={!open}
          aria-label={open ? `Mark "${task.title}" complete` : `${task.state}`}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
            task.state === 'completed'
              ? 'border-green-600 bg-green-600 text-white'
              : task.state === 'cancelled'
                ? 'border-slate-300 bg-slate-100 text-slate-400'
                : 'border-slate-300 text-transparent hover:border-brand hover:text-brand'
          }`}
        >
          {task.state === 'cancelled' ? <XIcon className="h-3 w-3" strokeWidth={3} /> : <CheckIcon className="h-3 w-3" strokeWidth={3} />}
        </button>
        <div className="min-w-0">
          <p className={`text-[13px] font-semibold ${open ? 'text-slate-900' : 'text-slate-500 line-through'}`}>{task.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-500">
            <Link to={`/opportunities/${task.opportunity.id}?tab=followups`} className="font-medium text-brand-dark hover:underline">
              {task.opportunity.name}
            </Link>
            <span>{task.assigneeName}</span>
            <span>· Due {formatCalendarDate(task.dueDate)}</span>
            {held && <span>· Opportunity {boardLaneLabel(task.opportunity.stage, task.opportunity.status)}</span>}
            {task.state === 'completed' && <span>· Completed {formatInstant(task.completedAt)}</span>}
            {task.state === 'cancelled' && <span>· Cancelled — {task.cancellationReason}</span>}
          </p>
          {task.completionNote && <p className="mt-1 text-[12px] italic text-slate-500">“{task.completionNote}”</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-8 sm:pl-0">
        <PriorityBadge priority={task.priority} />
        {open &&
          (held ? (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
              On Hold
            </span>
          ) : (
            <DueTag dueDate={task.dueDate} today={today} />
          ))}
        {open && (
          <>
            <button
              type="button"
              onClick={() => onAction({ kind: 'reschedule', task })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              <CalendarClockIcon className="h-3.5 w-3.5" />
              Reschedule
            </button>
            <button
              type="button"
              onClick={() => onAction({ kind: 'cancel', task })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              <XIcon className="h-3.5 w-3.5" />
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onAction({ kind: 'complete', task })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-brand-dark hover:bg-brand-light"
            >
              <CheckIcon className="h-3.5 w-3.5" />
              Complete
            </button>
          </>
        )}
      </div>
    </li>
  );
}
