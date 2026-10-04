import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Tender } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { DEMO_TODAY } from '../../utils/demoClock';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from '../ui/FormFields';

export function MarkSubmittedModal({ tender, onClose }: {tender: Tender | null;onClose: () => void;}) {
  const { saveTender } = useCrm();
  const [date, setDate] = useState(DEMO_TODAY);
  const [error, setError] = useState('');
  useEffect(() => {
    setDate(DEMO_TODAY);
    setError('');
  }, [tender?.id]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tender) return;
    if (!date) {
      setError('Bid submission date is required.');
      return;
    }
    const { id, ...rest } = tender;
    const res = saveTender({ ...rest, bidStatus: 'Submitted', submissionDate: date }, id);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not update tender.');
      return;
    }
    toast.success('Bid marked as Submitted', { description: `${tender.reference} — tracker and dashboard updated.` });
    onClose();
  };

  return (
    <Modal
      open={!!tender}
      onClose={onClose}
      size="sm"
      title="Mark bid as Submitted"
      description={tender ? `${tender.reference} · ${tender.title}` : undefined}
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="submit-form">
            Mark Submitted
          </Button>
        </>
      }>
      
      <form id="submit-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Bid submission date" htmlFor="ms-date" required error={error}>
          <input id="ms-date" type="date" className={inputCls(error)} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500">If the opportunity is at an earlier stage, it will move to Bid Submitted automatically.</p>
      </form>
    </Modal>);

}