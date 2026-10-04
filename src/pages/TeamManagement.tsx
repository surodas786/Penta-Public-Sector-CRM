import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangleIcon, ArrowRightLeftIcon, PencilIcon, UserPlusIcon, XIcon } from 'lucide-react';
import type { Opportunity, User } from '../types/crm';
import { useCrm } from '../contexts/CrmContext';
import { ROLE_LABELS, SECTIONS, sectionName } from '../data/options';
import { canManageUsers, canViewTeamManagement } from '../utils/permissions';
import { followUpBucket, isActiveOpp, pipelineValue } from '../utils/metrics';
import { formatBDTShort } from '../utils/format';
import { userName } from '../utils/lookup';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Badges';
import { AccessDenied } from '../components/ui/Feedback';
import { inputCls } from '../components/ui/FormFields';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageContainer, PageHeader, Panel, tdCls, thCls } from '../components/ui/Layout';
import { ReassignModal } from '../components/opportunities/ReassignModal';
import { UserForm } from '../components/team/UserForm';

export function TeamManagement() {
  const { db, currentUser, setUserActive } = useCrm();
  const navigate = useNavigate();
  const [userForm, setUserForm] = useState<{open: boolean;user?: User;}>({ open: false });
  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [transferId, setTransferId] = useState('');
  const [transferOpp, setTransferOpp] = useState<Opportunity | null>(null);

  if (!canViewTeamManagement(currentUser)) return <AccessDenied message="Team Management is available to management and system administrators only." />;

  const isAdmin = canManageUsers(currentUser);
  const isMgmt = currentUser.role === 'management';
  const users = db.users;
  const management = users.filter((u) => u.role === 'management');
  const activeOpps = db.opportunities.filter(isActiveOpp);

  const confirmToggle = () => {
    if (!toggleTarget) return;
    const res = setUserActive(toggleTarget.id, !toggleTarget.active);
    setToggleTarget(null);
    if (!res.ok) {
      setBlocked(res.error ?? 'Action blocked.');
      toast.error('Deactivation blocked', { description: res.error });
      return;
    }
    setBlocked(null);
    toast.success(toggleTarget.active ? `${toggleTarget.name} deactivated` : `${toggleTarget.name} reactivated`);
  };

  const tree =
  <Panel title="Reporting structure">
      <div className="flex flex-col gap-4">
        {management.map((m) =>
      <div key={m.id} className="flex items-center gap-2 text-[13px]">
            <Avatar name={m.name} tone="navy" />
            <span className="font-semibold text-slate-900">{m.name}</span>
            <span className="text-slate-500">Management</span>
          </div>
      )}
        <div className="ml-3 grid grid-cols-1 gap-4 border-l border-slate-200 pl-4 md:grid-cols-2">
          {SECTIONS.map((s) => {
          const lead = users.find((u) => u.role === 'lead' && u.sectionId === s.id && u.active);
          const reps = users.filter((u) => u.role === 'sales' && u.sectionId === s.id);
          return (
            <div key={s.id}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{s.name}</p>
                <div className="mt-1.5 flex items-center gap-2 text-[13px]">
                  <Avatar name={lead?.name ?? '?'} />
                  <span className="font-semibold text-slate-800">{lead?.name ?? 'No active lead'}</span>
                  <span className="text-slate-400">Section Lead</span>
                </div>
                <ul className="ml-3 mt-1.5 border-l border-slate-200 pl-4">
                  {reps.map((u) =>
                <li key={u.id} className="flex items-center gap-2 py-1 text-[13px]">
                      <Avatar name={u.name} />
                      <span className={u.active ? 'text-slate-700' : 'text-slate-400 line-through'}>{u.name}</span>
                      {u.managerId && u.managerId !== lead?.id && <span className="text-[11px] text-amber-700">reports to {userName(users, u.managerId)}</span>}
                    </li>
                )}
                  {!reps.length && <li className="py-1 text-[13px] text-slate-400">No salespeople</li>}
                </ul>
              </div>);

        })}
        </div>
      </div>
    </Panel>;


  return (
    <PageContainer>
      <PageHeader
        title="Team Management"
        subtitle={isAdmin ? 'Manage accounts, roles, sections and reporting lines. Administrators do not receive sales-record access.' : 'Reporting structure, team workload and cross-section transfers.'}
        actions={
        isAdmin ?
        <Button variant="primary" icon={<UserPlusIcon className="h-4 w-4" />} onClick={() => setUserForm({ open: true })}>
              Add user
            </Button> :
        undefined
        } />
      

      {blocked &&
      <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800" role="alert">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">
            <strong>Action blocked.</strong> {blocked} Ask management or the section lead to reassign them from the opportunity detail page first.
          </p>
          <button type="button" onClick={() => setBlocked(null)} aria-label="Dismiss" className="text-red-700 hover:text-red-900">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      }

      {isMgmt &&
      <>
          <Panel title="Active team members and workload" bodyClassName="p-0">
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
                  {users.
                filter((u) => (u.role === 'lead' || u.role === 'sales') && u.active).
                map((u) => {
                  const mine = db.opportunities.filter((o) => o.ownerId === u.id);
                  const tasks = db.followUps.filter((f) => f.assigneeId === u.id && f.status === 'Open');
                  const overdue = tasks.filter((f) => followUpBucket(f) === 'overdue').length;
                  return (
                    <tr key={u.id} onClick={() => navigate(`/opportunities?owner=${u.id}&view=table`)} className="cursor-pointer hover:bg-slate-50">
                          <td className={`${tdCls} pl-4`}>
                            <span className="flex items-center gap-2 font-semibold">
                              <Avatar name={u.name} />
                              {u.name}
                            </span>
                          </td>
                          <td className={tdCls}>{ROLE_LABELS[u.role]}</td>
                          <td className={tdCls}>{sectionName(u.sectionId)}</td>
                          <td className={`${tdCls} text-right tabular-nums`}>{mine.filter(isActiveOpp).length}</td>
                          <td className={`${tdCls} text-right tabular-nums`}>{formatBDTShort(pipelineValue(mine))}</td>
                          <td className={`${tdCls} text-right tabular-nums`}>{tasks.length}</td>
                          <td className={`${tdCls} pr-4 text-right tabular-nums ${overdue ? 'font-semibold text-red-700' : ''}`}>{overdue}</td>
                        </tr>);

                })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Transfer an opportunity across sections" subtitle="Opens the reassignment flow with a confirmation of the new owner and section">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500">Active opportunity</span>
                <select value={transferId} onChange={(e) => setTransferId(e.target.value)} className={inputCls(undefined, 'h-9 py-1.5 text-[13px]')}>
                  <option value="">Select opportunity…</option>
                  {SECTIONS.map((s) =>
                <optgroup key={s.id} label={s.name}>
                      {activeOpps.
                  filter((o) => o.sectionId === s.id).
                  map((o) =>
                  <option key={o.id} value={o.id}>
                            {o.name} — {userName(users, o.ownerId)}
                          </option>
                  )}
                    </optgroup>
                )}
                </select>
              </label>
              <Button
              variant="navy"
              icon={<ArrowRightLeftIcon className="h-4 w-4" />}
              disabled={!transferId}
              onClick={() => setTransferOpp(db.opportunities.find((o) => o.id === transferId) ?? null)}>
              
                Reassign / transfer
              </Button>
            </div>
          </Panel>
        </>
      }

      {isAdmin &&
      <Panel title="User accounts" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className={`${thCls} pl-4`}>User</th>
                  <th className={thCls}>Role</th>
                  <th className={thCls}>Section</th>
                  <th className={thCls}>Reports to</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} pr-4 text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) =>
              <tr key={u.id}>
                    <td className={`${tdCls} pl-4`}>
                      <span className="block font-semibold text-slate-900">{u.name}</span>
                      <span className="block text-[11.5px] text-slate-500">{u.email}</span>
                    </td>
                    <td className={tdCls}>{ROLE_LABELS[u.role]}</td>
                    <td className={tdCls}>{sectionName(u.sectionId)}</td>
                    <td className={tdCls}>{u.managerId ? userName(users, u.managerId) : '—'}</td>
                    <td className={tdCls}>
                      <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                    u.active ? 'bg-green-50 text-green-700 ring-green-600/20' : 'bg-slate-100 text-slate-500 ring-slate-400/20'}`
                    }>
                    
                        {u.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className={`${tdCls} pr-4 text-right`}>
                      <span className="inline-flex gap-1.5">
                        <Button size="sm" variant="ghost" icon={<PencilIcon className="h-3.5 w-3.5" />} onClick={() => setUserForm({ open: true, user: u })}>
                          Edit
                        </Button>
                        <Button size="sm" variant={u.active ? 'secondary' : 'primary'} onClick={() => setToggleTarget(u)} disabled={u.id === currentUser.id}>
                          {u.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </span>
                    </td>
                  </tr>
              )}
              </tbody>
            </table>
          </div>
        </Panel>
      }

      {tree}

      <UserForm open={userForm.open} user={userForm.user} onClose={() => setUserForm({ open: false })} />
      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.active ? `Deactivate ${toggleTarget?.name}?` : `Activate ${toggleTarget?.name}?`}
        message={
        toggleTarget?.active ?
        'Deactivated users cannot be selected in the demo user switcher or owner dropdowns. Users who own active opportunities cannot be deactivated until those are reassigned.' :
        'The user will be able to sign in (via the demo switcher) and be assigned work again.'
        }
        confirmLabel={toggleTarget?.active ? 'Deactivate' : 'Activate'}
        tone={toggleTarget?.active ? 'danger' : 'primary'}
        onCancel={() => setToggleTarget(null)}
        onConfirm={confirmToggle} />
      
      {transferOpp &&
      <ReassignModal
        opportunity={transferOpp}
        onClose={() => setTransferOpp(null)}
        onDone={() => setTransferId('')} />

      }
    </PageContainer>);

}