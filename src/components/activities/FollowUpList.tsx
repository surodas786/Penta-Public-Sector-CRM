import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClockIcon, CheckIcon, PencilIcon } from 'lucide-react';
import type { FollowUp, Opportunity, User } from '../../types/crm';
import { formatDate, formatDateTime } from '../../utils/format';
import { userName } from '../../utils/lookup';
import { DueTag, PriorityBadge } from '../ui/Badges';
import { CompleteFollowUpModal, RescheduleModal } from './FollowUpActions';
import { FollowUpForm } from './FollowUpForm';

interface FollowUpListProps {
  followUps: FollowUp[];
  opportunities: Opportunity[];
  users: User[];
  showOpportunity?: boolean;
}

export function FollowUpList({ followUps, opportunities, users, showOpportunity = true }: FollowUpListProps) {
  const [completing, setCompleting] = useState<FollowUp | null>(null);
  const [rescheduling, setRescheduling] = useState<FollowUp | null>(null);
  const [editing, setEditing] = useState<FollowUp | null>(null);

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {followUps.map((f) => {
          const opp = opportunities.find((o) => o.id === f.oppId);
          const done = f.status === 'Completed';
          return (
            <li key={f.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <button
                  type="button"
                  onClick={() => !done && setCompleting(f)}
                  disabled={done}
                  aria-label={done ? 'Completed' : `Mark "${f.title}" complete`}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
                  done ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 text-transparent hover:border-brand hover:text-brand'}`
                  }>
                  
                  <CheckIcon className="h-3 w-3" strokeWidth={3} />
                </button>
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold ${done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{f.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-500">
                    {showOpportunity && opp &&
                    <Link to={`/opportunities/${opp.id}`} className="font-medium text-brand-dark hover:underline">
                        {opp.name}
                      </Link>
                    }
                    <span>{userName(users, f.assigneeId)}</span>
                    <span>· Due {formatDate(f.due)}</span>
                    {done && f.completedAt && <span>· Completed {formatDateTime(f.completedAt)}</span>}
                  </p>
                  {done && f.completionNote && <p className="mt-1 text-[12px] italic text-slate-500">“{f.completionNote}”</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 pl-8 sm:pl-0">
                <PriorityBadge priority={f.priority} />
                {!done && <DueTag date={f.due} />}
                {!done &&
                <>
                    <button type="button" onClick={() => setRescheduling(f)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                      <CalendarClockIcon className="h-3.5 w-3.5" />
                      Reschedule
                    </button>
                    <button type="button" onClick={() => setCompleting(f)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-brand-dark hover:bg-brand-light">
                      <CheckIcon className="h-3.5 w-3.5" />
                      Complete
                    </button>
                  </>
                }
                <button type="button" onClick={() => setEditing(f)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Edit ${f.title}`}>
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>);

        })}
      </ul>
      <CompleteFollowUpModal followUp={completing} onClose={() => setCompleting(null)} />
      <RescheduleModal followUp={rescheduling} onClose={() => setRescheduling(null)} />
      <FollowUpForm open={!!editing} followUp={editing ?? undefined} onClose={() => setEditing(null)} />
    </>);

}