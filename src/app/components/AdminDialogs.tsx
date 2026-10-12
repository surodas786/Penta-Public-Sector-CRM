/**
 * Administration dialogs (FR-071, BR-051, BR-052, SEC-030).
 *
 * The approved UserForm layout, connected to the server. The server owns
 * every structural rule — reporting lines, one lead per section, owners who
 * cannot be moved — and its refusals are shown as returned.
 */
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, CopyIcon, KeyRoundIcon } from 'lucide-react';

import type { AccountLinkDto, AdminSectionDto, AdminUserDto } from '../../../shared/api.js';
import { ROLE_LABELS, USER_ROLES, type UserRole } from '../../../shared/enums.js';
import {
  createAdminSection,
  createAdminUser,
  renameAdminSection,
  replaceSectionLead,
  setAdminSectionActive,
  setAdminUserActive,
  updateAdminUser,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { formatInstant } from '../ui/dates.js';
import { useSubmission } from '../useSubmission.js';
import { DialogAlert } from './FormBits.js';

// ---------------------------------------------------------------------------
// Add / edit user
// ---------------------------------------------------------------------------

export function UserDialog({
  open,
  user,
  sections,
  managementAccounts,
  isSelf,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: AdminUserDto | null;
  sections: AdminSectionDto[];
  managementAccounts: AdminUserDto[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: (result: { user: AdminUserDto; delivery?: 'email' | 'manual'; link: AccountLinkDto | null }) => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const activeSections = sections.filter((section) => section.active);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('sales');
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [managerId, setManagerId] = useState('');

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setFullName(user?.fullName ?? '');
    setEmail(user?.email ?? '');
    setRole(user?.role ?? 'sales');
    // A salesperson's sections; a lead's sections come from appointment (CR4, CR5).
    setSectionIds(user?.role === 'sales' ? user.sections.map((item) => item.id) : activeSections[0] ? [activeSections[0].id] : []);
    setManagerId(user?.managerId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  const chosenSections = sections.filter((item) => sectionIds.includes(item.id));
  const toggleSection = (id: string, checked: boolean) =>
    setSectionIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = {
      fullName,
      email,
      role,
      // Only salespeople are members; their reporting line is each section's lead.
      ...(role === 'sales' ? { sectionIds } : {}),
      managerId: role === 'lead' ? managerId || null : null,
    };
    const result = await submission.run(async (key) =>
      user
        ? { user: await updateAdminUser(user.id, { version: user.version, ...body }), link: null }
        : createAdminUser(body, key),
    );
    if (result) {
      toast.success(user ? 'User updated' : 'User added', { description: `${result.user.fullName} · ${ROLE_LABELS[result.user.role]}` });
      onSaved(result);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? 'Edit user' : 'Add user'}
      description="Each active section has one lead, who may lead several sections. A salesperson may belong to several sections and reports to the lead of each."
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="user-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : user ? 'Save user' : 'Add user'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <DialogAlert message={submission.formError} conflict={submission.conflict} />
        </div>
        <Field label="Full name" htmlFor="u-name" required error={errors.fullName}>
          <input id="u-name" className={inputCls(errors.fullName)} value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </Field>
        <Field label="Email" htmlFor="u-email" required error={errors.email}>
          <input
            id="u-email"
            type="email"
            className={inputCls(errors.email)}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Work email address"
          />
        </Field>
        <Field
          label="Role"
          htmlFor="u-role"
          required
          error={errors.role}
          hint={isSelf ? 'You cannot change your own role.' : undefined}
        >
          <select
            id="u-role"
            className={inputCls(errors.role)}
            value={role}
            disabled={isSelf}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {USER_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        {role === 'sales' && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 block text-xs font-semibold text-slate-700">
              Sections<span className="text-red-600"> *</span>
            </legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {activeSections.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-[13px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={sectionIds.includes(item.id)}
                    onChange={(event) => toggleSection(item.id, event.target.checked)}
                  />
                  {item.name}
                </label>
              ))}
            </div>
            {errors.sectionIds ? (
              <p className="mt-1 text-xs font-medium text-red-600" role="alert">
                {errors.sectionIds}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Leaving a section is refused while they own opportunities there, and ends their sessions.
              </p>
            )}
          </fieldset>
        )}
        {role === 'sales' && (
          <Field
            label="Reports to"
            htmlFor="u-mgr-sales"
            className="sm:col-span-2"
            error={errors.managerId}
            hint="Salespeople report to the lead of each of their sections."
          >
            <input
              id="u-mgr-sales"
              className={inputCls()}
              value={chosenSections.map((item) => `${item.leadName ?? 'No lead'} (${item.name})`).join(', ') || 'Choose a section'}
              disabled
            />
          </Field>
        )}
        {role === 'lead' && (
          <Field
            label="Sections led"
            htmlFor="u-led"
            error={errors.sectionIds}
            hint="Appoint a lead from a section’s Replace lead action, or name them when adding a section."
          >
            <input
              id="u-led"
              className={inputCls()}
              value={user?.role === 'lead' ? user.sections.map((item) => item.name).join(', ') || 'None yet' : 'None yet'}
              disabled
            />
          </Field>
        )}
        {role === 'lead' && (
          <Field label="Reports to" htmlFor="u-mgr" error={errors.managerId}>
            <select id="u-mgr" className={inputCls(errors.managerId)} value={managerId} onChange={(event) => setManagerId(event.target.value)}>
              <option value="">None</option>
              {managementAccounts.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName} — Management
                </option>
              ))}
            </select>
          </Field>
        )}
        {!user && (
          <p className="text-xs text-slate-500 sm:col-span-2">
            The account is created with no password. While email delivery is on, the person is emailed a single-use
            invitation link; otherwise you receive the link to send them. Either way, they choose their own password.
          </p>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// One-time link
// ---------------------------------------------------------------------------

/** A link shown once to copy. Emailed links are never shown (CR1). */
export type ManualAccountLink = Extract<AccountLinkDto, { delivery: 'manual' }>;

export function AccountLinkDialog({
  link,
  person,
  onClose,
}: {
  link: ManualAccountLink | null;
  person: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link?.url]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.');
    }
  };

  return (
    <Modal
      open={Boolean(link)}
      onClose={onClose}
      title={link?.purpose === 'invitation' ? 'Invitation link' : 'Password reset link'}
      description={person}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {link && (
        <div className="flex flex-col gap-3 text-[13px] text-slate-700">
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900">
            <KeyRoundIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This link is shown <strong>once</strong>. Send it to {person} through a trusted channel. It works one time and
              expires {formatInstant(link.expiresAt)}. Issuing another link cancels this one.
            </p>
          </div>
          <label htmlFor="account-link" className="text-xs font-semibold text-slate-700">
            Link
          </label>
          <div className="flex gap-2">
            <input id="account-link" readOnly className={inputCls(undefined, 'font-mono text-xs')} value={link.url} onFocus={(event) => event.target.select()} />
            <Button icon={copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Activate / deactivate an account
// ---------------------------------------------------------------------------

export function AccountStateDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const submission = useSubmission();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!user) return;
    submission.reset();
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const deactivating = user.active;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run(() =>
      setAdminUserActive(user.id, !deactivating, { version: user.version, reason: reason || undefined }),
    );
    if (result) {
      toast.success(deactivating ? `${user.fullName} deactivated` : `${user.fullName} reactivated`);
      onDone();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={deactivating ? `Deactivate ${user.fullName}?` : `Activate ${user.fullName}?`}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant={deactivating ? 'danger' : 'primary'} type="submit" form="account-state-form" disabled={submission.submitting}>
            {deactivating ? 'Deactivate' : 'Activate'}
          </Button>
        </>
      }
    >
      <form id="account-state-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 text-[13px] text-slate-600" noValidate>
        {submission.formError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-800">
            <strong>Action blocked.</strong> {submission.formError}
          </div>
        )}
        <p>
          {deactivating
            ? 'Their sessions end immediately and any outstanding sign-in link stops working. Accounts that own open opportunities, or lead an active section, cannot be deactivated until that is resolved.'
            : 'They will be able to sign in and be assigned work again.'}
        </p>
        <Field label="Reason" htmlFor="state-reason" hint="Optional — recorded in the administrative audit.">
          <textarea id="state-reason" rows={2} className={inputCls()} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export type SectionAction =
  | { kind: 'create' }
  | { kind: 'rename'; section: AdminSectionDto }
  | { kind: 'lead'; section: AdminSectionDto }
  | { kind: 'state'; section: AdminSectionDto };

export function SectionDialog({
  action,
  users,
  onClose,
  onDone,
}: {
  action: SectionAction | null;
  users: AdminUserDto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [name, setName] = useState('');
  const [newLeadId, setNewLeadId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!action) return;
    submission.reset();
    setName(action.kind === 'rename' ? action.section.name : '');
    setNewLeadId('');
    setLeadId('');
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (!action) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const section = action.kind === 'create' ? null : action.section;
  // CR4: an existing lead may take on this section; a salesperson in it may be promoted.
  const activeLeads = users.filter((user) => user.active && user.role === 'lead');
  const leadCandidates = activeLeads.filter((user) => user.id !== section?.leadId);
  const memberCandidates = users.filter(
    (user) => user.active && user.role === 'sales' && user.sections.some((item) => item.id === section?.id),
  );

  const title =
    action.kind === 'create'
      ? 'Add section'
      : action.kind === 'rename'
        ? 'Rename section'
        : action.kind === 'lead'
          ? section?.leadName
            ? `Replace lead of ${section.name}`
            : `Appoint lead of ${section?.name}`
          : section?.active
            ? `Deactivate ${section.name}?`
            : `Reactivate ${section?.name}?`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run((key) => {
      switch (action.kind) {
        case 'create':
          return createAdminSection({ name, leadId }, key);
        case 'rename':
          return renameAdminSection(action.section.id, { version: action.section.version, name });
        case 'lead':
          return replaceSectionLead(action.section.id, { version: action.section.version, newLeadId, reason });
        case 'state':
          return setAdminSectionActive(action.section.id, !action.section.active, {
            version: action.section.version,
            reason: reason || undefined,
            ...(!action.section.active && leadId ? { leadId } : {}),
          });
      }
    });
    if (result) {
      toast.success(`${result.name} saved`);
      onDone();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button
            variant={action.kind === 'state' && section?.active ? 'danger' : 'primary'}
            type="submit"
            form="section-form"
            disabled={submission.submitting || submission.conflict}
          >
            {submission.submitting ? 'Saving…' : action.kind === 'lead' ? 'Appoint lead' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="section-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 text-[13px] text-slate-600" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        {(action.kind === 'create' || action.kind === 'rename') && (
          <Field label="Section name" htmlFor="s-name" required error={errors.name}>
            <input id="s-name" className={inputCls(errors.name)} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
        )}
        {action.kind === 'create' && (
          <Field
            label="Section lead"
            htmlFor="s-new-lead"
            required
            error={errors.leadId}
            hint="An active section always has a lead. To make a salesperson the lead, add them to the section and use Replace lead."
          >
            <select id="s-new-lead" className={inputCls(errors.leadId)} value={leadId} onChange={(event) => setLeadId(event.target.value)}>
              <option value="">Select a section lead…</option>
              {activeLeads.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                  {user.sections.length > 0 ? ` — leads ${user.sections.map((item) => item.name).join(', ')}` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        {action.kind === 'lead' && (
          <>
            <p>
              Choose an existing section lead, who keeps their other sections, or a salesperson in this section, who is promoted.{' '}
              {section?.leadName
                ? `${section.leadName} keeps any other section they lead; if this is their only one, they stay in it as a salesperson. `
                : ''}
              Every salesperson in the section then reports to the new lead. The sessions of everyone whose role changes end, so
              their access is recalculated.
            </p>
            <Field label="New lead" htmlFor="s-lead" required error={errors.newLeadId}>
              <select id="s-lead" className={inputCls(errors.newLeadId)} value={newLeadId} onChange={(event) => setNewLeadId(event.target.value)}>
                <option value="">Select the new lead…</option>
                {leadCandidates.length > 0 && (
                  <optgroup label="Section leads">
                    {leadCandidates.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                        {user.sections.length > 0 ? ` — leads ${user.sections.map((item) => item.name).join(', ')}` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {memberCandidates.length > 0 && (
                  <optgroup label="Salespeople in this section">
                    {memberCandidates.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>
            <Field label="Reason" htmlFor="s-reason" required error={errors.reason}>
              <textarea id="s-reason" rows={2} className={inputCls(errors.reason)} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </>
        )}
        {action.kind === 'state' && (
          <>
            <p>
              {section?.active
                ? 'A section with open opportunities or active members cannot be deactivated. Its lead keeps any other section they lead.'
                : 'An active section always has a lead. Its former lead resumes unless you choose another.'}
            </p>
            {!section?.active && (
              <Field label="Section lead" htmlFor="s-reactivate-lead" error={errors.leadId}>
                <select id="s-reactivate-lead" className={inputCls(errors.leadId)} value={leadId} onChange={(event) => setLeadId(event.target.value)}>
                  <option value="">The former lead</option>
                  {activeLeads.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Reason" htmlFor="s-state-reason" hint="Optional — recorded in the administrative audit.">
              <textarea id="s-state-reason" rows={2} className={inputCls()} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
