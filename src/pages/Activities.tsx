import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDaysIcon, ListIcon, MessageSquarePlusIcon, PlusIcon, SearchIcon } from 'lucide-react';
import type { ActivityType } from '../types/crm';
import { useScope } from '../hooks/useScope';
import { ACTIVITY_TYPES, SECTIONS } from '../data/options';
import { visibleTeamMembers } from '../utils/permissions';
import { followUpBucket, type FollowUpBucket } from '../utils/metrics';
import { dhakaParts } from '../utils/format';
import { Button } from '../components/ui/Button';
import { FilterSelect, inputCls } from '../components/ui/FormFields';
import { AccessDenied, EmptyState } from '../components/ui/Feedback';
import { PageContainer, PageHeader, Pagination, SegmentedControl, Tabs } from '../components/ui/Layout';
import { MonthCalendar, type CalendarEvent } from '../components/ui/MonthCalendar';
import { FollowUpList } from '../components/activities/FollowUpList';
import { FollowUpForm } from '../components/activities/FollowUpForm';
import { ActivityForm } from '../components/activities/ActivityForm';
import { ActivityTimeline } from '../components/activities/ActivityTimeline';

type Filter = 'open' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'all';
const FILTERS: {id: Filter;label: string;}[] = [
{ id: 'open', label: 'All open' },
{ id: 'overdue', label: 'Overdue' },
{ id: 'today', label: 'Today' },
{ id: 'upcoming', label: 'Upcoming' },
{ id: 'completed', label: 'Completed' },
{ id: 'all', label: 'All' }];

const PAGE_SIZE = 12;

