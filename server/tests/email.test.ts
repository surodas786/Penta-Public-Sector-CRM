/**
 * CR2 email foundation, and CR3's "password changed" email.
 *
 * Every app here sends through the capture transport into a private folder
 * (or deliberately through SMTP to a closed local port, or not at all). No
 * test can reach a real mail server.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EMAIL_TEMPLATE_KEYS } from '../../shared/email.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, backgroundJobs, emailDeliveries, emailSettings, users } from '../db/schema.js';
import { createEmailRuntime } from '../email/runtime.js';
import { decryptSecret } from '../email/secretBox.js';
import { loadServerConfig } from '../env.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { claimNextJob, enqueueJob, runDueJobs } from '../jobs/queue.js';
import {
  TEST_EMAIL_SECRET_KEY,
  TEST_ORIGIN,
  TEST_PASSWORD,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  send,
  signIn,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

const SMTP_PASSWORD = 'smtp-Secret-Value-2026';

const VALID_SETTINGS = {
  version: 0,
  enabled: true,
  host: 'smtp.example.test',
  port: 587,
  security: 'starttls',
  username: 'crm@example.test',
  password: SMTP_PASSWORD,
  fromName: 'Penta CRM',
  fromAddress: 'crm@example.test',
  replyTo: null,
} as const;

describe('CR2: email foundation', () => {
  let ctx: TestContext;
  const extraApps: TestContext[] = [];

  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
    for (const app of extraApps) await app.close();
  });

  beforeEach(async () => {
    resetClock();
    await resetFixtures();
    // Each test reads only the messages it caused.
    for (const file of readdirSync(ctx.mailbox)) rmSync(path.join(ctx.mailbox, file));
  });

  afterEach(() => resetClock());

  function app(options: Parameters<typeof createTestApp>[0]) {
    const created = createTestApp(options);
    extraApps.push(created);
    return created;
  }

  const put = (client: SignedInClient, url: string, body: unknown) =>
    client.agent.put(url).set('Origin', TEST_ORIGIN).set('x-csrf-token', client.csrfToken).send(body as object);

  function captured(context: TestContext): { to: string; subject: string; text: string }[] {
    return readdirSync(context.mailbox)
      .sort()
      .map((file) => JSON.parse(readFileSync(path.join(context.mailbox, file), 'utf8')) as { to: string; subject: string; text: string });
  }

  function runJobs(context: TestContext) {
    return runDueJobs(
      context.database.db,
      createJobHandlers(context.database.db, { exportTtlHours: 24, exportMaxRows: 50_000 }, createEmailRuntime(context.config)),
    );
  }

  async function configure(context: TestContext, overrides: Record<string, unknown> = {}) {
    const admin = await signIn(context.app, emails.admin);
    const response = await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, ...overrides });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return { admin, settings: response.body };
  }

  async function changePassword(context: TestContext, email: string = emails.salesGA1) {
    const client = await signIn(context.app, email);
    const response = await send(client, '/api/auth/password', { currentPassword: TEST_PASSWORD, newPassword: 'A-new-long-passphrase-2026' }, null);
    expect(response.status).toBe(200);
  }

  // -------------------------------------------------------------------------
  describe('administration only', () => {
    it('refuses every other role', async () => {
      for (const email of [emails.management, emails.leadGA, emails.salesGA1]) {
        const client = await signIn(ctx.app, email);
        await client.agent.get('/api/admin/email/settings').expect(403);
        await client.agent.get('/api/admin/email/templates').expect(403);
        await client.agent.get('/api/admin/email/deliveries').expect(403);
        expect((await put(client, '/api/admin/email/settings', VALID_SETTINGS)).status).toBe(403);
        await client.agent.get('/api/admin/email/templates/invitation/history').expect(403);
        expect((await send(client, '/api/admin/email/verify', {}, null)).status).toBe(403);
        expect((await send(client, `/api/admin/email/deliveries/${ids.salesGA1}/retry`, {}, null)).status).toBe(403);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('mail server settings', () => {
    it('starts turned off, with nothing saved', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const response = await admin.agent.get('/api/admin/email/settings').expect(200);
      expect(response.body).toMatchObject({
        enabled: false,
        host: null,
        passwordSet: false,
        transport: 'capture',
        canStorePassword: true,
        version: 0,
      });
    });

    it('stores the password encrypted and never returns or audits it', async () => {
      const { settings } = await configure(ctx);
      expect(settings).toMatchObject({ enabled: true, host: 'smtp.example.test', passwordSet: true, passwordReadable: true, version: 1 });
      expect(JSON.stringify(settings)).not.toContain(SMTP_PASSWORD);

      const [row] = await ctx.database.db.select().from(emailSettings);
      expect(row!.passwordCiphertext).toMatch(/^v1:/);
      expect(row!.passwordCiphertext).not.toContain(SMTP_PASSWORD);
      expect(decryptSecret(TEST_EMAIL_SECRET_KEY, row!.passwordCiphertext!)).toBe(SMTP_PASSWORD);
      expect(decryptSecret(Buffer.alloc(32, 9), row!.passwordCiphertext!)).toBeNull();

      const [audit] = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.action, 'email.settings_updated'));
      expect(audit).toMatchObject({ domain: 'administrative', actorId: ids.admin, opportunityId: null });
      const serialized = JSON.stringify([audit!.beforeData, audit!.afterData]);
      expect(serialized).not.toContain(SMTP_PASSWORD);
      expect(serialized).not.toMatch(/password/i);
      expect(audit!.afterData).toMatchObject({ host: 'smtp.example.test', smtpCredential: 'replaced' });
    });

    it('keeps the stored password when none is sent, and removes it on request', async () => {
      const { admin, settings } = await configure(ctx);
      const kept = await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, version: settings.version, password: undefined, host: 'mail.example.test' });
      expect(kept.status).toBe(200);
      expect(kept.body.passwordSet).toBe(true);
      const removed = await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, version: kept.body.version, password: null, host: 'mail.example.test' });
      expect(removed.body.passwordSet).toBe(false);
    });

    it('refuses incomplete, unsafe and stale settings', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const incomplete = await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, host: null, port: null, fromAddress: null });
      expect(incomplete.status).toBe(422);
      expect(Object.keys(incomplete.body.fieldErrors).sort()).toEqual(['fromAddress', 'host', 'port']);

      const injected = await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, fromName: 'Penta\r\nBcc: someone@example.com' });
      expect(injected.status).toBe(422);
      expect(injected.body.fieldErrors.fromName).toBeTruthy();

      const badHost = await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, host: 'smtp example.test' });
      expect(badHost.status).toBe(422);

      await configure(ctx);
      const stale = await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, version: 0 });
      expect(stale.status).toBe(409);
    });

    it('refuses to store a password when the server has no EMAIL_SECRET_KEY', async () => {
      const keyless = app({ email: { secretKey: null } });
      const admin = await signIn(keyless.app, emails.admin);
      const response = await put(admin, '/api/admin/email/settings', VALID_SETTINGS);
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.password).toMatch(/EMAIL_SECRET_KEY/);
      const withoutPassword = await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, password: undefined, username: null });
      expect(withoutPassword.status).toBe(200);
      expect(withoutPassword.body.canStorePassword).toBe(false);
    });

    it('is refused by the database for the application role to delete', async () => {
      await configure(ctx);
      const refused = await ctx.database.db.delete(emailSettings).then(
        () => null,
        (error: { cause?: { code?: string } }) => error.cause?.code,
      );
      expect(refused).toBe('42501');
    });
  });

  // -------------------------------------------------------------------------
  describe('templates', () => {
    it('lists every email with its default wording', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const response = await admin.agent.get('/api/admin/email/templates').expect(200);
      expect(response.body.items.map((item: { key: string }) => item.key)).toEqual([...EMAIL_TEMPLATE_KEYS]);
      for (const item of response.body.items) {
        expect(item).toMatchObject({ customized: false, enabled: true, version: 0 });
        expect(item.subject).toBe(item.defaultSubject);
      }
    });

    it('saves new wording, versioned and audited', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const saved = await put(admin, '/api/admin/email/templates/password_changed', {
        version: 0,
        subject: 'Password changed for {{recipientName}}',
        bodyText: 'Your password changed on {{changedAt}}.',
        enabled: true,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body).toMatchObject({ customized: true, version: 1, subject: 'Password changed for {{recipientName}}' });

      const stale = await put(admin, '/api/admin/email/templates/password_changed', {
        version: 0,
        subject: 'Another',
        bodyText: 'Body',
        enabled: true,
      });
      expect(stale.status).toBe(409);

      const [audit] = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.action, 'email.template_updated'));
      expect(audit!.afterData).toMatchObject({ template: 'Password changed', subject: 'Password changed for {{recipientName}}' });
    });

    it('refuses unknown placeholders, a missing link and a multi-line subject', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const unknown = await put(admin, '/api/admin/email/templates/invitation', {
        version: 0,
        subject: 'Welcome',
        bodyText: 'Use {{link}} before {{expiry}}.',
        enabled: true,
      });
      expect(unknown.status).toBe(422);
      expect(unknown.body.fieldErrors.bodyText).toMatch(/\{\{expiry\}\}/);

      const noLink = await put(admin, '/api/admin/email/templates/invitation', {
        version: 0,
        subject: 'Welcome',
        bodyText: 'Hello {{recipientName}}.',
        enabled: true,
      });
      expect(noLink.status).toBe(422);
      expect(noLink.body.fieldErrors.bodyText).toMatch(/\{\{link\}\}/);

      const header = await put(admin, '/api/admin/email/templates/invitation', {
        version: 0,
        subject: 'Welcome\nBcc: someone@example.com',
        bodyText: 'Use {{link}}.',
        enabled: true,
      });
      expect(header.status).toBe(422);
      expect(header.body.fieldErrors.subject).toBeTruthy();

      const unclosed = await put(admin, '/api/admin/email/templates/invitation', {
        version: 0,
        subject: 'Welcome',
        bodyText: 'Use {{link}} and {{recipientName',
        enabled: true,
      });
      expect(unclosed.status).toBe(422);
    });

    it('previews with synthetic sample values only', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const preview = await send(admin, '/api/admin/email/templates/follow_up_overdue/preview', {
        subject: 'Overdue for {{recipientName}}',
        bodyText: 'Due {{dueDate}}: {{link}}',
      }, null);
      expect(preview.status).toBe(200);
      expect(preview.body).toEqual({ subject: 'Overdue for Sample Person', text: `Due 15 Oct 2026: ${TEST_ORIGIN}/sample-link` });
      expect((await send(admin, '/api/admin/email/templates/nonexistent/preview', { subject: 'x', bodyText: 'y' }, null)).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('test message', () => {
    it('needs saved settings, then captures the message and logs it', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const early = await send(admin, '/api/admin/email/test', { to: 'it.desk@example.test' }, null);
      expect(early.status).toBe(422);

      await configure(ctx, { enabled: false });
      const response = await send(admin, '/api/admin/email/test', { to: 'IT.Desk@example.test' }, null);
      expect(response.status).toBe(200);
      expect(response.body.delivery).toMatchObject({ status: 'sent', captured: true, label: 'Test message', recipientAddress: 'it.desk@example.test' });
      const [message] = captured(ctx);
      expect(message).toMatchObject({ to: 'it.desk@example.test', subject: 'Penta CRM test message' });

      const log = await admin.agent.get('/api/admin/email/deliveries').expect(200);
      expect(log.body.items[0]).toMatchObject({ status: 'sent', templateKey: 'test' });
      expect(JSON.stringify(log.body)).not.toContain('This is a test message');
      const [audit] = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.action, 'email.test_sent'));
      expect(audit!.afterData).toEqual({ recipientAddress: 'it.desk@example.test', status: 'sent' });
    });

    it('reports an SMTP failure without credentials', async () => {
      const smtp = app({ email: { transport: 'smtp', sendTimeoutMs: 3_000 } });
      const { admin } = await configure(smtp, { host: '127.0.0.1', port: 1, security: 'none' });
      const response = await send(admin, '/api/admin/email/test', { to: 'it.desk@example.test' }, null);
      expect(response.status).toBe(200);
      expect(response.body.delivery).toMatchObject({ status: 'failed', captured: false });
      expect(response.body.delivery.statusDetail).toBeTruthy();
      expect(response.body.delivery.statusDetail).not.toContain(SMTP_PASSWORD);
    });
  });

  // -------------------------------------------------------------------------
  describe('the "password changed" email (CR3)', () => {
    it('is queued with the change and sent by the job, without password material', async () => {
      await configure(ctx);
      await changePassword(ctx);

      const [queued] = await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.templateKey, 'password_changed'));
      expect(queued).toMatchObject({ status: 'queued', recipientUserId: ids.salesGA1 });

      await runJobs(ctx);
      const [sent] = await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.id, queued!.id));
      expect(sent).toMatchObject({ status: 'sent', attempts: 1, recipientAddress: emails.salesGA1 });

      const [message] = captured(ctx);
      expect(message!.to).toBe(emails.salesGA1);
      expect(message!.subject).toBe('Your Penta CRM password was changed');
      expect(message!.text).toContain('Rafiq Hasan');
      expect(message!.text).toMatch(/Bangladesh time \(UTC\+6\)/);
      expect(message!.text).not.toMatch(/A-new-long-passphrase|Synthetic|\$argon2/);
      expect(message!.text).not.toMatch(/\{\{/);
    });

    it('is not queued while delivery is turned off', async () => {
      await configure(ctx, { enabled: false });
      await changePassword(ctx);
      expect(await ctx.database.db.select().from(emailDeliveries)).toHaveLength(0);
    });

    it('is suppressed, not sent, when its template is turned off or the server sends nothing', async () => {
      const { admin } = await configure(ctx);
      const template = (await admin.agent.get('/api/admin/email/templates').expect(200)).body.items.find(
        (item: { key: string }) => item.key === 'password_changed',
      );
      await put(admin, '/api/admin/email/templates/password_changed', {
        version: template.version,
        subject: template.subject,
        bodyText: template.bodyText,
        enabled: false,
      }).expect(200);
      await changePassword(ctx);
      await runJobs(ctx);
      const [suppressed] = await ctx.database.db.select().from(emailDeliveries);
      expect(suppressed).toMatchObject({ status: 'suppressed', statusDetail: 'This email is turned off in Email templates.' });
      expect(captured(ctx)).toHaveLength(0);

      const silent = app({ email: { transport: 'none' } });
      await resetFixtures();
      await configure(silent);
      await changePassword(silent, emails.salesGA2);
      await runJobs(silent);
      const [none] = await silent.database.db.select().from(emailDeliveries);
      expect(none).toMatchObject({ status: 'suppressed' });
      expect(none!.statusDetail).toMatch(/EMAIL_TRANSPORT=none/);
    });

    it('retries a failing mail server, then records the failure and shows in job health', async () => {
      const smtp = app({ email: { transport: 'smtp', sendTimeoutMs: 3_000 } });
      await configure(smtp, { host: '127.0.0.1', port: 1, security: 'none' });
      await changePassword(smtp);

      const first = await runJobs(smtp);
      expect(first.retried).toBe(1);
      const [retrying] = await smtp.database.db.select().from(emailDeliveries);
      expect(retrying).toMatchObject({ status: 'queued', attempts: 1 });
      expect(retrying!.statusDetail).toBeTruthy();

      // Use up the remaining attempts at once.
      await smtp.database.db
        .update(backgroundJobs)
        .set({ maxAttempts: 2, runAfter: new Date(0) })
        .where(and(eq(backgroundJobs.kind, 'email.send'), eq(backgroundJobs.status, 'queued')));
      const last = await runJobs(smtp);
      expect(last.failed).toBe(1);
      const [failed] = await smtp.database.db.select().from(emailDeliveries);
      expect(failed).toMatchObject({ status: 'failed', attempts: 2 });
    });

    it('is suppressed for an account deactivated before the job ran', async () => {
      await configure(ctx);
      await changePassword(ctx, emails.salesIS1);
      await ctx.database.db.update(users).set({ active: false }).where(eq(users.id, ids.salesIS1));
      await runJobs(ctx);
      const [row] = await ctx.database.db.select().from(emailDeliveries);
      expect(row).toMatchObject({ status: 'suppressed', statusDetail: 'The recipient account is inactive.' });
    });
  });

  // -------------------------------------------------------------------------
  describe('connection check', () => {
    it('needs saved settings, and contacts no server when capturing or sending nothing', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const early = await send(admin, '/api/admin/email/verify', {}, null);
      expect(early.status).toBe(422);
      expect(early.body.fieldErrors.host).toBeTruthy();

      await configure(ctx, { enabled: false });
      const captureCheck = await send(admin, '/api/admin/email/verify', {}, null);
      expect(captureCheck.status).toBe(200);
      expect(captureCheck.body).toMatchObject({ status: 'not_sending' });
      expect(captureCheck.body.detail).toMatch(/EMAIL_TRANSPORT=capture/);

      const silent = app({ email: { transport: 'none' } });
      const silentAdmin = await signIn(silent.app, emails.admin);
      const silentCheck = await send(silentAdmin, '/api/admin/email/verify', {}, null);
      expect(silentCheck.body).toMatchObject({ status: 'not_sending' });
      expect(silentCheck.body.detail).toMatch(/EMAIL_TRANSPORT=none/);
    });

    it('reports a mail server that cannot be reached, without credentials, sending and recording nothing', async () => {
      const smtp = app({ email: { transport: 'smtp', sendTimeoutMs: 3_000 } });
      const { admin } = await configure(smtp, { host: '127.0.0.1', port: 1, security: 'none' });
      const response = await send(admin, '/api/admin/email/verify', {}, null);
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('failed');
      expect(response.body.detail).toBeTruthy();
      expect(JSON.stringify(response.body)).not.toContain(SMTP_PASSWORD);
      expect(await smtp.database.db.select().from(emailDeliveries)).toHaveLength(0);
      const audits = await smtp.database.db.select({ action: auditEvents.action }).from(auditEvents);
      expect(audits.map((row) => row.action)).toEqual(['email.settings_updated']);
    });
  });

  // -------------------------------------------------------------------------
  describe('template history', () => {
    it('lists every saved version in full, newest first, from the audit', async () => {
      const { admin } = await configure(ctx);
      const url = '/api/admin/email/templates/ownership_changed/history';
      expect((await admin.agent.get(url).expect(200)).body.items).toEqual([]);

      await put(admin, '/api/admin/email/templates/ownership_changed', {
        version: 0,
        subject: 'A record is now yours',
        bodyText: 'Open it: {{link}}',
        enabled: true,
      }).expect(200);
      await put(admin, '/api/admin/email/templates/ownership_changed', {
        version: 1,
        subject: 'A record is now yours',
        bodyText: 'Open it: {{link}}',
        enabled: false,
      }).expect(200);

      const history = (await admin.agent.get(url).expect(200)).body.items;
      expect(history).toHaveLength(2);
      // The newest save changed only the switch, yet carries the full wording.
      expect(history[0]).toMatchObject({ subject: 'A record is now yours', bodyText: 'Open it: {{link}}', enabled: false, changed: ['enabled'] });
      expect(history[1]).toMatchObject({ subject: 'A record is now yours', enabled: true, changed: ['subject', 'bodyText'] });
      expect(history[0].actorName).toBeTruthy();

      // Other emails keep their own history.
      expect((await admin.agent.get('/api/admin/email/templates/invitation/history').expect(200)).body.items).toEqual([]);
      await admin.agent.get('/api/admin/email/templates/not_an_email/history').expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('controlled retry', () => {
    /** Runs the queued email jobs once, as their last attempt, against a closed port. */
    async function failQueued(context: TestContext) {
      await context.database.db
        .update(backgroundJobs)
        .set({ maxAttempts: 1, runAfter: new Date(0) })
        .where(and(eq(backgroundJobs.kind, 'email.send'), eq(backgroundJobs.status, 'queued')));
      await runJobs(context);
    }

    async function failedPasswordEmail() {
      const smtp = app({ email: { transport: 'smtp', sendTimeoutMs: 3_000 } });
      const { admin } = await configure(smtp, { host: '127.0.0.1', port: 1, security: 'none' });
      await changePassword(smtp);
      const [queued] = await smtp.database.db.select().from(emailDeliveries);
      return { smtp, admin, delivery: queued! };
    }

    const retryUrl = (id: string) => `/api/admin/email/deliveries/${id}/retry`;

    it('queues only a failed email again; the job re-checks it and sends it once', async () => {
      const { smtp, admin, delivery } = await failedPasswordEmail();
      const early = await send(admin, retryUrl(delivery.id), {}, null);
      expect(early.status).toBe(409);
      expect(early.body.message).toBe('Only a failed email can be retried.');

      await failQueued(smtp);
      const [failed] = await smtp.database.db.select().from(emailDeliveries);
      expect(failed).toMatchObject({ status: 'failed', attempts: 1 });

      const retried = await send(admin, retryUrl(delivery.id), {}, null);
      expect(retried.status).toBe(200);
      expect(retried.body.delivery).toMatchObject({ id: delivery.id, status: 'queued', statusDetail: null });
      const [audit] = await smtp.database.db.select().from(auditEvents).where(eq(auditEvents.action, 'email.delivery_retried'));
      expect(audit).toMatchObject({ domain: 'administrative', entityId: delivery.id, opportunityId: null });
      expect(audit!.afterData).toEqual({ status: 'queued', retry: 1 });

      // The mail server is fixed (the capture transport stands in for it): one message.
      await runJobs(ctx);
      const [sent] = await ctx.database.db.select().from(emailDeliveries);
      expect(sent).toMatchObject({ status: 'sent', attempts: 2 });
      expect(captured(ctx)).toHaveLength(1);
      expect((await send(admin, retryUrl(delivery.id), {}, null)).status).toBe(409);
    });

    it('stops after the retry limit', async () => {
      const { smtp, admin, delivery } = await failedPasswordEmail();
      await failQueued(smtp);
      for (let retry = 1; retry <= 3; retry += 1) {
        expect((await send(admin, retryUrl(delivery.id), {}, null)).status).toBe(200);
        await failQueued(smtp);
      }
      const [row] = await smtp.database.db.select().from(emailDeliveries);
      expect(row).toMatchObject({ status: 'failed', attempts: 4 });
      const refused = await send(admin, retryUrl(delivery.id), {}, null);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/already been retried 3 times/);
    });

    it('re-checks the recipient before sending again', async () => {
      const { smtp, admin, delivery } = await failedPasswordEmail();
      await failQueued(smtp);
      await smtp.database.db.update(users).set({ active: false }).where(eq(users.id, ids.salesGA1));
      expect((await send(admin, retryUrl(delivery.id), {}, null)).status).toBe(200);
      await runJobs(ctx);
      const [row] = await ctx.database.db.select().from(emailDeliveries);
      expect(row).toMatchObject({ status: 'suppressed', statusDetail: 'The recipient account is inactive.' });
      expect(captured(ctx)).toHaveLength(0);
    });

    it('refuses a test message, a retry while delivery is off, and unknown ids alike', async () => {
      const { smtp, admin, delivery } = await failedPasswordEmail();
      await failQueued(smtp);

      const test = await send(admin, '/api/admin/email/test', { to: 'it.desk@example.test' }, null);
      expect(test.body.delivery.status).toBe('failed');
      expect((await send(admin, retryUrl(test.body.delivery.id), {}, null)).status).toBe(409);

      const settings = (await admin.agent.get('/api/admin/email/settings').expect(200)).body;
      await put(admin, '/api/admin/email/settings', { ...VALID_SETTINGS, host: '127.0.0.1', port: 1, security: 'none', version: settings.version, enabled: false, password: undefined }).expect(200);
      const off = await send(admin, retryUrl(delivery.id), {}, null);
      expect(off.status).toBe(409);
      expect(off.body.message).toBe('Turn email delivery on before retrying.');

      const missing = await send(admin, retryUrl('00000000-0000-4000-8000-000000000000'), {}, null);
      const malformed = await send(admin, retryUrl('not-an-id'), {}, null);
      expect(missing.status).toBe(404);
      expect(malformed.status).toBe(404);
      expect({ ...missing.body, requestId: null }).toEqual({ ...malformed.body, requestId: null });
      expect(await smtp.database.db.select().from(auditEvents).where(eq(auditEvents.action, 'email.delivery_retried'))).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('job restart', () => {
    it('sends once after a worker stops mid-job, and a duplicate job sends nothing', async () => {
      const clock = new FixedClock(new Date());
      setClock(clock);
      await configure(ctx);
      await changePassword(ctx);

      // A worker claims the job and stops responding before sending.
      const claimed = await claimNextJob(ctx.database.db, 'crashed-worker');
      expect(claimed?.kind).toBe('email.send');
      await runJobs(ctx);
      expect(captured(ctx)).toHaveLength(0);

      // After the lease, another worker takes it over and sends it.
      clock.advanceMinutes(11);
      await runJobs(ctx);
      const [row] = await ctx.database.db.select().from(emailDeliveries);
      expect(row).toMatchObject({ status: 'sent', attempts: 1 });
      expect(captured(ctx)).toHaveLength(1);

      // Another job for the same delivery finds it sent and does nothing.
      await enqueueJob(ctx.database.db, { kind: 'email.send', payload: { deliveryId: row!.id } });
      await runJobs(ctx);
      expect(captured(ctx)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('configuration', () => {
    it('refuses the capture transport in production', () => {
      const saved = { ...process.env };
      try {
        Object.assign(process.env, {
          NODE_ENV: 'production',
          VITE_DEMO_MODE: 'false',
          SESSION_SECRET: 'b'.repeat(64),
          CSRF_SECRET: 'c'.repeat(64),
          DATABASE_URL: 'postgres://u:p@db:5432/penta_crm_prod',
          DOCUMENT_SCANNER: 'none',
          EMAIL_TRANSPORT: 'capture',
        });
        expect(() => loadServerConfig()).toThrow(/EMAIL_TRANSPORT=capture/);
        process.env.EMAIL_TRANSPORT = 'none';
        expect(loadServerConfig().email.transport).toBe('none');
        delete process.env.EMAIL_TRANSPORT;
        expect(loadServerConfig().email.transport).toBe('none');
        process.env.EMAIL_SECRET_KEY = 'not-hex';
        expect(() => loadServerConfig()).toThrow(/EMAIL_SECRET_KEY/);
      } finally {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, saved);
      }
    });
  });

  it('counts deliveries for the log', async () => {
    await configure(ctx);
    await changePassword(ctx);
    const [count] = await ctx.database.db.select({ value: sql<number>`count(*)::int` }).from(emailDeliveries);
    const admin = await signIn(ctx.app, emails.admin);
    const log = await admin.agent.get('/api/admin/email/deliveries').expect(200);
    expect(log.body.total).toBe(count!.value);
    expect(log.body.items[0]).toMatchObject({ label: 'Password changed', recipientName: 'Rafiq Hasan', status: 'queued' });
  });
});
