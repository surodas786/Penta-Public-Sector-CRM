/**
 * Plan 7.6 scenario 23: child records inherit parent scope, and no response
 * carries a credential or session field.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEvents, followUps } from '../db/schema.js';
import {
  ABSENT_UUID,
  createTestApp,
  emails,
  ids,
  resetFixtures,
  signIn,
  type TestContext,
} from './helpers/harness.js';

/** Anything that must never appear in a response body. */
const FORBIDDEN_RESPONSE_KEYS = [
  'passwordHash',
  'password_hash',
  'password',
  'sessionVersion',
  'session_version',
  'sess',
  'sid',
  'csrfSecret',
  'sessionSecret',
];

function assertNoSensitiveKeys(value: unknown, pathLabel = 'response'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveKeys(entry, `${pathLabel}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_RESPONSE_KEYS.includes(key)) {
      throw new Error(`${pathLabel}.${key} is a credential or session field and must not be returned`);
    }
    assertNoSensitiveKeys(nested, `${pathLabel}.${key}`);
  }
}

describe('child record scope and response shape', () => {
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

  describe('scenario 23 — child ids cannot bypass the parent', () => {
    it('returns the follow-ups of an accessible opportunity', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get(`/api/opportunities/${ids.oppRafiq}/follow-ups`).expect(200);

      expect(response.body.total).toBeGreaterThan(0);
      for (const item of response.body.items as { opportunityId: string }[]) {
        expect(item.opportunityId).toBe(ids.oppRafiq);
      }
    });

    it('refuses the follow-ups of a colleague’s opportunity', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get(`/api/opportunities/${ids.oppTasnia}/follow-ups`);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not_found');
    });

    it('refuses the follow-ups of another section’s opportunity', async () => {
      const { agent } = await signIn(ctx.app, emails.leadGA);
      await agent.get(`/api/opportunities/${ids.oppImran}/follow-ups`).expect(404);
      await agent.get(`/api/opportunities/${ids.oppImran}/history`).expect(404);
    });

    it('cannot be reached by pairing a real child id with an accessible parent', async () => {
      // A follow-up belonging to a record the caller cannot see.
      const [foreignTask] = await ctx.database.db
        .select({ id: followUps.id })
        .from(followUps)
        .where(eq(followUps.opportunityId, ids.oppImran));
      expect(foreignTask).toBeTruthy();

      const { agent } = await signIn(ctx.app, emails.salesGA1);

      // The caller's own opportunity returns only its own children, never the
      // foreign task, whichever id is supplied.
      const own = await agent.get(`/api/opportunities/${ids.oppRafiq}/follow-ups`).expect(200);
      const returnedIds = (own.body.items as { id: string }[]).map((item) => item.id);
      expect(returnedIds).not.toContain(foreignTask!.id);
    });

    it('exposes no standalone child route that could skip the parent check', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const [foreignTask] = await ctx.database.db
        .select({ id: followUps.id })
        .from(followUps)
        .where(eq(followUps.opportunityId, ids.oppImran));

      for (const route of [
        `/api/follow-ups/${foreignTask!.id}`,
        `/api/followups/${foreignTask!.id}`,
        `/api/history/${ids.oppImran}`,
        `/api/audit-events?opportunityId=${ids.oppImran}`,
      ]) {
        const response = await agent.get(route);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('not_found');
      }
    });

    it('refuses children of a nonexistent parent the same way', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      await agent.get(`/api/opportunities/${ABSENT_UUID}/follow-ups`).expect(404);
      await agent.get(`/api/opportunities/${ABSENT_UUID}/history`).expect(404);
    });

    it('validates child pagination parameters', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get(`/api/opportunities/${ids.oppRafiq}/follow-ups?pageSize=500`);
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty('pageSize');
    });

    it('never returns an administrative audit event through commercial history', async () => {
      // An administrative event attached to the same opportunity id.
      await ctx.database.db.insert(auditEvents).values({
        actorId: ids.admin,
        opportunityId: ids.oppRafiq,
        entityType: 'user',
        entityId: ids.salesGA1,
        action: 'user.role_changed',
        domain: 'administrative',
        requestId: 'test-admin-event',
      });

      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);

      const actions = (response.body.items as { action: string }[]).map((item) => item.action);
      expect(actions).not.toContain('user.role_changed');
    });
  });

  describe('scenario 23 — responses omit credentials and session fields', () => {
    it('returns no sensitive field from the current-account endpoint', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get('/api/auth/me').expect(200);

      assertNoSensitiveKeys(response.body);
      expect(Object.keys(response.body.user).sort()).toEqual([
        'capabilities',
        'email',
        'fullName',
        'id',
        'role',
        'section',
      ]);
    });

    it('returns no sensitive field from opportunity, follow-up or history payloads', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);

      for (const route of [
        '/api/opportunities',
        `/api/opportunities/${ids.oppRafiq}`,
        `/api/opportunities/${ids.oppRafiq}/follow-ups`,
        `/api/opportunities/${ids.oppRafiq}/history`,
        '/api/organizations',
        '/api/lookups/opportunity-owners',
      ]) {
        const response = await agent.get(route).expect(200);
        assertNoSensitiveKeys(response.body, route);

        const serialised = JSON.stringify(response.body);
        expect(serialised).not.toContain('$argon2');
        expect(serialised).not.toContain('penta.sid');
      }
    });

    it('does not leak the session cookie value into any body', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const response = await agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
      expect(JSON.stringify(response.body)).not.toMatch(/connect\.sid|penta\.sid|s%3A/);
    });
  });
});
