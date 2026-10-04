/**
 * Basic edit (plan 7.4).
 *
 * The allowlist is deliberately narrow. Owner, section, stage, status, outcome
 * and the next action are absent because they belong to dedicated workflows;
 * the server refuses them here with 403 regardless of what this form sends.
 *
 * Carries the version the record was read at, so a concurrent edit produces a
 * 409 with an explicit reload-and-reapply path rather than silently winning.
 */
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { OpportunityDetailDto } from '../../../shared/api.js';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  SOLUTION_CATEGORIES,
  SOLUTION_CATEGORY_LABELS,
} from '../../../shared/enums.js';
import { ApiRequestError } from '../../api/client.js';
import { updateOpportunity } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, FormSection, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';

interface Props {
  open: boolean;
  opportunity: OpportunityDetailDto;
  onClose: () => void;
  onSaved: () => void;
  /** Re-reads the record so the user can reapply after a 409. */
  onReload: () => void;
}

export function OpportunityEditDialog({ open, opportunity, onClose, onSaved, onReload }: Props) {
  const [draft, setDraft] = useState(() => toDraft(opportunity));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(opportunity));
    setFieldErrors({});
    setFormError(null);
    setConflict(false);
  }, [open, opportunity]);

  const set = (key: keyof ReturnType<typeof toDraft>, value: string) => {
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
    setConflict(false);

    try {
      await updateOpportunity(opportunity.id, {
        version: opportunity.version,
        name: draft.name,
        department: draft.department || null,
        solutionCategory: draft.solutionCategory,
        description: draft.description || null,
        estimatedValue: draft.estimatedValue,
        fundingSource: draft.fundingSource || null,
        priority: draft.priority,
        expectedPublicationDate: draft.expectedPublicationDate || null,
        expectedAwardDate: draft.expectedAwardDate || null,
      });
      toast.success('Opportunity updated');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.code === 'version_conflict') {
          // Keep the typed values so nothing has to be retyped after reload.
          setConflict(true);
          setFormError(error.message);
        } else {
          setFieldErrors(error.fieldErrors);
          setFormError(
            Object.keys(error.fieldErrors).length > 0
              ? 'Please correct the highlighted fields.'
              : error.message,
          );
        }
      } else {
        setFormError('The change could not be saved. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit opportunity"
      description="Ownership, stage, status and the next action are changed through their own workflows, which are not available in this release."
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {conflict && (
            <Button variant="navy" onClick={onReload}>
              Reload current values
            </Button>
          )}
          <Button variant="primary" type="submit" form="api-opp-edit" disabled={submitting || conflict}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="api-opp-edit" onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
        {formError && (
          <div
            role="alert"
            className={`rounded-md border px-3 py-2 text-[13px] font-medium ${
              conflict
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <p>{formError}</p>
            {conflict && (
              <p className="mt-1 font-normal">
                Your typed values are kept. Choose “Reload current values”, check what changed, then
                reapply your edit.
              </p>
            )}
          </div>
        )}

        <FormSection title="Opportunity">
          <Field label="Project / opportunity name" htmlFor="e-name" required error={fieldErrors.name} className="sm:col-span-2">
            <input id="e-name" className={inputCls(fieldErrors.name)} value={draft.name} onChange={(event) => set('name', event.target.value)} />
          </Field>

          <Field label="Relevant department or office" htmlFor="e-dept" error={fieldErrors.department}>
            <input id="e-dept" className={inputCls(fieldErrors.department)} value={draft.department} onChange={(event) => set('department', event.target.value)} />
          </Field>

          <Field label="Solution category" htmlFor="e-cat" required error={fieldErrors.solutionCategory}>
            <select
              id="e-cat"
              className={inputCls(fieldErrors.solutionCategory)}
              value={draft.solutionCategory}
              onChange={(event) => set('solutionCategory', event.target.value)}
            >
              {SOLUTION_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {SOLUTION_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Priority" htmlFor="e-pri" required error={fieldErrors.priority}>
            <select id="e-pri" className={inputCls(fieldErrors.priority)} value={draft.priority} onChange={(event) => set('priority', event.target.value)}>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Estimated value (BDT)" htmlFor="e-val" required error={fieldErrors.estimatedValue}>
            <input
              id="e-val"
              inputMode="decimal"
              className={inputCls(fieldErrors.estimatedValue)}
              value={draft.estimatedValue}
              onChange={(event) => set('estimatedValue', event.target.value)}
            />
          </Field>

          <Field label="Funding source" htmlFor="e-fund" error={fieldErrors.fundingSource}>
            <input id="e-fund" className={inputCls(fieldErrors.fundingSource)} value={draft.fundingSource} onChange={(event) => set('fundingSource', event.target.value)} />
          </Field>

          <Field label="Short description" htmlFor="e-desc" error={fieldErrors.description} className="sm:col-span-2">
            <textarea id="e-desc" rows={2} className={inputCls(fieldErrors.description)} value={draft.description} onChange={(event) => set('description', event.target.value)} />
          </Field>

          <Field label="Expected tender publication" htmlFor="e-pub" error={fieldErrors.expectedPublicationDate}>
            <input
              id="e-pub"
              type="date"
              className={inputCls(fieldErrors.expectedPublicationDate)}
              value={draft.expectedPublicationDate}
              onChange={(event) => set('expectedPublicationDate', event.target.value)}
            />
          </Field>

          <Field label="Expected award date" htmlFor="e-award" error={fieldErrors.expectedAwardDate}>
            <input
              id="e-award"
              type="date"
              className={inputCls(fieldErrors.expectedAwardDate)}
              value={draft.expectedAwardDate}
              onChange={(event) => set('expectedAwardDate', event.target.value)}
            />
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}

function toDraft(opportunity: OpportunityDetailDto) {
  return {
    name: opportunity.name,
    department: opportunity.department ?? '',
    solutionCategory: opportunity.solutionCategory as string,
    description: opportunity.description ?? '',
    estimatedValue: opportunity.estimatedValue,
    fundingSource: opportunity.fundingSource ?? '',
    priority: opportunity.priority as string,
    expectedPublicationDate: opportunity.expectedPublicationDate ?? '',
    expectedAwardDate: opportunity.expectedAwardDate ?? '',
  };
}
