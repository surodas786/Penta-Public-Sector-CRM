/**
 * Tender Tracker (FR-052) — the approved table and calendar, filtered and
 * sorted on the server inside the caller's scope. Deadline colours come from
 * the server, calculated against the real current time in Bangladesh; the
 * legend explains each one.
 *
 * Rows open the opportunity's Tender tab, where the full record, earlier
 * cycles and every action live.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDaysIcon, PlusIcon, TableIcon } from 'lucide-react';

import type { TenderDto } from '../../../shared/api.js';
import { BID_STATUSES, BID_STATUS_LABELS, BUSINESS_TIME_LABEL, type TenderIndicator } from '../../../shared/enums.js';
import { fetchOpportunityOwners, fetchTenders } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { FilterSelect } from '../../components/ui/FormFields';
import { PageContainer, PageHeader, Pagination, SegmentedControl, SortHeader, tdCls, thCls } from '../../components/ui/Layout';
import { useAuth } from '../AuthContext.js';
import { DeadlineCalendar, type CalendarEvent } from '../components/DeadlineCalendar.js';
import { ErrorPanel, LoadingRows } from '../components/Feedback.js';
import { MarkSubmittedDialog, TenderFormDialog } from '../components/TenderDialogs.js';
import { dhakaToday, formatInstantCompact } from '../ui/dates.js';
import { BidStatusBadge, NoticeStateBadge, TenderIndicatorBadge, TenderLegend } from '../ui/TenderBadges.js';
import { useApiResource } from '../useApiResource.js';

const PAGE_SIZE = 50;

/** Adds days to a YYYY-MM-DD date. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The deadline presets, as Bangladesh calendar-date ranges on the submission deadline (BR-060). */
function deadlineRange(preset: string, today: string): { deadlineFrom?: string; deadlineTo?: string } {
  switch (preset) {
    case 'upcoming':
      return { deadlineFrom: today };
    case '3d':
      return { deadlineFrom: today, deadlineTo: addDays(today, 3) };
    case '7d':
      return { deadlineFrom: today, deadlineTo: addDays(today, 7) };
    case '30d':
      return { deadlineFrom: today, deadlineTo: addDays(today, 30) };
    case 'past':
      return { deadlineTo: addDays(today, -1) };
    default:
      return {};
  }
}

const TONE: Record<TenderIndicator, CalendarEvent['tone']> = {
  missed: 'red',
  due_soon: 'amber',
  upcoming: 'slate',
  submitted: 'green',
  not_participating: 'slate',
  inactive: 'slate',
};

const dhakaClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dhakaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });

