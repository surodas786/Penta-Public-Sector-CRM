import React from 'react';
import type { User } from '../../types/crm';
import { sectionName } from '../../data/options';
import { formatBDTShort } from '../../utils/format';
import { Avatar } from '../ui/Badges';

export interface WorkloadRow {
  user: User;
  active: number;
  pipeline: number;
  openTasks: number;
  overdue: number;
  tendersDue: number;
}

interface TeamWorkloadProps {
  rows: WorkloadRow[];
  currentUserId: string;
  showSection: boolean;
  onOpenOwner: (userId: string) => void;
  onOpenOverdue: (userId: string) => void;
}

export function TeamWorkload({ rows, currentUserId, showSection, onOpenOwner, onOpenOverdue }: TeamWorkloadProps) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="px-4 pb-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Team member</th>
            <th className="px-2 pb-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Active opps</th>
            <th className="px-2 pb-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Est. pipeline</th>
            <th className="px-2 pb-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Open tasks</th>
            <th className="px-2 pb-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Overdue</th>
            <th className="px-4 pb-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Tenders ≤7d</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
          <tr key={r.user.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2">
                <button type="button" onClick={() => onOpenOwner(r.user.id)} className="flex items-center gap-2 text-left hover:text-brand-dark">
                  <Avatar name={r.user.name} />
                  <span>
                    <span className="block text-[13px] font-semibold text-slate-800">
                      {r.user.name}
                      {r.user.id === currentUserId && <span className="font-normal text-slate-400"> (me)</span>}
                      {!r.user.active && <span className="ml-1 text-[11px] font-normal text-slate-400">Inactive</span>}
                    </span>
                    {showSection && <span className="block text-[11px] text-slate-500">{sectionName(r.user.sectionId)}</span>}
                  </span>
                </button>
              </td>
              <td className="px-2 py-2 text-right">
                <button type="button" onClick={() => onOpenOwner(r.user.id)} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-700 hover:bg-slate-200">
                  {r.active}
                </button>
              </td>
              <td className="px-2 py-2 text-right text-[13px] tabular-nums text-slate-700">{formatBDTShort(r.pipeline)}</td>
              <td className="px-2 py-2 text-right text-[13px] tabular-nums text-slate-700">{r.openTasks}</td>
              <td className="px-2 py-2 text-right">
                <button
                type="button"
                onClick={() => onOpenOverdue(r.user.id)}
                className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${r.overdue ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                
                  {r.overdue}
                </button>
              </td>
              <td className="px-4 py-2 text-right text-[13px] tabular-nums text-slate-700">{r.tendersDue}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>);

}