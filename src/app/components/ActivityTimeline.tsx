/**
 * The approved activity timeline, for API activities. Same markup as the
 * demo's; adds an "edited" marker and an Edit control where the server says
 * the caller may amend (FR-041).
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { BuildingIcon, MailIcon, MessageSquareIcon, MoreHorizontalIcon, PencilIcon, PhoneIcon, UsersIcon } from 'lucide-react';

import type { ActivityDto } from '../../../shared/api.js';
import { ACTIVITY_TYPE_LABELS, type ActivityType } from '../../../shared/enums.js';
import { formatInstant } from '../ui/dates.js';

const ICONS: Record<ActivityType, React.ElementType> = {
  meeting: UsersIcon,
  phone_call: PhoneIcon,
  email: MailIcon,
  office_visit: BuildingIcon,
  internal_discussion: MessageSquareIcon,
  other: MoreHorizontalIcon,
};

export function ActivityTimeline({
  activities,
  showOpportunity = false,
  onEdit,
}: {
  activities: ActivityDto[];
  showOpportunity?: boolean;
  onEdit?: (activity: ActivityDto) => void;
}) {
  return (
    <ol className="relative flex flex-col">
      {activities.map((activity, index) => {
        const Icon = ICONS[activity.type];
        return (
          <li key={activity.id} className="relative flex gap-3 pb-4">
            {index < activities.length - 1 && (
              <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-slate-200" aria-hidden="true" />
            )}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand-dark">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-[13px] font-semibold text-slate-900">{activity.subject}</p>
                <p className="text-[11px] tabular-nums text-slate-400">{formatInstant(activity.occurredAt)}</p>
              </div>
              <p className="text-[11.5px] text-slate-500">
                {ACTIVITY_TYPE_LABELS[activity.type]} · by {activity.authorName}
                {activity.contact && (
                  <>
                    {' '}· with{' '}
                    <Link to={`/contacts/${activity.contact.id}`} className="font-medium text-brand-dark hover:underline">
                      {activity.contact.fullName}
                    </Link>
                  </>
                )}
                {showOpportunity && (
                  <>
                    {' '}·{' '}
                    <Link to={`/opportunities/${activity.opportunity.id}?tab=activities`} className="font-medium text-brand-dark hover:underline">
                      {activity.opportunity.name}
                    </Link>
                  </>
                )}
                {activity.editedAt && (
                  <span className="text-slate-400">
                    {' '}· edited by {activity.editedByName} {formatInstant(activity.editedAt)}
                  </span>
                )}
              </p>
              {activity.notes && <p className="mt-1 whitespace-pre-line text-[13px] text-slate-700">{activity.notes}</p>}
              {onEdit && activity.canEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(activity)}
                  className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label={`Edit ${activity.subject}`}
                >
                  <PencilIcon className="h-3 w-3" />
                  Edit
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
