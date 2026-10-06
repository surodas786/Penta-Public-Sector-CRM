/**
 * Tender dialogs (FR-050, FR-051, BR-040): the approved "Add tender" form,
 * "Mark bid as Submitted", and cancelling a notice.
 *
 * Differences from the prototype, for review:
 *  - The responsible owner is shown, not chosen: it is always the
 *    opportunity's current owner (§7.1).
 *  - The procuring entity is an organization from the directory (§7.1).
 *  - Mark Submitted records a date AND time, and asks explicitly whether to
 *    move the opportunity to Bid Submitted. The prototype advanced the stage
 *    automatically; FR-051 forbids that.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SearchIcon } from 'lucide-react';

import type { TenderDto } from '../../../shared/api.js';
import { BID_STATUS_LABELS, BUSINESS_TIME_LABEL, STAGE_LABELS, type BidStatus } from '../../../shared/enums.js';
import { EDITABLE_BID_STATUSES } from '../../../shared/validation.js';
import {
  cancelTenderNotice,
  createTender,
  fetchOpportunity,
  fetchOrganizations,
  submitTender,
  updateTender,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, FormSection, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { formatInstant, fromDhakaInput, toDhakaInput } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';
import { useSubmission } from '../useSubmission.js';
import { DialogAlert } from './FormBits.js';
import { OpportunityPicker } from './OpportunityPicker.js';

/** Suggestions only: the method is free text with no procurement-law assumptions (§7.1). */
const PROCUREMENT_METHOD_SUGGESTIONS = [
  'Open Tendering Method (OTM)',
  'Limited Tendering Method (LTM)',
  'Two-Stage Tendering',
  'Request for Proposal (RFP)',
  'Request for Quotation (RFQ)',
  'Direct Procurement',
];

export interface TenderParent {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  ownerName: string;
}

