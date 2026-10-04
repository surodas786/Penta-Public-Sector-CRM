/**
 * Create an opportunity (FR-020, BR-001, BR-014).
 *
 * Mirrors the approved Add Opportunity form. Two differences are deliberate:
 * the next action is labelled as the first follow-up, because it is saved as
 * one in the same transaction; and only nonterminal stages are offered,
 * because the award and loss capture rules are not implemented yet.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { OwnerOptionDto } from '../../../shared/api.js';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  SOLUTION_CATEGORIES,
  SOLUTION_CATEGORY_LABELS,
  STAGE_LABELS,
} from '../../../shared/enums.js';
import { M1_CREATABLE_STAGES } from '../../../shared/validation.js';
import { ApiRequestError, newIdempotencyKey } from '../../api/client.js';
import { createOpportunity, fetchOpportunityOwners, fetchOrganizations } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, FormSection, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { useAuth } from '../AuthContext.js';
import { useApiResource } from '../useApiResource.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const BLANK = {
  name: '',
  organizationId: '',
  department: '',
  solutionCategory: '',
  description: '',
  estimatedValue: '',
  fundingSource: '',
  ownerId: '',
  sectionId: '',
  stage: 'identified',
  priority: 'medium',
  expectedPublicationDate: '',
  expectedAwardDate: '',
  initialFollowUpTitle: '',
  initialFollowUpDueDate: '',
};

export function OpportunityCreateDialog({ open, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const [draft, setDraft] = useState({ ...BLANK });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Generated once per submission attempt and reused on retry, so a network
   * failure of unknown outcome cannot produce a second record (BR-091).
   */
  const idempotencyKey = useRef<string | null>(null);

  const ownersFetcher = useCallback((signal: AbortSignal) => fetchOpportunityOwners(signal), []);
  const organizationsFetcher = useCallback(
    (signal: AbortSignal) => fetchOrganizations({ pageSize: 100 }, signal),
    [],
  );

  const owners = useApiResource(ownersFetcher, [open]);
  const organizations = useApiResource(organizationsFetcher, [open]);

  // Reset whenever the dialog opens, and preselect the only possible owner.
  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    idempotencyKey.current = null;
    setDraft({ ...BLANK });
  }, [open]);

  // Memoised so the preselection effect below does not re-run every render.
  const ownerOptions = useMemo<OwnerOptionDto[]>(() => owners.data?.items ?? [], [owners.data]);

  useEffect(() => {
    if (!open || ownerOptions.length === 0) return;
    setDraft((current) => {
      if (current.ownerId) return current;
      // A salesperson has exactly one option: themselves.
      const preferred = ownerOptions.find((owner) => owner.id === user?.id) ?? ownerOptions[0]!;
      return { ...current, ownerId: preferred.id, sectionId: preferred.sectionId };
    });
  }, [open, ownerOptions, user?.id]);

  const set = (key: keyof typeof BLANK, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    idempotencyKey.current ??= newIdempotencyKey();

    const body: Record<string, unknown> = {
      name: draft.name,
      organizationId: draft.organizationId,
      department: draft.department || null,
      solutionCategory: draft.solutionCategory,
      description: draft.description || null,
      estimatedValue: draft.estimatedValue,
      fundingSource: draft.fundingSource || null,
      ownerId: draft.ownerId,
      sectionId: draft.sectionId,
      stage: draft.stage,
      priority: draft.priority,
      expectedPublicationDate: draft.expectedPublicationDate || null,
      expectedAwardDate: draft.expectedAwardDate || null,
      initialFollowUpTitle: draft.initialFollowUpTitle,
      initialFollowUpDueDate: draft.initialFollowUpDueDate,
    };

    try {
      const result = await createOpportunity(body, idempotencyKey.current);
      // Confirmation only after the server has committed (FR-013).
      toast.success('Opportunity created', {
        description: `${result.opportunity.reference} · first follow-up due ${result.firstFollowUp.dueDate}`,
      });
      for (const warning of result.warnings) toast.warning(warning);
      idempotencyKey.current = null;
      onCreated(result.opportunity.id);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors(error.fieldErrors);
        setFormError(
          Object.keys(error.fieldErrors).length > 0
            ? 'Please correct the highlighted fields.'
            : error.message,
        );
        // Keep the key for a genuine retry; drop it once the payload changes
        // in a way the server already rejected as a conflict.
        if (error.code === 'idempotency_key_reuse') idempotencyKey.current = newIdempotencyKey();
      } else {
        setFormError('The opportunity could not be saved. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canChooseOwner = ownerOptions.length > 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add opportunity"
      description="Fields marked * are required. Saving also creates the first follow-up, which becomes the next action."
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="api-opp-create" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create opportunity'}
          </Button>
        </>
      }
    >
      <form id="api-opp-create" onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
        {formError && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700"
          >
            {formError}
          </p>
        )}

        <FormSection title="Opportunity">
          <Field label="Project / opportunity name" htmlFor="c-name" required error={fieldErrors.name} className="sm:col-span-2">
            <input
              id="c-name"
              className={inputCls(fieldErrors.name)}
              value={draft.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="e.g. Citizen services portal"
            />
          </Field>

          <Field label="Procuring organization" htmlFor="c-org" required error={fieldErrors.organizationId}>
            <select
              id="c-org"
              className={inputCls(fieldErrors.organizationId)}
              value={draft.organizationId}
              onChange={(event) => set('organizationId', event.target.value)}
            >
              <option value="">{organizations.loading ? 'Loading…' : 'Select organization…'}</option>
              {organizations.data?.items.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Relevant department or office" htmlFor="c-dept" error={fieldErrors.department}>
            <input
              id="c-dept"
              className={inputCls(fieldErrors.department)}
              value={draft.department}
              onChange={(event) => set('department', event.target.value)}
            />
          </Field>

          <Field label="Solution category" htmlFor="c-cat" required error={fieldErrors.solutionCategory}>
            <select
              id="c-cat"
              className={inputCls(fieldErrors.solutionCategory)}
              value={draft.solutionCategory}
              onChange={(event) => set('solutionCategory', event.target.value)}
            >
              <option value="">Select category…</option>
              {SOLUTION_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {SOLUTION_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Priority" htmlFor="c-pri" required error={fieldErrors.priority}>
            <select
              id="c-pri"
              className={inputCls(fieldErrors.priority)}
              value={draft.priority}
              onChange={(event) => set('priority', event.target.value)}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Short description" htmlFor="c-desc" error={fieldErrors.description} className="sm:col-span-2">
            <textarea
              id="c-desc"
              rows={2}
              className={inputCls(fieldErrors.description)}
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </Field>

          <Field
            label="Estimated value (BDT)"
            htmlFor="c-val"
            required
            error={fieldErrors.estimatedValue}
            hint="Full amount, up to two decimals. Enter 0 if not yet estimated."
          >
            <input
              id="c-val"
              inputMode="decimal"
              className={inputCls(fieldErrors.estimatedValue)}
              value={draft.estimatedValue}
              onChange={(event) => set('estimatedValue', event.target.value)}
              placeholder="42000000.00"
            />
          </Field>

          <Field label="Funding source" htmlFor="c-fund" error={fieldErrors.fundingSource}>
            <input
              id="c-fund"
              className={inputCls(fieldErrors.fundingSource)}
              value={draft.fundingSource}
              onChange={(event) => set('fundingSource', event.target.value)}
              placeholder="Optional"
            />
          </Field>
        </FormSection>

        <FormSection title="Ownership and stage">
          <Field
            label="Owner"
            htmlFor="c-owner"
            required
            error={fieldErrors.ownerId}
            hint={canChooseOwner ? 'Only eligible owners in your permitted sections are listed.' : 'You can only create opportunities you own.'}
          >
            <select
              id="c-owner"
              className={inputCls(fieldErrors.ownerId)}
              value={draft.ownerId}
              disabled={!canChooseOwner}
              onChange={(event) => {
                const owner = ownerOptions.find((option) => option.id === event.target.value);
                setDraft((current) => ({
                  ...current,
                  ownerId: event.target.value,
                  // The section always follows the owner (BR-001).
                  sectionId: owner?.sectionId ?? '',
                }));
              }}
            >
              <option value="">{owners.loading ? 'Loading…' : 'Select owner…'}</option>
              {ownerOptions.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.fullName} — {owner.sectionName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Section" htmlFor="c-section" error={fieldErrors.sectionId} hint="Set by the owner’s section">
            <input
              id="c-section"
              className={inputCls(fieldErrors.sectionId)}
              value={ownerOptions.find((owner) => owner.id === draft.ownerId)?.sectionName ?? ''}
              disabled
            />
          </Field>

          <Field
            label="Current stage"
            htmlFor="c-stage"
            required
            error={fieldErrors.stage}
            hint="New opportunities may start directly at Tender Published. Awarded and Lost are set through the stage workflow."
          >
            <select
              id="c-stage"
              className={inputCls(fieldErrors.stage)}
              value={draft.stage}
              onChange={(event) => set('stage', event.target.value)}
            >
              {M1_CREATABLE_STAGES.map((value) => (
                <option key={value} value={value}>
                  {STAGE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <div className="hidden sm:block" />

          <Field
            label="Expected tender publication"
            htmlFor="c-pub"
            error={fieldErrors.expectedPublicationDate}
          >
            <input
              id="c-pub"
              type="date"
              className={inputCls(fieldErrors.expectedPublicationDate)}
              value={draft.expectedPublicationDate}
              onChange={(event) => set('expectedPublicationDate', event.target.value)}
            />
          </Field>

          <Field label="Expected award date" htmlFor="c-award" error={fieldErrors.expectedAwardDate}>
            <input
              id="c-award"
              type="date"
              className={inputCls(fieldErrors.expectedAwardDate)}
              value={draft.expectedAwardDate}
              onChange={(event) => set('expectedAwardDate', event.target.value)}
            />
          </Field>
        </FormSection>

        <FormSection title="First follow-up">
          <Field
            label="Next action"
            htmlFor="c-next"
            required
            error={fieldErrors.initialFollowUpTitle}
            className="sm:col-span-2"
            hint="Saved as the opportunity's first open follow-up, in the same transaction."
          >
            <input
              id="c-next"
              className={inputCls(fieldErrors.initialFollowUpTitle)}
              value={draft.initialFollowUpTitle}
              onChange={(event) => set('initialFollowUpTitle', event.target.value)}
              placeholder="e.g. Share capability brief with the Director General"
            />
          </Field>

          <Field label="Due date" htmlFor="c-next-due" required error={fieldErrors.initialFollowUpDueDate}>
            <input
              id="c-next-due"
              type="date"
              className={inputCls(fieldErrors.initialFollowUpDueDate)}
              value={draft.initialFollowUpDueDate}
              onChange={(event) => set('initialFollowUpDueDate', event.target.value)}
            />
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}
