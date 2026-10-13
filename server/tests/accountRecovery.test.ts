/**
 * CR1 and CR3 completed: what an opened link says, purpose-bound links,
 * simultaneous use of one link, and "Forgot your password?".
 *
 * Every message is captured to a private folder, never sent.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, backgroundJobs, emailSettings, users } from '../db/schema.js';
import { createEmailRuntime } from '../email/runtime.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/queue.js';
import { issueAccountLink } from '../services/accountTokens.js';
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
const RESET_SUBJECT = 'Reset your Penta CRM password';

describe('CR1/CR3: link states, purpose-bound links and "Forgot your password?"', () => {
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

  function app(options: Parameters<typeof createTestApp>[0]) {
    const created = createTestApp(options);
    extraApps.push(created);
    return created;
  }

  async function turnEmailOn(context: TestContext = ctx) {
    await context.database.db
      .insert(emailSettings)
      .values({ id: 1, enabled: true, host: 'smtp.example.test', port: 587, fromAddress: 'crm@example.test', fromName: 'Penta CRM' });
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

  function tokenIn(message: { text: string }): string {
    const match = /\/set-password#token=([\w-]+)/.exec(message.text);
    if (!match) throw new Error('no link in the message');
    return match[1]!;
  }

  async function visitorPost(url: string, body: unknown, context: TestContext = ctx) {
    const visitor = await startSession(context.app);
    return visitor.agent.post(url).set('Origin', TEST_ORIGIN).set('x-csrf-token', visitor.csrfToken).send(body as object);
  }

  const linkStatus = (token: string, context: TestContext = ctx) => visitorPost('/api/auth/link-status', { token }, context);
  const redeem = (token: string, password = NEW_PASSWORD) => visitorPost('/api/auth/set-password', { token, password });
  const forgot = (email: string, context: TestContext = ctx) => visitorPost('/api/auth/forgot-password', { email }, context);

  async function signInStatus(email: string, password: string) {
    return (await visitorPost('/api/auth/login', { email, password })).status;
  }

  const createPerson = (admin: SignedInClient, email = 'lamia.chowdhury@example.com') =>
    send(admin, '/api/admin/users', { fullName: 'Lamia Chowdhury', email, role: 'sales', sectionIds: [ids.sectionGA] });

  /** A pending account with an emailed invitation; returns its id and token. */
  async function invite(email = 'lamia.chowdhury@example.com') {
    const admin = await signIn(ctx.app, emails.admin);
    const created = await createPerson(admin, email);
    expect(created.status).toBe(201);
    await runJobs();
    const message = captured().find((item) => item.to === email);
    return { admin, userId: created.body.user.id as string, token: tokenIn(message!) };
  }

  // -------------------------------------------------------------------------
  describe('opening a link', () => {
    it('says what the link can do without spending it', async () => {
      await turnEmailOn();
      const { token } = await invite();

      for (let opened = 0; opened < 3; opened += 1) {
        const status = await linkStatus(token);
        expect(status.status).toBe(200);
        expect(status.body).toEqual({ state: 'valid', purpose: 'invitation' });
      }
      expect((await redeem(token)).status).toBe(204);
      expect((await linkStatus(token)).body).toEqual({ state: 'used', purpose: 'invitation' });
    });

    it('explains an expired link, and a link replaced by a newer one', async () => {
      const clock = new FixedClock('2026-10-12T09:00:00+06:00');
      setClock(clock);
      await turnEmailOn();
      const { userId, token } = await invite();

      clock.advanceMinutes(73 * 60);
      expect((await linkStatus(token)).body).toEqual({ state: 'expired', purpose: 'invitation' });
      expect((await redeem(token)).status).toBe(422);

      // The administrator's own session has long expired; they sign in again.
      const admin = await signIn(ctx.app, emails.admin);
      await send(admin, `/api/admin/users/${userId}/link`, {}).expect(201);
      await runJobs();
      const newer = tokenIn(captured().at(-1)!);
      expect((await linkStatus(token)).body).toEqual({ state: 'used', purpose: 'invitation' });
      expect((await linkStatus(newer)).body).toEqual({ state: 'valid', purpose: 'invitation' });
    });

    it('reads as invalid for an unknown token or a disabled account, and a disabled account cannot activate', async () => {
      await turnEmailOn();
      const { userId, token } = await invite();
      expect((await linkStatus('x'.repeat(43))).body).toEqual({ state: 'invalid', purpose: null });
      expect((await linkStatus('short')).status).toBe(422);

      await ctx.database.db.update(users).set({ active: false }).where(eq(users.id, userId));
      expect((await linkStatus(token)).body).toEqual({ state: 'invalid', purpose: null });
      expect((await redeem(token)).status).toBe(422);
      const [row] = await ctx.database.db.select({ active: users.active, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
      expect(row).toEqual({ active: false, passwordHash: null });
    });
  });

  // -------------------------------------------------------------------------
  describe('using a link', () => {
    it('lets exactly one of two simultaneous submissions succeed', async () => {
      await turnEmailOn();
      const { userId, token } = await invite();

      const results = await Promise.all([redeem(token, 'first simultaneous password 2026'), redeem(token, 'second simultaneous password 2026')]);
      expect(results.map((result) => result.status).sort()).toEqual([204, 422]);
      const accepted = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, userId), eq(auditEvents.action, 'account.invitation_accepted')));
      expect(accepted).toHaveLength(1);
      const signIns = [
        await signInStatus('lamia.chowdhury@example.com', 'first simultaneous password 2026'),
        await signInStatus('lamia.chowdhury@example.com', 'second simultaneous password 2026'),
      ];
      expect(signIns.sort()).toEqual([200, 401]);
    });

    it('binds each link to its purpose: an invitation only activates, a reset only resets', async () => {
      await turnEmailOn();
      const { userId, token } = await invite();

      // A reset link for an account that was never activated does nothing.
      const reset = await ctx.database.db.transaction((tx) =>
        issueAccountLink(tx, { userId, purpose: 'password_reset', createdBy: ids.admin, appOrigin: TEST_ORIGIN }),
      );
      const resetToken = reset.url.split('#token=')[1]!;
      expect((await linkStatus(resetToken)).body).toEqual({ state: 'invalid', purpose: null });
      expect((await redeem(resetToken)).status).toBe(422);

      // An invitation for an account activated by other means has served its purpose.
      await ctx.database.db.update(users).set({ passwordHash: 'activated-elsewhere' }).where(eq(users.id, userId));
      expect((await linkStatus(token)).body).toEqual({ state: 'used', purpose: 'invitation' });
      expect((await redeem(token)).status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  describe('"Forgot your password?"', () => {
    it('answers the same for every address and emails only an active, activated account', async () => {
      await turnEmailOn();
      await invite('pending.person@example.com');
      await ctx.database.db.update(users).set({ active: false }).where(eq(users.id, ids.salesIS1));
      for (const file of readdirSync(ctx.mailbox)) rmSync(path.join(ctx.mailbox, file));

      const answers = [];
      for (const address of ['nobody@example.com', 'pending.person@example.com', emails.salesIS1, '  Rafiq.Hasan@Example.COM ']) {
        const response = await forgot(address);
        expect(response.status).toBe(202);
        answers.push(response.body);
      }
      expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
      expect(answers[0].message).toMatch(/If an active account uses that address/);

      // The job table holds digests, never the typed addresses.
      const jobs = await ctx.database.db.select().from(backgroundJobs).where(eq(backgroundJobs.kind, 'account.reset_request'));
      expect(jobs).toHaveLength(4);
      expect(JSON.stringify(jobs)).not.toMatch(/@/);

      await runJobs();
      const resets = captured().filter((message) => message.subject === RESET_SUBJECT);
      expect(resets.map((message) => message.to)).toEqual([emails.salesGA1]);
      const requested = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.action, 'account.reset_requested'));
      expect(requested).toHaveLength(1);
      expect(requested[0]).toMatchObject({ actorId: null, entityId: ids.salesGA1, domain: 'administrative' });
    });

    it('sends at most one email per window; the link resets the password and ends every session', async () => {
      const clock = new FixedClock(new Date());
      setClock(clock);
      await turnEmailOn();
      const rafiq = await signIn(ctx.app, emails.salesGA1);

      expect((await forgot(emails.salesGA1)).status).toBe(202);
      expect((await forgot(emails.salesGA1)).status).toBe(202);
      await runJobs();
      const resets = captured().filter((message) => message.subject === RESET_SUBJECT);
      expect(resets).toHaveLength(1);

      const token = tokenIn(resets[0]!);
      expect((await linkStatus(token)).body).toEqual({ state: 'valid', purpose: 'password_reset' });
      expect((await redeem(token)).status).toBe(204);
      await rafiq.agent.get('/api/auth/me').expect(401);
      expect(await signInStatus(emails.salesGA1, TEST_PASSWORD)).toBe(401);
      expect(await signInStatus(emails.salesGA1, NEW_PASSWORD)).toBe(200);

      clock.advanceMinutes(16);
      expect((await forgot(emails.salesGA1)).status).toBe(202);
      await runJobs();
      expect(captured().filter((message) => message.subject === RESET_SUBJECT)).toHaveLength(2);
    });

    it('never reactivates a disabled account', async () => {
      await turnEmailOn();
      expect((await forgot(emails.salesGA2)).status).toBe(202);
      await runJobs();
      const token = tokenIn(captured().find((message) => message.subject === RESET_SUBJECT)!);

      await ctx.database.db.update(users).set({ active: false }).where(eq(users.id, ids.salesGA2));
      expect((await redeem(token)).status).toBe(422);
      const [row] = await ctx.database.db.select({ active: users.active }).from(users).where(eq(users.id, ids.salesGA2));
      expect(row!.active).toBe(false);
      expect(await signInStatus(emails.salesGA2, NEW_PASSWORD)).toBe(401);
    });

    it('is offered, and queues anything, only while this server sends email', async () => {
      const visitor = await startSession(ctx.app);
      expect((await visitor.agent.get('/api/auth/recovery').expect(200)).body).toEqual({ selfServiceReset: false });
      expect((await forgot(emails.salesGA1)).status).toBe(202);
      expect(await ctx.database.db.select().from(backgroundJobs).where(eq(backgroundJobs.kind, 'account.reset_request'))).toHaveLength(0);

      await turnEmailOn();
      expect((await visitor.agent.get('/api/auth/recovery').expect(200)).body).toEqual({ selfServiceReset: true });

      const silent = app({ email: { transport: 'none' } });
      const silentVisitor = await startSession(silent.app);
      expect((await silentVisitor.agent.get('/api/auth/recovery').expect(200)).body).toEqual({ selfServiceReset: false });
    });
  });

  // -------------------------------------------------------------------------
  describe('rate limits', () => {
    it('limits reset requests and link checks per address, and resends per account', async () => {
      const limited = app({ loginRateLimit: { windowMs: 60_000, limit: 3 } });
      await turnEmailOn(limited);

      for (let attempt = 0; attempt < 3; attempt += 1) expect((await forgot(emails.salesGA1, limited)).status).toBe(202);
      expect((await forgot(emails.salesGA1, limited)).status).toBe(429);

      for (let attempt = 0; attempt < 3; attempt += 1) expect((await linkStatus('x'.repeat(43), limited)).status).toBe(200);
      expect((await linkStatus('x'.repeat(43), limited)).status).toBe(429);

      const admin = await signIn(limited.app, emails.admin);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {})).status).toBe(201);
      }
      expect((await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {})).status).toBe(429);
      // Another account is unaffected.
      expect((await send(admin, `/api/admin/users/${ids.salesGA2}/link`, {})).status).toBe(201);
    });
  });
});
