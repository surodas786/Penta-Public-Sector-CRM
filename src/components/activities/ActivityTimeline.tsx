import React from 'react';
import { Link } from 'react-router-dom';
import { BuildingIcon, MailIcon, MessageSquareIcon, PhoneIcon, UsersIcon, MoreHorizontalIcon } from 'lucide-react';
import type { Activity, ActivityType, Contact, Opportunity, User } from '../../types/crm';
import { formatDateTime } from '../../utils/format';
import { userName } from '../../utils/lookup';

const ICONS: Record<ActivityType, React.ElementType> = {
  Meeting: UsersIcon,
  'Phone Call': PhoneIcon,
  Email: MailIcon,
  'Office Visit': BuildingIcon,
  'Internal Discussion': MessageSquareIcon,
  Other: MoreHorizontalIcon
};

interface ActivityTimelineProps {
  activities: Activity[];
  users: User[];
  contacts: Contact[];
  opportunities?: Opportunity[];
}

export function ActivityTimeline({ activities, users, contacts, opportunities }: ActivityTimelineProps) {
  return (
    <ol className="relative flex flex-col">
      {activities.map((a, i) => {
        const Icon = ICONS[a.type];
        const contact = contacts.find((c) => c.id === a.contactId);
        const opp = opportunities?.find((o) => o.id === a.oppId);
        return (
          <li key={a.id} className="relative flex gap-3 pb-4">
            {i < activities.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-slate-200" aria-hidden="true" />}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand-dark">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-[13px] font-semibold text-slate-900">{a.subject}</p>
                <p className="text-[11px] tabular-nums text-slate-400">{formatDateTime(a.at)}</p>
              </div>
              <p className="text-[11.5px] text-slate-500">
                {a.type} · by {userName(users, a.createdBy)}
                {contact &&
                <>
                    {' '}· with{' '}
                    <Link to={`/contacts/${contact.id}`} className="font-medium text-brand-dark hover:underline">
                      {contact.name}
                    </Link>
                  </>
                }
                {opp &&
                <>
                    {' '}·{' '}
                    <Link to={`/opportunities/${opp.id}?tab=activities`} className="font-medium text-brand-dark hover:underline">
                      {opp.name}
                    </Link>
                  </>
                }
              </p>
              {a.notes && <p className="mt-1 text-[13px] text-slate-700">{a.notes}</p>}
            </div>
          </li>);

      })}
    </ol>);

}