export function Activities() {
  const scope = useScope();
  const { user, users } = scope;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [fuOpen, setFuOpen] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const [month, setMonth] = useState({ y: 2026, m: 9 });

  const p = (k: string, d = '') => params.get(k) ?? d;
  const tab = p('tab', 'followups') as 'followups' | 'log';
  const view = p('view', 'list') as 'list' | 'calendar';
  const filter = p('filter', 'open') as Filter;
  const assignee = p('assignee');
  const owner = p('owner');
  const section = user.role === 'management' ? p('section') : '';
  const type = p('type');
  const q = p('q');
  const page = Number(p('page', '1')) || 1;

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const members = visibleTeamMembers(user, users);
  const assigneeOptions = user.role === 'management' ? [user, ...members] : members;

  const oppMatches = useMemo(() => {
    const ids = new Set(
      scope.opportunities.filter((o) => (!owner || o.ownerId === owner) && (!section || o.sectionId === section)).map((o) => o.id)
    );
    return ids;
  }, [scope.opportunities, owner, section]);

  const baseFollowUps = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scope.followUps.filter(
      (f) =>
      oppMatches.has(f.oppId) && (
      !assignee || f.assigneeId === assignee) && (
      !term || f.title.toLowerCase().includes(term) || (scope.opportunities.find((o) => o.id === f.oppId)?.name.toLowerCase().includes(term) ?? false))
    );
  }, [scope, oppMatches, assignee, q]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { open: 0, today: 0, upcoming: 0, overdue: 0, completed: 0, all: baseFollowUps.length };
    baseFollowUps.forEach((f) => {
      const b = followUpBucket(f);
      c[b] += 1;
      if (b !== 'completed') c.open += 1;
    });
    return c;
  }, [baseFollowUps]);

  const followUps = baseFollowUps.
  filter((f) => {
    const b: FollowUpBucket = followUpBucket(f);
    if (filter === 'all') return true;
    if (filter === 'open') return b !== 'completed';
    return b === filter;
  }).
  sort((a, b) => filter === 'completed' ? b.completedAt.localeCompare(a.completedAt) : a.due.localeCompare(b.due));

  const activities = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scope.activities.
    filter((a) => oppMatches.has(a.oppId) && (!type || a.type === type) && (!assignee || a.createdBy === assignee) && (!term || a.subject.toLowerCase().includes(term) || a.notes.toLowerCase().includes(term))).
    sort((a, b) => b.at.localeCompare(a.at));
  }, [scope.activities, oppMatches, type, assignee, q]);

  if (!scope.salesAccess) return <AccessDenied message="The System Administrator role does not have access to sales records." />;

  const listRows = tab === 'followups' ? followUps : activities;
  const pageCount = Math.max(1, Math.ceil(listRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const slice = <T,>(arr: T[]) => arr.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const oppName = (id: string) => scope.opportunities.find((o) => o.id === id)?.name ?? '';
  const events: CalendarEvent[] = [
  ...baseFollowUps.map((f) => {
    const b = followUpBucket(f);
    return {
      id: f.id,
      date: f.due,
      label: `${b === 'completed' ? '✓ ' : ''}${f.title}`,
      tone: (b === 'overdue' ? 'red' : b === 'today' ? 'amber' : b === 'completed' ? 'green' : 'slate') as CalendarEvent['tone'],
      onClick: () => navigate(`/opportunities/${f.oppId}?tab=activities`)
    };
  }),
  ...(tab === 'log' ?
  activities.map((a) => ({
    id: a.id,
    date: dhakaParts(a.at).date,
    label: `${a.type}: ${oppName(a.oppId)}`,
    tone: 'teal' as const,
    onClick: () => navigate(`/opportunities/${a.oppId}?tab=activities`)
  })) :
  [])];


  return (
    <PageContainer>
      <PageHeader
        title="Activities & Follow-ups"
        subtitle="Daily follow-up work and activity history for your accessible opportunities"
        actions={
        <>
            <SegmentedControl
            label="View"
            value={view}
            onChange={(v) => update({ view: v === 'list' ? '' : v })}
            options={[
            { id: 'list', label: 'List', icon: <ListIcon className="h-3.5 w-3.5" /> },
            { id: 'calendar', label: 'Calendar', icon: <CalendarDaysIcon className="h-3.5 w-3.5" /> }]
            } />
          
            <Button icon={<MessageSquarePlusIcon className="h-4 w-4" />} onClick={() => setActOpen(true)}>
              Log Activity
            </Button>
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setFuOpen(true)}>
              Quick Add Follow-up
            </Button>
          </>
        } />
      

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4 pt-2">
          <Tabs
            active={tab}
            onChange={(t) => update({ tab: t === 'followups' ? '' : t })}
            tabs={[
            { id: 'followups', label: 'Follow-ups', count: counts.open },
            { id: 'log', label: 'Activity Log', count: activities.length }]
            } />
          
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 px-4 py-3">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Search</span>
            <span className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => update({ q: e.target.value })} placeholder={tab === 'followups' ? 'Task or opportunity…' : 'Subject or notes…'} className={inputCls(undefined, 'h-9 pl-8 text-[13px]')} />
            </span>
          </label>
          {user.role !== 'sales' &&
          <FilterSelect label={tab === 'followups' ? 'Assigned to' : 'Logged by'} value={assignee} onChange={(v) => update({ assignee: v })} className="w-44">
              <option value="">Everyone in scope</option>
              {assigneeOptions.map((m) =>
            <option key={m.id} value={m.id}>
                  {m.name}
                  {m.id === user.id ? ' (me)' : ''}
                </option>
            )}
            </FilterSelect>
          }
          {user.role !== 'sales' &&
          <FilterSelect label="Opportunity owner" value={owner} onChange={(v) => update({ owner: v })} className="w-44">
              <option value="">All owners</option>
              {members.map((m) =>
            <option key={m.id} value={m.id}>
                  {m.name}
                </option>
            )}
            </FilterSelect>
          }
          {user.role === 'management' &&
          <FilterSelect label="Section" value={section} onChange={(v) => update({ section: v })} className="w-48">
              <option value="">All sections</option>
              {SECTIONS.map((s) =>
            <option key={s.id} value={s.id}>
                  {s.name}
                </option>
            )}
            </FilterSelect>
          }
          {tab === 'log' &&
          <FilterSelect label="Type" value={type} onChange={(v) => update({ type: v })} className="w-40">
              <option value="">All types</option>
              {ACTIVITY_TYPES.map((t: ActivityType) =>
            <option key={t}>{t}</option>
            )}
            </FilterSelect>
          }
        </div>

        {tab === 'followups' &&
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 px-4 py-2.5" role="group" aria-label="Follow-up filter">
            {FILTERS.map((f) => {
            const active = filter === f.id;
            const tone = f.id === 'overdue' && counts.overdue > 0 ? 'text-red-700' : '';
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => update({ filter: f.id === 'open' ? '' : f.id })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 ${
                active ? 'border-navy bg-navy text-white' : `border-slate-200 bg-white text-slate-600 hover:bg-slate-50 ${tone}`}`
                }>
                
                  {f.label}
                  <span className={`tabular-nums ${active ? 'text-white/70' : 'text-slate-400'}`}>{counts[f.id]}</span>
                </button>);

          })}
          </div>
        }

        {view === 'calendar' ?
        <div className="p-4">
            <MonthCalendar year={month.y} month={month.m} events={events} onMonthChange={(y, m) => setMonth({ y, m })} />
            <p className="mt-2 text-xs text-slate-500">Red: overdue · Amber: due today · Grey: upcoming · Green: completed{tab === 'log' ? ' · Teal: logged activity' : ''}</p>
          </div> :
        tab === 'followups' ?
        followUps.length ?
        <>
              <div className="px-4">
                <FollowUpList followUps={slice(followUps)} opportunities={scope.opportunities} users={users} />
              </div>
              <Pagination page={safePage} pageCount={pageCount} total={followUps.length} pageSize={PAGE_SIZE} onChange={(pg) => update({ page: String(pg) })} />
            </> :

        <EmptyState title="No follow-ups in this view" description={filter === 'overdue' ? 'Nothing overdue — nice work.' : 'Try another filter or add a follow-up.'} /> :

        activities.length ?
        <>
            <div className="px-4 pt-4">
              <ActivityTimeline activities={slice(activities)} users={users} contacts={scope.contacts} opportunities={scope.opportunities} />
            </div>
            <Pagination page={safePage} pageCount={pageCount} total={activities.length} pageSize={PAGE_SIZE} onChange={(pg) => update({ page: String(pg) })} />
          </> :

        <EmptyState title="No activities found" description="Log a meeting, call or visit to start the record." />
        }
      </div>

      <FollowUpForm open={fuOpen} onClose={() => setFuOpen(false)} />
      <ActivityForm open={actOpen} onClose={() => setActOpen(false)} />
    </PageContainer>);

}