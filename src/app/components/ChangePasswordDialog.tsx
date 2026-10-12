/**
 * Changing one's own password (CR3), in the approved dialog style.
 *
 * The server checks the current password and the policy; the repeat field is
 * the only check made here, because it never leaves the browser.
 */
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PASSWORD_MIN_LENGTH } from '../../../shared/validation.js';
import { changeOwnPassword } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { Modal } from '../../components/ui/Modal';
import { useSubmission } from '../useSubmission.js';
import { DialogAlert } from './FormBits.js';

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const submission = useSubmission();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    setMismatch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirm) {
      setMismatch('The two new passwords do not match.');
      return;
    }
    setMismatch(null);
    const done = await submission.run(async () => {
      await changeOwnPassword(currentPassword, newPassword);
      return true;
    });
    if (done) {
      toast.success('Password changed. Your other sessions have been signed out.');
      onClose();
    }
  };

  const errors = submission.fieldErrors;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Change password"
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="change-password-form" disabled={submission.submitting}>
            {submission.submitting ? 'Saving…' : 'Change password'}
          </Button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
        <DialogAlert message={submission.formError} />
        <p className="text-[13px] text-slate-600">
          You stay signed in here. Any other session on another browser or device is signed out.
        </p>
        <Field label="Current password" htmlFor="current-password" required error={errors.currentPassword}>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            className={inputCls(errors.currentPassword)}
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
              submission.clearField('currentPassword');
            }}
          />
        </Field>
        <Field
          label="New password"
          htmlFor="new-password"
          required
          error={errors.newPassword}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className={inputCls(errors.newPassword)}
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              submission.clearField('newPassword');
            }}
          />
        </Field>
        <Field label="Repeat the new password" htmlFor="confirm-new-password" required error={mismatch ?? undefined}>
          <input
            id="confirm-new-password"
            type="password"
            autoComplete="new-password"
            className={inputCls(mismatch ?? undefined)}
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
              setMismatch(null);
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}
