/**
 * Organization and contact dialogs (FR-030, FR-032, FR-033, BR-020, BR-021) —
 * the approved OrganizationForm and ContactForm layouts, connected to the
 * server. The server decides duplicates, cycles, visibility and who may edit
 * a shared identity; these dialogs show its answers where they belong.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangleIcon } from 'lucide-react';

import type { ContactDetailDto, OpportunityContactDto, OrganizationDetailDto } from '../../../shared/api.js';
import { ORGANIZATION_TYPES, ORGANIZATION_TYPE_LABELS } from '../../../shared/enums.js';
import {
  createContact,
  createOrganization,
  fetchContacts,
  fetchDirectory,
  linkContact,
  updateContact,
  updateContactLink,
  updateOrganization,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { useApiResource } from '../useApiResource.js';
import { useSubmission } from '../useSubmission.js';
import { DialogAlert } from './FormBits.js';
import { OpportunityPicker } from './OpportunityPicker.js';

function OrganizationSelect({
  value,
  onChange,
  error,
  label,
  excludeId,
  allowNone,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string;
  label: string;
  excludeId?: string;
  allowNone?: boolean;
  id: string;
}) {
  const orgs = useApiResource(
    useCallback((signal: AbortSignal) => fetchDirectory({ pageSize: 100 }, signal), []),
    [],
  );
  return (
    <Field label={label} htmlFor={id} required={!allowNone} error={error}>
      <select id={id} className={inputCls(error)} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allowNone ? 'None' : 'Select organization…'}</option>
        {orgs.data?.items
          .filter((org) => org.id !== excludeId)
          .map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export function OrganizationDialog({
  open,
  organization,
  onClose,
  onSaved,
}: {
  open: boolean;
  organization?: OrganizationDetailDto | null;
  onClose: () => void;
  onSaved: (saved: OrganizationDetailDto) => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('ministry');
  const [parentId, setParentId] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [basicNotes, setBasicNotes] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setName(organization?.name ?? '');
    setType(organization?.type ?? 'ministry');
    setParentId(organization?.parentId ?? '');
    setLocation(organization?.location ?? '');
    setWebsite(organization?.website ?? '');
    setBasicNotes(organization?.basicNotes ?? '');
    setDuplicateWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, organization?.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = {
      name,
      type,
      parentId: parentId || null,
      location: location || null,
      website: website || null,
      basicNotes: basicNotes || null,
      ...(duplicateWarning ? { acknowledgeDuplicates: true } : {}),
    };
    const result = await submission.run((key) =>
      organization ? updateOrganization(organization.id, { version: organization.version, ...body }) : createOrganization(body, key),
    );
    if (result) {
      toast.success(organization ? 'Organization updated' : 'Organization added', { description: result.name });
      onSaved(result);
    }
  };

  // FR-033: a possible duplicate is a warning the user may confirm past.
  useEffect(() => {
    if (submission.fieldErrors.name?.startsWith('Similar to')) setDuplicateWarning(submission.fieldErrors.name);
  }, [submission.fieldErrors.name]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={organization ? 'Edit organization' : 'Add organization'}
      description="Basic directory details only. Do not record private contact details or project commentary here."
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="org-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : duplicateWarning ? 'Save anyway' : organization ? 'Save' : 'Add organization'}
          </Button>
        </>
      }
    >
      <form id="org-form" onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          {duplicateWarning ? (
            <div role="alert" className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{duplicateWarning}</p>
            </div>
          ) : (
            <DialogAlert message={submission.formError} conflict={submission.conflict} />
          )}
        </div>
        <Field label="Name" htmlFor="org-name" required error={duplicateWarning ? undefined : errors.name} className="sm:col-span-2">
          <input
            id="org-name"
            className={inputCls(duplicateWarning ? undefined : errors.name)}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setDuplicateWarning(null);
            }}
          />
        </Field>
        <Field label="Type" htmlFor="org-type" required error={errors.type}>
          <select id="org-type" className={inputCls()} value={type} onChange={(event) => setType(event.target.value)}>
            {ORGANIZATION_TYPES.map((value) => (
              <option key={value} value={value}>
                {ORGANIZATION_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <OrganizationSelect
          id="org-parent"
          label="Parent organization"
          allowNone
          value={parentId}
          onChange={setParentId}
          error={errors.parentId}
          excludeId={organization?.id}
        />
        <Field label="Location" htmlFor="org-loc" error={errors.location}>
          <input id="org-loc" className={inputCls(errors.location)} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Dhaka" />
        </Field>
        <Field label="Website" htmlFor="org-web" error={errors.website}>
          <input id="org-web" className={inputCls(errors.website)} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://" />
        </Field>
        <Field label="Basic notes" htmlFor="org-notes" error={errors.basicNotes} className="sm:col-span-2">
          <textarea id="org-notes" rows={3} className={inputCls(errors.basicNotes)} value={basicNotes} onChange={(event) => setBasicNotes(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Contact: create (with its first link) or edit identity
// ---------------------------------------------------------------------------

export function ContactDialog({
  open,
  contact,
  defaultOrganizationId,
  opportunityId: fixedOpportunityId,
  onClose,
  onSaved,
}: {
  open: boolean;
  contact?: ContactDetailDto | null;
  defaultOrganizationId?: string;
  /** Set when adding from an opportunity's Contacts tab. */
  opportunityId?: string;
  onClose: () => void;
  onSaved: (saved: ContactDetailDto) => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [organizationId, setOrganizationId] = useState('');
  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [relationshipNotes, setRelationshipNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setOrganizationId(contact?.organizationId ?? defaultOrganizationId ?? '');
    setFullName(contact?.fullName ?? '');
    setDesignation(contact?.designation ?? '');
    setDepartment(contact?.department ?? '');
    setEmail(contact?.email ?? '');
    setPhone(contact?.phone ?? '');
    setOpportunityId(fixedOpportunityId ?? '');
    setRelationshipNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact?.id, defaultOrganizationId, fixedOpportunityId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const identity = {
      organizationId,
      fullName,
      designation,
      department: department || null,
      email: email || null,
      phone: phone || null,
    };
    const result = await submission.run((key) =>
      contact
        ? updateContact(contact.id, { version: contact.version, ...identity })
        : createContact({ ...identity, opportunityId, relationshipNotes: relationshipNotes || null }, key),
    );
    if (result) {
      toast.success(contact ? 'Contact updated' : 'Contact added', { description: result.fullName });
      onSaved(result);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={contact ? 'Edit contact' : 'Add contact'}
      description={
        contact
          ? 'These details are shared by every opportunity this contact is linked to.'
          : 'A contact is created together with its first opportunity link; relationship notes belong to that link.'
      }
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="contact-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : contact ? 'Save' : 'Add contact'}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <DialogAlert message={submission.formError} conflict={submission.conflict} />
        </div>
        <Field label="Full name" htmlFor="c-name" required error={errors.fullName}>
          <input id="c-name" className={inputCls(errors.fullName)} value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </Field>
        <Field label="Designation" htmlFor="c-des" required error={errors.designation}>
          <input id="c-des" className={inputCls(errors.designation)} value={designation} onChange={(event) => setDesignation(event.target.value)} />
        </Field>
        <OrganizationSelect id="c-org" label="Organization" value={organizationId} onChange={setOrganizationId} error={errors.organizationId} />
        <Field label="Department or office" htmlFor="c-dept" error={errors.department}>
          <input id="c-dept" className={inputCls(errors.department)} value={department} onChange={(event) => setDepartment(event.target.value)} />
        </Field>
        <Field label="Email" htmlFor="c-email" error={errors.email} hint="Optional">
          <input id="c-email" type="email" className={inputCls(errors.email)} value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="c-phone" error={errors.phone} hint="Optional">
          <input id="c-phone" className={inputCls(errors.phone)} value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        {!contact && !fixedOpportunityId && (
          <OpportunityPicker value={opportunityId} onChange={setOpportunityId} error={errors.opportunityId} label="First linked opportunity" />
        )}
        {!contact && (
          <Field
            label="Relationship notes for this opportunity"
            htmlFor="c-notes"
            error={errors.relationshipNotes}
            className="sm:col-span-2"
            hint="Visible only to people who can see this opportunity."
          >
            <textarea id="c-notes" rows={2} className={inputCls(errors.relationshipNotes)} value={relationshipNotes} onChange={(event) => setRelationshipNotes(event.target.value)} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Link an existing contact to an opportunity
// ---------------------------------------------------------------------------

export function LinkContactDialog({
  open,
  opportunityId,
  onClose,
  onDone,
  onCreateNew,
}: {
  open: boolean;
  opportunityId: string;
  onClose: () => void;
  onDone: () => void;
  onCreateNew: () => void;
}) {
  const submission = useSubmission();
  const [q, setQ] = useState('');
  const [contactId, setContactId] = useState('');
  const [relationshipNotes, setRelationshipNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setQ('');
    setContactId('');
    setRelationshipNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Only contacts the caller can already see are offered (SEC-004).
  const options = useApiResource(
    useCallback((signal: AbortSignal) => fetchContacts({ q: q || undefined, pageSize: 50 }, signal), [q]),
    [q, open],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run((key) =>
      linkContact(opportunityId, { contactId, relationshipNotes: relationshipNotes || null }, key),
    );
    if (result) {
      toast.success('Contact linked', { description: result.contact.fullName });
      onDone();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link a contact"
      description="Choose a contact you can already see, or add a new one."
      footer={
        <>
          <Button onClick={onCreateNew}>Add a new contact instead</Button>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="link-form" disabled={submission.submitting || !contactId}>
            {submission.submitting ? 'Saving…' : 'Link contact'}
          </Button>
        </>
      }
    >
      <form id="link-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        <DialogAlert message={submission.formError} />
        <Field label="Search your contacts" htmlFor="l-q">
          <input id="l-q" className={inputCls()} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Name, designation or email…" />
        </Field>
        <Field label="Contact" htmlFor="l-contact" required error={submission.fieldErrors.contactId}>
          <select id="l-contact" className={inputCls()} value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">Select contact…</option>
            {options.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName} — {item.designation}, {item.organizationName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Relationship notes for this opportunity" htmlFor="l-notes" error={submission.fieldErrors.relationshipNotes}>
          <textarea id="l-notes" rows={2} className={inputCls()} value={relationshipNotes} onChange={(event) => setRelationshipNotes(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Relationship notes on one link
// ---------------------------------------------------------------------------

export function RelationshipNotesDialog({
  link,
  title,
  onClose,
  onDone,
}: {
  link: Pick<OpportunityContactDto, 'linkId' | 'relationshipNotes' | 'version'> | null;
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const submission = useSubmission();
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!link) return;
    submission.reset();
    setNotes(link.relationshipNotes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.linkId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!link) return;
    const result = await submission.run(() => updateContactLink(link.linkId, { version: link.version, relationshipNotes: notes || null }));
    if (result) {
      toast.success('Relationship notes saved');
      onDone();
    }
  };

  return (
    <Modal
      open={Boolean(link)}
      onClose={onClose}
      size="sm"
      title="Relationship notes"
      description={title}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="notes-form" disabled={submission.submitting || submission.conflict}>
            Save notes
          </Button>
        </>
      }
    >
      <form id="notes-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        <p className="text-xs text-slate-500">These notes belong to this opportunity only. Teams working on other opportunities never see them.</p>
        <Field label="Notes" htmlFor="rn-notes" error={submission.fieldErrors.relationshipNotes}>
          <textarea id="rn-notes" rows={4} className={inputCls()} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Confirm with a reason (archive, remove a link)
// ---------------------------------------------------------------------------

export function ReasonDialog({
  open,
  title,
  message,
  confirmLabel,
  reasonRequired,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  reasonRequired: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const submission = useSubmission();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!open) return;
    submission.reset();
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run(async () => {
      await onConfirm(reason);
      return true;
    });
    if (result) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form="reason-form" disabled={submission.submitting}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="reason-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 text-[13px] text-slate-600" noValidate>
        {submission.formError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-800">
            {submission.formError}
          </div>
        )}
        <p>{message}</p>
        <Field label="Reason" htmlFor="reason-text" required={reasonRequired} error={submission.fieldErrors.reason}>
          <textarea id="reason-text" rows={2} className={inputCls(submission.fieldErrors.reason)} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
