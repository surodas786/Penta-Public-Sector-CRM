/**
 * Plan 7.6 scenarios 1-5: authentication, session lifetime, revocation,
 * cookie and CSRF controls.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CSRF_HEADER } from '../../shared/api.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import { opportunities, users } from '../db/schema.js';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  signIn,
  startSession,
  type TestContext,
} from './helpers/harness.js';

describe('authentication and session controls', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = createTestApp();
    await resetFixtures();
  });

  afterAll(async () => {
    resetClock();
    await ctx.close();
  });

  beforeEach(async () => {
    resetClock();
    await resetFixtures();
  });

  // --- Scenario 1 ---------------------------------------------------------
  describe('scenario 1 — failed login creates no session and discloses nothing', () => {
    it('rejects a wrong password with the generic message and no session cookie', async () => {
      const { agent, csrfToken } = await startSession(ctx.app);

      const response = await agent
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, csrfToken)
        .send({ email: emails.salesGA1, password: 'definitely-not-the-password' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('unauthenticated');
      expect(response.body.message).toBe('Email address or password is incorrect.');

      // No authenticated session was established.
      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(401);
    });

    it('returns an identical response for an unknown account', async () => {
      const known = await startSession(ctx.app);
      const unknown = await startSession(ctx.app);

      const wrongPassword = await known.agent
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, known.csrfToken)
        .send({ email: emails.salesGA1, password: 'wrong-password-here' });

      const noSuchAccount = await unknown.agent
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, unknown.csrfToken)
        .send({ email: 'nobody.here@example.com', password: 'wrong-password-here' });

      expect(noSuchAccount.status).toBe(wrongPassword.status);
      expect(noSuchAccount.body.code).toBe(wrongPassword.body.code);
      expect(noSuchAccount.body.message).toBe(wrongPassword.body.message);
    });

    it('gives a deactivated account the same answer as a bad password', async () => {
      await ctx.database.db
        .update(users)
        .set({ active: false })
        .where(eq(users.id, ids.salesGA2));

      const { agent, csrfToken } = await startSession(ctx.app);
      const response = await agent
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, csrfToken)
        .send({ email: emails.salesGA2, password: TEST_PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Email address or password is incorrect.');
    });

    it('hits the configured rate limit after repeated attempts', async () => {
      const limited = createTestApp({ loginRateLimit: { windowMs: 60_000, limit: 3 } });
      try {
        const { agent, csrfToken } = await startSession(limited.app);
        const attempt = () =>
          agent
            .post('/api/auth/login')
            .set('Origin', TEST_ORIGIN)
            .set(CSRF_HEADER, csrfToken)
            .send({ email: emails.salesGA1, password: 'wrong-password-here' });

        expect((await attempt()).status).toBe(401);
        expect((await attempt()).status).toBe(401);
        expect((await attempt()).status).toBe(401);

        const blocked = await attempt();
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('rate_limited');
      } finally {
        await limited.close();
      }
    });
  });

  // --- Scenario 2 ---------------------------------------------------------
  describe('scenario 2 — every commercial endpoint rejects anonymous requests', () => {
    const commercialRoutes = [
      '/api/opportunities',
      `/api/opportunities/${ids.oppRafiq}`,
      `/api/opportunities/${ids.oppRafiq}/follow-ups`,
      `/api/opportunities/${ids.oppRafiq}/history`,
      '/api/organizations',
      '/api/lookups/opportunity-owners',
    ];

    it.each(commercialRoutes)('GET %s without a session returns 401', async (route) => {
      const response = await startSession(ctx.app).then(({ agent }) => agent.get(route));
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('unauthenticated');
    });

    it('rejects an anonymous create attempt with 401 and writes nothing', async () => {
      const before = await ctx.database.db.select({ id: opportunities.id }).from(opportunities);
      const { agent, csrfToken } = await startSession(ctx.app);

      const response = await agent
        .post('/api/opportunities')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, csrfToken)
        .set('Idempotency-Key', 'anonymous-attempt-key-1')
        .send({ name: 'Should never exist' });

      expect(response.status).toBe(401);

      const after = await ctx.database.db.select({ id: opportunities.id }).from(opportunities);
      expect(after).toHaveLength(before.length);
    });
  });

  // --- Scenario 3 ---------------------------------------------------------
  describe('scenario 3 — logout and expiry', () => {
    it('invalidates the session on logout', async () => {
      const { agent, csrfToken } = await signIn(ctx.app, emails.salesGA1);
      expect((await agent.get('/api/auth/me')).status).toBe(200);

      const logout = await agent
        .post('/api/auth/logout')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, csrfToken);
      expect(logout.status).toBe(204);

      expect((await agent.get('/api/auth/me')).status).toBe(401);
      expect((await agent.get('/api/opportunities')).status).toBe(401);
    });

    it('expires an idle session using the test clock', async () => {
      const clock = new FixedClock('2026-10-04T06:00:00+06:00');
      setClock(clock);

      const shortIdle = createTestApp({ sessionIdleMinutes: 30, sessionAbsoluteMinutes: 720 });
      try {
        const { agent } = await signIn(shortIdle.app, emails.salesGA1);
        expect((await agent.get('/api/auth/me')).status).toBe(200);

        // Inside the idle window the session is refreshed.
        clock.advanceMinutes(29);
        expect((await agent.get('/api/auth/me')).status).toBe(200);

        // Past the idle window from the last request.
        clock.advanceMinutes(31);
        expect((await agent.get('/api/auth/me')).status).toBe(401);
      } finally {
        await shortIdle.close();
      }
    });

    it('expires a session at the absolute limit even while in active use', async () => {
      const clock = new FixedClock('2026-10-04T06:00:00+06:00');
      setClock(clock);

      // Absolute limit shorter than the idle window, so activity cannot keep
      // the session alive past it.
      const shortAbsolute = createTestApp({ sessionIdleMinutes: 30, sessionAbsoluteMinutes: 45 });
      try {
        const { agent } = await signIn(shortAbsolute.app, emails.salesGA1);

        clock.advanceMinutes(20);
        expect((await agent.get('/api/auth/me')).status).toBe(200);

        clock.advanceMinutes(20); // 40 minutes total: idle refreshed, absolute not yet reached
        expect((await agent.get('/api/auth/me')).status).toBe(200);

        clock.advanceMinutes(10); // 50 minutes total: past the absolute limit
        expect((await agent.get('/api/auth/me')).status).toBe(401);
      } finally {
        await shortAbsolute.close();
      }
    });
  });

  // --- Scenario 4 ---------------------------------------------------------
  describe('scenario 4 — deactivation and privilege changes revoke live sessions', () => {
    it('rejects the next request after the account is deactivated', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      expect((await agent.get('/api/opportunities')).status).toBe(200);

      await ctx.database.db.update(users).set({ active: false }).where(eq(users.id, ids.salesGA1));

      const afterDeactivation = await agent.get('/api/opportunities');
      expect(afterDeactivation.status).toBe(401);
    });

    it('rejects the next request after a material role change bumps the session version', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      expect((await agent.get('/api/auth/me')).status).toBe(200);

      // Promotion to management, with the section cleared. Promoting to `lead`
      // would instead be refused by the one-active-lead-per-section index,
      // which is correct but is not what this test is about.
      await ctx.database.db
        .update(users)
        .set({ role: 'management', sectionId: null, managerId: null, sessionVersion: 2 })
        .where(eq(users.id, ids.salesGA1));

      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('rejects the next request after a section change bumps the session version', async () => {
      const { agent } = await signIn(ctx.app, emails.salesIS1);
      expect((await agent.get('/api/auth/me')).status).toBe(200);

      await ctx.database.db
        .update(users)
        .set({ sectionId: ids.sectionGA, managerId: ids.leadGA, sessionVersion: 2 })
        .where(eq(users.id, ids.salesIS1));

      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });
  });

  // --- Scenario 5 ---------------------------------------------------------
  describe('scenario 5 — cookie and CSRF controls', () => {
    it('issues an HttpOnly SameSite session cookie', async () => {
      const { agent, csrfToken } = await startSession(ctx.app);
      const response = await agent
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, csrfToken)
        .send({ email: emails.salesGA1, password: TEST_PASSWORD });

      const cookies = response.headers['set-cookie'] as unknown as string[];
      const sessionCookie = cookies.find((cookie) => cookie.startsWith('penta.sid='));
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie!.toLowerCase()).toContain('httponly');
      expect(sessionCookie!.toLowerCase()).toContain('samesite=strict');
    });

    it('rejects a mutation with a missing CSRF token and writes nothing', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const before = await ctx.database.db.select({ id: opportunities.id }).from(opportunities);

      const response = await agent
        .post('/api/opportunities')
        .set('Origin', TEST_ORIGIN)
        .set('Idempotency-Key', 'missing-csrf-key-000001')
        .send({ name: 'Should never exist' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('invalid_csrf');

      const after = await ctx.database.db.select({ id: opportunities.id }).from(opportunities);
      expect(after).toHaveLength(before.length);
    });

    it('rejects a mutation carrying an invalid CSRF token', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);

      const response = await agent
        .post('/api/opportunities')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, 'forged-token-value')
        .set('Idempotency-Key', 'invalid-csrf-key-000001')
        .send({ name: 'Should never exist' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('invalid_csrf');
    });

    it('rejects a mutation from an untrusted origin before the token is even checked', async () => {
      const { agent, csrfToken } = await signIn(ctx.app, emails.salesGA1);
      const before = await ctx.database.db.select({ id: opportunities.id }).from(opportunities);

      const response = await agent
        .post('/api/opportunities')
        .set('Origin', 'https://attacker.example.com')
        .set(CSRF_HEADER, csrfToken)
        .set('Idempotency-Key', 'forged-origin-key-000001')
        .send({ name: 'Should never exist' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('invalid_csrf');

      const after = await ctx.database.db.select({ id: opportunities.id }).from(opportunities);
      expect(after).toHaveLength(before.length);
    });

    it('rejects a mutation with no Origin header at all', async () => {
      const { agent, csrfToken } = await signIn(ctx.app, emails.salesGA1);

      const response = await agent
        .post('/api/auth/logout')
        .set(CSRF_HEADER, csrfToken);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('invalid_csrf');
    });
  });
});
