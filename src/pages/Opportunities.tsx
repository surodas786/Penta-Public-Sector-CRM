import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DownloadIcon, KanbanSquareIcon, PlusIcon, SearchIcon, TableIcon, XIcon } from 'lucide-react';
import type { Opportunity, Stage } from '../types/crm';
import { useCrm } from '../contexts/CrmContext';
import { useScope } from '../hooks/useScope';
import { ALL_STAGES, PRIORITIES, SECTIONS, SOLUTION_CATEGORIES, sectionName } from '../data/options';
import { visibleTeamMembers } from '../utils/permissions';
import { isActiveOpp } from '../utils/metrics';
import { orgName, userName } from '../utils/lookup';
import { stageNeedsInput } from '../utils/validation';
import { downloadCsv } from '../utils/csv';
import { formatDate } from '../utils/format';
import { Button } from '../components/ui/Button';
import { FilterSelect, inputCls } from '../components/ui/FormFields';
import { AccessDenied, EmptyState } from '../components/ui/Feedback';
import { PageContainer, PageHeader, Pagination, SegmentedControl } from '../components/ui/Layout';
import { KanbanBoard } from '../components/opportunities/KanbanBoard';
import { OpportunityTable, type OppSortKey } from '../components/opportunities/OpportunityTable';
import { OpportunityForm } from '../components/opportunities/OpportunityForm';
import { StageChangeModal } from '../components/opportunities/StageChangeModal';

const PAGE_SIZE = 10;

