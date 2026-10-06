/**
 * Reports (FR-082, FR-083, BR-060) — the approved six-report layout, with
 * every row, total and summary computed by the server over the account's
 * scope. Paging and sorting happen on the server; the date filter names the
 * date it applies to; Export CSV covers every matching row, not the page.
 */
import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { ReportColumnDto, ReportDto } from '../../../shared/api.js';
import { formatBdt, formatBdtShort } from '../../../shared/money.js';
import { REPORTS, reportDefinition, DATE_BASIS_LABELS, type ReportKey } from '../../../shared/reporting.js';
import { fetchOpportunityOwners, fetchReport } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { FilterSelect, inputCls } from '../../components/ui/FormFields';
import { PageContainer, PageHeader, Pagination, SortHeader, tdCls, thCls } from '../../components/ui/Layout';
import { useAuth } from '../AuthContext.js';
import { ExportButton } from '../components/ExportButton.js';
import { ErrorPanel, LoadingPanel, LoadingRows } from '../components/Feedback.js';
import { formatCalendarDate, formatInstantCompact } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';

const PAGE_SIZE = 25;

function scopeText(role: string | undefined, sectionName: string | undefined): string {
  if (role === 'management') return 'All sections';
  if (role === 'lead') return `${sectionName ?? 'Your section'} section`;
  return 'Your own opportunities';
}

