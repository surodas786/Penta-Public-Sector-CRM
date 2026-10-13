/**
 * CR2, step 6: email connected to the in-app notifications and to the
 * Software Procurement cycles.
 *
 * Covers the events (follow-up, tender, EOI and RFP reminders, assignment,
 * team and management summaries, delivery failures), the administrator's
 * timing, who receives what, and the re-checks that keep a stale email from
 * going out: completion, a moved deadline, a transfer, a lost section, a
 * cancelled cycle, a disabled account. Everything is captured by the test
 * transport; nothing is sent.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ProcurementCycleDetailDto } from '../../shared/api.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import {
  auditEvents,
  backgroundJobs,
  emailDeliveries,
  emailSettings,
  followUps,
  notifications,
  opportunities,
  organizations,
  users,
} from '../db/schema.js';
import { createEmailRuntime } from '../email/runtime.js';
import type { MailTransport } from '../email/transport.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/queue.js';
import { runNotificationScan } from '../services/notifications.js';
import {
  ABSENT_UUID,
  CSRF_HEADER,
  TEST_ORIGIN,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  send,
  signIn,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

/** Friday 2 October 2026, 10:00 in Dhaka. */
const NOW = '2026-10-02T10:00:00+06:00';
const HOUR = 3_600_000;
const at = (offsetHours: number) => new Date(new Date(NOW).getTime() + offsetHours * HOUR).toISOString();

