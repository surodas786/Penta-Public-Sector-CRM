/**
 * Stage, status and reopening dialog (FR-021, BR-010–BR-012, BR-014).
 *
 * The approved StageChangeModal layout, connected to the dedicated server
 * operations. The dialog only asks for what the move requires; the server
 * re-checks every rule and its field errors are shown next to the inputs.
 * Success is reported only after the server confirms the commit.
 */
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { OpportunityDetailDto } from '../../../shared/api.js';
import {
  LOSS_REASONS,
  LOSS_REASON_LABELS,
  PIPELINE_STAGES,
  STAGE_LABELS,
  STATUS_LABELS,
  boardLaneLabel,
  classifyStageMove,
  isTerminalStage,
  type OpportunityStage,
} from '../../../shared/enums.js';
import { formatBdt } from '../../../shared/money.js';
import { changeStage, changeStatus, reopenOpportunity } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { dhakaToday } from '../ui/dates.js';
import { useSubmission } from '../useSubmission.js';
import { DialogAlert, FollowUpDraftFields } from './FormBits.js';
import { draftBody, emptyDraft, type FollowUpDraft } from '../followUpDraft.js';
import type { TransitionRequest, TransitionSubject } from '../transitions.js';

export function TransitionDialog({
  subject,
  request,
  onClose,
  onDone,
  onReload,
}: {
  subject: TransitionSubject | null;
  request: TransitionRequest | null;
  onClose: () => void;
  onDone: (updated: OpportunityDetailDto) => void;
  onReload: () => void;
}) {
  const submission = useSubmission();
  const { fieldErrors: errors } = submission;
  const today = dhakaToday();

  const [explanation, setExplanation] = useState('');
  const [awardedValue, setAwardedValue] = useState('');
  const [awardDate, setAwardDate] = useState(today);
  const [lossReason, setLossReason] = useState('');
  const [lossNote, setLossNote] = useState('');
  const [closedDate, setClosedDate] = useState(today);
  const [reason, setReason] = useState('');
  const [reopenStage, setReopenStage] = useState<OpportunityStage>('evaluation');
  const [draft, setDraft] = useState<FollowUpDraft>(emptyDraft());

  const open = Boolean(subject && request);

  useEffect(() => {
    if (!open || !subject) return;
    submission.reset();
    setExplanation('');
    setAwardedValue(subject.estimatedValue);
    setAwardDate(today);
    setLossReason('');
    setLossNote('');
    setClosedDate(today);
    setReason('');
    setReopenStage(request?.kind === 'reopen' && request.stage ? request.stage : 'evaluation');
    setDraft(emptyDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subject?.id, request?.kind, request && 'target' in request ? request.target : null, request?.kind === 'reopen' ? request.stage : null]);

  if (!subject || !request) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const move = request.kind === 'stage' ? classifyStageMove(subject.stage, request.target) : null;
  const needsExplanation = move === 'skip' || move === 'backward';
  const toAwarded = request.kind === 'stage' && request.target === 'awarded';
  const toLost = request.kind === 'stage' && request.target === 'lost';
  const toWorkingStage = request.kind === 'stage' && !isTerminalStage(request.target);
  const needsNextActionForStage = toWorkingStage && !subject.nextAction;
  const returning = request.kind === 'status' && request.target === 'active';
  const closesTasks = toAwarded || toLost || (request.kind === 'status' && request.target === 'cancelled');
  const showDraft = needsNextActionForStage || returning || request.kind === 'reopen';
  const draftRequired = request.kind === 'reopen' || needsNextActionForStage || (returning && !subject.nextAction);

  const title =
    request.kind === 'reopen'
      ? 'Reopen opportunity'
      : request.kind === 'status' && request.target === 'active'
        ? 'Return to Active'
        : `Move to ${request.kind === 'stage' ? STAGE_LABELS[request.target] : STATUS_LABELS[request.target]}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const includeDraft = showDraft && (draftRequired || draft.title.trim() !== '' || draft.dueDate !== '');

    const result = await submission.run((key) => {
      if (request.kind === 'stage') {
        return changeStage(
          subject.id,
          {
            version: subject.version,
            stage: request.target,
            ...(needsExplanation ? { explanation } : {}),
            ...(toAwarded ? { awardedValue, awardDate } : {}),
            ...(toLost ? { lossReason: lossReason || undefined, lossNote, closedDate } : {}),
            ...(includeDraft ? { nextFollowUp: draftBody(draft) } : {}),
          },
          key,
        );
      }
      if (request.kind === 'status') {
        return changeStatus(
          subject.id,
          {
            version: subject.version,
            status: request.target,
            reason,
            ...(includeDraft ? { nextFollowUp: draftBody(draft) } : {}),
          },
          key,
        );
      }
      return reopenOpportunity(
        subject.id,
        { version: subject.version, stage: reopenStage, reason, nextFollowUp: draftBody(draft) },
        key,
      );
    });

    if (result) {
      toast.success(
        request.kind === 'reopen' ? 'Opportunity reopened' : `Now ${boardLaneLabel(result.stage, result.status)}`,
        { description: subject.name },
      );
      onDone(result);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={`${subject.name} · currently ${boardLaneLabel(subject.stage, subject.status)}`}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          {submission.conflict && (
            <Button variant="navy" onClick={onReload}>
              Reload current values
            </Button>
          )}
          <Button
            variant="primary"
            type="submit"
            form="transition-form"
            disabled={submission.submitting || submission.conflict}
          >
            {submission.submitting
              ? 'Saving…'
              : request.kind === 'reopen'
                ? 'Reopen opportunity'
                : request.kind === 'status'
                  ? 'Confirm status change'
                  : 'Confirm stage change'}
          </Button>
        </>
      }
    >
      <form id="transition-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />

        {request.kind === 'reopen' && (
          <Field label="Reopen at stage" htmlFor="t-stage" required error={errors.stage}>
            <select
              id="t-stage"
              className={inputCls(errors.stage)}
              value={reopenStage}
              onChange={(event) => setReopenStage(event.target.value as OpportunityStage)}
            >
              {PIPELINE_STAGES.map((value) => (
                <option key={value} value={value}>
                  {STAGE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        )}

        {needsExplanation && (
          <Field
            label={move === 'skip' ? 'Why are stages being skipped?' : 'Why is it moving back?'}
            htmlFor="t-explain"
            required
            error={errors.explanation}
            hint="Recorded in Change History."
          >
            <textarea
              id="t-explain"
              rows={2}
              className={inputCls(errors.explanation)}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
            />
          </Field>
        )}

        {toAwarded && (
          <>
            <Field
              label="Actual awarded value (BDT)"
              htmlFor="t-av"
              required
              error={errors.awardedValue}
              hint={`Estimated: ${formatBdt(subject.estimatedValue)}`}
            >
              <input
                id="t-av"
                inputMode="decimal"
                className={inputCls(errors.awardedValue)}
                value={awardedValue}
                onChange={(event) => setAwardedValue(event.target.value)}
              />
            </Field>
            <Field label="Award date" htmlFor="t-ad" required error={errors.awardDate}>
              <input
                id="t-ad"
                type="date"
                max={today}
                className={inputCls(errors.awardDate)}
                value={awardDate}
                onChange={(event) => setAwardDate(event.target.value)}
              />
            </Field>
          </>
        )}

        {toLost && (
          <>
            <Field label="Reason lost" htmlFor="t-lr" required error={errors.lossReason}>
              <select
                id="t-lr"
                className={inputCls(errors.lossReason)}
                value={lossReason}
                onChange={(event) => setLossReason(event.target.value)}
              >
                <option value="">Select a reason…</option>
                {LOSS_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {LOSS_REASON_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Explanation"
              htmlFor="t-ln"
              required={lossReason === 'other'}
              error={errors.lossNote}
              hint={lossReason === 'other' ? 'Required when the reason is Other.' : 'Optional'}
            >
              <textarea
                id="t-ln"
                rows={2}
                className={inputCls(errors.lossNote)}
                value={lossNote}
                onChange={(event) => setLossNote(event.target.value)}
              />
            </Field>
            <Field label="Closed date" htmlFor="t-cd" required error={errors.closedDate}>
              <input
                id="t-cd"
                type="date"
                max={today}
                className={inputCls(errors.closedDate)}
                value={closedDate}
                onChange={(event) => setClosedDate(event.target.value)}
              />
            </Field>
          </>
        )}

        {(request.kind === 'status' || request.kind === 'reopen') && (
          <Field
            label={request.kind === 'reopen' ? 'Reason for reopening' : returning ? 'Reason' : 'Note'}
            htmlFor="t-reason"
            required
            error={errors.reason}
            hint={
              request.kind === 'status' && request.target === 'on_hold'
                ? `The stage stays ${STAGE_LABELS[subject.stage]} and open follow-ups are kept.`
                : returning
                  ? `It returns to ${STAGE_LABELS[subject.stage]}, the stage it kept.`
                  : undefined
            }
          >
            <textarea
              id="t-reason"
              rows={3}
              className={inputCls(errors.reason)}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}

        {showDraft && (
          <FollowUpDraftFields
            opportunityId={subject.id}
            draft={draft}
            onChange={setDraft}
            errors={errors}
            prefix="nextFollowUp"
            legend={draftRequired ? 'Next action (required)' : 'Next action (optional)'}
            hint={
              draftRequired
                ? 'An active opportunity always has a dated next action.'
                : `Current next action: ${subject.nextAction?.title ?? '—'}`
            }
          />
        )}

        {closesTasks && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Open follow-ups will be closed as <strong>Cancelled</strong> with this reason — not marked
            completed.
          </p>
        )}
        <p className="text-xs text-slate-500">
          The change will be recorded in Change History with your name and timestamp.
        </p>
      </form>
    </Modal>
  );
}
