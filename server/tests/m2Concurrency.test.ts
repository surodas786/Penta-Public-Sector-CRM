/**
 * Milestone 2 races (BR-090, BR-014, AT-06).
 *
 * Requests are issued together through the in-process app, which serves them
 * from separate pool connections, so the database really does see concurrent
 * transactions. Each scenario runs several rounds because a race that passes
 * once can still be unsafe.
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEvents, followUps, opportunities } from '../db/schema.js';
import {
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

const ROUNDS = 4;

describe('M2 concurrency', () => {
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

  async function openTasks(opportunityId: string) {
    return ctx.database.db
      .select()
      .from(followUps)
      .where(and(eq(followUps.opportunityId, opportunityId), eq(followUps.state, 'open')));
  }

  /** BR-013/BR-014 across the whole database. */
  async function activeRecordsWithoutNextAction(): Promise<string[]> {
    const rows = await ctx.database.db.execute<{ reference: string }>(sql`
      SELECT o.reference FROM ${opportunities} o
      WHERE o.status = 'active' AND o.stage NOT IN ('awarded', 'lost')
        AND NOT EXISTS (SELECT 1 FROM ${followUps} f WHERE f.opportunity_id = o.id AND f.state = 'open')`);
    return rows.rows.map((row) => row.reference);
  }

  async function addTask(client: SignedInClient, title: string) {
    const response = await send(client, `/api/opportunities/${ids.oppRafiq}/follow-ups`, {
      title,
      dueDate: '2027-03-01',
      assigneeId: ids.salesGA1,
    });
    expect(response.status).toBe(201);
    return response.body as { id: string; version: number };
  }

  it('lets only one of two simultaneous completions take the last two open tasks', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await resetFixtures();
      const owner = await signIn(ctx.app, emails.salesGA1);
      const lead = await signIn(ctx.app, emails.leadGA);
      const [first] = await openTasks(ids.oppRafiq);
      const second = await addTask(owner, `Second task ${round}`);

      const [a, b] = await Promise.all([
        send(owner, `/api/follow-ups/${first!.id}/complete`, { version: first!.version }),
        send(lead, `/api/follow-ups/${second.id}/complete`, { version: second.version }),
      ]);

      // Serialised on the opportunity lock: the second to run sees that its
      // task has become the last one and is told to supply a replacement.
      expect([a.status, b.status].sort()).toEqual([200, 422]);
      expect(await openTasks(ids.oppRafiq)).toHaveLength(1);
      expect(await activeRecordsWithoutNextAction()).toEqual([]);
    }
  });

  it('accepts exactly one of two stage changes made from the same version', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await resetFixtures();
      const owner = await signIn(ctx.app, emails.salesGA1);
      const manager = await signIn(ctx.app, emails.management);
      const [row] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));

      const [a, b] = await Promise.all([
        send(owner, `/api/opportunities/${ids.oppRafiq}/stage`, { version: row!.version, stage: 'awaiting_tender' }),
        send(manager, `/api/opportunities/${ids.oppRafiq}/stage`, {
          version: row!.version,
          stage: 'identified',
          explanation: 'Restarting scoping',
        }),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.code).toBe('version_conflict');

      const changes = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.opportunityId, ids.oppRafiq), eq(auditEvents.action, 'opportunity.stage_changed')));
      expect(changes).toHaveLength(1);
      const [after] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));
      expect(after!.version).toBe(row!.version + 1);
    }
  });

  it('never leaves an open task, or a task both done and cancelled, when completion races a Lost outcome', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await resetFixtures();
      const owner = await signIn(ctx.app, emails.salesGA1);
      const lead = await signIn(ctx.app, emails.leadGA);
      const second = await addTask(owner, `Racing task ${round}`);
      const [row] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));

      const [completion, outcome] = await Promise.all([
        send(owner, `/api/follow-ups/${second.id}/complete`, { version: second.version }),
        send(lead, `/api/opportunities/${ids.oppRafiq}/stage`, {
          version: row!.version,
          stage: 'lost',
          lossReason: 'budget_unavailable',
          closedDate: '2026-09-30',
        }),
      ]);

      expect(outcome.status).toBe(200);
      // Either the completion ran first (200), or the outcome cancelled the
      // task first and the completion found it closed (409).
      expect([200, 409]).toContain(completion.status);

      const tasks = await ctx.database.db.select().from(followUps).where(eq(followUps.opportunityId, ids.oppRafiq));
      expect(tasks.filter((task) => task.state === 'open')).toHaveLength(0);
      for (const task of tasks) {
        expect(task.completedAt !== null && task.cancelledAt !== null).toBe(false);
      }
      const racing = tasks.find((task) => task.id === second.id)!;
      expect(racing.state).toBe(completion.status === 200 ? 'completed' : 'cancelled');
    }
  });

  it('applies a retried completion sent twice at once only once', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await resetFixtures();
      const owner = await signIn(ctx.app, emails.salesGA1);
      const [only] = await openTasks(ids.oppRafiq);
      const key = nextIdempotencyKey(`same-key-${round}`);
      const body = { version: only!.version, replacement: { title: 'Next step', dueDate: '2027-02-01' } };

      const [a, b] = await Promise.all([
        send(owner, `/api/follow-ups/${only!.id}/complete`, body, key),
        send(owner, `/api/follow-ups/${only!.id}/complete`, body, key),
      ]);

      // One applies it; the other replays it or is told it is in flight.
      expect([a.status, b.status]).toContain(200);
      for (const response of [a, b]) expect([200, 409]).toContain(response.status);

      const completions = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, only!.id), eq(auditEvents.action, 'follow_up.completed')));
      expect(completions).toHaveLength(1);
      expect(await openTasks(ids.oppRafiq)).toHaveLength(1);
    }
  });

  it('keeps the next-action invariant through a mixed burst of operations', async () => {
    const owner = await signIn(ctx.app, emails.salesGA1);
    const lead = await signIn(ctx.app, emails.leadGA);
    const manager = await signIn(ctx.app, emails.management);
    await addTask(owner, 'Burst task A');
    await addTask(lead, 'Burst task B');

    const tasks = await openTasks(ids.oppRafiq);
    const [row] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));

    await Promise.all([
      ...tasks.map((task, index) =>
        send([owner, lead, manager][index % 3]!, `/api/follow-ups/${task.id}/complete`, { version: task.version }),
      ),
      send(manager, `/api/opportunities/${ids.oppRafiq}/status`, {
        version: row!.version,
        status: 'on_hold',
        reason: 'Paused during the burst',
      }),
    ]);

    const [after] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));
    const open = await openTasks(ids.oppRafiq);
    // Held records may run out of tasks; active ones may not.
    if (after!.status === 'active') expect(open.length).toBeGreaterThan(0);
    expect(await activeRecordsWithoutNextAction()).toEqual([]);
  });
});