function Cell({ column, value }: { column: ReportColumnDto; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-400">—</span>;
  switch (column.kind) {
    case 'money':
      return <span title={formatBdt(String(value))}>{formatBdtShort(String(value))}</span>;
    case 'date':
      return <>{formatCalendarDate(String(value))}</>;
    case 'instant':
      return <>{formatInstantCompact(String(value))}</>;
    default:
      return <>{value}</>;
  }
}

function summaryValue(item: ReportDto['summary'][number]): string {
  return item.kind === 'money' ? formatBdtShort(item.value) : item.value;
}

export function ReportsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const read = (key: string) => params.get(key) ?? '';
  const reportParam = read('report') as ReportKey;
  const report: ReportKey = REPORTS.some((item) => item.key === reportParam) ? reportParam : 'pipeline';
  const from = read('from');
  const to = read('to');
  const isManagement = user?.role === 'management';
  const canFilterOwner = isManagement || user?.role === 'lead';
  const section = isManagement ? read('section') : '';
  const owner = canFilterOwner ? read('owner') : '';
  const sort = read('sort');
  const dir = read('dir');
  const page = Math.max(1, Number(read('page')) || 1);

  const update = (patch: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  // The filters exactly as the report endpoint receives them; the export sends the same.
  const filters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      sectionId: section || undefined,
      ownerId: owner || undefined,
      sort: sort || undefined,
      dir: dir || undefined,
    }),
    [from, to, section, owner, sort, dir],
  );
  const { data, error, loading, reload } = useApiResource(
    useCallback(
      (signal: AbortSignal) => fetchReport(report, { ...filters, page, pageSize: PAGE_SIZE }, signal),
      [report, filters, page],
    ),
    [report, filters, page],
  );

  const owners = useApiResource(
    useCallback(
      (signal: AbortSignal) => (canFilterOwner ? fetchOpportunityOwners(signal) : Promise.resolve({ items: [] })),
      [canFilterOwner],
    ),
    [canFilterOwner],
  );
  const sections = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of owners.data?.items ?? []) seen.set(item.sectionId, item.sectionName);
    return [...seen.entries()];
  }, [owners.data]);

  const definition = reportDefinition(report);
  const scope = scopeText(user?.role, user?.section?.name);

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        subtitle={
          <>
            Scope: <strong className="text-slate-700">{scope}</strong> · calculated by the server · exports contain only records you
            are permitted to see
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Reports" className="rounded-lg border border-slate-200 bg-white p-1.5 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {REPORTS.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => update({ report: item.key === 'pipeline' ? '' : item.key, sort: '', dir: '' })}
                  aria-current={report === item.key}
                  className={`w-full whitespace-nowrap rounded-md px-3 py-2 text-left text-[13px] font-semibold transition-colors duration-150 ${
                    report === item.key ? 'bg-brand-light text-brand-dark' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="report-title">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
            <div>
              <h2 id="report-title" className="text-[15px] font-bold text-slate-900">
                {definition.label}
              </h2>
              <p className="text-xs text-slate-500">
                Date filter applies to: <strong className="font-semibold text-slate-700">{DATE_BASIS_LABELS[definition.dateBasis]}</strong>{' '}
                (Bangladesh calendar dates)
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {isManagement && (
                <FilterSelect label="Section" value={section} onChange={(value) => update({ section: value, owner: '' })} className="w-44">
                  <option value="">All sections</option>
                  {sections.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </FilterSelect>
              )}
              {canFilterOwner && (
                <FilterSelect label="Owner" value={owner} onChange={(value) => update({ owner: value })} className="w-44">
                  <option value="">{isManagement ? 'All owners' : 'All on my team'}</option>
                  {owners.data?.items
                    .filter((item) => !section || item.sectionId === section)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.fullName}
                      </option>
                    ))}
                </FilterSelect>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500">From</span>
                <input
                  type="date"
                  value={from}
                  onChange={(event) => update({ from: event.target.value })}
                  className={inputCls(undefined, 'h-9 w-40 py-1.5 text-[13px]')}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500">To</span>
                <input
                  type="date"
                  value={to}
                  onChange={(event) => update({ to: event.target.value })}
                  className={inputCls(undefined, 'h-9 w-40 py-1.5 text-[13px]')}
                />
              </label>
              {(from || to) && (
                <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => update({ from: '', to: '' })}>
                  Clear dates
                </Button>
              )}
              <ExportButton kind={report} filters={filters} disabled={!data || data.total === 0} scopeLabel={scope} />
            </div>
          </div>

          {error ? (
            <div className="p-4">
              <ErrorPanel error={error} onRetry={reload} />
            </div>
          ) : !data ? (
            <div className="p-4">
              <LoadingPanel label="Running the report…" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-10 gap-y-2 border-b border-slate-100 px-4 py-3">
                {data.summary.map((item) => (
                  <div key={item.label}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                    <p className="text-lg font-bold tabular-nums text-slate-900" title={item.kind === 'money' ? formatBdt(item.value) : undefined}>
                      {summaryValue(item)}
                    </p>
                  </div>
                ))}
              </div>
              <p className="border-b border-slate-100 px-4 py-2 text-[11.5px] text-slate-500">
                {from || to
                  ? `Showing records by ${DATE_BASIS_LABELS[definition.dateBasis].toLowerCase()}, ${
                      from ? `from ${formatCalendarDate(from)}` : ''
                    }${from && to ? ' ' : ''}${to ? `up to ${formatCalendarDate(to)}` : ''}.`
                  : 'No date filter: all dates are included.'}{' '}
                {data.undated ? data.undated.note : `Every record in this report has a date for this basis (${DATE_BASIS_LABELS[definition.dateBasis]}).`}
              </p>

              {data.items.length === 0 ? (
                <EmptyState title="No records for this report" description="Nothing in your scope matches these filters." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        {data.columns.map((column, index) => {
                          const numeric = column.kind === 'count' || column.kind === 'money';
                          const className = `${index === 0 ? 'pl-4' : ''} ${numeric ? 'text-right' : ''}`;
                          return column.sortable ? (
                            <SortHeader
                              key={column.key}
                              label={column.label}
                              active={data.sort === column.key}
                              dir={data.dir}
                              onClick={() =>
                                update(
                                  { sort: column.key, dir: data.sort === column.key && data.dir === 'asc' ? 'desc' : 'asc' },
                                  true,
                                )
                              }
                              className={className}
                            />
                          ) : (
                            <th key={column.key} className={`${thCls} ${className}`}>
                              {column.label}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        <LoadingRows columns={data.columns.length} />
                      ) : (
                        data.items.map((row, rowIndex) => (
                          <tr
                            key={rowIndex}
                            className={row.opportunityId ? 'cursor-pointer hover:bg-slate-50' : ''}
                            onClick={row.opportunityId ? () => navigate(`/opportunities/${row.opportunityId}`) : undefined}
                          >
                            {data.columns.map((column, index) => {
                              const numeric = column.kind === 'count' || column.kind === 'money';
                              return (
                                <td
                                  key={column.key}
                                  className={`${tdCls} ${index === 0 ? 'pl-4 font-semibold' : ''} ${numeric ? 'text-right tabular-nums' : ''}`}
                                >
                                  <Cell column={column} value={row.cells[column.key]} />
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {data.total > data.pageSize && (
                <Pagination
                  page={data.page}
                  pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))}
                  total={data.total}
                  pageSize={data.pageSize}
                  onChange={(next) => update({ page: String(next) }, false)}
                />
              )}
              <p className="px-4 pb-3 pt-2 text-[11px] text-slate-500">
                Money in BDT: estimates and actual awarded values are labelled separately. Times in Bangladesh time (UTC+6).
              </p>
            </>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
