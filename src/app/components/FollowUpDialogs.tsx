/**
 * Follow-up lifecycle dialogs (FR-042, FR-043, BR-014).
 *
 * The approved demo's complete / reschedule / add dialogs, connected to the
 * server. Closing the last open follow-up of an active opportunity needs a
 * replacement: the dialog asks for one up front when it knows, and also when
 * the server says so (the server is the authority — another user may have
 * closed a different task in the meantime).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { FollowUpDto } from '../../../shared/api.js';
import { PRIORITIES, PRIORITY_LABELS } from '../../../shared/enums.js';
import {
  cancelFollowUp,
  completeFollowUp,
  createFollowUp,
  fetchFollowUpAssignees,
  rescheduleFollowUp,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { dhakaToday, formatCalendarDate } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';
import { useSubmission, type Submission } from '../useSubmission.js';
import { DialogAlert, FollowUpDraftFields } from './FormBits.js';
import { draftBody, emptyDraft, type FollowUpDraft } from '../followUpDraft.js';

type TaskRef = Pick<FollowUpDto, 'id' | 'opportunityId' | 'title' | 'dueDate' | 'version'>;

function Footer({
  submission,
  onClose,
  onReload,
  form,
  label,
}: {
  submission: Submission;
  onClose: () => void;
  onReload: () => void;
  form: string;
  label: string;
}) {
  return (
    <>
      <Button onClick={onClose} disabled={submission.submitting}>
        Cancel
      </Button>
      {submission.conflict && (
        <Button variant="navy" onClick={onReload}>
          Reload current values
        </Button>
      )}
      <Button variant="primary" type="submit" form={form} disabled={submission.submitting || submission.conflict}>
        {submission.submitting ? 'Saving…' : label}
      </Button>
    </>
  );
}

/** Replacement next action: required when known to be the last, otherwise offered. */
function ReplacementSection({
  task,
  required,
  submission,
  wanted,
  setWanted,
  draft,
  setDraft,
}: {
  task: TaskRef;
  required: boolean;
  submission: Submission;
  wanted: boolean;
  setWanted: (value: boolean) => void;
  draft: FollowUpDraft;
  setDraft: (draft: FollowUpDraft) => void;
}) {
  const mustReplace = required || Boolean(submission.fieldErrors.replacement);
  return (
    <>
      {!mustReplace && (
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" checked={wanted} onChange={(event) => setWanted(event.target.checked)} />
          Also schedule the next follow-up
        </label>
      )}
      {(mustReplace || wanted) && (
        <FollowUpDraftFields
          opportunityId={task.opportunityId}
          draft={draft}
          onChange={setDraft}
          errors={submission.fieldErrors}
          prefix="replacement"
          legend={mustReplace ? 'Next follow-up (required)' : 'Next follow-up'}
          hint={
            mustReplace
              ? submission.fieldErrors.replacement ??
                'This is the only open follow-up on an active opportunity, so it needs a replacement. To stop work instead, put the opportunity On Hold, cancel it or record its outcome.'
              : undefined
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export function CompleteFollowUpDialog({
  task,
  isLastOpen,
  onClose,
  onDone,
  onReload,
}: {
  task: TaskRef | null;
  isLastOpen: boolean;
  onClose: () => void;
  onDone: () => void;
  onReload: () => void;
}) {
  const submission = useSubmission();
  const [note, setNote] = useState('');
  const [wanted, setWanted] = useState(false);
  const [draft, setDraft] = useState<FollowUpDraft>(emptyDraft());

  useEffect(() => {
    if (!task) return;
    submission.reset();
    setNote('');
    setWanted(false);
    setDraft(emptyDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!task) return;
    const replace = isLastOpen || wanted || Boolean(submission.fieldErrors.replacement);
    const result = await submission.run((key) =>
      completeFollowUp(
        task.id,
        {
          version: task.version,
          completionNote: note || undefined,
          ...(replace ? { replacement: draftBody(draft) } : {}),
        },
        key,
      ),
    );
    if (result) {
      toast.success('Follow-up completed', { description: task.title });
      onDone();
    }
  };

  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      size="sm"
      title="Mark follow-up complete"
      description={task?.title}
      footer={<Footer submission={submission} onClose={onClose} onReload={onReload} form="complete-form" label="Mark complete" />}
    >
      {task && (
        <form id="complete-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
          <DialogAlert message={submission.formError} conflict={submission.conflict} />
          <Field
            label="Completion note"
            htmlFor="c-note"
            hint="Optional — e.g. outcome or reference"
            error={submission.fieldErrors.completionNote}
          >
            <textarea id="c-note" rows={3} className={inputCls()} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <ReplacementSection
            task={task}
            required={isLastOpen}
            submission={submission}
            wanted={wanted}
            setWanted={setWanted}
            draft={draft}
            setDraft={setDraft}
          />
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function RescheduleFollowUpDialog({
  task,
  onClose,
  onDone,
  onReload,
}: {
  task: TaskRef | null;
  onClose: () => void;
  onDone: () => void;
  onReload: () => void;
}) {
  const submission = useSubmission();
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!task) return;
    submission.reset();
    setDue(task.dueDate);
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!task) return;
    const result = await submission.run((key) =>
      rescheduleFollowUp(task.id, { version: task.version, dueDate: due, reason }, key),
    );
    if (result) {
      toast.success('Follow-up rescheduled', { description: `${task.title} · now due ${formatCalendarDate(due)}` });
      onDone();
    }
  };

  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      size="sm"
      title="Reschedule follow-up"
      description={task ? `${task.title} · due ${formatCalendarDate(task.dueDate)}` : undefined}
      footer={<Footer submission={submission} onClose={onClose} onReload={onReload} form="resched-form" label="Save new date" />}
    >
      <form id="resched-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        <Field label="New due date" htmlFor="r-due" required error={submission.fieldErrors.dueDate}>
          <input
            id="r-due"
            type="date"
            className={inputCls(submission.fieldErrors.dueDate)}
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </Field>
        <Field
          label="Reason"
          htmlFor="r-reason"
          required
          error={submission.fieldErrors.reason}
          hint="The old date, new date and reason are recorded in Change History."
        >
          <textarea
            id="r-reason"
            rows={2}
            className={inputCls(submission.fieldErrors.reason)}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function CancelFollowUpDialog({
  task,
  isLastOpen,
  onClose,
  onDone,
  onReload,
}: {
  task: TaskRef | null;
  isLastOpen: boolean;
  onClose: () => void;
  onDone: () => void;
  onReload: () => void;
}) {
  const submission = useSubmission();
  const [reason, setReason] = useState('');
  const [wanted, setWanted] = useState(false);
  const [draft, setDraft] = useState<FollowUpDraft>(emptyDraft());

  useEffect(() => {
    if (!task) return;
    submission.reset();
    setReason('');
    setWanted(false);
    setDraft(emptyDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!task) return;
    const replace = isLastOpen || wanted || Boolean(submission.fieldErrors.replacement);
    const result = await submission.run((key) =>
      cancelFollowUp(
        task.id,
        { version: task.version, reason, ...(replace ? { replacement: draftBody(draft) } : {}) },
        key,
      ),
    );
    if (result) {
      toast.success('Follow-up cancelled', { description: task.title });
      onDone();
    }
  };

  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      size="sm"
      title="Cancel follow-up"
      description={task?.title}
      footer={<Footer submission={submission} onClose={onClose} onReload={onReload} form="cancel-fu-form" label="Cancel follow-up" />}
    >
      {task && (
        <form id="cancel-fu-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
          <DialogAlert message={submission.formError} conflict={submission.conflict} />
          <p className="text-xs text-slate-500">
            A cancelled follow-up is kept in the record as Cancelled, never as Completed.
          </p>
          <Field label="Reason" htmlFor="x-reason" required error={submission.fieldErrors.reason}>
            <textarea
              id="x-reason"
              rows={2}
              className={inputCls(submission.fieldErrors.reason)}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <ReplacementSection
            task={task}
            required={isLastOpen}
            submission={submission}
            wanted={wanted}
            setWanted={setWanted}
            draft={draft}
            setDraft={setDraft}
          />
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/** Quick creation (FR-043), the approved "Add follow-up" form. */
export function AddFollowUpDialog({
  opportunityId,
  open,
  onClose,
  onDone,
}: {
  opportunityId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const submission = useSubmission();
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('medium');

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchFollowUpAssignees(opportunityId, signal),
    [opportunityId],
  );
  const assignees = useApiResource(fetcher, [opportunityId, open]);

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setTitle('');
    setDue(dhakaToday());
    setPriority('medium');
    setAssigneeId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default to the owner, or the first eligible person if the owner cannot be assigned.
  useEffect(() => {
    if (!open || assigneeId || !assignees.data) return;
    const preferred = assignees.data.items.find((item) => item.relation === 'owner') ?? assignees.data.items[0];
    if (preferred) setAssigneeId(preferred.id);
  }, [open, assigneeId, assignees.data]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run((key) =>
      createFollowUp(opportunityId, { title, dueDate: due, assigneeId, priority }, key),
    );
    if (result) {
      toast.success('Follow-up scheduled', { description: title });
      onDone();
    }
  };

  const errors = submission.fieldErrors;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add follow-up"
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="fu-form" disabled={submission.submitting}>
            {submission.submitting ? 'Saving…' : 'Schedule follow-up'}
          </Button>
        </>
      }
    >
      <form id="fu-form" onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <DialogAlert message={submission.formError} />
        </div>
        <Field label="Task title" htmlFor="f-title" required error={errors.title} className="sm:col-span-2">
          <input
            id="f-title"
            className={inputCls(errors.title)}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Send revised scope"
          />
        </Field>
        <Field
          label="Assigned user"
          htmlFor="f-assignee"
          required
          error={errors.assigneeId}
          hint="Limited to users permitted to see this opportunity"
        >
          <select
            id="f-assignee"
            className={inputCls(errors.assigneeId)}
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">Select user…</option>
            {assignees.data?.items.map((option) => (
              <option key={option.id} value={option.id}>
                {option.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due date" htmlFor="f-due" required error={errors.dueDate}>
          <input
            id="f-due"
            type="date"
            className={inputCls(errors.dueDate)}
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </Field>
        <Field label="Priority" htmlFor="f-pri" required error={errors.priority}>
          <select id="f-pri" className={inputCls()} value={priority} onChange={(event) => setPriority(event.target.value)}>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
