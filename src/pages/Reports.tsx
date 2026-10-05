import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DownloadIcon } from 'lucide-react';
import { useScope } from '../hooks/useScope';
import { ALL_STAGES, SECTIONS, sectionName } from '../data/options';
import { visibleTeamMembers, scopeDescription } from '../utils/permissions';
import { followUpBucket, isActiveOpp, isTenderOpen, pipelineValue, tenderIndicator } from '../utils/metrics';
import { DEMO_NOW, DEMO_TODAY, daysBetween, inCustomRange } from '../utils/demoClock';
import { formatBDT, formatBDTShort, formatDate, formatDateTime } from '../utils/format';
import { orgName, userName } from '../utils/lookup';
import { downloadCsv } from '../utils/csv';
import { Button } from '../components/ui/Button';
import { inputCls } from '../components/ui/FormFields';
import { AccessDenied, EmptyState } from '../components/ui/Feedback';
import { PageContainer, PageHeader, tdCls, thCls } from '../components/ui/Layout';

type ReportId = 'pipeline' | 'section-owner' | 'overdue' | 'tenders' | 'outcomes' | 'lost-reasons';
type Cell = string | number;

const REPORTS: {id: ReportId;label: string;dateField: string;}[] = [
{ id: 'pipeline', label: 'Pipeline by stage', dateField: 'Opportunity created date' },
{ id: 'section-owner', label: 'Opportunities by section and owner', dateField: 'Opportunity created date' },
{ id: 'overdue', label: 'Overdue follow-ups', dateField: 'Follow-up due date' },
{ id: 'tenders', label: 'Upcoming tender submissions', dateField: 'Submission deadline' },
{ id: 'outcomes', label: 'Awarded and lost opportunities', dateField: 'Award / close date' },
{ id: 'lost-reasons', label: 'Lost reasons', dateField: 'Close date' }];


interface ReportData {
  headers: string[];
  rows: Cell[][];
  moneyCols: number[];
  summary: {label: string;value: string;}[];
}

