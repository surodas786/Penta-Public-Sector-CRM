/**
 * Small pieces shared by the API-mode dialogs, built from the approved form
 * primitives so they look exactly like the demo's dialogs.
 */
import { useCallback } from 'react';

import type { AssigneeOptionDto } from '../../../shared/api.js';
import { fetchFollowUpAssignees } from '../../api/endpoints.js';
import { Field, inputCls } from '../../components/ui/FormFields';
import { useApiResource } from '../useApiResource.js';
import type { FollowUpDraft } from '../followUpDraft.js';

/** Form-level error or conflict notice, shown above the fields. */
export function DialogAlert({ message, conflict }: { message: string | null; conflict?: boolean }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`rounded-md border px-3 py-2 text-[13px] font-medium ${
        conflict ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      <p>{message}</p>
      {conflict && (
        <p className="mt-1 font-normal">
          Your entries are kept. Choose “Reload current values”, check what changed, then try again.
        </p>
      )}
    </div>
  );
}

const RELATION_LABELS: Record<AssigneeOptionDto['relation'], string> = {
  owner: 'owner',
  section_lead: 'section lead',
  management: 'management',
};

/**
 * Title, assignee and due date for a follow-up created inside another action:
 * a replacement next action, or the next action a transition requires.
 * `prefix` matches the server's field-error keys (e.g. `nextFollowUp.title`).
 */
export function FollowUpDraftFields({
  opportunityId,
  draft,
  onChange,
  errors,
  prefix,
  legend,
  hint,
}: {
  opportunityId: string;
  draft: FollowUpDraft;
  onChange: (next: FollowUpDraft) => void;
  errors: Record<string, string>;
  prefix: string;
  legend: string;
  hint?: string;
}) {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchFollowUpAssignees(opportunityId, signal),
    [opportunityId],
  );
  const assignees = useApiResource(fetcher, [opportunityId]);
  const error = (field: string) => errors[`${prefix}.${field}`] ?? (field === 'title' ? errors[prefix] : undefined);

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <legend className="px-1 text-[12px] font-bold text-slate-800">{legend}</legend>
      {hint && <p className="-mt-1 text-xs text-slate-500">{hint}</p>}
      <Field label="Next action" htmlFor={`${prefix}-title`} required error={error('title')}>
        <input
          id={`${prefix}-title`}
          className={inputCls(error('title'))}
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="e.g. Send revised scope"
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Due date" htmlFor={`${prefix}-due`} required error={error('dueDate')}>
          <input
            id={`${prefix}-due`}
            type="date"
            className={inputCls(error('dueDate'))}
            value={draft.dueDate}
            onChange={(event) => onChange({ ...draft, dueDate: event.target.value })}
          />
        </Field>
        <Field
          label="Assigned to"
          htmlFor={`${prefix}-assignee`}
          error={error('assigneeId')}
          hint="Only people who can already see this opportunity"
        >
          <select
            id={`${prefix}-assignee`}
            className={inputCls(error('assigneeId'))}
            value={draft.assigneeId}
            onChange={(event) => onChange({ ...draft, assigneeId: event.target.value })}
          >
            <option value="">Opportunity owner (default)</option>
            {assignees.data?.items.map((option) => (
              <option key={option.id} value={option.id}>
                {option.fullName} — {RELATION_LABELS[option.relation]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </fieldset>
  );
}
