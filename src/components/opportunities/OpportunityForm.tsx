import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Opportunity, OpportunityDraft, SectionId } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { useScope } from '../../hooks/useScope';
import { ALL_STAGES, PRIORITIES, SECTIONS, SOLUTION_CATEGORIES, sectionName } from '../../data/options';
import { assignableOwners, canChangeSection, canReassignOpportunity } from '../../utils/permissions';
import { isActiveStage, validateOpportunity, type Errors } from '../../utils/validation';
import { userName } from '../../utils/lookup';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, FormSection, inputCls } from '../ui/FormFields';

interface OpportunityFormProps {
  open: boolean;
  onClose: () => void;
  opportunity?: Opportunity;
  onSaved?: (id: string) => void;
}

function toDraft(o: Opportunity): OpportunityDraft {
  return {
    name: o.name,
    orgId: o.orgId,
    department: o.department,
    category: o.category,
    description: o.description,
    estimatedValue: o.estimatedValue,
    fundingSource: o.fundingSource,
    ownerId: o.ownerId,
    sectionId: o.sectionId,
    stage: o.stage,
    expectedTenderDate: o.expectedTenderDate,
    expectedAwardDate: o.expectedAwardDate,
    priority: o.priority,
    contactIds: o.contactIds,
    nextAction: o.nextAction,
    nextActionDue: o.nextActionDue,
    awardedValue: o.awardedValue,
    awardDate: o.awardDate,
    lostReason: o.lostReason,
    statusNote: o.statusNote
  };
}

