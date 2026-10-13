/**
 * Settings → Mail Server (CR2): the System Administrator's page for the mail
 * server the CRM sends through. Nothing about the mail server is fixed in
 * code: every value here is saved in `email_settings` (migration 0009) by the
 * same endpoint, rules and audit as the Email delivery panel on the
 * Administration page.
 *
 * The SMTP password is write-only: the page shows whether one is stored,
 * never what it is. Whether this deployment may send at all
 * (EMAIL_TRANSPORT) and the key that encrypts the password
 * (EMAIL_SECRET_KEY) stay in the server's environment by design, so a
 * database change alone can never turn real sending on or expose the key.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2Icon, MailIcon, PlugZapIcon, RotateCcwIcon, SaveIcon, SendIcon, ServerIcon, ShieldIcon } from 'lucide-react';

import type { EmailConnectionCheckDto, EmailSettingsDto } from '../../../shared/api.js';
import { EMAIL_SECURITY_LABELS, EMAIL_SECURITY_MODES, type EmailSecurityMode } from '../../../shared/email.js';
import { checkEmailConnection, fetchEmailSettings, updateEmailSettings } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { PageContainer, PageHeader, Panel } from '../../components/ui/Layout';
import { TestEmailDialog } from '../components/EmailAdministration.js';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import { DialogAlert } from '../components/FormBits.js';
import { formatInstant } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';
import { useSubmission } from '../useSubmission.js';

const TRANSPORT_NOTES: Record<EmailSettingsDto['transport'], { label: string; detail: string }> = {
  none: {
    label: 'Sending disabled on this server',
    detail: 'EMAIL_TRANSPORT=none: settings can be prepared and saved, but nothing is sent until whoever runs the server allows it.',
  },
  capture: {
    label: 'Development capture',
    detail: 'EMAIL_TRANSPORT=capture: messages are written to a local folder and never leave the machine.',
  },
  smtp: { label: 'Sending through this mail server', detail: 'EMAIL_TRANSPORT=smtp: messages go to the server below.' },
};

interface FormState {
  enabled: boolean;
  host: string;
  port: string;
  security: EmailSecurityMode;
  username: string;
  password: string;
  removePassword: boolean;
  fromName: string;
  fromAddress: string;
  replyTo: string;
}

function toForm(settings: EmailSettingsDto): FormState {
  return {
    enabled: settings.enabled,
    host: settings.host ?? '',
    port: settings.port ? String(settings.port) : '587',
    security: settings.security,
    username: settings.username ?? '',
    password: '',
    removePassword: false,
    fromName: settings.fromName ?? '',
    fromAddress: settings.fromAddress ?? '',
    replyTo: settings.replyTo ?? '',
  };
}

function Badge({ tone, children }: { tone: 'on' | 'off' | 'warn'; children: React.ReactNode }) {
  const styles = {
    on: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    off: 'bg-slate-100 text-slate-600 ring-slate-400/20',
    warn: 'bg-red-50 text-red-700 ring-red-600/20',
  } as const;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${styles[tone]}`}>{children}</span>;
}

export function MailServerSettingsPage() {
  const settings = useApiResource(useCallback((signal: AbortSignal) => fetchEmailSettings(signal), []), []);
  const current = settings.data;

  return (
    <PageContainer>
      <PageHeader
        title="Mail Server"
        subtitle="Settings · The server the CRM uses for invitations, password emails and notifications. Saved in the database; no value is fixed in code."
      />
      {settings.error ? (
        <ErrorPanel error={settings.error} onRetry={settings.reload} />
      ) : !current ? (
        <LoadingPanel label="Loading mail server settings…" />
      ) : (
        <MailServerForm settings={current} onSaved={settings.reload} />
      )}
    </PageContainer>
  );
}

function MailServerForm({ settings, onSaved }: { settings: EmailSettingsDto; onSaved: () => void }) {
  const submission = useSubmission();
  const errors = submission.fieldErrors;
  const [form, setForm] = useState<FormState>(() => toForm(settings));
  const [testing, setTesting] = useState(false);
  const connection = useSubmission();
  const [connectionResult, setConnectionResult] = useState<EmailConnectionCheckDto | null>(null);

  // A fresh copy from the server (after saving) replaces the form.
  useEffect(() => {
    setForm(toForm(settings));
  }, [settings]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  const saved = toForm(settings);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body: Record<string, unknown> = {
      version: settings.version,
      enabled: form.enabled,
      host: form.host.trim() || null,
      port: form.port.trim() ? Number(form.port) : null,
      security: form.security,
      username: form.username.trim() || null,
      fromName: form.fromName.trim() || null,
      fromAddress: form.fromAddress.trim() || null,
      replyTo: form.replyTo.trim() || null,
    };
    // Write-only: sent only when a new one is typed, or removal is asked for.
    if (form.removePassword) body.password = null;
    else if (form.password) body.password = form.password;
    const result = await submission.run(() => updateEmailSettings(body));
    if (result) {
      toast.success('Mail server settings saved');
      setConnectionResult(null);
      onSaved();
    }
  };

  const checkConnection = async () => {
    setConnectionResult(null);
    const result = await connection.run(() => checkEmailConnection());
    if (result) setConnectionResult(result);
  };

  const transport = TRANSPORT_NOTES[settings.transport];
  const passwordHint = !settings.canStorePassword
    ? 'This server has no EMAIL_SECRET_KEY, so a password cannot be stored. Ask whoever runs the server to set one.'
    : settings.passwordSet
      ? 'A password is stored. Leave empty to keep it.'
      : 'Stored encrypted. It is never shown again or written to any log.';

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <form id="mail-server-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 lg:col-span-2" noValidate>
        <DialogAlert message={submission.formError} conflict={submission.conflict} />

        <Panel title="Delivery" subtitle="While off, nothing is queued or sent. Settings can still be saved and checked.">
          <label className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
            <input type="checkbox" checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />
            Send email from the CRM
          </label>
        </Panel>

        <Panel title="Server" subtitle="Ask whoever runs your organization’s email for these details.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Mail server (SMTP host)" htmlFor="ms-host" required={form.enabled} error={errors.host}>
              <input id="ms-host" className={inputCls(errors.host)} value={form.host} onChange={(event) => set('host', event.target.value)} placeholder="smtp.example.com" />
            </Field>
            <Field label="Port" htmlFor="ms-port" required={form.enabled} error={errors.port} hint="Usually 587 (STARTTLS) or 465 (TLS).">
              <input id="ms-port" inputMode="numeric" className={inputCls(errors.port)} value={form.port} onChange={(event) => set('port', event.target.value)} />
            </Field>
            <Field label="Connection security" htmlFor="ms-security" error={errors.security} className="sm:col-span-2">
              <select id="ms-security" className={inputCls(errors.security)} value={form.security} onChange={(event) => set('security', event.target.value as EmailSecurityMode)}>
                {EMAIL_SECURITY_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {EMAIL_SECURITY_LABELS[mode]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Panel>

        <Panel title="Sign-in" subtitle="Leave both empty if the server needs no sign-in.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="User name" htmlFor="ms-user" error={errors.username}>
              <input id="ms-user" autoComplete="off" className={inputCls(errors.username)} value={form.username} onChange={(event) => set('username', event.target.value)} />
            </Field>
            <Field label="Password" htmlFor="ms-password" error={errors.password} hint={passwordHint}>
              <input
                id="ms-password"
                type="password"
                autoComplete="new-password"
                className={inputCls(errors.password)}
                value={form.password}
                disabled={!settings.canStorePassword || form.removePassword}
                onChange={(event) => set('password', event.target.value)}
              />
            </Field>
            {settings.passwordSet && (
              <label className="flex items-center gap-2 text-[13px] text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.removePassword}
                  onChange={(event) => setForm((previous) => ({ ...previous, removePassword: event.target.checked, password: '' }))}
                />
                Remove the stored password
              </label>
            )}
          </div>
        </Panel>

        <Panel title="Sender" subtitle="How messages from the CRM are addressed.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Sender name" htmlFor="ms-from-name" error={errors.fromName}>
              <input id="ms-from-name" className={inputCls(errors.fromName)} value={form.fromName} onChange={(event) => set('fromName', event.target.value)} placeholder="Penta CRM" />
            </Field>
            <Field label="Sender address" htmlFor="ms-from-address" required={form.enabled} error={errors.fromAddress}>
              <input id="ms-from-address" type="email" className={inputCls(errors.fromAddress)} value={form.fromAddress} onChange={(event) => set('fromAddress', event.target.value)} placeholder="crm@example.com" />
            </Field>
            <Field label="Reply-to address" htmlFor="ms-reply-to" error={errors.replyTo} hint="Optional. Where replies go." className="sm:col-span-2">
              <input id="ms-reply-to" type="email" className={inputCls(errors.replyTo)} value={form.replyTo} onChange={(event) => set('replyTo', event.target.value)} />
            </Field>
          </div>
        </Panel>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-[12px] text-slate-500">Unsaved changes</span>}
          <Button icon={<RotateCcwIcon className="h-3.5 w-3.5" />} onClick={() => setForm(saved)} disabled={!dirty || submission.submitting}>
            Discard changes
          </Button>
          <Button variant="primary" type="submit" icon={<SaveIcon className="h-3.5 w-3.5" />} disabled={!dirty || submission.submitting || submission.conflict}>
            {submission.submitting ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-navy px-4 py-3.5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#9FB4D1]">Email delivery</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-extrabold">
            <MailIcon className="h-5 w-5" aria-hidden="true" />
            {settings.enabled ? 'On' : 'Off'}
          </p>
          <p className="mt-1 text-[12px] text-[#9FB4D1]">{transport.label}</p>
        </div>

        <Panel title="Status">
          <dl className="flex flex-col gap-2.5 text-[13px] text-slate-700">
            <div>
              <dt className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                <ServerIcon className="h-3.5 w-3.5" aria-hidden="true" /> This server
              </dt>
              <dd>{transport.detail}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                <ShieldIcon className="h-3.5 w-3.5" aria-hidden="true" /> Password
              </dt>
              <dd className="flex flex-wrap items-center gap-2">
                {settings.passwordSet ? (
                  settings.passwordReadable ? (
                    <Badge tone="on">Stored, encrypted</Badge>
                  ) : (
                    <Badge tone="warn">Cannot be decrypted: enter it again</Badge>
                  )
                ) : (
                  <Badge tone="off">None stored</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-slate-500">Last changed</dt>
              <dd>
                {settings.updatedAt
                  ? `${formatInstant(settings.updatedAt)}${settings.updatedByName ? ` by ${settings.updatedByName}` : ''}`
                  : 'Never saved'}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Check the settings" subtitle="Uses the saved settings. Save changes first.">
          <div className="flex flex-col gap-2">
            <Button
              icon={<PlugZapIcon className="h-3.5 w-3.5" />}
              onClick={() => void checkConnection()}
              disabled={!settings.host || connection.submitting}
            >
              {connection.submitting ? 'Checking…' : 'Check connection'}
            </Button>
            <Button icon={<SendIcon className="h-3.5 w-3.5" />} onClick={() => setTesting(true)} disabled={!settings.host}>
              Send test email
            </Button>
            {connectionResult && (
              <p role="status" className="flex items-start gap-2 text-[12.5px] text-slate-700">
                {connectionResult.status === 'ok' && <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />}
                <span>
                  <Badge tone={connectionResult.status === 'ok' ? 'on' : connectionResult.status === 'failed' ? 'warn' : 'off'}>
                    {connectionResult.status === 'ok' ? 'Connected' : connectionResult.status === 'failed' ? 'Connection failed' : 'Not checked'}
                  </Badge>{' '}
                  {connectionResult.detail}
                </span>
              </p>
            )}
            {connection.formError && (
              <p role="alert" className="text-[12.5px] font-medium text-red-700">
                {connection.fieldErrors.host ?? connection.formError}
              </p>
            )}
          </div>
        </Panel>
      </div>

      <TestEmailDialog open={testing} onClose={() => setTesting(false)} onDone={() => setTesting(false)} />
    </div>
  );
}