describe('CR2 step 6: notification email events', () => {
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
    clock = new FixedClock(NOW);
    setClock(clock);
    for (const file of readdirSync(ctx.mailbox)) rmSync(path.join(ctx.mailbox, file));
  });
  afterEach(() => resetClock());

  const db = () => ctx.database.db;

  async function turnEmailOn(enabled = true) {
    await db().insert(emailSettings).values({ id: 1, enabled, host: 'smtp.example.test', port: 587, fromAddress: 'crm@example.test' });
  }

  const handlers = (transport?: MailTransport | null) =>
    createJobHandlers(db(), { exportTtlHours: 24, exportMaxRows: 50_000 }, createEmailRuntime(ctx.config, transport));
  const scan = () => runNotificationScan(db());
  const runAll = (transport?: MailTransport | null) => runDueJobs(db(), handlers(transport));

  function captured(): { to: string; subject: string; text: string }[] {
    return readdirSync(ctx.mailbox).map((file) => JSON.parse(readFileSync(path.join(ctx.mailbox, file), 'utf8')));
  }

  async function deliveriesOf(templateKey: string) {
    return db().select().from(emailDeliveries).where(eq(emailDeliveries.templateKey, templateKey));
  }

  const put = (client: SignedInClient, url: string, body: Record<string, unknown>) =>
    client.agent.put(url).set('Origin', TEST_ORIGIN).set(CSRF_HEADER, client.csrfToken).send(body);
  const patch = (client: SignedInClient, url: string, body: Record<string, unknown>) =>
    client.agent.patch(url).set('Origin', TEST_ORIGIN).set(CSRF_HEADER, client.csrfToken).send(body);

  async function setTiming(admin: SignedInClient, changes: Record<string, unknown>) {
    const current = (await admin.agent.get('/api/admin/email/notification-timing').expect(200)).body;
    const { managementCandidates: _candidates, updatedAt: _updatedAt, updatedByName: _by, ...editable } = current;
    return put(admin, '/api/admin/email/notification-timing', { ...editable, ...changes });
  }

  async function turnTemplateOn(admin: SignedInClient, key: string) {
    const template = (await admin.agent.get('/api/admin/email/templates').expect(200)).body.items.find(
      (item: { key: string }) => item.key === key,
    );
    await put(admin, `/api/admin/email/templates/${key}`, {
      version: template.version,
      subject: template.subject,
      bodyText: template.bodyText,
      enabled: true,
    }).expect(200);
  }

  async function versionOf(table: 'users' | 'sections', id: string): Promise<number> {
    const result = await db().execute<{ version: number }>(sql`SELECT version FROM ${sql.identifier(table)} WHERE id = ${id}`);
    return result.rows[0]!.version;
  }

  /** An EOI cycle on Rafiq's p1, its deadline `hours` from now. */
  async function eoiCycle(rafiq: SignedInClient, hours: number): Promise<ProcurementCycleDetailDto> {
    const response = await send(rafiq, `/api/opportunities/${ids.oppRafiq}/procurement`, {
      procuringOrganizationId: ids.orgSylvanHills,
      title: 'City records software',
      reference: 'SH/EOI/2026/01',
      eoiPublicationDate: '2026-09-25',
      eoiDeadline: at(hours),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  }

  /** No captured message names a record, an organization or a value (D-EM-2). */
  async function expectNoCommercialDetail() {
    const names = (await db().select({ name: opportunities.name, reference: opportunities.reference }).from(opportunities)).flatMap(
      (row) => [row.name, row.reference],
    );
    const organizationNames = (await db().select({ name: organizations.name }).from(organizations)).map((row) => row.name);
    for (const message of captured()) {
      for (const name of [...names, ...organizationNames, 'SH/EOI/2026/01', 'SH/RFP/2026/01']) {
        expect(message.text, message.subject).not.toContain(name);
      }
      expect(message.text).not.toMatch(/৳|BDT|\{\{/);
    }
  }

  // -------------------------------------------------------------------------
  describe('timing, in Bangladesh time', () => {
    it('emails follow-up reminders from the reminder hour, once, while the alert is in the app from the start', async () => {
      clock.set('2026-10-02T07:30:00+06:00');
      await turnEmailOn();
      await scan();
      const followUpAlerts = await db()
        .select()
        .from(notifications)
        .where(and(eq(notifications.recipientId, ids.salesGA1), inArray(notifications.type, ['follow_up_due_today', 'follow_up_overdue'])));
      expect(followUpAlerts.length).toBeGreaterThan(0);
      expect(await deliveriesOf('follow_up_overdue')).toHaveLength(0);

      clock.set('2026-10-02T09:00:00+06:00');
      await scan();
      const queued = await deliveriesOf('follow_up_overdue');
      expect(queued.length).toBeGreaterThan(0);
      await scan();
      expect(await deliveriesOf('follow_up_overdue')).toHaveLength(queued.length);
    });

    it('follows the administrator’s reminder hour and deadline hours', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const saved = await setTiming(admin, { reminderHour: 11, eoiReminderHours: 24 });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body).toMatchObject({ reminderHour: 11, eoiReminderHours: 24, version: 1 });
      const [audit] = await db().select().from(auditEvents).where(eq(auditEvents.action, 'email.notification_timing_updated'));
      expect(audit).toMatchObject({ domain: 'administrative', opportunityId: null });
      expect(audit!.afterData).toEqual({ reminderHour: 11, eoiReminderHours: 24 });

      // Never earlier than the in-app alert, which appears 72 hours ahead (FR-090).
      const tooEarly = await setTiming(admin, { tenderReminderHours: 96 });
      expect(tooEarly.status).toBe(422);
      const stale = await put(admin, '/api/admin/email/notification-timing', { ...saved.body, version: 0, managementCandidates: undefined });
      expect([409, 422]).toContain(stale.status);

      await turnEmailOn();
      await scan(); // 10:00 Dhaka: before the chosen hour
      expect(await deliveriesOf('follow_up_overdue')).toHaveLength(0);
      clock.set('2026-10-02T11:05:00+06:00');
      await scan();
      expect((await deliveriesOf('follow_up_overdue')).length).toBeGreaterThan(0);
    });

    it('does not release a flood of old reminders when delivery is turned on later', async () => {
      await scan(); // alerts while delivery is off
      const early = await db().select({ id: notifications.id }).from(notifications);
      expect(early.length).toBeGreaterThan(0);

      clock.advanceDays(2);
      await turnEmailOn();
      await scan();
      const alertIds = new Set(early.map((row) => `alert:${row.id}`));
      const deliveries = await db().select({ dedupeKey: emailDeliveries.dedupeKey }).from(emailDeliveries);
      expect(deliveries.filter((row) => alertIds.has(row.dedupeKey ?? ''))).toEqual([]);
      // The alerts themselves are still in the app.
      expect((await db().select().from(notifications)).length).toBeGreaterThanOrEqual(early.length);
    });
  });

  // -------------------------------------------------------------------------
  describe('Software Procurement deadlines', () => {
    it('reminds the owner of an EOI deadline at the chosen time, with a link and the date only', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await setTiming(admin, { eoiReminderHours: 24 });
      await turnEmailOn();
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const cycle = await eoiCycle(rafiq, 48);
      await runAll();

      // In the app now, for Rafiq, his lead and management; no email yet.
      const alerts = await db().select().from(notifications).where(eq(notifications.type, 'eoi_deadline'));
      expect(alerts.map((alert) => alert.recipientId).sort()).toEqual([ids.management, ids.leadGA, ids.salesGA1].sort());
      expect(alerts.every((alert) => alert.procurementCycleId === cycle.id)).toBe(true);
      expect(await deliveriesOf('eoi_deadline')).toHaveLength(0);
      const inbox = (await rafiq.agent.get('/api/notifications').expect(200)).body.items;
      expect(inbox.find((item: { type: string }) => item.type === 'eoi_deadline')).toMatchObject({
        title: 'EOI due within 72 hours: SH/EOI/2026/01',
        path: `/opportunities/${ids.oppRafiq}?tab=procurement`,
      });

      clock.advanceMinutes(25 * 60);
      await scan();
      const queued = await deliveriesOf('eoi_deadline');
      expect(queued.map((row) => row.recipientUserId)).toEqual([ids.salesGA1]);
      await runAll();
      const message = captured().find((candidate) => candidate.subject === 'An EOI submission deadline is approaching');
      expect(message).toMatchObject({ to: emails.salesGA1 });
      expect(message!.text).toContain(`${TEST_ORIGIN}/opportunities/${ids.oppRafiq}?tab=procurement`);
      expect(message!.text).toContain('04 Oct 2026, 10:00 Bangladesh time (UTC+6)');
      await expectNoCommercialDetail();
    });

    it('suppresses a queued reminder when the deadline moves, and reminds again for the new one', async () => {
      await turnEmailOn();
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const cycle = await eoiCycle(rafiq, 48);
      await scan(); // the alert and its email queued, not yet sent
      const [first] = await deliveriesOf('eoi_deadline');
      expect(first).toMatchObject({ status: 'queued' });
      await db().update(backgroundJobs).set({ runAfter: new Date('2099-01-01') }).where(eq(backgroundJobs.kind, 'email.send'));

      const moved = await patch(rafiq, `/api/procurement/${cycle.id}`, { version: cycle.version, eoiDeadline: at(60) });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const [afterMove] = await db().select().from(emailDeliveries).where(eq(emailDeliveries.id, first!.id));
      expect(afterMove).toMatchObject({ status: 'suppressed' });
      expect(afterMove!.statusDetail).toMatch(/no longer applies/);

      await db().update(backgroundJobs).set({ runAfter: new Date(0) }).where(eq(backgroundJobs.kind, 'email.send'));
      await runAll();
      const fresh = (await deliveriesOf('eoi_deadline')).filter((row) => row.id !== first!.id);
      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ recipientUserId: ids.salesGA1, status: 'sent' });
      const messages = captured().filter((message) => message.subject === 'An EOI submission deadline is approaching');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.text).toContain('04 Oct 2026, 22:00 Bangladesh time (UTC+6)');
    });

    it('suppresses the reminder when the cycle is cancelled, and reminds about an RFP proposal deadline', async () => {
      await turnEmailOn();
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      let cycle = await eoiCycle(rafiq, 48);
      await scan();
      await db().update(backgroundJobs).set({ runAfter: new Date('2099-01-01') }).where(eq(backgroundJobs.kind, 'email.send'));
      const [queued] = await deliveriesOf('eoi_deadline');
      expect(queued).toMatchObject({ status: 'queued' });

      const cancelled = await send(rafiq, `/api/procurement/${cycle.id}/milestone`, {
        version: cycle.version,
        milestone: 'cancelled',
        outcomeDate: '2026-10-02',
        outcomeNote: 'The city withdrew the EOI.',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const [afterCancel] = await db().select().from(emailDeliveries).where(eq(emailDeliveries.id, queued!.id));
      expect(afterCancel!.status).toBe('suppressed');
      await db().update(backgroundJobs).set({ runAfter: new Date(0) }).where(eq(backgroundJobs.kind, 'email.send'));
      await runAll();
      expect(captured().filter((message) => message.subject.includes('EOI'))).toHaveLength(0);

      // A new cycle reaches the RFP; its proposal deadline is reminded separately.
      cycle = await eoiCycle(rafiq, 24 * 10);
      for (const [milestone, facts] of [
        ['eoi_submitted', { eoiSubmittedAt: at(-1) }],
        ['shortlisted', { eoiOutcomeDate: '2026-10-02' }],
        ['rfp_received', { rfpReference: 'SH/RFP/2026/01', rfpInvitationDate: '2026-10-02', proposalDeadline: at(30) }],
      ] as const) {
        const response = await send(rafiq, `/api/procurement/${cycle.id}/milestone`, { version: cycle.version, milestone, ...facts });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        cycle = response.body.cycle;
      }
      await runAll();
      const rfp = await deliveriesOf('rfp_deadline');
      expect(rfp.map((row) => [row.recipientUserId, row.status])).toEqual([[ids.salesGA1, 'sent']]);
      const message = captured().find((candidate) => candidate.subject === 'An RFP proposal deadline is approaching');
      expect(message!.text).toContain(`/opportunities/${ids.oppRafiq}?tab=procurement`);
      await expectNoCommercialDetail();
    });
  });

  // -------------------------------------------------------------------------
  describe('who receives what', () => {
    it('after a transfer, suppresses the previous owner’s queued reminder and tells only the new owner', async () => {
      await turnEmailOn();
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await eoiCycle(rafiq, 48);
      await scan();
      await db().update(backgroundJobs).set({ runAfter: new Date('2099-01-01') }).where(eq(backgroundJobs.kind, 'email.send'));
      const [rafiqsReminder] = await deliveriesOf('eoi_deadline');
      expect(rafiqsReminder).toMatchObject({ recipientUserId: ids.salesGA1, status: 'queued' });

      const nadia = await signIn(ctx.app, emails.leadGA);
      const [record] = await db().select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));
      await send(nadia, `/api/opportunities/${ids.oppRafiq}/transfer`, {
        version: record!.version,
        newOwnerId: ids.salesGA2,
        reason: 'Tasnia takes this over.',
      }).expect(200);
      const [afterTransfer] = await db().select().from(emailDeliveries).where(eq(emailDeliveries.id, rafiqsReminder!.id));
      expect(afterTransfer!.status).toBe('suppressed');

      await db().update(backgroundJobs).set({ runAfter: new Date(0) }).where(eq(backgroundJobs.kind, 'email.send'));
      await runAll();
      expect(captured().filter((message) => message.to === emails.salesGA1)).toEqual([]);
      const toTasnia = captured().filter((message) => message.to === emails.salesGA2).map((message) => message.subject);
      expect(toTasnia).toEqual(
        expect.arrayContaining(['An opportunity has been transferred to you', 'An EOI submission deadline is approaching']),
      );
      // Ownership emails go to the new owner only; the lead and management keep their in-app alert.
      expect((await deliveriesOf('ownership_changed')).map((row) => row.recipientUserId)).toEqual([ids.salesGA2]);
    });

    it('never emails a salesperson about a colleague’s records, even with shared sections', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      // Tasnia also joins Infrastructure, where Imran and Sadia work.
      const joined = await patch(admin, `/api/admin/users/${ids.salesGA2}`, {
        version: await versionOf('users', ids.salesGA2),
        sectionIds: [ids.sectionGA, ids.sectionIS],
      });
      expect(joined.status, JSON.stringify(joined.body)).toBe(200);
      await turnTemplateOn(admin, 'team_summary');
      await setTiming(admin, { summaryFrequency: 'daily' });
      await turnEmailOn();
      await scan();
      await runAll();

      const records = await db().select({ id: opportunities.id, ownerId: opportunities.ownerId }).from(opportunities);
      const tasks = await db().select({ opportunityId: followUps.opportunityId, assignee: followUps.assignedUserId }).from(followUps);
      const salespeople = await db().select({ id: users.id, email: users.email }).from(users).where(eq(users.role, 'sales'));
      for (const person of salespeople) {
        for (const message of captured().filter((candidate) => candidate.to === person.email)) {
          expect(message.subject).not.toMatch(/summary/i);
          const linked = message.text.match(/\/opportunities\/([0-9a-f-]{36})/)?.[1];
          const own =
            records.some((record) => record.id === linked && record.ownerId === person.id) ||
            tasks.some((task) => task.opportunityId === linked && task.assignee === person.id);
          expect(own, `${person.email}: ${message.subject}`).toBe(true);
        }
      }
      expect((await deliveriesOf('team_summary')).map((row) => row.recipientUserId).sort()).toEqual([ids.leadGA, ids.leadIS].sort());
    });

    it('sends a lead of two sections one team summary, counted in their scope when sent', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const replaced = await send(admin, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
        version: await versionOf('sections', ids.sectionGA),
        newLeadId: ids.leadIS,
        reason: 'Farhan covers both sections.',
      });
      expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
      await turnTemplateOn(admin, 'team_summary');
      await setTiming(admin, { summaryFrequency: 'weekly', summaryWeekday: 5 }); // Friday
      await turnEmailOn();

      await scan();
      await scan();
      const summaries = await deliveriesOf('team_summary');
      expect(summaries.map((row) => row.recipientUserId)).toEqual([ids.leadIS]);

      await runAll();
      const [message] = captured().filter((candidate) => candidate.subject.startsWith('Your team summary'));
      expect(message).toMatchObject({ to: emails.leadIS, subject: 'Your team summary for 02 Oct 2026' });
      expect(message!.text).toContain(`${TEST_ORIGIN}/dashboard`);

      // The same counts as Farhan's own dashboard, now covering both sections.
      const farhan = await signIn(ctx.app, emails.leadIS);
      const dashboard = (await farhan.agent.get('/api/dashboard').expect(200)).body;
      const overdue = dashboard.kpis.overdueFollowUps + dashboard.kpis.overdueFollowUpsOnHold;
      expect(overdue).toBeGreaterThan(0);
      expect(message!.text).toContain(`- Overdue follow-ups: ${overdue}`);
      expect(message!.text).toContain(`- Tender submissions in the next 7 days: ${dashboard.kpis.tendersDueNext7Days}`);
      await expectNoCommercialDetail();
    });

    it('does not send a queued team summary to someone who stopped leading before it went', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await turnTemplateOn(admin, 'team_summary');
      await setTiming(admin, { summaryFrequency: 'daily' });
      await turnEmailOn();
      await scan();
      const nadias = (await deliveriesOf('team_summary')).find((row) => row.recipientUserId === ids.leadGA);
      expect(nadias).toMatchObject({ status: 'queued' });

      await send(admin, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
        version: await versionOf('sections', ids.sectionGA),
        newLeadId: ids.leadIS,
        reason: 'Farhan covers both sections.',
      }).expect(200);
      await runAll();
      const [after] = await db().select().from(emailDeliveries).where(eq(emailDeliveries.id, nadias!.id));
      expect(after).toMatchObject({ status: 'suppressed', statusDetail: 'The recipient no longer leads an active section.' });
      expect(captured().some((message) => message.to === emails.leadGA && message.subject.includes('summary'))).toBe(false);
    });

    it('sends the management summary only to the people chosen, checked again when sent', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await turnTemplateOn(admin, 'management_summary');
      // A salesperson, an unknown id or an administrator cannot be chosen.
      for (const candidate of [ids.salesGA1, ABSENT_UUID, ids.admin]) {
        const refused = await setTiming(admin, { summaryFrequency: 'daily', managementSummaryRecipientIds: [candidate] });
        expect(refused.status).toBe(422);
        expect(refused.body.fieldErrors.managementSummaryRecipientIds).toBe('Choose active management accounts only.');
      }
      const chosen = await setTiming(admin, { summaryFrequency: 'daily', managementSummaryRecipientIds: [ids.management] });
      expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
      expect(chosen.body.managementCandidates).toEqual([expect.objectContaining({ id: ids.management, eligible: true })]);
      await turnEmailOn();
      await scan();
      expect((await deliveriesOf('management_summary')).map((row) => row.recipientUserId)).toEqual([ids.management]);
      expect(await deliveriesOf('team_summary')).toHaveLength(0); // still off by default

      // Removed from the list before it went: not sent.
      expect((await setTiming(admin, { managementSummaryRecipientIds: [] })).status).toBe(200);
      await runAll();
      const [summary] = await deliveriesOf('management_summary');
      expect(summary).toMatchObject({
        status: 'suppressed',
        statusDetail: 'The recipient is no longer a chosen management summary recipient.',
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('stale and undeliverable emails', () => {
    it('suppresses a queued reminder at once when the task is completed', async () => {
      await turnEmailOn();
      await scan();
      const [reminder] = (await deliveriesOf('follow_up_overdue')).filter((row) => row.recipientUserId === ids.salesGA1);
      const [alert] = await db()
        .select({ followUpId: notifications.followUpId })
        .from(notifications)
        .where(eq(notifications.id, (reminder!.context as { notificationId: string }).notificationId));
      const [task] = await db().select().from(followUps).where(eq(followUps.id, alert!.followUpId!));

      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const completed = await send(rafiq, `/api/follow-ups/${task!.id}/complete`, {
        version: task!.version,
        completionNote: 'Done.',
        replacement: { title: 'Agree the next meeting', dueDate: '2026-10-20' },
      });
      expect(completed.status, JSON.stringify(completed.body)).toBe(200);
      const [after] = await db().select().from(emailDeliveries).where(eq(emailDeliveries.id, reminder!.id));
      expect(after!.status).toBe('suppressed');
      await runAll();
      expect(captured().some((message) => message.to === emails.salesGA1 && message.subject === 'A follow-up is overdue' && message.text.includes(task!.opportunityId))).toBe(false);
    });

    it('re-checks the account just before sending', async () => {
      await turnEmailOn();
      await scan();
      expect((await deliveriesOf('follow_up_overdue')).some((row) => row.recipientUserId === ids.salesGA1)).toBe(true);
      await db().update(users).set({ active: false }).where(eq(users.id, ids.salesGA1));
      await runAll();
      const rafiqs = (await db().select().from(emailDeliveries)).filter((row) => row.recipientUserId === ids.salesGA1);
      expect(rafiqs.length).toBeGreaterThan(0);
      expect(rafiqs.every((row) => row.status === 'suppressed')).toBe(true);
      expect(captured().filter((message) => message.to === emails.salesGA1)).toEqual([]);
    });

    it('records failures, tells each administrator once a day, and retries under control', async () => {
      await turnEmailOn();
      await scan();
      const failing: MailTransport = {
        kind: 'smtp',
        async send(_server, message) {
          if (message.to !== emails.admin) throw Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' });
        },
        async verify() {},
      };
      await db().update(backgroundJobs).set({ maxAttempts: 1 }).where(eq(backgroundJobs.kind, 'email.send'));
      await runAll(failing);

      const failed = (await db().select().from(emailDeliveries)).filter((row) => row.status === 'failed');
      expect(failed.length).toBeGreaterThan(1);
      const notices = await deliveriesOf('delivery_failures');
      expect(notices.map((row) => [row.recipientUserId, row.status])).toEqual([[ids.admin, 'sent']]);

      // The notice is a count and a link, and is sent once however many fail.
      const sentNotices: string[] = [];
      const recording: MailTransport = { ...failing, async send(_server, message) { sentNotices.push(message.text); } };
      const [notice] = notices;
      await db().update(emailDeliveries).set({ status: 'queued', sentAt: null }).where(eq(emailDeliveries.id, notice!.id));
      await db()
        .update(backgroundJobs)
        .set({ status: 'queued', runAfter: new Date(0), attempts: 0, finishedAt: null, lockedAt: null, lockedBy: null })
        .where(and(eq(backgroundJobs.kind, 'email.send'), sql`${backgroundJobs.payload}->>'deliveryId' = ${notice!.id}`));
      await runAll(recording);
      expect(sentNotices[0]).toContain(`Emails that failed in the last 24 hours: ${failed.length}.`);
      expect(sentNotices[0]).toContain(`${TEST_ORIGIN}/administration`);
      const names = (await db().select({ name: opportunities.name }).from(opportunities)).map((row) => row.name);
      for (const name of names) expect(sentNotices[0]).not.toContain(name);

      // A retry re-checks the reminder: read in the app meanwhile, it is not sent.
      const reminder = failed.find((row) => row.templateKey === 'follow_up_overdue')!;
      await db()
        .update(notifications)
        .set({ readAt: clock.now() })
        .where(eq(notifications.id, (reminder.context as { notificationId: string }).notificationId));
      const admin = await signIn(ctx.app, emails.admin);
      const before = (await db().select().from(emailDeliveries)).length;
      const retried = await send(admin, `/api/admin/email/deliveries/${reminder.id}/retry`, {}, null);
      expect(retried.status).toBe(200);
      await runAll(failing);
      const [after] = await db().select().from(emailDeliveries).where(eq(emailDeliveries.id, reminder.id));
      expect(after).toMatchObject({ status: 'suppressed', statusDetail: 'Already read in the CRM.' });
      expect((await db().select().from(emailDeliveries)).length).toBe(before);

      // Another failure the same day adds no second notice.
      await scan();
      expect(await deliveriesOf('delivery_failures')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('without email', () => {
    it('keeps in-app notifications when delivery is off', async () => {
      await turnEmailOn(false);
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await eoiCycle(rafiq, 48);
      await runAll();
      await scan();
      expect(await db().select().from(emailDeliveries)).toHaveLength(0);
      const inbox = (await rafiq.agent.get('/api/notifications').expect(200)).body;
      expect(inbox.unreadCount).toBeGreaterThan(0);
      expect(inbox.items.map((item: { type: string }) => item.type)).toEqual(expect.arrayContaining(['eoi_deadline', 'follow_up_overdue']));
    });

    it('keeps in-app notifications, and records why nothing was sent, when the server sends no email', async () => {
      await turnEmailOn();
      await scan();
      await runAll(null); // EMAIL_TRANSPORT=none
      const rows = await db().select().from(emailDeliveries);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.status === 'suppressed' && /EMAIL_TRANSPORT=none/.test(row.statusDetail ?? ''))).toBe(true);
      expect(captured()).toEqual([]);
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      expect((await rafiq.agent.get('/api/notifications').expect(200)).body.unreadCount).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('links', () => {
    it('need sign-in and the recipient’s current access; they carry no token', async () => {
      await turnEmailOn();
      await scan();
      await runAll();
      const message = captured().find((candidate) => candidate.to === emails.salesGA1);
      const link = message!.text.match(new RegExp(`${TEST_ORIGIN}(/opportunities/[0-9a-f-]{36})(\\?tab=[a-z]+)?`));
      expect(link).toBeTruthy();
      expect(message!.text).not.toMatch(/token=|[?&](code|key)=/);
      const opportunityId = link![1]!.split('/')[2]!;

      const { default: request } = await import('supertest');
      expect((await request(ctx.app).get(`/api/opportunities/${opportunityId}`)).status).toBe(401);
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const forbidden = await tasnia.agent.get(`/api/opportunities/${opportunityId}`);
      const absent = await tasnia.agent.get(`/api/opportunities/${ABSENT_UUID}`);
      expect(forbidden.status).toBe(404);
      const { requestId: _forbiddenRequest, ...forbiddenBody } = forbidden.body;
      const { requestId: _absentRequest, ...absentBody } = absent.body;
      expect(forbiddenBody).toEqual(absentBody);
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      expect((await rafiq.agent.get(`/api/opportunities/${opportunityId}`)).status).toBe(200);
    });
  });
});
