import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Role, SectionId, User, UserDraft } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { ROLE_LABELS, SECTIONS } from '../../data/options';
import { isValidEmail } from '../../utils/validation';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from '../ui/FormFields';

const ROLES: Role[] = ['management', 'lead', 'sales', 'admin'];

export function UserForm({ open, onClose, user }: {open: boolean;onClose: () => void;user?: User;}) {
  const { db, saveUser } = useCrm();
  const [d, setD] = useState<UserDraft>({ name: '', email: '', role: 'sales', sectionId: 'GA', managerId: null, active: true });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const leadOf = (section: SectionId | null) => db.users.find((u) => u.role === 'lead' && u.active && u.sectionId === section);
  const mgmt = db.users.filter((u) => u.role === 'management' && u.active);

  useEffect(() => {
    if (!open) return;
    if (user) {
      const { id: _id, ...rest } = user;
      setD(rest);
    } else setD({ name: '', email: '', role: 'sales', sectionId: 'GA', managerId: leadOf('GA')?.id ?? null, active: true });
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  const setRole = (role: Role) => {
    setD((p) => {
      const sectionId = role === 'lead' || role === 'sales' ? p.sectionId ?? 'GA' : null;
      const managerId = role === 'sales' ? leadOf(sectionId)?.id ?? null : role === 'lead' ? mgmt[0]?.id ?? null : null;
      return { ...p, role, sectionId, managerId };
    });
  };

  const setSection = (sectionId: SectionId) => {
    setD((p) => ({ ...p, sectionId, managerId: p.role === 'sales' ? leadOf(sectionId)?.id ?? null : p.managerId }));
  };

  const managerOptions = d.role === 'sales' ? db.users.filter((u) => u.role === 'lead' && u.active && u.sectionId === d.sectionId) : d.role === 'lead' ? mgmt : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!d.name.trim()) errs.name = 'Name is required.';
    if (!isValidEmail(d.email)) errs.email = 'Enter a valid email address.';
    if ((d.role === 'sales' || d.role === 'lead') && !d.sectionId) errs.sectionId = 'Select a section.';
    if (d.role === 'sales' && !d.managerId) errs.managerId = 'Salespeople must report to their section lead. Add an active section lead first.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const res = saveUser(d, user?.id);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save user.');
      return;
    }
    toast.success(user ? 'User updated' : 'User added', { description: `${d.name} · ${ROLE_LABELS[d.role]}` });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? 'Edit user' : 'Add user'}
      description="This version supports one section lead per section, with salespeople reporting directly to that lead."
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="user-form">
            {user ? 'Save user' : 'Add user'}
          </Button>
        </>
      }>
      
      <form id="user-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <Field label="Full name" htmlFor="u-name" required error={errors.name}>
          <input id="u-name" className={inputCls(errors.name)} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="u-email" required error={errors.email}>
          <input id="u-email" type="email" className={inputCls(errors.email)} value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} placeholder="name@example.com" />
        </Field>
        <Field label="Role" htmlFor="u-role" required>
          <select id="u-role" className={inputCls()} value={d.role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) =>
            <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            )}
          </select>
        </Field>
        {(d.role === 'lead' || d.role === 'sales') &&
        <Field label="Section" htmlFor="u-sec" required error={errors.sectionId}>
            <select id="u-sec" className={inputCls(errors.sectionId)} value={d.sectionId ?? ''} onChange={(e) => setSection(e.target.value as SectionId)}>
              {SECTIONS.map((s) =>
            <option key={s.id} value={s.id}>
                  {s.name}
                </option>
            )}
            </select>
          </Field>
        }
        {(d.role === 'lead' || d.role === 'sales') &&
        <Field label="Reports to" htmlFor="u-mgr" required={d.role === 'sales'} error={errors.managerId}>
            <select id="u-mgr" className={inputCls(errors.managerId)} value={d.managerId ?? ''} onChange={(e) => setD({ ...d, managerId: e.target.value || null })}>
              <option value="">{d.role === 'sales' ? 'Select section lead…' : 'None'}</option>
              {managerOptions.map((m) =>
            <option key={m.id} value={m.id}>
                  {m.name} — {ROLE_LABELS[m.role]}
                </option>
            )}
            </select>
          </Field>
        }
        {!user &&
        <label className="flex items-center gap-2 text-[13px] text-slate-700 sm:col-span-2">
            <input type="checkbox" className="accent-[#0E9384]" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
            Active account
          </label>
        }
      </form>
    </Modal>);

}