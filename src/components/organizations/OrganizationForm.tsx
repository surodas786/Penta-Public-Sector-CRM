import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Organization, OrganizationDraft, OrgType } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { ORG_TYPES } from '../../data/options';
import { isValidUrl } from '../../utils/validation';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from '../ui/FormFields';

const empty: OrganizationDraft = { name: '', type: 'Ministry', parentId: null, location: '', website: '', notes: '' };

export function OrganizationForm({ open, onClose, organization, onSaved }: {open: boolean;onClose: () => void;organization?: Organization;onSaved?: (id: string) => void;}) {
  const { db, saveOrganization } = useCrm();
  const [d, setD] = useState<OrganizationDraft>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (organization) {
      const { id: _id, ...rest } = organization;
      setD(rest);
    } else setD(empty);
    setErrors({});
  }, [open, organization]);

  const set = <K extends keyof OrganizationDraft,>(k: K, v: OrganizationDraft[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!d.name.trim()) errs.name = 'Organization name is required.';
    if (!d.location.trim()) errs.location = 'Location is required.';
    if (d.website && !isValidUrl(d.website)) errs.website = 'Enter a full URL starting with http:// or https://';
    if (db.organizations.some((o) => o.name.toLowerCase() === d.name.trim().toLowerCase() && o.id !== organization?.id)) errs.name = 'An organization with this name already exists.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const res = saveOrganization(d, organization?.id);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save organization.');
      return;
    }
    toast.success(organization ? 'Organization updated' : 'Organization added', { description: d.name });
    onClose();
    if (res.id) onSaved?.(res.id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={organization ? 'Edit organization' : 'Add organization'}
      description="Use fictional organizations only in this demo."
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="org-form">
            {organization ? 'Save' : 'Add organization'}
          </Button>
        </>
      }>
      
      <form id="org-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" htmlFor="org-name" required error={errors.name} className="sm:col-span-2">
          <input id="org-name" className={inputCls(errors.name)} value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Type" htmlFor="org-type" required>
          <select id="org-type" className={inputCls()} value={d.type} onChange={(e) => set('type', e.target.value as OrgType)}>
            {ORG_TYPES.map((t) =>
            <option key={t}>{t}</option>
            )}
          </select>
        </Field>
        <Field label="Parent organization" htmlFor="org-parent">
          <select id="org-parent" className={inputCls()} value={d.parentId ?? ''} onChange={(e) => set('parentId', e.target.value || null)}>
            <option value="">None</option>
            {db.organizations.
            filter((o) => o.id !== organization?.id).
            map((o) =>
            <option key={o.id} value={o.id}>
                  {o.name}
                </option>
            )}
          </select>
        </Field>
        <Field label="Location" htmlFor="org-loc" required error={errors.location}>
          <input id="org-loc" className={inputCls(errors.location)} value={d.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Dhaka" />
        </Field>
        <Field label="Website" htmlFor="org-web" error={errors.website}>
          <input id="org-web" className={inputCls(errors.website)} value={d.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Notes" htmlFor="org-notes" className="sm:col-span-2">
          <textarea id="org-notes" rows={3} className={inputCls()} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </form>
    </Modal>);

}