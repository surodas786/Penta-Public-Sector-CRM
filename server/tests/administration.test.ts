/**
 * Milestone 3: account and section administration, invitations and recovery,
 * and management's team view (FR-071, BR-051, BR-052, SEC-005, SEC-012,
 * SEC-030, SEC-031). AT-09.
 */
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, opportunities, sections, users } from '../db/schema.js';
import {
  TEST_ORIGIN,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  send,
  signIn,
  startSession,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

const NEW_PASSWORD = 'correct horse battery staple 2026';

describe('administration', () => {
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

  async function account(id: string) {
    const [row] = await ctx.database.db.select().from(users).where(eq(users.id, id));
    return row!;
  }

  const patch = (client: SignedInClient, path: string, body: unknown) =>
    client.agent.patch(path).set('Origin', TEST_ORIGIN).set('x-csrf-token', client.csrfToken).send(body as object);

  const createUser = (admin: SignedInClient, body: Record<string, unknown>) =>
    send(admin, '/api/admin/users', body);

  /** Redeems a link exactly as the browser page does. */
  async function setPassword(url: string, password = NEW_PASSWORD) {
    const token = url.split('#token=')[1]!;
    const visitor = await startSession(ctx.app);
    return visitor.agent
      .post('/api/auth/set-password')
      .set('Origin', TEST_ORIGIN)
      .set('x-csrf-token', visitor.csrfToken)
      .send({ token, password });
  }

  async function signInStatus(email: string, password: string) {
    const visitor = await startSession(ctx.app);
    const response = await visitor.agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('x-csrf-token', visitor.csrfToken)
      .send({ email, password });
    return response.status;
  }

  // -------------------------------------------------------------------------
  describe('access to administration', () => {
    it('is the administrator’s alone', async () => {
      await request(ctx.app).get('/api/admin/users').expect(401);
      for (const email of [emails.management, emails.leadGA, emails.salesGA1]) {
        const client = await signIn(ctx.app, email);
        await client.agent.get('/api/admin/users').expect(403);
        await client.agent.get('/api/admin/audit').expect(403);
        const create = await createUser(client, { fullName: 'Nobody', email: 'nobody@example.com', role: 'admin' });
        expect(create.status).toBe(403);
      }
    });

    it('lists accounts without credentials or session fields', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const response = await admin.agent.get('/api/admin/users').query({ pageSize: 100 }).expect(200);
      expect(response.body.total).toBe(10);
      const serialised = JSON.stringify(response.body);
      for (const forbiddenKey of ['passwordHash', 'password_hash', 'sessionVersion', 'argon2']) {
        expect(serialised).not.toContain(forbiddenKey);
      }
      const rafiq = response.body.items.find((item: { id: string }) => item.id === ids.salesGA1);
      expect(rafiq).toMatchObject({ role: 'sales', sectionName: 'Government Applications', managerName: 'Nadia Islam', invitationPending: false });
    });

    it('carries no commercial data and does not appear in commercial history', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await createUser(admin, { fullName: 'Audit Probe', email: 'audit.probe@example.com', role: 'management' }).expect(201);
      const audit = await admin.agent.get('/api/admin/audit').expect(200);
      expect(audit.body.items.every((item: { action: string }) => item.action.startsWith('account.') || item.action.startsWith('section.'))).toBe(true);

      const commercial = await ctx.database.db
        .select({ value: sql<number>`count(*)::int` })
        .from(auditEvents)
        .where(sql`${auditEvents.domain} = 'administrative' AND ${auditEvents.opportunityId} IS NOT NULL`);
      expect(commercial[0]!.value).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('invitations and recovery (SEC-030)', () => {
    it('creates an account with a single-use invitation, then the person signs in', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const created = await createUser(admin, {
        fullName: 'Lamia Chowdhury',
        email: 'Lamia.Chowdhury@Example.com',
        role: 'sales',
        sectionId: ids.sectionGA,
      });
      expect(created.status).toBe(201);
      expect(created.body.user).toMatchObject({
        email: 'lamia.chowdhury@example.com',
        role: 'sales',
        managerId: ids.leadGA,
        invitationPending: true,
      });
      expect(created.body.link.purpose).toBe('invitation');
      expect(created.body.link.url).toMatch(/^http:\/\/localhost:5173\/set-password#token=[\w-]{40,}$/);

      // No password yet: sign-in fails like any wrong password.
      expect(await signInStatus('lamia.chowdhury@example.com', NEW_PASSWORD)).toBe(401);

      const redeemed = await setPassword(created.body.link.url);
      expect(redeemed.status).toBe(204);
      expect(await signInStatus('lamia.chowdhury@example.com', NEW_PASSWORD)).toBe(200);

      // Single use.
      const again = await setPassword(created.body.link.url, 'another long password 99');
      expect(again.status).toBe(422);
      expect(again.body.message).toMatch(/invalid, has already been used, or has expired/);

      // The token is never stored or audited in readable form.
      const token = created.body.link.url.split('#token=')[1];
      const stored = await ctx.database.db.execute(sql`SELECT token_hash FROM account_tokens`);
      expect(JSON.stringify(stored.rows)).not.toContain(token);
      const audit = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.entityId, created.body.user.id));
      expect(JSON.stringify(audit)).not.toContain(token);
      expect(audit.map((row) => row.action)).toEqual(
        expect.arrayContaining(['account.created', 'account.invitation_issued', 'account.invitation_accepted']),
      );
    });

    it('never shows the invitation link twice, even on a retried create', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const body = { fullName: 'Retry Person', email: 'retry.person@example.com', role: 'management' };
      const first = await send(admin, '/api/admin/users', body, 'admin-create-retry-key-0001');
      const retry = await send(admin, '/api/admin/users', body, 'admin-create-retry-key-0001');
      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      expect(retry.body.user.id).toBe(first.body.user.id);
      expect(retry.body.link).toBeNull();
    });

    it('gives the same answer for unknown, malformed and expired links', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const clock = new FixedClock('2026-10-05T06:00:00Z');
      setClock(clock);
      const link = await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {}).expect(201);
      expect(link.body.purpose).toBe('password_reset');

      clock.advanceMinutes(24 * 60 + 1);
      const expired = await setPassword(link.body.url);
      const unknown = await setPassword('http://x/set-password#token=' + 'A'.repeat(43));
      for (const response of [expired, unknown]) {
        expect(response.status).toBe(422);
        expect(response.body.message).toBe(unknown.body.message);
      }
    });

    it('resets a password: the old one stops working and existing sessions end', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await rafiq.agent.get('/api/auth/me').expect(200);

      const admin = await signIn(ctx.app, emails.admin);
      const first = await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {}).expect(201);
      const second = await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {}).expect(201);

      // Only the newest link works.
      expect((await setPassword(first.body.url)).status).toBe(422);
      expect((await setPassword(second.body.url)).status).toBe(204);

      await rafiq.agent.get('/api/auth/me').expect(401);
      expect(await signInStatus(emails.salesGA1, process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026')).toBe(401);
      expect(await signInStatus(emails.salesGA1, NEW_PASSWORD)).toBe(200);
    });

    it('rejects a short password without spending the link', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const link = await send(admin, `/api/admin/users/${ids.salesGA1}/link`, {}).expect(201);
      const short = await setPassword(link.body.url, 'short');
      expect(short.status).toBe(422);
      expect(short.body.fieldErrors.password).toBeTruthy();
      expect((await setPassword(link.body.url)).status).toBe(204);
    });
  });

  // -------------------------------------------------------------------------
  describe('AT-09: restructuring and deactivation (BR-051, BR-052)', () => {
    it('blocks deactivating someone who owns open opportunities, without quantifying them', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const { version } = await account(ids.salesGA1);
      const response = await send(admin, `/api/admin/users/${ids.salesGA1}/deactivate`, { version });
      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/owns opportunities that are still open/);
      expect(response.body.message).not.toMatch(/\d/);
      expect((await account(ids.salesGA1)).active).toBe(true);
    });

    it('deactivates once the work is transferred, and ends the person’s session', async () => {
      // Move every open opportunity Rafiq owns to Tasnia first.
      const nadia = await signIn(ctx.app, emails.leadGA);
      const owned = await ctx.database.db.select().from(opportunities).where(eq(opportunities.ownerId, ids.salesGA1));
      for (const row of owned.filter((o) => !['awarded', 'lost'].includes(o.stage) && o.status !== 'cancelled')) {
        await send(nadia, `/api/opportunities/${row.id}/transfer`, {
          version: row.version,
          newOwnerId: ids.salesGA2,
          reason: 'Before deactivation',
        }).expect(200);
      }

      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const admin = await signIn(ctx.app, emails.admin);
      const { version } = await account(ids.salesGA1);
      const response = await send(admin, `/api/admin/users/${ids.salesGA1}/deactivate`, { version, reason: 'Left Penta' });
      expect(response.status).toBe(200);
      expect(response.body.active).toBe(false);

      await rafiq.agent.get('/api/auth/me').expect(401);
      // His closed record stays his, as an inactive historical owner (BR-051).
      const nadiaView = await nadia.agent.get(`/api/opportunities/${ids.oppRafiqAwarded}`).expect(200);
      expect(nadiaView.body.ownerName).toBe('Rafiq Hasan');
    });

    it('blocks moving an owner to another section, or out of a selling role', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const { version } = await account(ids.salesGA1);
      const moved = await patch(admin, `/api/admin/users/${ids.salesGA1}`, { version, sectionId: ids.sectionIS });
      expect(moved.status).toBe(409);
      const promoted = await patch(admin, `/api/admin/users/${ids.salesGA1}`, { version, role: 'management' });
      expect(promoted.status).toBe(409);
      const after = await account(ids.salesGA1);
      expect(after.sectionId).toBe(ids.sectionGA);
      expect(after.role).toBe('sales');
    });

    it('moves a salesperson with no opportunities, re-pointing their lead and ending their sessions', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const created = await createUser(admin, { fullName: 'Movable Person', email: 'movable@example.com', role: 'sales', sectionId: ids.sectionGA });
      await setPassword(created.body.link.url);
      const person = await signIn(ctx.app, 'movable@example.com', NEW_PASSWORD);
      await person.agent.get('/api/auth/me').expect(200);

      const { version } = await account(created.body.user.id);
      const response = await patch(admin, `/api/admin/users/${created.body.user.id}`, { version, sectionId: ids.sectionIS });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ sectionId: ids.sectionIS, managerId: ids.leadIS });
      await person.agent.get('/api/auth/me').expect(401);
    });

    it('keeps a salesperson’s reporting line to their own section’s lead', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const wrongLead = await createUser(admin, {
        fullName: 'Wrong Lead',
        email: 'wrong.lead@example.com',
        role: 'sales',
        sectionId: ids.sectionGA,
        managerId: ids.leadIS,
      });
      expect(wrongLead.status).toBe(422);
      expect(wrongLead.body.fieldErrors.managerId).toBeTruthy();

      const secondLead = await createUser(admin, { fullName: 'Second Lead', email: 'second.lead@example.com', role: 'lead', sectionId: ids.sectionGA });
      expect(secondLead.status).toBe(409);
      expect(secondLead.body.message).toMatch(/Replace lead/);
    });

    it('replaces a section lead atomically: role, direct reports and sessions', async () => {
      const nadiaSession = await signIn(ctx.app, emails.leadGA);
      const tasniaSession = await signIn(ctx.app, emails.salesGA2);
      const admin = await signIn(ctx.app, emails.admin);
      const [section] = await ctx.database.db.select().from(sections).where(eq(sections.id, ids.sectionGA));

      const response = await send(admin, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
        version: section!.version,
        newLeadId: ids.salesGA2,
        reason: 'Nadia moves to a bid-management role.',
      });
      expect(response.status).toBe(200);
      expect(response.body.leadId).toBe(ids.salesGA2);

      expect((await account(ids.salesGA2)).role).toBe('lead');
      expect((await account(ids.leadGA)).role).toBe('sales');
      const gaSales = await ctx.database.db.select().from(users).where(sql`${users.sectionId} = ${ids.sectionGA} AND ${users.role} = 'sales'`);
      for (const person of gaSales) expect(person.managerId).toBe(ids.salesGA2);

      // Both changed role: both sessions end.
      await nadiaSession.agent.get('/api/auth/me').expect(401);
      await tasniaSession.agent.get('/api/auth/me').expect(401);

      // Scope follows the new roles immediately.
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      await tasnia.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
      const nadia = await signIn(ctx.app, emails.leadGA);
      await nadia.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(404);
      await nadia.agent.get(`/api/opportunities/${ids.oppNadia}`).expect(200);
    });

    it('refuses to deactivate the only lead of an active section, or to appoint an outsider', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const { version } = await account(ids.leadGA);
      const response = await send(admin, `/api/admin/users/${ids.leadGA}/deactivate`, { version });
      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/Replace lead/);

      const [section] = await ctx.database.db.select().from(sections).where(eq(sections.id, ids.sectionGA));
      const outsider = await send(admin, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
        version: section!.version,
        newLeadId: ids.salesIS1,
        reason: 'Wrong section',
      });
      expect(outsider.status).toBe(422);
    });

    it('keeps a section with open opportunities or active members active', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const [ga] = await ctx.database.db.select().from(sections).where(eq(sections.id, ids.sectionGA));
      const blocked = await send(admin, `/api/admin/sections/${ids.sectionGA}/deactivate`, { version: ga!.version });
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toMatch(/open opportunities/);

      const created = await send(admin, '/api/admin/sections', { name: 'Digital Health' }).expect(201);
      const off = await send(admin, `/api/admin/sections/${created.body.id}/deactivate`, { version: created.body.version });
      expect(off.status).toBe(200);
      expect(off.body.active).toBe(false);
      const on = await send(admin, `/api/admin/sections/${created.body.id}/reactivate`, { version: off.body.version });
      expect(on.body.active).toBe(true);
    });

    it('lets a new section get its first lead and then salespeople', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const section = await send(admin, '/api/admin/sections', { name: 'Smart Cities' }).expect(201);
      const early = await createUser(admin, { fullName: 'Too Early', email: 'too.early@example.com', role: 'sales', sectionId: section.body.id });
      expect(early.status).toBe(409);

      const lead = await createUser(admin, {
        fullName: 'First Lead',
        email: 'first.lead@example.com',
        role: 'lead',
        sectionId: section.body.id,
        managerId: ids.management,
      }).expect(201);
      const sales = await createUser(admin, { fullName: 'First Seller', email: 'first.seller@example.com', role: 'sales', sectionId: section.body.id }).expect(201);
      expect(sales.body.user.managerId).toBe(lead.body.user.id);
    });

    it('rejects a duplicate email', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const response = await createUser(admin, { fullName: 'Copy', email: 'RAFIQ.HASAN@example.com', role: 'management' });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.email).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe('administrators', () => {
    it('cannot change their own role or deactivate themselves', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      const { version } = await account(ids.admin);
      expect((await patch(admin, `/api/admin/users/${ids.admin}`, { version, role: 'management' })).status).toBe(403);
      expect((await send(admin, `/api/admin/users/${ids.admin}/deactivate`, { version })).status).toBe(403);
      expect((await account(ids.admin)).role).toBe('admin');
    });

    it('can never leave the system without an active administrator', async () => {
      // A second administrator, signed in.
      const first = await signIn(ctx.app, emails.admin);
      const created = await createUser(first, { fullName: 'Second Admin', email: 'second.admin@example.com', role: 'admin' }).expect(201);
      await setPassword(created.body.link.url);
      const second = await signIn(ctx.app, 'second.admin@example.com', NEW_PASSWORD);

      const firstVersion = (await account(ids.admin)).version;
      const secondVersion = (await account(created.body.user.id)).version;
      // Each tries to deactivate the other at the same moment.
      const [a, b] = await Promise.all([
        send(first, `/api/admin/users/${created.body.user.id}/deactivate`, { version: secondVersion }),
        send(second, `/api/admin/users/${ids.admin}/deactivate`, { version: firstVersion }),
      ]);

      // One wins. The other is refused, depending on timing: 401 if its
      // session was already ended, 403 if it found itself deactivated after
      // waiting for the administrator locks, 409 at the last-admin check.
      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(200);
      expect([401, 403, 409]).toContain(statuses[1]);
      const active = await ctx.database.db.select().from(users).where(sql`${users.role} = 'admin' AND ${users.active}`);
      expect(active).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('management team view (FR-071)', () => {
    it('shows structure and workload to management, computed on the server', async () => {
      const arif = await signIn(ctx.app, emails.management);
      const response = await arif.agent.get('/api/team').expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(/@example\.com|password|session/i);
      const ga = response.body.sections.find((s: { id: string }) => s.id === ids.sectionGA);
      expect(ga.lead.fullName).toBe('Nadia Islam');

      const rafiq = response.body.workload.find((row: { userId: string }) => row.userId === ids.salesGA1);
      const owned = await ctx.database.db.select().from(opportunities).where(eq(opportunities.ownerId, ids.salesGA1));
      const active = owned.filter((o) => o.status === 'active' && !['awarded', 'lost'].includes(o.stage));
      expect(rafiq.activeOpportunities).toBe(active.length);
      const paisa = active.reduce((sum, o) => sum + BigInt(o.estimatedValue.replace('.', '')), 0n);
      expect(BigInt(rafiq.estimatedPipeline.replace('.', ''))).toBe(paisa);

      // Inactive people are not listed as workload.
      expect(response.body.workload.map((row: { userId: string }) => row.userId)).not.toContain(ids.inactiveGA);
    });

    it('is refused to every other role', async () => {
      for (const email of [emails.leadGA, emails.salesGA1, emails.admin]) {
        const client = await signIn(ctx.app, email);
        await client.agent.get('/api/team').expect(403);
      }
    });
  });
});
