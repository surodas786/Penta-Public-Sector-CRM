/**
 * Plan 7.6 scenarios 6-11, 14 and 15: record scope for all four roles,
 * indistinguishable missing/inaccessible errors, lookup safety and query
 * validation. These are the AT-01/02/03 checks at API level.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedOpportunities } from '../db/seedData.js';
import {
  ABSENT_UUID,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  signIn,
  startSession,
  type TestContext,
} from './helpers/harness.js';

/** Expected counts derived from the fixtures, not hard-coded. */
const totals = {
  all: seedOpportunities.length,
  ga: seedOpportunities.filter((o) => o.sectionLegacyId === 'GA').length,
  is: seedOpportunities.filter((o) => o.sectionLegacyId === 'IS').length,
  rafiq: seedOpportunities.filter((o) => o.ownerLegacyId === 'u-rafiq').length,
  tasnia: seedOpportunities.filter((o) => o.ownerLegacyId === 'u-tasnia').length,
};

describe('record scope and isolation', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = createTestApp();
    await resetFixtures();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // --- Scenario 6 ---------------------------------------------------------
  describe('scenario 6 — management sees both sections with the correct total', () => {
    it('lists every section and reports the full scoped total', async () => {
      const { agent } = await signIn(ctx.app, emails.management);

      const response = await agent.get('/api/opportunities?pageSize=100').expect(200);

      expect(response.body.total).toBe(totals.all);
      expect(response.body.items).toHaveLength(totals.all);

      const sections = new Set<string>(
        response.body.items.map((item: { sectionId: string }) => item.sectionId),
      );
      expect(sections).toContain(ids.sectionGA);
      expect(sections).toContain(ids.sectionIS);
    });

    it('reports a filtered total that still matches the filtered population', async () => {
      const { agent } = await signIn(ctx.app, emails.management);

      const ga = await agent
        .get(`/api/opportunities?sectionId=${ids.sectionGA}&pageSize=100`)
        .expect(200);
      expect(ga.body.total).toBe(totals.ga);

      const is = await agent
        .get(`/api/opportunities?sectionId=${ids.sectionIS}&pageSize=100`)
        .expect(200);
      expect(is.body.total).toBe(totals.is);
      expect(ga.body.total + is.body.total).toBe(totals.all);
    });

    it('can open an opportunity in either section', async () => {
      const { agent } = await signIn(ctx.app, emails.management);
      await agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
      await agent.get(`/api/opportunities/${ids.oppImran}`).expect(200);
    });
  });

  // --- Scenario 7 ---------------------------------------------------------
  describe('scenario 7 — the administrator has no commercial access at all', () => {
    it('returns 403 for commercial collections, with no commercial values', async () => {
      const { agent } = await signIn(ctx.app, emails.admin);

      for (const route of [
        '/api/opportunities',
        '/api/organizations',
        '/api/lookups/opportunity-owners',
      ]) {
        const response = await agent.get(route);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('forbidden');
        // Nothing resembling a record list or a total.
        expect(response.body).not.toHaveProperty('items');
        expect(response.body).not.toHaveProperty('total');
      }
    });

    it('returns 404 for a commercial object request', async () => {
      const { agent } = await signIn(ctx.app, emails.admin);

      for (const id of [ids.oppRafiq, ids.oppImran, ids.oppNadia]) {
        const response = await agent.get(`/api/opportunities/${id}`);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('not_found');
      }
    });

    it('returns 404 for commercial child collections', async () => {
      const { agent } = await signIn(ctx.app, emails.admin);
      await agent.get(`/api/opportunities/${ids.oppRafiq}/follow-ups`).expect(404);
      await agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(404);
    });

    it('still reports its own account, with no sales capability', async () => {
      const { agent } = await signIn(ctx.app, emails.admin);
      const response = await agent.get('/api/auth/me').expect(200);

      expect(response.body.user.role).toBe('admin');
      expect(response.body.user.capabilities.salesRecords).toBe(false);
      expect(response.body.user.capabilities.createOpportunity).toBe(false);
      expect(response.body.user.capabilities.accountAdministration).toBe(true);
    });
  });

  // --- Scenario 8 ---------------------------------------------------------
  describe('scenario 8 — a lead sees their own section only', () => {
    it('lists only Government Applications for its lead', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);
      const response = await agent.get('/api/opportunities?pageSize=100').expect(200);

      expect(response.body.total).toBe(totals.ga);
      for (const item of response.body.items as { sectionId: string }[]) {
        expect(item.sectionId).toBe(ids.sectionGA);
      }
    });

    it('cannot open another section’s opportunity by id', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);
      const response = await agent.get(`/api/opportunities/${ids.oppImran}`);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not_found');
    });

    it('cannot reach another section’s records through a section filter', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);
      const response = await agent
        .get(`/api/opportunities?sectionId=${ids.sectionIS}&pageSize=100`)
        .expect(200);

      // The filter is applied on top of scope, never instead of it.
      expect(response.body.total).toBe(0);
      expect(response.body.items).toHaveLength(0);
    });

    it('cannot reach another section’s records through an owner filter', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);
      const response = await agent
        .get(`/api/opportunities?ownerId=${ids.salesIS1}&pageSize=100`)
        .expect(200);
      expect(response.body.total).toBe(0);
    });

    it('cannot reach another section’s records through search', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);
      const response = await agent
        .get('/api/opportunities?q=Network%20Security&pageSize=100')
        .expect(200);
      expect(response.body.total).toBe(0);
    });
  });

  // --- Scenario 9 ---------------------------------------------------------
  describe('scenario 9 — section scope ignores owner activity and reporting lines', () => {
    it('includes a section record whose owner is deactivated', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);

      const detail = await agent.get(`/api/opportunities/${ids.oppInactiveOwner}`).expect(200);
      expect(detail.body.ownerId).toBe(ids.inactiveGA);

      const list = await agent.get('/api/opportunities?pageSize=100').expect(200);
      const listed = (list.body.items as { id: string }[]).map((item) => item.id);
      expect(listed).toContain(ids.oppInactiveOwner);
    });

    it('includes a section record whose owner has no manager_id', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);

      const detail = await agent.get(`/api/opportunities/${ids.oppNoManagerOwner}`).expect(200);
      expect(detail.body.ownerId).toBe(ids.noManagerGA);

      const list = await agent.get('/api/opportunities?pageSize=100').expect(200);
      const listed = (list.body.items as { id: string }[]).map((item) => item.id);
      expect(listed).toContain(ids.oppNoManagerOwner);
    });

    it('does not leak those same records to the other section’s lead', async () => {
      const { agent } = await signIn(ctx.app, emails.leadIS);
      await agent.get(`/api/opportunities/${ids.oppInactiveOwner}`).expect(404);
      await agent.get(`/api/opportunities/${ids.oppNoManagerOwner}`).expect(404);
    });
  });

  // --- Scenario 10 --------------------------------------------------------
  describe('scenario 10 — a salesperson sees only records they own', () => {
    it('lists only its own opportunities', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get('/api/opportunities?pageSize=100').expect(200);

      expect(response.body.total).toBe(totals.rafiq);
      for (const item of response.body.items as { ownerId: string }[]) {
        expect(item.ownerId).toBe(ids.salesGA1);
      }
    });

    it('cannot open a colleague’s record in the same section', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get(`/api/opportunities/${ids.oppTasnia}`);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not_found');
    });

    it('cannot open their own section lead’s record', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      await agent.get(`/api/opportunities/${ids.oppNadia}`).expect(404);
    });

    it('cannot widen scope with an owner filter naming a colleague', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent
        .get(`/api/opportunities?ownerId=${ids.salesGA2}&pageSize=100`)
        .expect(200);
      expect(response.body.total).toBe(0);
    });

    it('keeps two salespeople in the same section fully separated', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const tasnia = await signIn(ctx.app, emails.salesGA2);

      const rafiqList = await rafiq.agent.get('/api/opportunities?pageSize=100').expect(200);
      const tasniaList = await tasnia.agent.get('/api/opportunities?pageSize=100').expect(200);

      expect(rafiqList.body.total).toBe(totals.rafiq);
      expect(tasniaList.body.total).toBe(totals.tasnia);

      const rafiqIds = new Set((rafiqList.body.items as { id: string }[]).map((i) => i.id));
      const tasniaIds = (tasniaList.body.items as { id: string }[]).map((i) => i.id);
      for (const id of tasniaIds) expect(rafiqIds.has(id)).toBe(false);
    });
  });

  // --- Scenario 11 --------------------------------------------------------
  describe('scenario 11 — owner lookups reveal no disallowed teams or private fields', () => {
    const privateFields = ['email', 'passwordHash', 'password_hash', 'managerId', 'manager_id', 'sessionVersion', 'session_version', 'active', 'role'];

    it('offers a salesperson only themselves', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get('/api/lookups/opportunity-owners').expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].id).toBe(ids.salesGA1);
    });

    it('offers a lead only active eligible owners in their own section', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);
      const response = await agent.get('/api/lookups/opportunity-owners').expect(200);

      const returned = (response.body.items as { id: string; sectionId: string }[]);
      for (const owner of returned) expect(owner.sectionId).toBe(ids.sectionGA);

      const returnedIds = returned.map((o) => o.id);
      expect(returnedIds).toContain(ids.leadGA);
      expect(returnedIds).toContain(ids.salesGA1);
      expect(returnedIds).toContain(ids.salesGA2);
      // Active member with no reporting line is still an eligible owner.
      expect(returnedIds).toContain(ids.noManagerGA);
      // Deactivated accounts are not eligible owners.
      expect(returnedIds).not.toContain(ids.inactiveGA);
      // No one from the other section.
      expect(returnedIds).not.toContain(ids.salesIS1);
      expect(returnedIds).not.toContain(ids.leadIS);
      // Management is never an opportunity owner in this release.
      expect(returnedIds).not.toContain(ids.management);
      expect(returnedIds).not.toContain(ids.admin);
    });

    it('offers management eligible owners across sections, but never itself', async () => {
      const { agent } = await signIn(ctx.app, emails.management);
      const response = await agent.get('/api/lookups/opportunity-owners').expect(200);

      const returnedIds = (response.body.items as { id: string }[]).map((o) => o.id);
      expect(returnedIds).toContain(ids.salesGA1);
      expect(returnedIds).toContain(ids.salesIS1);
      expect(returnedIds).not.toContain(ids.management);
      expect(returnedIds).not.toContain(ids.admin);
      expect(returnedIds).not.toContain(ids.inactiveGA);
    });

    it('returns no private account field in any lookup row', async () => {
      const { agent } = await signIn(ctx.app, emails.management);
      const response = await agent.get('/api/lookups/opportunity-owners').expect(200);

      for (const owner of response.body.items as Record<string, unknown>[]) {
        expect(Object.keys(owner).sort()).toEqual(['fullName', 'id', 'sectionId', 'sectionName']);
        for (const field of privateFields) expect(owner).not.toHaveProperty(field);
      }
      expect(JSON.stringify(response.body)).not.toContain('@example.com');
    });
  });

  // --- Scenario 14 --------------------------------------------------------
  describe('scenario 14 — missing and inaccessible records are indistinguishable', () => {
    it('matches status, code, message and structure, differing only by requestId', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);

      // Exists, but belongs to a colleague.
      const inaccessible = await agent.get(`/api/opportunities/${ids.oppTasnia}`);
      // Correctly formed, but no such record anywhere.
      const absent = await agent.get(`/api/opportunities/${ABSENT_UUID}`);

      expect(inaccessible.status).toBe(404);
      expect(absent.status).toBe(404);

      const { requestId: inaccessibleRequestId, ...inaccessibleBody } = inaccessible.body;
      const { requestId: absentRequestId, ...absentBody } = absent.body;

      expect(inaccessibleBody).toEqual(absentBody);
      expect(Object.keys(inaccessible.body).sort()).toEqual(Object.keys(absent.body).sort());

      // Request IDs are present, unique, and excluded from the comparison.
      expect(inaccessibleRequestId).toBeTruthy();
      expect(absentRequestId).toBeTruthy();
      expect(inaccessibleRequestId).not.toBe(absentRequestId);
    });

    it('applies the same equivalence to child collections', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);

      const inaccessible = await agent.get(`/api/opportunities/${ids.oppTasnia}/follow-ups`);
      const absent = await agent.get(`/api/opportunities/${ABSENT_UUID}/follow-ups`);

      const { requestId: _a, ...inaccessibleBody } = inaccessible.body;
      const { requestId: _b, ...absentBody } = absent.body;
      expect(inaccessible.status).toBe(absent.status);
      expect(inaccessibleBody).toEqual(absentBody);
    });

    it('treats a malformed id the same way, without a distinguishing error', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);

      const malformed = await agent.get('/api/opportunities/not-a-uuid');
      const absent = await agent.get(`/api/opportunities/${ABSENT_UUID}`);

      const { requestId: _a, ...malformedBody } = malformed.body;
      const { requestId: _b, ...absentBody } = absent.body;
      expect(malformed.status).toBe(404);
      expect(malformedBody).toEqual(absentBody);
    });

    it('never names the record, the owner or the section in the 404 body', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get(`/api/opportunities/${ids.oppImran}`);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('Regional Utility');
      expect(serialised).not.toContain('Infrastructure');
      expect(serialised).not.toContain(ids.salesIS1);
      expect(serialised).not.toContain(ids.oppImran);
    });
  });

  // --- Scenario 15 --------------------------------------------------------
  describe('scenario 15 — query validation and scoped totals', () => {
    it('rejects a page size above the maximum', async () => {
      const { agent } = await signIn(ctx.app, emails.management);
      const response = await agent.get('/api/opportunities?pageSize=500');

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('validation_failed');
      expect(response.body.fieldErrors).toHaveProperty('pageSize');
    });

    it('accepts the documented maximum page size', async () => {
      const { agent } = await signIn(ctx.app, emails.management);
      const response = await agent.get('/api/opportunities?pageSize=100').expect(200);
      expect(response.body.pageSize).toBe(100);
    });

    it('defaults to 25 per page', async () => {
      const { agent } = await signIn(ctx.app, emails.management);
      const response = await agent.get('/api/opportunities').expect(200);
      expect(response.body.pageSize).toBe(25);
      expect(response.body.page).toBe(1);
      expect(response.body.items).toHaveLength(Math.min(25, totals.all));
    });

    it.each([
      ['pageSize=0', 'pageSize'],
      ['page=0', 'page'],
      ['page=abc', 'page'],
      ['pageSize=-5', 'pageSize'],
    ])('rejects malformed paging parameter %s', async (query, field) => {
      const { agent } = await signIn(ctx.app, emails.management);
      const response = await agent.get(`/api/opportunities?${query}`);
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty(field);
    });

    it.each([
      ['sort=ownerSalary', 'sort'],
      ['dir=sideways', 'dir'],
      ['stage=not_a_stage', 'stage'],
      ['status=deleted', 'status'],
      ['priority=urgent', 'priority'],
      ['solutionCategory=blockchain', 'solutionCategory'],
      ['ownerId=1%20OR%201%3D1', 'ownerId'],
      ['unknownFilter=1', 'unknownFilter'],
    ])('rejects disallowed filter or sort %s', async (query, field) => {
      const { agent } = await signIn(ctx.app, emails.management);
      const response = await agent.get(`/api/opportunities?${query}`);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('validation_failed');
      expect(response.body.fieldErrors).toHaveProperty(field);
    });

    it('rejects a repeated filter rather than silently taking one value', async () => {
      const { agent } = await signIn(ctx.app, emails.management);
      const response = await agent.get('/api/opportunities?stage=identified&stage=lost');
      expect(response.status).toBe(422);
    });

    it('never includes inaccessible rows in a total, on any page', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);

      const page1 = await agent.get('/api/opportunities?page=1&pageSize=2').expect(200);
      expect(page1.body.total).toBe(totals.rafiq);
      expect(page1.body.items).toHaveLength(2);

      const page2 = await agent.get('/api/opportunities?page=2&pageSize=2').expect(200);
      expect(page2.body.total).toBe(totals.rafiq);

      // Walking every page yields exactly the owned population, no more.
      const collected = new Set<string>();
      for (let page = 1; page <= 5; page += 1) {
        const response = await agent
          .get(`/api/opportunities?page=${page}&pageSize=2`)
          .expect(200);
        for (const item of response.body.items as { id: string; ownerId: string }[]) {
          expect(item.ownerId).toBe(ids.salesGA1);
          collected.add(item.id);
        }
      }
      expect(collected.size).toBe(totals.rafiq);
    });

    it('requires authentication before validating the query', async () => {
      const { agent } = await startSession(ctx.app);
      const response = await agent.get('/api/opportunities?pageSize=500');
      // 401 wins over 422: an anonymous caller learns nothing about the schema.
      expect(response.status).toBe(401);
    });
  });
});
