/**
 * Opportunities — the approved Pipeline and Table views, both backed by scoped
 * server queries (plan 7.5, FR-021).
 *
 * The table is paginated on the server. The board is bounded per lane, and a
 * drag only becomes a change once the server commits it: see PipelineBoard
 * and TransitionDialog.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { KanbanSquareIcon, PlusIcon, SearchIcon, TableIcon, XIcon } from 'lucide-react';

import type { OpportunityListItemDto } from '../../../shared/api.js';

import {
  PRIORITIES,
  PRIORITY_LABELS,
  SOLUTION_CATEGORIES,
  SOLUTION_CATEGORY_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  isTerminalStage,
  type BoardLane,
} from '../../../shared/enums.js';
import { formatBdt, formatBdtShort } from '../../../shared/money.js';
import { ApiRequestError, newIdempotencyKey } from '../../api/client.js';
import { fetchBoard, fetchOpportunities } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { FilterSelect, inputCls } from '../../components/ui/FormFields';
import {
  PageContainer,
  PageHeader,
  Pagination,
  SegmentedControl,
  SortHeader,
  tdCls,
  thCls,
} from '../../components/ui/Layout';
import { useAuth } from '../AuthContext.js';
import { useApiResource } from '../useApiResource.js';
import { OpportunityCreateDialog } from '../components/OpportunityCreateDialog.js';
import { ErrorPanel, LoadingPanel, LoadingRows } from '../components/Feedback.js';
import { PipelineBoard, type PendingMove } from '../components/PipelineBoard.js';
import { TransitionDialog } from '../components/TransitionDialog.js';
import {
  needsTransitionDialog,
  sendDirectStageChange,
  transitionRequestFor,
  type TransitionRequest,
} from '../transitions.js';
import { DueTag, PriorityBadge, StageBadge } from '../ui/ApiBadges.js';
import { dhakaToday, formatCalendarDate } from '../ui/dates.js';

const PAGE_SIZE = 25;

/** Mirrors the server's allowlist; an unknown key is rejected with 422. */
type SortKey = 'createdAt' | 'name' | 'estimatedValue' | 'stage' | 'priority' | 'expectedAwardDate';

