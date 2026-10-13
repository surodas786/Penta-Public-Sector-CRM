/**
 * CR1–CR6 as one change set: the nine demonstrations of the step 7 release
 * check, each end to end through the real API and database.
 *
 *   1. An invited user sets a password and activates.
 *   2. Expired, replaced and used links fail alike and change nothing.
 *   3. A lead of two sections reaches both and nothing of a third, on every
 *      surface: list, record, search, dashboard, export, documents, alerts.
 *   4. A salesperson in two sections sees only their own records.
 *   5. Membership removal and lead replacement apply on the next request.
 *   6. Queued email cannot disclose a record after access is revoked.
 *   7. A procurement cycle runs EOI → shortlisting → RFP → proposal.
 *   8. Goods tenders keep their own workflow beside procurement cycles.
 *   9. Email administration exposes no secret and no commercial record.
 *
 * Email is captured to a folder, never sent.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { and, count, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FILE_NAME_HEADER, type ProcurementCycleDetailDto, type ReportExportDto } from '../../shared/api.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import {
  auditEvents,
  emailDeliveries,
  emailSettings,
  notifications,
  opportunities,
  sectionMemberships,
  tenders,
  users,
} from '../db/schema.js';
import { createEmailRuntime } from '../email/runtime.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/queue.js';
import { runNotificationScan } from '../services/notifications.js';
import {
  ABSENT_UUID,
  CSRF_HEADER,
  TEST_ORIGIN,
  createOpportunityPayload,
  createTestApp,
  emails,
  ids,
  nextIdempotencyKey,
  resetFixtures,
  send,
  signIn,
  startSession,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

const NOW = '2026-10-02T10:00:00+06:00';
const HOUR = 3_600_000;
const at = (hours: number) => new Date(new Date(NOW).getTime() + hours * HOUR).toISOString();
const NEW_PASSWORD = 'a long synthetic passphrase 2026';

describe('CR1–CR6 acceptance (step 7)', () => {
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
  const runJobs = () =>
    runDueJobs(db(), createJobHandlers(db(), { exportTtlHours: 24, exportMaxRows: 50_000 }, createEmailRuntime(ctx.config)));
  const captured = (): { to: string; subject: string; text: string }[] =>
    readdirSync(ctx.mailbox).map((file) => JSON.parse(readFileSync(path.join(ctx.mailbox, file), 'utf8')));
  const patch = (client: SignedInClient, url: string, body: Record<string, unknown>) =>
    client.agent.patch(url).set('Origin', TEST_ORIGIN).set(CSRF_HEADER, client.csrfToken).send(body);
  const put = (client: SignedInClient, url: string, body: Record<string, unknown>) =>
    client.agent.put(url).set('Origin', TEST_ORIGIN).set(CSRF_HEADER, client.csrfToken).send(body);

  async function turnEmailOn() {
    await db().insert(emailSettings).values({ id: 1, enabled: true, host: 'smtp.example.test', port: 587, fromAddress: 'crm@example.test' });
  }

  async function versionOf(table: 'users' | 'sections', id: string): Promise<number> {
    const result = await db().execute<{ version: number }>(sql`SELECT version FROM ${sql.identifier(table)} WHERE id = ${id}`);
    return result.rows[0]!.version;
  }

  async function setPassword(token: string, password = NEW_PASSWORD) {
    const visitor = await startSession(ctx.app);
    return visitor.agent.post('/api/auth/set-password').set('Origin', TEST_ORIGIN).set(CSRF_HEADER, visitor.csrfToken).send({ token, password });
  }

  async function signInStatus(email: string, password: string) {
    const visitor = await startSession(ctx.app);
    return (
      await visitor.agent.post('/api/auth/login').set('Origin', TEST_ORIGIN).set(CSRF_HEADER, visitor.csrfToken).send({ email, password })
    ).status;
  }

  const tokenOf = (url: string) => url.split('#token=')[1]!;
  const withoutRequestId = (body: Record<string, unknown>) => {
    const { requestId: _requestId, ...rest } = body;
    return rest;
  };

  async function listIds(client: SignedInClient): Promise<string[]> {
    const response = await client.agent.get('/api/opportunities').query({ pageSize: 100 }).expect(200);
    return (response.body.items as { id: string }[]).map((item) => item.id).sort();
  }

  async function recordsWhere(where: (row: { ownerId: string; sectionId: string }) => boolean) {
    const rows = await db().select({ id: opportunities.id, name: opportunities.name, ownerId: opportunities.ownerId, sectionId: opportunities.sectionId }).from(opportunities);
    return rows.filter(where);
  }

  async function exportCsv(client: SignedInClient): Promise<string> {
    const requested = (await send(client, '/api/exports', { kind: 'opportunities', filters: {} }, nextIdempotencyKey('export')).expect(202))
      .body as ReportExportDto;
    await runJobs();
    return (await client.agent.get(`/api/exports/${requested.id}/download`).expect(200)).text;
  }

  // -------------------------------------------------------------------------
  it('1. an invited user receives the link by email, sets a password and signs in', async () => {
    await turnEmailOn();
    const admin = await signIn(ctx.app, emails.admin);
    const created = await send(admin, '/api/admin/users', {
      fullName: 'Lamia Chowdhury',
      email: 'lamia.chowdhury@example.com',
      role: 'sales',
      sectionIds: [ids.sectionGA],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.link).toBeNull(); // emailed, not shown
    expect(await signInStatus('lamia.chowdhury@example.com', NEW_PASSWORD)).toBe(401);

    await runJobs();
    const invitation = captured().find((message) => message.to === 'lamia.chowdhury@example.com');
    const token = invitation!.text.match(/set-password#token=([\w-]+)/)![1]!;
    expect((await setPassword(token)).status).toBe(204);
    expect(await signInStatus('lamia.chowdhury@example.com', NEW_PASSWORD)).toBe(200);
  });

  it('2. expired, replaced and used links are refused alike and change nothing', async () => {
    const admin = await signIn(ctx.app, emails.admin);
    const issue = async () => tokenOf((await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {}).expect(201)).body.url);

    const used = await issue();
    expect((await setPassword(used, 'the first new passphrase 2026')).status).toBe(204);
    const replaced = await issue();
    const expired = await issue(); // replaces `replaced`
    clock.advanceMinutes(24 * 60 + 1);

    const before = {
      user: (await db().select({ hash: users.passwordHash, version: users.sessionVersion }).from(users).where(eq(users.id, ids.salesGA1)))[0],
      audit: (await db().select({ value: count() }).from(auditEvents))[0]!.value,
    };
    const responses = [await setPassword(used), await setPassword(replaced), await setPassword(expired), await setPassword('A'.repeat(43))];
    for (const response of responses) {
      expect(response.status).toBe(422);
      expect(withoutRequestId(response.body)).toEqual(withoutRequestId(responses[3]!.body));
    }
    const after = {
      user: (await db().select({ hash: users.passwordHash, version: users.sessionVersion }).from(users).where(eq(users.id, ids.salesGA1)))[0],
      audit: (await db().select({ value: count() }).from(auditEvents))[0]!.value,
    };
    expect(after).toEqual(before);
    expect(await signInStatus(emails.salesGA1, 'the first new passphrase 2026')).toBe(200);
  });

  // -------------------------------------------------------------------------
  describe('3. a lead of two sections, and a third section', () => {
    /** Nadia leads Government Applications and a new Health Systems section; Infrastructure (Farhan) is the third. */
    async function nadiaLeadsTwo() {
      const admin = await signIn(ctx.app, emails.admin);
      const health = (await send(admin, '/api/admin/sections', { name: 'Health Systems', leadId: ids.leadGA }).expect(201)).body.id as string;
      const nadia = await signIn(ctx.app, emails.leadGA);
      const created = await send(nadia, '/api/opportunities', createOpportunityPayload({ name: 'Hospital records system', ownerId: ids.leadGA, sectionId: health }));
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return { nadia, health, healthRecord: created.body.opportunity.id as string };
    }

    it('reaches both led sections on every surface and nothing of the third', async () => {
      const { nadia, health, healthRecord } = await nadiaLeadsTwo();
      const led = await recordsWhere((row) => row.sectionId === ids.sectionGA || row.sectionId === health);
      const third = await recordsWhere((row) => row.sectionId === ids.sectionIS);
      expect(third.length).toBeGreaterThan(0);

      // List and record.
      expect(await listIds(nadia)).toEqual(led.map((row) => row.id).sort());
      await nadia.agent.get(`/api/opportunities/${healthRecord}`).expect(200);
      const forbidden = await nadia.agent.get(`/api/opportunities/${third[0]!.id}`);
      const absent = await nadia.agent.get(`/api/opportunities/${ABSENT_UUID}`);
      expect(forbidden.status).toBe(404);
      expect(withoutRequestId(forbidden.body)).toEqual(withoutRequestId(absent.body));

      // Search.
      for (const record of third) {
        const found = (await nadia.agent.get(`/api/search?q=${encodeURIComponent(record.name.slice(0, 20))}&type=opportunity`).expect(200)).body;
        const titles = found.groups.flatMap((group: { items: { id: string }[] }) => group.items.map((item) => item.id));
        expect(titles).not.toContain(record.id);
      }
      const hospital = (await nadia.agent.get('/api/search?q=Hospital records&type=opportunity').expect(200)).body;
      expect(hospital.groups.flatMap((group: { items: { id: string }[] }) => group.items.map((item) => item.id))).toContain(healthRecord);

      // Dashboard.
      const dashboard = (await nadia.agent.get('/api/dashboard').expect(200)).body;
      const activeLed = (await db().select({ id: opportunities.id, status: opportunities.status, stage: opportunities.stage, sectionId: opportunities.sectionId }).from(opportunities))
        .filter((row) => (row.sectionId === ids.sectionGA || row.sectionId === health) && row.status === 'active' && !['awarded', 'lost'].includes(row.stage));
      expect(dashboard.kpis.activeOpportunities).toBe(activeLed.length);

      // Export.
      const csv = await exportCsv(nadia);
      expect(csv).toContain('Hospital records system');
      for (const record of third) expect(csv).not.toContain(record.name);

      // Documents.
      await nadia.agent.get(`/api/opportunities/${healthRecord}/documents`).expect(200);
      await nadia.agent.get(`/api/opportunities/${third[0]!.id}/documents`).expect(404);
      const upload = await nadia.agent
        .post(`/api/opportunities/${third[0]!.id}/document-uploads`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, nadia.csrfToken)
        .set(FILE_NAME_HEADER, 'note.txt')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('synthetic'));
      expect(upload.status).toBe(404);

      // In-app alerts.
      await runNotificationScan(db());
      const inbox = (await nadia.agent.get('/api/notifications').query({ pageSize: 100 }).expect(200)).body.items as { path: string }[];
      expect(inbox.length).toBeGreaterThan(0);
      const thirdIds = new Set(third.map((row) => row.id));
      for (const item of inbox) expect(thirdIds.has(item.path.split('/')[2]!.split('?')[0]!)).toBe(false);
    });
  });

  it('4. a salesperson in two sections sees only their own records, not colleagues’ in either section', async () => {
    const admin = await signIn(ctx.app, emails.admin);
    await patch(admin, `/api/admin/users/${ids.salesGA2}`, { version: await versionOf('users', ids.salesGA2), sectionIds: [ids.sectionGA, ids.sectionIS] }).expect(200);
    const tasnia = await signIn(ctx.app, emails.salesGA2);
    const created = await send(tasnia, '/api/opportunities', createOpportunityPayload({ name: 'Network audit', ownerId: ids.salesGA2, sectionId: ids.sectionIS }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const own = await recordsWhere((row) => row.ownerId === ids.salesGA2);
    expect(await listIds(tasnia)).toEqual(own.map((row) => row.id).sort());
    const colleagues = await recordsWhere((row) => row.ownerId !== ids.salesGA2 && (row.sectionId === ids.sectionGA || row.sectionId === ids.sectionIS));
    expect(colleagues.some((row) => row.sectionId === ids.sectionIS)).toBe(true);
    for (const record of colleagues) {
      expect((await tasnia.agent.get(`/api/opportunities/${record.id}`)).status).toBe(404);
      const found = (await tasnia.agent.get(`/api/search?q=${encodeURIComponent(record.name.slice(0, 20))}&type=opportunity`).expect(200)).body;
      expect(found.groups.flatMap((group: { items: { id: string }[] }) => group.items.map((item) => item.id))).not.toContain(record.id);
    }
  });

  it('5. membership removal and lead replacement apply on the next request', async () => {
    const admin = await signIn(ctx.app, emails.admin);
    // Tasnia joins Infrastructure, then leaves it: her session ends and a new one has no Infrastructure.
    await patch(admin, `/api/admin/users/${ids.salesGA2}`, { version: await versionOf('users', ids.salesGA2), sectionIds: [ids.sectionGA, ids.sectionIS] }).expect(200);
    const tasnia = await signIn(ctx.app, emails.salesGA2);
    expect((await tasnia.agent.get('/api/auth/me').expect(200)).body.user.sections.map((item: { id: string }) => item.id)).toContain(ids.sectionIS);
    await patch(admin, `/api/admin/users/${ids.salesGA2}`, { version: await versionOf('users', ids.salesGA2), sectionIds: [ids.sectionGA] }).expect(200);
    await tasnia.agent.get('/api/auth/me').expect(401);
    const again = await signIn(ctx.app, emails.salesGA2);
    expect((await again.agent.get('/api/auth/me').expect(200)).body.user.sections.map((item: { id: string }) => item.id)).not.toContain(ids.sectionIS);

    // Farhan is appointed to Government Applications: Nadia loses it at once, Farhan gains it at once.
    const nadia = await signIn(ctx.app, emails.leadGA);
    const farhan = await signIn(ctx.app, emails.leadIS);
    await nadia.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
    await farhan.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(404);
    await send(admin, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
      version: await versionOf('sections', ids.sectionGA),
      newLeadId: ids.leadIS,
      reason: 'Farhan covers both sections.',
    }).expect(200);
    expect((await nadia.agent.get(`/api/opportunities/${ids.oppRafiq}`)).status).not.toBe(200);
    await farhan.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
  });

  describe('6. queued email after access is revoked', () => {
    it('is not sent after a membership ends, a transfer, or a lead replacement', async () => {
      await turnEmailOn();
      const admin = await signIn(ctx.app, emails.admin);
      // Tasnia, in two sections, has a reminder due on her Infrastructure record.
      await patch(admin, `/api/admin/users/${ids.salesGA2}`, { version: await versionOf('users', ids.salesGA2), sectionIds: [ids.sectionGA, ids.sectionIS] }).expect(200);
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const created = await send(
        tasnia,
        '/api/opportunities',
        createOpportunityPayload({ name: 'Network audit', ownerId: ids.salesGA2, sectionId: ids.sectionIS, initialFollowUpDueDate: '2026-10-02' }),
      ).expect(201);
      await runNotificationScan(db());
      const queued = await db().select().from(emailDeliveries).where(eq(emailDeliveries.recipientUserId, ids.salesGA2));
      const hers = [];
      for (const delivery of queued) {
        const [alert] = await db().select({ opportunityId: notifications.opportunityId }).from(notifications).where(eq(notifications.id, (delivery.context as { notificationId: string }).notificationId));
        if (alert?.opportunityId === created.body.opportunity.id) hers.push(delivery);
      }
      expect(hers).toHaveLength(1);

      // Her membership of Infrastructure ends (the left-behind case the scope fails closed on).
      await db().update(sectionMemberships).set({ endedAt: clock.now(), endedBy: ids.admin }).where(and(eq(sectionMemberships.userId, ids.salesGA2), eq(sectionMemberships.sectionId, ids.sectionIS)));

      // Rafiq's reminder: his record moves to Tasnia before the email goes.
      const rafiqs = await db().select().from(emailDeliveries).where(eq(emailDeliveries.recipientUserId, ids.salesGA1));
      expect(rafiqs.length).toBeGreaterThan(0);
      const nadia = await signIn(ctx.app, emails.leadGA);
      const [record] = await db().select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));
      await send(nadia, `/api/opportunities/${ids.oppRafiq}/transfer`, { version: record!.version, newOwnerId: ids.salesGA2, reason: 'Handover.' }).expect(200);

      await runJobs();
      const [after] = await db().select().from(emailDeliveries).where(eq(emailDeliveries.id, hers[0]!.id));
      expect(after!.status).toBe('suppressed');
      const messages = captured();
      expect(messages.some((message) => message.to === emails.salesGA2 && message.text.includes(created.body.opportunity.id))).toBe(false);
      expect(messages.some((message) => message.to === emails.salesGA1 && message.text.includes(ids.oppRafiq))).toBe(false);
    });

    it('is not sent to an account deactivated through Administration', async () => {
      await turnEmailOn();
      const admin = await signIn(ctx.app, emails.admin);
      // A second management account, chosen for the management summary.
      const created = await send(admin, '/api/admin/users', { fullName: 'Second Manager', email: 'second.manager@example.com', role: 'management' }).expect(201);
      const managerId = created.body.user.id as string;
      await runJobs();
      const invitation = captured().find((message) => message.to === 'second.manager@example.com')!;
      expect((await setPassword(invitation.text.match(/set-password#token=([\w-]+)/)![1]!)).status).toBe(204);

      const template = (await admin.agent.get('/api/admin/email/templates').expect(200)).body.items.find((item: { key: string }) => item.key === 'management_summary');
      await put(admin, '/api/admin/email/templates/management_summary', { version: template.version, subject: template.subject, bodyText: template.bodyText, enabled: true }).expect(200);
      const timing = (await admin.agent.get('/api/admin/email/notification-timing').expect(200)).body;
      await put(admin, '/api/admin/email/notification-timing', {
        version: timing.version,
        reminderHour: timing.reminderHour,
        tenderReminderHours: 72,
        eoiReminderHours: 72,
        rfpReminderHours: 72,
        summaryFrequency: 'daily',
        summaryWeekday: 0,
        managementSummaryRecipientIds: [managerId],
      }).expect(200);
      await runNotificationScan(db());
      const [summary] = await db().select().from(emailDeliveries).where(and(eq(emailDeliveries.recipientUserId, managerId), eq(emailDeliveries.templateKey, 'management_summary')));
      expect(summary).toMatchObject({ status: 'queued' });

      await send(admin, `/api/admin/users/${managerId}/deactivate`, { version: await versionOf('users', managerId), reason: 'Left Penta.' }).expect(200);
      await runJobs();
      const [after] = await db().select().from(emailDeliveries).where(eq(emailDeliveries.id, summary!.id));
      expect(after).toMatchObject({ status: 'suppressed', statusDetail: 'The recipient account is inactive.' });
      expect(captured().some((message) => message.to === 'second.manager@example.com' && /summary/i.test(message.subject))).toBe(false);
    });
  });

  it('7. a procurement cycle runs EOI → shortlisting → RFP → proposal submitted', async () => {
    const rafiq = await signIn(ctx.app, emails.salesGA1);
    let cycle = (
      await send(rafiq, `/api/opportunities/${ids.oppRafiq}/procurement`, {
        procuringOrganizationId: ids.orgSylvanHills,
        title: 'City records software',
        reference: 'SH/EOI/2026/01',
        eoiPublicationDate: '2026-09-25',
        eoiDeadline: at(48),
      }).expect(201)
    ).body as ProcurementCycleDetailDto;
    const stageBefore = (await db().select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, ids.oppRafiq)))[0]!.stage;
    for (const [milestone, facts] of [
      ['eoi_submitted', { eoiSubmittedAt: at(-1) }],
      ['shortlisted', { eoiOutcomeDate: '2026-10-02' }],
      ['rfp_received', { rfpReference: 'SH/RFP/2026/01', rfpInvitationDate: '2026-10-02', proposalDeadline: at(24 * 10) }],
      ['proposal_preparation', {}],
      ['proposal_submitted', { proposalSubmittedAt: at(-0.5) }],
    ] as const) {
      const response = await send(rafiq, `/api/procurement/${cycle.id}/milestone`, { version: cycle.version, milestone, ...facts });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      cycle = response.body.cycle;
      expect(cycle.milestone).toBe(milestone);
    }
    // The pipeline moves only when asked: it was never asked here.
    expect((await db().select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, ids.oppRafiq)))[0]!.stage).toBe(stageBefore);
  });

  it('8. goods tenders keep their own workflow beside a procurement cycle', async () => {
    const rafiq = await signIn(ctx.app, emails.salesGA1);
    await send(rafiq, `/api/opportunities/${ids.oppRafiqTender}/procurement`, {
      procuringOrganizationId: ids.orgSylvanHills,
      title: 'Software part of the same buyer',
      reference: 'SH/EOI/2026/02',
      eoiPublicationDate: '2026-09-25',
      eoiDeadline: at(72),
    }).expect(201);
    const [before] = await db().select().from(tenders).where(eq(tenders.id, ids.tenderRafiq));
    const submitted = await send(rafiq, `/api/tenders/${ids.tenderRafiq}/submit`, { version: before!.version, submittedAt: NOW, moveOpportunityToBidSubmitted: false });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const [after] = await db().select().from(tenders).where(eq(tenders.id, ids.tenderRafiq));
    expect(after!.bidStatus).toBe('submitted');
    const tracker = (await rafiq.agent.get('/api/tenders').expect(200)).body.items as { reference: string }[];
    expect(tracker.map((item) => item.reference)).not.toContain('SH/EOI/2026/02');
    const procurement = (await rafiq.agent.get('/api/procurement').expect(200)).body.items as { reference: string }[];
    expect(procurement.map((item) => item.reference)).toContain('SH/EOI/2026/02');
  });

  it('9. email administration keeps secrets and commercial records out of reach', async () => {
    const admin = await signIn(ctx.app, emails.admin);
    const saved = await put(admin, '/api/admin/email/settings', {
      version: 0,
      enabled: false,
      host: 'smtp.example.test',
      port: 587,
      security: 'starttls',
      username: 'crm@example.test',
      password: 'smtp-secret-for-acceptance',
      fromName: 'Penta CRM',
      fromAddress: 'crm@example.test',
      replyTo: null,
    }).expect(200);
    expect(JSON.stringify(saved.body)).not.toContain('smtp-secret-for-acceptance');
    expect(saved.body.passwordSet).toBe(true);
    const stored = (await db().select({ ciphertext: emailSettings.passwordCiphertext }).from(emailSettings))[0]!.ciphertext!;
    expect(stored).not.toContain('smtp-secret-for-acceptance');
    const audit = await db().select({ after: auditEvents.afterData }).from(auditEvents).where(eq(auditEvents.action, 'email.settings_updated'));
    expect(JSON.stringify(audit)).not.toContain('smtp-secret-for-acceptance');

    const preview = await send(admin, '/api/admin/email/templates/eoi_deadline/preview', { subject: 'EOI', bodyText: 'Due {{deadline}}: {{link}}' }, null).expect(200);
    expect(preview.body.text).toContain('/sample-link');
    const names = (await db().select({ name: opportunities.name }).from(opportunities)).map((row) => row.name);
    for (const name of names) expect(JSON.stringify(preview.body)).not.toContain(name);

    // The administrator has no commercial access.
    await admin.agent.get('/api/opportunities').expect(403);
    expect([403, 404]).toContain((await admin.agent.get(`/api/opportunities/${ids.oppRafiq}`)).status);
    await admin.agent.get('/api/dashboard').expect(403);
    await admin.agent.get('/api/search?q=Municipal&type=opportunity').expect(403);
    await admin.agent.get('/api/procurement').expect(403);

    // No one else reaches email administration, including the step 6 endpoints.
    for (const email of [emails.management, emails.leadGA, emails.salesGA1]) {
      const other = await signIn(ctx.app, email);
      await other.agent.get('/api/admin/email/notification-timing').expect(403);
      await put(other, '/api/admin/email/notification-timing', { version: 0 }).expect(403);
      await put(other, '/api/admin/email/templates/eoi_deadline', { version: 0, subject: 'x', bodyText: '{{link}}', enabled: true }).expect(403);
      expect((await send(other, '/api/admin/email/templates/eoi_deadline/preview', { subject: 'x', bodyText: '{{link}}' }, null)).status).toBe(403);
      expect((await send(other, '/api/admin/email/test', { to: 'x@example.test' }, null)).status).toBe(403);
    }
    await request(ctx.app).get('/api/admin/email/notification-timing').expect(401);
  });
});
