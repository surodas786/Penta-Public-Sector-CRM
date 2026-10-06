/**
 * Plan 7.6 scenarios 12, 16-20 and 22: opportunity creation, the transactional
 * first follow-up, idempotency, and data-integrity rules.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEvents, followUps, opportunities } from '../db/schema.js';
import {
  CSRF_HEADER,
  TEST_ORIGIN,
  createOpportunityPayload,
  createTestApp,
  emails,
  ids,
  nextIdempotencyKey,
  resetFixtures,
  runAsMigrator,
  signIn,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

describe('opportunity creation', () => {
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

  /** POSTs a create request the way the browser does. */
  function postCreate(
    client: SignedInClient,
    payload: Record<string, unknown>,
    idempotencyKey = nextIdempotencyKey(),
  ) {
    return client.agent
      .post('/api/opportunities')
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_HEADER, client.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
  }

  async function countBusinessRows() {
    const [opps, tasks, audits] = await Promise.all([
      ctx.database.db.select({ id: opportunities.id }).from(opportunities),
      ctx.database.db.select({ id: followUps.id }).from(followUps),
      ctx.database.db.select({ id: auditEvents.id }).from(auditEvents),
    ]);
    return { opportunities: opps.length, followUps: tasks.length, auditEvents: audits.length };
  }

  // --- Scenario 16 --------------------------------------------------------
  describe('scenario 16 — a valid create commits the record, its first task and one audit event', () => {
    it('returns canonical values with a reference and version', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      const response = await postCreate(
        client,
        createOpportunityPayload({
          name: 'Union Council Service Desk',
          estimatedValue: '1500000.5',
          initialFollowUpTitle: 'Agree the discovery workshop date',
          initialFollowUpDueDate: '2027-02-01',
        }),
      );

      expect(response.status).toBe(201);
      const { opportunity, firstFollowUp } = response.body;

      expect(opportunity.name).toBe('Union Council Service Desk');
      // Canonical two-decimal string, not a float.
      expect(opportunity.estimatedValue).toBe('1500000.50');
      expect(typeof opportunity.estimatedValue).toBe('string');
      expect(opportunity.reference).toMatch(/^OPP-\d{6}$/);
      expect(opportunity.version).toBe(1);
      expect(opportunity.ownerId).toBe(ids.salesGA1);
      expect(opportunity.sectionId).toBe(ids.sectionGA);
      // M1 creates Active, nonterminal records only.
      expect(opportunity.status).toBe('active');
      expect(opportunity.stage).toBe('identified');

      // BR-014: exactly one follow-up, carrying the next action.
      expect(firstFollowUp.title).toBe('Agree the discovery workshop date');
      expect(firstFollowUp.dueDate).toBe('2027-02-01');
      expect(firstFollowUp.state).toBe('open');
      expect(firstFollowUp.assigneeId).toBe(ids.salesGA1);

      // BR-013: the next action is derived from that follow-up, not stored twice.
      expect(opportunity.nextAction.followUpId).toBe(firstFollowUp.id);
      expect(opportunity.nextAction.title).toBe('Agree the discovery workshop date');

      const after = await countBusinessRows();
      expect(after.opportunities).toBe(before.opportunities + 1);
      expect(after.followUps).toBe(before.followUps + 1);
      expect(after.auditEvents).toBe(before.auditEvents + 1);
    });

    it('writes one creation audit event naming the actor and the request', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const response = await postCreate(client, createOpportunityPayload());
      const opportunityId = response.body.opportunity.id as string;

      const events = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.opportunityId, opportunityId));

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.action).toBe('opportunity.created');
      expect(event.entityType).toBe('opportunity');
      expect(event.domain).toBe('commercial');
      expect(event.actorId).toBe(ids.salesGA1);
      expect(event.requestId).toBeTruthy();
      expect(event.beforeData).toBeNull();
      // The first task assignment is recorded inside the creation event.
      expect((event.afterData as Record<string, unknown>).firstFollowUp).toBeTruthy();
    });

    it('allocates distinct references from the database sequence', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const first = await postCreate(client, createOpportunityPayload({ name: 'Sequence One' }));
      const second = await postCreate(client, createOpportunityPayload({ name: 'Sequence Two' }));

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.opportunity.reference).not.toBe(second.body.opportunity.reference);
    });

    it('exposes the created record through its own history endpoint', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const created = await postCreate(client, createOpportunityPayload());
      const id = created.body.opportunity.id as string;

      const history = await client.agent.get(`/api/opportunities/${id}/history`).expect(200);
      expect(history.body.total).toBe(1);
      expect(history.body.items[0].action).toBe('opportunity.created');
      expect(history.body.items[0].actorName).toBe('Rafiq Hasan');
    });

    it('flags an award date earlier than publication without refusing the save', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const response = await postCreate(
        client,
        createOpportunityPayload({
          expectedPublicationDate: '2027-06-01',
          expectedAwardDate: '2027-03-01',
        }),
      );

      expect(response.status).toBe(201);
      expect(response.body.warnings).toHaveLength(1);
      expect(response.body.warnings[0]).toMatch(/earlier than the expected tender publication/i);
      expect(response.body.opportunity.expectedAwardDate).toBe('2027-03-01');
    });
  });

  // --- Scenario 12 --------------------------------------------------------
  describe('scenario 12 — forged owner and section fields fail with no business writes', () => {
    it('refuses a salesperson naming a colleague as owner', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      const response = await postCreate(
        client,
        createOpportunityPayload({ ownerId: ids.salesGA2 }),
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('forbidden');
      expect(await countBusinessRows()).toEqual(before);
    });

    it('refuses a salesperson naming their own lead as owner', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      const response = await postCreate(client, createOpportunityPayload({ ownerId: ids.leadGA }));

      expect(response.status).toBe(403);
      expect(await countBusinessRows()).toEqual(before);
    });

    it('refuses a forged section that does not match the owner', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      const response = await postCreate(
        client,
        createOpportunityPayload({ sectionId: ids.sectionIS }),
      );

      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty('sectionId');
      expect(await countBusinessRows()).toEqual(before);
    });

    it('refuses a lead naming an owner in another section', async () => {
      const client = await signIn(ctx.app, emails.leadGA);
      const before = await countBusinessRows();

      const response = await postCreate(
        client,
        createOpportunityPayload({ ownerId: ids.salesIS1, sectionId: ids.sectionIS }),
      );

      expect(response.status).toBe(403);
      expect(await countBusinessRows()).toEqual(before);
    });

    it('refuses a deactivated account as owner', async () => {
      const client = await signIn(ctx.app, emails.leadGA);
      const before = await countBusinessRows();

      const response = await postCreate(
        client,
        createOpportunityPayload({ ownerId: ids.inactiveGA }),
      );

      expect(response.status).toBe(403);
      expect(await countBusinessRows()).toEqual(before);
    });

    it('refuses management as owner, since management owns nothing in this release', async () => {
      const client = await signIn(ctx.app, emails.management);
      const before = await countBusinessRows();

      const response = await postCreate(
        client,
        createOpportunityPayload({ ownerId: ids.management, sectionId: ids.sectionGA }),
      );

      expect(response.status).toBe(403);
      expect(await countBusinessRows()).toEqual(before);
    });

    it('lets a lead create for an eligible owner in their own section', async () => {
      const client = await signIn(ctx.app, emails.leadGA);
      const response = await postCreate(
        client,
        createOpportunityPayload({ ownerId: ids.salesGA2, sectionId: ids.sectionGA }),
      );

      expect(response.status).toBe(201);
      expect(response.body.opportunity.ownerId).toBe(ids.salesGA2);
      // The first task goes to the validated owner, not to the creator.
      expect(response.body.firstFollowUp.assigneeId).toBe(ids.salesGA2);
    });

    it('lets management create across sections for an eligible owner', async () => {
      const client = await signIn(ctx.app, emails.management);
      const response = await postCreate(
        client,
        createOpportunityPayload({ ownerId: ids.salesIS1, sectionId: ids.sectionIS }),
      );

      expect(response.status).toBe(201);
      expect(response.body.opportunity.sectionId).toBe(ids.sectionIS);
    });

    it('refuses an administrator outright', async () => {
      const client = await signIn(ctx.app, emails.admin);
      const before = await countBusinessRows();

      const response = await postCreate(client, createOpportunityPayload());

      expect(response.status).toBe(403);
      expect(await countBusinessRows()).toEqual(before);
    });
  });

  // --- Scenario 17 --------------------------------------------------------
  describe('scenario 17 — failures leave no partial business writes', () => {
    it('reports every missing required field at once and writes nothing', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      const response = await postCreate(client, {
        // name, organizationId, solutionCategory, estimatedValue, ownerId,
        // sectionId, stage and the initial follow-up are all absent.
        priority: 'medium',
      });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('validation_failed');
      for (const field of [
        'name',
        'organizationId',
        'solutionCategory',
        'estimatedValue',
        'ownerId',
        'sectionId',
        'stage',
        'initialFollowUpTitle',
        'initialFollowUpDueDate',
      ]) {
        expect(response.body.fieldErrors).toHaveProperty(field);
      }
      expect(await countBusinessRows()).toEqual(before);
    });

    it('refuses a terminal stage at creation, since the outcome workflow is not available', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      for (const stage of ['awarded', 'lost']) {
        const response = await postCreate(client, createOpportunityPayload({ stage }));
        expect(response.status).toBe(422);
        expect(response.body.fieldErrors).toHaveProperty('stage');
      }
      expect(await countBusinessRows()).toEqual(before);
    });

    it('refuses an unknown organization and writes nothing', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      const response = await postCreate(
        client,
        createOpportunityPayload({ organizationId: '00000000-0000-4000-8000-000000000000' }),
      );

      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty('organizationId');
      expect(await countBusinessRows()).toEqual(before);
    });

    it('requires an idempotency key before writing anything', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      const response = await client.agent
        .post('/api/opportunities')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, client.csrfToken)
        .send(createOpportunityPayload());

      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty('idempotency-key');
      expect(await countBusinessRows()).toEqual(before);
    });

    it('rolls back the opportunity when the follow-up insert fails mid-transaction', async () => {
      // Induce a genuine failure after the opportunity row is written, to prove
      // the whole unit of work is one transaction (BR-014).
      await runAsMigrator(`
        CREATE OR REPLACE FUNCTION test_fail_follow_up_insert() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'induced failure for integration test'; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_fail_follow_up
          BEFORE INSERT ON follow_ups
          FOR EACH ROW EXECUTE FUNCTION test_fail_follow_up_insert();
      `);

      try {
        const client = await signIn(ctx.app, emails.salesGA1);
        const before = await countBusinessRows();

        const response = await postCreate(
          client,
          createOpportunityPayload({ name: 'Must Not Survive Rollback' }),
        );

        expect(response.status).toBe(500);
        // No opportunity, no follow-up, no audit event.
        expect(await countBusinessRows()).toEqual(before);

        const orphans = await ctx.database.db
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(eq(opportunities.name, 'Must Not Survive Rollback'));
        expect(orphans).toHaveLength(0);
      } finally {
        await runAsMigrator(`
          DROP TRIGGER IF EXISTS test_fail_follow_up ON follow_ups;
          DROP FUNCTION IF EXISTS test_fail_follow_up_insert();
        `);
      }
    });

    it('keeps request data out of the server log when a query fails (SEC-032)', async () => {
      await runAsMigrator(`
        CREATE OR REPLACE FUNCTION test_fail_follow_up_insert() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'induced failure for integration test'; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_fail_follow_up
          BEFORE INSERT ON follow_ups
          FOR EACH ROW EXECUTE FUNCTION test_fail_follow_up_insert();
      `);

      const logged: string[] = [];
      const original = console.error;
      console.error = (...parts: unknown[]) => {
        logged.push(parts.map((part) => (part instanceof Error ? `${part.message} ${part.stack}` : String(part))).join(' '));
      };
      try {
        const client = await signIn(ctx.app, emails.salesGA1);
        const response = await postCreate(
          client,
          createOpportunityPayload({
            name: 'Log Leak Probe',
            description: 'Confidential note: minister prefers vendor X',
            initialFollowUpTitle: 'Private follow-up wording 7731',
          }),
        );
        expect(response.status).toBe(500);
        // The response is opaque, and so is the log.
        expect(JSON.stringify(response.body)).not.toContain('Confidential');

        const text = logged.join('\n');
        for (const secret of ['Confidential note', 'Private follow-up wording 7731', ids.salesGA1]) {
          expect(text).not.toContain(secret);
        }
        expect(text).toContain(response.body.requestId);
        expect(text).toMatch(/database query failed \(SQLSTATE P0001\)/);
      } finally {
        console.error = original;
        await runAsMigrator(`
          DROP TRIGGER IF EXISTS test_fail_follow_up ON follow_ups;
          DROP FUNCTION IF EXISTS test_fail_follow_up_insert();
        `);
      }
    });

    it('frees the idempotency key after a failed attempt so a corrected retry works', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('retry-after-failure');

      const rejected = await postCreate(
        client,
        createOpportunityPayload({ ownerId: ids.salesGA2 }),
        key,
      );
      expect(rejected.status).toBe(403);

      // Same key, corrected payload.
      const accepted = await postCreate(client, createOpportunityPayload(), key);
      expect(accepted.status).toBe(201);
    });
  });

  // --- Scenario 18 --------------------------------------------------------
  describe('scenario 18 — retries with the same key and payload create one record', () => {
    it('replays a sequential retry without creating a second record', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('sequential');
      const payload = createOpportunityPayload({ name: 'Idempotent Sequential' });

      const first = await postCreate(client, payload, key);
      expect(first.status).toBe(201);

      const second = await postCreate(client, payload, key);
      expect(second.status).toBe(200);
      expect(second.body.replayed).toBe(true);
      expect(second.body.opportunity.id).toBe(first.body.opportunity.id);

      const rows = await ctx.database.db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(eq(opportunities.name, 'Idempotent Sequential'));
      expect(rows).toHaveLength(1);

      const tasks = await ctx.database.db
        .select({ id: followUps.id })
        .from(followUps)
        .where(eq(followUps.opportunityId, first.body.opportunity.id));
      expect(tasks).toHaveLength(1);

      const events = await ctx.database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.opportunityId, first.body.opportunity.id));
      expect(events).toHaveLength(1);
    });

    it('creates exactly one record when two identical requests race', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('concurrent');
      const payload = createOpportunityPayload({ name: 'Idempotent Concurrent' });

      const [a, b] = await Promise.all([
        postCreate(client, payload, key),
        postCreate(client, payload, key),
      ]);

      // Exactly one request creates the record. The duplicate is either
      // replayed (200) or told the original is still in flight (409). Neither
      // outcome may create a second record.
      const statuses = [a.status, b.status];
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      const duplicate = statuses.find((status) => status !== 201);
      expect([200, 409]).toContain(duplicate);

      const rows = await ctx.database.db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(eq(opportunities.name, 'Idempotent Concurrent'));
      expect(rows).toHaveLength(1);

      const tasks = await ctx.database.db
        .select({ id: followUps.id })
        .from(followUps)
        .where(eq(followUps.opportunityId, rows[0]!.id));
      expect(tasks).toHaveLength(1);

      const events = await ctx.database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.opportunityId, rows[0]!.id));
      expect(events).toHaveLength(1);
    });
  });

  // --- Scenario 19 --------------------------------------------------------
  describe('scenario 19 — key reuse, key scoping and replay authorisation', () => {
    it('returns 409 when the same key is reused with a different payload', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('reuse');

      const first = await postCreate(client, createOpportunityPayload({ name: 'First Shape' }), key);
      expect(first.status).toBe(201);

      const second = await postCreate(
        client,
        createOpportunityPayload({ name: 'Different Shape' }),
        key,
      );
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('idempotency_key_reuse');

      const rows = await ctx.database.db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(eq(opportunities.name, 'Different Shape'));
      expect(rows).toHaveLength(0);
    });

    it('treats the same key under a different actor as a different key', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const key = nextIdempotencyKey('shared-string');

      const first = await postCreate(
        rafiq,
        createOpportunityPayload({ name: 'Rafiq Record', ownerId: ids.salesGA1 }),
        key,
      );
      const second = await postCreate(
        tasnia,
        createOpportunityPayload({ name: 'Tasnia Record', ownerId: ids.salesGA2 }),
        key,
      );

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.opportunity.id).not.toBe(first.body.opportunity.id);
    });

    it('rechecks authorisation on replay rather than returning stored data', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('replay-authz');
      const payload = createOpportunityPayload({ name: 'Replay Authorisation' });

      const created = await postCreate(client, payload, key);
      expect(created.status).toBe(201);

      // The record moves to another section, as a transfer would do.
      await ctx.database.db
        .update(opportunities)
        .set({ ownerId: ids.salesIS1, sectionId: ids.sectionIS })
        .where(eq(opportunities.id, created.body.opportunity.id));

      const replay = await postCreate(client, payload, key);
      expect(replay.status).toBe(404);
      expect(replay.body.code).toBe('not_found');
      // No commercial values leaked through the replay path.
      expect(JSON.stringify(replay.body)).not.toContain('Replay Authorisation');
    });
  });

  // --- Scenario 20 --------------------------------------------------------
  describe('scenario 20 — a new record is visible to the right people only', () => {
    it('is readable by the owner, their lead and management, but not another section', async () => {
      const owner = await signIn(ctx.app, emails.salesGA1);
      const created = await postCreate(owner, createOpportunityPayload({ name: 'Visibility Check' }));
      expect(created.status).toBe(201);
      const id = created.body.opportunity.id as string;

      await owner.agent.get(`/api/opportunities/${id}`).expect(200);

      const lead = await signIn(ctx.app, emails.leadGA);
      await lead.agent.get(`/api/opportunities/${id}`).expect(200);

      const management = await signIn(ctx.app, emails.management);
      await management.agent.get(`/api/opportunities/${id}`).expect(200);

      const otherSectionLead = await signIn(ctx.app, emails.leadIS);
      await otherSectionLead.agent.get(`/api/opportunities/${id}`).expect(404);

      const otherSectionSales = await signIn(ctx.app, emails.salesIS1);
      await otherSectionSales.agent.get(`/api/opportunities/${id}`).expect(404);

      const colleague = await signIn(ctx.app, emails.salesGA2);
      await colleague.agent.get(`/api/opportunities/${id}`).expect(404);

      const admin = await signIn(ctx.app, emails.admin);
      await admin.agent.get(`/api/opportunities/${id}`).expect(404);
    });

    it('appears in the lead and management lists and in neither other-section list', async () => {
      const owner = await signIn(ctx.app, emails.salesGA1);
      const created = await postCreate(owner, createOpportunityPayload({ name: 'List Visibility' }));
      const id = created.body.opportunity.id as string;

      const inList = async (client: SignedInClient) => {
        const response = await client.agent.get('/api/opportunities?pageSize=100').expect(200);
        return (response.body.items as { id: string }[]).some((item) => item.id === id);
      };

      expect(await inList(owner)).toBe(true);
      expect(await inList(await signIn(ctx.app, emails.leadGA))).toBe(true);
      expect(await inList(await signIn(ctx.app, emails.management))).toBe(true);
      expect(await inList(await signIn(ctx.app, emails.leadIS))).toBe(false);
      expect(await inList(await signIn(ctx.app, emails.salesGA2))).toBe(false);
    });
  });

  // --- Scenario 22 --------------------------------------------------------
  describe('scenario 22 — money precision, Unicode and parameterised search', () => {
    it('stores and returns an exact two-decimal amount', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const response = await postCreate(
        client,
        createOpportunityPayload({ estimatedValue: '12345678.91' }),
      );

      expect(response.status).toBe(201);
      expect(response.body.opportunity.estimatedValue).toBe('12345678.91');

      const [row] = await ctx.database.db
        .select({ value: opportunities.estimatedValue })
        .from(opportunities)
        .where(eq(opportunities.id, response.body.opportunity.id));
      // String all the way down: no float ever touches the amount.
      expect(row!.value).toBe('12345678.91');
    });

    it('accepts zero, meaning "not yet estimated"', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const response = await postCreate(client, createOpportunityPayload({ estimatedValue: '0' }));

      expect(response.status).toBe(201);
      expect(response.body.opportunity.estimatedValue).toBe('0.00');
    });

    it.each([
      ['-1', 'negative'],
      ['1.555', 'three decimals'],
      ['1e7', 'exponent notation'],
      ['999999999999999.00', 'beyond the stored precision'],
      ['abc', 'not a number'],
      ['', 'empty'],
    ])('rejects %s (%s)', async (estimatedValue) => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const before = await countBusinessRows();

      const response = await postCreate(client, createOpportunityPayload({ estimatedValue }));

      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty('estimatedValue');
      expect(await countBusinessRows()).toEqual(before);
    });

    it('round-trips Bangla text in names, departments and task titles', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const banglaName = 'ইউনিয়ন ডিজিটাল সেন্টার ব্যবস্থাপনা';
      const banglaTask = 'উপজেলা নির্বাহী অফিসারের সাথে বৈঠক নির্ধারণ';

      const response = await postCreate(
        client,
        createOpportunityPayload({
          name: banglaName,
          department: 'স্থানীয় সরকার শাখা',
          initialFollowUpTitle: banglaTask,
        }),
      );

      expect(response.status).toBe(201);
      expect(response.body.opportunity.name).toBe(banglaName);
      expect(response.body.opportunity.department).toBe('স্থানীয় সরকার শাখা');
      expect(response.body.firstFollowUp.title).toBe(banglaTask);

      // And it survives a fresh read.
      const detail = await client.agent
        .get(`/api/opportunities/${response.body.opportunity.id}`)
        .expect(200);
      expect(detail.body.name).toBe(banglaName);
    });

    it('finds Bangla text through search, still inside scope', async () => {
      const owner = await signIn(ctx.app, emails.salesGA1);
      await postCreate(
        owner,
        createOpportunityPayload({ name: 'ইউনিয়ন ডিজিটাল সেন্টার ব্যবস্থাপনা' }),
      );

      const found = await owner.agent
        .get(`/api/opportunities?q=${encodeURIComponent('ডিজিটাল')}`)
        .expect(200);
      expect(found.body.total).toBe(1);

      // The same term returns nothing for someone outside scope.
      const otherSection = await signIn(ctx.app, emails.salesIS1);
      const notFound = await otherSection.agent
        .get(`/api/opportunities?q=${encodeURIComponent('ডিজিটাল')}`)
        .expect(200);
      expect(notFound.body.total).toBe(0);
    });

    it('treats SQL metacharacters in search as literal text', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);

      for (const term of ["' OR 1=1 --", "'; DROP TABLE opportunities; --", '%', '100%_']) {
        const response = await client.agent
          .get(`/api/opportunities?q=${encodeURIComponent(term)}`)
          .expect(200);
        // Never widens beyond the owner's own records.
        expect(response.body.total).toBeLessThanOrEqual(
          (await client.agent.get('/api/opportunities?pageSize=100')).body.total,
        );
        for (const item of response.body.items as { ownerId: string }[]) {
          expect(item.ownerId).toBe(ids.salesGA1);
        }
      }

      // The table is still there.
      await client.agent.get('/api/opportunities').expect(200);
    });
  });
});