export function TenderTrackerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState<TenderDto | null>(null);
  const today = dhakaToday();
  const [month, setMonth] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });

  const read = (key: string, fallback = '') => params.get(key) ?? fallback;
  const view = read('view', 'table') as 'table' | 'calendar';
  const owner = read('owner');
  const section = user?.role === 'management' ? read('section') : '';
  const status = read('status');
  const deadline = read('deadline');
  const notice = read('notice', 'active') as 'active' | 'all';
  const dir = read('dir', 'asc') as 'asc' | 'desc';
  const page = Number(read('page', '1')) || 1;

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
    () => ({
      ownerId: owner || undefined,
      sectionId: section || undefined,
      bidStatus: status || undefined,
      notice,
      dir,
      page,
      pageSize: PAGE_SIZE,
      ...deadlineRange(deadline, today),
    }),
    [owner, section, status, notice, dir, page, deadline, today],
  );
  const tenders = useApiResource(useCallback((signal: AbortSignal) => fetchTenders(query, signal), [query]), [query]);

  const showOwnerFilter = user?.role !== 'sales';
  const owners = useApiResource(
    useCallback((signal: AbortSignal) => (showOwnerFilter ? fetchOpportunityOwners(signal) : Promise.resolve({ items: [] })), [showOwnerFilter]),
    [showOwnerFilter],
  );
  const sections = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of owners.data?.items ?? []) seen.set(item.sectionId, item.sectionName);
    return [...seen.entries()];
  }, [owners.data]);

  const rows = tenders.data?.items ?? [];
  const openOpportunity = (tender: TenderDto) => navigate(`/opportunities/${tender.opportunity.id}?tab=tender`);
  const events: CalendarEvent[] = rows.map((tender) => {
    const deadlineAt = new Date(tender.submissionDeadline);
    return {
      id: tender.id,
      date: dhakaDay.format(deadlineAt),
      label: `${dhakaClock.format(deadlineAt)} ${tender.reference}`,
      tone: TONE[tender.indicator],
      onClick: () => openOpportunity(tender),
    };
  });

  return (
    <PageContainer>
      <PageHeader
        title="Tender Tracker"
        subtitle={`Deadline colours are calculated against the current time in ${BUSINESS_TIME_LABEL}. Manual records only — no e-GP integration.`}
        actions={
          <>
            <SegmentedControl
              label="View"
              value={view}
              onChange={(value) => update({ view: value === 'table' ? '' : value })}
              options={[
                { id: 'table', label: 'Table', icon: <TableIcon className="h-3.5 w-3.5" /> },
                { id: 'calendar', label: 'Calendar', icon: <CalendarDaysIcon className="h-3.5 w-3.5" /> },
              ]}
            />
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
              Add Tender
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-2">
          {showOwnerFilter && (
            <FilterSelect label="Owner" value={owner} onChange={(value) => update({ owner: value })} className="w-44">
              <option value="">All owners</option>
              {owners.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName}
                </option>
              ))}
            </FilterSelect>
          )}
          {user?.role === 'management' && (
            <FilterSelect label="Section" value={section} onChange={(value) => update({ section: value })} className="w-48">
              <option value="">All sections</option>
              {sections.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </FilterSelect>
          )}
          <FilterSelect label="Bid status" value={status} onChange={(value) => update({ status: value })} className="w-40">
            <option value="">All statuses</option>
            {BID_STATUSES.map((value) => (
              <option key={value} value={value}>
                {BID_STATUS_LABELS[value]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Deadline" value={deadline} onChange={(value) => update({ deadline: value })} className="w-44">
            <option value="">Any deadline</option>
            <option value="upcoming">Today or later</option>
            <option value="3d">Within 3 days</option>
            <option value="7d">Within 7 days</option>
            <option value="30d">Within 30 days</option>
            <option value="past">Before today</option>
          </FilterSelect>
          <FilterSelect label="Notices" value={notice} onChange={(value) => update({ notice: value === 'active' ? '' : value })} className="w-52">
            <option value="active">Current notices</option>
            <option value="all">Include superseded and cancelled</option>
          </FilterSelect>
        </div>
        <TenderLegend />
      </div>

      {tenders.error ? (
        <ErrorPanel error={tenders.error} onRetry={tenders.reload} />
      ) : view === 'calendar' ? (
        <>
          <DeadlineCalendar year={month.y} month={month.m} events={events} onMonthChange={(y, m) => setMonth({ y, m })} />
          {tenders.data && tenders.data.total > rows.length && (
            <p className="text-xs text-slate-500">
              Showing the first {rows.length} of {tenders.data.total} matching tenders. Narrow the filters to see the rest on the calendar.
            </p>
          )}
        </>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {tenders.loading && !tenders.data ? (
            <table className="w-full">
              <tbody>
                <LoadingRows columns={7} />
              </tbody>
            </table>
          ) : rows.length === 0 ? (
            <EmptyState title="No tenders match" description="Adjust filters, or add a tender to an opportunity in your scope." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px]">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className={thCls}>Indicator</th>
                      <th className={thCls}>Tender</th>
                      <th className={thCls}>Opportunity</th>
                      <SortHeader label="Submission deadline (UTC+6)" active dir={dir} onClick={() => update({ dir: dir === 'asc' ? 'desc' : '' })} />
                      <th className={thCls}>Bid status</th>
                      <th className={thCls}>Owner</th>
                      <th className={`${thCls} text-right`}>Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((tender) => (
                      <tr
                        key={tender.id}
                        onClick={() => openOpportunity(tender)}
                        className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                      >
                        <td className={tdCls}>
                          <TenderIndicatorBadge indicator={tender.indicator} />
                        </td>
                        <td className={`${tdCls} max-w-[280px]`}>
                          <span className="block font-semibold text-slate-900">{tender.reference}</span>
                          <span className="block truncate text-[11.5px] text-slate-500">{tender.title}</span>
                          {!tender.isCurrent && (
                            <span className="mt-0.5 inline-block">
                              <NoticeStateBadge state={tender.noticeState} />
                            </span>
                          )}
                        </td>
                        <td className={`${tdCls} min-w-[180px] max-w-[240px] text-slate-700`}>
                          <span className="block">{tender.opportunity.name}</span>
                          <span className="block text-[11px] text-slate-400">{tender.section.name}</span>
                        </td>
                        <td className={`${tdCls} whitespace-nowrap tabular-nums`}>
                          {formatInstantCompact(tender.submissionDeadline)}
                          {tender.submittedAt && (
                            <span className="block text-[11px] text-green-700">Submitted {formatInstantCompact(tender.submittedAt)}</span>
                          )}
                          {tender.stageMismatch && (
                            <span className="block text-[11px] font-semibold text-amber-700">Opportunity stage not yet Bid Submitted</span>
                          )}
                        </td>
                        <td className={tdCls}>
                          <BidStatusBadge status={tender.bidStatus} />
                        </td>
                        <td className={`${tdCls} whitespace-nowrap`}>{tender.responsibleOwner.fullName}</td>
                        <td className={`${tdCls} text-right`}>
                          {tender.canEdit && (tender.bidStatus === 'reviewing' || tender.bidStatus === 'preparing') && (
                            <Button
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSubmitting(tender);
                              }}
                            >
                              Mark Submitted
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                pageCount={Math.max(1, Math.ceil((tenders.data?.total ?? 0) / PAGE_SIZE))}
                total={tenders.data?.total ?? 0}
                pageSize={PAGE_SIZE}
                onChange={(next) => update({ page: String(next) })}
              />
            </>
          )}
        </div>
      )}

      <TenderFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onDone={(tender) => {
          setFormOpen(false);
          navigate(`/opportunities/${tender.opportunity.id}?tab=tender`);
        }}
      />
      <MarkSubmittedDialog
        tender={submitting}
        onClose={() => setSubmitting(null)}
        onDone={() => {
          setSubmitting(null);
          tenders.reload();
        }}
      />
    </PageContainer>
  );
}
