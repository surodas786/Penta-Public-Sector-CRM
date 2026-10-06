/**
 * Milestone 4: the shared organization directory (FR-030, FR-031, FR-033).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEvents, organizations } from '../db/schema.js';
import {
  TEST_ORIGIN,
  createOpportunityPayload,
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
import { IDEMPOTENCY_HEADER } from '../../shared/api.js';

describe('organization directory', () => {
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

  async function org(id: string) {
    const [row] = await ctx.database.db.select().from(organizations).where(eq(organizations.id, id));
    return row!;
  }

  const create = (client: SignedInClient, body: Record<string, unknown>) => send(client, '/api/organizations', body);

  // -------------------------------------------------------------------------
  describe('shared basics, scoped counts (FR-031)', () => {
    it('shows every sales role the same directory, with counts of only what each may see', async () => {
      // Sylvan Hills (o7) has Rafiq's p1 (GA) and Imran's p17 (IS).
      const counts: Record<string, number> = {};
      for (const [label, email] of [
        ['rafiq', emails.salesGA1],
        ['imran', emails.salesIS1],
        ['nadia', emails.leadGA],
        ['arif', emails.management],
      ] as const) {
        const client = await signIn(ctx.app, email);
        const list = await client.agent.get('/api/organizations').query({ pageSize: 100 }).expect(200);
        expect(list.body.total).toBe(11);
        const sylvan = list.body.items.find((item: { id: string }) => item.id === ids.orgSylvanHills);
        counts[label] = sylvan.accessibleOpportunities;
      }
      expect(counts).toEqual({ rafiq: 1, imran: 1, nadia: 1, arif: 2 });
    });

    it('carries no private contact details or project commentary', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const detail = await rafiq.agent.get(`/api/organizations/${ids.orgSylvanHills}`).expect(200);
      const text = JSON.stringify(detail.body);
      expect(text).not.toMatch(/@example\.com|\+880/);
      expect(text).not.toContain('Final approver');
      expect(detail.body.accessibleOpportunities).toBe(1);
    });

    it('refuses the administrator a sales directory', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await admin.agent.get('/api/organizations').expect(403);
      await admin.agent.get(`/api/organizations/${ids.orgSylvanHills}`).expect(403);
    });

    it('stores and finds Bangla names', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const created = await create(rafiq, { name: 'স্থানীয় সরকার বিভাগ', type: 'department', location: 'ঢাকা' });
      expect(created.status).toBe(201);
      expect(created.body.name).toBe('স্থানীয় সরকার বিভাগ');
      const search = await rafiq.agent.get('/api/organizations').query({ q: 'সরকার' }).expect(200);
      expect(search.body.items.map((item: { id: string }) => item.id)).toContain(created.body.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('maintenance (FR-030, FR-033)', () => {
    it('warns about a duplicate name and saves only once the warning is acknowledged', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const existing = await org(ids.orgSylvanHills);
      const variant = `  ${existing.name.toUpperCase().replace(/ /g, '  ')}.`;

      const warned = await create(rafiq, { name: variant, type: 'local_government' });
      expect(warned.status).toBe(409);
      expect(warned.body.code).toBe('possible_duplicate');
      expect(warned.body.fieldErrors.name).toContain(existing.name);

      const saved = await create(rafiq, { name: variant, type: 'local_government', acknowledgeDuplicates: true });
      expect(saved.status).toBe(201);
    });

    it('prevents self-parenting and cycles', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const a = await create(rafiq, { name: 'Cycle Test Ministry', type: 'ministry' }).expect(201);
      const b = await create(rafiq, { name: 'Cycle Test Division', type: 'department', parentId: a.body.id }).expect(201);
      const c = await create(rafiq, { name: 'Cycle Test Unit', type: 'other', parentId: b.body.id }).expect(201);

      const self = await patch(rafiq, `/api/organizations/${a.body.id}`, { version: a.body.version, parentId: a.body.id });
      expect(self.status).toBe(422);
      const cycle = await patch(rafiq, `/api/organizations/${a.body.id}`, { version: a.body.version, parentId: c.body.id });
      expect(cycle.status).toBe(422);
      expect(cycle.body.fieldErrors.parentId).toMatch(/cycle/);
      expect((await org(a.body.id)).parentId).toBeNull();
    });

    it('lets only one of two simultaneous cross-parenting edits succeed', async () => {
      for (let round = 0; round < 4; round += 1) {
        const rafiq = await signIn(ctx.app, emails.salesGA1);
        const nadia = await signIn(ctx.app, emails.leadGA);
        const a = await create(rafiq, { name: `Race Ministry ${round}`, type: 'ministry' }).expect(201);
        const b = await create(rafiq, { name: `Race Authority ${round}`, type: 'authority' }).expect(201);
        const results = await Promise.all([
          patch(rafiq, `/api/organizations/${a.body.id}`, { version: a.body.version, parentId: b.body.id }),
          patch(nadia, `/api/organizations/${b.body.id}`, { version: b.body.version, parentId: a.body.id }),
        ]);
        expect(results.map((response) => response.status).sort()).toEqual([200, 422]);
      }
    });

    it('validates fields and versions, and audits changes in the directory domain', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const current = await org(ids.orgSylvanHills);
      const bad = await patch(rafiq, `/api/organizations/${ids.orgSylvanHills}`, {
        version: current.version,
        website: 'ftp://files.example.org',
        name: 'No',
      });
      expect(bad.status).toBe(422);
      expect(Object.keys(bad.body.fieldErrors)).toEqual(expect.arrayContaining(['website', 'name']));

      const ok = await patch(rafiq, `/api/organizations/${ids.orgSylvanHills}`, {
        version: current.version,
        location: 'Sylvan Hills, Sector 4',
      });
      expect(ok.status).toBe(200);
      const stale = await patch(rafiq, `/api/organizations/${ids.orgSylvanHills}`, { version: current.version, location: 'Again' });
      expect(stale.status).toBe(409);

      const [event] = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.entityId, ids.orgSylvanHills));
      expect(event!.domain).toBe('directory');
      expect(event!.opportunityId).toBeNull();
    });

    it('lets management archive only an organization no open opportunity uses', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const sylvan = await org(ids.orgSylvanHills);
      expect((await send(nadia, `/api/organizations/${ids.orgSylvanHills}/archive`, { version: sylvan.version, reason: 'Duplicate' })).status).toBe(403);

      const arif = await signIn(ctx.app, emails.management);
      const used = await send(arif, `/api/organizations/${ids.orgSylvanHills}/archive`, { version: sylvan.version, reason: 'Duplicate' });
      expect(used.status).toBe(409);

      const unused = await create(arif, { name: 'Unused Directorate', type: 'directorate' }).expect(201);
      const archived = await send(arif, `/api/organizations/${unused.body.id}/archive`, { version: unused.body.version, reason: 'Created in error' });
      expect(archived.status).toBe(200);
      expect(archived.body.archived).toBe(true);

      const list = await arif.agent.get('/api/organizations').query({ pageSize: 100 }).expect(200);
      expect(list.body.items.map((item: { id: string }) => item.id)).not.toContain(unused.body.id);

      // An archived organization takes no new opportunity.
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const opportunity = await rafiq.agent
        .post('/api/opportunities')
        .set('Origin', TEST_ORIGIN)
        .set('x-csrf-token', rafiq.csrfToken)
        .set(IDEMPOTENCY_HEADER, nextIdempotencyKey('archived-org'))
        .send(createOpportunityPayload({ organizationId: unused.body.id }));
      expect(opportunity.status).toBe(422);
      expect(opportunity.body.fieldErrors.organizationId).toBeTruthy();
    });
  });
});