function OrganizationSelect({
  value,
  selectedName,
  onChange,
  error,
}: {
  value: string;
  selectedName: string;
  onChange: (id: string, name: string) => void;
  error?: string;
}) {
  const [q, setQ] = useState('');
  const options = useApiResource(
    useCallback((signal: AbortSignal) => fetchOrganizations({ q: q || undefined, pageSize: 50 }, signal), [q]),
    [q],
  );
  const items = options.data?.items ?? [];
  const withSelected = value && !items.some((item) => item.id === value) ? [{ id: value, name: selectedName }, ...items] : items;

  return (
    <Field label="Procuring entity" htmlFor="t-org" required error={error} className="sm:col-span-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <span className="relative sm:w-56">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search organizations…"
            aria-label="Search organizations"
            className={inputCls(undefined, 'pl-8')}
          />
        </span>
        <select
          id="t-org"
          className={inputCls(error)}
          value={value}
          onChange={(event) => {
            const chosen = withSelected.find((item) => item.id === event.target.value);
            onChange(event.target.value, chosen?.name ?? '');
          }}
        >
          <option value="">Select organization…</option>
          {withSelected.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Add / edit tender
// ---------------------------------------------------------------------------

export function TenderFormDialog({
  open,
  parent: fixedParent,
  tender,
  currentReference,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Set when adding from an opportunity; otherwise the user picks one. */
  parent?: TenderParent;
  /** Set to edit the current notice. */
  tender?: TenderDto | null;
  /** The current notice this one will supersede, if any. */
  currentReference?: string | null;
  onClose: () => void;
  onDone: (tender: TenderDto) => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [opportunityId, setOpportunityId] = useState('');
  const [parent, setParent] = useState<TenderParent | null>(null);
  const [title, setTitle] = useState('');
  const [reference, setReference] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [method, setMethod] = useState('');
  const [noticeUrl, setNoticeUrl] = useState('');
  const [publicationDate, setPublicationDate] = useState('');
  const [clarification, setClarification] = useState('');
  const [deadline, setDeadline] = useState('');
  const [bidStatus, setBidStatus] = useState<BidStatus>('reviewing');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setParent(fixedParent ?? null);
    setOpportunityId(tender?.opportunity.id ?? fixedParent?.id ?? '');
    setTitle(tender?.title ?? fixedParent?.name ?? '');
    setReference(tender?.reference ?? '');
    setOrganizationId(tender?.procuringOrganization.id ?? fixedParent?.organizationId ?? '');
    setOrganizationName(tender?.procuringOrganization.name ?? fixedParent?.organizationName ?? '');
    setMethod(tender?.procurementMethod ?? '');
    setNoticeUrl(tender?.noticeUrl ?? '');
    setPublicationDate(tender?.publicationDate ?? '');
    setClarification(tender?.clarificationDeadline ? toDhakaInput(tender.clarificationDeadline) : '');
    setDeadline(tender ? toDhakaInput(tender.submissionDeadline) : '');
    setBidStatus(tender?.bidStatus ?? 'reviewing');
    setReason(tender?.participationReason ?? '');
    setNotes(tender?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tender?.id, fixedParent?.id]);

  /** Picking an opportunity in the tracker fills the entity and owner from it. */
  const pick = async (id: string) => {
    setOpportunityId(id);
    if (!id) {
      setParent(null);
      return;
    }
    try {
      const detail = await fetchOpportunity(id);
      const next = {
        id,
        name: detail.name,
        organizationId: detail.organization.id,
        organizationName: detail.organization.name,
        ownerName: detail.ownerName,
      };
      setParent(next);
      setTitle((current) => current || detail.name);
      if (!organizationId) {
        setOrganizationId(next.organizationId);
        setOrganizationName(next.organizationName);
      }
    } catch {
      setParent(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tender && !opportunityId) {
      toast.error('Choose the opportunity this tender belongs to.');
      return;
    }
    const body: Record<string, unknown> = {
      procuringOrganizationId: organizationId,
      title,
      reference,
      procurementMethod: method || null,
      noticeUrl: noticeUrl || null,
      publicationDate,
      clarificationDeadline: clarification ? fromDhakaInput(clarification) : null,
      submissionDeadline: deadline ? fromDhakaInput(deadline) : '',
      participationReason: bidStatus === 'not_participating' ? reason : null,
      notes: notes || null,
    };
    // A recorded submission is not changed from this form.
    if (!tender || tender.bidStatus !== 'submitted') body.bidStatus = bidStatus;
    const result = await submission.run((key) =>
      tender ? updateTender(tender.id, { version: tender.version, ...body }) : createTender(opportunityId, body, key),
    );
    if (result) {
      toast.success(tender ? 'Tender updated' : 'Tender added', {
        description: currentReference && !tender ? `${currentReference} is kept as a superseded notice.` : result.reference,
      });
      onDone(result);
    }
  };

  const ownerName = tender?.responsibleOwner.fullName ?? parent?.ownerName;
  const differs = parent && organizationId && organizationId !== parent.organizationId;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={tender ? 'Edit tender' : 'Add tender'}
      description={`Manual record only — no e-GP integration. Deadlines are in ${BUSINESS_TIME_LABEL}.`}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="tender-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : tender ? 'Save tender' : 'Add tender'}
          </Button>
        </>
      }
    >
      <form id="tender-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        {!tender && currentReference && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            This notice becomes the current tender. <strong className="font-semibold text-slate-800">{currentReference}</strong> will be
            marked Superseded and kept with its bid history.
          </p>
        )}
        <FormSection title="Tender">
          {!tender && !fixedParent && <OpportunityPicker value={opportunityId} onChange={(id) => void pick(id)} />}
          <Field label="Tender title" htmlFor="t-title" required error={errors.title} className="sm:col-span-2">
            <input id="t-title" className={inputCls(errors.title)} value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Tender reference" htmlFor="t-ref" required error={errors.reference}>
            <input
              id="t-ref"
              className={inputCls(errors.reference)}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="e.g. DPTI/ICT/2026/014"
            />
          </Field>
          <Field label="Procurement method" htmlFor="t-method" error={errors.procurementMethod}>
            <input
              id="t-method"
              list="t-method-options"
              className={inputCls(errors.procurementMethod)}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              placeholder="Not specified"
            />
            <datalist id="t-method-options">
              {PROCUREMENT_METHOD_SUGGESTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </Field>
          <OrganizationSelect
            value={organizationId}
            selectedName={organizationName}
            error={errors.procuringOrganizationId}
            onChange={(id, name) => {
              setOrganizationId(id);
              setOrganizationName(name);
            }}
          />
          {differs && (
            <p className="-mt-2 text-xs font-medium text-amber-700 sm:col-span-2">
              Different from the opportunity’s organization ({parent.organizationName}).
            </p>
          )}
          <Field label="Notice URL" htmlFor="t-url" error={errors.noticeUrl} hint="Optional — opened only if entered">
            <input id="t-url" className={inputCls(errors.noticeUrl)} value={noticeUrl} onChange={(event) => setNoticeUrl(event.target.value)} placeholder="https://" />
          </Field>
        </FormSection>
        <FormSection title="Dates">
          <Field label="Publication date" htmlFor="t-pub" required error={errors.publicationDate}>
            <input id="t-pub" type="date" className={inputCls(errors.publicationDate)} value={publicationDate} onChange={(event) => setPublicationDate(event.target.value)} />
          </Field>
          <Field label={`Clarification deadline (${BUSINESS_TIME_LABEL})`} htmlFor="t-clar" error={errors.clarificationDeadline}>
            <input id="t-clar" type="datetime-local" className={inputCls(errors.clarificationDeadline)} value={clarification} onChange={(event) => setClarification(event.target.value)} />
          </Field>
          <Field label={`Submission deadline (${BUSINESS_TIME_LABEL})`} htmlFor="t-dead" required error={errors.submissionDeadline}>
            <input id="t-dead" type="datetime-local" className={inputCls(errors.submissionDeadline)} value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </Field>
        </FormSection>
        <FormSection title="Bid">
          {tender?.bidStatus === 'submitted' ? (
            <Field label="Bid status" htmlFor="t-status-fixed">
              <input id="t-status-fixed" className={inputCls()} value={`Submitted ${formatInstant(tender.submittedAt)}`} readOnly />
            </Field>
          ) : (
            <Field label="Bid status" htmlFor="t-status" required error={errors.bidStatus} hint="Use Mark Submitted to record a submission.">
              <select id="t-status" className={inputCls(errors.bidStatus)} value={bidStatus} onChange={(event) => setBidStatus(event.target.value as BidStatus)}>
                {EDITABLE_BID_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {BID_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Responsible owner" htmlFor="t-owner" hint="Always the opportunity’s current owner.">
            <input id="t-owner" className={inputCls()} value={ownerName ?? '—'} readOnly />
          </Field>
          {bidStatus === 'not_participating' && tender?.bidStatus !== 'submitted' && (
            <Field label="Reason for not participating" htmlFor="t-reason" required error={errors.participationReason} className="sm:col-span-2">
              <textarea id="t-reason" rows={2} className={inputCls(errors.participationReason)} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          )}
          <Field label="Notes" htmlFor="t-notes" error={errors.notes} className="sm:col-span-2">
            <textarea id="t-notes" rows={2} className={inputCls(errors.notes)} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Mark Submitted (FR-051)
// ---------------------------------------------------------------------------

type StageChoice = '' | 'move' | 'keep';

export function MarkSubmittedDialog({
  tender,
  onClose,
  onDone,
}: {
  tender: TenderDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [at, setAt] = useState('');
  const [lateNote, setLateNote] = useState('');
  const [choice, setChoice] = useState<StageChoice>('');
  const [choiceError, setChoiceError] = useState('');

  useEffect(() => {
    if (!tender) return;
    submission.reset();
    setAt(toDhakaInput(new Date()));
    setLateNote('');
    setChoice('');
    setChoiceError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tender?.id]);

  if (!tender) return null;
  const offer = tender.canOfferBidSubmittedStage;
  const stageLabel = STAGE_LABELS[tender.opportunity.stage];
  const late = at !== '' && new Date(fromDhakaInput(at)) > new Date(tender.submissionDeadline);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (offer && !choice) {
      setChoiceError('Choose whether to move the opportunity to Bid Submitted.');
      return;
    }
    const result = await submission.run((key) =>
      submitTender(
        tender.id,
        {
          version: tender.version,
          submittedAt: fromDhakaInput(at),
          lateSubmissionNote: late ? lateNote : null,
          moveOpportunityToBidSubmitted: offer && choice === 'move',
        },
        key,
      ),
    );
    if (result) {
      toast.success('Bid marked as Submitted', {
        description: result.stageChanged
          ? `${tender.reference} — the opportunity moved to Bid Submitted.`
          : `${tender.reference} — the opportunity stage was not changed.`,
      });
      onDone();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Mark bid as Submitted"
      description={`${tender.reference} · ${tender.title}`}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="submit-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : 'Mark Submitted'}
          </Button>
        </>
      }
    >
      <form id="submit-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        <Field label={`Bid submitted at (${BUSINESS_TIME_LABEL})`} htmlFor="ms-at" required error={errors.submittedAt}>
          <input id="ms-at" type="datetime-local" className={inputCls(errors.submittedAt)} value={at} onChange={(event) => setAt(event.target.value)} />
        </Field>
        {late && (
          <>
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              This time is after the recorded deadline ({formatInstant(tender.submissionDeadline)}). The CRM records what happened; it
              does not decide whether a late bid was accepted.
            </p>
            <Field label="Explain the late submission" htmlFor="ms-late" required error={errors.lateSubmissionNote}>
              <textarea id="ms-late" rows={2} className={inputCls(errors.lateSubmissionNote)} value={lateNote} onChange={(event) => setLateNote(event.target.value)} />
            </Field>
          </>
        )}
        {offer ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-slate-700">
              The opportunity is at {stageLabel}. Move it to Bid Submitted? <span className="text-red-600">*</span>
            </legend>
            <label className="flex items-start gap-2 text-[13px] text-slate-700">
              <input type="radio" name="stage-choice" className="mt-0.5" checked={choice === 'move'} onChange={() => { setChoice('move'); setChoiceError(''); }} />
              Yes, move the opportunity to Bid Submitted
            </label>
            <label className="flex items-start gap-2 text-[13px] text-slate-700">
              <input type="radio" name="stage-choice" className="mt-0.5" checked={choice === 'keep'} onChange={() => { setChoice('keep'); setChoiceError(''); }} />
              No, keep it at {stageLabel}
            </label>
            {(choiceError || errors.moveOpportunityToBidSubmitted) && (
              <p className="text-xs font-medium text-red-600">{choiceError || errors.moveOpportunityToBidSubmitted}</p>
            )}
          </fieldset>
        ) : (
          <p className="text-xs text-slate-500">
            The opportunity stays at {stageLabel}
            {tender.opportunity.status !== 'active' ? ' because it is not Active' : ''}. Marking the bid Submitted never marks it Awarded.
          </p>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Cancel a notice (BR-040)
// ---------------------------------------------------------------------------

export function CancelNoticeDialog({
  tender,
  onClose,
  onDone,
}: {
  tender: TenderDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const submission = useSubmission();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!tender) return;
    submission.reset();
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tender?.id]);

  if (!tender) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run(() => cancelTenderNotice(tender.id, { version: tender.version, reason }));
    if (result) {
      toast.success('Notice cancelled', { description: `${tender.reference} is kept as history and raises no deadline alerts.` });
      onDone();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Cancel tender notice"
      description={`${tender.reference} · ${tender.title}`}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Keep notice
          </Button>
          <Button variant="primary" type="submit" form="cancel-notice-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : 'Cancel notice'}
          </Button>
        </>
      }
    >
      <form id="cancel-notice-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        <p className="text-[13px] text-slate-600">
          A cancelled notice is kept with its bid history but leaves the deadline alerts. The opportunity will have no current tender
          until another notice is added.
        </p>
        <Field label="Reason" htmlFor="cn-reason" required error={submission.fieldErrors.reason}>
          <textarea id="cn-reason" rows={2} className={inputCls(submission.fieldErrors.reason)} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
