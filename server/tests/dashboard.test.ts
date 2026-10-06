/**
 * Milestone 6: scoped dashboards and Dhaka business dates (FR-080, FR-081,
 * §10.1, D-002, D-006, AT-11, AT-12).
 *
 * The clock is frozen at instants chosen around the fixtures, so every
 * boundary — Dhaka midnight for overdue follow-ups, the exclusive seven-day
 * tender window, the calendar quarter — is exercised exactly.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DashboardDto, OpportunityListDto } from '../../shared/api.js';
import { sumMoney } from '../../shared/money.js';
import { FixedClock, addCalendarDays, dhakaQuarter, dhakaStartOfDay, dhakaToday, resetClock, setClock } from '../clock.js';
import { opportunities, users } from '../db/schema.js';
import { opportunityScope, userSeesOpportunitySql } from '../policy/scope.js';
import type { Actor } from '../policy/actor.js';
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

/** The approved demo's "today": 02 Oct 2026, 10:00 Bangladesh time. */
const DEMO_NOW = '2026-10-02T10:00:00+06:00';

describe('dashboard (M6)', () => {
  let ctx: TestContext;
  let clock: FixedClock;

  beforeAll(() => {
    ctx = createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetFixtures();
    clock = new FixedClock(DEMO_NOW);
    setClock(clock);
  });
  afterEach(() => {
    resetClock();
  });

  /** Signs in at the current frozen instant (the session's idle limit follows the clock). */
  async function as(email: string): Promise<SignedInClient> {
    return signIn(ctx.app, email);
  }

  async function dashboard(client: SignedInClient, query = ''): Promise<DashboardDto> {
    const response = await client.agent.get(`/api/dashboard${query}`).expect(200);
    return response.body as DashboardDto;
  }

  /** Every page of a list endpoint, to reconcile totals without trusting one page. */
  async function allOpportunities(client: SignedInClient, query: string) {
    const items: OpportunityListDto['items'] = [];
    for (let page = 1; ; page += 1) {
      const body = (await client.agent.get(`/api/opportunities?pageSize=5&page=${page}&${query}`).expect(200))
        .body as OpportunityListDto;
      items.push(...body.items);
      if (items.length >= body.total) return { items, total: body.total };
    }
  }

  describe('business-date helpers', () => {
    it('computes Dhaka calendar quarters and day starts', () => {
      expect(dhakaQuarter('2026-10-01')).toEqual({ label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31' });
      expect(dhakaQuarter('2026-09-30')).toEqual({ label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' });
      expect(dhakaQuarter('2028-02-29')).toEqual({ label: 'Q1 2028', start: '2028-01-01', end: '2028-03-31' });
      expect(dhakaQuarter('2026-12-31').end).toBe('2026-12-31');
      expect(dhakaStartOfDay('2026-10-02').toISOString()).toBe('2026-10-01T18:00:00.000Z');
      expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
      // 23:59 UTC on 1 Oct is already 2 Oct in Dhaka.
      expect(dhakaToday(new Date('2026-10-01T18:00:00Z'))).toBe('2026-10-02');
      expect(dhakaToday(new Date('2026-10-01T17:59:59Z'))).toBe('2026-10-01');
    });
  });

  describe('scope and role separation (AT-01, AT-02, AT-03)', () => {
    it('gives each role its own totals, computed on the server', async () => {
      const management = await dashboard(await as(emails.management));
      const lead = await dashboard(await as(emails.leadGA));
      const leadIS = await dashboard(await as(emails.leadIS));
      const rafiq = await dashboard(await as(emails.salesGA1));

      // Section totals add up to the organization's.
      expect(lead.kpis.activeOpportunities + leadIS.kpis.activeOpportunities).toBe(
        management.kpis.activeOpportunities,
      );
      expect(sumMoney([lead.kpis.estimatedActivePipeline, leadIS.kpis.estimatedActivePipeline])).toBe(
        management.kpis.estimatedActivePipeline,
      );

      // Rafiq owns OPP-900001, 003, 008 and 021 in the active pipeline.
      expect(rafiq.kpis.activeOpportunities).toBe(4);
      expect(rafiq.kpis.estimatedActivePipeline).toBe('116500000.00');
      expect(rafiq.workload).toBeNull();
      expect(rafiq.sections).toBeNull();
      expect(rafiq.ownerOptions).toEqual([]);
      expect(rafiq.sectionOptions).toEqual([]);
      expect(rafiq.scopeLabel).toBe('Opportunities you own');

      expect(lead.sections).toBeNull();
      expect(lead.sectionOptions).toEqual([]);
      expect(lead.ownerOptions.every((option) => option.sectionId === ids.sectionGA)).toBe(true);
      expect(management.sections?.map((section) => section.name)).toEqual([
        'Government Applications',
        'Infrastructure & Security',
      ]);
    });

    it('excludes On Hold from the active pipeline and shows it separately (D-002)', async () => {
      const lead = await dashboard(await as(emails.leadGA));
      // Nine active records: the demo's corrected eight plus the M1 fixture OPP-900023.
      expect(lead.kpis.activeOpportunities).toBe(9);
      expect(lead.kpis.estimatedActivePipeline).toBe('275750000.50');
      // Without that fixture, D-002's exact figure: eight records, BDT 25.85 crore.
      const [fixture] = await ctx.database.db
        .select({ value: opportunities.estimatedValue })
        .from(opportunities)
        .where(eq(opportunities.id, ids.oppNoManagerOwner));
      expect(fixture?.value).toBe('17250000.50');
      expect(Number(lead.kpis.estimatedActivePipeline) - Number(fixture?.value)).toBe(258_500_000);
      // The held BDT 1.45 crore is reported on its own.
      expect(lead.onHold).toEqual({ count: 1, estimatedValue: '14500000.00' });
    });

    it('refuses the administrator every commercial figure', async () => {
      const admin = await as(emails.admin);
      const response = await admin.agent.get('/api/dashboard').expect(403);
      // No figure of any kind; the request id is excluded (it is random).
      const { requestId: _requestId, ...body } = response.body;
      expect(Object.keys(body).sort()).toEqual(['code', 'message']);
      expect(JSON.stringify(body)).not.toMatch(/\d/);
    });

    it('requires a session', async () => {
      const { startSession } = await import('./helpers/harness.js');
      const anonymous = await startSession(ctx.app);
      await anonymous.agent.get('/api/dashboard').expect(401);
    });

    it('allows section filters only for management and owner filters only for leads and management (FR-082)', async () => {
      const rafiq = await as(emails.salesGA1);
      await rafiq.agent.get(`/api/dashboard?ownerId=${ids.salesGA2}`).expect(403);
      await rafiq.agent.get(`/api/dashboard?sectionId=${ids.sectionGA}`).expect(403);

      const lead = await as(emails.leadGA);
      await lead.agent.get(`/api/dashboard?sectionId=${ids.sectionIS}`).expect(403);
      // A lead's owner filter narrows inside the section and cannot widen it.
      const other = await dashboard(lead, `?ownerId=${ids.salesIS1}`);
      expect(other.kpis.activeOpportunities).toBe(0);
      expect(other.workload).toEqual([]);
      const tasnia = await dashboard(lead, `?ownerId=${ids.salesGA2}`);
      expect(tasnia.kpis.activeOpportunities).toBe(2);

      const management = await as(emails.management);
      const is = await dashboard(management, `?sectionId=${ids.sectionIS}`);
      const leadIS = await dashboard(await as(emails.leadIS));
      expect(is.kpis).toEqual(leadIS.kpis);
      expect(is.scopeLabel).toBe('Infrastructure & Security');

      await management.agent.get('/api/dashboard?range=decade').expect(422);
      await management.agent.get('/api/dashboard?sectionId=not-an-id').expect(422);
      await management.agent.get('/api/dashboard?unknown=1').expect(422);
    });

    it('agrees with the policy module about who can see what', async () => {
      // `userSeesOpportunitySql` (used to choose alert recipients) must match
      // `opportunityScope` (used for every request) for every account.
      const people = await ctx.database.db.select().from(users);
      for (const person of people) {
        const actor: Actor = {
          id: person.id,
          fullName: person.fullName,
          email: person.email,
          role: person.role,
          sectionId: person.sectionId,
          sectionName: null,
          active: person.active,
          sessionVersion: person.sessionVersion,
        };
        const viaScope = await ctx.database.db
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(opportunityScope(actor));
        const viaRecipient = await ctx.database.db.execute<{ id: string }>(sql`
          SELECT ${opportunities.id} AS id FROM ${opportunities}
          JOIN ${users} ON ${users.id} = ${person.id}
          WHERE ${userSeesOpportunitySql(users)}`);
        expect(viaRecipient.rows.map((row) => row.id).sort()).toEqual(viaScope.map((row) => row.id).sort());
      }
    });
  });

  describe('reconciliation (AT-12)', () => {
    for (const [role, email] of [
      ['management', emails.management],
      ['lead', emails.leadGA],
      ['salesperson', emails.salesGA1],
      ['lead (other section)', emails.leadIS],
    ] as const) {
      it(`matches the active-pipeline list for ${role}`, async () => {
        const client = await as(email);
        const board = await dashboard(client);
        const list = await allOpportunities(client, 'pipeline=active');

        expect(list.total).toBe(board.kpis.activeOpportunities);
        expect(sumMoney(list.items.map((item) => item.estimatedValue))).toBe(board.kpis.estimatedActivePipeline);
        expect(list.items.every((item) => item.status === 'active' && item.stage !== 'awarded' && item.stage !== 'lost')).toBe(
          true,
        );

        // The stage chart's active columns add up to the same population.
        const pipelineStages = board.stages.filter((stage) => stage.valueBasis === 'estimated' && stage.stage !== 'lost');
        expect(pipelineStages.reduce((total, stage) => total + stage.count, 0)).toBe(board.kpis.activeOpportunities);
        expect(sumMoney(pipelineStages.map((stage) => stage.value))).toBe(board.kpis.estimatedActivePipeline);

        // Workload rows (leads and management) add up to the totals too.
        if (board.workload) {
          expect(board.workload.reduce((total, row) => total + row.activeOpportunities, 0)).toBe(
            board.kpis.activeOpportunities,
          );
          expect(sumMoney(board.workload.map((row) => row.estimatedPipeline))).toBe(board.kpis.estimatedActivePipeline);
          expect(board.workload.reduce((total, row) => total + row.tendersDueSoon, 0)).toBe(board.kpis.tendersDueNext7Days);
          // Open and overdue tasks per owner add up to the follow-up lists
          // (On Hold included: workload counts every open task in scope).
          const open = (await client.agent.get('/api/follow-ups?view=open').expect(200)).body;
          expect(board.workload.reduce((total, row) => total + row.openTasks, 0)).toBe(open.total);
          expect(board.workload.reduce((total, row) => total + row.overdueTasks, 0)).toBe(
            board.kpis.overdueFollowUps + board.kpis.overdueFollowUpsOnHold,
          );
        }

        // The overdue card's drill-down lists exactly its follow-ups.
        const overdue = (await client.agent.get('/api/follow-ups?view=overdue&hold=exclude').expect(200)).body;
        expect(overdue.total).toBe(board.kpis.overdueFollowUps);
        const held = (await client.agent.get('/api/follow-ups?view=overdue&hold=only').expect(200)).body;
        expect(held.total).toBe(board.kpis.overdueFollowUpsOnHold);

        // The tender card's drill-down lists exactly its notices.
        const tenders = (await client.agent.get('/api/tenders?window=7d').expect(200)).body;
        expect(tenders.total).toBe(board.kpis.tendersDueNext7Days);

        // The awarded card's drill-down: actual value, Dhaka quarter dates.
        const quarter = board.quarter;
        const awarded = await allOpportunities(
          client,
          `stage=awarded&awardDateFrom=${quarter.start}&awardDateTo=${quarter.end}`,
        );
        expect(awarded.total).toBe(board.kpis.awardedCountThisQuarter);
        expect(sumMoney(awarded.items.map((item) => item.awardedValue ?? '0'))).toBe(board.kpis.awardedValueThisQuarter);
      });
    }

    it('counts only open tasks in workload, once closed tasks exist (M8 aggregate rewrite)', async () => {
      const rafiq = await as(emails.salesGA1);
      const [task] = await ctx.database.pool
        .query<{ id: string; version: number }>(
          `SELECT id, version FROM follow_ups WHERE opportunity_id = $1 AND state = 'open' ORDER BY created_at LIMIT 1`,
          [ids.oppRafiq],
        )
        .then((result) => result.rows);
      // Completed, with a replacement, so the record keeps its next action.
      await send(rafiq, `/api/follow-ups/${task!.id}/complete`, {
        version: task!.version,
        replacement: { title: 'Replacement step', dueDate: '2026-09-20' },
      }).expect(200);

      for (const email of [emails.management, emails.leadGA]) {
        const client = await as(email);
        const board = await dashboard(client);
        const open = (await client.agent.get('/api/follow-ups?view=open').expect(200)).body;
        expect(board.workload!.reduce((total, row) => total + row.openTasks, 0)).toBe(open.total);
        expect(board.workload!.reduce((total, row) => total + row.overdueTasks, 0)).toBe(
          board.kpis.overdueFollowUps + board.kpis.overdueFollowUpsOnHold,
        );
        const rafiqRow = board.workload!.find((row) => row.userId === ids.salesGA1);
        const rafiqOpen = await ctx.database.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM follow_ups f JOIN opportunities o ON o.id = f.opportunity_id
            WHERE o.owner_id = $1 AND f.state = 'open'`,
          [ids.salesGA1],
        );
        expect(rafiqRow?.openTasks).toBe(rafiqOpen.rows[0]!.n);
      }
    });

    it('uses actual awarded value for the Awarded column and quarter card, estimates elsewhere (D-006)', async () => {
      const management = await dashboard(await as(emails.management));
      const awardedColumn = management.stages.find((stage) => stage.stage === 'awarded');
      expect(awardedColumn?.valueBasis).toBe('awarded');
      // All time: OPP-900005 (23.5M actual, 26M estimate), 900015 (56.5M, 60M), 900022 (11.8M, 12.5M).
      expect(awardedColumn).toMatchObject({ count: 3, value: '91800000.00' });
      expect(management.stages.find((stage) => stage.stage === 'lost')).toMatchObject({
        count: 2,
        value: '47000000.00',
        valueBasis: 'estimated',
      });
      expect(management.kpis.awardedValueThisQuarter).toBe('23500000.00');
      expect(management.quarter.label).toBe('Q4 2026');
      expect(management.cancelled).toEqual({ count: 1, estimatedValue: '21000000.00' });
    });

    it('applies the date range to Awarded, Lost and recent activity only', async () => {
      const client = await as(emails.management);
      const all = await dashboard(client);
      const quarter = await dashboard(client, '?range=quarter');
      expect(quarter.rangeBounds).toEqual({ from: '2026-10-01', to: '2026-12-31' });
      expect(quarter.stages.find((stage) => stage.stage === 'awarded')).toMatchObject({ count: 1, value: '23500000.00' });
      expect(quarter.stages.find((stage) => stage.stage === 'lost')?.count).toBe(0);
      expect(quarter.kpis).toEqual(all.kpis);
      const last30 = await dashboard(client, '?range=last30');
      expect(last30.rangeBounds).toEqual({ from: '2026-09-02', to: '2026-10-02' });
      expect(last30.stages.find((stage) => stage.stage === 'lost')?.count).toBe(1);
    });
  });

  describe('Dhaka boundaries with the injected clock (AT-11, FR-080)', () => {
    it('makes a follow-up overdue exactly at Dhaka midnight', async () => {
      // OPP-900007's follow-up is due 2026-10-02.
      clock.set('2026-10-02T23:59:59+06:00');
      const before = await dashboard(await as(emails.leadGA));
      clock.set('2026-10-03T00:00:00+06:00');
      const after = await dashboard(await as(emails.leadGA));
      // GA: OPP-900001 (due 30 Sep) is overdue; OPP-900007 (due 2 Oct) joins it at midnight,
      // while OPP-900002 (due 3 Oct) is due today, not overdue.
      expect(before.kpis.overdueFollowUps).toBe(1);
      expect(after.kpis.overdueFollowUps).toBe(2);

      const nadia = await as(emails.leadGA);
      const mine = await dashboard(nadia);
      const task = mine.nextActions.items.find((item) => item.opportunityId === ids.oppNadia);
      expect(task?.dueState).toBe('overdue');
      clock.set('2026-10-02T23:59:59+06:00');
      const today = await dashboard(await as(emails.leadGA));
      expect(today.nextActions.items.find((item) => item.opportunityId === ids.oppNadia)?.dueState).toBe('today');
      expect(today.today).toBe('2026-10-02');
    });

    it('counts tender deadlines from now up to, not including, now plus seven days', async () => {
      // OPP-900003's notice closes 2026-10-08 15:00 Dhaka.
      const rafiq = async () => dashboard(await as(emails.salesGA1));

      clock.set('2026-10-01T15:00:00+06:00'); // deadline = now + 7 days exactly: excluded
      expect((await rafiq()).kpis.tendersDueNext7Days).toBe(0);
      clock.set('2026-10-01T15:00:01+06:00'); // one second later: inside the window
      expect((await rafiq()).kpis.tendersDueNext7Days).toBe(1);
      clock.set('2026-10-08T15:00:00+06:00'); // the deadline instant itself: still "from now"
      expect((await rafiq()).kpis.tendersDueNext7Days).toBe(1);
      clock.set('2026-10-08T15:00:01+06:00'); // passed
      expect((await rafiq()).kpis.tendersDueNext7Days).toBe(0);
    });

    it('switches the awarded-value quarter at Dhaka midnight, not UTC midnight', async () => {
      // 2026-09-30 18:00 UTC is already 1 October in Dhaka.
      clock.set('2026-09-30T23:59:59+06:00');
      const q3 = await dashboard(await as(emails.management));
      expect(q3.quarter.label).toBe('Q3 2026');
      expect(q3.kpis.awardedValueThisQuarter).toBe('56500000.00');

      clock.set('2026-10-01T00:00:00+06:00');
      const q4 = await dashboard(await as(emails.management));
      expect(q4.quarter.label).toBe('Q4 2026');
      expect(q4.kpis.awardedValueThisQuarter).toBe('23500000.00');
      expect(q4.kpis.awardedCountThisQuarter).toBe(1);
    });
  });

  describe('On Hold and transitions', () => {
    it('shows overdue tasks on On Hold records separately', async () => {
      // OPP-900009 (On Hold) has a follow-up due 2026-11-03.
      clock.set('2026-11-05T09:00:00+06:00');
      const lead = await dashboard(await as(emails.leadGA));
      expect(lead.kpis.overdueFollowUpsOnHold).toBe(1);
      const held = (await (await as(emails.leadGA)).agent.get('/api/follow-ups?view=overdue&hold=only').expect(200)).body;
      expect(held.items.map((item: { opportunity: { id: string } }) => item.opportunity.id)).toEqual([ids.oppTasniaOnHold]);
    });

    it('moves a record out of the active pipeline when it is put On Hold (AT-05, D-002)', async () => {
      const rafiq = await as(emails.salesGA1);
      const before = await dashboard(rafiq);
      const detail = (await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200)).body;
      await send(
        rafiq,
        `/api/opportunities/${ids.oppRafiq}/status`,
        { version: detail.version, status: 'on_hold', reason: 'Budget review' },
        nextIdempotencyKey('m6'),
      ).expect(200);
      const after = await dashboard(rafiq);
      expect(after.kpis.activeOpportunities).toBe(before.kpis.activeOpportunities - 1);
      expect(after.onHold.count).toBe(before.onHold.count + 1);
      expect(Number(before.kpis.estimatedActivePipeline) - Number(after.kpis.estimatedActivePipeline)).toBe(42_000_000);
    });

    it('follows a transfer on the next request (SEC-005)', async () => {
      const lead = await as(emails.leadGA);
      const detail = (await lead.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200)).body;
      await send(
        lead,
        `/api/opportunities/${ids.oppRafiq}/transfer`,
        { version: detail.version, newOwnerId: ids.salesGA2, reason: 'Workload balance' },
        nextIdempotencyKey('m6'),
      ).expect(200);
      const rafiq = await dashboard(await as(emails.salesGA1));
      expect(rafiq.kpis.activeOpportunities).toBe(3);
      expect(rafiq.kpis.overdueFollowUps).toBe(0);
    });
  });

  describe('lists behind the cards', () => {
    it('reports records hidden by an expected-award range instead of dropping them (BR-060)', async () => {
      const lead = await as(emails.leadGA);
      const ranged = (await lead.agent.get('/api/opportunities?expectedAwardFrom=2026-01-01&expectedAwardTo=2027-12-31').expect(200))
        .body as OpportunityListDto;
      // OPP-900009 (On Hold) and OPP-900022 have no expected award date.
      expect(ranged.undatedExpectedAward).toBe(2);
      const undated = (await lead.agent.get('/api/opportunities?expectedAward=undated').expect(200)).body as OpportunityListDto;
      expect(undated.total).toBe(2);
      expect(undated.items.every((item) => item.expectedAwardDate === null)).toBe(true);
      const plain = (await lead.agent.get('/api/opportunities').expect(200)).body as OpportunityListDto;
      expect(plain.undatedExpectedAward).toBeNull();
      expect(plain.total).toBe(ranged.total + 2);
      await lead.agent.get('/api/opportunities?expectedAward=undated&expectedAwardFrom=2026-01-01').expect(422);
      await lead.agent.get('/api/opportunities?pipeline=everything').expect(422);
    });
  });
});
