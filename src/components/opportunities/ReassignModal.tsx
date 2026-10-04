import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightIcon, AlertTriangleIcon } from 'lucide-react';
import type { Opportunity } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { SECTIONS, sectionName } from '../../data/options';
import { assignableOwners } from '../../utils/permissions';
import { userName } from '../../utils/lookup';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from '../ui/FormFields';

interface ReassignModalProps {
  opportunity: Opportunity | null;
  onClose: () => void;
  onDone?: () => void;
}

export function ReassignModal({ opportunity, onClose, onDone }: ReassignModalProps) {
  const { db, currentUser, reassignOpportunity } = useCrm();
  const [ownerId, setOwnerId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setOwnerId('');
    setConfirming(false);
    setError('');
  }, [opportunity?.id]);

  if (!opportunity) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const options = assignableOwners(currentUser, db.users).filter((u) => u.id !== opportunity.ownerId);
  const newOwner = db.users.find((u) => u.id === ownerId);
  const crossSection = !!newOwner && newOwner.sectionId !== opportunity.sectionId;
  const related = {
    activities: db.activities.filter((a) => a.oppId === opportunity.id).length,
    tenders: db.tenders.filter((t) => t.oppId === opportunity.id).length,
    documents: db.documents.filter((d) => d.oppId === opportunity.id).length,
    followUps: db.followUps.filter((f) => f.oppId === opportunity.id && f.status === 'Open' && f.assigneeId === opportunity.ownerId).length
  };

  const next = () => {
    if (!ownerId) {
      setError('Select a new owner.');
      return;
    }
    setConfirming(true);
  };

  const confirm = () => {
    const res = reassignOpportunity(opportunity.id, ownerId);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not reassign.');
      return;
    }
    toast.success(crossSection ? 'Opportunity transferred across sections' : 'Opportunity reassigned', {
      description: `${opportunity.name} → ${newOwner?.name} (${sectionName(newOwner?.sectionId)})`
    });
    onClose();
    onDone?.();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={confirming ? crossSection ? 'Confirm cross-section transfer' : 'Confirm reassignment' : 'Reassign opportunity'}
      description={opportunity.name}
      footer={
      confirming ?
      <>
            <Button onClick={() => setConfirming(false)}>Back</Button>
            <Button variant="primary" onClick={confirm} data-autofocus>
              {crossSection ? `Transfer to ${newOwner?.name}` : `Reassign to ${newOwner?.name}`}
            </Button>
          </> :

      <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={next}>
              Continue
            </Button>
          </>

      }>
      
      {!confirming ?
      <div className="flex flex-col gap-4">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            Current owner: <strong className="text-slate-800">{userName(db.users, opportunity.ownerId)}</strong> · {sectionName(opportunity.sectionId)}
          </div>
          <Field label="New owner" htmlFor="r-owner" required error={error} hint={currentUser.role === 'lead' ? 'Section leads can reassign within their own section.' : 'Choosing an owner in another section transfers the opportunity to that section.'}>
            <select
            id="r-owner"
            className={inputCls(error)}
            value={ownerId}
            onChange={(e) => {
              setOwnerId(e.target.value);
              setError('');
            }}>
            
              <option value="">Select new owner…</option>
              {SECTIONS.map((s) => {
              const list = options.filter((u) => u.sectionId === s.id);
              if (!list.length) return null;
              return (
                <optgroup key={s.id} label={s.name}>
                    {list.map((u) =>
                  <option key={u.id} value={u.id}>
                        {u.name}
                        {u.role === 'lead' ? ' (Section Lead)' : ''}
                      </option>
                  )}
                  </optgroup>);

            })}
            </select>
          </Field>
        </div> :

      <div className="flex flex-col gap-4 text-[13px] text-slate-700">
          <div className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase text-slate-500">From</p>
              <p className="font-semibold text-slate-900">{userName(db.users, opportunity.ownerId)}</p>
              <p className="text-slate-500">{sectionName(opportunity.sectionId)}</p>
            </div>
            <ArrowRightIcon className="h-4 w-4 text-slate-400" />
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase text-slate-500">To</p>
              <p className="font-semibold text-slate-900">{newOwner?.name}</p>
              <p className={crossSection ? 'font-semibold text-brand-dark' : 'text-slate-500'}>{sectionName(newOwner?.sectionId)}</p>
            </div>
          </div>
          {crossSection &&
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                This moves the opportunity from <strong>{sectionName(opportunity.sectionId)}</strong> to <strong>{sectionName(newOwner?.sectionId)}</strong>. The previous section lead and owner will lose access.
              </p>
            </div>
        }
          <p>
            Related records move into the new access scope: {related.activities} activities, {related.tenders} tender record(s), {related.documents} document(s). {related.followUps} open follow-up(s) assigned to the previous owner will be reassigned to {newOwner?.name}.
          </p>
        </div>
      }
    </Modal>);

}