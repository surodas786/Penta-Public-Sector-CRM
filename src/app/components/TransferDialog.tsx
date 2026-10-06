/**
 * Ownership transfer (FR-070, BR-050) — the approved two-step ReassignModal:
 * choose the new owner, then confirm with current and new owner and section,
 * and a reason. The owner list comes from the same scoped lookup the server
 * re-applies, so a lead only ever sees their own section.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangleIcon, ArrowRightIcon } from 'lucide-react';

import type { OpportunityDetailDto } from '../../../shared/api.js';
import { fetchOpportunityOwners, transferOpportunity } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { useApiResource } from '../useApiResource.js';
import { useSubmission } from '../useSubmission.js';
import { DialogAlert } from './FormBits.js';

type Subject = Pick<OpportunityDetailDto, 'id' | 'name' | 'ownerId' | 'ownerName' | 'sectionId' | 'sectionName' | 'version'>;

export function TransferDialog({
  subject,
  isManagement,
  onClose,
  onDone,
  onReload,
}: {
  subject: Subject | null;
  isManagement: boolean;
  onClose: () => void;
  onDone: (updated: OpportunityDetailDto) => void;
  onReload: () => void;
}) {
  const submission = useSubmission();
  const [ownerId, setOwnerId] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [choiceError, setChoiceError] = useState('');

  const fetcher = useCallback((signal: AbortSignal) => fetchOpportunityOwners(signal), []);
  const owners = useApiResource(fetcher, [subject?.id]);

  useEffect(() => {
    if (!subject) return;
    submission.reset();
    setOwnerId('');
    setReason('');
    setConfirming(false);
    setChoiceError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.id]);

  const options = useMemo(
    () => (owners.data?.items ?? []).filter((owner) => owner.id !== subject?.ownerId),
    [owners.data, subject?.ownerId],
  );
  const sectionsInOrder = useMemo(
    () => [...new Map(options.map((owner) => [owner.sectionId, owner.sectionName])).entries()],
    [options],
  );

  if (!subject) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const newOwner = options.find((owner) => owner.id === ownerId);
  const crossSection = Boolean(newOwner && newOwner.sectionId !== subject.sectionId);

  const next = () => {
    if (!ownerId) {
      setChoiceError('Select a new owner.');
      return;
    }
    setConfirming(true);
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run((key) =>
      transferOpportunity(subject.id, { version: subject.version, newOwnerId: ownerId, reason }, key),
    );
    if (result) {
      toast.success(crossSection ? 'Opportunity transferred across sections' : 'Opportunity reassigned', {
        description: `${subject.name} → ${result.ownerName} (${result.sectionName})`,
      });
      onDone(result);
    } else if (submission.fieldErrors.newOwnerId) {
      setConfirming(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={confirming ? (crossSection ? 'Confirm cross-section transfer' : 'Confirm reassignment') : 'Reassign opportunity'}
      description={subject.name}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} disabled={submission.submitting}>
              Back
            </Button>
            {submission.conflict && (
              <Button variant="navy" onClick={onReload}>
                Reload current values
              </Button>
            )}
            <Button
              variant="primary"
              type="submit"
              form="transfer-form"
              disabled={submission.submitting || submission.conflict}
              data-autofocus
            >
              {submission.submitting
                ? 'Saving…'
                : crossSection
                  ? `Transfer to ${newOwner?.fullName}`
                  : `Reassign to ${newOwner?.fullName}`}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={next}>
              Continue
            </Button>
          </>
        )
      }
    >
      {!confirming ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            Current owner: <strong className="text-slate-800">{subject.ownerName}</strong> · {subject.sectionName}
          </div>
          <Field
            label="New owner"
            htmlFor="t-owner"
            required
            error={choiceError || submission.fieldErrors.newOwnerId}
            hint={
              isManagement
                ? 'Choosing an owner in another section transfers the opportunity to that section.'
                : 'Section leads can reassign within their own section.'
            }
          >
            <select
              id="t-owner"
              className={inputCls(choiceError)}
              value={ownerId}
              onChange={(event) => {
                setOwnerId(event.target.value);
                setChoiceError('');
              }}
            >
              <option value="">Select new owner…</option>
              {sectionsInOrder.map(([sectionId, sectionName]) => (
                <optgroup key={sectionId} label={sectionName}>
                  {options
                    .filter((owner) => owner.sectionId === sectionId)
                    .map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.fullName}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
      ) : (
        <form id="transfer-form" onSubmit={(event) => void confirm(event)} className="flex flex-col gap-4 text-[13px] text-slate-700" noValidate>
          <DialogAlert message={submission.formError} conflict={submission.conflict} />
          <div className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase text-slate-500">From</p>
              <p className="font-semibold text-slate-900">{subject.ownerName}</p>
              <p className="text-slate-500">{subject.sectionName}</p>
            </div>
            <ArrowRightIcon className="h-4 w-4 text-slate-400" />
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase text-slate-500">To</p>
              <p className="font-semibold text-slate-900">{newOwner?.fullName}</p>
              <p className={crossSection ? 'font-semibold text-brand-dark' : 'text-slate-500'}>{newOwner?.sectionName}</p>
            </div>
          </div>
          {crossSection && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                This moves the opportunity from <strong>{subject.sectionName}</strong> to{' '}
                <strong>{newOwner?.sectionName}</strong>. The previous section lead and owner will lose access.
              </p>
            </div>
          )}
          <p>
            Open follow-ups assigned to the previous owner, or to anyone who loses access, move to{' '}
            {newOwner?.fullName}. Tasks assigned to management stay where they are. History, completed tasks and the
            original creator are kept.
          </p>
          <Field label="Reason" htmlFor="t-reason" required error={submission.fieldErrors.reason} hint="Recorded in Change History.">
            <textarea
              id="t-reason"
              rows={2}
              className={inputCls(submission.fieldErrors.reason)}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </form>
      )}
    </Modal>
  );
}
