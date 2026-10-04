import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Contact, ContactDraft } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { useScope } from '../../hooks/useScope';
import { isValidEmail } from '../../utils/validation';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from '../ui/FormFields';

interface ContactFormProps {
  open: boolean;
  onClose: () => void;
  contact?: Contact;
  defaultOrgId?: string;
  onSaved?: (id: string) => void;
}

export function ContactForm({ open, onClose, contact, defaultOrgId, onSaved }: ContactFormProps) {
  const { saveContact } = useCrm();
  const scope = useScope();
  const [d, setD] = useState<ContactDraft>({ name: '', designation: '', orgId: '', department: '', email: '', phone: '', notes: '' });
  const [linked, setLinked] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (contact) {
      const { id: _id, ...rest } = contact;
      setD(rest);
      setLinked(scope.opportunities.filter((o) => o.contactIds.includes(contact.id)).map((o) => o.id));
    } else {
      setD({ name: '', designation: '', orgId: defaultOrgId ?? '', department: '', email: '', phone: '', notes: '' });
      setLinked([]);
    }
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact?.id, defaultOrgId]);

  const set = <K extends keyof ContactDraft,>(k: K, v: ContactDraft[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const oppOptions = [...scope.opportunities].sort((a, b) => Number(b.orgId === d.orgId) - Number(a.orgId === d.orgId) || a.name.localeCompare(b.name));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!d.name.trim()) errs.name = 'Full name is required.';
    if (!d.designation.trim()) errs.designation = 'Designation is required.';
    if (!d.orgId) errs.orgId = 'Select the organization.';
    if (d.email && !isValidEmail(d.email)) errs.email = 'Enter a valid email address.';
    if (d.email && !d.email.toLowerCase().endsWith('@example.com')) errs.email = 'Demo data must use the reserved example.com domain.';
    if (!linked.length) errs.linked = 'Link at least one opportunity you can access — contact visibility is based on linked opportunities.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const res = saveContact(d, linked, contact?.id);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save contact.');
      return;
    }
    toast.success(contact ? 'Contact updated' : 'Contact added', { description: d.name });
    onClose();
    if (res.id) onSaved?.(res.id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={contact ? 'Edit contact' : 'Add contact'}
      description="Use fictional people only. Emails must use example.com."
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="contact-form">
            {contact ? 'Save' : 'Add contact'}
          </Button>
        </>
      }>
      
      <form id="contact-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <Field label="Full name" htmlFor="c-name" required error={errors.name}>
          <input id="c-name" className={inputCls(errors.name)} value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Designation" htmlFor="c-des" required error={errors.designation}>
          <input id="c-des" className={inputCls(errors.designation)} value={d.designation} onChange={(e) => set('designation', e.target.value)} />
        </Field>
        <Field label="Organization" htmlFor="c-org" required error={errors.orgId}>
          <select id="c-org" className={inputCls(errors.orgId)} value={d.orgId} onChange={(e) => set('orgId', e.target.value)}>
            <option value="">Select organization…</option>
            {scope.organizations.map((o) =>
            <option key={o.id} value={o.id}>
                {o.name}
              </option>
            )}
          </select>
        </Field>
        <Field label="Department or office" htmlFor="c-dept">
          <input id="c-dept" className={inputCls()} value={d.department} onChange={(e) => set('department', e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="c-email" error={errors.email}>
          <input id="c-email" type="email" className={inputCls(errors.email)} value={d.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="Phone" htmlFor="c-phone">
          <input id="c-phone" className={inputCls()} value={d.phone} onChange={(e) => set('phone', e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Relationship notes" htmlFor="c-notes" className="sm:col-span-2">
          <textarea id="c-notes" rows={2} className={inputCls()} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-semibold text-slate-700">
            Linked opportunities <span className="text-red-600">*</span>
          </legend>
          <p className="mb-2 text-xs text-slate-500">Only opportunities you can access are listed. Links to other opportunities are preserved.</p>
          <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {oppOptions.map((o) =>
            <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-2.5 py-2 hover:bg-slate-50">
                <input
                type="checkbox"
                className="mt-0.5 accent-[#0E9384]"
                checked={linked.includes(o.id)}
                onChange={(e) => {
                  setLinked((l) => e.target.checked ? [...l, o.id] : l.filter((x) => x !== o.id));
                  setErrors((er) => ({ ...er, linked: '' }));
                }} />
              
                <span className="text-[13px] text-slate-800">
                  {o.name}
                  {o.orgId === d.orgId && <span className="ml-1 text-[11px] text-brand-dark">same org</span>}
                </span>
              </label>
            )}
          </div>
          {errors.linked &&
          <p className="mt-1 text-xs font-medium text-red-600" role="alert">
              {errors.linked}
            </p>
          }
        </fieldset>
      </form>
    </Modal>);

}