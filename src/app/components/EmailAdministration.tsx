/**
 * Email delivery on the Administration page (CR2): the mail server, the
 * wording of each email, a test message and the delivery log.
 *
 * Built from the page's existing Panel, table, Modal and form primitives. The
 * SMTP password is write-only: the server says whether one is stored, never
 * what it is. Previews use synthetic sample values, never real records.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MailIcon, PencilIcon, SendIcon } from 'lucide-react';

import type { EmailDeliveryDto, EmailPreviewDto, EmailSettingsDto, EmailTemplateDto } from '../../../shared/api.js';
import { EMAIL_SECURITY_LABELS, EMAIL_SECURITY_MODES, type EmailSecurityMode } from '../../../shared/email.js';
import {
  fetchEmailDeliveries,
  fetchEmailSettings,
  fetchEmailTemplates,
  previewEmailTemplate,
  sendTestEmail,
  updateEmailSettings,
  updateEmailTemplate,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { Pagination, Panel, tdCls, thCls } from '../../components/ui/Layout';
import { Modal } from '../../components/ui/Modal';
import { formatInstant } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';
import { useSubmission } from '../useSubmission.js';
import { ErrorPanel, LoadingPanel } from './Feedback.js';
import { DialogAlert } from './FormBits.js';

const TRANSPORT_NOTES: Record<EmailSettingsDto['transport'], string> = {
  none: 'This server is set to send no email (EMAIL_TRANSPORT=none). Settings can be prepared, but nothing is sent.',
  capture: 'Development mode: messages are written to a local folder (EMAIL_TRANSPORT=capture) and never sent.',
  smtp: 'Messages are sent through the mail server below.',
};

const STATUS_STYLES: Record<EmailDeliveryDto['status'], string> = {
  queued: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  sent: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  suppressed: 'bg-slate-100 text-slate-600 ring-slate-400/20',
};

const STATUS_LABELS: Record<EmailDeliveryDto['status'], string> = {
  queued: 'Queued',
  sent: 'Sent',
  failed: 'Failed',
  suppressed: 'Not sent',
};

function StatusBadge({ status }: { status: EmailDeliveryDto['status'] }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function EmailAdministration() {
  const settings = useApiResource(useCallback((signal: AbortSignal) => fetchEmailSettings(signal), []), []);
  const templates = useApiResource(useCallback((signal: AbortSignal) => fetchEmailTemplates(signal), []), []);
  const [logPage, setLogPage] = useState(1);
  const deliveries = useApiResource(
    useCallback((signal: AbortSignal) => fetchEmailDeliveries({ page: logPage, pageSize: 10 }, signal), [logPage]),
    [logPage],
  );
  const [editingSettings, setEditingSettings] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplateDto | null>(null);

  const current = settings.data;

  return (
    <>
      <Panel
        title="Email delivery"
        subtitle="The mail server used for invitations, password emails and notifications."
        action={
          current && (
            <span className="flex gap-1.5">
              <Button size="sm" icon={<SendIcon className="h-3.5 w-3.5" />} onClick={() => setTesting(true)} disabled={!current.host}>
                Send test email
              </Button>
              <Button size="sm" variant="primary" icon={<PencilIcon className="h-3.5 w-3.5" />} onClick={() => setEditingSettings(true)}>
                Edit settings
              </Button>
            </span>
          )
        }
      >
        {settings.error ? (
          <ErrorPanel error={settings.error} onRetry={settings.reload} />
        ) : !current ? (
          <LoadingPanel label="Loading email settings…" />
        ) : (
          <div className="flex flex-col gap-2 text-[13px] text-slate-700">
            <p>
              <span
                className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                  current.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-slate-100 text-slate-600 ring-slate-400/20'
                }`}
              >
                {current.enabled ? 'On' : 'Off'}
              </span>
              {current.host ? (
                <>
                  {current.host}:{current.port} · {EMAIL_SECURITY_LABELS[current.security]} · from{' '}
                  {current.fromName ? `${current.fromName} <${current.fromAddress}>` : current.fromAddress}
                </>
              ) : (
                'No mail server saved yet.'
              )}
            </p>
            <p className="text-[12px] text-slate-500">{TRANSPORT_NOTES[current.transport]}</p>
            {current.passwordSet && !current.passwordReadable && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-700">
                The stored SMTP password can no longer be decrypted (the server’s EMAIL_SECRET_KEY changed). Enter it again.
              </p>
            )}
            {current.updatedAt && (
              <p className="text-[11.5px] text-slate-500">
                Last changed {formatInstant(current.updatedAt)}
                {current.updatedByName ? ` by ${current.updatedByName}` : ''}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Email templates" subtitle="The wording of each email. Placeholders such as {{link}} are filled in when it is sent." bodyClassName="p-0">
        {templates.error ? (
          <ErrorPanel error={templates.error} onRetry={templates.reload} />
        ) : !templates.data ? (
          <LoadingPanel label="Loading templates…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <th className={`${thCls} pl-4`}>Email</th>
                  <th className={thCls}>Subject</th>
                  <th className={thCls}>State</th>
                  <th className={`${thCls} pr-4 text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {templates.data.items.map((template) => (
                  <tr key={template.key}>
                    <td className={`${tdCls} pl-4`}>
                      <span className="block font-semibold text-slate-900">{template.label}</span>
                      <span className="block text-[11.5px] text-slate-500">{template.sentWhen}</span>
                    </td>
                    <td className={tdCls}>{template.subject}</td>
                    <td className={tdCls}>
                      {template.enabled ? 'On' : 'Off'}
                      {template.customized ? ' · edited' : ' · default wording'}
                    </td>
                    <td className={`${tdCls} pr-4 text-right`}>
                      <Button size="sm" variant="ghost" icon={<PencilIcon className="h-3.5 w-3.5" />} onClick={() => setEditingTemplate(template)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Email delivery log" subtitle="What was sent, to whom, and what happened. Message contents are never stored." bodyClassName="p-0">
        {deliveries.error ? (
          <ErrorPanel error={deliveries.error} onRetry={deliveries.reload} />
        ) : !deliveries.data ? (
          <LoadingPanel label="Loading the delivery log…" />
        ) : deliveries.data.items.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-slate-500">
            <MailIcon className="h-4 w-4" aria-hidden="true" /> No emails yet.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr>
                    <th className={`${thCls} pl-4`}>Email</th>
                    <th className={thCls}>Recipient</th>
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} pr-4`}>When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deliveries.data.items.map((delivery) => (
                    <tr key={delivery.id}>
                      <td className={`${tdCls} pl-4`}>{delivery.label}</td>
                      <td className={tdCls}>
                        <span className="block">{delivery.recipientName ?? delivery.recipientAddress ?? '—'}</span>
                        {delivery.recipientName && delivery.recipientAddress && (
                          <span className="block text-[11.5px] text-slate-500">{delivery.recipientAddress}</span>
                        )}
                      </td>
                      <td className={tdCls}>
                        <StatusBadge status={delivery.status} />
                        {delivery.statusDetail && <span className="mt-0.5 block text-[11.5px] text-slate-500">{delivery.statusDetail}</span>}
                      </td>
                      <td className={`${tdCls} pr-4 tabular-nums`}>{formatInstant(delivery.sentAt ?? delivery.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={deliveries.data.page}
              pageCount={Math.max(1, Math.ceil(deliveries.data.total / deliveries.data.pageSize))}
              total={deliveries.data.total}
              pageSize={deliveries.data.pageSize}
              onChange={setLogPage}
            />
          </>
        )}
      </Panel>

      {current && (
        <EmailSettingsDialog
          open={editingSettings}
          settings={current}
          onClose={() => setEditingSettings(false)}
          onSaved={() => {
            setEditingSettings(false);
            settings.reload();
          }}
        />
      )}
      <TestEmailDialog
        open={testing}
        onClose={() => setTesting(false)}
        onDone={() => {
          setTesting(false);
          deliveries.reload();
        }}
      />
      <EmailTemplateDialog
        template={editingTemplate}
        onClose={() => setEditingTemplate(null)}
        onSaved={() => {
          setEditingTemplate(null);
          templates.reload();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function EmailSettingsDialog({
  open,
  settings,
  onClose,
  onSaved,
}: {
  open: boolean;
  settings: EmailSettingsDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [security, setSecurity] = useState<EmailSecurityMode>('starttls');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [fromName, setFromName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [replyTo, setReplyTo] = useState('');

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setEnabled(settings.enabled);
    setHost(settings.host ?? '');
    setPort(settings.port ? String(settings.port) : '587');
    setSecurity(settings.security);
    setUsername(settings.username ?? '');
    setPassword('');
    setRemovePassword(false);
    setFromName(settings.fromName ?? '');
    setFromAddress(settings.fromAddress ?? '');
    setReplyTo(settings.replyTo ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body: Record<string, unknown> = {
      version: settings.version,
      enabled,
      host: host.trim() || null,
      port: port.trim() ? Number(port) : null,
      security,
      username: username.trim() || null,
      fromName: fromName.trim() || null,
      fromAddress: fromAddress.trim() || null,
      replyTo: replyTo.trim() || null,
    };
    // Write-only: sent only when the administrator types a new one or removes it.
    if (removePassword) body.password = null;
    else if (password) body.password = password;
    const result = await submission.run(() => updateEmailSettings(body));
    if (result) {
      toast.success('Email settings saved');
      onSaved();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Email settings"
      description="Your organization’s mail server. Ask whoever runs your email for these details."
      footer={
        <>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="email-settings-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : 'Save settings'}
          </Button>
        </>
      }
    >
      <form id="email-settings-form" onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <DialogAlert message={submission.formError} conflict={submission.conflict} />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Send email from the CRM
        </label>
        <Field label="Mail server (SMTP host)" htmlFor="e-host" required={enabled} error={errors.host}>
          <input id="e-host" className={inputCls(errors.host)} value={host} onChange={(event) => setHost(event.target.value)} placeholder="smtp.example.com" />
        </Field>
        <Field label="Port" htmlFor="e-port" required={enabled} error={errors.port}>
          <input id="e-port" inputMode="numeric" className={inputCls(errors.port)} value={port} onChange={(event) => setPort(event.target.value)} />
        </Field>
        <Field label="Connection security" htmlFor="e-security" error={errors.security}>
          <select id="e-security" className={inputCls(errors.security)} value={security} onChange={(event) => setSecurity(event.target.value as EmailSecurityMode)}>
            {EMAIL_SECURITY_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {EMAIL_SECURITY_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="User name" htmlFor="e-user" error={errors.username} hint="Leave empty if the server needs no sign-in.">
          <input id="e-user" autoComplete="off" className={inputCls(errors.username)} value={username} onChange={(event) => setUsername(event.target.value)} />
        </Field>
        <Field
          label="Password"
          htmlFor="e-password"
          error={errors.password}
          hint={
            !settings.canStorePassword
              ? 'This server has no EMAIL_SECRET_KEY, so a password cannot be stored.'
              : settings.passwordSet
                ? 'A password is stored. Leave empty to keep it.'
                : 'Stored encrypted. It is never shown again.'
          }
        >
          <input
            id="e-password"
            type="password"
            autoComplete="new-password"
            className={inputCls(errors.password)}
            value={password}
            disabled={removePassword || !settings.canStorePassword}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {settings.passwordSet && (
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={removePassword} onChange={(event) => setRemovePassword(event.target.checked)} />
            Remove the stored password
          </label>
        )}
        <Field label="Sender name" htmlFor="e-from-name" error={errors.fromName}>
          <input id="e-from-name" className={inputCls(errors.fromName)} value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="Penta CRM" />
        </Field>
        <Field label="Sender address" htmlFor="e-from" required={enabled} error={errors.fromAddress}>
          <input id="e-from" type="email" className={inputCls(errors.fromAddress)} value={fromAddress} onChange={(event) => setFromAddress(event.target.value)} />
        </Field>
        <Field label="Reply-to address" htmlFor="e-reply" error={errors.replyTo} hint="Optional.">
          <input id="e-reply" type="email" className={inputCls(errors.replyTo)} value={replyTo} onChange={(event) => setReplyTo(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function TestEmailDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const submission = useSubmission();
  const [to, setTo] = useState('');
  const [result, setResult] = useState<EmailDeliveryDto | null>(null);

  useEffect(() => {
    if (!open) return;
    submission.reset();
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await submission.run(() => sendTestEmail(to));
    if (response) setResult(response.delivery);
  };

  return (
    <Modal
      open={open}
      onClose={result ? onDone : onClose}
      size="sm"
      title="Send a test email"
      footer={
        result ? (
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={submission.submitting}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="email-test-form" disabled={submission.submitting}>
              {submission.submitting ? 'Sending…' : 'Send test'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-2 text-[13px] text-slate-700" role="status">
          <p>
            <StatusBadge status={result.status} /> {result.status === 'sent' ? `Test message to ${result.recipientAddress}.` : 'The test message was not sent.'}
          </p>
          {result.statusDetail && <p className="text-[12.5px] text-slate-600">{result.statusDetail}</p>}
        </div>
      ) : (
        <form id="email-test-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
          <DialogAlert message={submission.formError} />
          <p className="text-[13px] text-slate-600">Uses the saved settings, even while sending is turned off.</p>
          <Field label="Send to" htmlFor="e-test-to" required error={submission.fieldErrors.to}>
            <input id="e-test-to" type="email" className={inputCls(submission.fieldErrors.to)} value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function EmailTemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: EmailTemplateDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [preview, setPreview] = useState<EmailPreviewDto | null>(null);

  useEffect(() => {
    if (!template) return;
    submission.reset();
    setSubject(template.subject);
    setBodyText(template.bodyText);
    setEnabled(template.enabled);
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.key]);

  if (!template) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const showPreview = async () => {
    const result = await submission.run(() => previewEmailTemplate(template.key, { subject, bodyText }));
    if (result) setPreview(result);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await submission.run(() =>
      updateEmailTemplate(template.key, { version: template.version, subject, bodyText, enabled }),
    );
    if (result) {
      toast.success(`${template.label} saved`);
      onSaved();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Email: ${template.label}`}
      description={template.sentWhen}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setSubject(template.defaultSubject);
              setBodyText(template.defaultBody);
              setPreview(null);
            }}
            disabled={submission.submitting}
          >
            Restore default wording
          </Button>
          <Button onClick={() => void showPreview()} disabled={submission.submitting}>
            Preview
          </Button>
          <Button onClick={onClose} disabled={submission.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="email-template-form" disabled={submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="email-template-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Send this email
        </label>
        <Field label="Subject" htmlFor="t-subject" required error={errors.subject}>
          <input id="t-subject" className={inputCls(errors.subject)} value={subject} onChange={(event) => setSubject(event.target.value)} />
        </Field>
        <Field
          label="Message"
          htmlFor="t-body"
          required
          error={errors.bodyText}
          hint={`Placeholders: ${template.placeholders.map((name) => `{{${name}}}`).join(', ')}${
            template.required.length > 0 ? `. Must include ${template.required.map((name) => `{{${name}}}`).join(', ')}.` : '.'
          } Plain text only.`}
        >
          <textarea id="t-body" rows={10} className={inputCls(errors.bodyText, 'font-mono text-[12.5px]')} value={bodyText} onChange={(event) => setBodyText(event.target.value)} />
        </Field>
        {preview && (
          <section aria-label="Preview" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">
            <p className="text-[11px] font-semibold uppercase text-slate-500">Preview with sample values</p>
            <p className="mt-1 font-semibold text-slate-900">{preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{preview.text}</pre>
          </section>
        )}
      </form>
    </Modal>
  );
}
