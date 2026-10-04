import React from 'react';
import type { Activity, Tender } from '../../types/crm';
import { formatDate, formatDateTime } from '../../utils/format';
import { dueState } from '../../utils/metrics';
import { BidStatusBadge, TenderIndicator } from '../ui/Badges';
import { EmptyState } from '../ui/Feedback';

export interface NextActionItem {
  id: string;
  title: string;
  oppId: string;
  oppName: string;
  due: string;
  ownerName: string;
  kind: 'Follow-up' | 'Next action';
}

export function NextActionsList({ items, onOpen, showOwner }: {items: NextActionItem[];onOpen: (oppId: string) => void;showOwner: boolean;}) {
  if (!items.length) return <EmptyState compact title="No open next actions" description="Nothing is due for this selection." />;
  const overdue = items.filter((i) => dueState(i.due) === 'overdue');
  const upcoming = items.filter((i) => dueState(i.due) !== 'overdue');
  const Row = ({ item }: {item: NextActionItem;}) => {
    const s = dueState(item.due);
    return (
      <li>
        <button type="button" onClick={() => onOpen(item.oppId)} className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50">
          <span className="flex items-start justify-between gap-2">
            <span className="text-[12.5px] font-semibold leading-snug text-slate-900">{item.title}</span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              s === 'overdue' ? 'bg-red-50 text-red-700' : s === 'today' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`
              }>
              
              {s === 'overdue' ? 'Overdue' : s === 'today' ? 'Due today' : 'Upcoming'}
            </span>
          </span>
          <span className="text-[11px] text-slate-500">
            {item.oppName} · Due {formatDate(item.due)}
            {showOwner ? ` · ${item.ownerName}` : ''} · {item.kind}
          </span>
        </button>
      </li>);

  };
  return (
    <div className="flex flex-col gap-2">
      {overdue.length > 0 &&
      <div>
          <p className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wide text-red-700">Overdue ({overdue.length})</p>
          <ul className="divide-y divide-slate-100">
            {overdue.map((i) =>
          <Row key={i.id} item={i} />
          )}
          </ul>
        </div>
      }
      {upcoming.length > 0 &&
      <div className={overdue.length ? 'border-t border-slate-200 pt-2' : ''}>
          <p className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Upcoming ({upcoming.length})</p>
          <ul className="divide-y divide-slate-100">
            {upcoming.map((i) =>
          <Row key={i.id} item={i} />
          )}
          </ul>
        </div>
      }
    </div>);

}

export function TenderDeadlineList({ tenders, oppName, onOpen }: {tenders: Tender[];oppName: (id: string) => string;onOpen: (id: string) => void;}) {
  if (!tenders.length) return <EmptyState compact title="No open tender deadlines" description="All tenders in scope are submitted or closed." />;
  return (
    <ul className="divide-y divide-slate-100">
      {tenders.map((t) =>
      <li key={t.id}>
          <button type="button" onClick={() => onOpen(t.id)} className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50">
            <span className="flex items-start justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-slate-900">{oppName(t.oppId)}</span>
              <BidStatusBadge status={t.bidStatus} />
            </span>
            <span className="text-[11px] text-slate-500">
              Ref {t.reference} · Submission {formatDateTime(t.submissionDeadline)}
            </span>
            <span>
              <TenderIndicator tender={t} />
            </span>
          </button>
        </li>
      )}
    </ul>);

}

export function RecentActivityList({
  activities,
  userName,
  oppName,
  onOpen





}: {activities: Activity[];userName: (id: string) => string;oppName: (id: string) => string;onOpen: (oppId: string) => void;}) {
  if (!activities.length) return <EmptyState compact title="No activity in this period" description="Try a wider date range." />;
  return (
    <ul className="divide-y divide-slate-100">
      {activities.map((a) =>
      <li key={a.id}>
          <button type="button" onClick={() => onOpen(a.oppId)} className="-mx-2 flex w-[calc(100%+1rem)] gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[12.5px] leading-snug text-slate-800">
                <strong className="font-semibold">{userName(a.createdBy)}</strong> logged {a.type === 'Other' ? 'an activity' : `a ${a.type}`} on{' '}
                <span className="font-medium">{oppName(a.oppId)}</span>
              </span>
              <span className="block truncate text-[11.5px] text-slate-500">{a.subject}</span>
              <span className="block text-[10.5px] text-slate-400">{formatDateTime(a.at)}</span>
            </span>
          </button>
        </li>
      )}
    </ul>);

}