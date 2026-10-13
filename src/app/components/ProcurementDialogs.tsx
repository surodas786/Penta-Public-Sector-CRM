/**
 * Software Procurement dialogs (CR6): add or edit a cycle, and record a
 * milestone. Built from the tender dialogs' form primitives.
 *
 * Recording a milestone never moves the opportunity by itself: when the
 * milestone has a matching pipeline stage, the user is asked, as Mark
 * Submitted asks, and an accepted move is held to the ordinary stage rules
 * (Awarded needs its value and date, Lost its reason).
 */
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { ProcurementCycleDto } from '../../../shared/api.js';
import {
  BUSINESS_TIME_LABEL,
  CLOSED_MILESTONES,
  LOSS_REASONS,
  LOSS_REASON_LABELS,
  PARTICIPATION_DECISIONS,
  PARTICIPATION_DECISION_LABELS,
  PROCUREMENT_MILESTONE_LABELS,
  PROCUREMENT_PIPELINE_OFFERS,
  PROPOSAL_FORMATS,
  PROPOSAL_FORMAT_LABELS,
  PROPOSAL_SUBMITTED_MILESTONES,
  RFP_MILESTONES,
  STAGE_LABELS,
  isTerminalStage,
  type LossReason,
  type ParticipationDecision,
  type ProcurementMilestone,
  type ProcurementRoute,
  type ProposalFormat,
} from '../../../shared/enums.js';
import { advanceProcurementCycle, createProcurementCycle, fetchOpportunity, updateProcurementCycle } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, FormSection, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { useAuth } from '../AuthContext.js';
import { dhakaToday, formatInstant, fromDhakaInput, toDhakaInput } from '../ui/dates.js';
import { useSubmission } from '../useSubmission.js';
import { DialogAlert } from './FormBits.js';
import { OpportunityPicker } from './OpportunityPicker.js';
import { OrganizationSelect, type TenderParent } from './TenderDialogs.js';

/** Suggestions only; the method is free text with no procurement-law assumptions (§7.1). */
const SUBMISSION_METHOD_SUGGESTIONS = ['e-GP portal', 'Online portal', 'Email', 'Hard copy', 'Hard copy and email'];

// ---------------------------------------------------------------------------
// Add / edit a cycle
// ---------------------------------------------------------------------------

