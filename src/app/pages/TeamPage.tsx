/**
 * Team Management for management (FR-011, FR-071) — the approved screen:
 * workload by owner, a cross-section transfer panel and the reporting
 * structure. Read-only for structure: account administration belongs to the
 * System Administrator, and no email or account field is shown here.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeftIcon, SearchIcon } from 'lucide-react';

import type { OpportunityDetailDto } from '../../../shared/api.js';
import { ROLE_LABELS } from '../../../shared/enums.js';
import { formatBdtShort } from '../../../shared/money.js';
import { fetchOpportunities, fetchOpportunity, fetchTeam } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { inputCls } from '../../components/ui/FormFields';
import { PageContainer, PageHeader, Panel, tdCls, thCls } from '../../components/ui/Layout';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import { TransferDialog } from '../components/TransferDialog.js';
import { Avatar } from '../ui/ApiBadges.js';
import { useApiResource } from '../useApiResource.js';

export function TeamPage() {
  const navigate = useNavigate();
  const team = useApiResource(useCallback((signal: AbortSignal) => fetchTeam(signal), []), []);

  const [search, setSearch] = useState('');
  const [transferId, setTransferId] = useState('');
  const [subject, setSubject] = useState<OpportunityDetailDto | null>(null);

  const candidates = useApiResource(
    useCallback(
      (signal: AbortSignal) =>
        fetchOpportunities({ q: search || undefined, status: 'active', pageSize: 50, sort: 'name', dir: 'asc' }, signal),
      [search],
    ),
    [search],
  );

  const openTransfer = async () => {
    if (!transferId) return;
    setSubject(await fetchOpportunity(transferId));
  };

  if (team.error) {
    return (
      <PageContainer>
        <ErrorPanel error={team.error} onRetry={team.reload} />
      </PageContainer>
    );
  }
  if (!team.data) {
    return (
      <PageContainer>
        <LoadingPanel label="Loading team…" />
      </PageContainer>
    );
  }

  const { workload, sections, management } = team.data;

  return (
    <PageContainer>
      <PageHeader title="Team Management" subtitle="Reporting structure, team workload and cross-section transfers." />

      <Panel
        title="Active team members and workload"
        subtitle="Active opportunities: status Active, not Awarded or Lost. Overdue: due before today in Bangladesh."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={`${thCls} pl-4`}>Member</th>
                <th className={thCls}>Role</th>
                <th className={thCls}>Section</th>
                <th className={`${thCls} text-right`}>Active opps</th>
                <th className={`${thCls} text-right`}>Est. pipeline</th>
                <th className={`${thCls} text-right`}>Open tasks</th>
                <th className={`${thCls} pr-4 text-right`}>Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workload.map((row) => (
                <tr
                  key={row.userId}
                  onClick={() => navigate(`/opportunities?ownerId=${row.userId}&view=table`)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className={`${tdCls} pl-4`}>
                    <span className="flex items-center gap-2 font-semibold">
                      <Avatar name={row.fullName} />
                      {row.fullName}
                    </span>
                  </td>
                  <td className={tdCls}>{ROLE_LABELS[row.role]}</td>
                  <td className={tdCls}>{row.sectionName}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{row.activeOpportunities}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{formatBdtShort(row.estimatedPipeline)}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{row.openTasks}</td>
                  <td className={`${tdCls} pr-4 text-right tabular-nums ${row.overdueTasks ? 'font-semibold text-red-700' : ''}`}>
                    {row.overdueTasks}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Transfer an opportunity across sections"
        subtitle="Opens the reassignment flow with a confirmation of the new owner and section"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
          <label className="flex flex-col gap-1 lg:w-64">
            <span className="text-[11px] font-semibold text-slate-500">Find</span>
            <span className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, reference or organization…"
                className={inputCls(undefined, 'h-9 pl-8 text-[13px]')}
              />
            </span>
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Active opportunity</span>
            <select
              value={transferId}
              onChange={(event) => setTransferId(event.target.value)}
              className={inputCls(undefined, 'h-9 py-1.5 text-[13px]')}
            >
              <option value="">Select opportunity…</option>
              {sections.map((section) => {
                const items = (candidates.data?.items ?? []).filter((item) => item.sectionId === section.id);
                if (items.length === 0) return null;
                return (
                  <optgroup key={section.id} label={section.name}>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {item.ownerName}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
          <Button
            variant="navy"
            icon={<ArrowRightLeftIcon className="h-4 w-4" />}
            disabled={!transferId}
            onClick={() => void openTransfer()}
          >
            Reassign / transfer
          </Button>
        </div>
        {candidates.data && candidates.data.total > candidates.data.items.length && (
          <p className="mt-2 text-[11.5px] text-slate-500">
            Showing the first {candidates.data.items.length} of {candidates.data.total}. Type to narrow the list.
          </p>
        )}
      </Panel>

      <Panel title="Reporting structure">
        <div className="flex flex-col gap-4">
          {management.map((person) => (
            <div key={person.id} className="flex items-center gap-2 text-[13px]">
              <Avatar name={person.fullName} tone="navy" />
              <span className="font-semibold text-slate-900">{person.fullName}</span>
              <span className="text-slate-500">Management</span>
            </div>
          ))}
          <div className="ml-3 grid grid-cols-1 gap-4 border-l border-slate-200 pl-4 md:grid-cols-2">
            {sections.map((section) => (
              <div key={section.id}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{section.name}</p>
                <div className="mt-1.5 flex items-center gap-2 text-[13px]">
                  <Avatar name={section.lead?.fullName ?? '?'} />
                  <span className="font-semibold text-slate-800">{section.lead?.fullName ?? 'No active lead'}</span>
                  <span className="text-slate-400">Section Lead</span>
                </div>
                <ul className="ml-3 mt-1.5 border-l border-slate-200 pl-4">
                  {section.members.map((member) => (
                    <li key={member.id} className="flex items-center gap-2 py-1 text-[13px]">
                      <Avatar name={member.fullName} />
                      <span className={member.active ? 'text-slate-700' : 'text-slate-400 line-through'}>{member.fullName}</span>
                      {member.active && !member.reportsToLead && (
                        <span className="text-[11px] text-amber-700">reporting line needs review</span>
                      )}
                    </li>
                  ))}
                  {section.members.length === 0 && <li className="py-1 text-[13px] text-slate-400">No salespeople</li>}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <TransferDialog
        subject={subject}
        isManagement
        onClose={() => setSubject(null)}
        onDone={() => {
          setSubject(null);
          setTransferId('');
          team.reload();
          candidates.reload();
        }}
        onReload={() => setSubject(null)}
      />
    </PageContainer>
  );
}
