/**
 * Plan 7.6 scenarios 13 and 21: the basic-edit allowlist, escalation refusal,
 * and optimistic concurrency.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEvents, opportunities } from '../db/schema.js';
import {
  ABSENT_UUID,
  CSRF_HEADER,
  TEST_ORIGIN,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  signIn,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

describe('opportunity basic edit', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetFixtures();
  });

  function patch(client: SignedInClient, id: string, body: Record<string, unknown>) {
    return client.agent
      .patch(`/api/opportunities/${id}`)
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_HEADER, client.csrfToken)
      .send(body);
  }

  async function currentVersion(id: string): Promise<number> {
    const [row] = await ctx.database.db
      .select({ version: opportunities.version })
      .from(opportunities)
      .where(eq(opportunities.id, id));
    return row!.version;
  }

  // --- Scenario 13 --------------------------------------------------------
  describe('scenario 13 — allowlist, escalation and inaccessible records', () => {
    it('updates an allowlisted field and bumps the version', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      const response = await patch(client, ids.oppRafiq, {
        version,
        name: 'Municipal Service Portal (phase 2)',
        priority: 'high',
      });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Municipal Service Portal (phase 2)');
      expect(response.body.priority).toBe('high');
      expect(response.body.version).toBe(version + 1);
    });

    it('records an audit event carrying before and after values', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      await patch(client, ids.oppRafiq, { version, priority: 'low' }).expect(200);

      const events = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.opportunityId, ids.oppRafiq));

      const update = events.find((event) => event.action === 'opportunity.updated');
      expect(update).toBeTruthy();
      expect((update!.beforeData as Record<string, unknown>).priority).toBe('high');
      expect((update!.afterData as Record<string, unknown>).priority).toBe('low');
      expect(update!.actorId).toBe(ids.salesGA1);
    });

    it('returns 404 for an inaccessible record', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const response = await patch(client, ids.oppTasnia, { version: 1, name: 'Renamed by force' });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not_found');

      const [row] = await ctx.database.db
        .select({ name: opportunities.name })
        .from(opportunities)
        .where(eq(opportunities.id, ids.oppTasnia));
      expect(row!.name).toBe('Public Training Institute ERP');
    });

    it('returns 404 for a record that does not exist', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const response = await patch(client, ABSENT_UUID, { version: 1, name: 'Nothing here' });
      expect(response.status).toBe(404);
    });

    it.each([
      ['ownerId', ids.salesGA2],
      ['sectionId', ids.sectionIS],
      ['stage', 'awarded'],
      ['status', 'cancelled'],
      ['reference', 'OPP-000001'],
      ['awardedValue', '99000000.00'],
      ['createdBy', ids.management],
    ])('refuses an escalation attempt through %s with 403', async (field, value) => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      const response = await patch(client, ids.oppRafiq, { version, [field]: value });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('forbidden');
      // Nothing changed, not even the version.
      expect(await currentVersion(ids.oppRafiq)).toBe(version);
    });

    it('still returns 404 when an escalation is attempted on an invisible record', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      // Not 403: the caller must not learn that the record exists.
      const response = await patch(client, ids.oppTasnia, { version: 1, ownerId: ids.salesGA1 });
      expect(response.status).toBe(404);
    });

    it('refuses an owner change even for a lead, who must use the transfer workflow', async () => {
      const client = await signIn(ctx.app, emails.leadGA);
      const version = await currentVersion(ids.oppRafiq);

      const response = await patch(client, ids.oppRafiq, { version, ownerId: ids.salesGA2 });

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/transfer/i);
      expect(await currentVersion(ids.oppRafiq)).toBe(version);
    });

    it.each(['nextAction', 'nextActionDue'])(
      'refuses to edit %s on the opportunity record',
      async (field) => {
        const client = await signIn(ctx.app, emails.salesGA1);
        const version = await currentVersion(ids.oppRafiq);
        const response = await patch(client, ids.oppRafiq, { version, [field]: 'anything' });
        expect(response.status).toBe(403);
      },
    );

    it('rejects an unknown field with a named validation error', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      const response = await patch(client, ids.oppRafiq, { version, notAColumn: 'x' });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('validation_failed');
      expect(response.body.fieldErrors).toHaveProperty('notAColumn');
      expect(await currentVersion(ids.oppRafiq)).toBe(version);
    });

    it('rejects an invalid value for an allowlisted field', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      const response = await patch(client, ids.oppRafiq, { version, estimatedValue: '-50' });

      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty('estimatedValue');
    });

    it('requires a version', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const response = await patch(client, ids.oppRafiq, { name: 'No version supplied' });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty('version');
    });

    it('refuses to edit a terminal record; changes go through reopening', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiqAwarded);

      const response = await patch(client, ids.oppRafiqAwarded, { version, priority: 'low' });

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/Reopen it, or return it to Active, first/);
    });

    it('refuses to edit a cancelled record', async () => {
      const client = await signIn(ctx.app, emails.salesIS1);
      const version = await currentVersion(ids.oppCancelledIS);

      const response = await patch(client, ids.oppCancelledIS, { version, priority: 'low' });
      expect(response.status).toBe(403);
    });

    it('lets management edit any section’s active record', async () => {
      const client = await signIn(ctx.app, emails.management);
      const version = await currentVersion(ids.oppImran);

      const response = await patch(client, ids.oppImran, { version, priority: 'low' });
      expect(response.status).toBe(200);
    });
  });

  // --- Scenario 21 --------------------------------------------------------
  describe('scenario 21 — two edits from the same version cannot both succeed', () => {
    it('rejects the stale edit with 409 and preserves the committed value', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      const first = await patch(client, ids.oppRafiq, { version, name: 'First writer wins' });
      expect(first.status).toBe(200);

      // Same version, as a second browser tab would still be holding.
      const stale = await patch(client, ids.oppRafiq, { version, name: 'Second writer loses' });

      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('version_conflict');
      expect(stale.body.message).toMatch(/reload/i);

      const [row] = await ctx.database.db
        .select({ name: opportunities.name, version: opportunities.version })
        .from(opportunities)
        .where(eq(opportunities.id, ids.oppRafiq));
      expect(row!.name).toBe('First writer wins');
      expect(row!.version).toBe(version + 1);
    });

    it('writes no audit event for the rejected stale edit', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      await patch(client, ids.oppRafiq, { version, name: 'Committed name' }).expect(200);
      await patch(client, ids.oppRafiq, { version, name: 'Rejected name' }).expect(409);

      const updates = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.opportunityId, ids.oppRafiq));
      const updateEvents = updates.filter((event) => event.action === 'opportunity.updated');
      expect(updateEvents).toHaveLength(1);
      expect((updateEvents[0]!.afterData as Record<string, unknown>).name).toBe('Committed name');
    });

    it('allows the edit to be reapplied after reloading the version', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      await patch(client, ids.oppRafiq, { version, priority: 'low' }).expect(200);
      await patch(client, ids.oppRafiq, { version, name: 'Stale attempt' }).expect(409);

      const reloaded = await client.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
      const retry = await patch(client, ids.oppRafiq, {
        version: reloaded.body.version,
        name: 'Reapplied after reload',
      });

      expect(retry.status).toBe(200);
      expect(retry.body.name).toBe('Reapplied after reload');
    });

    it('serialises two genuinely concurrent edits so only one wins', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const version = await currentVersion(ids.oppRafiq);

      const [a, b] = await Promise.all([
        patch(client, ids.oppRafiq, { version, name: 'Racer A' }),
        patch(client, ids.oppRafiq, { version, name: 'Racer B' }),
      ]);

      const statuses = [a.status, b.status];
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);

      const [row] = await ctx.database.db
        .select({ name: opportunities.name, version: opportunities.version })
        .from(opportunities)
        .where(eq(opportunities.id, ids.oppRafiq));
      expect(['Racer A', 'Racer B']).toContain(row!.name);
      // Exactly one increment, never two.
      expect(row!.version).toBe(version + 1);
    });
  });
});
