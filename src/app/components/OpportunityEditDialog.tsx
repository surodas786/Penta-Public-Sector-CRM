/**
 * Basic edit (plan 7.4).
 *
 * The allowlist is deliberately narrow. Owner, section, stage, status, outcome
 * and the next action are absent because they belong to dedicated workflows;
 * the server refuses them here with 403 regardless of what this form sends.
 *
 * The procuring organization can be changed by the owner only, to a current
 * organization. Linked contacts keep their own organization and stay linked,
 * so the user is shown them and confirms first. The server enforces all three
 * rules; this form only explains them.
 *
 * Carries the version the record was read at, so a concurrent edit produces a
 * 409 with an explicit reload-and-reapply path rather than silently winning.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { OpportunityContactDto, OpportunityDetailDto } from '../../../shared/api.js';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  SOLUTION_CATEGORIES,
  SOLUTION_CATEGORY_LABELS,
} from '../../../shared/enums.js';
import { ApiRequestError } from '../../api/client.js';
import { fetchOpportunityContacts, fetchOrganizations, updateOpportunity } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Field, FormSection, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { useAuth } from '../AuthContext.js';
import { useApiResource } from '../useApiResource.js';

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
  /** Set while the linked-contacts confirmation is showing. */
  const [linkedContacts, setLinkedContacts] = useState<OpportunityContactDto[] | null>(null);
  const { user } = useAuth();
  const isOwner = user?.id === opportunity.ownerId;

  const organizationsFetcher = useCallback(
    (signal: AbortSignal) => fetchOrganizations({ pageSize: 100 }, signal),
    [],
  );
  const organizations = useApiResource(organizationsFetcher, [open]);
  const organizationOptions = organizations.data?.items ?? [];
  // The current organization stays selectable even when it is not listed
  // (archived since, or beyond the first page).
  const currentMissing = !organizationOptions.some((option) => option.id === opportunity.organization.id);

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(opportunity));
    setFieldErrors({});
    setFormError(null);
    setConflict(false);
    setLinkedContacts(null);
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

  const organizationChanged = draft.organizationId !== opportunity.organization.id;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (organizationChanged) {
      setSubmitting(true);
      try {
        const links = await fetchOpportunityContacts(opportunity.id);
        if (links.items.length > 0) {
          setLinkedContacts(links.items);
          return;
        }
      } catch {
        // The server still refuses the change while contacts are linked.
      } finally {
        setSubmitting(false);
      }
    }
    await save(false);
  };

  const save = async (confirmLinkedContacts: boolean) => {
    setLinkedContacts(null);
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    setConflict(false);

    try {
      await updateOpportunity(opportunity.id, {
        version: opportunity.version,
        name: draft.name,
        // Sent only when changed, so editing other fields never needs the owner.
        ...(organizationChanged ? { organizationId: draft.organizationId } : {}),
        ...(organizationChanged && confirmLinkedContacts ? { confirmLinkedContacts: true } : {}),
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
        if (error.code === 'linked_contacts') {
          // Contacts were linked after the check above: show them now.
          try {
            setLinkedContacts((await fetchOpportunityContacts(opportunity.id)).items);
          } catch {
            setFormError(error.message);
          }
        } else if (error.code === 'version_conflict') {
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
    <>
      <Modal
        open={open}
        // Escape on the confirmation must not also discard this form.
        onClose={linkedContacts ? () => undefined : onClose}
        size="lg"
        title="Edit opportunity"
        description="Ownership, stage, status and follow-ups are changed through their own actions on this page, each with its own checks and history."
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

            <Field
              label="Procuring organization"
              htmlFor="e-org"
              required
              error={fieldErrors.organizationId}
              hint={isOwner ? undefined : `Only the owner, ${opportunity.ownerName}, can change the organization.`}
              className="sm:col-span-2"
            >
              <select
                id="e-org"
                className={inputCls(fieldErrors.organizationId)}
                value={draft.organizationId}
                disabled={!isOwner}
                onChange={(event) => set('organizationId', event.target.value)}
              >
                {currentMissing && (
                  <option value={opportunity.organization.id}>{opportunity.organization.name}</option>
                )}
                {organizationOptions.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
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
      <ConfirmDialog
        open={linkedContacts !== null}
        title="Change the procuring organization?"
        confirmLabel="Change organization"
        onCancel={() => setLinkedContacts(null)}
        onConfirm={() => void save(true)}
        message={
          <>
            <p>
              {linkedContacts?.length === 1 ? 'This contact is' : `These ${linkedContacts?.length ?? 0} contacts are`}{' '}
              linked to the opportunity. They stay linked, and each keeps its own organization:
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {linkedContacts?.map((link) => (
                <li key={link.linkId} className="text-slate-800">
                  <span className="font-semibold">{link.contact.fullName}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {link.contact.designation} · {link.contact.organizationName}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2">Remove any that no longer apply from the Contacts tab.</p>
          </>
        }
      />
    </>
  );
}

function toDraft(opportunity: OpportunityDetailDto) {
  return {
    name: opportunity.name,
    organizationId: opportunity.organization.id,
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
