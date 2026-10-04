import { useMemo } from 'react';
import { useCrm } from '../contexts/CrmContext';
import { useScope } from './useScope';
import { followUpBucket, tenderIndicator } from '../utils/metrics';
import { formatDate, formatDateTime } from '../utils/format';
import { userName } from '../utils/lookup';

export interface AppNotification {
  id: string;
  title: string;
  detail: string;
  to: string;
  tone: 'red' | 'amber' | 'teal';
  read: boolean;
}

/** Notifications are derived from permission-scoped records only. */
export function useNotifications() {
  const { db, markNotificationsRead } = useCrm();
  const scope = useScope();
  const { user } = scope;

  const items = useMemo(() => {
    if (!scope.salesAccess) return [] as Omit<AppNotification, 'read'>[];
    const list: Omit<AppNotification, 'read'>[] = [];
    const oppName = (id: string) => scope.opportunities.find((o) => o.id === id)?.name ?? '';

    scope.followUps.
    filter((f) => followUpBucket(f) === 'overdue' && (user.role === 'lead' || f.assigneeId === user.id)).
    forEach((f) =>
    list.push({
      id: `fu-overdue-${f.id}`,
      title: `Overdue: ${f.title}`,
      detail: `${oppName(f.oppId)} · due ${formatDate(f.due)} · ${userName(scope.users, f.assigneeId)}`,
      to: `/opportunities/${f.oppId}?tab=activities`,
      tone: 'red'
    })
    );

    scope.tenders.forEach((t) => {
      const ind = tenderIndicator(t);
      if (ind === 'missed')
      list.push({ id: `tender-missed-${t.id}`, title: `Missed deadline: ${t.reference}`, detail: `${oppName(t.oppId)} · ${formatDateTime(t.submissionDeadline)}`, to: `/tenders/${t.id}`, tone: 'red' });
      if (ind === 'due-soon')
      list.push({ id: `tender-soon-${t.id}`, title: `Tender due soon: ${t.reference}`, detail: `${oppName(t.oppId)} · ${formatDateTime(t.submissionDeadline)}`, to: `/tenders/${t.id}`, tone: 'amber' });
    });

    scope.opportunities.forEach((o) =>
    o.history.
    filter((h) => h.field === 'Owner' && h.newValue === user.name && h.userId !== user.id).
    forEach((h) =>
    list.push({
      id: `assign-${h.id}`,
      title: `Assigned to you: ${o.name}`,
      detail: `By ${userName(scope.users, h.userId)} · ${formatDateTime(h.at)}`,
      to: `/opportunities/${o.id}`,
      tone: 'teal'
    })
    )
    );
    return list;
  }, [scope, user]);

  const read = new Set(db.readNotifications[user.id] ?? []);
  const withRead: AppNotification[] = items.map((i) => ({ ...i, read: read.has(i.id) }));
  return {
    items: withRead,
    unreadCount: withRead.filter((i) => !i.read).length,
    markAllRead: () => markNotificationsRead(items.map((i) => i.id)),
    markRead: (id: string) => markNotificationsRead([id])
  };
}