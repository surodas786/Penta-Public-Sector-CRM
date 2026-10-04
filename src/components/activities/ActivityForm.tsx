import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ActivityDraft, ActivityType } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { useScope } from '../../hooks/useScope';
import { ACTIVITY_TYPES } from '../../data/options';
import { DEMO_NOW } from '../../utils/demoClock';
import { fromDhakaInput, toDhakaInput } from '../../utils/format';
import { isActiveOpp } from '../../utils/metrics';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, FormSection, inputCls } from '../ui/FormFields';

interface ActivityFormProps {
  open: boolean;
  onClose: () => void;
  defaultOppId?: string;
}

export function ActivityForm({ open, onClose, defaultOppId }: ActivityFormProps) {
  const { saveActivity } = useCrm();
  const scope = useScope();
  const [oppId, setOppId] = useState('');
  const [at, setAt] = useState('');
  const [type, setType] = useState<ActivityType>('Meeting');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [contactId, setContactId] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setOppId(defaultOppId ?? '');
    setAt(toDhakaInput(DEMO_NOW));
    setType('Meeting');
    setSubject('');
    setNotes('');
    setContactId('');
    setNextAction('');
    setNextDue('');
    setErrors({});
  }, [open, defaultOppId]);

  const opp = scope.opportunities.find((o) => o.id === oppId);
  const contacts = opp ? scope.contacts.filter((c) => opp.contactIds.includes(c.id)) : [];
  const oppOptions = [...scope.opportunities].sort((a, b) => Number(isActiveOpp(b)) - Number(isActiveOpp(a)) || a.name.localeCompare(b.name));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!oppId) errs.oppId = 'Select the linked opportunity.';
    if (!at) errs.at = 'Date and time are required.';
    if (!subject.trim()) errs.subject = 'Subject is required.';
    if (nextAction.trim() && !nextDue) errs.nextDue = 'Add a due date for the next action.';
    if (!nextAction.trim() && nextDue) errs.nextAction = 'Describe the next action for this due date.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const draft: ActivityDraft = {
      oppId,
      at: fromDhakaInput(at),
      type,
      subject,
      notes: notes.trim(),
      contactId: contactId || null,
      nextAction: nextAction.trim(),
      nextActionDue: nextDue
    };
    const res = saveActivity(draft);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save activity.');
      return;
    }
    toast.success(`${type} logged`, { description: nextAction.trim() ? 'A follow-up task was created for the next action.' : subject });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Log activity"
      description="Times are in Bangladesh time (BST, UTC+6)."
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="activity-form">
            Log activity
          </Button>
        </>
      }>
      
      <form id="activity-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormSection title="Activity">
          <Field label="Linked opportunity" htmlFor="a-opp" required error={errors.oppId} className="sm:col-span-2">
            <select id="a-opp" className={inputCls(errors.oppId)} value={oppId} onChange={(e) => {setOppId(e.target.value);setContactId('');}} disabled={!!defaultOppId}>
              <option value="">Select opportunity…</option>
              {oppOptions.map((o) =>
              <option key={o.id} value={o.id}>
                  {o.name}
                  {isActiveOpp(o) ? '' : ` (${o.stage})`}
                </option>
              )}
            </select>
          </Field>
          <Field label="Date and time (BST)" htmlFor="a-at" required error={errors.at}>
            <input id="a-at" type="datetime-local" className={inputCls(errors.at)} value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <Field label="Activity type" htmlFor="a-type" required>
            <select id="a-type" className={inputCls()} value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
              {ACTIVITY_TYPES.map((t) =>
              <option key={t}>{t}</option>
              )}
            </select>
          </Field>
          <Field label="Subject" htmlFor="a-sub" required error={errors.subject} className="sm:col-span-2">
            <input id="a-sub" className={inputCls(errors.subject)} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Requirements workshop with ICT Cell" />
          </Field>
          <Field label="Notes" htmlFor="a-notes" className="sm:col-span-2">
            <textarea id="a-notes" rows={3} className={inputCls()} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Contact involved" htmlFor="a-contact" hint={opp && !contacts.length ? 'No contacts linked to this opportunity yet.' : undefined}>
            <select id="a-contact" className={inputCls()} value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!opp}>
              <option value="">None</option>
              {contacts.map((c) =>
              <option key={c.id} value={c.id}>
                  {c.name} — {c.designation}
                </option>
              )}
            </select>
          </Field>
        </FormSection>
        <FormSection title="Next action (optional)">
          <Field label="Next action" htmlFor="a-na" error={errors.nextAction} hint="Creates a follow-up assigned to you and updates the opportunity’s next action.">
            <input id="a-na" className={inputCls(errors.nextAction)} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
          </Field>
          <Field label="Due date" htmlFor="a-nd" error={errors.nextDue}>
            <input id="a-nd" type="date" className={inputCls(errors.nextDue)} value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </Field>
        </FormSection>
      </form>
    </Modal>);

}