export function Opportunities() {
  const scope = useScope();
  const { changeStage } = useCrm();
  const { user, users } = scope;
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [stageReq, setStageReq] = useState<{opp: Opportunity;stage: Stage;} | null>(null);

  const p = (k: string, d = '') => params.get(k) ?? d;
  const view = p('view', 'kanban') as 'kanban' | 'table';
  const q = p('q');
  const stage = p('stage');
  const org = p('org');
  const owner = p('owner');
  const section = user.role === 'management' ? p('section') : '';
  const category = p('category');
  const priority = p('priority');
  const status = p('status', 'all');
  const awardFrom = p('awardFrom');
  const awardTo = p('awardTo');
  const sort = p('sort', 'due') as OppSortKey;
  const dir = p('dir', 'asc') as 'asc' | 'desc';
  const page = Number(p('page', '1')) || 1;

  const update = (patch: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => v ? next.set(k, v) : next.delete(k));
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const members = visibleTeamMembers(user, users).filter((m) => !section || m.sectionId === section);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scope.opportunities.filter((o) => {
      if (term && ![o.name, o.description, orgName(scope.organizations, o.orgId), o.department].some((v) => v.toLowerCase().includes(term))) return false;
      if (stage && o.stage !== stage) return false;
      if (org && o.orgId !== org) return false;
      if (owner && o.ownerId !== owner) return false;
      if (section && o.sectionId !== section) return false;
      if (category && o.category !== category) return false;
      if (priority && o.priority !== priority) return false;
      if (status === 'active' && !isActiveOpp(o)) return false;
      if (status === 'closed' && isActiveOpp(o)) return false;
      if (awardFrom && (!o.expectedAwardDate || o.expectedAwardDate < awardFrom)) return false;
      if (awardTo && (!o.expectedAwardDate || o.expectedAwardDate > awardTo)) return false;
      return true;
    });
  }, [scope, q, stage, org, owner, section, category, priority, status, awardFrom, awardTo]);

  const sorted = useMemo(() => {
    const val = (o: Opportunity): string | number => {
      switch (sort) {
        case 'name':
          return o.name.toLowerCase();
        case 'org':
          return orgName(scope.organizations, o.orgId).toLowerCase();
        case 'stage':
          return ALL_STAGES.indexOf(o.stage);
        case 'owner':
          return userName(users, o.ownerId).toLowerCase();
        case 'value':
          return o.estimatedValue;
        case 'award':
          return o.expectedAwardDate || '9999';
        case 'priority':
          return PRIORITIES.indexOf(o.priority);
        default:
          return isActiveOpp(o) && o.nextActionDue ? o.nextActionDue : '9999';
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return dir === 'asc' ? c : -c;
    });
  }, [filtered, sort, dir, scope.organizations, users]);

  if (!scope.salesAccess) return <AccessDenied message="The System Administrator role does not have access to sales records." />;

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeFilters = [q, stage, org, owner, section, category, priority, awardFrom, awardTo].filter(Boolean).length + (status !== 'all' ? 1 : 0);

  const open = (id: string) => navigate(`/opportunities/${id}`, { state: { from: location.pathname + location.search } });

  const handleMove = (opp: Opportunity, target: Stage) => {
    if (stageNeedsInput(opp, target)) {
      setStageReq({ opp, stage: target });
      return;
    }
    const res = changeStage(opp.id, target);
    if (res.ok) toast.success(`Moved to ${target}`, { description: opp.name });else
    toast.error(res.error ?? 'Could not change stage.');
  };

  const exportCsv = () => {
    downloadCsv(
      `penta-opportunities-${user.name.toLowerCase().replace(/\s+/g, '-')}.csv`,
      ['Opportunity', 'Organization', 'Section', 'Owner', 'Stage', 'Category', 'Estimated value (BDT)', 'Expected award', 'Next action', 'Next action due', 'Priority'],
      sorted.map((o) => [
      o.name,
      orgName(scope.organizations, o.orgId),
      sectionName(o.sectionId),
      userName(users, o.ownerId),
      o.stage,
      o.category,
      o.estimatedValue,
      formatDate(o.expectedAwardDate),
      o.nextAction,
      formatDate(o.nextActionDue),
      o.priority]
      )
    );
    toast.success(`Exported ${sorted.length} permitted opportunities`);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Opportunities"
        subtitle={`${filtered.length} of ${scope.opportunities.length} accessible opportunities · archived (Awarded, Lost, Cancelled) remain searchable`}
        actions={
        <>
            <SegmentedControl
            label="View"
            value={view}
            onChange={(v) => update({ view: v === 'kanban' ? '' : v }, false)}
            options={[
            { id: 'kanban', label: 'Pipeline', icon: <KanbanSquareIcon className="h-3.5 w-3.5" /> },
            { id: 'table', label: 'Table', icon: <TableIcon className="h-3.5 w-3.5" /> }]
            } />
          
            <Button icon={<DownloadIcon className="h-4 w-4" />} onClick={exportCsv} disabled={!sorted.length}>
              Export CSV
            </Button>
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
              Add Opportunity
            </Button>
          </>
        } />
      

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-[minmax(200px,1.4fr)_repeat(6,minmax(0,1fr))]">
          <label className="col-span-2 flex flex-col gap-1 md:col-span-4 xl:col-span-1">
            <span className="text-[11px] font-semibold text-slate-500">Search</span>
            <span className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => update({ q: e.target.value })} placeholder="Name, organization, description…" className={inputCls(undefined, 'h-9 pl-8 text-[13px]')} />
            </span>
          </label>
          <FilterSelect label="Stage" value={stage} onChange={(v) => update({ stage: v })}>
            <option value="">All stages</option>
            {ALL_STAGES.map((s) =>
            <option key={s}>{s}</option>
            )}
          </FilterSelect>
          <FilterSelect label="Status" value={status} onChange={(v) => update({ status: v === 'all' ? '' : v })}>
            <option value="all">Active &amp; closed</option>
            <option value="active">Active only</option>
            <option value="closed">Closed / archived</option>
          </FilterSelect>
          <FilterSelect label="Organization" value={org} onChange={(v) => update({ org: v })}>
            <option value="">All organizations</option>
            {scope.organizations.map((o) =>
            <option key={o.id} value={o.id}>
                {o.name}
              </option>
            )}
          </FilterSelect>
          {user.role === 'management' ?
          <FilterSelect label="Section" value={section} onChange={(v) => update({ section: v, owner: '' })}>
              <option value="">All sections</option>
              {SECTIONS.map((s) =>
            <option key={s.id} value={s.id}>
                  {s.name}
                </option>
            )}
            </FilterSelect> :

          <FilterSelect label="Priority" value={priority} onChange={(v) => update({ priority: v })}>
              <option value="">All priorities</option>
              {PRIORITIES.map((pr) =>
            <option key={pr}>{pr}</option>
            )}
            </FilterSelect>
          }
          <FilterSelect label="Owner" value={owner} onChange={(v) => update({ owner: v })}>
            <option value="">{user.role === 'sales' ? 'Me' : 'All owners'}</option>
            {members.map((m) =>
            <option key={m.id} value={m.id}>
                {m.name}
              </option>
            )}
          </FilterSelect>
          <FilterSelect label="Solution category" value={category} onChange={(v) => update({ category: v })}>
            <option value="">All categories</option>
            {SOLUTION_CATEGORIES.map((c) =>
            <option key={c}>{c}</option>
            )}
          </FilterSelect>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Expected award from</span>
            <input type="date" value={awardFrom} onChange={(e) => update({ awardFrom: e.target.value })} className={inputCls(undefined, 'h-9 w-40 py-1.5 text-[13px]')} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Expected award to</span>
            <input type="date" value={awardTo} onChange={(e) => update({ awardTo: e.target.value })} className={inputCls(undefined, 'h-9 w-40 py-1.5 text-[13px]')} />
          </label>
          {activeFilters > 0 &&
          <Button
            variant="ghost"
            size="sm"
            className="mb-0.5"
            icon={<XIcon className="h-3.5 w-3.5" />}
            onClick={() => setParams(view === 'table' ? { view: 'table' } : {}, { replace: true })}>
            
              Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
            </Button>
          }
        </div>
      </div>

      {filtered.length === 0 ?
      <div className="rounded-lg border border-slate-200 bg-white">
          <EmptyState
          title={scope.opportunities.length ? 'No opportunities match these filters' : 'No opportunities yet'}
          description={scope.opportunities.length ? 'Adjust or clear the filters to see more.' : 'Create your first opportunity to start tracking the pipeline.'}
          action={
          <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                Add Opportunity
              </Button>
          } />
        
        </div> :
      view === 'kanban' ?
      <>
          <p className="-mb-2 text-xs text-slate-500">Drag a card to another column to change its stage. Awarded, Lost, On Hold and Cancelled ask for the required details.</p>
          <KanbanBoard opportunities={sorted} organizations={scope.organizations} users={users} onOpen={open} onMove={handleMove} />
        </> :

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <OpportunityTable
          rows={pageRows}
          organizations={scope.organizations}
          users={users}
          sort={sort}
          dir={dir}
          showSection={user.role === 'management'}
          onSort={(k) => update({ sort: k, dir: sort === k && dir === 'asc' ? 'desc' : 'asc' }, false)}
          onOpen={open} />
        
          <Pagination page={safePage} pageCount={pageCount} total={sorted.length} pageSize={PAGE_SIZE} onChange={(pg) => update({ page: String(pg) }, false)} />
        </div>
      }

      <OpportunityForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={open} />
      <StageChangeModal opportunity={stageReq?.opp ?? null} targetStage={stageReq?.stage ?? null} onClose={() => setStageReq(null)} />
    </PageContainer>);

}