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
import { resetClock } from '../clock.js';
import { auditEvents, backgroundJobs, emailDeliveries, emailSettings, users } from '../db/schema.js';
import { createEmailRuntime } from '../email/runtime.js';
import { decryptSecret } from '../email/secretBox.js';
import { loadServerConfig } from '../env.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/queue.js';
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
      expect(response.body.delivery).toMatchObject({ status: 'sent', label: 'Test message', recipientAddress: 'it.desk@example.test' });
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
      expect(response.body.delivery.status).toBe('failed');
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
