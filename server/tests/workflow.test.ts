/**
 * CR6: the Software Procurement workflow (EOI → RFP), alongside the standard
 * tender workflow.
 *
 * Decisions confirmed by Penta: the draft stage list (D-CR6-2); "not
 * shortlisted" ends as Lost with its own reason (D-CR6-3); a workflow field,
 * no new navigation (D-CR6-4); fixed at creation (D-CR6-5); recording the EOI
 * outcome closes the EOI notice (D-CR6-6). Access rules are unchanged.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { boardLanesFor, SOFTWARE_ONLY_STAGES } from '../../shared/enums.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, followUps, opportunities, tenders } from '../db/schema.js';
import {
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

const NOW = '2026-10-12T10:00:00+06:00';

function notice(overrides: Record<string, unknown> = {}) {
  return {
    procuringOrganizationId: ids.orgSylvanHills,
    title: 'National e-Procurement Software Platform',
    reference: 'SH/EOI/2026/11',
    publicationDate: '2026-10-01',
    submissionDeadline: '2026-10-20T12:00:00+06:00',
    bidStatus: 'preparing',
    ...overrides,
  };
}

describe('CR6: Software Procurement workflow', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetFixtures();
    setClock(new FixedClock(NOW));
  });
  afterEach(() => resetClock());

  async function createSoftware(client: SignedInClient, overrides: Record<string, unknown> = {}) {
    const response = await send(
      client,
      '/api/opportunities',
      createOpportunityPayload({ name: 'e-Procurement platform', workflow: 'software_procurement', stage: 'eoi_published', ...overrides }),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.opportunity as { id: string; version: number; workflow: string; stage: string };
  }

  async function versionOf(id: string) {
    const [row] = await ctx.database.db.select({ version: opportunities.version, stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, id));
    return row!;
  }

  async function tenderVersion(id: string) {
    const [row] = await ctx.database.db.select({ version: tenders.version }).from(tenders).where(eq(tenders.id, id));
    return row!.version;
  }

  /** An EOI notice for `opportunityId`, submitted. */
  async function submittedEoi(client: SignedInClient, opportunityId: string) {
    const created = await send(client, `/api/opportunities/${opportunityId}/tenders`, notice({ phase: 'eoi' }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const submitted = await send(client, `/api/tenders/${created.body.id}/submit`, {
      version: created.body.version,
      submittedAt: '2026-10-10T10:00:00+06:00',
      moveOpportunityToBidSubmitted: true,
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    return submitted.body.tender as { id: string; version: number; offeredStage: string };
  }

  // -------------------------------------------------------------------------
  describe('creation and stages', () => {
    it('creates a Software Procurement record at one of its own stages, and refuses the other workflow’s', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const created = await createSoftware(rafiq);
      expect(created).toMatchObject({ workflow: 'software_procurement', stage: 'eoi_published' });

      const wrongStage = await send(rafiq, '/api/opportunities', createOpportunityPayload({ workflow: 'software_procurement', stage: 'tender_published' }));
      expect(wrongStage.status).toBe(422);
      expect(wrongStage.body.fieldErrors.stage).toMatch(/stage of the selected workflow/);
      const standardWithSoftwareStage = await send(rafiq, '/api/opportunities', createOpportunityPayload({ stage: 'eoi_published' }));
      expect(standardWithSoftwareStage.status).toBe(422);

      // Existing records, and new ones without a workflow, are standard.
      const [existing] = await ctx.database.db.select({ workflow: opportunities.workflow }).from(opportunities).where(eq(opportunities.id, ids.oppRafiq));
      expect(existing!.workflow).toBe('standard');
    });

    it('moves only among its own stages, in its own order', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const created = await createSoftware(rafiq);

      const forward = await send(rafiq, `/api/opportunities/${created.id}/stage`, { version: created.version, stage: 'eoi_submitted' });
      expect(forward.status, JSON.stringify(forward.body)).toBe(200);

      const otherWorkflow = await send(rafiq, `/api/opportunities/${created.id}/stage`, {
        version: (await versionOf(created.id)).version,
        stage: 'bid_submitted',
        explanation: 'Trying the other pipeline.',
      });
      expect(otherWorkflow.status).toBe(422);
      expect(otherWorkflow.body.fieldErrors.stage).toMatch(/not a stage of the Software Procurement/);

      // Skipping Shortlisted to RFP Issued is a skip in this workflow's order.
      const skip = await send(rafiq, `/api/opportunities/${created.id}/stage`, { version: (await versionOf(created.id)).version, stage: 'rfp_issued' });
      expect(skip.status).toBe(422);
      expect(skip.body.fieldErrors.explanation).toMatch(/skipped/);
    });

    it('allows "Not shortlisted" only on Software Procurement records, in the service and the database', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const standard = await versionOf(ids.oppRafiq);
      const refused = await send(rafiq, `/api/opportunities/${ids.oppRafiq}/stage`, {
        version: standard.version,
        stage: 'lost',
        lossReason: 'not_shortlisted',
        closedDate: '2026-10-11',
      });
      expect(refused.status).toBe(422);
      expect(refused.body.fieldErrors.lossReason).toMatch(/Software Procurement/);

      // The database refuses a stage from the other workflow, and the reason
      // on a standard record, even when the service is bypassed.
      const created = await createSoftware(rafiq);
      const stageError = await ctx.database.db
        .update(opportunities)
        .set({ stage: 'bid_submitted' })
        .where(eq(opportunities.id, created.id))
        .then(() => null, (error: { cause?: { constraint?: string } }) => error.cause?.constraint);
      expect(stageError).toBe('opportunities_stage_in_workflow');
      const reasonError = await ctx.database.db
        .update(opportunities)
        .set({ stage: 'lost', lossReason: 'not_shortlisted', closedDate: '2026-10-11' })
        .where(eq(opportunities.id, ids.oppRafiq))
        .then(() => null, (error: { cause?: { constraint?: string } }) => error.cause?.constraint);
      expect(reasonError).toBe('opportunities_not_shortlisted_software_only');
    });
  });

  // -------------------------------------------------------------------------
  describe('EOI → RFP', () => {
    it('runs EOI, shortlisting and RFP, offering each phase’s submitted stage', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const created = await createSoftware(rafiq);

      // A Software Procurement notice needs its phase; a standard one has none.
      const noPhase = await send(rafiq, `/api/opportunities/${created.id}/tenders`, notice());
      expect(noPhase.status).toBe(422);
      expect(noPhase.body.fieldErrors.phase).toBeTruthy();
      const standardPhase = await send(rafiq, `/api/opportunities/${ids.oppRafiq}/tenders`, notice({ phase: 'eoi', reference: 'X-1' }));
      expect(standardPhase.status).toBe(422);

      // EOI: Mark Submitted offers EOI Submitted.
      const eoi = await submittedEoi(rafiq, created.id);
      expect(eoi.offeredStage).toBe('eoi_submitted');
      expect((await versionOf(created.id)).stage).toBe('eoi_submitted');

      // An RFP before the shortlisting outcome is refused.
      const early = await send(rafiq, `/api/opportunities/${created.id}/tenders`, notice({ phase: 'rfp', reference: 'SH/RFP/2026/11' }));
      expect(early.status).toBe(409);
      expect(early.body.message).toMatch(/Shortlisted before recording the RFP/);

      // Shortlisted: the EOI notice closes, the record moves on.
      const outcome = await send(rafiq, `/api/tenders/${eoi.id}/eoi-outcome`, {
        version: await tenderVersion(eoi.id),
        outcome: 'shortlisted',
        outcomeDate: '2026-10-11',
        updateOpportunity: true,
      });
      expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
      expect(outcome.body).toMatchObject({
        stageChanged: true,
        tender: { eoiOutcome: 'shortlisted', noticeState: 'closed', isCurrent: false, canRecordEoiOutcome: false },
      });
      expect((await versionOf(created.id)).stage).toBe('shortlisted');

      // A closed EOI never becomes current again.
      const designate = await send(rafiq, `/api/tenders/${eoi.id}/designate-current`, { version: await tenderVersion(eoi.id) }, null);
      expect(designate.status).toBe(409);

      // The RFP: Mark Submitted offers Proposal Submitted.
      const rfp = await send(rafiq, `/api/opportunities/${created.id}/tenders`, notice({ phase: 'rfp', reference: 'SH/RFP/2026/11' }));
      expect(rfp.status, JSON.stringify(rfp.body)).toBe(201);
      expect(rfp.body).toMatchObject({ phase: 'rfp', isCurrent: true, offeredStage: 'proposal_submitted' });
      const movedRfp = await send(rafiq, `/api/opportunities/${created.id}/stage`, {
        version: (await versionOf(created.id)).version,
        stage: 'rfp_issued',
      });
      expect(movedRfp.status).toBe(200);
      const submitted = await send(rafiq, `/api/tenders/${rfp.body.id}/submit`, {
        version: rfp.body.version,
        submittedAt: '2026-10-12T09:00:00+06:00',
        moveOpportunityToBidSubmitted: true,
      });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
      expect((await versionOf(created.id)).stage).toBe('proposal_submitted');

      // An EOI cannot follow the RFP.
      const lateEoi = await send(rafiq, `/api/opportunities/${created.id}/tenders`, notice({ phase: 'eoi', reference: 'SH/EOI/2026/12' }));
      expect(lateEoi.status).toBe(409);

      const audit = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.action, 'tender.eoi_outcome_recorded'));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.opportunityId).toBe(created.id);
    });

    it('closes the record as Lost, Not shortlisted, when asked', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const created = await createSoftware(rafiq);
      const eoi = await submittedEoi(rafiq, created.id);

      const early = await send(rafiq, `/api/tenders/${eoi.id}/eoi-outcome`, {
        version: await tenderVersion(eoi.id),
        outcome: 'not_shortlisted',
        outcomeDate: '2026-10-13',
        updateOpportunity: true,
      });
      expect(early.status).toBe(422);
      expect(early.body.fieldErrors.outcomeDate).toMatch(/future/);

      const key = nextIdempotencyKey('eoi');
      const body = { version: await tenderVersion(eoi.id), outcome: 'not_shortlisted', outcomeDate: '2026-10-11', updateOpportunity: true };
      const response = await send(rafiq, `/api/tenders/${eoi.id}/eoi-outcome`, body, key);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      // A retry is recognised, never applied twice (BR-091).
      const retry = await send(rafiq, `/api/tenders/${eoi.id}/eoi-outcome`, body, key);
      expect(retry.status).toBe(200);
      expect(retry.body.stageChanged).toBe(true);

      const [record] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, created.id));
      expect(record).toMatchObject({ stage: 'lost', lossReason: 'not_shortlisted', closedDate: '2026-10-11' });
      const open = await ctx.database.db
        .select()
        .from(followUps)
        .where(and(eq(followUps.opportunityId, created.id), eq(followUps.state, 'open')));
      expect(open).toHaveLength(0);
      const stageEvents = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.opportunityId, created.id), eq(auditEvents.action, 'opportunity.stage_changed')));
      expect(stageEvents.filter((row) => (row.afterData as { stage?: string }).stage === 'lost')).toHaveLength(1);
    });

    it('records an outcome without touching the stage when not asked, and only after the EOI is submitted', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const created = await createSoftware(rafiq);
      const notYet = await send(rafiq, `/api/opportunities/${created.id}/tenders`, notice({ phase: 'eoi' }));
      const refused = await send(rafiq, `/api/tenders/${notYet.body.id}/eoi-outcome`, {
        version: notYet.body.version,
        outcome: 'shortlisted',
        outcomeDate: '2026-10-11',
        updateOpportunity: false,
      });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/submission first/);

      const eoi = await submittedEoi(rafiq, created.id);
      const kept = await send(rafiq, `/api/tenders/${eoi.id}/eoi-outcome`, {
        version: await tenderVersion(eoi.id),
        outcome: 'shortlisted',
        outcomeDate: '2026-10-11',
        updateOpportunity: false,
      });
      expect(kept.status).toBe(200);
      expect(kept.body.stageChanged).toBe(false);
      expect((await versionOf(created.id)).stage).toBe('eoi_submitted');
    });
  });

  // -------------------------------------------------------------------------
  describe('board, dashboard and reports', () => {
    it('shows each workflow on its own board, with its own lanes', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const created = await createSoftware(rafiq);

      const software = await rafiq.agent.get('/api/opportunities/board').query({ workflow: 'software_procurement' }).expect(200);
      expect(software.body.workflow).toBe('software_procurement');
      expect(software.body.lanes.map((lane: { lane: string }) => lane.lane)).toEqual(boardLanesFor('software_procurement'));
      const eoiLane = software.body.lanes.find((lane: { lane: string }) => lane.lane === 'eoi_published');
      expect(eoiLane.items.map((item: { id: string }) => item.id)).toEqual([created.id]);

      const standard = await rafiq.agent.get('/api/opportunities/board').expect(200);
      expect(standard.body.lanes.map((lane: { lane: string }) => lane.lane)).toEqual(boardLanesFor('standard'));
      expect(JSON.stringify(standard.body)).not.toContain(created.id);

      const list = await rafiq.agent.get('/api/opportunities').query({ workflow: 'software_procurement' }).expect(200);
      expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([created.id]);
    });

    it('counts both workflows in the metrics, and shows Software Procurement stages once present', async () => {
      const arif = await signIn(ctx.app, emails.management);
      const before = (await arif.agent.get('/api/dashboard').expect(200)).body;
      expect(before.stages.map((stage: { stage: string }) => stage.stage)).not.toContain('eoi_published');
      const reportBefore = (await arif.agent.get('/api/reports/pipeline').expect(200)).body;
      expect(JSON.stringify(reportBefore)).not.toContain('EOI Published');

      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await createSoftware(rafiq, { estimatedValue: '2500000.00' });

      const after = (await arif.agent.get('/api/dashboard').expect(200)).body;
      expect(after.kpis.activeOpportunities).toBe(before.kpis.activeOpportunities + 1);
      const chartStages = after.stages.map((stage: { stage: string }) => stage.stage);
      for (const stage of SOFTWARE_ONLY_STAGES) expect(chartStages).toContain(stage);
      expect(after.stages.find((stage: { stage: string }) => stage.stage === 'eoi_published')).toMatchObject({ count: 1, value: '2500000.00' });

      const reportAfter = (await arif.agent.get('/api/reports/pipeline').expect(200)).body;
      expect(JSON.stringify(reportAfter)).toContain('EOI Published');
    });
  });
});
