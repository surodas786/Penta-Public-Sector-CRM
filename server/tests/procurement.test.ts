/**
 * CR6: Software Procurement cycles, EOI then RFP.
 *
 * Cycles are children of their opportunity: scope, transfers and documents
 * follow it. Milestones never move the opportunity unless the user accepts
 * the offered stage, which then obeys the ordinary stage rules.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CSRF_HEADER, FILE_NAME_HEADER, type ProcurementCycleDetailDto, type ReportExportDto } from '../../shared/api.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, followUps, opportunities, procurementCycleContacts, procurementCycles } from '../db/schema.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/queue.js';
import { PDF } from './helpers/files.js';
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

const NOW = '2026-10-12T10:00:00+06:00';
const HOUR = 3_600_000;
const at = (offsetHours: number) => new Date(new Date(NOW).getTime() + offsetHours * HOUR).toISOString();

const EOI_CYCLE = {
  procuringOrganizationId: ids.orgSylvanHills,
  title: 'City records software',
  reference: 'SH/EOI/2026/01',
  eoiPublicationDate: '2026-10-01',
  eoiDeadline: at(24 * 8),
};

const RFP_FACTS = {
  rfpReference: 'SH/RFP/2026/01',
  rfpInvitationDate: '2026-10-12',
  proposalDeadline: at(24 * 18),
};

describe('CR6: Software Procurement cycles', () => {
  let ctx: TestContext;
  let clock: FixedClock;

  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    clock = new FixedClock(NOW);
    setClock(clock);
    await resetFixtures();
  });

  afterEach(() => resetClock());

  const as = (email: string) => signIn(ctx.app, email);
  const create = (client: SignedInClient, opportunityId: string, body: Record<string, unknown> = EOI_CYCLE, key?: string) =>
    send(client, `/api/opportunities/${opportunityId}/procurement`, body, key);
  const advance = (client: SignedInClient, cycle: { id: string; version: number }, body: Record<string, unknown>, key?: string) =>
    send(client, `/api/procurement/${cycle.id}/milestone`, { version: cycle.version, ...body }, key);
  const patch = (client: SignedInClient, id: string, body: Record<string, unknown>) =>
    client.agent.patch(`/api/procurement/${id}`).set('Origin', TEST_ORIGIN).set(CSRF_HEADER, client.csrfToken).send(body);
  const remove = (client: SignedInClient, url: string) =>
    client.agent.delete(url).set('Origin', TEST_ORIGIN).set(CSRF_HEADER, client.csrfToken);

  async function opportunity(id: string) {
    const [row] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, id));
    return row!;
  }

  /** A cycle advanced to `milestone` along the normal route, without touching the pipeline. */
  async function cycleAt(client: SignedInClient, opportunityId: string, milestone: string): Promise<ProcurementCycleDetailDto> {
    let cycle = (await create(client, opportunityId).expect(201)).body as ProcurementCycleDetailDto;
    const steps: [string, Record<string, unknown>][] = [
      ['eoi_submitted', { eoiSubmittedAt: at(-20) }],
      ['shortlisted', { eoiOutcomeDate: '2026-10-12' }],
      ['rfp_received', RFP_FACTS],
      ['proposal_preparation', {}],
      ['proposal_submitted', { proposalSubmittedAt: at(-1) }],
      ['evaluation', {}],
    ];
    for (const [step, facts] of steps) {
      if (cycle.milestone === milestone) break;
      const response = await advance(client, cycle, { milestone: step, ...facts });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      cycle = response.body.cycle;
    }
    expect(cycle.milestone).toBe(milestone);
    return cycle;
  }

  // -------------------------------------------------------------------------
  describe('the normal flow', () => {
    it('runs EOI, shortlisting, RFP, proposal and award, moving the pipeline only when asked', async () => {
      const rafiq = await as(emails.salesGA1);
      const before = await opportunity(ids.oppRafiq);
      const created = await create(rafiq, ids.oppRafiq);
      expect(created.status).toBe(201);
      let cycle = created.body as ProcurementCycleDetailDto;
      expect(cycle).toMatchObject({
        route: 'eoi_rfp',
        milestone: 'eoi_preparation',
        isCurrent: true,
        participation: 'undecided',
        indicator: 'upcoming',
        responsibleOwner: { id: ids.salesGA1 },
        rfpReference: null,
      });
      expect(cycle.nextMilestones).toEqual(expect.arrayContaining(['eoi_submitted', 'cancelled']));

      // The RFP cannot be reached without the EOI submitted and shortlisted.
      const early = await advance(rafiq, cycle, { milestone: 'rfp_received', ...RFP_FACTS });
      expect(early.status).toBe(422);
      expect(Object.keys(early.body.fieldErrors)).toEqual(expect.arrayContaining(['eoiSubmittedAt', 'eoiOutcomeDate']));

      let step = await advance(rafiq, cycle, { milestone: 'eoi_submitted', eoiSubmittedAt: at(-20) });
      expect(step.status, JSON.stringify(step.body)).toBe(200);
      expect(step.body).toMatchObject({ stageChanged: false, cycle: { milestone: 'eoi_submitted', participation: 'participating', indicator: 'submitted' } });
      cycle = step.body.cycle;
      cycle = (await advance(rafiq, cycle, { milestone: 'shortlisted', eoiOutcomeDate: '2026-10-12' }).expect(200)).body.cycle;
      expect(cycle).toMatchObject({ eoiOutcome: 'shortlisted', eoiOutcomeDate: '2026-10-12' });
      expect((await opportunity(ids.oppRafiq)).stage).toBe(before.stage);

      // The offered stage, accepted, obeys the stage rules: a skip needs an explanation.
      const unexplained = await advance(rafiq, cycle, { milestone: 'rfp_received', ...RFP_FACTS, pipeline: { stage: 'tender_published' } });
      expect(unexplained.status).toBe(422);
      expect(unexplained.body.fieldErrors).toHaveProperty(['pipeline.explanation']);
      const [unchanged] = await ctx.database.db.select().from(procurementCycles).where(eq(procurementCycles.id, cycle.id));
      expect(unchanged!.milestone).toBe('shortlisted');

      const offeredElsewhere = await advance(rafiq, cycle, { milestone: 'rfp_received', ...RFP_FACTS, pipeline: { stage: 'evaluation', explanation: 'x' } });
      expect(offeredElsewhere.status).toBe(422);
      expect(offeredElsewhere.body.fieldErrors).toHaveProperty(['pipeline.stage']);

      step = await advance(rafiq, cycle, {
        milestone: 'rfp_received',
        ...RFP_FACTS,
        pipeline: { stage: 'tender_published', explanation: 'The RFP was issued after shortlisting.' },
      });
      expect(step.status, JSON.stringify(step.body)).toBe(200);
      expect(step.body.stageChanged).toBe(true);
      expect((await opportunity(ids.oppRafiq)).stage).toBe('tender_published');
      cycle = step.body.cycle;

      cycle = (await advance(rafiq, cycle, { milestone: 'proposal_preparation' }).expect(200)).body.cycle;
      cycle = (await advance(rafiq, cycle, { milestone: 'proposal_submitted', proposalSubmittedAt: at(-1) }).expect(200)).body.cycle;
      cycle = (await advance(rafiq, cycle, { milestone: 'evaluation' }).expect(200)).body.cycle;
      expect((await opportunity(ids.oppRafiq)).stage).toBe('tender_published');

      // Awarded is offered, never applied unasked, and needs its value and date.
      const noValue = await advance(rafiq, cycle, { milestone: 'awarded', outcomeDate: '2026-10-12', pipeline: { stage: 'awarded' } });
      expect(noValue.status).toBe(422);
      expect(noValue.body.fieldErrors).toHaveProperty(['pipeline.awardedValue']);
      const awarded = await advance(rafiq, cycle, {
        milestone: 'awarded',
        outcomeDate: '2026-10-12',
        pipeline: { stage: 'awarded', awardedValue: '12500000.00', awardDate: '2026-10-12' },
      });
      expect(awarded.status, JSON.stringify(awarded.body)).toBe(200);
      expect(awarded.body.cycle).toMatchObject({ milestone: 'awarded', nextMilestones: [], canEdit: false, indicator: 'closed' });
      expect(await opportunity(ids.oppRafiq)).toMatchObject({ stage: 'awarded', awardedValue: '12500000.00' });

      const history = awarded.body.cycle.history.map((entry: { milestone: string | null }) => entry.milestone).filter(Boolean);
      expect(history).toEqual(['eoi_preparation', 'eoi_submitted', 'shortlisted', 'rfp_received', 'proposal_preparation', 'proposal_submitted', 'evaluation', 'awarded']);
    });

    it('closes as Not shortlisted; Lost (reason Not shortlisted) is only offered', async () => {
      const rafiq = await as(emails.salesGA1);
      let cycle = await cycleAt(rafiq, ids.oppRafiq, 'eoi_submitted');
      const notShortlisted = await advance(rafiq, cycle, { milestone: 'not_shortlisted', eoiOutcomeDate: '2026-10-12' });
      expect(notShortlisted.status, JSON.stringify(notShortlisted.body)).toBe(200);
      cycle = notShortlisted.body.cycle;
      expect(cycle).toMatchObject({ milestone: 'not_shortlisted', eoiOutcome: 'not_shortlisted', outcomeDate: '2026-10-12', nextMilestones: [] });
      expect((await opportunity(ids.oppRafiq)).stage).not.toBe('lost');
      expect((await advance(rafiq, cycle, { milestone: 'rfp_received', ...RFP_FACTS })).status).toBe(409);

      // On another record the user accepts the offer: Lost, with the reason, open tasks cancelled.
      const tasnia = await as(emails.salesGA2);
      const other = await cycleAt(tasnia, ids.oppTasnia, 'eoi_submitted');
      const lost = await advance(tasnia, other, {
        milestone: 'not_shortlisted',
        eoiOutcomeDate: '2026-10-12',
        pipeline: { stage: 'lost', lossReason: 'not_shortlisted', closedDate: '2026-10-12' },
      });
      expect(lost.status, JSON.stringify(lost.body)).toBe(200);
      expect(await opportunity(ids.oppTasnia)).toMatchObject({ stage: 'lost', lossReason: 'not_shortlisted' });
      const open = await ctx.database.db
        .select()
        .from(followUps)
        .where(and(eq(followUps.opportunityId, ids.oppTasnia), eq(followUps.state, 'open')));
      expect(open).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('the direct RFP exception', () => {
    const DIRECT = {
      procuringOrganizationId: ids.orgSylvanHills,
      title: 'Direct RFP for archive software',
      reference: 'SH/RFP/2026/09',
      route: 'direct_rfp',
      ...RFP_FACTS,
    };

    it('is management only, documented, and never carries an EOI', async () => {
      const rafiq = await as(emails.salesGA1);
      expect((await create(rafiq, ids.oppRafiq, { ...DIRECT, directRfpReason: 'Invited directly' })).status).toBe(403);

      const arif = await as(emails.management);
      const undocumented = await create(arif, ids.oppRafiq, DIRECT);
      expect(undocumented.status).toBe(422);
      expect(undocumented.body.fieldErrors).toHaveProperty('directRfpReason');
      const withEoi = await create(arif, ids.oppRafiq, { ...DIRECT, directRfpReason: 'Invited directly', eoiDeadline: at(48) });
      expect(withEoi.status).toBe(422);
      expect(withEoi.body.fieldErrors).toHaveProperty('eoiDeadline');

      const created = await create(arif, ids.oppRafiq, { ...DIRECT, directRfpReason: 'The city invited Penta directly after a framework call.' });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({
        route: 'direct_rfp',
        milestone: 'rfp_received',
        eoiSubmittedAt: null,
        eoiOutcome: null,
        directRfpApprovedByName: 'Arif Rahman',
      });
      expect(created.body.nextMilestones).not.toContain('eoi_submitted');
      const [audit] = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, created.body.id), eq(auditEvents.action, 'procurement.created')));
      expect(audit!.reason).toMatch(/Direct RFP approved by management/);

      // The owner works the cycle from there; no EOI milestone exists on it.
      const cycle = (await rafiq.agent.get(`/api/procurement/${created.body.id}`).expect(200)).body;
      expect((await advance(rafiq, cycle, { milestone: 'eoi_submitted', eoiSubmittedAt: at(-1) })).status).toBe(409);
      expect((await advance(rafiq, cycle, { milestone: 'proposal_preparation' })).status).toBe(200);

      // The database refuses an invented EOI, and an RFP without shortlisting.
      await expect(
        ctx.database.db.update(procurementCycles).set({ eoiSubmittedAt: new Date(at(-30)) }).where(eq(procurementCycles.id, created.body.id)),
      ).rejects.toThrow();
    });

    it('is the only way to an RFP without shortlisting', async () => {
      const rafiq = await as(emails.salesGA1);
      const cycle = (await create(rafiq, ids.oppRafiq).expect(201)).body;
      await expect(
        ctx.database.db
          .update(procurementCycles)
          .set({ milestone: 'rfp_received', rfpReference: 'X', rfpInvitationDate: '2026-10-12', proposalDeadline: new Date(at(100)) })
          .where(eq(procurementCycles.id, cycle.id)),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('cancellation, reissue and multiple cycles', () => {
    it('keeps one current cycle; a new one only after the open one ends', async () => {
      const rafiq = await as(emails.salesGA1);
      const first = (await create(rafiq, ids.oppRafiq).expect(201)).body;
      const blocked = await create(rafiq, ids.oppRafiq, { ...EOI_CYCLE, reference: 'SH/EOI/2026/02' });
      expect(blocked.status).toBe(409);

      const unexplained = await advance(rafiq, first, { milestone: 'cancelled', outcomeDate: '2026-10-12' });
      expect(unexplained.status).toBe(422);
      expect(unexplained.body.fieldErrors).toHaveProperty('outcomeNote');
      const cancelled = await advance(rafiq, first, { milestone: 'cancelled', outcomeDate: '2026-10-12', outcomeNote: 'The city withdrew the EOI.' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.cycle).toMatchObject({ milestone: 'cancelled', indicator: 'closed', canEdit: false });

      const reissued = await create(rafiq, ids.oppRafiq, { ...EOI_CYCLE, reference: 'SH/EOI/2026/02' });
      expect(reissued.status).toBe(201);
      const list = (await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/procurement`).expect(200)).body.items;
      expect(list.map((item: { reference: string; isCurrent: boolean }) => [item.reference, item.isCurrent])).toEqual([
        ['SH/EOI/2026/02', true],
        ['SH/EOI/2026/01', false],
      ]);
      const old = (await rafiq.agent.get(`/api/procurement/${first.id}`).expect(200)).body;
      expect((await patch(rafiq, first.id, { version: old.version, title: 'Edited history' })).status).toBe(409);
      const superseded = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, first.id), eq(auditEvents.action, 'procurement.superseded')));
      expect(superseded).toHaveLength(1);
    });

    it('refuses a stale version, and replays a retried milestone once', async () => {
      const rafiq = await as(emails.salesGA1);
      const cycle = (await create(rafiq, ids.oppRafiq).expect(201)).body;
      const key = nextIdempotencyKey('milestone');
      const first = await advance(rafiq, cycle, { milestone: 'eoi_submitted', eoiSubmittedAt: at(-20) }, key);
      const retry = await advance(rafiq, cycle, { milestone: 'eoi_submitted', eoiSubmittedAt: at(-20) }, key);
      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(retry.body.cycle.milestone).toBe('eoi_submitted');
      const events = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, cycle.id), eq(auditEvents.action, 'procurement.milestone_changed')));
      expect(events).toHaveLength(1);
      expect((await patch(rafiq, cycle.id, { version: cycle.version, notes: 'stale' })).status).toBe(409);
      expect((await advance(rafiq, cycle, { milestone: 'shortlisted', eoiOutcomeDate: '2026-10-12' })).status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('deadlines', () => {
    it('marks 72 hours exactly as upcoming, just under as due soon, and a passed deadline as missed', async () => {
      const rafiq = await as(emails.salesGA1);
      let cycle = (await create(rafiq, ids.oppRafiq, { ...EOI_CYCLE, eoiDeadline: at(72) }).expect(201)).body;
      expect(cycle.indicator).toBe('upcoming');
      const inWindow = async (deadline: string, client: SignedInClient = rafiq) =>
        (await client.agent.get(`/api/procurement?deadline=${deadline}`).expect(200)).body.items.map((item: { id: string }) => item.id);
      expect(await inWindow('72h')).not.toContain(cycle.id);
      expect(await inWindow('7d')).toContain(cycle.id);

      cycle = (await patch(rafiq, cycle.id, { version: cycle.version, eoiDeadline: at(72 - 1 / 60) }).expect(200)).body;
      expect(cycle.indicator).toBe('due_soon');
      expect(await inWindow('72h')).toContain(cycle.id);

      clock.advanceMinutes(72 * 60);
      // The earlier session has idled out over three days; sign in again.
      const later = await as(emails.salesGA1);
      cycle = (await later.agent.get(`/api/procurement/${cycle.id}`).expect(200)).body;
      expect(cycle.indicator).toBe('missed');
      expect(await inWindow('overdue', later)).toContain(cycle.id);
    });

    it('records a late submission as late, and never moves a deadline under a recorded submission', async () => {
      const rafiq = await as(emails.salesGA1);
      const cycle = (await create(rafiq, ids.oppRafiq, { ...EOI_CYCLE, eoiDeadline: at(-2) }).expect(201)).body;

      const future = await advance(rafiq, cycle, { milestone: 'eoi_submitted', eoiSubmittedAt: at(2) });
      expect(future.status).toBe(422);
      expect(future.body.fieldErrors).toHaveProperty('eoiSubmittedAt');
      const unexplained = await advance(rafiq, cycle, { milestone: 'eoi_submitted', eoiSubmittedAt: at(-1) });
      expect(unexplained.status).toBe(422);
      expect(unexplained.body.fieldErrors).toHaveProperty('eoiLateNote');
      const late = await advance(rafiq, cycle, { milestone: 'eoi_submitted', eoiSubmittedAt: at(-1), eoiLateNote: 'Portal outage; accepted by email.' });
      expect(late.status).toBe(200);
      expect(late.body.cycle).toMatchObject({ eoiLateNote: 'Portal outage; accepted by email.', eoiDeadline: at(-2) });

      const moved = await patch(rafiq, cycle.id, { version: late.body.cycle.version, eoiDeadline: at(10) });
      expect(moved.status).toBe(422);
      expect(moved.body.fieldErrors).toHaveProperty('eoiDeadline');

      // Deadlines compare as Asia/Dhaka dates: 00:30 on 1 October in Dhaka is
      // still 30 September in UTC, and is on the publication date, not before it.
      const tasnia = await as(emails.salesGA2);
      const beforePublication = await create(tasnia, ids.oppTasnia, { ...EOI_CYCLE, eoiDeadline: '2026-09-30T23:30:00+06:00' });
      expect(beforePublication.status).toBe(422);
      expect(beforePublication.body.fieldErrors).toHaveProperty('eoiDeadline');
      await create(tasnia, ids.oppTasnia, { ...EOI_CYCLE, eoiDeadline: '2026-10-01T00:30:00+06:00' }).expect(201);
    });

    it('tracks technical and financial proposals separately when the RFP asks for both', async () => {
      const rafiq = await as(emails.salesGA1);
      let cycle = await cycleAt(rafiq, ids.oppRafiq, 'proposal_preparation');
      cycle = (await patch(rafiq, cycle.id, { version: cycle.version, proposalFormat: 'separate' }).expect(200)).body;
      const half = await advance(rafiq, cycle, { milestone: 'proposal_submitted', technicalSubmittedAt: at(-3) });
      expect(half.status).toBe(422);
      expect(half.body.fieldErrors).toHaveProperty('financialSubmittedAt');
      const both = await advance(rafiq, cycle, { milestone: 'proposal_submitted', technicalSubmittedAt: at(-3), financialSubmittedAt: at(-2) });
      expect(both.status, JSON.stringify(both.body)).toBe(200);
      expect(both.body.cycle).toMatchObject({ proposalSubmittedAt: null, technicalSubmittedAt: at(-3), financialSubmittedAt: at(-2) });
    });
  });

  // -------------------------------------------------------------------------
  describe('access follows the opportunity', () => {
    it('moves with a transfer and stays inside each role’s scope', async () => {
      const rafiq = await as(emails.salesGA1);
      const cycle = (await create(rafiq, ids.oppRafiq).expect(201)).body;
      const missing = await rafiq.agent.get(`/api/procurement/${ABSENT_UUID}`);

      const nadia = await as(emails.leadGA);
      await nadia.agent.get(`/api/procurement/${cycle.id}`).expect(200);
      const farhan = await as(emails.leadIS);
      const outside = await farhan.agent.get(`/api/procurement/${cycle.id}`);
      expect(outside.status).toBe(404);
      expect({ ...outside.body, requestId: null }).toEqual({ ...missing.body, requestId: null });
      const admin = await as(emails.admin);
      expect((await admin.agent.get('/api/procurement')).status).toBe(403);
      expect((await admin.agent.get(`/api/procurement/${cycle.id}`)).status).toBe(404);

      const version = (await opportunity(ids.oppRafiq)).version;
      await send(nadia, `/api/opportunities/${ids.oppRafiq}/transfer`, { version, newOwnerId: ids.salesGA2, reason: 'Workload balance' }).expect(200);
      expect((await rafiq.agent.get(`/api/procurement/${cycle.id}`)).status).toBe(404);
      expect((await advance(rafiq, cycle, { milestone: 'eoi_submitted', eoiSubmittedAt: at(-20) })).status).toBe(404);
      const tasnia = await as(emails.salesGA2);
      const seen = (await tasnia.agent.get(`/api/procurement/${cycle.id}`).expect(200)).body;
      expect(seen.responsibleOwner.id).toBe(ids.salesGA2);
      expect((await advance(tasnia, seen, { milestone: 'eoi_submitted', eoiSubmittedAt: at(-20) })).status).toBe(200);

      const rafiqList = (await rafiq.agent.get('/api/procurement').expect(200)).body.items;
      expect(rafiqList.map((item: { id: string }) => item.id)).not.toContain(cycle.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('contacts and documents', () => {
    function upload(client: SignedInClient, opportunityId: string, fileName: string) {
      return client.agent
        .post(`/api/opportunities/${opportunityId}/document-uploads`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, client.csrfToken)
        .set(FILE_NAME_HEADER, encodeURIComponent(fileName))
        .set('Content-Type', 'application/octet-stream')
        .send(PDF);
    }

    async function addDocument(client: SignedInClient, opportunityId: string, fileName: string): Promise<string> {
      const staged = await upload(client, opportunityId, fileName).expect(201);
      const done = await send(client, `/api/document-uploads/${staged.body.uploadId}/finalize`, { category: 'tender_document' }).expect(201);
      return done.body.id as string;
    }

    it('links only the opportunity’s own contacts and documents; forged ids are the standard 404', async () => {
      const rafiq = await as(emails.salesGA1);
      const cycle = (await create(rafiq, ids.oppRafiq).expect(201)).body;
      const missing = await rafiq.agent.get(`/api/procurement/${ABSENT_UUID}`);
      const same = (response: { status: number; body: Record<string, unknown> }) => {
        expect(response.status).toBe(404);
        expect({ ...response.body, requestId: null }).toEqual({ ...missing.body, requestId: null });
      };

      // Contacts: Golam is linked to this opportunity; Rezaul is not.
      same(await send(rafiq, `/api/procurement/${cycle.id}/contacts`, { contactId: ids.contactRezaul }));
      const linked = await send(rafiq, `/api/procurement/${cycle.id}/contacts`, { contactId: ids.contactGolam });
      expect(linked.status).toBe(200);
      expect(linked.body.contacts.map((contact: { id: string }) => contact.id)).toEqual([ids.contactGolam]);
      await send(rafiq, `/api/procurement/${cycle.id}/contacts`, { contactId: ids.contactGolam }).expect(200);
      expect(await ctx.database.db.select().from(procurementCycleContacts)).toHaveLength(1);
      await remove(rafiq, `/api/procurement/${cycle.id}/contacts/${ids.contactGolam}`).expect(200);
      same(await remove(rafiq, `/api/procurement/${cycle.id}/contacts/${ids.contactGolam}`));

      // Documents: the cycle's opportunity's own only.
      const tasnia = await as(emails.salesGA2);
      const foreignDocument = await addDocument(tasnia, ids.oppTasnia, 'tasnia-rfp.pdf');
      same(await send(rafiq, `/api/procurement/${cycle.id}/documents`, { documentId: foreignDocument, role: 'rfp' }));
      const ownDocument = await addDocument(rafiq, ids.oppRafiq, 'eoi-response.pdf');
      const withDocument = await send(rafiq, `/api/procurement/${cycle.id}/documents`, { documentId: ownDocument, role: 'eoi' });
      expect(withDocument.status, JSON.stringify(withDocument.body)).toBe(200);
      expect(withDocument.body.documents).toEqual([
        { id: ownDocument, role: 'eoi', fileName: 'eoi-response.pdf', category: 'tender_document', archived: false },
      ]);

      // A cycle of someone else's opportunity is the same 404 on every route.
      const tasniaCycle = (await create(tasnia, ids.oppTasnia).expect(201)).body;
      same(await rafiq.agent.get(`/api/procurement/${tasniaCycle.id}`));
      same(await patch(rafiq, tasniaCycle.id, { version: tasniaCycle.version, notes: 'x' }));
      same(await advance(rafiq, tasniaCycle, { milestone: 'cancelled', outcomeDate: '2026-10-12', outcomeNote: 'x' }));
      same(await send(rafiq, `/api/procurement/${tasniaCycle.id}/documents`, { documentId: ownDocument, role: 'rfp' }));

      // After a transfer the previous owner loses the cycle and its documents together.
      const nadia = await as(emails.leadGA);
      const version = (await opportunity(ids.oppRafiq)).version;
      await send(nadia, `/api/opportunities/${ids.oppRafiq}/transfer`, { version, newOwnerId: ids.salesGA2, reason: 'Handover' }).expect(200);
      same(await rafiq.agent.get(`/api/procurement/${cycle.id}`));
      expect((await rafiq.agent.get(`/api/documents/${ownDocument}`)).status).toBe(404);
      expect((await tasnia.agent.get(`/api/procurement/${cycle.id}`).expect(200)).body.documents).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('dashboard, report and export', () => {
    async function runJobs() {
      return runDueJobs(ctx.database.db, createJobHandlers(ctx.database.db, { exportTtlHours: 24, exportMaxRows: 50_000 }));
    }

    it('counts open procurement deadlines apart from tenders, inside each scope', async () => {
      const rafiq = await as(emails.salesGA1);
      const tasnia = await as(emails.salesGA2);
      const mine = (await create(rafiq, ids.oppRafiq, { ...EOI_CYCLE, eoiDeadline: at(48) }).expect(201)).body;
      await create(tasnia, ids.oppTasnia, { ...EOI_CYCLE, reference: 'SH/EOI/2026/77', eoiDeadline: at(-5) }).expect(201);

      const dashboard = (await rafiq.agent.get('/api/dashboard').expect(200)).body;
      expect(dashboard.procurement).toMatchObject({ working: 1, overdue: 0, dueNext7Days: 1 });
      expect(dashboard.procurement.upcoming.map((item: { id: string }) => item.id)).toEqual([mine.id]);
      const nadia = await as(emails.leadGA);
      expect((await nadia.agent.get('/api/dashboard').expect(200)).body.procurement).toMatchObject({ working: 2, overdue: 1, dueNext7Days: 1 });
      const farhan = await as(emails.leadIS);
      expect((await farhan.agent.get('/api/dashboard').expect(200)).body.procurement.working).toBe(0);

      const report = (await rafiq.agent.get('/api/reports/procurement_deadlines').expect(200)).body;
      expect(report.items.map((row: { cells: { reference: string } }) => row.cells.reference)).toEqual(['SH/EOI/2026/01']);
      expect(report.items[0].cells).toMatchObject({ route: 'EOI then RFP', milestone: 'EOI preparation', indicator: 'Due within 72 hours' });
      const leadReport = (await nadia.agent.get('/api/reports/procurement_deadlines').expect(200)).body;
      expect(leadReport.summary).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Open deadlines', value: '2' }),
          expect.objectContaining({ label: 'Overdue', value: '1' }),
        ]),
      );

      const requested = (await send(nadia, '/api/exports', { kind: 'procurement_deadlines', filters: {} }, nextIdempotencyKey('export')).expect(202))
        .body as ReportExportDto;
      await runJobs();
      const csv = await nadia.agent.get(`/api/exports/${requested.id}/download`).expect(200);
      expect(csv.text).toContain('SH/EOI/2026/01');
      expect(csv.text).toContain('SH/EOI/2026/77');
      // Goods tenders are a different report: no procurement cycle appears there.
      const tenderReport = (await nadia.agent.get('/api/reports/upcoming_tenders').expect(200)).body;
      expect(JSON.stringify(tenderReport)).not.toContain('SH/EOI/2026');
    });
  });
});
