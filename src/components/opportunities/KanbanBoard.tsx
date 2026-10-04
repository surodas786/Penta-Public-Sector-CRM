import React, { useState } from 'react';
import type { Opportunity, Organization, Stage, User } from '../../types/crm';
import { ALL_STAGES } from '../../data/options';
import { formatBDTShort, formatDate } from '../../utils/format';
import { dueState, isActiveOpp } from '../../utils/metrics';
import { orgName, userName } from '../../utils/lookup';
import { Avatar } from '../ui/Badges';

interface KanbanBoardProps {
  opportunities: Opportunity[];
  organizations: Organization[];
  users: User[];
  onOpen: (id: string) => void;
  onMove: (opp: Opportunity, stage: Stage) => void;
}

const PRIORITY_DOT = { High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-slate-300' };

export function KanbanBoard({ opportunities, organizations, users, onOpen, onMove }: KanbanBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {ALL_STAGES.map((stage) => {
          const items = opportunities.filter((o) => o.stage === stage);
          const total = items.reduce((s, o) => s + (stage === 'Awarded' ? o.awardedValue ?? 0 : o.estimatedValue), 0);
          const isOver = overStage === stage && dragId !== null;
          const terminal = ['Awarded', 'Lost', 'On Hold', 'Cancelled'].includes(stage);
          return (
            <section
              key={stage}
              aria-label={`${stage} column`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage((s) => s === stage ? null : s)}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                const opp = opportunities.find((o) => o.id === id);
                setOverStage(null);
                setDragId(null);
                if (opp && opp.stage !== stage) onMove(opp, stage);
              }}
              className={`flex w-64 shrink-0 flex-col rounded-lg border transition-colors duration-150 ${
              isOver ? 'border-brand bg-brand-light/60' : terminal ? 'border-slate-200 bg-slate-100/70' : 'border-slate-200 bg-slate-50'}`
              }>
              
              <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <h3 className="text-[12px] font-bold text-slate-800">{stage}</h3>
                  <p className="text-[11px] tabular-nums text-slate-500">{items.length ? formatBDTShort(total) : '—'}</p>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600 ring-1 ring-slate-200">{items.length}</span>
              </header>
              <ul className="flex min-h-[120px] flex-col gap-2 p-2">
                {items.map((o) => {
                  const due = isActiveOpp(o) && o.nextActionDue ? dueState(o.nextActionDue) : null;
                  return (
                    <li
                      key={o.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', o.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragId(o.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      className={`cursor-grab rounded-md border border-slate-200 bg-white p-2.5 transition-[opacity,box-shadow] duration-150 hover:border-slate-300 hover:shadow-sm active:cursor-grabbing ${
                      dragId === o.id ? 'opacity-50' : ''}`
                      }>
                      
                      <button type="button" onClick={() => onOpen(o.id)} className="block w-full text-left">
                        <span className="flex items-start gap-1.5">
                          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[o.priority]}`} title={`${o.priority} priority`} />
                          <span className="text-[12.5px] font-semibold leading-snug text-slate-900">{o.name}</span>
                        </span>
                        <span className="mt-0.5 block truncate pl-3 text-[11px] text-slate-500">{orgName(organizations, o.orgId)}</span>
                        <span className="mt-2 flex items-center justify-between pl-3">
                          <span className="text-[12px] font-bold tabular-nums text-slate-800">
                            {formatBDTShort(o.stage === 'Awarded' ? o.awardedValue : o.estimatedValue)}
                          </span>
                          <span className="flex items-center gap-1.5" title={userName(users, o.ownerId)}>
                            <Avatar name={userName(users, o.ownerId)} />
                          </span>
                        </span>
                        {due &&
                        <span
                          className={`mt-2 block rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${
                          due === 'overdue' ? 'bg-red-50 text-red-700' : due === 'today' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500'}`
                          }>
                          
                            {due === 'overdue' ? 'Overdue · ' : due === 'today' ? 'Due today · ' : 'Next · '}
                            {formatDate(o.nextActionDue)}
                          </span>
                        }
                      </button>
                    </li>);

                })}
                {items.length === 0 && <li className="px-2 py-6 text-center text-[11px] text-slate-400">Drop here</li>}
              </ul>
            </section>);

        })}
      </div>
    </div>);

}