export function OpportunityForm({ open, onClose, opportunity, onSaved }: OpportunityFormProps) {
  const { saveOpportunity } = useCrm();
  const scope = useScope();
  const { user, users } = scope;
  const owners = assignableOwners(user, users);

  const blank = (): OpportunityDraft => {
    const defaultOwner = user.role === 'management' ? owners[0] : owners.find((o) => o.id === user.id) ?? owners[0];
    return {
      name: '',
      orgId: '',
      department: '',
      category: '',
      description: '',
      estimatedValue: null,
      fundingSource: '',
      ownerId: defaultOwner?.id ?? '',
      sectionId: (defaultOwner?.sectionId ?? '') as SectionId | '',
      stage: 'Identified',
      expectedTenderDate: '',
      expectedAwardDate: '',
      priority: 'Medium',
      contactIds: [],
      nextAction: '',
      nextActionDue: '',
      awardedValue: null,
      awardDate: '',
      lostReason: '',
      statusNote: ''
    };
  };

  const [draft, setDraft] = useState<OpportunityDraft>(blank);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (open) {
      setDraft(opportunity ? toDraft(opportunity) : blank());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opportunity?.id]);

  const set = <K extends keyof OpportunityDraft,>(key: K, value: OpportunityDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const canEditOwner = opportunity ? canReassignOpportunity(user, opportunity, users) : user.role !== 'sales';
  const canEditSection = canChangeSection(user);
  const ownerOptions = owners.filter((o) => !draft.sectionId || o.sectionId === draft.sectionId);

  const contactOptions = useMemo(
    () => scope.contacts.filter((c) => c.orgId === draft.orgId || draft.contactIds.includes(c.id)),
    [scope.contacts, draft.orgId, draft.contactIds]
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateOpportunity(draft);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    const res = saveOpportunity(draft, opportunity?.id);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save.');
      return;
    }
    toast.success(opportunity ? 'Opportunity updated' : 'Opportunity created', { description: draft.name });
    onClose();
    if (res.id) onSaved?.(res.id);
  };

  const active = isActiveStage(draft.stage);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={opportunity ? 'Edit opportunity' : 'Add opportunity'}
      description="Fields marked * are required. Active opportunities need an owner, section, next action and due date."
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="opp-form">
            {opportunity ? 'Save changes' : 'Create opportunity'}
          </Button>
        </>
      }>
      
      <form id="opp-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormSection title="Opportunity">
          <Field label="Project / opportunity name" htmlFor="o-name" required error={errors.name} className="sm:col-span-2">
            <input id="o-name" className={inputCls(errors.name)} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Municipal Service Portal" />
          </Field>
          <Field label="Procuring organization" htmlFor="o-org" required error={errors.orgId}>
            <select id="o-org" className={inputCls(errors.orgId)} value={draft.orgId} onChange={(e) => set('orgId', e.target.value)}>
              <option value="">Select organization…</option>
              {scope.organizations.map((o) =>
              <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              )}
            </select>
          </Field>
          <Field label="Relevant department or office" htmlFor="o-dept">
            <input id="o-dept" className={inputCls()} value={draft.department} onChange={(e) => set('department', e.target.value)} />
          </Field>
          <Field label="Solution category" htmlFor="o-cat" required error={errors.category}>
            <select id="o-cat" className={inputCls(errors.category)} value={draft.category} onChange={(e) => set('category', e.target.value as OpportunityDraft['category'])}>
              <option value="">Select category…</option>
              {SOLUTION_CATEGORIES.map((c) =>
              <option key={c}>{c}</option>
              )}
            </select>
          </Field>
          <Field label="Priority" htmlFor="o-pri" required>
            <select id="o-pri" className={inputCls()} value={draft.priority} onChange={(e) => set('priority', e.target.value as OpportunityDraft['priority'])}>
              {PRIORITIES.map((p) =>
              <option key={p}>{p}</option>
              )}
            </select>
          </Field>
          <Field label="Short description" htmlFor="o-desc" className="sm:col-span-2">
            <textarea id="o-desc" rows={2} className={inputCls()} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Estimated value (BDT)" htmlFor="o-val" required error={errors.estimatedValue} hint="Enter the full amount, e.g. 42000000 for ৳ 4.2 Cr">
            <input
              id="o-val"
              type="number"
              min={0}
              step={100000}
              className={inputCls(errors.estimatedValue)}
              value={draft.estimatedValue ?? ''}
              onChange={(e) => set('estimatedValue', e.target.value === '' ? null : Number(e.target.value))} />
            
          </Field>
          <Field label="Funding source" htmlFor="o-fund">
            <input id="o-fund" className={inputCls()} value={draft.fundingSource} onChange={(e) => set('fundingSource', e.target.value)} placeholder="Optional" />
          </Field>
        </FormSection>

        <FormSection title="Ownership and stage">
          <Field label="Section" htmlFor="o-sec" required error={errors.sectionId} hint={!canEditSection ? 'Set by the owner’s section' : undefined}>
            {canEditSection ?
            <select
              id="o-sec"
              className={inputCls(errors.sectionId)}
              value={draft.sectionId}
              onChange={(e) => {
                const sec = e.target.value as SectionId | '';
                const firstOwner = owners.find((o) => o.sectionId === sec);
                setDraft((d) => ({ ...d, sectionId: sec, ownerId: firstOwner?.id ?? '' }));
              }}>
              
                <option value="">Select section…</option>
                {SECTIONS.map((s) =>
              <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
              )}
              </select> :

            <input id="o-sec" className={inputCls()} value={sectionName(draft.sectionId)} disabled />
            }
          </Field>
          <Field label="Owner" htmlFor="o-owner" required error={errors.ownerId} hint={!canEditOwner ? 'Only section leads and management can change ownership' : undefined}>
            {canEditOwner ?
            <select
              id="o-owner"
              className={inputCls(errors.ownerId)}
              value={draft.ownerId}
              onChange={(e) => {
                const o = owners.find((x) => x.id === e.target.value);
                setDraft((d) => ({ ...d, ownerId: e.target.value, sectionId: (o?.sectionId ?? d.sectionId) as SectionId | '' }));
                setErrors((er) => ({ ...er, ownerId: '' }));
              }}>
              
                <option value="">Select owner…</option>
                {ownerOptions.map((o) =>
              <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
              )}
              </select> :

            <input id="o-owner" className={inputCls()} value={userName(users, draft.ownerId)} disabled />
            }
          </Field>
          <Field label="Current stage" htmlFor="o-stage" required hint="New opportunities may start directly at Tender Published.">
            <select id="o-stage" className={inputCls()} value={draft.stage} onChange={(e) => set('stage', e.target.value as OpportunityDraft['stage'])}>
              {ALL_STAGES.map((s) =>
              <option key={s}>{s}</option>
              )}
            </select>
          </Field>
          <div className="hidden sm:block" />
          {draft.stage === 'Awarded' &&
          <>
              <Field label="Actual awarded value (BDT)" htmlFor="o-awv" required error={errors.awardedValue}>
                <input
                id="o-awv"
                type="number"
                min={0}
                className={inputCls(errors.awardedValue)}
                value={draft.awardedValue ?? ''}
                onChange={(e) => set('awardedValue', e.target.value === '' ? null : Number(e.target.value))} />
              
              </Field>
              <Field label="Award date" htmlFor="o-awd" required error={errors.awardDate}>
                <input id="o-awd" type="date" className={inputCls(errors.awardDate)} value={draft.awardDate} onChange={(e) => set('awardDate', e.target.value)} />
              </Field>
            </>
          }
          {draft.stage === 'Lost' &&
          <Field label="Reason lost" htmlFor="o-lost" required error={errors.lostReason} className="sm:col-span-2">
              <textarea id="o-lost" rows={2} className={inputCls(errors.lostReason)} value={draft.lostReason} onChange={(e) => set('lostReason', e.target.value)} />
            </Field>
          }
          {(draft.stage === 'On Hold' || draft.stage === 'Cancelled') &&
          <Field label={`${draft.stage} note`} htmlFor="o-note" required error={errors.statusNote} className="sm:col-span-2">
              <textarea id="o-note" rows={2} className={inputCls(errors.statusNote)} value={draft.statusNote} onChange={(e) => set('statusNote', e.target.value)} />
            </Field>
          }
          <Field label="Expected tender publication" htmlFor="o-etd">
            <input id="o-etd" type="date" className={inputCls()} value={draft.expectedTenderDate} onChange={(e) => set('expectedTenderDate', e.target.value)} />
          </Field>
          <Field label="Expected award date" htmlFor="o-ead" error={errors.expectedAwardDate}>
            <input id="o-ead" type="date" className={inputCls(errors.expectedAwardDate)} value={draft.expectedAwardDate} onChange={(e) => set('expectedAwardDate', e.target.value)} />
          </Field>
        </FormSection>

        <FormSection title="Next action">
          <Field label="Next action" htmlFor="o-na" required={active} error={errors.nextAction} className="sm:col-span-2">
            <input id="o-na" className={inputCls(errors.nextAction)} value={draft.nextAction} onChange={(e) => set('nextAction', e.target.value)} placeholder="e.g. Share capability brief with Director General" />
          </Field>
          <Field label="Next action due date" htmlFor="o-nad" required={active} error={errors.nextActionDue}>
            <input id="o-nad" type="date" className={inputCls(errors.nextActionDue)} value={draft.nextActionDue} onChange={(e) => set('nextActionDue', e.target.value)} />
          </Field>
        </FormSection>

        <fieldset className="border-t border-slate-100 pt-4">
          <legend className="mb-2 text-[13px] font-bold text-slate-900">Associated contacts</legend>
          {!draft.orgId ?
          <p className="text-sm text-slate-500">Select an organization to choose contacts.</p> :
          contactOptions.length === 0 ?
          <p className="text-sm text-slate-500">No accessible contacts at this organization yet. After saving, add a contact from Organizations &amp; Contacts and link it here.</p> :

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {contactOptions.map((c) =>
            <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-2.5 py-2 hover:bg-slate-50">
                  <input
                type="checkbox"
                className="mt-0.5 accent-[#0E9384]"
                checked={draft.contactIds.includes(c.id)}
                onChange={(e) => set('contactIds', e.target.checked ? [...draft.contactIds, c.id] : draft.contactIds.filter((x) => x !== c.id))} />
              
                  <span>
                    <span className="block text-[13px] font-semibold text-slate-800">{c.name}</span>
                    <span className="block text-[11.5px] text-slate-500">{c.designation}</span>
                  </span>
                </label>
            )}
            </div>
          }
        </fieldset>
      </form>
    </Modal>);

}