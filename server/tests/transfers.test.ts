/**
 * Milestone 3: ownership transfers (FR-070, BR-050, BR-090, BR-091, SEC-005).
 * AT-07 (within-section) and the transfer portion of AT-08 (cross-section).
 */
import { and, eq } from 'drizzle-orm';
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

describe('ownership transfers', () => {
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

  async function openTasks(id: string) {
    return ctx.database.db
      .select()
      .from(followUps)
      .where(and(eq(followUps.opportunityId, id), eq(followUps.state, 'open')));
  }

  const transfer = (client: SignedInClient, id: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/opportunities/${id}/transfer`, body, key);

  const addTask = async (client: SignedInClient, id: string, assigneeId: string, title: string) => {
    const response = await send(client, `/api/opportunities/${id}/follow-ups`, {
      title,
      dueDate: '2027-03-01',
      assigneeId,
    });
    expect(response.status).toBe(201);
    return response.body as { id: string };
  };

  // -------------------------------------------------------------------------
  describe('AT-07: within-section transfer by the section lead', () => {
    it('moves owner and access: Tasnia gains it, Rafiq loses it', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const { version } = await record(ids.oppRafiq);

      const response = await transfer(nadia, ids.oppRafiq, {
        version,
        newOwnerId: ids.salesGA2,
        reason: 'Rafiq moves to the ERP bid team for this quarter.',
      });

      expect(response.status).toBe(200);
      expect(response.body.ownerId).toBe(ids.salesGA2);
      expect(response.body.sectionId).toBe(ids.sectionGA);
      expect(response.body.version).toBe(version + 1);

      const tasnia = await signIn(ctx.app, emails.salesGA2);
      await tasnia.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
      await tasnia.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);

      // The previous owner loses access on the very next request (SEC-005).
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const denied = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}`);
      expect(denied.status).toBe(404);
      await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/follow-ups`).expect(404);
      const list = await rafiq.agent.get('/api/opportunities').query({ pageSize: 100 }).expect(200);
      expect(list.body.items.map((item: { id: string }) => item.id)).not.toContain(ids.oppRafiq);
    });

    it('moves the previous owner’s open tasks and keeps management’s and the lead’s', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const arif = await signIn(ctx.app, emails.management);
      const leadTask = await addTask(nadia, ids.oppRafiq, ids.leadGA, 'Lead review of scope');
      const managementTask = await addTask(arif, ids.oppRafiq, ids.management, 'Approve ERP bid submission');
      const ownerTasks = (await openTasks(ids.oppRafiq)).filter((task) => task.assignedUserId === ids.salesGA1);
      expect(ownerTasks.length).toBeGreaterThan(0);

      const { version } = await record(ids.oppRafiq);
      await transfer(nadia, ids.oppRafiq, { version, newOwnerId: ids.salesGA2, reason: 'Workload balance' }).expect(200);

      const after = new Map((await openTasks(ids.oppRafiq)).map((task) => [task.id, task.assignedUserId]));
      for (const task of ownerTasks) expect(after.get(task.id)).toBe(ids.salesGA2);
      // Management keeps its task; the lead keeps hers because she keeps access.
      expect(after.get(managementTask.id)).toBe(ids.management);
      expect(after.get(leadTask.id)).toBe(ids.leadGA);

      const reassigned = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.opportunityId, ids.oppRafiq), eq(auditEvents.action, 'follow_up.reassigned')));
      expect(reassigned).toHaveLength(ownerTasks.length);
    });

    it('keeps completed tasks, the original creator and earlier history authors', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const [only] = await openTasks(ids.oppRafiq);
      await send(rafiq, `/api/follow-ups/${only!.id}/complete`, {
        version: only!.version,
        replacement: { title: 'Next step after handover', dueDate: '2027-02-01' },
      }).expect(200);
      const createdBy = (await record(ids.oppRafiq)).createdBy;

      const nadia = await signIn(ctx.app, emails.leadGA);
      const { version } = await record(ids.oppRafiq);
      await transfer(nadia, ids.oppRafiq, { version, newOwnerId: ids.salesGA2, reason: 'Handover' }).expect(200);

      const [completed] = await ctx.database.db.select().from(followUps).where(eq(followUps.id, only!.id));
      expect(completed!.state).toBe('completed');
      expect(completed!.assignedUserId).toBe(ids.salesGA1);
      expect(completed!.completedBy).toBe(ids.salesGA1);
      expect((await record(ids.oppRafiq)).createdBy).toBe(createdBy);

      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const history = await tasnia.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);
      const completion = history.body.items.find((entry: { action: string }) => entry.action === 'follow_up.completed');
      expect(completion.actorName).toBe('Rafiq Hasan');
      const transferred = history.body.items.find((entry: { action: string }) => entry.action === 'opportunity.transferred');
      expect(transferred.reason).toBe('Handover');
      expect(transferred.changes).toEqual(
        expect.arrayContaining([{ field: 'ownerId', label: 'Owner', before: 'Rafiq Hasan', after: 'Tasnia Karim' }]),
      );
    });

    it('refuses a salesperson with 403, even on their own record', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const { version } = await record(ids.oppRafiq);
      const response = await transfer(rafiq, ids.oppRafiq, { version, newOwnerId: ids.salesGA2, reason: 'Self-service' });
      expect(response.status).toBe(403);
      expect((await record(ids.oppRafiq)).ownerId).toBe(ids.salesGA1);
    });

    it('refuses a lead moving a record to another section', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const { version } = await record(ids.oppRafiq);
      const response = await transfer(nadia, ids.oppRafiq, { version, newOwnerId: ids.salesIS1, reason: 'Cross' });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.newOwnerId).toBeTruthy();
      expect((await record(ids.oppRafiq)).sectionId).toBe(ids.sectionGA);
    });

    it.each([
      ['an inactive account', 'inactiveGA'],
      ['management, which owns nothing', 'management'],
      ['the current owner', 'salesGA1'],
    ] as const)('refuses %s as the new owner', async (_label, key) => {
      const arif = await signIn(ctx.app, emails.management);
      const { version } = await record(ids.oppRafiq);
      const response = await transfer(arif, ids.oppRafiq, { version, newOwnerId: ids[key], reason: 'Probe' });
      expect(response.status).toBe(422);
      expect((await record(ids.oppRafiq)).version).toBe(version);
    });
  });

  // -------------------------------------------------------------------------
  describe('AT-08 (transfer portion): cross-section transfer by management', () => {
    it('revokes the old team at once and gives the new section access', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const leadTask = await addTask(nadia, ids.oppRafiq, ids.leadGA, 'Lead review before handover');
      const arif = await signIn(ctx.app, emails.management);
      const managementTask = await addTask(arif, ids.oppRafiq, ids.management, 'Approve the bid');

      const { version } = await record(ids.oppRafiq);
      const response = await transfer(arif, ids.oppRafiq, {
        version,
        newOwnerId: ids.salesIS1,
        reason: 'Infrastructure scope now dominates.',
      });
      expect(response.status).toBe(200);
      expect(response.body.sectionId).toBe(ids.sectionIS);
      expect(response.body.sectionName).toBe('Infrastructure & Security');

      // Old lead and old owner: gone, by URL and by list. New lead and owner: in.
      await nadia.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(404);
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(404);
      const farhan = await signIn(ctx.app, emails.leadIS);
      await farhan.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
      const imran = await signIn(ctx.app, emails.salesIS1);
      await imran.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);

      // The old lead loses access, so her task moves; management's stays.
      const after = new Map((await openTasks(ids.oppRafiq)).map((task) => [task.id, task.assignedUserId]));
      expect(after.get(leadTask.id)).toBe(ids.salesIS1);
      expect(after.get(managementTask.id)).toBe(ids.management);
      for (const assignee of after.values()) expect([ids.salesIS1, ids.management]).toContain(assignee);
    });

    it('transfers a closed record too, so historical ownership can move (BR-051)', async () => {
      const arif = await signIn(ctx.app, emails.management);
      const { version } = await record(ids.oppRafiqAwarded);
      const response = await transfer(arif, ids.oppRafiqAwarded, { version, newOwnerId: ids.salesGA2, reason: 'Rafiq is leaving' });
      expect(response.status).toBe(200);
      expect(response.body.stage).toBe('awarded');
      expect(response.body.awardedValue).toBe((await record(ids.oppRafiqAwarded)).awardedValue);
    });
  });

  // -------------------------------------------------------------------------
  describe('scope, versions and retries', () => {
    it('returns 404 to another section’s lead and to the administrator', async () => {
      for (const email of [emails.leadIS, emails.admin]) {
        const client = await signIn(ctx.app, email);
        const { version } = await record(ids.oppRafiq);
        const response = await transfer(client, ids.oppRafiq, { version, newOwnerId: ids.salesGA2, reason: 'Probe' });
        expect(response.status).toBe(404);
      }
      expect((await record(ids.oppRafiq)).ownerId).toBe(ids.salesGA1);
    });

    it('still refuses owner changes through the basic edit', async () => {
      const arif = await signIn(ctx.app, emails.management);
      const { version } = await record(ids.oppRafiq);
      const response = await arif.agent
        .patch(`/api/opportunities/${ids.oppRafiq}`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', arif.csrfToken)
        .send({ version, ownerId: ids.salesGA2 });
      expect(response.status).toBe(403);
    });

    it('requires a reason and rejects a stale version', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const { version } = await record(ids.oppRafiq);
      const missing = await transfer(nadia, ids.oppRafiq, { version, newOwnerId: ids.salesGA2 });
      expect(missing.status).toBe(422);
      expect(missing.body.fieldErrors.reason).toBeTruthy();

      await transfer(nadia, ids.oppRafiq, { version, newOwnerId: ids.salesGA2, reason: 'First' }).expect(200);
      const stale = await transfer(nadia, ids.oppRafiq, { version, newOwnerId: ids.noManagerGA, reason: 'Second' });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('version_conflict');
      expect((await record(ids.oppRafiq)).ownerId).toBe(ids.salesGA2);
    });

    it('applies a retried transfer once', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const { version } = await record(ids.oppRafiq);
      const key = nextIdempotencyKey('transfer');
      const body = { version, newOwnerId: ids.salesGA2, reason: 'Retry check' };
      await transfer(nadia, ids.oppRafiq, body, key).expect(200);
      const retry = await transfer(nadia, ids.oppRafiq, body, key);
      expect(retry.status).toBe(200);
      const events = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.opportunityId, ids.oppRafiq), eq(auditEvents.action, 'opportunity.transferred')));
      expect(events).toHaveLength(1);
    });

    it('does not replay a transfer to a lead who has since lost the record', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const { version } = await record(ids.oppRafiq);
      const key = nextIdempotencyKey('transfer-revoked');
      const body = { version, newOwnerId: ids.salesGA2, reason: 'Within GA' };
      await transfer(nadia, ids.oppRafiq, body, key).expect(200);

      const arif = await signIn(ctx.app, emails.management);
      await transfer(arif, ids.oppRafiq, { version: version + 1, newOwnerId: ids.salesIS1, reason: 'To IS' }).expect(200);

      const replay = await transfer(nadia, ids.oppRafiq, body, key);
      expect(replay.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('BR-090: a transfer racing a task completion', () => {
    it('never leaves an open task with the previous owner', async () => {
      for (let round = 0; round < 4; round += 1) {
        await resetFixtures();
        const rafiq = await signIn(ctx.app, emails.salesGA1);
        const nadia = await signIn(ctx.app, emails.leadGA);
        const second = await addTask(rafiq, ids.oppRafiq, ids.salesGA1, `Second task ${round}`);
        const [task] = (await openTasks(ids.oppRafiq)).filter((row) => row.id === second.id);
        const { version } = await record(ids.oppRafiq);

        const [completion, moved] = await Promise.all([
          send(rafiq, `/api/follow-ups/${task!.id}/complete`, { version: task!.version }),
          transfer(nadia, ids.oppRafiq, { version, newOwnerId: ids.salesGA2, reason: `Race ${round}` }),
        ]);

        expect(moved.status).toBe(200);
        // Rafiq either completed first, or lost access to the task (404) or
        // found its version moved on (409) once the transfer reassigned it.
        expect([200, 404, 409]).toContain(completion.status);
        const open = await openTasks(ids.oppRafiq);
        expect(open.length).toBeGreaterThan(0);
        for (const row of open) expect(row.assignedUserId).not.toBe(ids.salesGA1);
      }
    });
  });
});
