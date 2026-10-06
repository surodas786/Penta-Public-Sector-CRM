/**
 * Milestone 2, AT-06: the follow-up lifecycle (FR-042, FR-043, BR-013,
 * BR-014, BR-030).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, followUps, opportunities, users } from '../db/schema.js';
import {
  ABSENT_UUID,
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

describe('follow-up lifecycle (AT-06)', () => {
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

  afterEach(() => {
    resetClock();
  });

  async function openTasks(opportunityId: string) {
    return ctx.database.db
      .select()
      .from(followUps)
      .where(and(eq(followUps.opportunityId, opportunityId), eq(followUps.state, 'open')));
  }

  async function task(id: string) {
    const [row] = await ctx.database.db.select().from(followUps).where(eq(followUps.id, id));
    return row!;
  }

  async function auditCount(entityId: string, action?: string) {
    const rows = await ctx.database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, entityId), action ? eq(auditEvents.action, action) : undefined));
    return rows.length;
  }

  /** The single open task every active seeded opportunity starts with. */
  async function onlyOpenTask(opportunityId: string) {
    const rows = await openTasks(opportunityId);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  const create = (client: SignedInClient, opportunityId: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/opportunities/${opportunityId}/follow-ups`, body, key);
  const complete = (client: SignedInClient, id: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/follow-ups/${id}/complete`, body, key);
  const reschedule = (client: SignedInClient, id: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/follow-ups/${id}/reschedule`, body, key);
  const cancel = (client: SignedInClient, id: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/follow-ups/${id}/cancel`, body, key);

  // -------------------------------------------------------------------------
  describe('completing the last open task (BR-014)', () => {
    it('refuses to complete the only open task of an active record without a replacement', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);

      const response = await complete(client, only.id, { version: only.version });

      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.replacement).toMatch(/only open follow-up/);
      expect((await task(only.id)).state).toBe('open');
      expect(await auditCount(only.id)).toBe(0);
    });

    it('completes it together with a replacement, which becomes the next action', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);

      const response = await complete(client, only.id, {
        version: only.version,
        completionNote: 'Ministry confirmed the scope in writing.',
        replacement: { title: 'Send the revised proposal', dueDate: '2027-02-10' },
      });

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('completed');
      expect(response.body.completedByName).toBe('Rafiq Hasan');
      expect(response.body.completionNote).toBe('Ministry confirmed the scope in writing.');
      expect(response.body.version).toBe(only.version + 1);

      const detail = await client.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
      expect(detail.body.nextAction.title).toBe('Send the revised proposal');
      expect(detail.body.nextAction.assigneeId).toBe(ids.salesGA1);
      expect(await auditCount(only.id, 'follow_up.completed')).toBe(1);
    });

    it('completes a task freely when another open task remains', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);
      await create(client, ids.oppRafiq, {
        title: 'Book the demo room',
        dueDate: '2027-03-01',
        assigneeId: ids.salesGA1,
      }).expect(201);

      const response = await complete(client, only.id, { version: only.version });
      expect(response.status).toBe(200);
      expect((await openTasks(ids.oppRafiq)).map((row) => row.title)).toEqual(['Book the demo room']);
    });

    it('lets the last task of an On Hold record close without a replacement', async () => {
      const client = await signIn(ctx.app, emails.salesGA2);
      const only = await onlyOpenTask(ids.oppTasniaOnHold);
      const response = await complete(client, only.id, { version: only.version });
      expect(response.status).toBe(200);
    });

    it('applies the same rule to cancelling the last open task', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);

      const missingReason = await cancel(client, only.id, { version: only.version });
      expect(missingReason.status).toBe(422);
      expect(missingReason.body.fieldErrors.reason).toBeTruthy();

      const missingReplacement = await cancel(client, only.id, { version: only.version, reason: 'No longer needed' });
      expect(missingReplacement.status).toBe(422);
      expect(missingReplacement.body.fieldErrors.replacement).toBeTruthy();

      const response = await cancel(client, only.id, {
        version: only.version,
        reason: 'Superseded by a site visit',
        replacement: { title: 'Visit the directorate office', dueDate: '2027-01-25' },
      });
      expect(response.status).toBe(200);
      expect(response.body.state).toBe('cancelled');
      expect(response.body.cancellationReason).toBe('Superseded by a site visit');
      expect(response.body.completedAt).toBeNull();
      expect(await openTasks(ids.oppRafiq)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('repeated requests (BR-030, BR-091)', () => {
    it('replays a double-clicked completion with one history entry', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);
      const key = nextIdempotencyKey('double-click');
      const body = {
        version: only.version,
        replacement: { title: 'Next call', dueDate: '2027-02-01' },
      };

      const first = await complete(client, only.id, body, key);
      const second = await complete(client, only.id, body, key);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.completedAt).toBe(first.body.completedAt);
      expect(await auditCount(only.id, 'follow_up.completed')).toBe(1);
      // The replacement was created once, not twice.
      expect(await openTasks(ids.oppRafiq)).toHaveLength(1);
    });

    it('refuses a second completion under a new key without writing history', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);
      const body = { version: only.version, replacement: { title: 'Next call', dueDate: '2027-02-01' } };

      await complete(client, only.id, body).expect(200);
      const again = await complete(client, only.id, body);

      expect(again.status).toBe(409);
      expect(await auditCount(only.id, 'follow_up.completed')).toBe(1);
      expect(await openTasks(ids.oppRafiq)).toHaveLength(1);
    });

    it('refuses to act on a task that is no longer open', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);
      const done = await complete(client, only.id, {
        version: only.version,
        replacement: { title: 'Next call', dueDate: '2027-02-01' },
      });

      const response = await reschedule(client, only.id, {
        version: done.body.version,
        dueDate: '2027-05-01',
        reason: 'Late change',
      });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('invalid_transition');
    });
  });

  // -------------------------------------------------------------------------
  describe('rescheduling and the Dhaka date (FR-043)', () => {
    it('records the old date, new date, actor and reason', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);

      const missingReason = await reschedule(client, only.id, { version: only.version, dueDate: '2027-04-01' });
      expect(missingReason.status).toBe(422);

      const sameDate = await reschedule(client, only.id, {
        version: only.version,
        dueDate: only.dueDate,
        reason: 'No change',
      });
      expect(sameDate.status).toBe(422);
      expect(sameDate.body.fieldErrors.dueDate).toBeTruthy();

      const response = await reschedule(client, only.id, {
        version: only.version,
        dueDate: '2027-04-01',
        reason: 'Ministry asked to meet after Eid.',
      });
      expect(response.status).toBe(200);
      expect(response.body.dueDate).toBe('2027-04-01');

      const [event] = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, only.id), eq(auditEvents.action, 'follow_up.rescheduled')));
      expect(event!.actorId).toBe(ids.salesGA1);
      expect((event!.beforeData as Record<string, unknown>).dueDate).toBe(only.dueDate);
      expect((event!.afterData as Record<string, unknown>).dueDate).toBe('2027-04-01');
      expect(event!.reason).toBe('Ministry asked to meet after Eid.');
    });

    it('decides overdue against the Dhaka calendar date, around Dhaka midnight', async () => {
      // 23:59 on 14 January in Dhaka is still 17:59 UTC on the 14th.
      const clock = new FixedClock('2027-01-14T17:59:00Z');
      setClock(clock);
      const client = await signIn(ctx.app, emails.salesGA1);

      await create(client, ids.oppRafiq, {
        title: 'Boundary task due 14 Jan',
        dueDate: '2027-01-14',
        assigneeId: ids.salesGA1,
      }).expect(201);

      const bucket = async () => {
        const response = await client.agent
          .get('/api/follow-ups')
          .query({ view: 'all', q: 'Boundary task' })
          .expect(200);
        return {
          today: response.body.today as string,
          overdue: response.body.counts.overdue as number,
          dueToday: response.body.counts.today as number,
        };
      };

      expect(await bucket()).toEqual({ today: '2027-01-14', overdue: 0, dueToday: 1 });

      // One minute later it is midnight in Dhaka (18:00 UTC): now overdue.
      clock.set('2027-01-14T18:00:00Z');
      expect(await bucket()).toEqual({ today: '2027-01-15', overdue: 1, dueToday: 0 });
    });

    it('moves a task out of Overdue when it is rescheduled', async () => {
      setClock(new FixedClock('2027-01-20T06:00:00Z'));
      const client = await signIn(ctx.app, emails.salesGA1);
      const created = await create(client, ids.oppRafiq, {
        title: 'Overdue chase',
        dueDate: '2027-01-10',
        assigneeId: ids.salesGA1,
      }).expect(201);

      const overdueBefore = await client.agent
        .get('/api/follow-ups')
        .query({ view: 'overdue', q: 'Overdue chase' })
        .expect(200);
      expect(overdueBefore.body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id]);

      await reschedule(client, created.body.id, {
        version: created.body.version,
        dueDate: '2027-01-25',
        reason: 'Agreed a new date by phone.',
      }).expect(200);

      const overdueAfter = await client.agent
        .get('/api/follow-ups')
        .query({ view: 'overdue', q: 'Overdue chase' })
        .expect(200);
      expect(overdueAfter.body.total).toBe(0);
      const upcoming = await client.agent
        .get('/api/follow-ups')
        .query({ view: 'upcoming', q: 'Overdue chase' })
        .expect(200);
      expect(upcoming.body.total).toBe(1);
    });

    it('accepts a historical task with a past due date and shows it as overdue at once', async () => {
      setClock(new FixedClock('2027-01-20T06:00:00Z'));
      const client = await signIn(ctx.app, emails.salesGA1);
      await create(client, ids.oppRafiq, {
        title: 'Historical follow-up entry',
        dueDate: '2026-12-01',
        assigneeId: ids.salesGA1,
      }).expect(201);
      const list = await client.agent
        .get('/api/follow-ups')
        .query({ view: 'overdue', q: 'Historical follow-up' })
        .expect(200);
      expect(list.body.total).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('assignment eligibility (FR-042, D-004)', () => {
    it('lets a salesperson assign only to themselves', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const toLead = await create(client, ids.oppRafiq, { title: 'Ask Nadia', dueDate: '2027-01-10', assigneeId: ids.leadGA });
      expect(toLead.status).toBe(422);
      expect(toLead.body.fieldErrors.assigneeId).toBeTruthy();

      const options = await client.agent.get(`/api/opportunities/${ids.oppRafiq}/follow-up-assignees`).expect(200);
      expect(options.body.items.map((item: { id: string }) => item.id)).toEqual([ids.salesGA1]);
    });

    it('lets a lead assign to the owner or themselves, but not another salesperson', async () => {
      const client = await signIn(ctx.app, emails.leadGA);
      await create(client, ids.oppRafiq, { title: 'Owner task', dueDate: '2027-01-10', assigneeId: ids.salesGA1 }).expect(201);
      await create(client, ids.oppRafiq, { title: 'Lead task', dueDate: '2027-01-10', assigneeId: ids.leadGA }).expect(201);

      // Tasnia shares the section but cannot see Rafiq's record; assignment
      // must not grant her access.
      const colleague = await create(client, ids.oppRafiq, {
        title: 'Colleague task',
        dueDate: '2027-01-10',
        assigneeId: ids.salesGA2,
      });
      expect(colleague.status).toBe(422);
    });

    it('lets management assign to the owner, the section lead or management', async () => {
      const client = await signIn(ctx.app, emails.management);
      const options = await client.agent.get(`/api/opportunities/${ids.oppRafiq}/follow-up-assignees`).expect(200);
      const relations = Object.fromEntries(
        options.body.items.map((item: { id: string; relation: string }) => [item.id, item.relation]),
      );
      expect(relations[ids.salesGA1]).toBe('owner');
      expect(relations[ids.leadGA]).toBe('section_lead');
      expect(relations[ids.management]).toBe('management');
      expect(relations[ids.leadIS]).toBeUndefined();
      expect(relations[ids.salesGA2]).toBeUndefined();
      // The response is minimal: no email or account fields.
      expect(Object.keys(options.body.items[0]).sort()).toEqual(['fullName', 'id', 'relation']);

      // D-004: a task assigned to management.
      await create(client, ids.oppRafiq, {
        title: 'Approve ERP bid submission',
        dueDate: '2027-01-10',
        assigneeId: ids.management,
      }).expect(201);

      const otherLead = await create(client, ids.oppRafiq, { title: 'Wrong lead', dueDate: '2027-01-10', assigneeId: ids.leadIS });
      expect(otherLead.status).toBe(422);
    });

    /** An owner who has left: their active record stays in the section. */
    async function deactivateTasnia() {
      await ctx.database.db.update(users).set({ active: false }).where(eq(users.id, ids.salesGA2));
    }

    it('never assigns to a deactivated account', async () => {
      await deactivateTasnia();
      const client = await signIn(ctx.app, emails.management);
      const response = await create(client, ids.oppTasnia, {
        title: 'For the former owner',
        dueDate: '2027-01-10',
        assigneeId: ids.salesGA2,
      });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.assigneeId).toBeTruthy();
    });

    it('defaults a replacement to the lead when the owner is inactive', async () => {
      await deactivateTasnia();
      const client = await signIn(ctx.app, emails.leadGA);
      const only = await onlyOpenTask(ids.oppTasnia);
      const response = await complete(client, only.id, {
        version: only.version,
        replacement: { title: 'Lead picks this up', dueDate: '2027-01-10' },
      });
      expect(response.status).toBe(200);
      const [replacement] = await openTasks(ids.oppTasnia);
      expect(replacement!.assignedUserId).toBe(ids.leadGA);
    });

    it('refuses new tasks on closed records and accepts them while On Hold', async () => {
      const management = await signIn(ctx.app, emails.management);
      const awarded = await create(management, ids.oppRafiqAwarded, {
        title: 'After award',
        dueDate: '2027-01-10',
        assigneeId: ids.salesGA1,
      });
      expect(awarded.status).toBe(409);
      const cancelled = await create(management, ids.oppCancelledIS, {
        title: 'After cancel',
        dueDate: '2027-01-10',
        assigneeId: ids.salesIS1,
      });
      expect(cancelled.status).toBe(409);

      const held = await create(management, ids.oppTasniaOnHold, {
        title: 'While held',
        dueDate: '2027-01-10',
        assigneeId: ids.salesGA2,
      });
      expect(held.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('scope (SEC-003, SEC-004)', () => {
    it('returns one 404 for a colleague’s task and a nonexistent one', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const foreign = await onlyOpenTask(ids.oppTasnia);

      const responses = [
        await complete(client, foreign.id, { version: foreign.version }),
        await complete(client, ABSENT_UUID, { version: 1 }),
        await reschedule(client, foreign.id, { version: foreign.version, dueDate: '2027-09-09', reason: 'Probe' }),
        await cancel(client, foreign.id, { version: foreign.version, reason: 'Probe' }),
      ];
      const strip = ({ requestId: _requestId, ...rest }: Record<string, unknown>) => rest;
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(strip(response.body)).toEqual(strip(responses[1]!.body));
      }
      expect((await task(foreign.id)).state).toBe('open');
    });

    it('refuses the administrator: 403 on the list, 404 on a task', async () => {
      const client = await signIn(ctx.app, emails.admin);
      await client.agent.get('/api/follow-ups').expect(403);
      const someTask = await onlyOpenTask(ids.oppRafiq);
      const response = await complete(client, someTask.id, { version: someTask.version });
      expect(response.status).toBe(404);
    });

    it('scopes the follow-up list and its counts; an assignee filter never widens it', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const own = await rafiq.agent.get('/api/follow-ups').query({ view: 'all', pageSize: 100 }).expect(200);
      const ownedIds = new Set(
        (await ctx.database.db
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(eq(opportunities.ownerId, ids.salesGA1))).map((row) => row.id),
      );
      expect(own.body.items.length).toBeGreaterThan(0);
      for (const item of own.body.items) expect(ownedIds.has(item.opportunity.id)).toBe(true);
      expect(own.body.total).toBe(own.body.items.length);

      const filtered = await rafiq.agent
        .get('/api/follow-ups')
        .query({ view: 'all', assignedTo: ids.salesGA2 })
        .expect(200);
      expect(filtered.body.total).toBe(0);

      const management = await signIn(ctx.app, emails.management);
      const everything = await management.agent.get('/api/follow-ups').query({ view: 'all' }).expect(200);
      const [allRows] = await ctx.database.db.select({ id: followUps.id }).from(followUps).then((rows) => [rows.length]);
      expect(everything.body.counts.all).toBe(allRows);
      expect(everything.body.counts.open).toBe(
        everything.body.counts.overdue + everything.body.counts.today + everything.body.counts.upcoming,
      );
    });

    it('rejects unknown views and malformed filters with 422', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      await client.agent.get('/api/follow-ups').query({ view: 'mine' }).expect(422);
      await client.agent.get('/api/follow-ups').query({ assignedTo: 'not-a-uuid' }).expect(422);
      await client.agent.get('/api/follow-ups').query({ pageSize: '101' }).expect(422);
    });

    it('shows follow-up events in the opportunity history with the task named', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const only = await onlyOpenTask(ids.oppRafiq);
      await reschedule(client, only.id, { version: only.version, dueDate: '2027-06-01', reason: 'Moved' }).expect(200);

      const history = await client.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);
      const entry = history.body.items.find((item: { action: string }) => item.action === 'follow_up.rescheduled');
      expect(entry.subject).toBe(only.title);
      expect(entry.reason).toBe('Moved');
      expect(entry.changes).toEqual([
        { field: 'dueDate', label: 'Due date', before: only.dueDate, after: '2027-06-01' },
      ]);
    });
  });
});
