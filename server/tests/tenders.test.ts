/**
 * Milestone 5: tender cycles and bid submission (FR-050, FR-051, FR-052,
 * BR-040, AT-10, AT-11). The clock is frozen at 10:00 Dhaka time on
 * 5 October 2026 so deadline indicators are deterministic.
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, opportunities, organizations, tenders } from '../db/schema.js';
import { legacyUuid } from '../db/seedData.js';
import {
  ABSENT_UUID,
  TEST_ORIGIN,
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

const NOW = '2026-10-05T10:00:00+06:00';

/** A valid new notice for Rafiq's p3 (Department of Civic Records). */
function noticePayload(overrides: Record<string, unknown> = {}) {
  return {
    procuringOrganizationId: ids.orgCivicRecords,
    title: 'Re-tender: Civic Records Document Management System',
    reference: 'DCR/PROC/2026/240',
    procurementMethod: 'Request for Proposal (RFP)',
    noticeUrl: 'https://tenders.example.com/notice/DCR-2026-240',
    publicationDate: '2026-10-02',
    clarificationDeadline: '2026-10-12T17:00:00+06:00',
    submissionDeadline: '2026-10-20T15:00:00+06:00',
    bidStatus: 'reviewing',
    ...overrides,
  };
}

describe('tenders', () => {
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
    clock = new FixedClock(NOW);
    setClock(clock);
  });

  afterEach(() => {
    resetClock();
  });

  const patch = (client: SignedInClient, path: string, body: unknown) =>
    client.agent.patch(path).set('Origin', TEST_ORIGIN).set('x-csrf-token', client.csrfToken).send(body as object);
  const create = (client: SignedInClient, opportunityId: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/opportunities/${opportunityId}/tenders`, body, key);
  const submit = (client: SignedInClient, tenderId: string, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/tenders/${tenderId}/submit`, body, key);

  async function tender(id: string) {
    const [row] = await ctx.database.db.select().from(tenders).where(eq(tenders.id, id));
    return row!;
  }
  async function opportunity(id: string) {
    const [row] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, id));
    return row!;
  }
  async function actions(opportunityId: string) {
    const rows = await ctx.database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.opportunityId, opportunityId));
    return rows.map((row) => row.action);
  }
  const currentCount = async (opportunityId: string) =>
    (await ctx.database.db.select().from(tenders).where(and(eq(tenders.opportunityId, opportunityId), eq(tenders.isCurrent, true))))
      .length;

  // -------------------------------------------------------------------------
  describe('scope and role isolation', () => {
    it('shows each role only the tenders on opportunities it can see', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const own = await rafiq.agent.get('/api/tenders').expect(200);
      expect(own.body.items.map((item: { reference: string }) => item.reference).sort()).toEqual([
        'DCR/PROC/2026/221',
        'DPTI/ICT/2026/009',
      ]);
      expect(own.body.items.every((item: { responsibleOwner: { fullName: string } }) => item.responsibleOwner.fullName === 'Rafiq Hasan')).toBe(true);

      const lead = await signIn(ctx.app, emails.leadGA);
      const section = await lead.agent.get('/api/tenders').expect(200);
      expect(section.body.total).toBe(4); // t1, t2, t3, t4 in Government Applications
      expect(section.body.items.every((item: { section: { name: string } }) => item.section.name === 'Government Applications')).toBe(true);

      const management = await signIn(ctx.app, emails.management);
      expect((await management.agent.get('/api/tenders').expect(200)).body.total).toBe(8);
    });

    it('sorts the tracker by submission deadline and filters by Dhaka deadline date and bid status', async () => {
      const management = await signIn(ctx.app, emails.management);
      const all = await management.agent.get('/api/tenders').expect(200);
      const deadlines = all.body.items.map((item: { submissionDeadline: string }) => item.submissionDeadline);
      expect([...deadlines].sort()).toEqual(deadlines);

      // 2026-10-04 12:00 Dhaka is 06:00Z on the 4th; 2026-10-05 15:00 is the 5th.
      const window = await management.agent.get('/api/tenders?deadlineFrom=2026-10-04&deadlineTo=2026-10-05').expect(200);
      expect(window.body.items.map((item: { reference: string }) => item.reference).sort()).toEqual([
        'DPTI/ICT/2026/014',
        'PPDC/IT/2026/118',
      ]);
      const submitted = await management.agent.get('/api/tenders?bidStatus=submitted').expect(200);
      expect(submitted.body.total).toBe(3);
    });

    it('refuses the administrator: 403 on the tracker, the same 404 on a tender', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      expect((await admin.agent.get('/api/tenders')).status).toBe(403);
      const hidden = await admin.agent.get(`/api/tenders/${ids.tenderRafiq}`);
      const absent = await admin.agent.get(`/api/tenders/${ABSENT_UUID}`);
      expect(hidden.status).toBe(404);
      expect({ ...hidden.body, requestId: null }).toEqual({ ...absent.body, requestId: null });
    });

    it('answers a forged tender id outside scope exactly like a missing one, for every operation', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const before = await tender(ids.tenderTasnia);
      const attempts = [
        () => rafiq.agent.get(`/api/tenders/${ids.tenderTasnia}`),
        () => patch(rafiq, `/api/tenders/${ids.tenderTasnia}`, { version: before.version, notes: 'Forged' }),
        () => submit(rafiq, ids.tenderTasnia, { version: before.version, submittedAt: NOW, moveOpportunityToBidSubmitted: true }),
        () => send(rafiq, `/api/tenders/${ids.tenderTasnia}/cancel`, { version: before.version, reason: 'Forged' }),
        () => send(rafiq, `/api/tenders/${ids.tenderTasnia}/designate-current`, { version: before.version }),
        () => create(rafiq, ids.oppTasnia, noticePayload({ procuringOrganizationId: legacyUuid('o4') })),
        () => rafiq.agent.get(`/api/opportunities/${ids.oppTasnia}/tenders`),
      ];
      const absent = await rafiq.agent.get(`/api/tenders/${ABSENT_UUID}`);
      for (const attempt of attempts) {
        const response = await attempt();
        expect(response.status).toBe(404);
        expect({ ...response.body, requestId: null }).toEqual({ ...absent.body, requestId: null });
      }
      expect(await tender(ids.tenderTasnia)).toEqual(before);
    });

    it('moves tender visibility and responsibility with an ownership transfer (BR-050)', async () => {
      const lead = await signIn(ctx.app, emails.leadGA);
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      expect((await rafiq.agent.get(`/api/tenders/${ids.tenderRafiq}`)).status).toBe(200);

      const { version } = await opportunity(ids.oppRafiqTender);
      const moved = await send(lead, `/api/opportunities/${ids.oppRafiqTender}/transfer`, {
        version,
        newOwnerId: ids.salesGA2,
        reason: 'Workload balancing',
      });
      expect(moved.status).toBe(200);

      expect((await rafiq.agent.get(`/api/tenders/${ids.tenderRafiq}`)).status).toBe(404);
      const tracker = await rafiq.agent.get('/api/tenders').expect(200);
      expect(tracker.body.items.map((item: { id: string }) => item.id)).not.toContain(ids.tenderRafiq);
      const now = await tasnia.agent.get(`/api/tenders/${ids.tenderRafiq}`).expect(200);
      expect(now.body.responsibleOwner.fullName).toBe('Tasnia Karim');
    });
  });

  // -------------------------------------------------------------------------
  describe('deadline indicators (FR-052, AT-11)', () => {
    async function indicator(client: SignedInClient, tenderId: string) {
      return (await client.agent.get(`/api/tenders/${tenderId}`).expect(200)).body.indicator as string;
    }

    it('is red after the deadline, amber within 72 hours, neutral later and green when submitted', async () => {
      // Signs in at each frozen instant: moving the clock days ahead would
      // otherwise end the session on its idle limit.
      const at = async (instant: string, tenderId: string) => {
        clock.set(instant);
        return indicator(await signIn(ctx.app, emails.management), tenderId);
      };
      expect(await at(NOW, ids.tenderTasnia)).toBe('missed'); // 4 Oct 12:00
      expect(await at(NOW, ids.tenderRafiq)).toBe('upcoming'); // 8 Oct 15:00, 77 hours away
      expect(await at(NOW, ids.tenderRafiqSubmitted)).toBe('submitted');
      expect(await at('2026-10-05T15:00:01+06:00', ids.tenderRafiq)).toBe('due_soon'); // 71h59m59s before
      expect(await at('2026-10-05T14:59:59+06:00', ids.tenderRafiq)).toBe('upcoming'); // 72h00m01s before
      expect(await at('2026-10-08T15:00:00+06:00', ids.tenderRafiq)).toBe('due_soon'); // the deadline itself
      expect(await at('2026-10-08T15:00:01+06:00', ids.tenderRafiq)).toBe('missed');
    });

    it('raises no alert for Not Participating, superseded or cancelled notices (BR-040)', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const t2 = await tender(ids.tenderRafiq);
      const declined = await patch(rafiq, `/api/tenders/${ids.tenderRafiq}`, {
        version: t2.version,
        bidStatus: 'not_participating',
        participationReason: 'OEM partnership not in place for this scope.',
      });
      expect(declined.status).toBe(200);
      expect(declined.body.indicator).toBe('not_participating');

      const replaced = await create(rafiq, ids.oppRafiqTender, noticePayload());
      expect(replaced.status).toBe(201);
      expect((await rafiq.agent.get(`/api/tenders/${ids.tenderRafiq}`).expect(200)).body.indicator).toBe('inactive');

      const cancelled = await send(rafiq, `/api/tenders/${replaced.body.id}/cancel`, {
        version: replaced.body.version,
        reason: 'Notice withdrawn by the procuring entity.',
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.indicator).toBe('inactive');
      expect(cancelled.body.isCurrent).toBe(false);

      // The default tracker shows current notices only.
      const tracker = await rafiq.agent.get('/api/tenders').expect(200);
      expect(tracker.body.items.map((item: { opportunity: { id: string } }) => item.opportunity.id)).not.toContain(ids.oppRafiqTender);
      const everything = await rafiq.agent.get('/api/tenders?notice=all').expect(200);
      expect(everything.body.items.filter((item: { opportunity: { id: string } }) => item.opportunity.id === ids.oppRafiqTender)).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('tender cycles (FR-050)', () => {
    it('re-tendering supersedes the previous notice, keeps it with its history, and leaves one current', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('tender');
      const first = await create(rafiq, ids.oppRafiqTender, noticePayload(), key);
      expect(first.status).toBe(201);
      expect(first.body.isCurrent).toBe(true);
      expect(first.body.noticeState).toBe('current');
      expect(first.body.responsibleOwner.fullName).toBe('Rafiq Hasan');

      // A retried create is recognised, not applied twice.
      const retry = await create(rafiq, ids.oppRafiqTender, noticePayload(), key);
      expect(retry.status).toBe(200);
      expect(retry.body.id).toBe(first.body.id);

      const cycles = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiqTender}/tenders`).expect(200);
      expect(cycles.body.items.map((item: { reference: string; noticeState: string }) => [item.reference, item.noticeState])).toEqual([
        ['DCR/PROC/2026/240', 'current'],
        ['DCR/PROC/2026/221', 'superseded'],
      ]);
      expect(await currentCount(ids.oppRafiqTender)).toBe(1);
      expect((await actions(ids.oppRafiqTender)).filter((action) => action.startsWith('tender.')).sort()).toEqual([
        'tender.created',
        'tender.superseded',
      ]);
    });

    it('keeps exactly one current notice when two cycles are created at the same moment', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const lead = await signIn(ctx.app, emails.leadGA);
      const [a, b] = await Promise.all([
        create(rafiq, ids.oppRafiqTender, noticePayload({ reference: 'DCR/PROC/2026/301' })),
        create(lead, ids.oppRafiqTender, noticePayload({ reference: 'DCR/PROC/2026/302' })),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(await currentCount(ids.oppRafiqTender)).toBe(1);
      const all = await ctx.database.db.select().from(tenders).where(eq(tenders.opportunityId, ids.oppRafiqTender));
      expect(all).toHaveLength(3);
      expect(all.filter((row) => row.noticeState === 'superseded')).toHaveLength(2);
    });

    it('enforces one current notice in the database itself', async () => {
      const failure = await ctx.database.db
        .execute(sql`UPDATE tenders SET is_current = true, notice_state = 'current' WHERE id = ${ids.tenderRafiq}`)
        .then(() => null, (error: unknown) => error as { cause?: { code?: string } });
      expect(failure).toBeNull(); // already the current one: no change

      const second = await ctx.database.db
        .insert(tenders)
        .values({
          opportunityId: ids.oppRafiqTender,
          procuringOrganizationId: ids.orgCivicRecords,
          title: 'A second current notice',
          reference: 'DCR/DUP/1',
          publicationDate: '2026-10-01',
          submissionDeadline: new Date('2026-10-20T09:00:00Z'),
          bidStatus: 'reviewing',
          isCurrent: true,
          noticeState: 'current',
          createdBy: ids.salesGA1,
        })
        .then(() => null, (error: unknown) => error as { cause?: { code?: string; constraint?: string } });
      expect(second?.cause?.code).toBe('23505');
      expect(second?.cause?.constraint).toBe('tenders_one_current_per_opportunity');
    });

    it('designates a superseded notice current again, superseding the other', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const newer = await create(rafiq, ids.oppRafiqTender, noticePayload());
      const older = await tender(ids.tenderRafiq);
      const restored = await send(rafiq, `/api/tenders/${ids.tenderRafiq}/designate-current`, { version: older.version });
      expect(restored.status).toBe(200);
      expect(restored.body.isCurrent).toBe(true);
      expect((await tender(newer.body.id)).noticeState).toBe('superseded');
      expect(await currentCount(ids.oppRafiqTender)).toBe(1);
    });

    it('keeps superseded and cancelled notices as history', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await create(rafiq, ids.oppRafiqTender, noticePayload());
      const older = await tender(ids.tenderRafiq);
      const edit = await patch(rafiq, `/api/tenders/${ids.tenderRafiq}`, { version: older.version, notes: 'Rewrite history' });
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe('invalid_transition');

      const cancel = await send(rafiq, `/api/tenders/${ids.tenderRafiq}/cancel`, { version: older.version, reason: 'Withdrawn' });
      expect(cancel.status).toBe(200);
      const cancelled = await tender(ids.tenderRafiq);
      const revive = await send(rafiq, `/api/tenders/${ids.tenderRafiq}/designate-current`, { version: cancelled.version });
      expect(revive.status).toBe(409);
    });

    it('can never be deleted, even by the application role', async () => {
      const failure = await ctx.database.db
        .execute(sql`DELETE FROM tenders WHERE id = ${ids.tenderRafiq}`)
        .then(() => null, (error: unknown) => error as { cause?: { code?: string } });
      expect(failure?.cause?.code).toBe('42501');
    });

    it('takes no new tender on a closed opportunity', async () => {
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const response = await create(tasnia, ids.oppTasniaLost, noticePayload());
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('invalid_transition');
    });

    it('refuses a stale version', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const { version } = await tender(ids.tenderRafiq);
      expect((await patch(rafiq, `/api/tenders/${ids.tenderRafiq}`, { version, notes: 'First' })).status).toBe(200);
      const stale = await patch(rafiq, `/api/tenders/${ids.tenderRafiq}`, { version, notes: 'Second' });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('version_conflict');
    });
  });

  // -------------------------------------------------------------------------
  describe('required fields and chronology (§7.1, BR-040)', () => {
    it.each([
      ['a deadline before publication', { publicationDate: '2026-10-21' }, 'submissionDeadline'],
      ['a clarification deadline after submission', { clarificationDeadline: '2026-10-21T09:00:00+06:00' }, 'clarificationDeadline'],
      ['Not Participating without a reason', { bidStatus: 'not_participating' }, 'participationReason'],
      ['a non-web notice URL', { noticeUrl: 'ftp://tenders.example.com/notice' }, 'noticeUrl'],
      ['a two-character title', { title: 'RF' }, 'title'],
      ['no reference', { reference: '' }, 'reference'],
      ['no submission deadline', { submissionDeadline: undefined }, 'submissionDeadline'],
      ['Submitted set directly', { bidStatus: 'submitted' }, 'bidStatus'],
      ['an unknown procuring entity', { procuringOrganizationId: ABSENT_UUID }, 'procuringOrganizationId'],
    ])('refuses %s', async (_label, overrides, field) => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await create(rafiq, ids.oppRafiqTender, noticePayload(overrides));
      expect(response.status).toBe(422);
      expect(Object.keys(response.body.fieldErrors)).toContain(field);
      expect(await currentCount(ids.oppRafiqTender)).toBe(1);
      expect((await tender(ids.tenderRafiq)).noticeState).toBe('current');
    });

    it('compares the deadline with publication as a Dhaka calendar date', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      // 00:30 on 2 October in Dhaka is still 1 October in UTC.
      const sameDay = await create(rafiq, ids.oppRafiqTender, noticePayload({
        publicationDate: '2026-10-02',
        clarificationDeadline: null,
        submissionDeadline: '2026-10-02T00:30:00+06:00',
      }));
      expect(sameDay.status).toBe(201);
    });

    it('labels a procuring entity that differs from the opportunity’s organization', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const other = await create(rafiq, ids.oppRafiqTender, noticePayload({ procuringOrganizationId: ids.orgSylvanHills }));
      expect(other.status).toBe(201);
      expect(other.body.procuringDiffersFromOpportunity).toBe(true);
      expect((await rafiq.agent.get(`/api/tenders/${ids.tenderRafiqSubmitted}`)).body.procuringDiffersFromOpportunity).toBe(false);
    });

    it('refuses an archived procuring entity', async () => {
      await ctx.database.db
        .update(organizations)
        .set({ archivedAt: new Date() })
        .where(eq(organizations.id, ids.orgBangla));
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await create(rafiq, ids.oppRafiqTender, noticePayload({ procuringOrganizationId: ids.orgBangla }));
      expect(response.status).toBe(422);
    });

    it.each([
      ['a deadline before publication', sql`UPDATE tenders SET publication_date = '2026-10-30' WHERE id = ${ids.tenderRafiq}`],
      ['Submitted without a time', sql`UPDATE tenders SET bid_status = 'submitted' WHERE id = ${ids.tenderRafiq}`],
      ['a time without Submitted', sql`UPDATE tenders SET submitted_at = now() WHERE id = ${ids.tenderRafiq}`],
      ['Not Participating without a reason', sql`UPDATE tenders SET bid_status = 'not_participating' WHERE id = ${ids.tenderRafiq}`],
      ['a late submission without a note', sql`UPDATE tenders SET bid_status = 'submitted', submitted_at = '2026-10-09T00:00:00Z' WHERE id = ${ids.tenderRafiq}`],
      ['a current flag on a superseded notice', sql`UPDATE tenders SET notice_state = 'superseded' WHERE id = ${ids.tenderRafiq}`],
      ['a javascript: notice URL', sql`UPDATE tenders SET notice_url = 'javascript:alert(1)' WHERE id = ${ids.tenderRafiq}`],
    ])('rejects %s in the database even from the application role', async (_label, statement) => {
      const failure = await ctx.database.db.execute(statement).then(
        () => null,
        (error: unknown) => error as { cause?: { code?: string } },
      );
      expect(failure?.cause?.code).toBe('23514');
    });
  });

  // -------------------------------------------------------------------------
  describe('bid submission (FR-051, AT-10)', () => {
    it('requires an explicit answer about the stage', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const { version } = await tender(ids.tenderRafiq);
      const response = await submit(rafiq, ids.tenderRafiq, { version, submittedAt: '2026-10-05T09:30:00+06:00' });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty('moveOpportunityToBidSubmitted');
      expect((await tender(ids.tenderRafiq)).bidStatus).toBe('reviewing');
    });

    it('keeps the stage when the user declines, and shows the mismatch', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const { version } = await tender(ids.tenderRafiq);
      const before = await opportunity(ids.oppRafiqTender);
      const response = await submit(rafiq, ids.tenderRafiq, {
        version,
        submittedAt: '2026-10-05T09:30:00+06:00',
        moveOpportunityToBidSubmitted: false,
      });
      expect(response.status).toBe(200);
      expect(response.body.stageChanged).toBe(false);
      expect(response.body.tender.bidStatus).toBe('submitted');
      expect(response.body.tender.submittedAt).toBe('2026-10-05T03:30:00.000Z');
      expect(response.body.tender.stageMismatch).toBe(true);
      expect(response.body.tender.indicator).toBe('submitted');

      const after = await opportunity(ids.oppRafiqTender);
      expect(after.stage).toBe('tender_published');
      expect(after.version).toBe(before.version);
      expect(await actions(ids.oppRafiqTender)).toEqual(['tender.submitted']);
    });

    it('moves the opportunity to Bid Submitted atomically when accepted, never to Awarded, once on retry', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const { version } = await tender(ids.tenderRafiq);
      const key = nextIdempotencyKey('submit');
      const body = { version, submittedAt: '2026-10-05T09:30:00+06:00', moveOpportunityToBidSubmitted: true };
      const first = await submit(rafiq, ids.tenderRafiq, body, key);
      expect(first.status).toBe(200);
      expect(first.body.stageChanged).toBe(true);
      expect(first.body.tender.opportunity.stage).toBe('bid_submitted');
      expect(first.body.tender.stageMismatch).toBe(false);

      const retry = await submit(rafiq, ids.tenderRafiq, body, key);
      expect(retry.status).toBe(200);
      expect(retry.body.stageChanged).toBe(true);
      expect(retry.body.tender.id).toBe(ids.tenderRafiq);

      const after = await opportunity(ids.oppRafiqTender);
      expect(after.stage).toBe('bid_submitted');
      expect(after.awardedValue).toBeNull();
      expect(after.awardDate).toBeNull();
      expect((await actions(ids.oppRafiqTender)).sort()).toEqual(['opportunity.stage_changed', 'tender.submitted']);

      // A second submission under a new key is a conflict, not a duplicate.
      const again = await submit(rafiq, ids.tenderRafiq, { ...body, version: (await tender(ids.tenderRafiq)).version });
      expect(again.status).toBe(409);
      expect((await actions(ids.oppRafiqTender))).toHaveLength(2);
    });

    it('treats two simultaneous submissions with one key as one', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const { version } = await tender(ids.tenderRafiq);
      const key = nextIdempotencyKey('submit-race');
      const body = { version, submittedAt: '2026-10-05T09:30:00+06:00', moveOpportunityToBidSubmitted: true };
      const responses = await Promise.all([submit(rafiq, ids.tenderRafiq, body, key), submit(rafiq, ids.tenderRafiq, body, key)]);
      expect(responses.map((response) => response.status).sort()).toEqual(
        responses.some((response) => response.status === 409) ? [200, 409] : [200, 200],
      );
      expect((await actions(ids.oppRafiqTender)).sort()).toEqual(['opportunity.stage_changed', 'tender.submitted']);
    });

    it('refuses to move a stage that is already at or past Bid Submitted, and changes nothing', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      // p10 is at Evaluation; record a fresh notice and try to submit with a stage move.
      const p10 = legacyUuid('p10');
      const created = await create(nadia, p10, noticePayload({ procuringOrganizationId: legacyUuid('o1') }));
      expect(created.status).toBe(201);
      expect(created.body.canOfferBidSubmittedStage).toBe(false);
      const response = await submit(nadia, created.body.id, {
        version: created.body.version,
        submittedAt: '2026-10-05T09:30:00+06:00',
        moveOpportunityToBidSubmitted: true,
      });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('invalid_transition');
      expect((await tender(created.body.id)).bidStatus).toBe('reviewing');
      expect((await opportunity(p10)).stage).toBe('evaluation');
    });

    it('does not offer or apply a stage move on an On Hold opportunity', async () => {
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const created = await create(tasnia, ids.oppTasniaOnHold, noticePayload({ procuringOrganizationId: legacyUuid('o4') }));
      expect(created.status).toBe(201);
      expect(created.body.canOfferBidSubmittedStage).toBe(false);
      // On Hold keeps its deadline alerts (BR-014).
      expect(created.body.indicator).toBe('upcoming');
      const moved = await submit(tasnia, created.body.id, {
        version: created.body.version,
        submittedAt: '2026-10-05T09:30:00+06:00',
        moveOpportunityToBidSubmitted: true,
      });
      expect(moved.status).toBe(409);
    });

    it('asks for an explanation of a submission after the recorded deadline, then records it', async () => {
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const { version } = await tender(ids.tenderTasnia); // deadline 4 Oct 12:00
      const late = { version, submittedAt: '2026-10-04T13:15:00+06:00', moveOpportunityToBidSubmitted: false };
      const refused = await submit(tasnia, ids.tenderTasnia, late);
      expect(refused.status).toBe(422);
      expect(refused.body.fieldErrors).toHaveProperty('lateSubmissionNote');

      const recorded = await submit(tasnia, ids.tenderTasnia, {
        ...late,
        lateSubmissionNote: 'Deadline extended by corrigendum; extension letter on file.',
      });
      expect(recorded.status).toBe(200);
      expect(recorded.body.tender.lateSubmissionNote).toMatch(/corrigendum/);
    });

    it.each([
      ['in the future', '2026-10-05T11:00:00+06:00', 'submittedAt'],
      ['before publication', '2026-09-01T10:00:00+06:00', 'submittedAt'],
    ])('refuses a submission time %s', async (_label, submittedAt, field) => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const { version } = await tender(ids.tenderRafiq);
      const response = await submit(rafiq, ids.tenderRafiq, { version, submittedAt, moveOpportunityToBidSubmitted: false });
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toHaveProperty(field);
    });

    it('submits only the current notice, and not a Not Participating one', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const t2 = await tender(ids.tenderRafiq);
      await patch(rafiq, `/api/tenders/${ids.tenderRafiq}`, {
        version: t2.version,
        bidStatus: 'not_participating',
        participationReason: 'Scope outside our capability.',
      });
      const declined = await tender(ids.tenderRafiq);
      const response = await submit(rafiq, ids.tenderRafiq, {
        version: declined.version,
        submittedAt: '2026-10-05T09:00:00+06:00',
        moveOpportunityToBidSubmitted: false,
      });
      expect(response.status).toBe(409);

      await create(rafiq, ids.oppRafiqTender, noticePayload());
      const superseded = await tender(ids.tenderRafiq);
      const old = await submit(rafiq, ids.tenderRafiq, {
        version: superseded.version,
        submittedAt: '2026-10-05T09:00:00+06:00',
        moveOpportunityToBidSubmitted: false,
      });
      expect(old.status).toBe(409);
    });

    it('does not reverse a recorded submission through editing', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const t3 = await tender(ids.tenderRafiqSubmitted);
      const response = await patch(rafiq, `/api/tenders/${ids.tenderRafiqSubmitted}`, { version: t3.version, bidStatus: 'preparing' });
      expect(response.status).toBe(409);
      expect((await tender(ids.tenderRafiqSubmitted)).bidStatus).toBe('submitted');
    });

    it('writes the submission and stage change to the opportunity’s Change History', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const { version } = await tender(ids.tenderRafiq);
      await submit(rafiq, ids.tenderRafiq, { version, submittedAt: '2026-10-05T09:30:00+06:00', moveOpportunityToBidSubmitted: true });
      const history = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiqTender}/history`).expect(200);
      const submitted = history.body.items.find((entry: { action: string }) => entry.action === 'tender.submitted');
      expect(submitted.subject).toBe('DCR/PROC/2026/221');
      expect(submitted.changes).toEqual(
        expect.arrayContaining([{ field: 'bidStatus', label: 'Bid status', before: 'Reviewing', after: 'Submitted' }]),
      );
      const staged = history.body.items.find((entry: { action: string }) => entry.action === 'opportunity.stage_changed');
      expect(staged.reason).toBe('Bid submitted for tender DCR/PROC/2026/221.');
      expect(staged.changes).toEqual([{ field: 'stage', label: 'Stage', before: 'Tender Published', after: 'Bid Submitted' }]);
    });
  });
});

