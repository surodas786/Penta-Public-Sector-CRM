/**
 * Milestone 2, AT-05: stage and status changes (FR-020, FR-021, BR-010–BR-012,
 * BR-014, D-001).
 *
 * Every assertion about a refused change also checks that nothing was written:
 * the version is unchanged, no audit event appeared and no follow-up moved.
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dhakaToday } from '../clock.js';
import { auditEvents, followUps, opportunities } from '../db/schema.js';
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

describe('stage and status transitions (AT-05)', () => {
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

  async function record(id: string) {
    const [row] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, id));
    return row!;
  }

  async function tasks(id: string) {
    return ctx.database.db.select().from(followUps).where(eq(followUps.opportunityId, id));
  }

  async function events(id: string, action?: string) {
    const rows = await ctx.database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.opportunityId, id), action ? eq(auditEvents.action, action) : undefined));
    return rows;
  }

  /** Asserts a refused request left the record, its tasks and its audit trail untouched. */
  async function expectUnchanged(id: string, before: { version: number; audit: number; open: number }) {
    const after = await record(id);
    expect(after.version).toBe(before.version);
    expect(await events(id)).toHaveLength(before.audit);
    expect((await tasks(id)).filter((task) => task.state === 'open')).toHaveLength(before.open);
  }

  async function snapshot(id: string) {
    return {
      version: (await record(id)).version,
      audit: (await events(id)).length,
      open: (await tasks(id)).filter((task) => task.state === 'open').length,
    };
  }

  const stage = (client: SignedInClient, id: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/opportunities/${id}/stage`, body, key);
  const status = (client: SignedInClient, id: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/opportunities/${id}/status`, body, key);
  const reopen = (client: SignedInClient, id: string, body: Record<string, unknown>) =>
    send(client, `/api/opportunities/${id}/reopen`, body);

  // -------------------------------------------------------------------------
  describe('stage changes (FR-021)', () => {
    it('moves forward one stage without an explanation and keeps the open follow-up', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);

      const response = await stage(client, ids.oppRafiq, { version: before.version, stage: 'awaiting_tender' });

      expect(response.status).toBe(200);
      expect(response.body.stage).toBe('awaiting_tender');
      expect(response.body.version).toBe(before.version + 1);
      expect(response.body.nextAction).not.toBeNull();

      const [event] = await events(ids.oppRafiq, 'opportunity.stage_changed');
      expect(event!.beforeData).toEqual({ stage: 'requirements_discussion' });
      expect(event!.afterData).toEqual({ stage: 'awaiting_tender' });
      expect(event!.actorId).toBe(ids.salesGA1);
      expect(event!.requestId).toBeTruthy();
    });

    it('requires an explanation to skip stages, and records it', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);

      const refused = await stage(client, ids.oppRafiq, { version: before.version, stage: 'bid_preparation' });
      expect(refused.status).toBe(422);
      expect(refused.body.fieldErrors.explanation).toMatch(/skipped/);
      await expectUnchanged(ids.oppRafiq, before);

      const accepted = await stage(client, ids.oppRafiq, {
        version: before.version,
        stage: 'bid_preparation',
        explanation: 'Tender was published directly; we are already preparing the bid.',
      });
      expect(accepted.status).toBe(200);
      const [event] = await events(ids.oppRafiq, 'opportunity.stage_changed');
      expect(event!.reason).toBe('Tender was published directly; we are already preparing the bid.');
    });

    it('requires an explanation to move backward', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);

      const refused = await stage(client, ids.oppRafiq, { version: before.version, stage: 'identified' });
      expect(refused.status).toBe(422);
      expect(refused.body.fieldErrors.explanation).toMatch(/earlier stage/);
      await expectUnchanged(ids.oppRafiq, before);

      const accepted = await stage(client, ids.oppRafiq, {
        version: before.version,
        stage: 'identified',
        explanation: 'Ministry restarted scoping.',
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body.stage).toBe('identified');
    });

    it('preserves every stage change as its own history entry', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      let version = (await record(ids.oppRafiq)).version;
      for (const next of ['awaiting_tender', 'tender_published', 'bid_preparation']) {
        const response = await stage(client, ids.oppRafiq, { version, stage: next });
        expect(response.status).toBe(200);
        version = response.body.version;
      }

      const history = await client.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);
      const stageEntries = history.body.items.filter(
        (entry: { action: string }) => entry.action === 'opportunity.stage_changed',
      );
      expect(stageEntries).toHaveLength(3);
      // Labels, not storage values.
      const labels = stageEntries.flatMap((entry: { changes: { after: string }[] }) =>
        entry.changes.map((change) => change.after),
      );
      expect(labels).toEqual(expect.arrayContaining(['Awaiting Tender', 'Tender Published', 'Bid Preparation']));
    });

    it('refuses a move to the current stage', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);
      const response = await stage(client, ids.oppRafiq, {
        version: before.version,
        stage: 'requirements_discussion',
      });
      expect(response.status).toBe(422);
      await expectUnchanged(ids.oppRafiq, before);
    });

    it('requires a next action when moving a record that has no open follow-up', async () => {
      // Set up the edge directly: an active record whose only task was closed
      // outside the services (as an imported record could be).
      await ctx.database.db
        .update(followUps)
        .set({ state: 'cancelled', cancelledAt: new Date(), cancelledBy: ids.salesGA1, cancellationReason: 'fixture' })
        .where(eq(followUps.opportunityId, ids.oppRafiq));

      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);

      const refused = await stage(client, ids.oppRafiq, { version: before.version, stage: 'awaiting_tender' });
      expect(refused.status).toBe(422);
      expect(refused.body.fieldErrors['nextFollowUp.title']).toBeTruthy();
      await expectUnchanged(ids.oppRafiq, before);

      const accepted = await stage(client, ids.oppRafiq, {
        version: before.version,
        stage: 'awaiting_tender',
        nextFollowUp: { title: 'Confirm the tender timetable', dueDate: '2027-02-01' },
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body.nextAction.title).toBe('Confirm the tender timetable');
      expect(accepted.body.nextAction.assigneeId).toBe(ids.salesGA1);
    });

    it('rejects a stale version with 409 and keeps the committed values', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);
      await stage(client, ids.oppRafiq, { version, stage: 'awaiting_tender' }).expect(200);
      const before = await snapshot(ids.oppRafiq);

      const stale = await stage(client, ids.oppRafiq, { version, stage: 'identified', explanation: 'Old view' });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('version_conflict');
      await expectUnchanged(ids.oppRafiq, before);
      expect((await record(ids.oppRafiq)).stage).toBe('awaiting_tender');
    });
  });

  // -------------------------------------------------------------------------
  describe('Awarded and Lost (BR-011)', () => {
    it('fails Awarded without the actual value and award date, writing nothing', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);

      const response = await stage(client, ids.oppRafiq, { version: before.version, stage: 'awarded' });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.awardedValue).toBeTruthy();
      expect(response.body.fieldErrors.awardDate).toBeTruthy();
      await expectUnchanged(ids.oppRafiq, before);
    });

    it.each([
      ['a zero value', { awardedValue: '0', awardDate: '2026-09-01' }, 'awardedValue'],
      ['a negative value', { awardedValue: '-5', awardDate: '2026-09-01' }, 'awardedValue'],
      ['three decimals', { awardedValue: '100.555', awardDate: '2026-09-01' }, 'awardedValue'],
      ['a future award date', { awardedValue: '1000', awardDate: '2099-01-01' }, 'awardDate'],
    ])('rejects Awarded with %s', async (_label, fields, field) => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);
      const response = await stage(client, ids.oppRafiq, { version: before.version, stage: 'awarded', ...fields });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors[field]).toBeTruthy();
      await expectUnchanged(ids.oppRafiq, before);
    });

    it('records Awarded with an exact decimal value and cancels — never completes — open tasks', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);

      const response = await stage(client, ids.oppRafiq, {
        version,
        stage: 'awarded',
        awardedValue: '41999999.99',
        awardDate: dhakaToday(),
      });

      expect(response.status).toBe(200);
      expect(response.body.stage).toBe('awarded');
      expect(response.body.awardedValue).toBe('41999999.99');
      expect(response.body.awardDate).toBe(dhakaToday());
      expect(response.body.nextAction).toBeNull();

      const rows = await tasks(ids.oppRafiq);
      expect(rows.length).toBeGreaterThan(0);
      for (const task of rows) {
        expect(task.state).toBe('cancelled');
        expect(task.completedAt).toBeNull();
        expect(task.cancelledBy).toBe(ids.salesGA1);
        expect(task.cancellationReason).toMatch(/marked Awarded/);
      }
      expect(await events(ids.oppRafiq, 'follow_up.cancelled')).toHaveLength(rows.length);
    });

    it('fails Lost without a reason and closed date', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);
      const response = await stage(client, ids.oppRafiq, { version: before.version, stage: 'lost' });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.lossReason).toBeTruthy();
      expect(response.body.fieldErrors.closedDate).toBeTruthy();
      await expectUnchanged(ids.oppRafiq, before);
    });

    it('requires explanatory text when the lost reason is Other', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);
      const response = await stage(client, ids.oppRafiq, {
        version: before.version,
        stage: 'lost',
        lossReason: 'other',
        closedDate: '2026-09-30',
      });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.lossNote).toBeTruthy();
      await expectUnchanged(ids.oppRafiq, before);
    });

    it('accepts only the six preset lost reasons', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);
      const response = await stage(client, ids.oppRafiq, {
        version: before.version,
        stage: 'lost',
        lossReason: 'politics',
        closedDate: '2026-09-30',
      });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.lossReason).toBeTruthy();
      await expectUnchanged(ids.oppRafiq, before);
    });

    it('records Lost with its reason and closes open tasks as Cancelled', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);
      const response = await stage(client, ids.oppRafiq, {
        version,
        stage: 'lost',
        lossReason: 'competitor_selected',
        lossNote: 'Lower bid by a local integrator.',
        closedDate: '2026-09-30',
      });
      expect(response.status).toBe(200);
      expect(response.body.lossReason).toBe('competitor_selected');
      expect(response.body.closedDate).toBe('2026-09-30');
      expect((await tasks(ids.oppRafiq)).every((task) => task.state === 'cancelled')).toBe(true);
    });

    it('lets a lead record an outcome for a section record', async () => {
      const client = await signIn(ctx.app, emails.leadGA);
      const { version } = await record(ids.oppTasnia);
      const response = await stage(client, ids.oppTasnia, {
        version,
        stage: 'lost',
        lossReason: 'no_bid',
        closedDate: '2026-09-30',
      });
      expect(response.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('reopening (BR-012)', () => {
    it('refuses a salesperson and a lead with 403 on a visible closed record', async () => {
      for (const email of [emails.salesGA1, emails.leadGA]) {
        const client = await signIn(ctx.app, email);
        const before = await snapshot(ids.oppRafiqAwarded);

        const viaStage = await stage(client, ids.oppRafiqAwarded, {
          version: before.version,
          stage: 'evaluation',
          explanation: 'Award withdrawn',
        });
        expect(viaStage.status).toBe(403);

        const viaReopen = await reopen(client, ids.oppRafiqAwarded, {
          version: before.version,
          stage: 'evaluation',
          reason: 'Award withdrawn',
          nextFollowUp: { title: 'Call the ministry', dueDate: '2027-01-10' },
        });
        expect(viaReopen.status).toBe(403);
        await expectUnchanged(ids.oppRafiqAwarded, before);
      }
    });

    it('requires management to give a reason and an open follow-up', async () => {
      const client = await signIn(ctx.app, emails.management);
      const before = await snapshot(ids.oppRafiqAwarded);

      const missing = await reopen(client, ids.oppRafiqAwarded, { version: before.version, stage: 'evaluation' });
      expect(missing.status).toBe(422);
      expect(missing.body.fieldErrors.reason).toBeTruthy();
      expect(missing.body.fieldErrors.nextFollowUp).toBeTruthy();
      await expectUnchanged(ids.oppRafiqAwarded, before);

      const terminalTarget = await reopen(client, ids.oppRafiqAwarded, {
        version: before.version,
        stage: 'lost',
        reason: 'Correction',
        nextFollowUp: { title: 'Call the ministry', dueDate: '2027-01-10' },
      });
      expect(terminalTarget.status).toBe(422);
      expect(terminalTarget.body.fieldErrors.stage).toBeTruthy();
    });

    it('reopens to a working stage, clears the outcome and keeps it in history', async () => {
      const client = await signIn(ctx.app, emails.management);
      const original = await record(ids.oppRafiqAwarded);

      const response = await reopen(client, ids.oppRafiqAwarded, {
        version: original.version,
        stage: 'evaluation',
        reason: 'Award was challenged and withdrawn by the ministry.',
        nextFollowUp: { title: 'Request the re-evaluation timetable', dueDate: '2027-01-10' },
      });

      expect(response.status).toBe(200);
      expect(response.body.stage).toBe('evaluation');
      expect(response.body.status).toBe('active');
      expect(response.body.awardedValue).toBeNull();
      expect(response.body.awardDate).toBeNull();
      expect(response.body.nextAction.title).toBe('Request the re-evaluation timetable');
      // Management is not an owner; the task defaults to the eligible owner.
      expect(response.body.nextAction.assigneeId).toBe(ids.salesGA1);

      const [event] = await events(ids.oppRafiqAwarded, 'opportunity.reopened');
      expect(event!.reason).toBe('Award was challenged and withdrawn by the ministry.');
      expect((event!.beforeData as Record<string, unknown>).awardedValue).toBe(original.awardedValue);
      expect((event!.beforeData as Record<string, unknown>).stage).toBe('awarded');

      // The owner can see the previous outcome in the commercial history.
      const owner = await signIn(ctx.app, emails.salesGA1);
      const history = await owner.agent.get(`/api/opportunities/${ids.oppRafiqAwarded}/history`).expect(200);
      const reopened = history.body.items.find((entry: { action: string }) => entry.action === 'opportunity.reopened');
      expect(reopened.reason).toMatch(/challenged/);
      const awarded = reopened.changes.find((change: { field: string }) => change.field === 'awardedValue');
      expect(awarded.before).toBe(original.awardedValue);
      expect(awarded.after).toBeNull();
    });

    it('refuses to reopen a record that is not closed', async () => {
      const client = await signIn(ctx.app, emails.management);
      const before = await snapshot(ids.oppRafiq);
      const response = await reopen(client, ids.oppRafiq, {
        version: before.version,
        stage: 'evaluation',
        reason: 'Mistake',
        nextFollowUp: { title: 'Call the ministry', dueDate: '2027-01-10' },
      });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('invalid_transition');
      await expectUnchanged(ids.oppRafiq, before);
    });

    it('tells management to use Reopen rather than a stage change on a closed record', async () => {
      const client = await signIn(ctx.app, emails.management);
      const before = await snapshot(ids.oppTasniaLost);
      const response = await stage(client, ids.oppTasniaLost, {
        version: before.version,
        stage: 'evaluation',
        explanation: 'x'.repeat(5),
      });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('invalid_transition');
    });

    it('keeps closed records read-only for basic edits until reopened', async () => {
      const client = await signIn(ctx.app, emails.management);
      const { version } = await record(ids.oppRafiqAwarded);
      const response = await client.agent
        .patch(`/api/opportunities/${ids.oppRafiqAwarded}`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', client.csrfToken)
        .send({ version, priority: 'low' });
      expect(response.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('On Hold and Cancelled (BR-010, BR-012, BR-014, D-001)', () => {
    it('requires a reason to put a record On Hold, then retains its stage and tasks', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);

      const refused = await status(client, ids.oppRafiq, { version: before.version, status: 'on_hold' });
      expect(refused.status).toBe(422);
      expect(refused.body.fieldErrors.reason).toBeTruthy();
      await expectUnchanged(ids.oppRafiq, before);

      const response = await status(client, ids.oppRafiq, {
        version: before.version,
        status: 'on_hold',
        reason: 'Ministry budget review until next quarter.',
      });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('on_hold');
      expect(response.body.stage).toBe('requirements_discussion');
      expect(response.body.statusNote).toBe('Ministry budget review until next quarter.');
      // On Hold keeps its tasks open.
      expect((await tasks(ids.oppRafiq)).filter((task) => task.state === 'open')).toHaveLength(before.open);
    });

    it('takes an On Hold record out of the active pipeline value', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const activeValue = async () => {
        const board = await client.agent.get('/api/opportunities/board').expect(200);
        return board.body.lanes
          .filter((lane: { lane: string }) => !['awarded', 'lost', 'on_hold', 'cancelled'].includes(lane.lane))
          .reduce((sum: bigint, lane: { value: string }) => sum + BigInt(lane.value.replace('.', '')), 0n);
      };

      const before = await activeValue();
      const target = await record(ids.oppRafiq);
      await status(client, ids.oppRafiq, { version: target.version, status: 'on_hold', reason: 'Paused' }).expect(200);
      const after = await activeValue();

      expect(before - after).toBe(BigInt(target.estimatedValue.replace('.', '')));

      const board = await client.agent.get('/api/opportunities/board').expect(200);
      const held = board.body.lanes.find((lane: { lane: string }) => lane.lane === 'on_hold');
      expect(held.items.map((item: { id: string }) => item.id)).toContain(ids.oppRafiq);
      const working = board.body.lanes.find((lane: { lane: string }) => lane.lane === 'requirements_discussion');
      expect(working.items.map((item: { id: string }) => item.id)).not.toContain(ids.oppRafiq);
    });

    it('refuses stage changes while On Hold, and returns to the retained stage', async () => {
      const client = await signIn(ctx.app, emails.salesGA2);
      const held = await record(ids.oppTasniaOnHold);

      const moved = await stage(client, ids.oppTasniaOnHold, { version: held.version, stage: 'awaiting_tender' });
      expect(moved.status).toBe(409);
      expect(moved.body.code).toBe('invalid_transition');

      // Its task was retained while held, so no new next action is required.
      const resumed = await status(client, ids.oppTasniaOnHold, {
        version: held.version,
        status: 'active',
        reason: 'Budget confirmed.',
      });
      expect(resumed.status).toBe(200);
      expect(resumed.body.status).toBe('active');
      expect(resumed.body.stage).toBe(held.stage);
      expect(resumed.body.statusNote).toBeNull();
      expect(resumed.body.nextAction).not.toBeNull();
    });

    it('cancels open tasks with a reason when a record is Cancelled', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);
      const response = await status(client, ids.oppRafiq, {
        version,
        status: 'cancelled',
        reason: 'Procurement withdrawn by the ministry.',
      });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancelled');
      expect(response.body.stage).toBe('requirements_discussion');
      expect(response.body.closedDate).toBe(dhakaToday());

      for (const task of await tasks(ids.oppRafiq)) {
        expect(task.state).toBe('cancelled');
        expect(task.completedAt).toBeNull();
        expect(task.cancellationReason).toMatch(/Procurement withdrawn/);
      }
    });

    it('requires a next action to return a Cancelled record to work', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);
      const cancelled = await status(client, ids.oppRafiq, { version, status: 'cancelled', reason: 'Withdrawn' });
      const before = await snapshot(ids.oppRafiq);

      const refused = await status(client, ids.oppRafiq, {
        version: cancelled.body.version,
        status: 'active',
        reason: 'Reissued',
      });
      expect(refused.status).toBe(422);
      expect(refused.body.fieldErrors['nextFollowUp.title']).toBeTruthy();
      await expectUnchanged(ids.oppRafiq, before);

      const resumed = await status(client, ids.oppRafiq, {
        version: cancelled.body.version,
        status: 'active',
        reason: 'Procurement reissued.',
        nextFollowUp: { title: 'Review the reissued notice', dueDate: '2027-01-20' },
      });
      expect(resumed.status).toBe(200);
      expect(resumed.body.stage).toBe('requirements_discussion');
      expect(resumed.body.closedDate).toBeNull();
      expect(resumed.body.nextAction.title).toBe('Review the reissued notice');
    });

    it('does not offer On Hold or Cancelled on a terminal record', async () => {
      const client = await signIn(ctx.app, emails.management);
      for (const next of ['on_hold', 'cancelled']) {
        const before = await snapshot(ids.oppRafiqAwarded);
        const response = await status(client, ids.oppRafiqAwarded, {
          version: before.version,
          status: next,
          reason: 'Should not be possible',
        });
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('invalid_transition');
        await expectUnchanged(ids.oppRafiqAwarded, before);
      }
    });

    it('does not record a next action when holding a record', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);
      const response = await status(client, ids.oppRafiq, {
        version: before.version,
        status: 'on_hold',
        reason: 'Paused',
        nextFollowUp: { title: 'Something', dueDate: '2027-01-01' },
      });
      expect(response.status).toBe(422);
      await expectUnchanged(ids.oppRafiq, before);
    });
  });

  // -------------------------------------------------------------------------
  describe('scope, permissions and idempotency', () => {
    it('returns the same 404 for an inaccessible and a nonexistent record', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppTasnia);

      const foreign = await stage(client, ids.oppTasnia, { version: before.version, stage: 'bid_submitted' });
      const absent = await stage(client, ABSENT_UUID, { version: 1, stage: 'bid_submitted' });

      expect(foreign.status).toBe(404);
      const strip = ({ requestId: _requestId, ...rest }: Record<string, unknown>) => rest;
      expect(strip(foreign.body)).toEqual(strip(absent.body));
      await expectUnchanged(ids.oppTasnia, before);
    });

    it('returns 404 to another section and to the administrator', async () => {
      for (const email of [emails.leadIS, emails.admin]) {
        const client = await signIn(ctx.app, email);
        const before = await snapshot(ids.oppRafiq);
        for (const response of [
          await stage(client, ids.oppRafiq, { version: before.version, stage: 'awaiting_tender' }),
          await status(client, ids.oppRafiq, { version: before.version, status: 'on_hold', reason: 'Probe' }),
          await reopen(client, ids.oppRafiqAwarded, {
            version: 1,
            stage: 'evaluation',
            reason: 'Probe',
            nextFollowUp: { title: 'Probe task', dueDate: '2027-01-01' },
          }),
        ]) {
          expect(response.status).toBe(404);
        }
        await expectUnchanged(ids.oppRafiq, before);
      }
    });

    it('ignores client-supplied owner, section or role fields', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await snapshot(ids.oppRafiq);
      const response = await stage(client, ids.oppRafiq, {
        version: before.version,
        stage: 'awaiting_tender',
        ownerId: ids.salesGA2,
        role: 'management',
      });
      expect(response.status).toBe(422);
      expect(Object.keys(response.body.fieldErrors)).toEqual(expect.arrayContaining(['ownerId', 'role']));
      await expectUnchanged(ids.oppRafiq, before);
    });

    it('replays a retried transition once, with one audit event', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);
      const key = nextIdempotencyKey('retry-stage');
      const body = { version, stage: 'awaiting_tender' };

      const first = await stage(client, ids.oppRafiq, body, key);
      const retry = await stage(client, ids.oppRafiq, body, key);

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(retry.body.version).toBe(first.body.version);
      expect(await events(ids.oppRafiq, 'opportunity.stage_changed')).toHaveLength(1);
    });

    it('rejects a reused key with a different payload, and a missing key', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);
      const key = nextIdempotencyKey('reuse-stage');
      await stage(client, ids.oppRafiq, { version, stage: 'awaiting_tender' }, key).expect(200);

      const reused = await stage(
        client,
        ids.oppRafiq,
        { version: version + 1, stage: 'tender_published' },
        key,
      );
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('idempotency_key_reuse');

      const keyless = await send(
        client,
        `/api/opportunities/${ids.oppRafiq}/stage`,
        { version: version + 1, stage: 'tender_published' },
        null,
      );
      expect(keyless.status).toBe(422);
    });

    it('does not replay a stored result after access is lost', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);
      const key = nextIdempotencyKey('revoked-stage');
      const body = { version, stage: 'awaiting_tender' };
      await stage(client, ids.oppRafiq, body, key).expect(200);

      // Simulate a transfer away from Rafiq (the M3 service does not exist yet).
      await ctx.database.db
        .update(opportunities)
        .set({ ownerId: ids.salesGA2 })
        .where(eq(opportunities.id, ids.oppRafiq));

      const replay = await stage(client, ids.oppRafiq, body, key);
      expect(replay.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('database guarantees (migration 0002)', () => {
    it.each([
      ['Awarded without an awarded value', sql`UPDATE opportunities SET stage = 'awarded', award_date = '2026-09-01' WHERE id = ${ids.oppRafiq}`],
      ['Lost without a reason', sql`UPDATE opportunities SET stage = 'lost', closed_date = '2026-09-01' WHERE id = ${ids.oppRafiq}`],
      ['a terminal record On Hold', sql`UPDATE opportunities SET status = 'on_hold', status_note = 'x' WHERE id = ${ids.oppRafiqAwarded}`],
      ['On Hold without an explanation', sql`UPDATE opportunities SET status = 'on_hold' WHERE id = ${ids.oppRafiq}`],
      ['a reopened record keeping its award', sql`UPDATE opportunities SET stage = 'evaluation' WHERE id = ${ids.oppRafiqAwarded}`],
      ['a cancelled task with no reason', sql`UPDATE follow_ups SET state = 'cancelled', cancelled_at = now(), cancelled_by = ${ids.salesGA1} WHERE opportunity_id = ${ids.oppRafiq}`],
      ['a completed task with no completer', sql`UPDATE follow_ups SET state = 'completed', completed_at = now() WHERE opportunity_id = ${ids.oppRafiq}`],
    ])('rejects %s even from the application role', async (_label, statement) => {
      const failure = await ctx.database.db.execute(statement).then(
        () => null,
        (error: unknown) => error as { cause?: { code?: string; message?: string } },
      );
      // Drizzle wraps the driver error; the PostgreSQL error is its cause.
      expect(failure?.cause?.code).toBe('23514'); // check_violation
      expect(failure?.cause?.message).toMatch(/violates check constraint/);
    });
  });
});