export function ProcurementCycleFormDialog({
  open,
  parent: fixedParent,
  cycle,
  currentReference,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Set when adding from an opportunity; otherwise the user picks one. */
  parent?: TenderParent;
  /** Set to edit the current cycle. */
  cycle?: ProcurementCycleDto | null;
  /** The ended cycle this one replaces, if any. */
  currentReference?: string | null;
  onClose: () => void;
  onDone: (cycle: ProcurementCycleDto) => void;
}) {
  const { user } = useAuth();
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [opportunityId, setOpportunityId] = useState('');
  const [parent, setParent] = useState<TenderParent | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});

  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const value = (key: string) => values[key] ?? '';

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setParent(fixedParent ?? null);
    setOpportunityId(cycle?.opportunity.id ?? fixedParent?.id ?? '');
    const start: Record<string, string> = {
      title: cycle?.title ?? fixedParent?.name ?? '',
      reference: cycle?.reference ?? '',
      procuringOrganizationId: cycle?.procuringOrganization.id ?? fixedParent?.organizationId ?? '',
      organizationName: cycle?.procuringOrganization.name ?? fixedParent?.organizationName ?? '',
      route: cycle?.route ?? 'eoi_rfp',
      directRfpReason: '',
      submissionMethod: cycle?.submissionMethod ?? '',
      participation: cycle?.participation ?? 'undecided',
      participationReason: cycle?.participationReason ?? '',
      eoiPublicationDate: cycle?.eoiPublicationDate ?? '',
      eoiDeadline: cycle?.eoiDeadline ? toDhakaInput(cycle.eoiDeadline) : '',
      rfpReference: cycle?.rfpReference ?? '',
      rfpInvitationDate: cycle?.rfpInvitationDate ?? '',
      clarificationDeadline: cycle?.clarificationDeadline ? toDhakaInput(cycle.clarificationDeadline) : '',
      proposalDeadline: cycle?.proposalDeadline ? toDhakaInput(cycle.proposalDeadline) : '',
      proposalFormat: cycle?.proposalFormat ?? 'single',
      notes: cycle?.notes ?? '',
    };
    setValues(start);
    setInitial(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cycle?.id, fixedParent?.id]);

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
      setValues((current) => ({
        ...current,
        title: current.title || detail.name,
        procuringOrganizationId: current.procuringOrganizationId || next.organizationId,
        organizationName: current.organizationName || next.organizationName,
      }));
    } catch {
      setParent(null);
    }
  };

  const direct = value('route') === 'direct_rfp';
  const instant = (key: string) => (value(key) ? fromDhakaInput(value(key)) : null);
  const text = (key: string) => value(key).trim() || null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!cycle && !opportunityId) {
      toast.error('Choose the opportunity this procurement belongs to.');
      return;
    }
    const all: Record<string, unknown> = {
      procuringOrganizationId: value('procuringOrganizationId'),
      title: value('title'),
      reference: value('reference'),
      submissionMethod: text('submissionMethod'),
      participation: value('participation'),
      participationReason: value('participation') === 'not_participating' ? text('participationReason') : null,
      rfpReference: text('rfpReference'),
      rfpInvitationDate: text('rfpInvitationDate'),
      clarificationDeadline: instant('clarificationDeadline'),
      proposalDeadline: instant('proposalDeadline'),
      proposalFormat: value('proposalFormat'),
      notes: text('notes'),
      ...(direct ? {} : { eoiPublicationDate: text('eoiPublicationDate'), eoiDeadline: instant('eoiDeadline') }),
    };
    let result;
    if (cycle) {
      // Only what changed, so an untouched deadline is never re-sent.
      const changed: Record<string, unknown> = { version: cycle.version };
      for (const [key, next] of Object.entries(all)) {
        if (key === 'participationReason' ? value('participationReason') !== initial.participationReason || value('participation') !== initial.participation : value(key) !== initial[key]) {
          changed[key] = next;
        }
      }
      result = await submission.run(() => updateProcurementCycle(cycle.id, changed));
    } else {
      const body = { ...all, route: value('route'), ...(direct ? { directRfpReason: text('directRfpReason') } : {}) };
      result = await submission.run((key) => createProcurementCycle(opportunityId, body, key));
    }
    if (result) {
      toast.success(cycle ? 'Procurement updated' : 'Procurement cycle added', {
        description: currentReference && !cycle ? `${currentReference} is kept as an earlier cycle.` : result.reference,
      });
      onDone(result);
    }
  };

  const ownerName = cycle?.responsibleOwner.fullName ?? parent?.ownerName;
  const editingRfpOnly = cycle && RFP_MILESTONES.includes(cycle.milestone);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={cycle ? 'Edit procurement' : 'Add Software Procurement'}
      description={`EOI then RFP. Manual record only. Deadlines are in ${BUSINESS_TIME_LABEL}; later fields can be left empty until they are known.`}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="procurement-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : cycle ? 'Save procurement' : 'Add procurement'}
          </Button>
        </>
      }
    >
      <form id="procurement-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        {!cycle && currentReference && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            This becomes the current cycle. <strong className="font-semibold text-slate-800">{currentReference}</strong> is kept as an
            earlier cycle with its history.
          </p>
        )}
        <FormSection title="Procurement">
          {!cycle && !fixedParent && <OpportunityPicker value={opportunityId} onChange={(id) => void pick(id)} />}
          <Field label="Title" htmlFor="p-title" required error={errors.title} className="sm:col-span-2">
            <input id="p-title" className={inputCls(errors.title)} value={value('title')} onChange={(event) => set('title', event.target.value)} />
          </Field>
          <Field label={direct ? 'RFP reference' : 'EOI reference'} htmlFor="p-ref" required error={errors.reference}>
            <input
              id="p-ref"
              className={inputCls(errors.reference)}
              value={value('reference')}
              onChange={(event) => set('reference', event.target.value)}
              placeholder="e.g. DCR/EOI/2026/07"
            />
          </Field>
          <Field label="Submission method" htmlFor="p-method" error={errors.submissionMethod}>
            <input
              id="p-method"
              list="p-method-options"
              className={inputCls(errors.submissionMethod)}
              value={value('submissionMethod')}
              onChange={(event) => set('submissionMethod', event.target.value)}
              placeholder="Not specified"
            />
            <datalist id="p-method-options">
              {SUBMISSION_METHOD_SUGGESTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </Field>
          <OrganizationSelect
            value={value('procuringOrganizationId')}
            selectedName={value('organizationName')}
            error={errors.procuringOrganizationId}
            onChange={(id, name) => {
              set('procuringOrganizationId', id);
              set('organizationName', name);
            }}
          />
          {!cycle && (
            <fieldset className="flex flex-col gap-2 sm:col-span-2">
              <legend className="mb-1 text-[13px] font-semibold text-slate-700">Route</legend>
              <label className="flex items-start gap-2 text-[13px] text-slate-700">
                <input type="radio" name="p-route" className="mt-0.5" checked={!direct} onChange={() => set('route', 'eoi_rfp')} />
                EOI then RFP — the usual route: shortlisting comes before the RFP
              </label>
              {user?.role === 'management' && (
                <label className="flex items-start gap-2 text-[13px] text-slate-700">
                  <input type="radio" name="p-route" className="mt-0.5" checked={direct} onChange={() => set('route', 'direct_rfp')} />
                  Direct RFP invitation without an EOI — a documented management exception
                </label>
              )}
            </fieldset>
          )}
          {!cycle && direct && (
            <Field label="Why is there no EOI?" htmlFor="p-direct" required error={errors.directRfpReason} className="sm:col-span-2">
              <textarea id="p-direct" rows={2} className={inputCls(errors.directRfpReason)} value={value('directRfpReason')} onChange={(event) => set('directRfpReason', event.target.value)} />
            </Field>
          )}
          <Field label="Participation" htmlFor="p-part" error={errors.participation}>
            <select id="p-part" className={inputCls(errors.participation)} value={value('participation')} onChange={(event) => set('participation', event.target.value as ParticipationDecision)}>
              {PARTICIPATION_DECISIONS.map((decision) => (
                <option key={decision} value={decision}>
                  {PARTICIPATION_DECISION_LABELS[decision]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsible owner" htmlFor="p-owner" hint="Always the opportunity’s current owner.">
            <input id="p-owner" className={inputCls()} value={ownerName ?? '—'} readOnly />
          </Field>
          {value('participation') === 'not_participating' && (
            <Field label="Reason for not participating" htmlFor="p-reason" required error={errors.participationReason} className="sm:col-span-2">
              <textarea id="p-reason" rows={2} className={inputCls(errors.participationReason)} value={value('participationReason')} onChange={(event) => set('participationReason', event.target.value)} />
            </Field>
          )}
        </FormSection>
        {!direct && !editingRfpOnly && (
          <FormSection title="EOI">
            <Field label="EOI publication date" htmlFor="p-eoi-pub" error={errors.eoiPublicationDate}>
              <input id="p-eoi-pub" type="date" className={inputCls(errors.eoiPublicationDate)} value={value('eoiPublicationDate')} onChange={(event) => set('eoiPublicationDate', event.target.value)} />
            </Field>
            <Field label={`EOI deadline (${BUSINESS_TIME_LABEL})`} htmlFor="p-eoi-dead" error={errors.eoiDeadline}>
              <input id="p-eoi-dead" type="datetime-local" className={inputCls(errors.eoiDeadline)} value={value('eoiDeadline')} onChange={(event) => set('eoiDeadline', event.target.value)} />
            </Field>
          </FormSection>
        )}
        <FormSection title={direct || editingRfpOnly ? 'RFP' : 'RFP (when it arrives)'}>
          <Field label="RFP reference" htmlFor="p-rfp-ref" required={direct} error={errors.rfpReference}>
            <input id="p-rfp-ref" className={inputCls(errors.rfpReference)} value={value('rfpReference')} onChange={(event) => set('rfpReference', event.target.value)} />
          </Field>
          <Field label="RFP invitation received" htmlFor="p-rfp-date" required={direct} error={errors.rfpInvitationDate}>
            <input id="p-rfp-date" type="date" className={inputCls(errors.rfpInvitationDate)} value={value('rfpInvitationDate')} onChange={(event) => set('rfpInvitationDate', event.target.value)} />
          </Field>
          <Field label={`Clarification deadline (${BUSINESS_TIME_LABEL})`} htmlFor="p-clar" error={errors.clarificationDeadline} hint="Where applicable.">
            <input id="p-clar" type="datetime-local" className={inputCls(errors.clarificationDeadline)} value={value('clarificationDeadline')} onChange={(event) => set('clarificationDeadline', event.target.value)} />
          </Field>
          <Field label={`Proposal deadline (${BUSINESS_TIME_LABEL})`} htmlFor="p-prop-dead" required={direct} error={errors.proposalDeadline}>
            <input id="p-prop-dead" type="datetime-local" className={inputCls(errors.proposalDeadline)} value={value('proposalDeadline')} onChange={(event) => set('proposalDeadline', event.target.value)} />
          </Field>
          <Field label="Proposal submission" htmlFor="p-format" error={errors.proposalFormat} className="sm:col-span-2">
            <select id="p-format" className={inputCls(errors.proposalFormat)} value={value('proposalFormat')} onChange={(event) => set('proposalFormat', event.target.value as ProposalFormat)}>
              {PROPOSAL_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {PROPOSAL_FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" htmlFor="p-notes" error={errors.notes} className="sm:col-span-2">
            <textarea id="p-notes" rows={2} className={inputCls(errors.notes)} value={value('notes')} onChange={(event) => set('notes', event.target.value)} />
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Record a milestone
// ---------------------------------------------------------------------------

type PipelineChoice = '' | 'move' | 'keep';

export function MilestoneDialog({
  cycle,
  initialMilestone,
  onClose,
  onDone,
}: {
  cycle: ProcurementCycleDto | null;
  initialMilestone?: ProcurementMilestone | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [target, setTarget] = useState<ProcurementMilestone | ''>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<PipelineChoice>('');
  const [choiceError, setChoiceError] = useState('');
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const value = (key: string) => values[key] ?? '';

  useEffect(() => {
    if (!cycle) return;
    submission.reset();
    const today = dhakaToday();
    const now = toDhakaInput(new Date());
    setTarget(initialMilestone ?? cycle.nextMilestones[0] ?? '');
    setValues({
      eoiSubmittedAt: now,
      eoiOutcomeDate: today,
      rfpReference: cycle.rfpReference ?? '',
      rfpInvitationDate: cycle.rfpInvitationDate ?? today,
      clarificationDeadline: cycle.clarificationDeadline ? toDhakaInput(cycle.clarificationDeadline) : '',
      proposalDeadline: cycle.proposalDeadline ? toDhakaInput(cycle.proposalDeadline) : '',
      proposalSubmittedAt: now,
      technicalSubmittedAt: now,
      financialSubmittedAt: now,
      outcomeDate: today,
      awardDate: today,
      closedDate: today,
    });
    setChoice('');
    setChoiceError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.id, cycle?.version, initialMilestone]);

  if (!cycle) return null;
  const route: ProcurementRoute = cycle.route;
  const milestone = target || null;

  const needsEoiSubmission = Boolean(milestone && route === 'eoi_rfp' && milestone !== 'cancelled' && !cycle.eoiSubmittedAt);
  const needsOutcome = Boolean(
    milestone &&
      route === 'eoi_rfp' &&
      !cycle.eoiOutcome &&
      (milestone === 'shortlisted' || milestone === 'not_shortlisted' || RFP_MILESTONES.includes(milestone)),
  );
  const needsRfp = Boolean(milestone && RFP_MILESTONES.includes(milestone) && (!cycle.rfpReference || !cycle.rfpInvitationDate || !cycle.proposalDeadline));
  const needsProposal = Boolean(
    milestone &&
      PROPOSAL_SUBMITTED_MILESTONES.includes(milestone) &&
      (cycle.proposalFormat === 'single' ? !cycle.proposalSubmittedAt : !cycle.technicalSubmittedAt || !cycle.financialSubmittedAt),
  );
  const ending = Boolean(milestone && CLOSED_MILESTONES.includes(milestone));

  const eoiLate = needsEoiSubmission && cycle.eoiDeadline !== null && value('eoiSubmittedAt') !== '' && new Date(fromDhakaInput(value('eoiSubmittedAt'))) > new Date(cycle.eoiDeadline);
  const proposalDeadline = value('proposalDeadline') ? fromDhakaInput(value('proposalDeadline')) : cycle.proposalDeadline;
  const proposalTimes =
    cycle.proposalFormat === 'single' ? [value('proposalSubmittedAt')] : [value('technicalSubmittedAt'), value('financialSubmittedAt')];
  const proposalLate =
    needsProposal && proposalDeadline !== null && proposalTimes.some((time) => time !== '' && new Date(fromDhakaInput(time)) > new Date(proposalDeadline));

  const offer = milestone ? PROCUREMENT_PIPELINE_OFFERS[milestone] : undefined;
  const offerable =
    offer !== undefined &&
    cycle.opportunity.status === 'active' &&
    !isTerminalStage(cycle.opportunity.stage) &&
    cycle.opportunity.stage !== offer;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!milestone) return;
    if (offerable && !choice) {
      setChoiceError(`Choose whether to move the opportunity to ${STAGE_LABELS[offer!]}.`);
      return;
    }
    const instant = (key: string) => (value(key) ? fromDhakaInput(value(key)) : undefined);
    const body: Record<string, unknown> = { version: cycle.version, milestone };
    if (needsEoiSubmission) {
      body.eoiSubmittedAt = instant('eoiSubmittedAt');
      if (eoiLate) body.eoiLateNote = value('eoiLateNote');
    }
    if (needsOutcome) body.eoiOutcomeDate = value('eoiOutcomeDate');
    if (milestone && RFP_MILESTONES.includes(milestone)) {
      if (value('rfpReference')) body.rfpReference = value('rfpReference');
      if (value('rfpInvitationDate')) body.rfpInvitationDate = value('rfpInvitationDate');
      if (value('clarificationDeadline')) body.clarificationDeadline = instant('clarificationDeadline');
      if (value('proposalDeadline')) body.proposalDeadline = instant('proposalDeadline');
    }
    if (needsProposal) {
      if (cycle.proposalFormat === 'single') body.proposalSubmittedAt = instant('proposalSubmittedAt');
      else {
        if (!cycle.technicalSubmittedAt) body.technicalSubmittedAt = instant('technicalSubmittedAt');
        if (!cycle.financialSubmittedAt) body.financialSubmittedAt = instant('financialSubmittedAt');
      }
      if (proposalLate) body.proposalLateNote = value('proposalLateNote');
    }
    if (ending) {
      if (milestone !== 'not_shortlisted') body.outcomeDate = value('outcomeDate');
      if (value('outcomeNote')) body.outcomeNote = value('outcomeNote');
    }
    if (offerable && choice === 'move' && offer) {
      const pipeline: Record<string, unknown> = { stage: offer };
      if (value('explanation')) pipeline.explanation = value('explanation');
      if (offer === 'awarded') Object.assign(pipeline, { awardedValue: value('awardedValue'), awardDate: value('awardDate') });
      if (offer === 'lost') {
        Object.assign(pipeline, {
          lossReason: value('lossReason') || (milestone === 'not_shortlisted' ? 'not_shortlisted' : undefined),
          closedDate: value('closedDate'),
        });
        if (value('lossNote')) pipeline.lossNote = value('lossNote');
      }
      if (!isTerminalStage(offer) && value('nextTitle')) pipeline.nextFollowUp = { title: value('nextTitle'), dueDate: value('nextDue') };
      body.pipeline = pipeline;
    }
    const result = await submission.run((key) => advanceProcurementCycle(cycle.id, body, key));
    if (result) {
      toast.success(`Moved to ${PROCUREMENT_MILESTONE_LABELS[milestone]}`, {
        description: result.stageChanged
          ? `${cycle.reference} — the opportunity moved to ${STAGE_LABELS[offer!]}.`
          : `${cycle.reference} — the opportunity stage was not changed.`,
      });
      onDone();
    }
  };

  const err = (key: string) => errors[key] ?? errors[`pipeline.${key}`];

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Record procurement milestone"
      description={`${cycle.reference} · ${cycle.title} · now ${PROCUREMENT_MILESTONE_LABELS[cycle.milestone]}`}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="milestone-form" disabled={submission.submitting || submission.conflict || !milestone}>
            {submission.submitting ? 'Saving…' : 'Record milestone'}
          </Button>
        </>
      }
    >
      <form id="milestone-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        <Field label="Milestone" htmlFor="m-target" required error={errors.milestone}>
          <select
            id="m-target"
            className={inputCls(errors.milestone)}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value as ProcurementMilestone);
              setChoice('');
              setChoiceError('');
            }}
          >
            {cycle.nextMilestones.map((option) => (
              <option key={option} value={option}>
                {PROCUREMENT_MILESTONE_LABELS[option]}
              </option>
            ))}
          </select>
        </Field>

        {needsEoiSubmission && (
          <Field label={`EOI submitted at (${BUSINESS_TIME_LABEL})`} htmlFor="m-eoi-at" required error={errors.eoiSubmittedAt}>
            <input id="m-eoi-at" type="datetime-local" className={inputCls(errors.eoiSubmittedAt)} value={value('eoiSubmittedAt')} onChange={(event) => set('eoiSubmittedAt', event.target.value)} />
          </Field>
        )}
        {eoiLate && (
          <>
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              This is after the recorded EOI deadline ({formatInstant(cycle.eoiDeadline)}). The deadline stays as recorded; explain
              the late submission.
            </p>
            <Field label="Explain the late EOI submission" htmlFor="m-eoi-late" required error={errors.eoiLateNote}>
              <textarea id="m-eoi-late" rows={2} className={inputCls(errors.eoiLateNote)} value={value('eoiLateNote')} onChange={(event) => set('eoiLateNote', event.target.value)} />
            </Field>
          </>
        )}
        {needsOutcome && (
          <Field label="Shortlisting outcome announced on" htmlFor="m-outcome" required error={errors.eoiOutcomeDate}>
            <input id="m-outcome" type="date" className={inputCls(errors.eoiOutcomeDate)} value={value('eoiOutcomeDate')} onChange={(event) => set('eoiOutcomeDate', event.target.value)} />
          </Field>
        )}
        {needsRfp && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="RFP reference" htmlFor="m-rfp-ref" required error={errors.rfpReference}>
              <input id="m-rfp-ref" className={inputCls(errors.rfpReference)} value={value('rfpReference')} onChange={(event) => set('rfpReference', event.target.value)} />
            </Field>
            <Field label="RFP invitation received" htmlFor="m-rfp-date" required error={errors.rfpInvitationDate}>
              <input id="m-rfp-date" type="date" className={inputCls(errors.rfpInvitationDate)} value={value('rfpInvitationDate')} onChange={(event) => set('rfpInvitationDate', event.target.value)} />
            </Field>
            <Field label={`Proposal deadline (${BUSINESS_TIME_LABEL})`} htmlFor="m-prop-dead" required error={errors.proposalDeadline}>
              <input id="m-prop-dead" type="datetime-local" className={inputCls(errors.proposalDeadline)} value={value('proposalDeadline')} onChange={(event) => set('proposalDeadline', event.target.value)} />
            </Field>
            <Field label={`Clarification deadline (${BUSINESS_TIME_LABEL})`} htmlFor="m-clar" error={errors.clarificationDeadline}>
              <input id="m-clar" type="datetime-local" className={inputCls(errors.clarificationDeadline)} value={value('clarificationDeadline')} onChange={(event) => set('clarificationDeadline', event.target.value)} />
            </Field>
          </div>
        )}
        {needsProposal &&
          (cycle.proposalFormat === 'single' ? (
            <Field label={`Proposal submitted at (${BUSINESS_TIME_LABEL})`} htmlFor="m-prop-at" required error={errors.proposalSubmittedAt}>
              <input id="m-prop-at" type="datetime-local" className={inputCls(errors.proposalSubmittedAt)} value={value('proposalSubmittedAt')} onChange={(event) => set('proposalSubmittedAt', event.target.value)} />
            </Field>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={`Technical proposal submitted at (${BUSINESS_TIME_LABEL})`} htmlFor="m-tech-at" required error={errors.technicalSubmittedAt}>
                <input id="m-tech-at" type="datetime-local" className={inputCls(errors.technicalSubmittedAt)} value={value('technicalSubmittedAt')} onChange={(event) => set('technicalSubmittedAt', event.target.value)} disabled={Boolean(cycle.technicalSubmittedAt)} />
              </Field>
              <Field label={`Financial proposal submitted at (${BUSINESS_TIME_LABEL})`} htmlFor="m-fin-at" required error={errors.financialSubmittedAt}>
                <input id="m-fin-at" type="datetime-local" className={inputCls(errors.financialSubmittedAt)} value={value('financialSubmittedAt')} onChange={(event) => set('financialSubmittedAt', event.target.value)} disabled={Boolean(cycle.financialSubmittedAt)} />
              </Field>
            </div>
          ))}
        {proposalLate && (
          <Field label="Explain the late proposal submission" htmlFor="m-prop-late" required error={errors.proposalLateNote}>
            <textarea id="m-prop-late" rows={2} className={inputCls(errors.proposalLateNote)} value={value('proposalLateNote')} onChange={(event) => set('proposalLateNote', event.target.value)} />
          </Field>
        )}
        {ending && milestone !== 'not_shortlisted' && (
          <Field label="Outcome date" htmlFor="m-out-date" required error={errors.outcomeDate}>
            <input id="m-out-date" type="date" className={inputCls(errors.outcomeDate)} value={value('outcomeDate')} onChange={(event) => set('outcomeDate', event.target.value)} />
          </Field>
        )}
        {ending && (
          <Field
            label={milestone === 'cancelled' ? 'Why was the cycle cancelled or withdrawn?' : 'Outcome note'}
            htmlFor="m-out-note"
            required={milestone === 'cancelled'}
            error={errors.outcomeNote}
          >
            <textarea id="m-out-note" rows={2} className={inputCls(errors.outcomeNote)} value={value('outcomeNote')} onChange={(event) => set('outcomeNote', event.target.value)} />
          </Field>
        )}

        {offerable && offer ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-slate-700">
              The opportunity is at {STAGE_LABELS[cycle.opportunity.stage]}. Also move it to {STAGE_LABELS[offer]}? <span className="text-red-600">*</span>
            </legend>
            <label className="flex items-start gap-2 text-[13px] text-slate-700">
              <input type="radio" name="pipeline-choice" className="mt-0.5" checked={choice === 'move'} onChange={() => { setChoice('move'); setChoiceError(''); }} />
              Yes, move the opportunity to {STAGE_LABELS[offer]}
            </label>
            <label className="flex items-start gap-2 text-[13px] text-slate-700">
              <input type="radio" name="pipeline-choice" className="mt-0.5" checked={choice === 'keep'} onChange={() => { setChoice('keep'); setChoiceError(''); }} />
              No, keep it at {STAGE_LABELS[cycle.opportunity.stage]}
            </label>
            {(choiceError || errors['pipeline.stage']) && <p className="text-xs font-medium text-red-600">{choiceError || errors['pipeline.stage']}</p>}
            {choice === 'move' && (
              <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                {offer === 'awarded' && (
                  <>
                    <Field label="Actual awarded value (BDT)" htmlFor="m-award-value" required error={err('awardedValue')}>
                      <input id="m-award-value" inputMode="decimal" className={inputCls(err('awardedValue'))} value={value('awardedValue')} onChange={(event) => set('awardedValue', event.target.value)} />
                    </Field>
                    <Field label="Award date" htmlFor="m-award-date" required error={err('awardDate')}>
                      <input id="m-award-date" type="date" className={inputCls(err('awardDate'))} value={value('awardDate')} onChange={(event) => set('awardDate', event.target.value)} />
                    </Field>
                  </>
                )}
                {offer === 'lost' && (
                  <>
                    <Field label="Lost reason" htmlFor="m-loss" required error={err('lossReason')}>
                      <select
                        id="m-loss"
                        className={inputCls(err('lossReason'))}
                        value={value('lossReason') || (milestone === 'not_shortlisted' ? 'not_shortlisted' : '')}
                        onChange={(event) => set('lossReason', event.target.value as LossReason)}
                      >
                        <option value="">Select a reason…</option>
                        {LOSS_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {LOSS_REASON_LABELS[reason]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Lost date" htmlFor="m-closed" required error={err('closedDate')}>
                      <input id="m-closed" type="date" className={inputCls(err('closedDate'))} value={value('closedDate')} onChange={(event) => set('closedDate', event.target.value)} />
                    </Field>
                    {value('lossReason') === 'other' && (
                      <Field label="Explain the reason" htmlFor="m-loss-note" required error={err('lossNote')} className="sm:col-span-2">
                        <textarea id="m-loss-note" rows={2} className={inputCls(err('lossNote'))} value={value('lossNote')} onChange={(event) => set('lossNote', event.target.value)} />
                      </Field>
                    )}
                  </>
                )}
                {!isTerminalStage(offer) && (
                  <>
                    <Field label="Next action" htmlFor="m-next" error={err('nextFollowUp.title')} hint="Needed only if the opportunity has no open next action.">
                      <input id="m-next" className={inputCls(err('nextFollowUp.title'))} value={value('nextTitle')} onChange={(event) => set('nextTitle', event.target.value)} />
                    </Field>
                    <Field label="Due" htmlFor="m-next-due" error={err('nextFollowUp.dueDate')}>
                      <input id="m-next-due" type="date" className={inputCls(err('nextFollowUp.dueDate'))} value={value('nextDue')} onChange={(event) => set('nextDue', event.target.value)} />
                    </Field>
                  </>
                )}
                <Field label="Explanation" htmlFor="m-explain" error={err('explanation')} className="sm:col-span-2" hint="Required when this skips pipeline stages.">
                  <textarea id="m-explain" rows={2} className={inputCls(err('explanation'))} value={value('explanation')} onChange={(event) => set('explanation', event.target.value)} />
                </Field>
              </div>
            )}
          </fieldset>
        ) : (
          <p className="text-xs text-slate-500">
            The opportunity stays at {STAGE_LABELS[cycle.opportunity.stage]}. A procurement milestone never changes the pipeline by itself.
          </p>
        )}
      </form>
    </Modal>
  );
}
