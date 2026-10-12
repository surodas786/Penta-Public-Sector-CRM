/**
 * CR2: alert emails.
 *
 * While email delivery is on, every new in-app alert is also emailed to the
 * person responsible for it (D-EM-4): a task's assignee, a tender's owner,
 * the new owner after a transfer. When the email is sent, the alert must
 * still be true, unread and permitted, and the message carries no commercial
 * detail (D-EM-2), only a link into the CRM. Messages are captured, never sent.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, resetClock, setClock } from '../clock.js';
import { emailDeliveries, emailSettings, followUps, notifications, opportunities, organizations, tenders } from '../db/schema.js';
import { createEmailRuntime } from '../email/runtime.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runNotificationScan } from '../services/notifications.js';
import { runDueJobs } from '../jobs/queue.js';
import {
  CSRF_HEADER,
  TEST_ORIGIN,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  send,
  signIn,
  type TestContext,
} from './helpers/harness.js';

const DEMO_NOW = '2026-10-02T10:00:00+06:00';

describe('CR2: alert emails', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetFixtures();
    setClock(new FixedClock(DEMO_NOW));
    for (const file of readdirSync(ctx.mailbox)) rmSync(path.join(ctx.mailbox, file));
  });
  afterEach(() => resetClock());

  async function turnEmailOn(enabled = true) {
    await ctx.database.db
      .insert(emailSettings)
      .values({ id: 1, enabled, host: 'smtp.example.test', port: 587, fromAddress: 'crm@example.test' });
  }

  const handlers = () =>
    createJobHandlers(ctx.database.db, { exportTtlHours: 24, exportMaxRows: 50_000 }, createEmailRuntime(ctx.config));

  /** Generate alerts only (the scan's work), leaving the emails it queues unsent. */
  const scanOnly = () => runNotificationScan(ctx.database.db);

  const runAll = () => runDueJobs(ctx.database.db, handlers());

  function captured(): { to: string; subject: string; text: string }[] {
    return readdirSync(ctx.mailbox).map((file) => JSON.parse(readFileSync(path.join(ctx.mailbox, file), 'utf8')));
  }

  /** Each alert's recipient, type, and whether that recipient is the person responsible for it. */
  async function alertsWithResponsibility() {
    const result = await ctx.database.db.execute<{ id: string; recipient_id: string; type: string; responsible: boolean }>(sql`
      SELECT n.id, n.recipient_id, n.type,
             (CASE n.type
                WHEN 'tender_deadline' THEN o.owner_id = n.recipient_id
                WHEN 'ownership_changed' THEN n.subject_user_id = n.recipient_id
                ELSE f.assigned_user_id = n.recipient_id END) AS responsible
        FROM ${notifications} n
        JOIN ${opportunities} o ON o.id = n.opportunity_id
        LEFT JOIN ${followUps} f ON f.id = n.follow_up_id`);
    return result.rows;
  }

  it('emails each new alert to the person responsible for it, and nobody else', async () => {
    await turnEmailOn();
    await scanOnly();

    const alerts = await alertsWithResponsibility();
    const deliveries = await ctx.database.db.select().from(emailDeliveries);
    const responsible = alerts.filter((alert) => alert.responsible);
    expect(responsible.length).toBeGreaterThan(0);
    // Leads and management get in-app alerts that are not emailed.
    expect(alerts.some((alert) => !alert.responsible && alert.recipient_id === ids.leadGA)).toBe(true);

    expect(deliveries).toHaveLength(responsible.length);
    for (const delivery of deliveries) {
      const alert = alerts.find((candidate) => candidate.id === (delivery.context as { notificationId: string }).notificationId)!;
      expect(alert.responsible).toBe(true);
      expect(delivery.recipientUserId).toBe(alert.recipient_id);
      expect(delivery.templateKey).toBe(alert.type);
    }

    // A second scan creates no new alert, so no second email.
    await scanOnly();
    expect(await ctx.database.db.select().from(emailDeliveries)).toHaveLength(responsible.length);
  });

  it('sends a link and dates only: no project names, values or organizations (D-EM-2)', async () => {
    await turnEmailOn();
    await scanOnly();
    await runAll();

    const messages = captured();
    expect(messages.length).toBeGreaterThan(0);
    const names = (await ctx.database.db.select({ name: opportunities.name, reference: opportunities.reference }).from(opportunities)).flatMap(
      (row) => [row.name, row.reference],
    );
    const organizationNames = (await ctx.database.db.select({ name: organizations.name }).from(organizations)).map((row) => row.name);
    for (const message of messages) {
      expect(message.text).toMatch(new RegExp(`${TEST_ORIGIN}/opportunities/[0-9a-f-]{36}`));
      expect(message.text).not.toMatch(/\{\{/);
      for (const name of [...names, ...organizationNames]) expect(message.text).not.toContain(name);
      expect(message.text).not.toMatch(/৳|BDT|\d{1,3}(,\d{3}){2,}/);
    }
    const overdue = messages.find((message) => message.subject === 'A follow-up is overdue');
    expect(overdue?.text).toMatch(/due on \d{2} [A-Z][a-z]{2} 2026 is overdue/);

    const sent = await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.status, 'sent'));
    expect(sent).toHaveLength(messages.length);
  });

  it('queues nothing while email delivery is off, and alerts still appear in the app', async () => {
    await turnEmailOn(false);
    await scanOnly();
    expect((await alertsWithResponsibility()).length).toBeGreaterThan(0);
    expect(await ctx.database.db.select().from(emailDeliveries)).toHaveLength(0);
  });

  it('skips an alert already read in the app, or no longer true, when the email is due', async () => {
    await turnEmailOn();
    await scanOnly();
    const deliveries = await ctx.database.db.select().from(emailDeliveries);
    const [first, second] = deliveries.filter((delivery) => delivery.templateKey.startsWith('follow_up'));
    expect(first && second).toBeTruthy();

    // Read in the app.
    const firstAlert = (first!.context as { notificationId: string }).notificationId;
    await ctx.database.db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, firstAlert));
    // Rescheduled, so the alert no longer describes the task.
    const [secondAlert] = await ctx.database.db
      .select({ followUpId: notifications.followUpId })
      .from(notifications)
      .where(eq(notifications.id, (second!.context as { notificationId: string }).notificationId));
    await ctx.database.db.update(followUps).set({ dueDate: '2026-12-01' }).where(eq(followUps.id, secondAlert!.followUpId!));

    await runAll();
    const [afterFirst] = await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.id, first!.id));
    const [afterSecond] = await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.id, second!.id));
    expect(afterFirst).toMatchObject({ status: 'suppressed', statusDetail: 'Already read in the CRM.' });
    expect(afterSecond).toMatchObject({ status: 'suppressed' });
    expect(afterSecond!.statusDetail).toMatch(/no longer applies/);
  });

  it('does not email someone who lost access before it was sent', async () => {
    await turnEmailOn();
    await scanOnly();
    const rafiqs = await ctx.database.db
      .select({ id: emailDeliveries.id, notificationId: sql<string>`${emailDeliveries.context}->>'notificationId'` })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.recipientUserId, ids.salesGA1));
    expect(rafiqs.length).toBeGreaterThan(0);
    const [alert] = await ctx.database.db
      .select({ opportunityId: notifications.opportunityId })
      .from(notifications)
      .where(eq(notifications.id, rafiqs[0]!.notificationId));

    // Nadia moves the record to Tasnia before the email goes.
    const [record] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, alert!.opportunityId));
    const nadia = await signIn(ctx.app, emails.leadGA);
    await send(nadia, `/api/opportunities/${record!.id}/transfer`, {
      version: record!.version,
      newOwnerId: ids.salesGA2,
      reason: 'Tasnia takes this over.',
    }).expect(200);

    await runAll();
    const [after] = await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.id, rafiqs[0]!.id));
    expect(after!.status).toBe('suppressed');
    expect(captured().some((message) => message.to === emails.salesGA1 && message.text.includes(record!.id))).toBe(false);
  });

  it('emails only the new owner about a transfer', async () => {
    await turnEmailOn();
    const nadia = await signIn(ctx.app, emails.leadGA);
    const [record] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));
    await send(nadia, `/api/opportunities/${ids.oppRafiq}/transfer`, {
      version: record!.version,
      newOwnerId: ids.salesGA2,
      reason: 'Tasnia takes this over.',
    }).expect(200);
    await runAll();

    const ownership = await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.templateKey, 'ownership_changed'));
    expect(ownership.map((row) => row.recipientUserId)).toEqual([ids.salesGA2]);
    expect(ownership[0]!.status).toBe('sent');
    const message = captured().find((candidate) => candidate.subject === 'An opportunity has been transferred to you');
    expect(message).toMatchObject({ to: emails.salesGA2 });
    expect(message!.text).toContain(`${TEST_ORIGIN}/opportunities/${ids.oppRafiq}`);

    // In-app, the lead's and management's alerts are still there.
    const inApp = await ctx.database.db
      .select({ recipientId: notifications.recipientId })
      .from(notifications)
      .where(and(eq(notifications.type, 'ownership_changed'), eq(notifications.opportunityId, ids.oppRafiq)));
    expect(inApp.map((row) => row.recipientId)).toContain(ids.management);
  });

  it('gives a tender deadline in Bangladesh time', async () => {
    await turnEmailOn();
    // A current, participating notice for Rafiq closing in two days.
    const [tender] = await ctx.database.db.select().from(tenders).where(eq(tenders.id, ids.tenderRafiq));
    await ctx.database.db
      .update(tenders)
      .set({ submissionDeadline: new Date('2026-10-04T15:00:00+06:00'), bidStatus: 'preparing' })
      .where(eq(tenders.id, tender!.id));
    await scanOnly();
    await runAll();
    const message = captured().find((candidate) => candidate.subject === 'A tender submission deadline is approaching');
    expect(message).toMatchObject({ to: emails.salesGA1 });
    expect(message!.text).toContain('04 Oct 2026, 15:00 Bangladesh time (UTC+6)');
  });

  it('never posts an alert email through any endpoint', async () => {
    const admin = await signIn(ctx.app, emails.admin);
    const attempt = await admin.agent
      .post('/api/admin/email/deliveries')
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_HEADER, admin.csrfToken)
      .send({ templateKey: 'follow_up_overdue', recipientUserId: ids.salesGA1 });
    expect(attempt.status).toBe(404);
  });
});
