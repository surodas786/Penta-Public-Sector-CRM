/**
 * Milestone 4: activities (FR-040, FR-041). Historical authorship never grants
 * current access.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { activities, auditEvents, opportunities } from '../db/schema.js';
import {
  ABSENT_UUID,
  TEST_ORIGIN,
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

const PAST = '2026-10-01T11:00:00+06:00';

describe('activities', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetFixtures();
  });

  const patch = (client: SignedInClient, path: string, body: unknown) =>
    client.agent.patch(path).set('Origin', TEST_ORIGIN).set('x-csrf-token', client.csrfToken).send(body as object);
  const log = (client: SignedInClient, opportunityId: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/opportunities/${opportunityId}/activities`, body, key);

  async function activity(id: string) {
    const [row] = await ctx.database.db.select().from(activities).where(eq(activities.id, id));
    return row!;
  }

  // -------------------------------------------------------------------------
  describe('logging (FR-040)', () => {
    it('lists an opportunity’s activities newest first, with their authors', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/activities`).expect(200);
      expect(response.body.total).toBe(3);
      const times = response.body.items.map((item: { occurredAt: string }) => item.occurredAt);
      expect([...times].sort().reverse()).toEqual(times);
      expect(response.body.items.every((item: { authorName: string }) => item.authorName === 'Rafiq Hasan')).toBe(true);
    });

    it('logs a call with a linked contact, in Bangla, once even when retried', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('activity');
      const body = {
        type: 'phone_call',
        occurredAt: PAST,
        subject: 'সিইও-র সাথে ফোনালাপ',
        notes: 'পর্যায়ভিত্তিক বাস্তবায়নের প্রস্তাব নিয়ে আলোচনা হয়েছে।',
        contactId: ids.contactGolam,
      };
      const first = await log(rafiq, ids.oppRafiq, body, key);
      expect(first.status).toBe(201);
      expect(first.body.subject).toBe('সিইও-র সাথে ফোনালাপ');
      expect(first.body.contact.fullName).toBe('Golam Mostafa');
      expect(first.body.occurredAt).toBe('2026-10-01T05:00:00.000Z');

      const retry = await log(rafiq, ids.oppRafiq, body, key);
      expect(retry.status).toBe(200);
      expect(retry.body.id).toBe(first.body.id);

      const search = await rafiq.agent.get('/api/activities').query({ q: 'ফোনালাপ' }).expect(200);
      expect(search.body.items.map((item: { id: string }) => item.id)).toEqual([first.body.id]);
    });

    it.each([
      ['a contact not linked to the opportunity', { contactId: ids.contactFarzana }, 'contactId'],
      ['a time in the future', { occurredAt: '2099-01-01T10:00:00+06:00' }, 'occurredAt'],
      ['no subject', { subject: '' }, 'subject'],
      ['an unknown type', { type: 'telegram' }, 'type'],
      ['a time without an offset', { occurredAt: '2026-10-01T11:00' }, 'occurredAt'],
    ])('refuses %s', async (_label, override, field) => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await log(rafiq, ids.oppRafiq, { type: 'meeting', occurredAt: PAST, subject: 'Check', ...override });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors[field]).toBeTruthy();
    });

    it('creates the optional next action as a follow-up in the same transaction', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await log(rafiq, ids.oppRafiq, {
        type: 'meeting',
        occurredAt: PAST,
        subject: 'Scope workshop',
        nextFollowUp: { title: 'Send the workshop minutes', dueDate: '2027-01-12' },
      });
      expect(response.status).toBe(201);
      const tasks = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/follow-ups`).expect(200);
      expect(tasks.body.items.map((task: { title: string }) => task.title)).toContain('Send the workshop minutes');
    });

    it('refuses a next action on a closed record and then saves no activity either', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const before = (await ctx.database.db.select().from(activities).where(eq(activities.opportunityId, ids.oppRafiqAwarded))).length;
      const response = await log(rafiq, ids.oppRafiqAwarded, {
        type: 'meeting',
        occurredAt: PAST,
        subject: 'Kick-off after award',
        nextFollowUp: { title: 'Plan the kick-off', dueDate: '2027-01-12' },
      });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors['nextFollowUp.title']).toBeTruthy();
      const after = (await ctx.database.db.select().from(activities).where(eq(activities.opportunityId, ids.oppRafiqAwarded))).length;
      expect(after).toBe(before);
    });

    it('refuses an inaccessible opportunity like a missing one', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const body = { type: 'meeting', occurredAt: PAST, subject: 'Probe' };
      const foreign = await log(rafiq, ids.oppTasnia, body);
      const missing = await log(rafiq, ABSENT_UUID, body);
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      const admin = await signIn(ctx.app, emails.admin);
      expect((await log(admin, ids.oppRafiq, body)).status).toBe(404);
      await admin.agent.get('/api/activities').expect(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('amending (FR-041)', () => {
    it('lets the author amend, records the edit, and refuses a stale version', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const before = await activity(ids.activityRafiqVisit);

      const response = await patch(rafiq, `/api/activities/${ids.activityRafiqVisit}`, {
        version: before.version,
        notes: 'Met the CEO and the ICT Cell; discussed the service backlog.',
      });
      expect(response.status).toBe(200);
      expect(response.body.version).toBe(before.version + 1);
      expect(response.body.editedByName).toBe('Rafiq Hasan');
      expect(response.body.authorName).toBe('Rafiq Hasan');

      const [event] = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.entityId, ids.activityRafiqVisit));
      expect(event!.action).toBe('activity.updated');
      expect((event!.beforeData as Record<string, unknown>).notes).toBe(before.notes);

      const stale = await patch(rafiq, `/api/activities/${ids.activityRafiqVisit}`, { version: before.version, subject: 'Late' });
      expect(stale.status).toBe(409);
    });

    it('lets a salesperson amend only their own, and a lead or management any in scope', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const hers = await log(nadia, ids.oppRafiq, { type: 'internal_discussion', occurredAt: PAST, subject: 'Lead review' }).expect(201);

      const rafiq = await signIn(ctx.app, emails.salesGA1);
      expect(hers.body.canEdit).toBe(true);
      const list = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/activities`).expect(200);
      const seen = list.body.items.find((item: { id: string }) => item.id === hers.body.id);
      expect(seen.canEdit).toBe(false);
      const refused = await patch(rafiq, `/api/activities/${hers.body.id}`, { version: hers.body.version, subject: 'Changed by owner' });
      expect(refused.status).toBe(403);

      const leadEdit = await patch(nadia, `/api/activities/${ids.activityRafiqVisit}`, {
        version: (await activity(ids.activityRafiqVisit)).version,
        subject: 'Introductory visit (corrected)',
      });
      expect(leadEdit.status).toBe(200);
      // The original author is kept.
      expect(leadEdit.body.authorName).toBe('Rafiq Hasan');
      expect(leadEdit.body.editedByName).toBe('Nadia Islam');
    });

    it('can never be deleted, even by the application role', async () => {
      const failure = await ctx.database.db
        .execute(sql`DELETE FROM activities WHERE id = ${ids.activityRafiqVisit}`)
        .then(() => null, (error: unknown) => error as { cause?: { code?: string } });
      expect(failure?.cause?.code).toBe('42501'); // insufficient_privilege
      expect(await activity(ids.activityRafiqVisit)).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe('authorship is history, not access', () => {
    it('takes a transferred record’s activities away from their author, and keeps the author named', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const [p1] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));
      await send(nadia, `/api/opportunities/${ids.oppRafiq}/transfer`, {
        version: p1!.version,
        newOwnerId: ids.salesGA2,
        reason: 'Handover',
      }).expect(200);

      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/activities`).expect(404);
      const amend = await patch(rafiq, `/api/activities/${ids.activityRafiqVisit}`, { version: 1, subject: 'Still mine?' });
      expect(amend.status).toBe(404);
      const mine = await rafiq.agent.get('/api/activities').query({ authoredBy: 'me', pageSize: 100 }).expect(200);
      expect(mine.body.items.map((item: { opportunity: { id: string } }) => item.opportunity.id)).not.toContain(ids.oppRafiq);

      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const theirs = await tasnia.agent.get(`/api/opportunities/${ids.oppRafiq}/activities`).expect(200);
      expect(theirs.body.items.every((item: { authorName: string }) => item.authorName === 'Rafiq Hasan')).toBe(true);
      // The new owner did not write them, so cannot amend them.
      expect(theirs.body.items.every((item: { canEdit: boolean }) => item.canEdit === false)).toBe(true);
    });

    it('scopes the Activity Log to accessible opportunities', async () => {
      const imran = await signIn(ctx.app, emails.salesIS1);
      const list = await imran.agent.get('/api/activities').query({ pageSize: 100 }).expect(200);
      const owned = new Set(
        (await ctx.database.db.select().from(opportunities).where(eq(opportunities.ownerId, ids.salesIS1))).map((row) => row.id),
      );
      expect(list.body.items.length).toBeGreaterThan(0);
      for (const item of list.body.items) expect(owned.has(item.opportunity.id)).toBe(true);

      const calls = await imran.agent.get('/api/activities').query({ type: 'phone_call' }).expect(200);
      expect(calls.body.items.every((item: { type: string }) => item.type === 'phone_call')).toBe(true);
      await imran.agent.get('/api/activities').query({ type: 'fax' }).expect(422);
    });
  });
});
