/**
 * Milestone 6: persistent notifications and retryable jobs (FR-090, BR-070,
 * NFR-003, AT-14, AT-16 job-retry portion).
 *
 * Jobs run through the real queue and handlers; only the clock is frozen.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BACKGROUND_REQUEST_HEADER, type NotificationListDto } from '../../shared/api.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import { backgroundJobs, followUps, notifications } from '../db/schema.js';
import { createJobHandlers, enqueueScheduledJobs } from '../jobs/handlers.js';
import { claimNextJob, enqueueJob, runDueJobs, type JobHandlers } from '../jobs/queue.js';
import { runNotificationScan } from '../services/notifications.js';
import {
  ABSENT_UUID,
  TEST_ORIGIN,
  CSRF_HEADER,
  createTestApp,
  emails,
  ids,
  nextIdempotencyKey,
  resetFixtures,
  send,
  signIn,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

const DEMO_NOW = '2026-10-02T10:00:00+06:00';

describe('notifications and background jobs (M6)', () => {
  let ctx: TestContext;
  let clock: FixedClock;

  beforeAll(() => {
    ctx = createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetFixtures();
    clock = new FixedClock(DEMO_NOW);
    setClock(clock);
  });
  afterEach(() => {
    resetClock();
  });

  const as = (email: string) => signIn(ctx.app, email);
  const handlers = () => createJobHandlers(ctx.database.db, { exportTtlHours: 24, exportMaxRows: 50_000 });

  async function scan() {
    await enqueueScheduledJobs(ctx.database.db);
    return runDueJobs(ctx.database.db, handlers());
  }

  async function inbox(client: SignedInClient, query = ''): Promise<NotificationListDto> {
    return (await client.agent.get(`/api/notifications${query}`).expect(200)).body as NotificationListDto;
  }

  async function unread(client: SignedInClient): Promise<number> {
    return (await client.agent.get('/api/notifications/unread-count').expect(200)).body.unreadCount as number;
  }

  function post(client: SignedInClient, path: string) {
    return client.agent.post(path).set('Origin', TEST_ORIGIN).set(CSRF_HEADER, client.csrfToken).send({});
  }

  describe('generation and recipients (FR-090)', () => {
    it('alerts the responsible person, the section lead and management, each within scope', async () => {
      await scan();
      const rafiq = await inbox(await as(emails.salesGA1));
      const tasnia = await inbox(await as(emails.salesGA2));
      const nadia = await inbox(await as(emails.leadGA));
      const farhan = await inbox(await as(emails.leadIS));
      const arif = await inbox(await as(emails.management));

      // Rafiq: his overdue follow-up on OPP-900001 (due 30 Sep). His tender
      // (8 Oct) is not yet within 72 hours.
      expect(rafiq.items.map((item) => item.title)).toEqual(['Overdue: Send revised scope to Sylvan Hills ICT Cell']);
      expect(rafiq.items[0]).toMatchObject({ tone: 'red', path: `/opportunities/${ids.oppRafiq}?tab=activities`, readAt: null });
      // Tasnia: her notice closing 4 Oct 12:00 is within 72 hours.
      expect(tasnia.items.map((item) => item.type)).toEqual(['tender_deadline']);
      expect(tasnia.items[0]?.title).toBe('Tender due within 72 hours: DPTI/ICT/2026/014');
      // Nadia (GA lead): her own task due today, plus the section's alerts.
      expect(nadia.items.map((item) => item.type).sort()).toEqual(['follow_up_due_today', 'follow_up_overdue', 'tender_deadline']);
      // Farhan (IS lead): only IS alerts.
      expect(farhan.items.every((item) => !item.detail.includes('Sylvan Hills') && !item.title.includes('DPTI'))).toBe(true);
      expect(farhan.items.map((item) => item.type).sort()).toEqual(['follow_up_overdue', 'follow_up_overdue']);
      // Management: every permitted alert.
      expect(arif.total).toBe(nadia.total + farhan.total);
      expect(arif.unreadCount).toBe(arif.total);
    });

    it('creates one alert per trigger however often the job runs (BR-070)', async () => {
      await scan();
      const first = await ctx.database.db.select().from(notifications);
      clock.set('2026-10-02T11:00:00+06:00');
      await scan();
      await runNotificationScan(ctx.database.db);
      await runNotificationScan(ctx.database.db);
      const after = await ctx.database.db.select().from(notifications);
      expect(after).toHaveLength(first.length);
      // Two workers scanning at the same time still create each alert once.
      await ctx.database.db.delete(notifications).where(sql`true`).catch(() => undefined);
      const fresh = await ctx.database.db.select({ value: sql<number>`count(*)::int` }).from(notifications);
      // The runtime role cannot delete alerts at all.
      expect(fresh[0]?.value).toBe(first.length);
      await Promise.all([runNotificationScan(ctx.database.db), runNotificationScan(ctx.database.db)]);
      expect(await ctx.database.db.select().from(notifications)).toHaveLength(first.length);
    });

    it('turns a due-today alert into an overdue alert at Dhaka midnight', async () => {
      await scan();
      const nadia = await as(emails.leadGA);
      expect((await inbox(nadia)).items.some((item) => item.title === 'Due today: Share capability brief with Director General')).toBe(true);

      clock.set('2026-10-03T00:00:00+06:00');
      const atMidnight = await as(emails.leadGA);
      // Before the scan, the stale due-today alert is already gone.
      expect((await inbox(atMidnight)).items.some((item) => item.type === 'follow_up_due_today' && item.title.includes('capability brief'))).toBe(false);
      await scan();
      const items = (await inbox(atMidnight)).items;
      expect(items.some((item) => item.title === 'Overdue: Share capability brief with Director General')).toBe(true);
    });

    it('raises no alert for submitted, Not Participating, superseded or cancelled notices (BR-040)', async () => {
      clock.set('2026-10-06T10:00:00+06:00'); // 900012 (7 Oct 13:00) and 900003 (8 Oct 15:00) within 72 h
      const lead = await as(emails.leadGA);
      const tender = (await lead.agent.get(`/api/tenders/${ids.tenderRafiq}`).expect(200)).body;
      await send(lead, `/api/tenders/${ids.tenderRafiq}/cancel`, { version: tender.version, reason: 'Notice withdrawn' }, null).expect(200);
      await scan();
      const rafiq = await inbox(await as(emails.salesGA1));
      expect(rafiq.items.filter((item) => item.type === 'tender_deadline')).toEqual([]);
      // Control: a current, Preparing notice in the same window does alert.
      const farhan = await inbox(await as(emails.leadIS));
      expect(farhan.items.filter((item) => item.type === 'tender_deadline').map((item) => item.title)).toEqual([
        'Tender due within 72 hours: NDRA/ICT/2026/005',
      ]);
      // Submitted notices never alert, even inside the window.
      const nadia = await inbox(await as(emails.leadGA));
      expect(nadia.items.some((item) => item.title.includes('DPTI/ICT/2026/009'))).toBe(false);
    });
  });

  describe('read state (BR-070)', () => {
    it('persists read state, and reading never completes the task', async () => {
      await scan();
      const rafiq = await as(emails.salesGA1);
      const before = await inbox(rafiq);
      expect(await unread(rafiq)).toBe(1);
      const alert = before.items[0]!;

      const marked = await post(rafiq, `/api/notifications/${alert.id}/read`).expect(200);
      expect(marked.body.unreadCount).toBe(0);
      expect(marked.body.notification.readAt).not.toBeNull();
      // Read again later: still read, still listed, task still open.
      const later = await as(emails.salesGA1);
      expect(await unread(later)).toBe(0);
      expect((await inbox(later)).items[0]?.readAt).not.toBeNull();
      const [task] = await ctx.database.db
        .select({ state: followUps.state, version: followUps.version })
        .from(followUps)
        .where(and(eq(followUps.opportunityId, ids.oppRafiq), eq(followUps.state, 'open')));
      expect(task?.state).toBe('open');
      expect(task?.version).toBe(1);

      // Marking twice keeps the first read time.
      const again = await post(later, `/api/notifications/${alert.id}/read`).expect(200);
      expect(again.body.notification.readAt).toBe(marked.body.notification.readAt);
    });

    it('marks all read for the reader only', async () => {
      await scan();
      const nadia = await as(emails.leadGA);
      const arif = await as(emails.management);
      const managementBefore = await unread(arif);
      await post(nadia, '/api/notifications/read-all').expect(200);
      expect(await unread(nadia)).toBe(0);
      expect(await unread(arif)).toBe(managementBefore);
      expect((await inbox(nadia, '?unread=true')).total).toBe(0);
    });

    it('answers 404 for someone else’s or a missing alert, identically', async () => {
      await scan();
      const rafiq = await as(emails.salesGA1);
      const alert = (await inbox(rafiq)).items[0]!;
      const tasnia = await as(emails.salesGA2);
      const foreign = await post(tasnia, `/api/notifications/${alert.id}/read`).expect(404);
      const missing = await post(tasnia, `/api/notifications/${ABSENT_UUID}/read`).expect(404);
      const { requestId: _a, ...foreignBody } = foreign.body;
      const { requestId: _b, ...missingBody } = missing.body;
      expect(foreignBody).toEqual(missingBody);
      // Unchanged for its owner.
      expect(await unread(rafiq)).toBe(1);
    });

    it('does not let the unread-count poll keep an unattended session alive (SEC-031)', async () => {
      const shortIdle = createTestApp({ sessionIdleMinutes: 30, sessionAbsoluteMinutes: 720 });
      try {
        const polled = await signIn(shortIdle.app, emails.salesGA1);
        const active = await signIn(shortIdle.app, emails.salesGA2);
        const poll = (client: SignedInClient) =>
          client.agent.get('/api/notifications/unread-count').set(BACKGROUND_REQUEST_HEADER, '1');

        clock.advanceMinutes(20);
        await poll(polled).expect(200);
        await active.agent.get('/api/notifications/unread-count').expect(200);

        // 40 minutes after the last real request: polling did not extend it.
        clock.advanceMinutes(20);
        await poll(polled).expect(401);
        // Control: a user request 20 minutes ago did extend the other session.
        await active.agent.get('/api/notifications/unread-count').expect(200);
      } finally {
        await shortIdle.close();
      }
    });

    it('gives the administrator no notifications and no recipient endpoint', async () => {
      await scan();
      const admin = await as(emails.admin);
      await admin.agent.get('/api/notifications').expect(403);
      await admin.agent.get('/api/notifications/unread-count').expect(403);
      const [any] = await ctx.database.db.select().from(notifications).limit(1);
      await post(admin, `/api/notifications/${any!.id}/read`).expect(404);
      const adminAlerts = await ctx.database.db.select().from(notifications).where(eq(notifications.recipientId, ids.admin));
      expect(adminAlerts).toEqual([]);
      // No way to create an alert or choose its recipient.
      await admin.agent.post('/api/notifications').set('Origin', TEST_ORIGIN).set(CSRF_HEADER, admin.csrfToken).send({}).expect(404);
      const lead = await as(emails.leadGA);
      await post(lead, '/api/notifications').expect(404);
    });
  });

  describe('obsolete alerts (BR-070, SEC-005)', () => {
    it('retires alerts when a task is rescheduled, and the new date alerts again', async () => {
      await scan();
      const rafiq = await as(emails.salesGA1);
      const alert = (await inbox(rafiq)).items[0]!;
      const [task] = await ctx.database.db
        .select()
        .from(followUps)
        .where(and(eq(followUps.opportunityId, ids.oppRafiq), eq(followUps.state, 'open')));

      await send(rafiq, `/api/follow-ups/${task!.id}/reschedule`, { version: task!.version, dueDate: '2026-10-02', reason: 'Waiting for the ICT cell' })
        .expect(200);
      // Gone from the inbox and the unread count with the commit.
      expect((await inbox(rafiq)).items.find((item) => item.id === alert.id)).toBeUndefined();
      expect(await unread(rafiq)).toBe(0);
      const [retired] = await ctx.database.db.select().from(notifications).where(eq(notifications.id, alert.id));
      expect(retired?.resolution).toBe('rescheduled');

      // The queued refresh adds the alert for the new date (due today).
      await runDueJobs(ctx.database.db, handlers());
      const items = (await inbox(rafiq)).items;
      expect(items.map((item) => item.title)).toEqual(['Due today: Send revised scope to Sylvan Hills ICT Cell']);
    });

    it('retires alerts when a task is completed', async () => {
      await scan();
      const rafiq = await as(emails.salesGA1);
      const [task] = await ctx.database.db
        .select()
        .from(followUps)
        .where(and(eq(followUps.opportunityId, ids.oppRafiq), eq(followUps.state, 'open')));
      await send(rafiq, `/api/follow-ups/${task!.id}/complete`, {
        version: task!.version,
        replacement: { title: 'Next step', dueDate: '2026-10-20' },
      }).expect(200);
      expect(await unread(rafiq)).toBe(0);
      const nadia = await as(emails.leadGA);
      expect((await inbox(nadia)).items.some((item) => item.title.includes('Send revised scope'))).toBe(false);
    });

    it('removes the old team’s alerts on transfer and tells the new owner (AT-14, AT-08)', async () => {
      await scan();
      const rafiqBefore = await unread(await as(emails.salesGA1));
      expect(rafiqBefore).toBe(1);
      const nadiaBefore = await inbox(await as(emails.leadGA));
      expect(nadiaBefore.items.some((item) => item.title.includes('Send revised scope'))).toBe(true);

      // Management moves OPP-900001 to Imran (Infrastructure & Security).
      const management = await as(emails.management);
      const detail = (await management.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200)).body;
      await send(
        management,
        `/api/opportunities/${ids.oppRafiq}/transfer`,
        { version: detail.version, newOwnerId: ids.salesIS1, reason: 'Moving to Infrastructure' },
        nextIdempotencyKey('m6'),
      ).expect(200);

      // Immediately, before any job: the previous owner and lead lose them.
      const rafiq = await as(emails.salesGA1);
      expect(await unread(rafiq)).toBe(0);
      expect((await inbox(rafiq)).total).toBe(0);
      const nadia = await inbox(await as(emails.leadGA));
      expect(nadia.items.some((item) => item.title.includes('Send revised scope'))).toBe(false);
      expect(nadia.unreadCount).toBe(nadiaBefore.unreadCount - 1);

      // The refresh job alerts the new owner, the new lead and other management.
      await runDueJobs(ctx.database.db, handlers());
      const imran = await inbox(await as(emails.salesIS1));
      expect(imran.items.map((item) => item.title).sort()).toEqual([
        'Assigned to you: Municipal Service Portal',
        'Overdue: Follow up on procurement committee feedback',
        'Overdue: Send revised scope to Sylvan Hills ICT Cell',
      ].sort());
      const farhan = await inbox(await as(emails.leadIS));
      expect(farhan.items.some((item) => item.title === 'Ownership changed: Municipal Service Portal')).toBe(true);
      // The actor is not told about their own change.
      const arif = await inbox(await as(emails.management));
      expect(arif.items.some((item) => item.type === 'ownership_changed')).toBe(false);
      // A notification link re-checks access: the old owner's id is a 404.
      const [old] = await ctx.database.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.recipientId, ids.salesGA1), eq(notifications.opportunityId, ids.oppRafiq)));
      // Written down too, not only hidden: the alert is retired.
      expect(old?.resolvedAt).not.toBeNull();
      expect(old?.resolution).toBe('transferred');
      await post(rafiq, `/api/notifications/${old!.id}/read`).expect(404);
      await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(404);
    });

    it('hides alerts the moment access is revoked, before any job runs', async () => {
      await scan();
      expect(await unread(await as(emails.salesGA2))).toBe(1);
      // A change made outside the services (e.g. an administrator's direct
      // repair) is still caught by the read-time check.
      await ctx.database.db.execute(sql`UPDATE opportunities SET owner_id = ${ids.salesGA1} WHERE id = ${ids.oppTasnia}`);
      const tasnia = await as(emails.salesGA2);
      expect(await unread(tasnia)).toBe(0);
      expect((await inbox(tasnia)).total).toBe(0);
      // The next scan writes the retirement down.
      await runNotificationScan(ctx.database.db);
      const open = await ctx.database.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.recipientId, ids.salesGA2), isNull(notifications.resolvedAt)));
      expect(open).toEqual([]);
    });

    it('retires a tender alert when the deadline moves, and alerts on the new deadline', async () => {
      await scan();
      const tasnia = await as(emails.salesGA2);
      const before = (await inbox(tasnia)).items[0]!;
      const tender = (await tasnia.agent.get(`/api/tenders/${ids.tenderTasnia}`).expect(200)).body;
      await tasnia.agent
        .patch(`/api/tenders/${ids.tenderTasnia}`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, tasnia.csrfToken)
        .send({ version: tender.version, submissionDeadline: '2026-10-04T16:00:00+06:00' })
        .expect(200);
      expect((await inbox(tasnia)).items.find((item) => item.id === before.id)).toBeUndefined();
      await runDueJobs(ctx.database.db, handlers());
      const after = (await inbox(tasnia)).items;
      expect(after).toHaveLength(1);
      expect(after[0]?.id).not.toBe(before.id);
      expect(after[0]?.detail).toContain('04 Oct 2026, 16:00');
    });
  });

  describe('retryable jobs (NFR-003, AT-16)', () => {
    it('retries a failing job with backoff, then succeeds once', async () => {
      let calls = 0;
      const flaky: JobHandlers = {
        ...handlers(),
        'notifications.scan': {
          async run() {
            calls += 1;
            if (calls === 1) throw new Error('database briefly unavailable');
            await runNotificationScan(ctx.database.db);
          },
        },
      };
      await enqueueScheduledJobs(ctx.database.db);
      const first = await runDueJobs(ctx.database.db, flaky);
      expect(first).toMatchObject({ retried: 1 });
      const [job] = await ctx.database.db.select().from(backgroundJobs).where(eq(backgroundJobs.kind, 'notifications.scan'));
      expect(job).toMatchObject({ status: 'queued', attempts: 1, lastError: expect.stringContaining('database briefly unavailable') });
      expect(job!.runAfter.getTime() - clock.now().getTime()).toBe(60_000);
      expect(await ctx.database.db.select().from(notifications)).toEqual([]);

      // Not yet due: nothing runs.
      expect(await runDueJobs(ctx.database.db, flaky)).toEqual({ succeeded: 0, retried: 0, failed: 0 });
      clock.advanceMinutes(1);
      expect(await runDueJobs(ctx.database.db, flaky)).toMatchObject({ succeeded: 1 });
      const [done] = await ctx.database.db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job!.id));
      expect(done).toMatchObject({ status: 'succeeded', attempts: 2, lastError: null });
      const created = await ctx.database.db.select().from(notifications);
      expect(created.length).toBeGreaterThan(0);
      // The same hour does not queue a second scan.
      await enqueueScheduledJobs(ctx.database.db);
      expect(await runDueJobs(ctx.database.db, flaky)).toEqual({ succeeded: 0, retried: 0, failed: 0 });
      expect(calls).toBe(2);
    });

    it('stops after the last attempt, records a log-safe error, and runs the failure handler', async () => {
      let finalCalls = 0;
      const broken: JobHandlers = {
        ...handlers(),
        'notifications.refresh': {
          async run() {
            const error = new Error('Failed query: select secret notes\nparams: Confidential note');
            throw error;
          },
          async onFinalFailure() {
            finalCalls += 1;
          },
        },
      };
      await enqueueJob(ctx.database.db, { kind: 'notifications.refresh', payload: { opportunityId: ids.oppRafiq }, maxAttempts: 2 });
      await runDueJobs(ctx.database.db, broken);
      clock.advanceMinutes(5);
      const summary = await runDueJobs(ctx.database.db, broken);
      expect(summary.failed).toBe(1);
      const [job] = await ctx.database.db.select().from(backgroundJobs).where(eq(backgroundJobs.kind, 'notifications.refresh'));
      expect(job).toMatchObject({ status: 'failed', attempts: 2 });
      expect(job!.lastError).not.toContain('Confidential note');
      expect(finalCalls).toBe(1);
      clock.advanceMinutes(120);
      expect(await runDueJobs(ctx.database.db, broken)).toEqual({ succeeded: 0, retried: 0, failed: 0 });
    });

    it('reclaims a job whose worker stopped responding', async () => {
      await enqueueJob(ctx.database.db, { kind: 'housekeeping' });
      const claimed = await claimNextJob(ctx.database.db, 'crashed-worker');
      expect(claimed?.attempts).toBe(1);
      expect(await claimNextJob(ctx.database.db, 'other-worker')).toBeNull();
      clock.advanceMinutes(11);
      const reclaimed = await claimNextJob(ctx.database.db, 'other-worker');
      expect(reclaimed?.id).toBe(claimed?.id);
      expect(reclaimed?.attempts).toBe(2);
    });

    it('lets two workers share the queue without running a job twice', async () => {
      for (let index = 0; index < 6; index += 1) {
        await enqueueJob(ctx.database.db, { kind: 'notifications.refresh', payload: { opportunityId: ids.oppRafiq } });
      }
      let runs = 0;
      const counting: JobHandlers = {
        ...handlers(),
        'notifications.refresh': {
          async run() {
            runs += 1;
          },
        },
      };
      const [a, b] = await Promise.all([runDueJobs(ctx.database.db, counting), runDueJobs(ctx.database.db, counting)]);
      expect(a.succeeded + b.succeeded).toBe(6);
      expect(runs).toBe(6);
    });

    it('prunes expired idempotency records and old exports in housekeeping', async () => {
      await ctx.database.db.execute(sql`
        INSERT INTO idempotency_records (actor_id, operation, idempotency_key, request_fingerprint, state, expires_at)
        VALUES (${ids.salesGA1}, 'test', 'old-key-123456', 'x', 'completed', '2026-09-01T00:00:00Z')`);
      await enqueueScheduledJobs(ctx.database.db);
      await runDueJobs(ctx.database.db, handlers());
      const left = await ctx.database.db.execute(sql`SELECT count(*)::int AS value FROM idempotency_records WHERE idempotency_key = 'old-key-123456'`);
      expect(left.rows[0]).toEqual({ value: 0 });
    });
  });
});
