/**
 * Log or amend an activity (FR-040, FR-041) — the approved "Log activity"
 * form. Times are entered in Bangladesh time. The optional next action is
 * created by the server in the same transaction as the activity.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { ActivityDto } from '../../../shared/api.js';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, BUSINESS_TIME_LABEL } from '../../../shared/enums.js';
import { createActivity, fetchOpportunityContacts, updateActivity } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, FormSection, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { fromDhakaInput, toDhakaInput } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';
import { useSubmission } from '../useSubmission.js';
import { DialogAlert } from './FormBits.js';
import { OpportunityPicker } from './OpportunityPicker.js';

export function ActivityDialog({
  open,
  opportunityId: fixedOpportunityId,
  activity,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Set when logging from an opportunity page; otherwise the user picks one. */
  opportunityId?: string;
  /** Set to amend an existing activity. */
  activity?: ActivityDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [opportunityId, setOpportunityId] = useState('');
  const [at, setAt] = useState('');
  const [type, setType] = useState<string>('meeting');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [contactId, setContactId] = useState('');
  const [nextTitle, setNextTitle] = useState('');
  const [nextDue, setNextDue] = useState('');

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setOpportunityId(activity?.opportunity.id ?? fixedOpportunityId ?? '');
    setAt(toDhakaInput(activity?.occurredAt ?? new Date()));
    setType(activity?.type ?? 'meeting');
    setSubject(activity?.subject ?? '');
    setNotes(activity?.notes ?? '');
    setContactId(activity?.contact?.id ?? '');
    setNextTitle('');
    setNextDue('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activity?.id, fixedOpportunityId]);

  const contacts = useApiResource(
    useCallback(
      (signal: AbortSignal) =>
        opportunityId ? fetchOpportunityContacts(opportunityId, signal) : Promise.resolve({ items: [] }),
      [opportunityId],
    ),
    [opportunityId, open],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activity && !opportunityId) {
      toast.error('Choose the opportunity this activity belongs to.');
      return;
    }
    const body = {
      type,
      occurredAt: fromDhakaInput(at),
      subject,
      notes: notes || null,
      contactId: contactId || null,
    };
    const next = nextTitle.trim() || nextDue ? { nextFollowUp: { title: nextTitle, dueDate: nextDue } } : {};
    const result = await submission.run((key) =>
      activity
        ? updateActivity(activity.id, { version: activity.version, ...body })
        : createActivity(opportunityId, { ...body, ...next }, key),
    );
    if (result) {
      toast.success(activity ? 'Activity updated' : `${ACTIVITY_TYPE_LABELS[result.type]} logged`, {
        description: next.nextFollowUp ? 'The next action was added as a follow-up.' : result.subject,
      });
      onDone();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={activity ? 'Edit activity' : 'Log activity'}
      description={`Times are in ${BUSINESS_TIME_LABEL}.${activity ? ' The original author is kept; your edit is recorded.' : ''}`}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="activity-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : activity ? 'Save changes' : 'Log activity'}
          </Button>
        </>
      }
    >
      <form id="activity-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        <FormSection title="Activity">
          {!activity && !fixedOpportunityId && (
            <OpportunityPicker
              value={opportunityId}
              onChange={(id) => {
                setOpportunityId(id);
                setContactId('');
              }}
            />
          )}
          <Field label={`Date and time (${BUSINESS_TIME_LABEL})`} htmlFor="a-at" required error={errors.occurredAt}>
            <input id="a-at" type="datetime-local" className={inputCls(errors.occurredAt)} value={at} onChange={(event) => setAt(event.target.value)} />
          </Field>
          <Field label="Activity type" htmlFor="a-type" required error={errors.type}>
            <select id="a-type" className={inputCls(errors.type)} value={type} onChange={(event) => setType(event.target.value)}>
              {ACTIVITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ACTIVITY_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject" htmlFor="a-sub" required error={errors.subject} className="sm:col-span-2">
            <input
              id="a-sub"
              className={inputCls(errors.subject)}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="e.g. Requirements workshop with ICT Cell"
            />
          </Field>
          <Field label="Notes" htmlFor="a-notes" error={errors.notes} className="sm:col-span-2">
            <textarea id="a-notes" rows={3} className={inputCls(errors.notes)} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <Field
            label="Contact involved"
            htmlFor="a-contact"
            error={errors.contactId}
            hint={opportunityId && contacts.data?.items.length === 0 ? 'No contacts linked to this opportunity yet.' : undefined}
          >
            <select
              id="a-contact"
              className={inputCls(errors.contactId)}
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              disabled={!opportunityId}
            >
              <option value="">None</option>
              {contacts.data?.items.map((item) => (
                <option key={item.contact.id} value={item.contact.id}>
                  {item.contact.fullName} — {item.contact.designation}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>
        {!activity && (
          <FormSection title="Next action (optional)">
            <Field
              label="Next action"
              htmlFor="a-na"
              error={errors['nextFollowUp.title']}
              hint="Creates a follow-up for the opportunity owner, saved together with the activity."
            >
              <input id="a-na" className={inputCls(errors['nextFollowUp.title'])} value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} />
            </Field>
            <Field label="Due date" htmlFor="a-nd" error={errors['nextFollowUp.dueDate']}>
              <input id="a-nd" type="date" className={inputCls(errors['nextFollowUp.dueDate'])} value={nextDue} onChange={(event) => setNextDue(event.target.value)} />
            </Field>
          </FormSection>
        )}
      </form>
    </Modal>
  );
}
