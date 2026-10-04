import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDaysIcon, PlusIcon, TableIcon } from 'lucide-react';
import type { Tender } from '../types/crm';
import { useScope } from '../hooks/useScope';
import { BID_STATUSES, SECTIONS } from '../data/options';
import { visibleTeamMembers } from '../utils/permissions';
import { isTenderDueWithin, isTenderOpen, tenderIndicator } from '../utils/metrics';
import { DEMO_DATE_LABEL, DEMO_NOW } from '../utils/demoClock';
import { dhakaParts, formatDate, formatDateTime } from '../utils/format';
import { userName } from '../utils/lookup';
import { Button } from '../components/ui/Button';
import { FilterSelect } from '../components/ui/FormFields';
import { AccessDenied, EmptyState } from '../components/ui/Feedback';
import { BidStatusBadge, TenderIndicator } from '../components/ui/Badges';
import { PageContainer, PageHeader, SegmentedControl, SortHeader, tdCls, thCls } from '../components/ui/Layout';
import { MonthCalendar, type CalendarEvent } from '../components/ui/MonthCalendar';
import { TenderForm } from '../components/tenders/TenderForm';
import { MarkSubmittedModal } from '../components/tenders/MarkSubmittedModal';

const LEGEND = [
['bg-red-600', 'Red — deadline passed, bid not submitted'],
['bg-amber-500', 'Amber — due within 3 days'],
['bg-slate-400', 'Neutral — later deadline'],
['bg-green-600', 'Green — submitted']];


