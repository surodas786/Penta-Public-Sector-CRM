/**
 * Dashboard (FR-080, FR-081, §10.1) — the approved sales dashboard layout,
 * fed by one scoped server aggregate. Nothing is counted or summed in the
 * browser. Every card and chart drills into the list built on the same
 * server definition (FR-014), so the number clicked is the number listed.
 */
import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { DashboardDto } from '../../../shared/api.js';
import { PIPELINE_STAGES, type OpportunityStage } from '../../../shared/enums.js';
import { DASHBOARD_RANGES, DASHBOARD_RANGE_LABELS, type DashboardRange } from '../../../shared/reporting.js';
import { fetchDashboard } from '../../api/endpoints.js';
import { FilterSelect } from '../../components/ui/FormFields';
import { PageContainer, Panel, PanelLink } from '../../components/ui/Layout';
import { useAuth } from '../AuthContext.js';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import {
  KpiRow,
  NextActionsList,
  RecentActivityList,
  SectionPipeline,
  StageFunnel,
  TeamWorkload,
  TenderDeadlineList,
  type KpiTarget,
} from '../components/dashboard/DashboardWidgets.js';
import { useApiResource } from '../useApiResource.js';
import { formatCalendarDate } from '../ui/dates.js';

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const isManagement = user?.role === 'management';
  const canFilterOwner = isManagement || user?.role === 'lead';
  const section = isManagement ? (params.get('section') ?? '') : '';
  const owner = canFilterOwner ? (params.get('owner') ?? '') : '';
  const rangeParam = params.get('range') as DashboardRange | null;
  const range: DashboardRange = rangeParam && DASHBOARD_RANGES.includes(rangeParam) ? rangeParam : 'all';

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'section') next.delete('owner');
    setParams(next, { replace: true });
  };

  const query = useMemo(
    () => ({ sectionId: section || undefined, ownerId: owner || undefined, range: range === 'all' ? undefined : range }),
    [section, owner, range],
  );
  const { data, error, loading, reload } = useApiResource(
    useCallback((signal: AbortSignal) => fetchDashboard(query, signal), [query]),
    [query],
  );

  if (!user) return null;

  /** Drill-down query: the dashboard's own section and owner filters carried over. */
  const drill = (base: string, extra: Record<string, string>, names: { owner: string; section: string }) => {
    const search = new URLSearchParams(extra);
    if (section) search.set(names.section, section);
    if (owner) search.set(names.owner, owner);
    return `${base}?${search.toString()}`;
  };
  const toOpportunities = (extra: Record<string, string>) =>
    drill('/opportunities', { view: 'table', ...extra }, { owner: 'ownerId', section: 'sectionId' });
  const toFollowUps = (extra: Record<string, string>) => drill('/activities', extra, { owner: 'owner', section: 'section' });
  const toTenders = (extra: Record<string, string>) => drill('/tenders', extra, { owner: 'owner', section: 'section' });

  const openKpi = (dashboard: DashboardDto) => (target: KpiTarget) => {
    if (target === 'pipeline' || target === 'active') navigate(toOpportunities({ pipeline: 'active' }));
    if (target === 'overdue') navigate(toFollowUps({ filter: 'overdue', hold: 'exclude' }));
    if (target === 'tenders') navigate(toTenders({ window: '7d' }));
    if (target === 'awarded') {
      navigate(toOpportunities({ stage: 'awarded', awardFrom: dashboard.quarter.start, awardTo: dashboard.quarter.end }));
    }
  };

  const openStage = (dashboard: DashboardDto) => (stage: OpportunityStage) => {
    const bounds = dashboard.rangeBounds;
    if (PIPELINE_STAGES.includes(stage)) navigate(toOpportunities({ stage, pipeline: 'active' }));
    else if (stage === 'awarded') navigate(toOpportunities({ stage, ...(bounds ? { awardFrom: bounds.from, awardTo: bounds.to } : {}) }));
    else navigate(toOpportunities({ stage, ...(bounds ? { closedFrom: bounds.from, closedTo: bounds.to } : {}) }));
  };

  const subtitle =
    user.role === 'management'
      ? 'Organization-wide pipeline across all sections'
      : user.role === 'lead'
        ? `${user.section?.name ?? 'Your'} section — ${user.fullName}'s team view`
        : 'Your opportunities, follow-ups and tenders';

  const nextPanel = (dashboard: DashboardDto) => {
    const target = dashboard.nextActions.target;
    const mine = target.id === user.id;
    return (
      <Panel
        title={mine ? 'My Next Actions' : `Next Actions — ${target.fullName}`}
        subtitle={`Open follow-ups assigned to ${mine ? 'you' : target.fullName}, earliest first`}
        action={
          <PanelLink onClick={() => navigate(`/activities?filter=open${mine ? '&assignee=me' : `&assignee=${target.id}`}`)}>
            View all →
          </PanelLink>
        }
      >
        <NextActionsList
          items={dashboard.nextActions.items}
          showAssignee={!mine}
          onOpen={(id) => navigate(`/opportunities/${id}?tab=activities`)}
        />
        {dashboard.nextActions.total > dashboard.nextActions.items.length && (
          <p className="mt-2 text-[11px] text-slate-500">
            Showing {dashboard.nextActions.items.length} of {dashboard.nextActions.total}.
          </p>
        )}
      </Panel>
    );
  };

  return (
    <PageContainer className="gap-3.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {isManagement ? (
            <FilterSelect label="Section" value={section || 'all'} onChange={(v) => setFilter('section', v === 'all' ? '' : v)} className="w-48">
              <option value="all">All sections</option>
              {data?.sectionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </FilterSelect>
          ) : user.section ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-500">Section</span>
              <span className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-600">
                {user.section.name}
              </span>
            </div>
          ) : null}
          {canFilterOwner && (
            <FilterSelect label="Owner" value={owner || 'all'} onChange={(v) => setFilter('owner', v === 'all' ? '' : v)} className="w-44">
              <option value="all">{isManagement ? 'All owners' : 'All on my team'}</option>
              {data?.ownerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.fullName}
                  {option.id === user.id ? ' (me)' : ''}
                  {option.active ? '' : ' (inactive)'}
                </option>
              ))}
            </FilterSelect>
          )}
          <FilterSelect label="Date range" value={range} onChange={(v) => setFilter('range', v === 'all' ? '' : v)} className="w-36">
            {DASHBOARD_RANGES.map((key) => (
              <option key={key} value={key}>
                {DASHBOARD_RANGE_LABELS[key]}
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>

      {error ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : !data ? (
        <LoadingPanel label="Calculating your dashboard…" />
      ) : (
        <div className={`flex flex-col gap-3.5 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <Panel
            title="Opportunities by Stage"
            subtitle={`Click a stage for its list · estimated values, except Awarded (actual awarded value) · Awarded / Lost: ${DASHBOARD_RANGE_LABELS[range].toLowerCase()}${
              data.rangeBounds ? ` by award / lost date (${formatCalendarDate(data.rangeBounds.from)} – ${formatCalendarDate(data.rangeBounds.to)})` : ''
            }`}
            bodyClassName="p-0"
            action={
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => navigate(toOpportunities({ status: 'on_hold' }))}
                  className="text-slate-500 hover:text-slate-800"
                  title="Not in the active pipeline (D-002)"
                >
                  On Hold <strong className="tabular-nums text-amber-700">{data.onHold.count}</strong>
                </button>
                <button
                  type="button"
                  onClick={() => navigate(toOpportunities({ status: 'cancelled' }))}
                  className="text-slate-500 hover:text-slate-800"
                >
                  Cancelled <strong className="tabular-nums text-slate-700">{data.cancelled.count}</strong>
                </button>
                <PanelLink onClick={() => navigate('/opportunities')}>View all →</PanelLink>
              </div>
            }
          >
            <StageFunnel stages={data.stages} onSelect={openStage(data)} />
          </Panel>

          <KpiRow
            pipelineValue={data.kpis.estimatedActivePipeline}
            activeCount={data.kpis.activeOpportunities}
            overdueCount={data.kpis.overdueFollowUps}
            overdueOnHold={data.kpis.overdueFollowUpsOnHold}
            tendersDue7={data.kpis.tendersDueNext7Days}
            awardedQuarter={data.kpis.awardedValueThisQuarter}
            quarterLabel={data.quarter.label}
            scopeNote={data.scopeLabel}
            onOpen={openKpi(data)}
          />

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
            <div className="flex flex-col gap-3.5 lg:col-span-2">
              {data.workload ? (
                <Panel
                  title="Team Workload"
                  subtitle="Active opportunities and open tasks by current owner · click a name for their opportunities, or the overdue count for their tasks"
                  action={isManagement ? <PanelLink onClick={() => navigate('/team')}>Team Management →</PanelLink> : undefined}
                >
                  <TeamWorkload
                    rows={data.workload}
                    currentUserId={user.id}
                    showSection={isManagement}
                    onOpenOwner={(id) => navigate(`/opportunities?view=table&pipeline=active&ownerId=${id}`)}
                    onOpenOverdue={(id) => navigate(`/activities?filter=overdue&owner=${id}`)}
                  />
                </Panel>
              ) : (
                nextPanel(data)
              )}
              {data.sections && (
                <Panel title="Pipeline Value by Section" subtitle="Estimated active pipeline">
                  <SectionPipeline
                    rows={data.sections}
                    onOpen={(id) => navigate(`/opportunities?view=table&pipeline=active&sectionId=${id}${owner ? `&ownerId=${owner}` : ''}`)}
                  />
                </Panel>
              )}
              <Panel
                title="Recent Activity"
                subtitle={`Activity date · ${DASHBOARD_RANGE_LABELS[range].toLowerCase()}`}
                action={<PanelLink onClick={() => navigate('/activities?tab=log')}>View all →</PanelLink>}
              >
                <RecentActivityList activities={data.recentActivity} onOpen={(id) => navigate(`/opportunities/${id}?tab=activities`)} />
              </Panel>
            </div>
            <div className="flex flex-col gap-3.5">
              {data.workload && nextPanel(data)}
              <Panel
                title="Upcoming Tender Deadlines"
                subtitle="Current open bids, soonest first"
                action={<PanelLink onClick={() => navigate('/tenders')}>Tender Tracker →</PanelLink>}
              >
                <TenderDeadlineList tenders={data.upcomingTenders} onOpen={(tender) => navigate(`/opportunities/${tender.opportunityId}?tab=tender`)} />
              </Panel>
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Calculated by the server for {formatCalendarDate(data.today)} (Bangladesh time, UTC+6) over the records your account can see.
          </p>
        </div>
      )}
    </PageContainer>
  );
}
