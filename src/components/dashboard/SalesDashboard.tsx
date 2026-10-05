import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { SectionId, Stage } from '../../types/crm';
import { useScope } from '../../hooks/useScope';
import { PIPELINE_STAGES, SECTIONS, sectionName } from '../../data/options';
import { DATE_RANGE_LABELS, inDateRange, QUARTER_END, QUARTER_START, type DateRangeKey } from '../../utils/demoClock';
import { followUpBucket, isActiveOpp, isTenderDueWithin, isTenderOpen, pipelineValue } from '../../utils/metrics';
import { userName as lookupUser } from '../../utils/lookup';
import { visibleTeamMembers } from '../../utils/permissions';
import { PageContainer, Panel, PanelLink } from '../ui/Layout';
import { FilterSelect } from '../ui/FormFields';
import { StageFunnel, type FunnelStage } from './StageFunnel';
import { KpiRow } from './KpiRow';
import { TeamWorkload, type WorkloadRow } from './TeamWorkload';
import { NextActionsList, RecentActivityList, TenderDeadlineList, type NextActionItem } from './DashboardLists';
import { SectionPipeline } from './SectionPipeline';

export function SalesDashboard() {
  const scope = useScope();
  const { user, users } = scope;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const isMgmt = user.role === 'management';
  const canFilterOwner = isMgmt || user.role === 'lead';
  const section = isMgmt ? params.get('section') ?? 'all' : 'all';
  const members = visibleTeamMembers(user, users).filter((m) => section === 'all' || m.sectionId === section);
  const ownerParam = params.get('owner');
  const owner = canFilterOwner && ownerParam && members.some((m) => m.id === ownerParam) ? ownerParam : 'all';
  const rangeParam = params.get('range') as DateRangeKey | null;
  const range: DateRangeKey = rangeParam && rangeParam in DATE_RANGE_LABELS ? rangeParam : 'all';

  const setFilter = (key: string, value: string, def: string) => {
    const next = new URLSearchParams(params);
    if (value === def) next.delete(key);else
    next.set(key, value);
    if (key === 'section') next.delete('owner');
    setParams(next, { replace: true });
  };

  const data = useMemo(() => {
    const opps = scope.opportunities.filter((o) => (section === 'all' || o.sectionId === section) && (owner === 'all' || o.ownerId === owner));
    const ids = new Set(opps.map((o) => o.id));
    const followUps = scope.followUps.filter((f) => ids.has(f.oppId));
    const tenders = scope.tenders.filter((t) => ids.has(t.oppId));
    const activities = scope.activities.filter((a) => ids.has(a.oppId));
    return { opps, followUps, tenders, activities };
  }, [scope, section, owner]);

  const { opps, followUps, tenders, activities } = data;
  const active = opps.filter(isActiveOpp);
  const overdue = followUps.filter((f) => followUpBucket(f) === 'overdue');
  const due7 = tenders.filter((t) => isTenderDueWithin(t, 7));
  const awardedQuarter = opps.
  filter((o) => o.stage === 'Awarded' && o.awardDate >= QUARTER_START && o.awardDate <= QUARTER_END).
  reduce((s, o) => s + (o.awardedValue ?? 0), 0);

  const funnel: FunnelStage[] = [
  ...PIPELINE_STAGES.map((stage) => {
    const list = opps.filter((o) => o.stage === stage);
    return { stage, count: list.length, value: list.reduce((s, o) => s + o.estimatedValue, 0), kind: 'open' as const };
  }),
  (() => {
    const list = opps.filter((o) => o.stage === 'Awarded' && inDateRange(o.awardDate || o.closedAt, range));
    return { stage: 'Awarded' as Stage, count: list.length, value: list.reduce((s, o) => s + (o.awardedValue ?? 0), 0), kind: 'awarded' as const };
  })(),
  (() => {
    const list = opps.filter((o) => o.stage === 'Lost' && inDateRange(o.closedAt, range));
    return { stage: 'Lost' as Stage, count: list.length, value: list.reduce((s, o) => s + o.estimatedValue, 0), kind: 'lost' as const };
  })()];

  const onHold = opps.filter((o) => o.stage === 'On Hold').length;
  const cancelled = opps.filter((o) => o.stage === 'Cancelled').length;

  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    if (section !== 'all') q.set('section', section);
    if (owner !== 'all') q.set('owner', owner);
    Object.entries(extra).forEach(([k, v]) => q.set(k, v));
    return q.toString();
  };

  const nameOf = (id: string) => lookupUser(users, id);
  const oppName = (id: string) => scope.opportunities.find((o) => o.id === id)?.name ?? '—';

  // Next actions: the selected owner's (or my own) open follow-ups plus next actions on opportunities they own.
  const target = owner !== 'all' ? owner : user.id;
  const nextActions: NextActionItem[] = [
  ...followUps.
  filter((f) => f.status === 'Open' && f.assigneeId === target).
  map((f) => ({ id: f.id, title: f.title, oppId: f.oppId, oppName: oppName(f.oppId), due: f.due, ownerName: nameOf(f.assigneeId), kind: 'Follow-up' as const })),
  ...active.
  filter((o) => o.ownerId === target && o.nextAction && o.nextActionDue).
  filter((o) => !followUps.some((f) => f.status === 'Open' && f.oppId === o.id && f.title === o.nextAction)).
  map((o) => ({ id: `na-${o.id}`, title: o.nextAction, oppId: o.id, oppName: o.name, due: o.nextActionDue, ownerName: nameOf(o.ownerId), kind: 'Next action' as const }))].
  sort((a, b) => a.due.localeCompare(b.due));

  const openTenders = tenders.filter(isTenderOpen).sort((a, b) => a.submissionDeadline.localeCompare(b.submissionDeadline)).slice(0, 5);
  const recent = activities.
  filter((a) => inDateRange(a.at.slice(0, 10), range)).
  sort((a, b) => b.at.localeCompare(a.at)).
  slice(0, 6);

  const workload: WorkloadRow[] = members.map((m) => {
    const mine = scope.opportunities.filter((o) => o.ownerId === m.id);
    const mineIds = new Set(mine.map((o) => o.id));
    const tasks = scope.followUps.filter((f) => f.assigneeId === m.id && f.status === 'Open');
    return {
      user: m,
      active: mine.filter(isActiveOpp).length,
      pipeline: pipelineValue(mine),
      openTasks: tasks.length,
      overdue: tasks.filter((f) => followUpBucket(f) === 'overdue').length,
      tendersDue: scope.tenders.filter((t) => mineIds.has(t.oppId) && isTenderDueWithin(t, 7)).length
    };
  });

  const sectionRows = SECTIONS.map((s) => {
    const list = scope.opportunities.filter((o) => o.sectionId === s.id && isActiveOpp(o) && (owner === 'all' || o.ownerId === owner));
    return { id: s.id, name: s.name, value: pipelineValue(list), count: list.length };
  });

  const scopeNote = isMgmt ?
  section === 'all' ?
  'Organization-wide' :
  sectionName(section) :
  user.role === 'lead' ?
  'Team scope' :
  'My opportunities';

  const subtitle =
  user.role === 'management' ?
  'Organization-wide pipeline across both sections' :
  user.role === 'lead' ?
  `${sectionName(user.sectionId)} section — ${user.name}'s team view` :
  `Your opportunities, follow-ups and tenders`;

  const openKpi = (t: 'pipeline' | 'active' | 'overdue' | 'tenders' | 'awarded') => {
    if (t === 'pipeline' || t === 'active') navigate(`/opportunities?${query({ status: 'active', view: 'table' })}`);
    if (t === 'overdue') navigate(`/activities?${query({ filter: 'overdue' })}`);
    if (t === 'tenders') navigate(`/tenders?${query({ deadline: '7d' })}`);
    if (t === 'awarded') navigate(`/opportunities?${query({ stage: 'Awarded', view: 'table' })}`);
  };

  const showWorkload = canFilterOwner;
  const nextTitle = target === user.id ? 'My Next Actions' : `Next Actions — ${nameOf(target)}`;

  const nextPanel =
  <Panel title={nextTitle} subtitle="Follow-ups and opportunity next actions" action={<PanelLink onClick={() => navigate(`/activities?filter=open&assignee=${target}`)}>View all →</PanelLink>}>
      <NextActionsList items={nextActions.slice(0, 7)} showOwner={target !== user.id} onOpen={(id) => navigate(`/opportunities/${id}`)} />
    </Panel>;

  const recentPanel =
  <Panel title="Recent Activity" action={<PanelLink onClick={() => navigate('/activities?tab=log')}>View all →</PanelLink>}>
      <RecentActivityList activities={recent} userName={nameOf} oppName={oppName} onOpen={(id) => navigate(`/opportunities/${id}?tab=activities`)} />
    </Panel>;


  return (
    <PageContainer className="gap-3.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {isMgmt ?
          <FilterSelect label="Section" value={section} onChange={(v) => setFilter('section', v, 'all')} className="w-48">
              <option value="all">All sections</option>
              {SECTIONS.map((s) =>
            <option key={s.id} value={s.id}>
                  {s.name}
                </option>
            )}
            </FilterSelect> :
          user.sectionId ?
          <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-500">Section</span>
              <span className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-600">{sectionName(user.sectionId)}</span>
            </div> :
          null}
          {canFilterOwner &&
          <FilterSelect label="Owner" value={owner} onChange={(v) => setFilter('owner', v, 'all')} className="w-44">
              <option value="all">{isMgmt ? 'All owners' : 'All on my team'}</option>
              {members.map((m) =>
            <option key={m.id} value={m.id}>
                  {m.name}
                  {m.id === user.id ? ' (me)' : ''}
                </option>
            )}
            </FilterSelect>
          }
          <FilterSelect label="Date range" value={range} onChange={(v) => setFilter('range', v, 'all')} className="w-36">
            {(Object.keys(DATE_RANGE_LABELS) as DateRangeKey[]).map((k) =>
            <option key={k} value={k}>
                {DATE_RANGE_LABELS[k]}
              </option>
            )}
          </FilterSelect>
        </div>
      </div>

      <Panel
        title="Opportunities by Stage"
        subtitle={`Click any stage to open its filtered list · Awarded / Lost and Recent Activity follow the date range (${DATE_RANGE_LABELS[range].toLowerCase()})`}
        bodyClassName="p-0"
        action={
        <div className="flex items-center gap-3 text-xs">
            <button type="button" onClick={() => navigate(`/opportunities?${query({ stage: 'On Hold', view: 'table' })}`)} className="text-slate-500 hover:text-slate-800">
              On Hold <strong className="tabular-nums text-amber-700">{onHold}</strong>
            </button>
            <button type="button" onClick={() => navigate(`/opportunities?${query({ stage: 'Cancelled', view: 'table' })}`)} className="text-slate-500 hover:text-slate-800">
              Cancelled <strong className="tabular-nums text-slate-700">{cancelled}</strong>
            </button>
            <PanelLink onClick={() => navigate(`/opportunities?${query({ view: 'kanban' })}`)}>View all →</PanelLink>
          </div>
        }>
        
        <StageFunnel stages={funnel} onSelect={(stage) => navigate(`/opportunities?${query({ stage, view: 'table' })}`)} />
      </Panel>

      <KpiRow
        pipelineValue={pipelineValue(opps)}
        activeCount={active.length}
        overdueCount={overdue.length}
        tendersDue7={due7.length}
        awardedQuarter={awardedQuarter}
        scopeNote={scopeNote}
        onOpen={openKpi} />
      

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <div className="flex flex-col gap-3.5 lg:col-span-2">
          {showWorkload ?
          <Panel
            title="Team Workload"
            subtitle="Click a name for their opportunities, or the overdue count for their tasks"
            action={isMgmt ? <PanelLink onClick={() => navigate('/team')}>Team Management →</PanelLink> : undefined}>
            
              <TeamWorkload
              rows={workload}
              currentUserId={user.id}
              showSection={isMgmt}
              onOpenOwner={(id) => navigate(`/opportunities?owner=${id}&view=table`)}
              onOpenOverdue={(id) => navigate(`/activities?filter=overdue&assignee=${id}`)} />
            
            </Panel> :

          nextPanel
          }
          {isMgmt &&
          <Panel title="Pipeline Value by Section" subtitle="Estimated active pipeline">
              <SectionPipeline rows={sectionRows} onOpen={(id: SectionId) => navigate(`/opportunities?section=${id}&status=active&view=table`)} />
            </Panel>
          }
          {recentPanel}
        </div>
        <div className="flex flex-col gap-3.5">
          {showWorkload && nextPanel}
          <Panel title="Upcoming Tender Deadlines" subtitle="Open bids, soonest first" action={<PanelLink onClick={() => navigate('/tenders')}>Tender Tracker →</PanelLink>}>
            <TenderDeadlineList tenders={openTenders} oppName={oppName} onOpen={(id) => navigate(`/tenders/${id}`)} />
          </Panel>
        </div>
      </div>
    </PageContainer>);

}