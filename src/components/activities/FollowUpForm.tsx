import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { FollowUp, FollowUpStatus, Priority } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { useScope } from '../../hooks/useScope';
import { PRIORITIES } from '../../data/options';
import { addDays, DEMO_TODAY } from '../../utils/demoClock';
import { taskAssignees } from '../../utils/permissions';
import { isActiveOpp } from '../../utils/metrics';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from '../ui/FormFields';

interface FollowUpFormProps {
  open: boolean;
  onClose: () => void;
  defaultOppId?: string;
  followUp?: FollowUp;
}

export function FollowUpForm({ open, onClose, defaultOppId, followUp }: FollowUpFormProps) {
  const { saveFollowUp } = useCrm();
  const scope = useScope();
  const { user, users } = scope;
  const [oppId, setOppId] = useState('');
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [status, setStatus] = useState<FollowUpStatus>('Open');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setOppId(followUp?.oppId ?? defaultOppId ?? '');
    setTitle(followUp?.title ?? '');
    setAssigneeId(followUp?.assigneeId ?? user.id);
    setDue(followUp?.due ?? addDays(DEMO_TODAY, 3));
    setPriority(followUp?.priority ?? 'Medium');
    setStatus(followUp?.status ?? 'Open');
    setNote(followUp?.completionNote ?? '');
    setErrors({});
  }, [open, followUp, defaultOppId, user.id]);

  const opp = scope.opportunities.find((o) => o.id === oppId);
  const assignees = opp ? taskAssignees(user, opp, users) : [];
  if (followUp && !assignees.some((a) => a.id === followUp.assigneeId)) {
    const existing = users.find((u) => u.id === followUp.assigneeId);
    if (existing) assignees.push(existing);
  }

  useEffect(() => {
    if (opp && assigneeId && !assignees.some((a) => a.id === assigneeId)) setAssigneeId(assignees[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!oppId) errs.oppId = 'Select the linked opportunity.';
    if (!title.trim()) errs.title = 'Task title is required.';
    if (!assigneeId) errs.assigneeId = 'Assign the task to a permitted user.';
    if (!due) errs.due = 'Due date is required.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const res = saveFollowUp({ oppId, title, assigneeId, due, priority, status, completionNote: status === 'Completed' ? note.trim() : '' }, followUp?.id);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save follow-up.');
      return;
    }
    toast.success(followUp ? 'Follow-up updated' : 'Follow-up scheduled', { description: title });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={followUp ? 'Edit follow-up' : 'Add follow-up'}
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="fu-form">
            {followUp ? 'Save follow-up' : 'Schedule follow-up'}
          </Button>
        </>
      }>
      
      <form id="fu-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <Field label="Linked opportunity" htmlFor="f-opp" required error={errors.oppId} className="sm:col-span-2">
          <select id="f-opp" className={inputCls(errors.oppId)} value={oppId} onChange={(e) => setOppId(e.target.value)} disabled={!!defaultOppId || !!followUp}>
            <option value="">Select opportunity…</option>
            {scope.opportunities.filter((o) => isActiveOpp(o) || o.id === oppId).map((o) =>
            <option key={o.id} value={o.id}>
                {o.name}
              </option>
            )}
          </select>
        </Field>
        <Field label="Task title" htmlFor="f-title" required error={errors.title} className="sm:col-span-2">
          <input id="f-title" className={inputCls(errors.title)} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Send revised scope" />
        </Field>
        <Field label="Assigned user" htmlFor="f-assignee" required error={errors.assigneeId} hint="Limited to users permitted to see this opportunity">
          <select id="f-assignee" className={inputCls(errors.assigneeId)} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={!opp}>
            <option value="">Select user…</option>
            {assignees.map((a) =>
            <option key={a.id} value={a.id}>
                {a.name}
                {a.id === user.id ? ' (me)' : ''}
              </option>
            )}
          </select>
        </Field>
        <Field label="Due date" htmlFor="f-due" required error={errors.due}>
          <input id="f-due" type="date" className={inputCls(errors.due)} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor="f-pri" required>
          <select id="f-pri" className={inputCls()} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) =>
            <option key={p}>{p}</option>
            )}
          </select>
        </Field>
        <Field label="Status" htmlFor="f-status" required>
          <select id="f-status" className={inputCls()} value={status} onChange={(e) => setStatus(e.target.value as FollowUpStatus)}>
            <option>Open</option>
            <option>Completed</option>
          </select>
        </Field>
        {status === 'Completed' &&
        <Field label="Completion note" htmlFor="f-note" className="sm:col-span-2">
            <textarea id="f-note" rows={2} className={inputCls()} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>
        }
      </form>
    </Modal>);

}