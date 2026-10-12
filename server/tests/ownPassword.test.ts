/**
 * CR3: a signed-in account changes its own password.
 *
 * Checked through the real app and database: the current password is
 * required, the policy is the one used for invitation links, every other
 * session ends while the caller's continues under a new id and token, the
 * absolute session limit is not extended, outstanding links stop working,
 * and the audit event carries no password material.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, users } from '../db/schema.js';
import {
  CSRF_HEADER,
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

const NEW_PASSWORD = 'A-brand-new-passphrase-2026';

describe('CR3: changing one’s own password', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(async () => {
    resetClock();
    await ctx.close();
  });

  beforeEach(async () => {
    resetClock();
    await resetFixtures();
  });

  const change = (client: SignedInClient, body: unknown) => send(client, '/api/auth/password', body, null);

  async function passwordHashOf(userId: string) {
    const [row] = await ctx.database.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    return row?.hash;
  }

  async function signInStatus(email: string, password: string) {
    const client = await startSession(ctx.app);
    const response = await client.agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_HEADER, client.csrfToken)
      .send({ email, password });
    return response.status;
  }

  async function passwordAudit(userId: string) {
    return ctx.database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, userId), eq(auditEvents.action, 'account.password_changed')));
  }

  it('changes the password, keeps this session under a new token and ends every other session', async () => {
    const here = await signIn(ctx.app, emails.salesGA1);
    const elsewhere = await signIn(ctx.app, emails.salesGA1);

    const response = await change(here, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    const freshToken = response.body.csrfToken as string;
    expect(freshToken).toBeTruthy();
    expect(freshToken).not.toBe(here.csrfToken);

    // This session continues; the other one is gone on its next request.
    expect((await here.agent.get('/api/auth/me')).status).toBe(200);
    expect((await elsewhere.agent.get('/api/auth/me')).status).toBe(401);

    // The session id changed, so the old token no longer protects mutations
    // and the new one does.
    const withOldToken = await change(here, { currentPassword: NEW_PASSWORD, newPassword: `${NEW_PASSWORD}-x` });
    expect(withOldToken.status).toBe(403);
    expect(withOldToken.body.code).toBe('invalid_csrf');
    const withNewToken = await change(
      { agent: here.agent, csrfToken: freshToken },
      { currentPassword: NEW_PASSWORD, newPassword: `${NEW_PASSWORD}-x` },
    );
    expect(withNewToken.status).toBe(200);

    expect(await signInStatus(emails.salesGA1, TEST_PASSWORD)).toBe(401);
    expect(await signInStatus(emails.salesGA1, `${NEW_PASSWORD}-x`)).toBe(200);
  });

  it('is audited once per change, as an administrative event with no password material', async () => {
    const client = await signIn(ctx.app, emails.salesGA1);
    const response = await change(client, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);

    const rows = await passwordAudit(ids.salesGA1);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.actorId).toBe(ids.salesGA1);
    expect(row!.domain).toBe('administrative');
    expect(row!.opportunityId).toBeNull();
    expect(JSON.stringify([row!.beforeData, row!.afterData, row!.reason])).not.toMatch(/password|\$argon2|Synthetic|brand-new/i);
  });

  it('refuses a wrong current password with a field error and changes nothing', async () => {
    const here = await signIn(ctx.app, emails.salesGA1);
    const elsewhere = await signIn(ctx.app, emails.salesGA1);
    const before = await passwordHashOf(ids.salesGA1);

    const response = await change(here, { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD });
    expect(response.status).toBe(422);
    expect(response.body.fieldErrors).toEqual({ currentPassword: 'Your current password is not correct.' });

    expect(await passwordHashOf(ids.salesGA1)).toBe(before);
    expect((await elsewhere.agent.get('/api/auth/me')).status).toBe(200);
    expect(await passwordAudit(ids.salesGA1)).toHaveLength(0);
  });

  it('applies the password policy and refuses reusing the current password', async () => {
    const client = await signIn(ctx.app, emails.salesGA1);

    const short = await change(client, { currentPassword: TEST_PASSWORD, newPassword: 'too-short' });
    expect(short.status).toBe(422);
    expect(short.body.fieldErrors.newPassword).toMatch(/at least 12/);

    const same = await change(client, { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
    expect(same.status).toBe(422);
    expect(same.body.fieldErrors).toEqual({ newPassword: 'Choose a password different from your current one.' });

    expect(await passwordAudit(ids.salesGA1)).toHaveLength(0);
  });

  it('accepts no account identifier: it can only ever change the caller’s own password', async () => {
    const admin = await signIn(ctx.app, emails.admin);
    const before = await passwordHashOf(ids.salesGA1);

    const response = await change(admin, {
      userId: ids.salesGA1,
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(422);
    expect(await passwordHashOf(ids.salesGA1)).toBe(before);
  });

  it('is available to every role, including the administrator', async () => {
    for (const email of [emails.management, emails.leadGA, emails.salesIS1, emails.admin]) {
      const client = await signIn(ctx.app, email);
      const response = await change(client, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
      expect(response.status, email).toBe(200);
    }
  });

  it('requires a session, a CSRF token and a trusted origin', async () => {
    const anonymous = await startSession(ctx.app);
    const unauthenticated = await change(anonymous, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(unauthenticated.status).toBe(401);

    const client = await signIn(ctx.app, emails.salesGA1);
    const before = await passwordHashOf(ids.salesGA1);

    const noToken = await client.agent
      .post('/api/auth/password')
      .set('Origin', TEST_ORIGIN)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(noToken.status).toBe(403);

    const forgedOrigin = await client.agent
      .post('/api/auth/password')
      .set('Origin', 'https://attacker.example')
      .set(CSRF_HEADER, client.csrfToken)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(forgedOrigin.status).toBe(403);

    expect(await passwordHashOf(ids.salesGA1)).toBe(before);
  });

  it('spends an outstanding reset link, so it cannot overwrite the new password', async () => {
    const admin = await signIn(ctx.app, emails.admin);
    const link = await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {});
    expect(link.status).toBe(201);
    const token = new URL(link.body.url as string).hash.replace('#token=', '');

    const client = await signIn(ctx.app, emails.salesGA1);
    expect((await change(client, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(200);

    const visitor = await startSession(ctx.app);
    const redeemed = await send(visitor, '/api/auth/set-password', { token, password: 'Someone-elses-password-1' }, null);
    expect(redeemed.status).toBe(422);
    expect(await signInStatus(emails.salesGA1, NEW_PASSWORD)).toBe(200);
  });

  it('does not extend the absolute session limit', async () => {
    const clock = new FixedClock('2026-10-04T06:00:00+06:00');
    setClock(clock);
    const shortAbsolute = createTestApp({ sessionIdleMinutes: 30, sessionAbsoluteMinutes: 45 });
    try {
      const client = await signIn(shortAbsolute.app, emails.salesGA1);
      clock.advanceMinutes(20);
      const response = await send(client, '/api/auth/password', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }, null);
      expect(response.status).toBe(200);

      clock.advanceMinutes(20); // 40 minutes since sign-in
      expect((await client.agent.get('/api/auth/me')).status).toBe(200);
      clock.advanceMinutes(10); // 50: past the original 45-minute limit
      expect((await client.agent.get('/api/auth/me')).status).toBe(401);
    } finally {
      await shortAbsolute.close();
    }
  });

  it('rate-limits attempts per account, separately from sign-in', async () => {
    const limited = createTestApp({ loginRateLimit: { windowMs: 60_000, limit: 3 } });
    try {
      const client = await signIn(limited.app, emails.salesGA1);
      const attempt = () => send(client, '/api/auth/password', { currentPassword: 'wrong-guess-here', newPassword: NEW_PASSWORD }, null);
      expect((await attempt()).status).toBe(422);
      expect((await attempt()).status).toBe(422);
      expect((await attempt()).status).toBe(422);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('rate_limited');

      // Another account is not affected.
      const colleague = await signIn(limited.app, emails.salesGA2);
      const colleagueAttempt = await send(colleague, '/api/auth/password', { currentPassword: 'wrong-guess-here', newPassword: NEW_PASSWORD }, null);
      expect(colleagueAttempt.status).toBe(422);
    } finally {
      await limited.close();
    }
  });
});
