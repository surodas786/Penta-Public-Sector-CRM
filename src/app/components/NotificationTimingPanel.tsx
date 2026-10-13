/**
 * Notification timing on the Administration page (CR2, step 6): when reminder
 * and summary emails go out, in Bangladesh time, and who receives the
 * management summary. Which emails are on is chosen in Email templates. The
 * server re-checks every chosen person; ticking a box grants nothing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PencilIcon } from 'lucide-react';

import type { NotificationTimingDto } from '../../../shared/api.js';
import { DEADLINE_REMINDER_MAX_HOURS, WEEKDAY_LABELS, type SummaryFrequency } from '../../../shared/email.js';
import { fetchNotificationTiming, updateNotificationTiming } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { Panel } from '../../components/ui/Layout';
import { Modal } from '../../components/ui/Modal';
import { formatInstant } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';
import { useSubmission } from '../useSubmission.js';
import { ErrorPanel, LoadingPanel } from './Feedback.js';
import { DialogAlert } from './FormBits.js';

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export function NotificationTimingPanel() {
  const timing = useApiResource(useCallback((signal: AbortSignal) => fetchNotificationTiming(signal), []), []);
  const [editing, setEditing] = useState(false);
  const current = timing.data;
  const chosen = current?.managementCandidates.filter((person) => current.managementSummaryRecipientIds.includes(person.id)) ?? [];

  return (
    <Panel
      title="Notification timing"
      subtitle="When reminder and summary emails are sent, in Bangladesh time. Turn each email on or off in Email templates."
      action={
        current && (
          <Button size="sm" variant="primary" icon={<PencilIcon className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
            Edit timing
          </Button>
        )
      }
    >
      {timing.error ? (
        <ErrorPanel error={timing.error} onRetry={timing.reload} />
      ) : !current ? (
        <LoadingPanel label="Loading notification timing…" />
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] text-slate-700 sm:grid-cols-2">
          <div>
            <dt className="text-[11.5px] text-slate-500">Follow-up reminders and summaries</dt>
            <dd>From {hourLabel(current.reminderHour)} Bangladesh time</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-slate-500">Deadline reminders, before the deadline</dt>
            <dd>
              Tender {current.tenderReminderHours} h · EOI {current.eoiReminderHours} h · RFP proposal {current.rfpReminderHours} h
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-slate-500">Summaries</dt>
            <dd>{current.summaryFrequency === 'daily' ? 'Every day' : `Every ${WEEKDAY_LABELS[current.summaryWeekday]}`}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-slate-500">Management summary recipients</dt>
            <dd>
              {chosen.length === 0
                ? 'Nobody chosen'
                : chosen.map((person) => `${person.fullName}${person.eligible ? '' : ' (no longer eligible, not sent)'}`).join(', ')}
            </dd>
          </div>
          {current.updatedAt && (
            <p className="text-[11.5px] text-slate-500 sm:col-span-2">
              Last changed {formatInstant(current.updatedAt)}
              {current.updatedByName ? ` by ${current.updatedByName}` : ''}
            </p>
          )}
        </dl>
      )}
      {current && (
        <NotificationTimingDialog
          open={editing}
          timing={current}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            timing.reload();
          }}
        />
      )}
    </Panel>
  );
}

function NotificationTimingDialog({
  open,
  timing,
  onClose,
  onSaved,
}: {
  open: boolean;
  timing: NotificationTimingDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [reminderHour, setReminderHour] = useState(timing.reminderHour);
  const [tenderHours, setTenderHours] = useState(String(timing.tenderReminderHours));
  const [eoiHours, setEoiHours] = useState(String(timing.eoiReminderHours));
  const [rfpHours, setRfpHours] = useState(String(timing.rfpReminderHours));
  const [frequency, setFrequency] = useState<SummaryFrequency>(timing.summaryFrequency);
  const [weekday, setWeekday] = useState(timing.summaryWeekday);
  const [recipients, setRecipients] = useState<string[]>(timing.managementSummaryRecipientIds);

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setReminderHour(timing.reminderHour);
    setTenderHours(String(timing.tenderReminderHours));
    setEoiHours(String(timing.eoiReminderHours));
    setRfpHours(String(timing.rfpReminderHours));
    setFrequency(timing.summaryFrequency);
    setWeekday(timing.summaryWeekday);
    setRecipients(timing.managementSummaryRecipientIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run(() =>
      updateNotificationTiming({
        version: timing.version,
        reminderHour,
        tenderReminderHours: Number(tenderHours),
        eoiReminderHours: Number(eoiHours),
        rfpReminderHours: Number(rfpHours),
        summaryFrequency: frequency,
        summaryWeekday: weekday,
        managementSummaryRecipientIds: recipients,
      }),
    );
    if (result) {
      toast.success('Notification timing saved');
      onSaved();
    }
  };

  const hoursField = (id: string, label: string, value: string, set: (next: string) => void, error: string | undefined) => (
    <Field label={label} htmlFor={id} required error={error} hint={`1 to ${DEADLINE_REMINDER_MAX_HOURS} hours before the deadline.`}>
      <input id={id} inputMode="numeric" className={inputCls(error)} value={value} onChange={(event) => set(event.target.value)} />
    </Field>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Notification timing"
      description="Times are Bangladesh time. A deadline reminder is never earlier than its in-app alert, 72 hours before."
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="notification-timing-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : 'Save timing'}
          </Button>
        </>
      }
    >
      <form id="notification-timing-form" onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <DialogAlert message={submission.formError} conflict={submission.conflict} />
        </div>
        <Field
          label="Send follow-up reminders and summaries from"
          htmlFor="n-hour"
          error={errors.reminderHour}
          hint="Due-today and overdue reminders wait until this hour."
        >
          <select id="n-hour" className={inputCls(errors.reminderHour)} value={reminderHour} onChange={(event) => setReminderHour(Number(event.target.value))}>
            {Array.from({ length: 24 }, (_unused, hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </Field>
        {hoursField('n-tender', 'Tender deadline reminder (hours)', tenderHours, setTenderHours, errors.tenderReminderHours)}
        {hoursField('n-eoi', 'EOI deadline reminder (hours)', eoiHours, setEoiHours, errors.eoiReminderHours)}
        {hoursField('n-rfp', 'RFP proposal deadline reminder (hours)', rfpHours, setRfpHours, errors.rfpReminderHours)}
        <Field label="Summaries" htmlFor="n-frequency" error={errors.summaryFrequency}>
          <select
            id="n-frequency"
            className={inputCls(errors.summaryFrequency)}
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as SummaryFrequency)}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Once a week</option>
          </select>
        </Field>
        {frequency === 'weekly' && (
          <Field label="On" htmlFor="n-weekday" error={errors.summaryWeekday}>
            <select id="n-weekday" className={inputCls(errors.summaryWeekday)} value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
              {WEEKDAY_LABELS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <fieldset className="sm:col-span-2">
          <legend className="text-[13px] font-medium text-slate-800">Management summary recipients</legend>
          <p className="text-[11.5px] text-slate-500">Only the people ticked here receive it. Team summaries go to each section lead.</p>
          {timing.managementCandidates.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-slate-500">There are no active management accounts.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {timing.managementCandidates.map((person) => (
                <li key={person.id}>
                  <label className="flex flex-wrap items-center gap-2 text-[13px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={recipients.includes(person.id)}
                      disabled={!person.eligible && !recipients.includes(person.id)}
                      onChange={(event) =>
                        setRecipients((previous) =>
                          event.target.checked ? [...previous, person.id] : previous.filter((id) => id !== person.id),
                        )
                      }
                    />
                    {person.fullName} <span className="text-slate-500">{person.email}</span>
                    {!person.eligible && <span className="text-[11.5px] text-red-700">No longer an active management account</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {errors.managementSummaryRecipientIds && (
            <p role="alert" className="mt-1 text-[12.5px] font-medium text-red-700">
              {errors.managementSummaryRecipientIds}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
