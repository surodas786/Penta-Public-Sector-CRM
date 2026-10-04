import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { BidStatus, Tender, TenderDraft } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { useScope } from '../../hooks/useScope';
import { BID_STATUSES, PROCUREMENT_METHODS } from '../../data/options';
import { DEMO_TODAY } from '../../utils/demoClock';
import { fromDhakaInput, toDhakaInput } from '../../utils/format';
import { taskAssignees } from '../../utils/permissions';
import { orgName } from '../../utils/lookup';
import { isValidUrl } from '../../utils/validation';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, FormSection, inputCls } from '../ui/FormFields';

interface TenderFormProps {
  open: boolean;
  onClose: () => void;
  tender?: Tender;
  defaultOppId?: string;
  onSaved?: (id: string) => void;
}

const empty: TenderDraft = {
  oppId: '',
  title: '',
  reference: '',
  procuringEntity: '',
  method: '',
  noticeUrl: '',
  publicationDate: DEMO_TODAY,
  clarificationDeadline: '',
  submissionDeadline: '',
  bidStatus: 'Reviewing',
  submissionDate: '',
  ownerId: '',
  notes: ''
};

export function TenderForm({ open, onClose, tender, defaultOppId, onSaved }: TenderFormProps) {
  const { db, saveTender } = useCrm();
  const scope = useScope();
  const { user, users } = scope;
  const [d, setD] = useState<TenderDraft>(empty);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fillFromOpp = (oppId: string, base: TenderDraft): TenderDraft => {
    const opp = scope.opportunities.find((o) => o.id === oppId);
    if (!opp) return { ...base, oppId };
    return {
      ...base,
      oppId,
      title: base.title || opp.name,
      procuringEntity: base.procuringEntity || orgName(scope.organizations, opp.orgId),
      ownerId: opp.ownerId
    };
  };

  useEffect(() => {
    if (!open) return;
    if (tender) {
      const { id: _id, ...rest } = tender;
      setD(rest);
      setDeadlineInput(toDhakaInput(tender.submissionDeadline));
    } else {
      setD(defaultOppId ? fillFromOpp(defaultOppId, empty) : empty);
      setDeadlineInput('');
    }
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tender?.id, defaultOppId]);

  const set = <K extends keyof TenderDraft,>(k: K, v: TenderDraft[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const opp = scope.opportunities.find((o) => o.id === d.oppId);
  const ownerOptions = opp ? taskAssignees(user, opp, users) : [];
  if (tender && !ownerOptions.some((o) => o.id === tender.ownerId)) {
    const u = users.find((x) => x.id === tender.ownerId);
    if (u) ownerOptions.push(u);
  }
  const availableOpps = scope.opportunities.filter((o) => o.id === d.oppId || !db.tenders.some((t) => t.oppId === o.id));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!d.oppId) errs.oppId = 'Link the tender to an opportunity.';
    if (!d.title.trim()) errs.title = 'Tender title is required.';
    if (!d.reference.trim()) errs.reference = 'Tender reference is required.';
    if (!d.procuringEntity.trim()) errs.procuringEntity = 'Procuring entity is required.';
    if (!d.publicationDate) errs.publicationDate = 'Publication date is required.';
    if (!deadlineInput) errs.submissionDeadline = 'Submission deadline (date and time) is required.';
    if (!d.ownerId) errs.ownerId = 'Responsible owner is required.';
    if (d.noticeUrl && !isValidUrl(d.noticeUrl)) errs.noticeUrl = 'Enter a full URL starting with http:// or https://';
    if (d.bidStatus === 'Submitted' && !d.submissionDate) errs.submissionDate = 'Bid submission date is required when status is Submitted.';
    if (d.clarificationDeadline && deadlineInput && d.clarificationDeadline > deadlineInput.slice(0, 10))
    errs.clarificationDeadline = 'Clarification deadline should be before the submission deadline.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const res = saveTender({ ...d, submissionDeadline: fromDhakaInput(deadlineInput), submissionDate: d.bidStatus === 'Submitted' ? d.submissionDate : '' }, tender?.id);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save tender.');
      return;
    }
    toast.success(tender ? 'Tender updated' : 'Tender added', { description: d.reference });
    onClose();
    if (res.id) onSaved?.(res.id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={tender ? 'Edit tender' : 'Add tender'}
      description="Manual record only — no e-GP integration. Deadlines are in Bangladesh time."
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="tender-form">
            {tender ? 'Save tender' : 'Add tender'}
          </Button>
        </>
      }>
      
      <form id="tender-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormSection title="Tender">
          <Field label="Linked opportunity" htmlFor="t-opp" required error={errors.oppId} className="sm:col-span-2">
            <select id="t-opp" className={inputCls(errors.oppId)} value={d.oppId} disabled={!!tender || !!defaultOppId} onChange={(e) => setD((p) => fillFromOpp(e.target.value, p))}>
              <option value="">Select opportunity…</option>
              {availableOpps.map((o) =>
              <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              )}
            </select>
          </Field>
          <Field label="Tender title" htmlFor="t-title" required error={errors.title} className="sm:col-span-2">
            <input id="t-title" className={inputCls(errors.title)} value={d.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Tender reference" htmlFor="t-ref" required error={errors.reference}>
            <input id="t-ref" className={inputCls(errors.reference)} value={d.reference} onChange={(e) => set('reference', e.target.value)} placeholder="e.g. DPTI/ICT/2026/014" />
          </Field>
          <Field label="Procuring entity" htmlFor="t-ent" required error={errors.procuringEntity}>
            <input id="t-ent" className={inputCls(errors.procuringEntity)} value={d.procuringEntity} onChange={(e) => set('procuringEntity', e.target.value)} />
          </Field>
          <Field label="Procurement method" htmlFor="t-method">
            <select id="t-method" className={inputCls()} value={d.method} onChange={(e) => set('method', e.target.value)}>
              <option value="">Not specified</option>
              {PROCUREMENT_METHODS.map((m) =>
              <option key={m}>{m}</option>
              )}
            </select>
          </Field>
          <Field label="Notice URL" htmlFor="t-url" error={errors.noticeUrl} hint="Optional — opened only if entered">
            <input id="t-url" className={inputCls(errors.noticeUrl)} value={d.noticeUrl} onChange={(e) => set('noticeUrl', e.target.value)} placeholder="https://" />
          </Field>
        </FormSection>
        <FormSection title="Dates">
          <Field label="Publication date" htmlFor="t-pub" required error={errors.publicationDate}>
            <input id="t-pub" type="date" className={inputCls(errors.publicationDate)} value={d.publicationDate} onChange={(e) => set('publicationDate', e.target.value)} />
          </Field>
          <Field label="Clarification deadline" htmlFor="t-clar" error={errors.clarificationDeadline}>
            <input id="t-clar" type="date" className={inputCls(errors.clarificationDeadline)} value={d.clarificationDeadline} onChange={(e) => set('clarificationDeadline', e.target.value)} />
          </Field>
          <Field label="Submission deadline (BST)" htmlFor="t-dead" required error={errors.submissionDeadline}>
            <input
              id="t-dead"
              type="datetime-local"
              className={inputCls(errors.submissionDeadline)}
              value={deadlineInput}
              onChange={(e) => {
                setDeadlineInput(e.target.value);
                setErrors((er) => ({ ...er, submissionDeadline: '' }));
              }} />
            
          </Field>
        </FormSection>
        <FormSection title="Bid">
          <Field label="Bid status" htmlFor="t-status" required>
            <select id="t-status" className={inputCls()} value={d.bidStatus} onChange={(e) => set('bidStatus', e.target.value as BidStatus)}>
              {BID_STATUSES.map((s) =>
              <option key={s}>{s}</option>
              )}
            </select>
          </Field>
          {d.bidStatus === 'Submitted' &&
          <Field label="Bid submission date" htmlFor="t-subd" required error={errors.submissionDate}>
              <input id="t-subd" type="date" className={inputCls(errors.submissionDate)} value={d.submissionDate} onChange={(e) => set('submissionDate', e.target.value)} />
            </Field>
          }
          <Field label="Responsible owner" htmlFor="t-owner" required error={errors.ownerId}>
            <select id="t-owner" className={inputCls(errors.ownerId)} value={d.ownerId} onChange={(e) => set('ownerId', e.target.value)} disabled={!opp}>
              <option value="">Select owner…</option>
              {ownerOptions.map((u) =>
              <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              )}
            </select>
          </Field>
          <Field label="Notes" htmlFor="t-notes" className="sm:col-span-2">
            <textarea id="t-notes" rows={2} className={inputCls()} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </FormSection>
      </form>
    </Modal>);

}