export function OpportunitiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const today = dhakaToday();

  const read = (key: string, fallback = '') => params.get(key) ?? fallback;
  const view = read('view') === 'table' ? 'table' : 'pipeline';
  const page = Math.max(1, Number(read('page', '1')) || 1);
  const q = read('q');
  const stage = read('stage');
  const status = read('status');
  const priority = read('priority');
  const solutionCategory = read('solutionCategory');
  const sort = (read('sort', 'createdAt') as SortKey) ?? 'createdAt';
  const dir = read('dir', 'desc') === 'asc' ? 'asc' : 'desc';

  const update = (patch: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, q, stage, status, priority, solutionCategory, sort, dir }),
    [page, q, stage, status, priority, solutionCategory, sort, dir],
  );

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchOpportunities(query, signal),
    [query],
  );

  const { data, error, loading, reload } = useApiResource(
    useCallback((signal: AbortSignal) => (view === 'table' ? fetcher(signal) : Promise.resolve(null)), [view, fetcher]),
    [query, view],
  );

  const boardQuery = useMemo(() => ({ q, priority, solutionCategory }), [q, priority, solutionCategory]);
  const board = useApiResource(
    useCallback(
      (signal: AbortSignal) => (view === 'pipeline' ? fetchBoard(boardQuery, signal) : Promise.resolve(null)),
      [view, boardQuery],
    ),
    [boardQuery, view],
  );

  // --- Board moves ---------------------------------------------------------
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [transition, setTransition] = useState<{ item: OpportunityListItemDto; request: TransitionRequest } | null>(
    null,
  );

  /** Clears the pending card: it is shown in its original lane again. */
  const restore = () => {
    setPending(null);
    setTransition(null);
  };

  const dragRefusal = (item: OpportunityListItemDto): string | null =>
    isTerminalStage(item.stage) && user?.role !== 'management'
      ? 'Only management can reopen an Awarded or Lost opportunity.'
      : null;

  const handleMove = async (item: OpportunityListItemDto, to: BoardLane) => {
    const current = item.status === 'active' ? item.stage : item.status;
    if (current === to || pending) return;

    const request = transitionRequestFor(item, to);
    if (typeof request === 'string') {
      toast.error(request, { description: item.name });
      return;
    }

    setPending({ id: item.id, to });
    if (needsTransitionDialog(item, request)) {
      setTransition({ item, request });
      return;
    }

    // The next stage, with a next action already in place: no extra input.
    try {
      const updated = await sendDirectStageChange(item, to as never, newIdempotencyKey());
      toast.success(`Moved to ${STAGE_LABELS[updated.stage]}`, { description: item.name });
      board.reload();
    } catch (caught) {
      const message = caught instanceof ApiRequestError ? caught.message : 'The move could not be saved.';
      toast.error(message, { description: `${item.name} is back where it was.` });
      // A conflict or an uncertain network result: show the server's truth.
      board.reload();
    } finally {
      setPending(null);
    }
  };

  const activeFilterCount = [q, stage, status, priority, solutionCategory].filter(Boolean).length;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const scopeNote =
    user?.role === 'management'
      ? 'All sections'
      : user?.role === 'lead'
        ? `${user.section?.name ?? 'Your section'} — every opportunity in your section`
        : 'Opportunities you own';

  const shownTotal =
    view === 'table'
      ? (data?.total ?? null)
      : board.data
        ? board.data.lanes.reduce((sum, lane) => sum + lane.total, 0)
        : null;

  const toggleSort = (key: SortKey) =>
    update({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' }, false);

  return (
    <PageContainer>
      <PageHeader
        title="Opportunities"
        subtitle={
          shownTotal !== null
            ? `${shownTotal} accessible ${shownTotal === 1 ? 'opportunity' : 'opportunities'} · ${scopeNote}`
            : scopeNote
        }
        actions={
          <>
            <SegmentedControl
              label="View"
              value={view}
              onChange={(next) => update({ view: next === 'pipeline' ? '' : next }, false)}
              options={[
                { id: 'pipeline', label: 'Pipeline', icon: <KanbanSquareIcon className="h-3.5 w-3.5" /> },
                { id: 'table', label: 'Table', icon: <TableIcon className="h-3.5 w-3.5" /> },
              ]}
            />
            {user?.capabilities.createOpportunity ? (
              <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                Add Opportunity
              </Button>
            ) : null}
          </>
        }
      />

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(0,1fr))]">
          <label className="col-span-2 flex flex-col gap-1 md:col-span-3 xl:col-span-1">
            <span className="text-[11px] font-semibold text-slate-500">Search</span>
            <span className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={q}
                onChange={(event) => update({ q: event.target.value })}
                placeholder="Name, reference or organization…"
                className={inputCls(undefined, 'h-9 pl-8 text-[13px]')}
              />
            </span>
          </label>

          {/* On the board, stage and status are the lanes themselves. */}
          {view === 'table' && (
            <>
              <FilterSelect label="Stage" value={stage} onChange={(value) => update({ stage: value })}>
                <option value="">All stages</option>
                {OPPORTUNITY_STAGES.map((value) => (
                  <option key={value} value={value}>
                    {STAGE_LABELS[value]}
                  </option>
                ))}
              </FilterSelect>

              <FilterSelect label="Status" value={status} onChange={(value) => update({ status: value })}>
                <option value="">All statuses</option>
                {OPPORTUNITY_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </option>
                ))}
              </FilterSelect>
            </>
          )}

          <FilterSelect label="Priority" value={priority} onChange={(value) => update({ priority: value })}>
            <option value="">All priorities</option>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Solution category"
            value={solutionCategory}
            onChange={(value) => update({ solutionCategory: value })}
          >
            <option value="">All categories</option>
            {SOLUTION_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {SOLUTION_CATEGORY_LABELS[value]}
              </option>
            ))}
          </FilterSelect>
        </div>

        {activeFilterCount > 0 && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<XIcon className="h-3.5 w-3.5" />}
              onClick={() => setParams({}, { replace: true })}
            >
              Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
            </Button>
          </div>
        )}
      </div>

      {view === 'pipeline' ? (
        board.error ? (
          <ErrorPanel error={board.error} onRetry={board.reload} />
        ) : !board.data ? (
          <LoadingPanel label="Loading pipeline…" />
        ) : (
          <>
            <p className="text-[11.5px] text-slate-500">
              Drag a card to change its stage or status. Moves are saved only after the server confirms
              them; a cancelled or refused move returns the card to where it was. Lane values are
              estimates, except Awarded, which shows actual awarded value. Keyboard users can change
              the stage from the opportunity page.
            </p>
            <PipelineBoard
              board={board.data}
              today={today}
              pending={pending}
              dragRefusal={dragRefusal}
              onOpen={(id) => navigate(`/opportunities/${id}`)}
              onMove={(item, to) => void handleMove(item, to)}
            />
          </>
        )
      ) : error ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="-mx-px overflow-x-auto">
            <table className="w-full min-w-[920px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <SortHeader
                    label="Opportunity"
                    active={sort === 'name'}
                    dir={dir}
                    onClick={() => toggleSort('name')}
                    className="pl-4"
                  />
                  <th className={thCls}>Organization</th>
                  <th className={thCls}>Owner</th>
                  <SortHeader label="Stage" active={sort === 'stage'} dir={dir} onClick={() => toggleSort('stage')} />
                  <SortHeader
                    label="Estimated value"
                    active={sort === 'estimatedValue'}
                    dir={dir}
                    onClick={() => toggleSort('estimatedValue')}
                    className="text-right"
                  />
                  <th className={thCls}>Next action</th>
                  <SortHeader
                    label="Priority"
                    active={sort === 'priority'}
                    dir={dir}
                    onClick={() => toggleSort('priority')}
                    className="pr-4"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <LoadingRows columns={7} />}

                {!loading &&
                  data?.items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => navigate(`/opportunities/${item.id}`)}
                    >
                      <td className={`${tdCls} pl-4`}>
                        <button
                          type="button"
                          className="text-left font-semibold text-brand-dark hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/opportunities/${item.id}`);
                          }}
                        >
                          {item.name}
                        </button>
                        <span className="mt-0.5 block text-[11px] tabular-nums text-slate-400">
                          {item.reference}
                        </span>
                      </td>
                      <td className={tdCls}>{item.organization.name}</td>
                      <td className={tdCls}>
                        {item.ownerName}
                        <span className="block text-[11px] text-slate-400">{item.sectionName}</span>
                      </td>
                      <td className={tdCls}>
                        <StageBadge stage={item.stage} status={item.status} />
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>
                        <span className="font-semibold">{formatBdtShort(item.estimatedValue)}</span>
                        <span className="block text-[11px] text-slate-400">{formatBdt(item.estimatedValue)}</span>
                      </td>
                      <td className={tdCls}>
                        {item.nextAction ? (
                          <>
                            <span className="block max-w-[260px] truncate">{item.nextAction.title}</span>
                            <span className="mt-0.5 flex items-center gap-1.5">
                              <span className="text-[11px] tabular-nums text-slate-500">
                                {formatCalendarDate(item.nextAction.dueDate)}
                              </span>
                              <DueTag dueDate={item.nextAction.dueDate} today={today} />
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={`${tdCls} pr-4`}>
                        <PriorityBadge priority={item.priority} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {!loading && data && data.items.length === 0 && (
            <EmptyState
              title={activeFilterCount > 0 ? 'No opportunities match these filters' : 'No opportunities yet'}
              description={
                activeFilterCount > 0
                  ? 'Adjust or clear the filters to see more.'
                  : 'Create your first opportunity to start tracking the pipeline.'
              }
              action={
                user?.capabilities.createOpportunity ? (
                  <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                    Add Opportunity
                  </Button>
                ) : undefined
              }
            />
          )}

          {data && (
            <Pagination
              page={data.page}
              pageCount={pageCount}
              total={data.total}
              pageSize={data.pageSize}
              onChange={(next) => update({ page: String(next) }, false)}
            />
          )}
        </div>
      )}

      <TransitionDialog
        subject={transition?.item ?? null}
        request={transition?.request ?? null}
        onClose={restore}
        onDone={() => {
          restore();
          board.reload();
        }}
        onReload={() => {
          restore();
          board.reload();
        }}
      />

      <OpportunityCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          navigate(`/opportunities/${id}`);
        }}
      />
    </PageContainer>
  );
}
