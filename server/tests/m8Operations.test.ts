/**
 * Milestone 8 operational controls (NFR-003, SEC-032): the readiness probe,
 * the job health check used by monitoring, and the request log.
 */
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { createDatabase } from '../db/client.js';
import { auditEvents, backgroundJobs, users } from '../db/schema.js';
import { jobHealth } from '../jobs/handlers.js';
import { bootstrapAdministrator } from '../services/bootstrap.js';
import { CSRF_HEADER, TEST_ORIGIN, createTestApp, emails, ids, resetFixtures, signIn, startSession, type TestContext } from './helpers/harness.js';

describe('operations (M8)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = createTestApp();
    await resetFixtures();
  });
  afterAll(async () => {
    await ctx.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readiness probe', () => {
    it('reports a reachable database, and nothing else', async () => {
      const response = await request(ctx.app).get('/api/health/ready').expect(200);
      expect(response.body).toEqual({ status: 'ok', database: 'ok' });
    });

    it('answers 503 when the database cannot be reached, without saying why', async () => {
      const unreachable = createDatabase('postgres://penta_app:wrong@127.0.0.1:1/penta_crm_test');
      try {
        const app = createApp({ database: unreachable, config: { ...ctx.config, requestLog: 'off' } });
        const response = await request(app).get('/api/health/ready').expect(503);
        expect(response.body).toEqual({ status: 'unavailable', database: 'unavailable' });
        // Liveness is independent of the database.
        await request(app).get('/api/health').expect(200);
      } finally {
        await unreachable.close();
      }
    });
  });

  describe('job health check (npm run jobs:run -- --check)', () => {
    it('is unhealthy after a recent final failure or with due work waiting over an hour, and healthy otherwise', async () => {
      await resetFixtures();
      const at = new Date('2026-10-06T10:00:00Z');
      const hours = (h: number) => new Date(at.getTime() - h * 3_600_000);
      expect(await jobHealth(ctx.database.db, at)).toEqual({ healthy: true, recentFailures: 0, overdue: 0 });

      // A failure from two days ago is history, not an alert.
      await ctx.database.db.insert(backgroundJobs).values({ kind: 'test.old', status: 'failed', attempts: 5, finishedAt: hours(48), lastError: 'old' });
      // Queued work due ten minutes ago is normal.
      await ctx.database.db.insert(backgroundJobs).values({ kind: 'test.due', status: 'queued', runAfter: hours(1 / 6) });
      expect((await jobHealth(ctx.database.db, at)).healthy).toBe(true);

      await ctx.database.db.insert(backgroundJobs).values({ kind: 'test.recent', status: 'failed', attempts: 5, finishedAt: hours(2), lastError: 'boom' });
      expect(await jobHealth(ctx.database.db, at)).toEqual({ healthy: false, recentFailures: 1, overdue: 0 });

      await ctx.database.db.insert(backgroundJobs).values({ kind: 'test.stuck', status: 'queued', runAfter: hours(3) });
      expect(await jobHealth(ctx.database.db, at)).toEqual({ healthy: false, recentFailures: 1, overdue: 1 });
      await resetFixtures();
    });
  });

  describe('first administrator bootstrap (FR-001)', () => {
    const bootstrap = () =>
      bootstrapAdministrator(ctx.database.db, {
        fullName: 'First Administrator',
        email: 'First.Admin@Example.com',
        appOrigin: TEST_ORIGIN,
        requestId: 'bootstrap-test',
      });

    it('refuses while an active administrator exists', async () => {
      await resetFixtures();
      await expect(bootstrap()).rejects.toThrow(/already exists/);
    });

    it('creates one invited administrator on a deployment without one, audited, and only once', async () => {
      await resetFixtures();
      // A deployment with no administrator yet (the fixture administrator retired).
      await ctx.database.db.update(users).set({ active: false }).where(eq(users.id, ids.admin));

      const result = await bootstrap();
      const [created] = await ctx.database.db.select().from(users).where(eq(users.id, result.userId));
      expect(created).toMatchObject({ role: 'admin', active: true, email: 'first.admin@example.com', passwordHash: null, sectionId: null });
      const events = await ctx.database.db
        .select({ action: auditEvents.action, actorId: auditEvents.actorId, domain: auditEvents.domain })
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, result.userId), eq(auditEvents.requestId, 'bootstrap-test')));
      expect(events).toEqual([
        { action: 'account.created', actorId: null, domain: 'administrative' },
        { action: 'account.invitation_issued', actorId: null, domain: 'administrative' },
      ]);

      // The link works once, through the normal set-password flow.
      const token = new URL(result.invitationUrl).hash.replace('#token=', '');
      const visitor = await startSession(ctx.app);
      await visitor.agent
        .post('/api/auth/set-password')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, visitor.csrfToken)
        .send({ token, password: 'a long administrator passphrase' })
        .expect(204);
      const admin = await signIn(ctx.app, 'first.admin@example.com', 'a long administrator passphrase');
      await admin.agent.get('/api/admin/users').expect(200);

      await expect(bootstrap()).rejects.toThrow(/already exists/);
      await resetFixtures();
    });
  });

  describe('request log', () => {
    function capture() {
      const lines: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')));
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')));
      return lines;
    }

    it('records id, method, path, status and duration — never the query string, body or cookies', async () => {
      const app = createApp({ database: ctx.database, config: { ...ctx.config, requestLog: 'all' } });
      const client = await signIn(app, emails.salesGA1);
      const lines = capture();
      const response = await client.agent.get('/api/opportunities?q=Confidential%20Bid%20Name').expect(200);
      const entry = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.path === '/api/opportunities');
      expect(entry).toMatchObject({ requestId: response.headers['x-request-id'], method: 'GET', path: '/api/opportunities', status: 200 });
      expect(typeof entry?.ms).toBe('number');
      const joined = lines.join('\n');
      expect(joined).not.toMatch(/Confidential|penta\.sid|csrf/i);
    });

    it('in the default "errors" mode, says nothing about ordinary successes and refusals', async () => {
      const app = createApp({ database: ctx.database, config: { ...ctx.config, requestLog: 'errors' } });
      const lines = capture();
      await request(app).get('/api/health').expect(200);
      await request(app).get('/api/opportunities').expect(401);
      expect(lines.filter((line) => line.startsWith('{'))).toEqual([]);
    });
  });
});
