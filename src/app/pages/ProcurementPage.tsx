/**
 * Software Procurement (CR6): every EOI → RFP cycle in the caller's scope,
 * with the Tender Tracker's layout and filters. Kept apart from goods
 * tenders. Deadline colours come from the server, against the real current
 * time in Bangladesh; rows open the opportunity's Software Procurement tab,
 * where the record, its earlier cycles and every action live.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PlusIcon } from 'lucide-react';

import type { ProcurementCycleDto } from '../../../shared/api.js';
import {
  BUSINESS_TIME_LABEL,
  PROCUREMENT_MILESTONES,
  PROCUREMENT_MILESTONE_LABELS,
  PROCUREMENT_ROUTES,
  PROCUREMENT_ROUTE_LABELS,
} from '../../../shared/enums.js';
import { fetchOpportunityOwners, fetchProcurementCycles } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { FilterSelect, inputCls } from '../../components/ui/FormFields';
import { PageContainer, PageHeader, Pagination, SortHeader, tdCls, thCls } from '../../components/ui/Layout';
import { useAuth } from '../AuthContext.js';
import { ErrorPanel, LoadingRows } from '../components/Feedback.js';
import { ProcurementCycleFormDialog } from '../components/ProcurementDialogs.js';
import { formatInstantCompact } from '../ui/dates.js';
import { MilestoneBadge, ProcurementIndicatorBadge, ProcurementLegend, RouteBadge } from '../ui/ProcurementBadges.js';
import { useApiResource } from '../useApiResource.js';

const PAGE_SIZE = 50;

export function ProcurementPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');

  const read = (key: string, fallback = '') => params.get(key) ?? fallback;
  const owner = read('owner');
  const section = user?.role === 'management' ? read('section') : '';
  const milestone = read('milestone');
  const route = read('route');
  const deadline = read('deadline');
  const cycles = read('cycles', 'current') as 'current' | 'all';
  const q = read('q');
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
      milestone: milestone || undefined,
      route: route || undefined,
      deadline: deadline || undefined,
      cycles,
      q: q || undefined,
      dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    [owner, section, milestone, route, deadline, cycles, q, dir, page],
  );
  const list = useApiResource(useCallback((signal: AbortSignal) => fetchProcurementCycles(query, signal), [query]), [query]);

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

  const rows = list.data?.items ?? [];
  const open = (cycle: ProcurementCycleDto) => navigate(`/opportunities/${cycle.opportunity.id}?tab=procurement`);

  return (
    <PageContainer>
      <PageHeader
        title="Software Procurement"
        subtitle={`EOI → RFP procurements, kept apart from goods tenders. Deadline colours are calculated against the current time in ${BUSINESS_TIME_LABEL}. Manual records only.`}
        actions={
          <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
            Add Procurement
          </Button>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-2">
          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              update({ q: search.trim() });
            }}
          >
            <label htmlFor="proc-search" className="text-[11px] font-semibold text-slate-500">
              Search
            </label>
            <input
              id="proc-search"
              className={inputCls(undefined, 'h-9 w-56 py-1.5 text-[13px]')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Reference, title or opportunity"
            />
          </form>
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
          <FilterSelect label="Milestone" value={milestone} onChange={(value) => update({ milestone: value })} className="w-48">
            <option value="">All milestones</option>
            {PROCUREMENT_MILESTONES.map((value) => (
              <option key={value} value={value}>
                {PROCUREMENT_MILESTONE_LABELS[value]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Route" value={route} onChange={(value) => update({ route: value })} className="w-56">
            <option value="">Both routes</option>
            {PROCUREMENT_ROUTES.map((value) => (
              <option key={value} value={value}>
                {PROCUREMENT_ROUTE_LABELS[value]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Open deadline" value={deadline} onChange={(value) => update({ deadline: value })} className="w-48">
            <option value="">Any</option>
            <option value="overdue">Overdue</option>
            <option value="72h">Due within 72 hours</option>
            <option value="7d">Due within 7 days</option>
          </FilterSelect>
          <FilterSelect label="Cycles" value={cycles} onChange={(value) => update({ cycles: value === 'current' ? '' : value })} className="w-52">
            <option value="current">Current cycles</option>
            <option value="all">Include earlier cycles</option>
          </FilterSelect>
        </div>
        <ProcurementLegend />
      </div>

      {list.error ? (
        <ErrorPanel error={list.error} onRetry={list.reload} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {list.loading && !list.data ? (
            <table className="w-full">
              <tbody>
                <LoadingRows columns={7} />
              </tbody>
            </table>
          ) : rows.length === 0 ? (
            <EmptyState title="No procurement cycles match" description="Adjust filters, or add a Software Procurement cycle to an opportunity in your scope." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px]">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className={thCls}>Indicator</th>
                      <th className={thCls}>Procurement</th>
                      <th className={thCls}>Opportunity</th>
                      <th className={thCls}>Milestone</th>
                      <SortHeader label="Open deadline (UTC+6)" active dir={dir} onClick={() => update({ dir: dir === 'asc' ? 'desc' : '' })} />
                      <th className={thCls}>Route</th>
                      <th className={thCls}>Owner</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((cycle) => (
                      <tr key={cycle.id} onClick={() => open(cycle)} className="cursor-pointer transition-colors duration-150 hover:bg-slate-50">
                        <td className={tdCls}>
                          <ProcurementIndicatorBadge indicator={cycle.indicator} />
                        </td>
                        <td className={`${tdCls} max-w-[280px]`}>
                          <span className="block font-semibold text-slate-900">{cycle.reference}</span>
                          <span className="block truncate text-[11.5px] text-slate-500">{cycle.title}</span>
                          {!cycle.isCurrent && <span className="mt-0.5 block text-[11px] text-slate-400">Earlier cycle</span>}
                        </td>
                        <td className={`${tdCls} min-w-[180px] max-w-[240px] text-slate-700`}>
                          <span className="block">{cycle.opportunity.name}</span>
                          <span className="block text-[11px] text-slate-400">{cycle.section.name}</span>
                        </td>
                        <td className={tdCls}>
                          <MilestoneBadge milestone={cycle.milestone} />
                        </td>
                        <td className={`${tdCls} whitespace-nowrap tabular-nums`}>
                          {cycle.openDeadline ? formatInstantCompact(cycle.openDeadline) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className={tdCls}>
                          <RouteBadge route={cycle.route} />
                        </td>
                        <td className={`${tdCls} whitespace-nowrap`}>{cycle.responsibleOwner.fullName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE))}
                total={list.data?.total ?? 0}
                pageSize={PAGE_SIZE}
                onChange={(next) => update({ page: String(next) })}
              />
            </>
          )}
        </div>
      )}

      <ProcurementCycleFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onDone={(cycle) => {
          setFormOpen(false);
          navigate(`/opportunities/${cycle.opportunity.id}?tab=procurement`);
        }}
      />
    </PageContainer>
  );
}