export function Tenders() {
  const scope = useScope();
  const { user, users } = scope;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState<Tender | null>(null);
  const [month, setMonth] = useState({ y: 2026, m: 9 });

  const p = (k: string, d = '') => params.get(k) ?? d;
  const view = p('view', 'table') as 'table' | 'calendar';
  const owner = p('owner');
  const section = user.role === 'management' ? p('section') : '';
  const status = p('status');
  const deadline = p('deadline');
  const dir = p('dir', 'asc') as 'asc' | 'desc';

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    return scope.tenders.
    filter((t) => {
      const opp = scope.opportunities.find((o) => o.id === t.oppId);
      if (!opp) return false;
      if (owner && t.ownerId !== owner && opp.ownerId !== owner) return false;
      if (section && opp.sectionId !== section) return false;
      if (status && t.bidStatus !== status) return false;
      if (deadline === '3d' && !isTenderDueWithin(t, 3)) return false;
      if (deadline === '7d' && !isTenderDueWithin(t, 7)) return false;
      if (deadline === '30d' && !isTenderDueWithin(t, 30)) return false;
      if (deadline === 'missed' && tenderIndicator(t) !== 'missed') return false;
      if (deadline === 'upcoming' && new Date(t.submissionDeadline) < new Date(DEMO_NOW)) return false;
      return true;
    }).
    sort((a, b) => (dir === 'asc' ? 1 : -1) * a.submissionDeadline.localeCompare(b.submissionDeadline));
  }, [scope, owner, section, status, deadline, dir]);

  if (!scope.salesAccess) return <AccessDenied message="The System Administrator role does not have access to sales records." />;

  const oppName = (id: string) => scope.opportunities.find((o) => o.id === id)?.name ?? '—';
  const members = visibleTeamMembers(user, users);
  const toneOf = (t: Tender): CalendarEvent['tone'] => {
    const k = tenderIndicator(t);
    return k === 'missed' ? 'red' : k === 'due-soon' ? 'amber' : k === 'submitted' ? 'green' : 'slate';
  };
  const events: CalendarEvent[] = rows.map((t) => ({
    id: t.id,
    date: dhakaParts(t.submissionDeadline).date,
    label: `${dhakaParts(t.submissionDeadline).time} ${t.reference}`,
    tone: toneOf(t),
    onClick: () => navigate(`/tenders/${t.id}`)
  }));

  return (
    <PageContainer>
      <PageHeader
        title="Tender Tracker"
        subtitle={
        <>
            Deadline indicators calculated against the fixed demo date <strong className="text-slate-700">{DEMO_DATE_LABEL}, 10:00 BST</strong>. Manual records only — no e-GP integration.
          </>
        }
        actions={
        <>
            <SegmentedControl
            label="View"
            value={view}
            onChange={(v) => update({ view: v === 'table' ? '' : v })}
            options={[
            { id: 'table', label: 'Table', icon: <TableIcon className="h-3.5 w-3.5" /> },
            { id: 'calendar', label: 'Calendar', icon: <CalendarDaysIcon className="h-3.5 w-3.5" /> }]
            } />
          
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
              Add Tender
            </Button>
          </>
        } />
      

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-2">
          {user.role !== 'sales' &&
          <FilterSelect label="Owner" value={owner} onChange={(v) => update({ owner: v })} className="w-44">
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
          <FilterSelect label="Bid status" value={status} onChange={(v) => update({ status: v })} className="w-40">
            <option value="">All statuses</option>
            {BID_STATUSES.map((s) =>
            <option key={s}>{s}</option>
            )}
          </FilterSelect>
          <FilterSelect label="Deadline" value={deadline} onChange={(v) => update({ deadline: v })} className="w-44">
            <option value="">Any deadline</option>
            <option value="upcoming">Not yet passed</option>
            <option value="3d">Open, due within 3 days</option>
            <option value="7d">Open, due within 7 days</option>
            <option value="30d">Open, due within 30 days</option>
            <option value="missed">Missed (not submitted)</option>
          </FilterSelect>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          {LEGEND.map(([dot, label]) =>
          <li key={label} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
              {label}
            </li>
          )}
        </ul>
      </div>

      {view === 'calendar' ?
      <MonthCalendar year={month.y} month={month.m} events={events} onMonthChange={(y, m) => setMonth({ y, m })} /> :
      rows.length === 0 ?
      <div className="rounded-lg border border-slate-200 bg-white">
          <EmptyState title="No tenders match" description="Adjust filters, or add a tender to an opportunity in your scope." />
        </div> :

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className={thCls}>Indicator</th>
                  <th className={thCls}>Tender</th>
                  <th className={thCls}>Opportunity</th>
                  <SortHeader label="Submission deadline" active dir={dir} onClick={() => update({ dir: dir === 'asc' ? 'desc' : '' })} />
                  <th className={thCls}>Bid status</th>
                  <th className={thCls}>Owner</th>
                  <th className={`${thCls} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((t) =>
              <tr key={t.id} onClick={() => navigate(`/tenders/${t.id}`)} className="cursor-pointer transition-colors duration-150 hover:bg-slate-50">
                    <td className={tdCls}>
                      <TenderIndicator tender={t} />
                    </td>
                    <td className={`${tdCls} max-w-[280px]`}>
                      <span className="block font-semibold text-slate-900">{t.reference}</span>
                      <span className="block truncate text-[11.5px] text-slate-500">{t.title}</span>
                    </td>
                    <td className={`${tdCls} max-w-[220px] text-slate-700`}>{oppName(t.oppId)}</td>
                    <td className={`${tdCls} whitespace-nowrap tabular-nums`}>
                      {formatDateTime(t.submissionDeadline)}
                      {t.bidStatus === 'Submitted' && <span className="block text-[11px] text-green-700">Submitted {formatDate(t.submissionDate)}</span>}
                    </td>
                    <td className={tdCls}>
                      <BidStatusBadge status={t.bidStatus} />
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>{userName(users, t.ownerId)}</td>
                    <td className={`${tdCls} text-right`}>
                      {isTenderOpen(t) &&
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSubmitting(t);
                    }}>
                    
                          Mark Submitted
                        </Button>
                  }
                    </td>
                  </tr>
              )}
              </tbody>
            </table>
          </div>
        </div>
      }

      <TenderForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={(id) => navigate(`/tenders/${id}`)} />
      <MarkSubmittedModal tender={submitting} onClose={() => setSubmitting(null)} />
    </PageContainer>);

}