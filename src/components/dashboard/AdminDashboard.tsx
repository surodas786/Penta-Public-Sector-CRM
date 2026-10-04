import { useNavigate } from 'react-router-dom';
import { ShieldIcon } from 'lucide-react';
import { useCrm } from '../../contexts/CrmContext';
import { ROLE_LABELS, SECTIONS } from '../../data/options';
import type { Role } from '../../types/crm';
import { Avatar } from '../ui/Badges';
import { Button } from '../ui/Button';
import { PageContainer, PageHeader, Panel } from '../ui/Layout';

const ROLES: Role[] = ['management', 'lead', 'sales', 'admin'];

export function AdminDashboard() {
  const { db } = useCrm();
  const navigate = useNavigate();
  const users = db.users;
  const active = users.filter((u) => u.active);
  const inactive = users.filter((u) => !u.active);

  return (
    <PageContainer>
      <PageHeader
        title="Administration Dashboard"
        subtitle="Manage demo accounts, roles, sections and reporting lines."
        actions={
        <Button variant="primary" onClick={() => navigate('/team')}>
            Manage users
          </Button>
        } />
      
      <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <p className="text-[13px] text-slate-600">
          The System Administrator role manages accounts and reporting lines only. It does not automatically receive access to opportunities, contacts, tenders, documents or sales reports.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg bg-navy px-4 py-3.5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#9FB4D1]">Active accounts</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums">{active.length}</p>
        </div>
        {ROLES.slice(0, 3).map((r) =>
        <div key={r} className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{ROLE_LABELS[r]}s</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{active.filter((u) => u.role === r).length}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Sections and reporting lines" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {SECTIONS.map((s) => {
              const lead = users.find((u) => u.role === 'lead' && u.sectionId === s.id && u.active);
              const reps = users.filter((u) => u.role === 'sales' && u.sectionId === s.id);
              return (
                <div key={s.id}>
                  <p className="text-[13px] font-bold text-slate-900">{s.name}</p>
                  <div className="mt-2 flex items-center gap-2 text-[13px]">
                    <Avatar name={lead?.name ?? '?'} tone="navy" />
                    <span className="font-semibold text-slate-800">{lead?.name ?? 'No active lead'}</span>
                    <span className="text-slate-400">Section Lead</span>
                  </div>
                  <ul className="ml-3 mt-2 border-l border-slate-200 pl-4">
                    {reps.map((u) =>
                    <li key={u.id} className="flex items-center gap-2 py-1 text-[13px]">
                        <Avatar name={u.name} />
                        <span className={u.active ? 'text-slate-700' : 'text-slate-400 line-through'}>{u.name}</span>
                        {!u.active && <span className="text-[11px] text-slate-400">Inactive</span>}
                      </li>
                    )}
                    {!reps.length && <li className="py-1 text-[13px] text-slate-400">No salespeople</li>}
                  </ul>
                </div>);

            })}
          </div>
        </Panel>
        <Panel title="Account status">
          <ul className="flex flex-col gap-2 text-[13px]">
            {ROLES.map((r) =>
            <li key={r} className="flex justify-between">
                <span className="text-slate-600">{ROLE_LABELS[r]}</span>
                <span className="font-semibold tabular-nums text-slate-900">{users.filter((u) => u.role === r).length}</span>
              </li>
            )}
            <li className="flex justify-between border-t border-slate-100 pt-2">
              <span className="text-slate-600">Inactive accounts</span>
              <span className="font-semibold tabular-nums text-slate-900">{inactive.length}</span>
            </li>
          </ul>
        </Panel>
      </div>
    </PageContainer>);

}