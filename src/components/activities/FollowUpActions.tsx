import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { FollowUp } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from '../ui/FormFields';

export function CompleteFollowUpModal({ followUp, onClose }: {followUp: FollowUp | null;onClose: () => void;}) {
  const { completeFollowUp } = useCrm();
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [followUp?.id]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUp) return;
    const res = completeFollowUp(followUp.id, note);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not complete task.');
      return;
    }
    toast.success('Follow-up completed', { description: followUp.title });
    onClose();
  };

  return (
    <Modal
      open={!!followUp}
      onClose={onClose}
      size="sm"
      title="Mark follow-up complete"
      description={followUp?.title}
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="complete-form">
            Mark complete
          </Button>
        </>
      }>
      
      <form id="complete-form" onSubmit={submit}>
        <Field label="Completion note" htmlFor="c-note" hint="Optional — e.g. outcome or reference">
          <textarea id="c-note" rows={3} className={inputCls()} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Modal>);

}

export function RescheduleModal({ followUp, onClose }: {followUp: FollowUp | null;onClose: () => void;}) {
  const { rescheduleFollowUp } = useCrm();
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setDue(followUp?.due ?? '');
    setError('');
  }, [followUp?.id, followUp?.due]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUp) return;
    if (!due) {
      setError('Choose a new due date.');
      return;
    }
    const res = rescheduleFollowUp(followUp.id, due);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not reschedule.');
      return;
    }
    toast.success('Follow-up rescheduled', { description: followUp.title });
    onClose();
  };

  return (
    <Modal
      open={!!followUp}
      onClose={onClose}
      size="sm"
      title="Reschedule follow-up"
      description={followUp?.title}
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="resched-form">
            Save new date
          </Button>
        </>
      }>
      
      <form id="resched-form" onSubmit={submit}>
        <Field label="New due date" htmlFor="r-due" required error={error}>
          <input id="r-due" type="date" className={inputCls(error)} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </form>
    </Modal>);

}