export function Reports() {
  const scope = useScope();
  const { user, users } = scope;
  const [report, setReport] = useState<ReportId>('pipeline');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const data = useMemo<ReportData>(() => {
    const oppName = (id: string) => scope.opportunities.find((o) => o.id === id)?.name ?? '';
    const byCreated = scope.opportunities.filter((o) => inCustomRange(o.createdAt, from, to));
    switch (report) {
      case 'pipeline':{
          const rows = ALL_STAGES.map((s) => {
            const list = byCreated.filter((o) => o.stage === s);
            return [s, list.length, list.reduce((sum, o) => sum + o.estimatedValue, 0)] as Cell[];
          });
          return {
            headers: ['Stage', 'Opportunities', 'Estimated value (BDT)'],
            rows,
            moneyCols: [2],
            summary: [
            { label: 'Opportunities', value: String(byCreated.length) },
            { label: 'Estimated active pipeline', value: formatBDTShort(pipelineValue(byCreated)) }]

          };
        }
      case 'section-owner':{
          const members = visibleTeamMembers(user, users);
          const rows: Cell[][] = [];
          SECTIONS.forEach((s) =>
          members.
          filter((m) => m.sectionId === s.id).
          forEach((m) => {
            const list = byCreated.filter((o) => o.ownerId === m.id);
            if (!list.length && user.role === 'sales') return;
            rows.push([
            s.name,
            m.name,
            list.filter(isActiveOpp).length,
            list.filter((o) => !isActiveOpp(o)).length,
            pipelineValue(list),
            list.filter((o) => o.stage === 'Awarded').reduce((sum, o) => sum + (o.awardedValue ?? 0), 0)]
            );
          })
          );
          return {
            headers: ['Section', 'Owner', 'Active', 'Closed', 'Est. active pipeline (BDT)', 'Awarded value (BDT)'],
            rows,
            moneyCols: [4, 5],
            summary: [
            { label: 'Owners', value: String(rows.length) },
            { label: 'Active opportunities', value: String(byCreated.filter(isActiveOpp).length) }]

          };
        }
      case 'overdue':{
          const list = scope.followUps.
          filter((f) => followUpBucket(f) === 'overdue' && inCustomRange(f.due, from, to)).
          sort((a, b) => a.due.localeCompare(b.due));
          return {
            headers: ['Task', 'Opportunity', 'Assigned to', 'Due date', 'Days overdue', 'Priority'],
            rows: list.map((f) => [f.title, oppName(f.oppId), userName(users, f.assigneeId), formatDate(f.due), daysBetween(f.due, DEMO_TODAY), f.priority]),
            moneyCols: [],
            summary: [
            { label: 'Overdue follow-ups', value: String(list.length) },
            { label: 'High priority', value: String(list.filter((f) => f.priority === 'High').length) }]

          };
        }
      case 'tenders':{
          const list = scope.tenders.
          filter((t) => isTenderOpen(t) && new Date(t.submissionDeadline) >= new Date(DEMO_NOW) && inCustomRange(t.submissionDeadline, from, to)).
          sort((a, b) => a.submissionDeadline.localeCompare(b.submissionDeadline));
          return {
            headers: ['Reference', 'Tender', 'Opportunity', 'Owner', 'Submission deadline', 'Bid status', 'Indicator'],
            rows: list.map((t) => [
            t.reference,
            t.title,
            oppName(t.oppId),
            userName(users, t.ownerId),
            formatDateTime(t.submissionDeadline),
            t.bidStatus,
            tenderIndicator(t) === 'due-soon' ? 'Due within 3 days' : 'Upcoming']
            ),
            moneyCols: [],
            summary: [
            { label: 'Upcoming submissions', value: String(list.length) },
            { label: 'Due within 3 days', value: String(list.filter((t) => tenderIndicator(t) === 'due-soon').length) }]

          };
        }
      case 'outcomes':{
          const list = scope.opportunities.
          filter((o) => (o.stage === 'Awarded' || o.stage === 'Lost') && inCustomRange(o.awardDate || o.closedAt, from, to)).
          sort((a, b) => (b.awardDate || b.closedAt).localeCompare(a.awardDate || a.closedAt));
          const awarded = list.filter((o) => o.stage === 'Awarded');
          return {
            headers: ['Opportunity', 'Organization', 'Owner', 'Section', 'Outcome', 'Estimated (BDT)', 'Actual awarded (BDT)', 'Date', 'Lost reason'],
            rows: list.map((o) => [
            o.name,
            orgName(scope.organizations, o.orgId),
            userName(users, o.ownerId),
            sectionName(o.sectionId),
            o.stage,
            o.estimatedValue,
            o.stage === 'Awarded' ? o.awardedValue ?? 0 : '',
            formatDate(o.awardDate || o.closedAt),
            o.lostReason]
            ),
            moneyCols: [5, 6],
            summary: [
            { label: 'Awarded', value: `${awarded.length} · ${formatBDTShort(awarded.reduce((s, o) => s + (o.awardedValue ?? 0), 0))}` },
            { label: 'Lost', value: String(list.length - awarded.length) },
            { label: 'Win rate', value: list.length ? `${Math.round(awarded.length / list.length * 100)}%` : '—' }]

          };
        }
      case 'lost-reasons':{
          const lost = scope.opportunities.filter((o) => o.stage === 'Lost' && inCustomRange(o.closedAt, from, to));
          const groups = new Map<string, typeof lost>();
          lost.forEach((o) => groups.set(o.lostReason || 'Not specified', [...(groups.get(o.lostReason || 'Not specified') ?? []), o]));
          return {
            headers: ['Reason', 'Count', 'Estimated value lost (BDT)', 'Opportunities'],
            rows: Array.from(groups.entries()).map(([reason, list]) => [reason, list.length, list.reduce((s, o) => s + o.estimatedValue, 0), list.map((o) => o.name).join('; ')]),
            moneyCols: [2],
            summary: [
            { label: 'Lost opportunities', value: String(lost.length) },
            { label: 'Estimated value lost', value: formatBDTShort(lost.reduce((s, o) => s + o.estimatedValue, 0)) }]

          };
        }
    }
  }, [report, scope, from, to, user, users]);

  if (!scope.salesAccess) return <AccessDenied message="Sales reports are not available to the System Administrator role." />;

  const meta = REPORTS.find((r) => r.id === report)!;
  const scopeText = scopeDescription(user, sectionName(user.sectionId));

  const exportCsv = () => {
    downloadCsv(`penta-${report}-${DEMO_TODAY}.csv`, data.headers, data.rows);
    toast.success('CSV exported', { description: `${data.rows.length} rows · scope: ${scopeText}` });
  };

  return (
    <PageContainer>
      <PageHeader title="Reports" subtitle={<>Scope: <strong className="text-slate-700">{scopeText}</strong> · exports contain only records you are permitted to see</>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Reports" className="rounded-lg border border-slate-200 bg-white p-1.5 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {REPORTS.map((r) =>
            <li key={r.id}>
                <button
                type="button"
                onClick={() => setReport(r.id)}
                aria-current={report === r.id}
                className={`w-full whitespace-nowrap rounded-md px-3 py-2 text-left text-[13px] font-semibold transition-colors duration-150 ${
                report === r.id ? 'bg-brand-light text-brand-dark' : 'text-slate-600 hover:bg-slate-50'}`
                }>
                
                  {r.label}
                </button>
              </li>
            )}
          </ul>
        </nav>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-slate-900">{meta.label}</h2>
              <p className="text-xs text-slate-500">Date filter applies to: {meta.dateField}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500">From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls(undefined, 'h-9 w-40 py-1.5 text-[13px]')} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500">To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls(undefined, 'h-9 w-40 py-1.5 text-[13px]')} />
              </label>
              {(from || to) &&
              <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => {setFrom('');setTo('');}}>
                  Clear dates
                </Button>
              }
              <Button variant="primary" icon={<DownloadIcon className="h-4 w-4" />} onClick={exportCsv} disabled={!data.rows.length}>
                Export CSV
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-10 gap-y-2 border-b border-slate-100 px-4 py-3">
            {data.summary.map((s) =>
            <div key={s.label}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</p>
                <p className="text-lg font-bold tabular-nums text-slate-900">{s.value}</p>
              </div>
            )}
          </div>

          {data.rows.length === 0 ?
          <EmptyState title="No records for this report" description="Nothing in your scope matches the selected dates." /> :

          <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    {data.headers.map((h, i) =>
                  <th key={h} className={`${thCls} ${i === 0 ? 'pl-4' : ''} ${typeof data.rows[0]?.[i] === 'number' ? 'text-right' : ''}`}>
                        {h}
                      </th>
                  )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r, ri) =>
                <tr key={ri}>
                      {r.map((c, ci) =>
                  <td key={ci} className={`${tdCls} ${ci === 0 ? 'pl-4 font-semibold' : ''} ${typeof c === 'number' ? 'text-right tabular-nums' : ''}`}>
                          {data.moneyCols.includes(ci) && typeof c === 'number' ? <span title={formatBDT(c)}>{formatBDTShort(c)}</span> : c === '' ? '—' : c}
                        </td>
                  )}
                    </tr>
                )}
                </tbody>
              </table>
            </div>
          }
        </section>
      </div>
    </PageContainer>);

}