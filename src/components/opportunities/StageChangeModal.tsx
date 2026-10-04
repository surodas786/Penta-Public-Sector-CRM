import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Opportunity, Stage } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { DEMO_TODAY } from '../../utils/demoClock';
import { isActiveStage } from '../../utils/validation';
import { formatBDT } from '../../utils/format';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from '../ui/FormFields';

interface StageChangeModalProps {
  opportunity: Opportunity | null;
  targetStage: Stage | null;
  onClose: () => void;
}

export function StageChangeModal({ opportunity, targetStage, onClose }: StageChangeModalProps) {
  const { changeStage } = useCrm();
  const [awardedValue, setAwardedValue] = useState<string>('');
  const [awardDate, setAwardDate] = useState(DEMO_TODAY);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [error, setError] = useState<Record<string, string>>({});

  const open = !!opportunity && !!targetStage;

  useEffect(() => {
    if (open && opportunity) {
      setAwardedValue(String(opportunity.awardedValue ?? opportunity.estimatedValue));
      setAwardDate(opportunity.awardDate || DEMO_TODAY);
      setReason('');
      setNote('');
      setNextAction(opportunity.nextAction);
      setNextDue(opportunity.nextActionDue);
      setError({});
    }
  }, [open, opportunity]);

  if (!opportunity || !targetStage) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const needsNext = isActiveStage(targetStage);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (targetStage === 'Awarded') {
      if (!awardedValue || Number(awardedValue) <= 0) errs.awardedValue = 'Actual awarded value is required.';
      if (!awardDate) errs.awardDate = 'Award date is required.';
    }
    if (targetStage === 'Lost' && !reason.trim()) errs.reason = 'A reason is required.';
    if ((targetStage === 'On Hold' || targetStage === 'Cancelled') && !note.trim()) errs.note = 'A note is required.';
    if (needsNext) {
      if (!nextAction.trim()) errs.nextAction = 'Next action is required for active opportunities.';
      if (!nextDue) errs.nextDue = 'Due date is required.';
    }
    setError(errs);
    if (Object.keys(errs).length) return;
    const res = changeStage(opportunity.id, targetStage, {
      awardedValue: targetStage === 'Awarded' ? Number(awardedValue) : undefined,
      awardDate: targetStage === 'Awarded' ? awardDate : undefined,
      lostReason: targetStage === 'Lost' ? reason : undefined,
      statusNote: targetStage === 'On Hold' || targetStage === 'Cancelled' ? note : undefined,
      nextAction: needsNext ? nextAction : undefined,
      nextActionDue: needsNext ? nextDue : undefined
    });
    if (!res.ok) {
      toast.error(res.error ?? 'Could not change stage.');
      return;
    }
    toast.success(`Moved to ${targetStage}`, { description: opportunity.name });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Move to ${targetStage}`}
      description={`${opportunity.name} · currently ${opportunity.stage}`}
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="stage-form">
            Confirm stage change
          </Button>
        </>
      }>
      
      <form id="stage-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {targetStage === 'Awarded' &&
        <>
            <Field label="Actual awarded value (BDT)" htmlFor="s-av" required error={error.awardedValue} hint={`Estimated: ${formatBDT(opportunity.estimatedValue)}`}>
              <input id="s-av" type="number" min={0} className={inputCls(error.awardedValue)} value={awardedValue} onChange={(e) => setAwardedValue(e.target.value)} />
            </Field>
            <Field label="Award date" htmlFor="s-ad" required error={error.awardDate}>
              <input id="s-ad" type="date" className={inputCls(error.awardDate)} value={awardDate} onChange={(e) => setAwardDate(e.target.value)} />
            </Field>
          </>
        }
        {targetStage === 'Lost' &&
        <Field label="Reason lost" htmlFor="s-r" required error={error.reason}>
            <textarea id="s-r" rows={3} className={inputCls(error.reason)} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Lost on price" />
          </Field>
        }
        {(targetStage === 'On Hold' || targetStage === 'Cancelled') &&
        <Field label="Note" htmlFor="s-n" required error={error.note}>
            <textarea id="s-n" rows={3} className={inputCls(error.note)} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        }
        {needsNext &&
        <>
            <Field label="Next action" htmlFor="s-na" required error={error.nextAction}>
              <input id="s-na" className={inputCls(error.nextAction)} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
            </Field>
            <Field label="Next action due date" htmlFor="s-nd" required error={error.nextDue}>
              <input id="s-nd" type="date" className={inputCls(error.nextDue)} value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
            </Field>
          </>
        }
        <p className="text-xs text-slate-500">The change will be recorded in Change History with your name and timestamp.</p>
      </form>
    </Modal>);

}