/**
 * CR1: invitation and reset links by email.
 *
 * While email delivery is on, creating an account or asking for a new link
 * queues an email; the single-use link is issued only when that email is
 * sent, so no readable token rests anywhere but the message. The manual
 * "copy the link" path stays available (D-CR1-1), and is the only path while
 * email is off. Every message is captured to a private folder, never sent.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, resetClock, setClock } from '../clock.js';
import { accountTokens, auditEvents, backgroundJobs, emailDeliveries, emailSettings, users } from '../db/schema.js';
import { createEmailRuntime } from '../email/runtime.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/queue.js';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  send,
  signIn,
  startSession,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

const NEW_PASSWORD = 'a password chosen from an email 2026';

describe('CR1: invitation and reset links by email', () => {
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
    for (const file of readdirSync(ctx.mailbox)) rmSync(path.join(ctx.mailbox, file));
  });

  afterEach(() => resetClock());

  async function turnEmailOn(context: TestContext = ctx, enabled = true) {
    await context.database.db
      .insert(emailSettings)
      .values({ id: 1, enabled, host: 'smtp.example.test', port: 587, fromAddress: 'crm@example.test', fromName: 'Penta CRM' });
  }

  function runJobs(context: TestContext = ctx) {
    return runDueJobs(
      context.database.db,
      createJobHandlers(context.database.db, { exportTtlHours: 24, exportMaxRows: 50_000 }, createEmailRuntime(context.config)),
    );
  }

  function captured(context: TestContext = ctx): { to: string; subject: string; text: string }[] {
    return readdirSync(context.mailbox)
      .sort()
      .map((file) => JSON.parse(readFileSync(path.join(context.mailbox, file), 'utf8')));
  }

  function linkIn(message: { text: string }): string {
    const match = /(http\S+\/set-password#token=[\w-]+)/.exec(message.text);
    if (!match) throw new Error('no link in the message');
    return match[1]!;
  }

  async function redeem(url: string, password = NEW_PASSWORD) {
    const visitor = await startSession(ctx.app);
    return visitor.agent
      .post('/api/auth/set-password')
      .set('Origin', TEST_ORIGIN)
      .set('x-csrf-token', visitor.csrfToken)
      .send({ token: url.split('#token=')[1], password });
  }

  async function signInStatus(email: string, password: string) {
    const visitor = await startSession(ctx.app);
    const response = await visitor.agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('x-csrf-token', visitor.csrfToken)
      .send({ email, password });
    return response.status;
  }

  const createPerson = (admin: SignedInClient, email = 'lamia.chowdhury@example.com') =>
    send(admin, '/api/admin/users', { fullName: 'Lamia Chowdhury', email, role: 'sales', sectionIds: [ids.sectionGA] });

  async function adminRow(admin: SignedInClient, userId: string) {
    const list = await admin.agent.get('/api/admin/users').query({ pageSize: 100 }).expect(200);
    return list.body.items.find((item: { id: string }) => item.id === userId);
  }

  // -------------------------------------------------------------------------
  it('while email is off, shows the link once, exactly as before', async () => {
    const admin = await signIn(ctx.app, emails.admin);
    const created = await createPerson(admin);
    expect(created.status).toBe(201);
    expect(created.body.delivery).toBe('manual');
    expect(created.body.link).toMatchObject({ delivery: 'manual', purpose: 'invitation' });
    expect(created.body.link.url).toMatch(/\/set-password#token=/);
    expect(await ctx.database.db.select().from(emailDeliveries)).toHaveLength(0);

    const asked = await send(admin, `/api/admin/users/${created.body.user.id}/link`, { delivery: 'email' });
    expect(asked.status).toBe(409);
    expect(asked.body.message).toMatch(/Email delivery is turned off/);
  });

  it('emails the invitation: the link is issued only when sent, and works once', async () => {
    await turnEmailOn();
    const admin = await signIn(ctx.app, emails.admin);
    const created = await createPerson(admin);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ delivery: 'email', link: null });
    const userId = created.body.user.id as string;

    // Queued, but no link exists anywhere yet.
    expect(await ctx.database.db.select().from(accountTokens).where(eq(accountTokens.userId, userId))).toHaveLength(0);
    const queuedAudit = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.entityId, userId));
    expect(queuedAudit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['account.created', 'account.section_joined', 'account.invitation_queued']),
    );
    expect(queuedAudit.map((row) => row.action)).not.toContain('account.invitation_issued');
    expect((await adminRow(admin, userId)).accountEmail).toMatchObject({ purpose: 'invitation', status: 'queued' });

    await runJobs();
    const [message] = captured();
    expect(message!.to).toBe('lamia.chowdhury@example.com');
    expect(message!.subject).toBe('Your Penta CRM account');
    expect(message!.text).toContain('Dear Lamia Chowdhury');
    expect(message!.text).toMatch(/expires on .* Bangladesh time \(UTC\+6\)/);
    const url = linkIn(message!);
    expect(url.startsWith(`${TEST_ORIGIN}/set-password#token=`)).toBe(true);

    // The readable token is in the message only: not in the delivery, the
    // job, the token table (hashed) or the audit.
    const token = url.split('#token=')[1]!;
    const [tokenRow] = await ctx.database.db.select().from(accountTokens).where(eq(accountTokens.userId, userId));
    expect(tokenRow!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    for (const rows of [
      await ctx.database.db.select().from(emailDeliveries),
      await ctx.database.db.select().from(backgroundJobs),
      await ctx.database.db.select().from(auditEvents),
    ]) {
      expect(JSON.stringify(rows)).not.toContain(token);
    }
    const [issued] = await ctx.database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, userId), eq(auditEvents.action, 'account.invitation_issued')));
    expect(issued).toMatchObject({ actorId: ids.admin, domain: 'administrative' });
    expect(issued!.afterData).toMatchObject({ delivery: 'email' });

    const row = await adminRow(admin, userId);
    expect(row).toMatchObject({ invitationPending: true, linkActive: true, accountEmail: { purpose: 'invitation', status: 'sent' } });

    expect(await signInStatus('lamia.chowdhury@example.com', NEW_PASSWORD)).toBe(401);
    expect((await redeem(url)).status).toBe(204);
    expect(await signInStatus('lamia.chowdhury@example.com', NEW_PASSWORD)).toBe(200);
    expect((await redeem(url, 'another long password 2026')).status).toBe(422);
    expect(await adminRow(admin, userId)).toMatchObject({ invitationPending: false, linkActive: false });
  });

  it('counts the expiry from sending, not from the request', async () => {
    const clock = new FixedClock('2026-10-12T09:00:00+06:00');
    setClock(clock);
    await turnEmailOn();
    const admin = await signIn(ctx.app, emails.admin);
    await createPerson(admin).expect(201);

    clock.advanceMinutes(24 * 60); // the job runs a day later
    await runJobs();
    const [token] = await ctx.database.db.select().from(accountTokens);
    expect(token!.expiresAt.toISOString()).toBe(new Date('2026-10-16T09:00:00+06:00').toISOString());
  });

  it('a resend voids the earlier emailed link', async () => {
    await turnEmailOn();
    const admin = await signIn(ctx.app, emails.admin);
    const created = await createPerson(admin).expect(201);
    await runJobs();
    const first = linkIn(captured()[0]!);

    const again = await send(admin, `/api/admin/users/${created.body.user.id}/link`, {});
    expect(again.status).toBe(201);
    expect(again.body).toEqual({ purpose: 'invitation', delivery: 'email', url: null, expiresAt: null });
    await runJobs();
    const second = linkIn(captured()[1]!);

    expect((await redeem(first)).status).toBe(422);
    expect((await redeem(second)).status).toBe(204);
  });

  it('lets an administrator copy the link instead, cancelling the queued email (D-CR1-1)', async () => {
    await turnEmailOn();
    const admin = await signIn(ctx.app, emails.admin);
    const created = await createPerson(admin).expect(201);

    const manual = await send(admin, `/api/admin/users/${created.body.user.id}/link`, { delivery: 'manual' });
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({ delivery: 'manual', purpose: 'invitation' });

    await runJobs();
    expect(captured()).toHaveLength(0);
    const [delivery] = await ctx.database.db.select().from(emailDeliveries);
    expect(delivery).toMatchObject({ status: 'suppressed', statusDetail: 'Replaced by a link an administrator copied instead.' });
    // The copied link is the one that works.
    expect((await redeem(manual.body.url)).status).toBe(204);
  });

  it('emails a reset link that ends the person’s sessions when used', async () => {
    await turnEmailOn();
    const rafiq = await signIn(ctx.app, emails.salesGA1);
    const admin = await signIn(ctx.app, emails.admin);
    const reset = await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {});
    expect(reset.body).toMatchObject({ purpose: 'password_reset', delivery: 'email' });

    await runJobs();
    const [message] = captured();
    expect(message).toMatchObject({ to: emails.salesGA1, subject: 'Reset your Penta CRM password' });
    expect((await redeem(linkIn(message!))).status).toBe(204);
    await rafiq.agent.get('/api/auth/me').expect(401);
    expect(await signInStatus(emails.salesGA1, TEST_PASSWORD)).toBe(401);
    expect(await signInStatus(emails.salesGA1, NEW_PASSWORD)).toBe(200);

    const [audit] = await ctx.database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, ids.salesGA1), eq(auditEvents.action, 'account.reset_queued')));
    expect(audit).toBeTruthy();
  });

  it('issues no link for an account deactivated, or an invitation accepted, before sending', async () => {
    await turnEmailOn();
    const admin = await signIn(ctx.app, emails.admin);
    await send(admin, `/api/admin/users/${ids.salesIS1}/link`, {}).expect(201);
    await ctx.database.db.update(users).set({ active: false }).where(eq(users.id, ids.salesIS1));

    const created = await createPerson(admin).expect(201);
    await ctx.database.db.update(users).set({ passwordHash: 'set-elsewhere' }).where(eq(users.id, created.body.user.id));

    await runJobs();
    expect(captured()).toHaveLength(0);
    const deliveries = await ctx.database.db.select().from(emailDeliveries);
    expect(deliveries.map((row) => row.statusDetail).sort()).toEqual([
      'The invitation was already accepted.',
      'The recipient account is inactive.',
    ]);
    expect(await ctx.database.db.select().from(accountTokens)).toHaveLength(0);
  });

  it('falls back to the copy-the-link path when delivery fails', async () => {
    const smtp = createTestApp({ email: { transport: 'smtp', sendTimeoutMs: 3_000 } });
    extraApps.push(smtp);
    await smtp.database.db
      .insert(emailSettings)
      .values({ id: 1, enabled: true, host: '127.0.0.1', port: 1, security: 'none', fromAddress: 'crm@example.test' });
    const admin = await signIn(smtp.app, emails.admin);
    const created = await createPerson(admin).expect(201);
    await smtp.database.db
      .update(backgroundJobs)
      .set({ maxAttempts: 1 })
      .where(eq(backgroundJobs.kind, 'email.send'));
    expect((await runJobs(smtp)).failed).toBe(1);

    const row = await adminRow(admin, created.body.user.id);
    expect(row.accountEmail).toMatchObject({ purpose: 'invitation', status: 'failed' });

    const manual = await send(admin, `/api/admin/users/${created.body.user.id}/link`, { delivery: 'manual' });
    expect(manual.status).toBe(201);
    expect((await redeem(manual.body.url)).status).toBe(204);
  });

  it('queues to nobody on a server that sends no email, and shows the link instead', async () => {
    const silent = createTestApp({ email: { transport: 'none' } });
    extraApps.push(silent);
    await turnEmailOn(silent);
    const admin = await signIn(silent.app, emails.admin);
    const created = await createPerson(admin);
    expect(created.body.delivery).toBe('manual');
    expect(created.body.link.url).toMatch(/set-password/);
  });
});
