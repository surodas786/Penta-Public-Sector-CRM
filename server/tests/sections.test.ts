/**
 * CR4 and CR5: a lead may lead several sections, a salesperson may belong to
 * several, and every opportunity belongs to exactly one section.
 *
 *   Management   all commercial access
 *   Lead         opportunities in the sections they currently lead
 *   Salesperson  their own opportunities, in their current sections
 *   Admin        administration only
 *
 * Former leadership or membership grants nothing. Checked through the real
 * app and database, with the runtime role for the database-level rules.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { legacyUuid, seedUsers } from '../db/seedData.js';
import { opportunities, sectionMemberships, sections, users } from '../db/schema.js';
import { loadActor } from '../policy/actor.js';
import { opportunityScope } from '../policy/scope.js';
import {
  TEST_ORIGIN,
  createOpportunityPayload,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  send,
  signIn,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

describe('CR4/CR5: multi-section leads and salespeople', () => {
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

  async function versionOf(table: 'users' | 'sections' | 'opportunities', id: string): Promise<number> {
    const result = await ctx.database.db.execute<{ version: number }>(sql`SELECT version FROM ${sql.identifier(table)} WHERE id = ${id}`);
    return result.rows[0]!.version;
  }

  /** The database's own error for a refused statement (Drizzle wraps it). */
  async function databaseError(work: Promise<unknown>): Promise<{ code?: string; message: string; constraint?: string }> {
    try {
      await work;
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message: string; constraint?: string } }).cause;
      return cause ?? { message: (error as Error).message };
    }
    throw new Error('expected the database to refuse the statement');
  }

  /** Every record id visible to the client through the list endpoint. */
  async function visibleIds(client: SignedInClient): Promise<string[]> {
    const response = await client.agent.get('/api/opportunities').query({ pageSize: 100 }).expect(200);
    return (response.body.items as { id: string }[]).map((item) => item.id).sort();
  }

  async function idsInSections(...sectionIds: string[]): Promise<string[]> {
    const rows = await ctx.database.db.select({ id: opportunities.id, sectionId: opportunities.sectionId }).from(opportunities);
    return rows.filter((row) => sectionIds.includes(row.sectionId)).map((row) => row.id).sort();
  }

  async function makeFarhanLeadOfGovernmentApplications(admin: SignedInClient) {
    const response = await send(admin, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
      version: await versionOf('sections', ids.sectionGA),
      newLeadId: ids.leadIS,
      reason: 'Farhan covers both sections.',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  async function addTasniaToInfrastructure(admin: SignedInClient) {
    const response = await patch(admin, `/api/admin/users/${ids.salesGA2}`, {
      version: await versionOf('users', ids.salesGA2),
      sectionIds: [ids.sectionGA, ids.sectionIS],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response;
  }

  // -------------------------------------------------------------------------
  describe('backfill keeps everyone’s scope exactly as it was', () => {
    it('gives every seeded account the records the single-section rules gave it', async () => {
      const all = await ctx.database.db.select().from(opportunities);
      for (const seeded of seedUsers) {
        const actor = await loadActor(ctx.database.db, legacyUuid(seeded.legacyId));
        const visible = (await ctx.database.db.select({ id: opportunities.id }).from(opportunities).where(opportunityScope(actor!)))
          .map((row) => row.id)
          .sort();
        const section = seeded.sectionLegacyId ? legacyUuid(seeded.sectionLegacyId) : null;
        const expected = !seeded.active
          ? []
          : seeded.role === 'management'
            ? all.map((row) => row.id)
            : seeded.role === 'lead'
              ? all.filter((row) => row.sectionId === section).map((row) => row.id)
              : seeded.role === 'sales'
                ? all.filter((row) => row.ownerId === legacyUuid(seeded.legacyId)).map((row) => row.id)
                : [];
        expect(visible, seeded.email).toEqual(expected.sort());
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('CR4: one lead, several sections', () => {
    it('lets a lead of two sections see both, and only those', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const nadiaBefore = await signIn(ctx.app, emails.leadGA);
      await makeFarhanLeadOfGovernmentApplications(admin);

      const farhan = await signIn(ctx.app, emails.leadIS);
      expect(await visibleIds(farhan)).toEqual(await idsInSections(ids.sectionGA, ids.sectionIS));
      const me = await farhan.agent.get('/api/auth/me').expect(200);
      expect(me.body.user.sections.map((section: { name: string }) => section.name)).toEqual([
        'Government Applications',
        'Infrastructure & Security',
      ]);
      const dashboard = await farhan.agent.get('/api/dashboard').expect(200);
      expect(dashboard.body.scopeLabel).toMatch(/sections you lead/);

      // Nadia led only GA, so she stays in it as a salesperson (D-CR4-4):
      // her own records only, and her old session ended with the role change.
      await nadiaBefore.agent.get('/api/auth/me').expect(401);
      const nadia = await signIn(ctx.app, emails.leadGA);
      const nadiaOwn = (await ctx.database.db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.ownerId, ids.leadGA)))
        .map((row) => row.id)
        .sort();
      expect(await visibleIds(nadia)).toEqual(nadiaOwn);
      await nadia.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(404);
    });

    it('removes a section from a lead on their next request when someone else is appointed to it', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await makeFarhanLeadOfGovernmentApplications(admin);
      const farhan = await signIn(ctx.app, emails.leadIS);
      await farhan.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);

      // Tasnia, a GA member, is promoted; Farhan keeps IS and stays a lead.
      const replaced = await send(admin, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
        version: await versionOf('sections', ids.sectionGA),
        newLeadId: ids.salesGA2,
        reason: 'Tasnia takes over Government Applications.',
      });
      expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
      const [farhanRow] = await ctx.database.db.select().from(users).where(eq(users.id, ids.leadIS));
      expect(farhanRow!.role).toBe('lead');

      // Same session, next request: the GA record is gone, IS remains.
      await farhan.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(404);
      expect(await visibleIds(farhan)).toEqual(await idsInSections(ids.sectionIS));
    });

    it('lets a lead move a record between two sections they lead, and no further (D-CR4-2)', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await makeFarhanLeadOfGovernmentApplications(admin);
      const farhan = await signIn(ctx.app, emails.leadIS);

      const moved = await send(farhan, `/api/opportunities/${ids.oppRafiq}/transfer`, {
        version: await versionOf('opportunities', ids.oppRafiq),
        newOwnerId: ids.salesIS1,
        reason: 'Infrastructure owns this now.',
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(moved.body.sectionId).toBe(ids.sectionIS);

      // A section Farhan does not lead stays out of reach.
      const otherLead = await send(admin, '/api/admin/users', { fullName: 'Health Lead', email: 'health.lead@example.com', role: 'lead' }).expect(201);
      const health = await send(admin, '/api/admin/sections', { name: 'Health Systems', leadId: otherLead.body.user.id }).expect(201);
      await patch(admin, `/api/admin/users/${ids.salesIS2}`, {
        version: await versionOf('users', ids.salesIS2),
        sectionIds: [ids.sectionIS, health.body.id],
      }).expect(200);
      const outside = await send(farhan, `/api/opportunities/${ids.oppTasnia}/transfer`, {
        version: await versionOf('opportunities', ids.oppTasnia),
        newOwnerId: ids.salesIS2,
        newSectionId: health.body.id,
        reason: 'Not his section.',
      });
      expect(outside.status).toBe(422);
      expect(outside.body.fieldErrors.newSectionId).toBeTruthy();
    });

    it('refuses to leave an active section without its lead, in the database as well as the service', async () => {
      const db = ctx.database.db; // the restricted runtime role
      expect((await databaseError(db.update(sections).set({ leadUserId: null }).where(eq(sections.id, ids.sectionGA)))).constraint).toBe(
        'sections_active_has_lead',
      );
      const salespersonAsLead = await databaseError(
        db.transaction(async (tx) => {
          await tx.update(sections).set({ leadUserId: ids.salesGA1 }).where(eq(sections.id, ids.sectionGA));
        }),
      );
      expect(salespersonAsLead).toMatchObject({ code: '23514', constraint: 'sections_lead_is_active_lead' });
      for (const change of [{ role: 'sales' as const }, { active: false }]) {
        const refused = await databaseError(
          db.transaction(async (tx) => {
            await tx.update(users).set(change).where(eq(users.id, ids.leadGA));
          }),
        );
        expect(refused).toMatchObject({ code: '23514', constraint: 'users_still_lead_their_sections' });
      }

      // Inside one transaction the lead may be swapped: the check runs at commit.
      await db.transaction(async (tx) => {
        await tx.update(users).set({ role: 'lead' }).where(eq(users.id, ids.salesGA2));
        await tx.update(sections).set({ leadUserId: ids.salesGA2 }).where(eq(sections.id, ids.sectionGA));
        await tx.update(users).set({ role: 'sales' }).where(eq(users.id, ids.leadGA));
      });

      // And the service refuses with a readable reason.
      const admin = await signIn(ctx.app, emails.admin);
      const deactivate = await send(admin, `/api/admin/users/${ids.salesGA2}/deactivate`, { version: await versionOf('users', ids.salesGA2) });
      expect(deactivate.status).toBe(409);
      expect(deactivate.body.message).toMatch(/Replace lead/);
    });

    it('does not let a lead of other sections keep records in the section they leave', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await makeFarhanLeadOfGovernmentApplications(admin);
      const farhan = await signIn(ctx.app, emails.leadIS);
      // Farhan takes a GA record himself.
      const taken = await send(farhan, `/api/opportunities/${ids.oppRafiq}/transfer`, {
        version: await versionOf('opportunities', ids.oppRafiq),
        newOwnerId: ids.leadIS,
        newSectionId: ids.sectionGA,
        reason: 'Taking it over.',
      });
      expect(taken.status, JSON.stringify(taken.body)).toBe(200);

      const replaced = await send(admin, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
        version: await versionOf('sections', ids.sectionGA),
        newLeadId: ids.salesGA2,
        reason: 'Back to a GA lead.',
      });
      expect(replaced.status).toBe(409);
      expect(replaced.body.message).toMatch(/owns opportunities in this section/);
    });
  });

  // -------------------------------------------------------------------------
  describe('CR5: one salesperson, several sections', () => {
    it('adds a section without signing the person out, and lets them sell there', async () => {
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const admin = await signIn(ctx.app, emails.admin);
      const response = await addTasniaToInfrastructure(admin);
      expect(response.body.sections.map((section: { id: string }) => section.id).sort()).toEqual(
        [ids.sectionGA, ids.sectionIS].sort(),
      );

      // Gaining a section is not a material change: same session.
      const me = await tasnia.agent.get('/api/auth/me').expect(200);
      expect(me.body.user.sections).toHaveLength(2);

      // Two owner options for herself, one per section.
      const lookups = await tasnia.agent.get('/api/lookups/opportunity-owners').expect(200);
      expect(lookups.body.items.map((item: { id: string; sectionId: string }) => `${item.id}/${item.sectionId}`).sort()).toEqual(
        [`${ids.salesGA2}/${ids.sectionGA}`, `${ids.salesGA2}/${ids.sectionIS}`].sort(),
      );

      const created = await send(
        tasnia,
        '/api/opportunities',
        createOpportunityPayload({ name: 'Data centre refresh', ownerId: ids.salesGA2, sectionId: ids.sectionIS }),
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.opportunity?.id ?? created.body.id;

      // Each opportunity belongs to exactly one section: IS's lead sees it,
      // GA's lead does not; Tasnia sees her records in both sections.
      const farhan = await signIn(ctx.app, emails.leadIS);
      const nadia = await signIn(ctx.app, emails.leadGA);
      await farhan.agent.get(`/api/opportunities/${id}`).expect(200);
      await nadia.agent.get(`/api/opportunities/${id}`).expect(404);
      const tasniaVisible = await visibleIds(tasnia);
      expect(tasniaVisible).toContain(id);
      expect(tasniaVisible).toContain(ids.oppTasnia);

      // Leads' owner lookups offer her in the sections they lead only.
      const farhanLookups = await farhan.agent.get('/api/lookups/opportunity-owners').expect(200);
      expect(farhanLookups.body.items.filter((item: { id: string }) => item.id === ids.salesGA2).map((item: { sectionId: string }) => item.sectionId)).toEqual([ids.sectionIS]);
    });

    it('refuses a section the owner does not work in, without revealing other teams', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const wrongSection = await send(rafiq, '/api/opportunities', createOpportunityPayload({ sectionId: ids.sectionIS }));
      expect(wrongSection.status).toBe(422);
      expect(wrongSection.body.fieldErrors.sectionId).toBeTruthy();

      const nadia = await signIn(ctx.app, emails.leadGA);
      const otherTeam = await send(nadia, '/api/opportunities', createOpportunityPayload({ ownerId: ids.salesIS1, sectionId: ids.sectionIS }));
      expect(otherTeam.status).toBe(403);
      const ownerElsewhere = await send(nadia, '/api/opportunities', createOpportunityPayload({ ownerId: ids.salesIS1, sectionId: ids.sectionGA }));
      expect(ownerElsewhere.status).toBe(403);
    });

    it('blocks leaving a section while owning records there, then allows it once they move', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await addTasniaToInfrastructure(admin);
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const created = await send(
        tasnia,
        '/api/opportunities',
        createOpportunityPayload({ name: 'Network audit', ownerId: ids.salesGA2, sectionId: ids.sectionIS }),
      ).expect(201);
      const id = created.body.opportunity?.id ?? created.body.id;

      const blocked = await patch(admin, `/api/admin/users/${ids.salesGA2}`, {
        version: await versionOf('users', ids.salesGA2),
        sectionIds: [ids.sectionGA],
      });
      expect(blocked.status).toBe(409);

      const farhan = await signIn(ctx.app, emails.leadIS);
      await send(farhan, `/api/opportunities/${id}/transfer`, {
        version: await versionOf('opportunities', id),
        newOwnerId: ids.salesIS1,
        reason: 'Tasnia returns to GA only.',
      }).expect(200);

      const allowed = await patch(admin, `/api/admin/users/${ids.salesGA2}`, {
        version: await versionOf('users', ids.salesGA2),
        sectionIds: [ids.sectionGA],
        reason: 'Back to Government Applications only.',
      });
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
      // Losing a section is material: her session ends (SEC-005).
      await tasnia.agent.get('/api/auth/me').expect(401);
    });

    it('fails closed: former membership grants nothing, even over a record still owned', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await addTasniaToInfrastructure(admin);
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const created = await send(
        tasnia,
        '/api/opportunities',
        createOpportunityPayload({ name: 'Left behind', ownerId: ids.salesGA2, sectionId: ids.sectionIS }),
      ).expect(201);
      const id = created.body.opportunity?.id ?? created.body.id;

      // Bypassing the service, end the IS membership while she still owns
      // the record: scope must not follow the ownership alone.
      await ctx.database.db
        .update(sectionMemberships)
        .set({ endedAt: new Date(), endedBy: ids.admin })
        .where(and(eq(sectionMemberships.userId, ids.salesGA2), eq(sectionMemberships.sectionId, ids.sectionIS), isNull(sectionMemberships.endedAt)));

      await tasnia.agent.get(`/api/opportunities/${id}`).expect(404);
      expect(await visibleIds(tasnia)).not.toContain(id);
      const farhan = await signIn(ctx.app, emails.leadIS);
      await farhan.agent.get(`/api/opportunities/${id}`).expect(200);
    });

    it('keeps membership history: the runtime role cannot delete it', async () => {
      const refused = await databaseError(ctx.database.db.delete(sectionMemberships).where(eq(sectionMemberships.userId, ids.salesGA1)));
      expect(refused.code).toBe('42501'); // insufficient_privilege
      expect(refused.message).toMatch(/permission denied/);
    });

    it('asks which section when the new owner works in several and the current one is not among them', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const health = await send(admin, '/api/admin/sections', { name: 'Health Systems', leadId: ids.leadGA }).expect(201);
      await patch(admin, `/api/admin/users/${ids.salesGA2}`, {
        version: await versionOf('users', ids.salesGA2),
        sectionIds: [ids.sectionGA, health.body.id],
      }).expect(200);

      const arif = await signIn(ctx.app, emails.management);
      const [imranRecord] = await ctx.database.db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.ownerId, ids.salesIS1), eq(opportunities.status, 'active')))
        .limit(1);
      const ambiguous = await send(arif, `/api/opportunities/${imranRecord!.id}/transfer`, {
        version: imranRecord!.version,
        newOwnerId: ids.salesGA2,
        reason: 'Health project now.',
      });
      expect(ambiguous.status).toBe(422);
      expect(ambiguous.body.fieldErrors.newSectionId).toBeTruthy();

      const notHers = await send(arif, `/api/opportunities/${imranRecord!.id}/transfer`, {
        version: imranRecord!.version,
        newOwnerId: ids.salesGA2,
        newSectionId: ids.sectionIS,
        reason: 'Health project now.',
      });
      expect(notHers.status).toBe(422);

      const chosen = await send(arif, `/api/opportunities/${imranRecord!.id}/transfer`, {
        version: imranRecord!.version,
        newOwnerId: ids.salesGA2,
        newSectionId: health.body.id,
        reason: 'Health project now.',
      });
      expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
      expect(chosen.body.sectionId).toBe(health.body.id);

      // Nadia leads GA and Health: she now sees it; Farhan (IS) does not.
      const nadia = await signIn(ctx.app, emails.leadGA);
      await nadia.agent.get(`/api/opportunities/${imranRecord!.id}`).expect(200);
      const farhan = await signIn(ctx.app, emails.leadIS);
      await farhan.agent.get(`/api/opportunities/${imranRecord!.id}`).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('alerts and assignment follow the new scope', () => {
    it('alerts the lead of the record’s section, whichever other sections they lead', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await makeFarhanLeadOfGovernmentApplications(admin);
      const assignees = await (await signIn(ctx.app, emails.management)).agent
        .get(`/api/opportunities/${ids.oppRafiq}/follow-up-assignees`)
        .expect(200);
      const relations = (assignees.body.items as { id: string; relation: string }[]).map((item) => `${item.id}:${item.relation}`);
      expect(relations).toContain(`${ids.leadIS}:section_lead`);
      expect(relations).not.toContain(`${ids.leadGA}:section_lead`);
    });
  });
});
