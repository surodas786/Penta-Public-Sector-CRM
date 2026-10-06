/**
 * Milestone 7: the audit and mutation-control sweep (FR-062, SEC-012, BR-090,
 * BR-091, SEC-005, AT-15).
 *
 * Every implemented mutation is driven through the real app and checked for:
 *
 *   - its append-only audit events: actor, the request's own id, domain,
 *     opportunity link, before/after values and the reason where one is
 *     required;
 *   - retry deduplication: a repeated key replays without a second record or
 *     audit event; a reused key with another payload is refused; a replay
 *     re-checks current access;
 *   - optimistic concurrency: a stale version is a 409 that leaves the
 *     committed state exactly as it was;
 *   - atomicity: a failure late in the transaction leaves no partial record
 *     and releases the idempotency key.
 *
 * Races use genuinely concurrent database connections. A separate connection
 * holds the opportunity row lock while two requests queue behind it; the test
 * waits until PostgreSQL reports both as waiting, so the interleaving is
 * certain rather than hoped for.
 */
import { asc, eq } from 'drizzle-orm';
import pg from 'pg';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FILE_NAME_HEADER } from '../../shared/api.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents } from '../db/schema.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/queue.js';
import { runNotificationScan } from '../services/notifications.js';
import { PDF, TEXT } from './helpers/files.js';
import {
  ABSENT_UUID,
  CSRF_HEADER,
  TEST_ORIGIN,
  createOpportunityPayload,
  createTestApp,
  emails,
  ids,
  nextIdempotencyKey,
  resetFixtures,
  runAsMigrator,
  send,
  signIn,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

const NOW = '2026-10-05T10:00:00+06:00';
const TODAY = '2026-10-05';
const EARLIER = '2026-10-05T09:00:00+06:00';

type Method = 'post' | 'patch';

/** A browser-shaped PATCH (no idempotency key: PATCH is versioned instead). */
function patch(client: SignedInClient, path: string, body: unknown) {
  return client.agent
    .patch(path)
    .set('Origin', TEST_ORIGIN)
    .set(CSRF_HEADER, client.csrfToken)
    .send(body as object);
}

function mutate(client: SignedInClient, method: Method, path: string, body: unknown, key?: string | null) {
  return method === 'patch' ? patch(client, path, body) : send(client, path, body, key === undefined ? nextIdempotencyKey('m7') : key);
}

function stage(client: SignedInClient, opportunityId: string, fileName: string, content: Buffer) {
  return client.agent
    .post(`/api/opportunities/${opportunityId}/document-uploads`)
    .set('Origin', TEST_ORIGIN)
    .set(CSRF_HEADER, client.csrfToken)
    .set(FILE_NAME_HEADER, encodeURIComponent(fileName))
    .set('Content-Type', 'application/octet-stream')
    .send(content);
}

const requestIdOf = (response: Response) => response.headers['x-request-id'] as string;

/** The response body without its unique request id, for 404 equality (SEC-003). */
const withoutRequestId = (response: Response) => ({ ...response.body, requestId: null });

describe('Milestone 7: audit and mutation controls', () => {
  let ctx: TestContext;
  let clock: FixedClock;
  /** The schema owner: reads every table for fingerprints, installs failure triggers. */
  let owner: pg.Pool;
  let missing404: Record<string, unknown>;

  beforeAll(async () => {
    ctx = createTestApp();
    clock = new FixedClock(NOW);
    setClock(clock);
    owner = new pg.Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await dropFailureTrigger();
    await owner.end();
    resetClock();
    await ctx.close();
  });

  beforeEach(async () => {
    clock.set(NOW);
    await resetFixtures();
  });

  // -------------------------------------------------------------------------
  // Database helpers
  // -------------------------------------------------------------------------

  async function one<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T> {
    const result = await owner.query(text, values);
    return result.rows[0] as T;
  }

  async function versionOf(table: string, id: string): Promise<number> {
    return (await one<{ version: number }>(`SELECT version FROM ${table} WHERE id = $1`, [id])).version;
  }

  async function openTask(opportunityId: string) {
    return one<{ id: string; version: number }>(
      `SELECT id, version FROM follow_ups WHERE opportunity_id = $1 AND state = 'open' ORDER BY created_at, id LIMIT 1`,
      [opportunityId],
    );
  }

  async function liveLink(opportunityId: string, contactId: string) {
    return one<{ id: string; version: number }>(
      `SELECT id, version FROM opportunity_contacts WHERE opportunity_id = $1 AND contact_id = $2 AND removed_at IS NULL`,
      [opportunityId, contactId],
    );
  }

  async function auditFor(response: Response) {
    return ctx.database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, requestIdOf(response)))
      .orderBy(asc(auditEvents.sequence));
  }

  async function auditCount(): Promise<number> {
    return (await one<{ n: number }>('SELECT count(*)::int AS n FROM audit_events')).n;
  }

  /**
   * A digest of every table's full contents except sessions (a request
   * touches its own session). Equal digests mean nothing was written.
   */
  async function fingerprint(): Promise<Record<string, string>> {
    const tables = await owner.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'session' ORDER BY tablename`,
    );
    const digest: Record<string, string> = {};
    for (const { tablename } of tables.rows) {
      const row = await one<{ h: string }>(
        `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${tablename}" t`,
      );
      digest[tablename] = row.h;
    }
    return digest;
  }

  async function installFailureTrigger(action: string): Promise<void> {
    await runAsMigrator(`
      CREATE OR REPLACE FUNCTION m7_fail_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'induced failure for the M7 atomicity test'; END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS m7_fail_audit ON audit_events;
      CREATE TRIGGER m7_fail_audit BEFORE INSERT ON audit_events
        FOR EACH ROW WHEN (NEW.action = '${action.replace(/'/g, "''")}') EXECUTE FUNCTION m7_fail_audit();
    `);
  }

  async function dropFailureTrigger(): Promise<void> {
    await runAsMigrator(`
      DROP TRIGGER IF EXISTS m7_fail_audit ON audit_events;
      DROP FUNCTION IF EXISTS m7_fail_audit();
    `);
  }

  /**
   * Holds the opportunity row lock on its own connection, as the runtime role,
   * until `release`. Requests that need the row queue behind it.
   */
  async function holdOpportunity(opportunityId: string) {
    const client = await ctx.database.pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT id FROM opportunities WHERE id = $1 FOR UPDATE', [opportunityId]);
    return {
      release: async () => {
        await client.query('ROLLBACK');
        client.release();
      },
    };
  }

  /** Waits until `count` backends are blocked on a lock. */
  async function waitForLockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { n } = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE NOT l.granted AND a.datname = current_database()`,
      );
      if (n >= count) return;
      if (Date.now() > deadline) throw new Error(`Expected ${count} lock waiters, saw ${n}.`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Starts a supertest request now (they are lazy until awaited). */
  const start = (request: PromiseLike<Response>) => Promise.resolve(request);

  async function missingNotFound(client: SignedInClient): Promise<Record<string, unknown>> {
    missing404 ??= withoutRequestId(await client.agent.get(`/api/opportunities/${ABSENT_UUID}`).expect(404));
    return missing404;
  }

  // -------------------------------------------------------------------------
  // Fixtures used by several cases
  // -------------------------------------------------------------------------

  async function uploadDocument(client: SignedInClient, opportunityId: string, key = nextIdempotencyKey('doc')) {
    const staged = await stage(client, opportunityId, 'proposal.pdf', PDF);
    expect(staged.status).toBe(201);
    const done = await send(client, `/api/document-uploads/${staged.body.uploadId}/finalize`, { category: 'proposal' }, key);
    expect(done.status).toBe(201);
    return done.body as { id: string; version: number; latest: { id: string; scanState: string } };
  }

  async function createSalesperson(admin: SignedInClient, fullName: string) {
    const created = await send(admin, '/api/admin/users', {
      fullName,
      email: `${fullName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      role: 'sales',
      sectionId: ids.sectionIS,
    });
    expect(created.status).toBe(201);
    return created.body.user as { id: string; version: number };
  }

  async function createSection(admin: SignedInClient, name: string) {
    const created = await send(admin, '/api/admin/sections', { name });
    expect(created.status).toBe(201);
    return created.body as { id: string; version: number };
  }

  // =========================================================================
  // 1. FR-062: every mutation writes complete, correctly attributed audit
  // =========================================================================

  interface ExpectedEvent {
    action: string;
    domain?: 'commercial' | 'administrative' | 'directory' | 'reporting';
    /** A required reason: true for "any non-empty", or the exact text. */
    reason?: true | string;
    /** Keys that must differ between before and after (an edit), or appear in after (a creation). */
    changes?: string[];
  }

  interface AuditCase {
    name: string;
    actor: keyof typeof emails;
    /** The opportunity commercial events must point at; null for none. */
    opportunityId: string | null | ((response: Response) => string);
    run: (client: SignedInClient, clients: (who: keyof typeof emails) => Promise<SignedInClient>) => Promise<Response>;
    status: number;
    events: ExpectedEvent[];
    /** Events written by the system after the request, e.g. a scan verdict. */
    systemEvents?: string[];
  }

  const actorIds: Record<keyof typeof emails, string> = {
    management: ids.management,
    leadGA: ids.leadGA,
    leadIS: ids.leadIS,
    salesGA1: ids.salesGA1,
    salesGA2: ids.salesGA2,
    salesIS1: ids.salesIS1,
    admin: ids.admin,
  };

  const auditCases: AuditCase[] = [
    {
      name: 'opportunity creation with its first follow-up',
      actor: 'salesGA1',
      opportunityId: (response) => response.body.opportunity.id as string,
      run: (c) => send(c, '/api/opportunities', createOpportunityPayload()),
      status: 201,
      events: [{ action: 'opportunity.created', changes: ['name', 'ownerId', 'sectionId', 'estimatedValue'] }],
    },
    {
      name: 'basic opportunity edit',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) =>
        patch(c, `/api/opportunities/${ids.oppRafiq}`, {
          version: await versionOf('opportunities', ids.oppRafiq),
          name: 'Municipal Service Portal (phase 2)',
          estimatedValue: '43000000.00',
        }),
      status: 200,
      events: [{ action: 'opportunity.updated', changes: ['name', 'estimatedValue'] }],
    },
    {
      name: 'forward stage change',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) =>
        send(c, `/api/opportunities/${ids.oppRafiq}/stage`, {
          version: await versionOf('opportunities', ids.oppRafiq),
          stage: 'awaiting_tender',
        }),
      status: 200,
      events: [{ action: 'opportunity.stage_changed', changes: ['stage'] }],
    },
    {
      name: 'backward stage change with its explanation',
      actor: 'leadGA',
      opportunityId: ids.oppRafiq,
      run: async (c) =>
        send(c, `/api/opportunities/${ids.oppRafiq}/stage`, {
          version: await versionOf('opportunities', ids.oppRafiq),
          stage: 'identified',
          explanation: 'The ministry restarted the needs assessment.',
        }),
      status: 200,
      events: [{ action: 'opportunity.stage_changed', changes: ['stage'], reason: 'The ministry restarted the needs assessment.' }],
    },
    {
      name: 'Lost outcome, closing the open follow-ups as Cancelled',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) =>
        send(c, `/api/opportunities/${ids.oppRafiq}/stage`, {
          version: await versionOf('opportunities', ids.oppRafiq),
          stage: 'lost',
          lossReason: 'price',
          closedDate: TODAY,
          explanation: 'Skipped straight to the outcome.',
        }),
      status: 200,
      events: [
        { action: 'opportunity.stage_changed', changes: ['stage'], reason: true },
        { action: 'follow_up.cancelled', changes: ['state'], reason: true },
      ],
    },
    {
      name: 'On Hold with its explanation',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) =>
        send(c, `/api/opportunities/${ids.oppRafiq}/status`, {
          version: await versionOf('opportunities', ids.oppRafiq),
          status: 'on_hold',
          reason: 'Budget frozen until the next fiscal year.',
        }),
      status: 200,
      events: [{ action: 'opportunity.status_changed', changes: ['status'], reason: 'Budget frozen until the next fiscal year.' }],
    },
    {
      name: 'management reopening an Awarded record, keeping the old outcome',
      actor: 'management',
      opportunityId: ids.oppRafiqAwarded,
      run: async (c) =>
        send(c, `/api/opportunities/${ids.oppRafiqAwarded}/reopen`, {
          version: await versionOf('opportunities', ids.oppRafiqAwarded),
          stage: 'evaluation',
          reason: 'The award was annulled on appeal.',
          nextFollowUp: { title: 'Prepare the re-evaluation response', dueDate: '2026-10-20' },
        }),
      status: 200,
      events: [
        { action: 'opportunity.reopened', changes: ['stage', 'awardedValue'], reason: 'The award was annulled on appeal.' },
        { action: 'follow_up.created', changes: ['dueDate', 'assignedUserId'] },
      ],
    },
    {
      name: 'follow-up creation',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: (c) =>
        send(c, `/api/opportunities/${ids.oppRafiq}/follow-ups`, {
          title: 'Send the revised scope',
          dueDate: '2026-10-12',
          assigneeId: ids.salesGA1,
        }),
      status: 201,
      events: [{ action: 'follow_up.created', changes: ['dueDate', 'assignedUserId'] }],
    },
    {
      name: 'completion of the last open follow-up with its replacement',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) => {
        const task = await openTask(ids.oppRafiq);
        return send(c, `/api/follow-ups/${task.id}/complete`, {
          version: task.version,
          completionNote: 'Meeting held.',
          replacement: { title: 'Circulate the minutes', dueDate: '2026-10-09' },
        });
      },
      status: 200,
      events: [
        { action: 'follow_up.completed', changes: ['state'] },
        { action: 'follow_up.created', changes: ['dueDate'] },
      ],
    },
    {
      name: 'rescheduling: old date, new date, actor and reason (FR-043)',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) => {
        const task = await openTask(ids.oppRafiq);
        return send(c, `/api/follow-ups/${task.id}/reschedule`, {
          version: task.version,
          dueDate: '2026-11-30',
          reason: 'The client asked to meet after the holidays.',
        });
      },
      status: 200,
      events: [{ action: 'follow_up.rescheduled', changes: ['dueDate'], reason: 'The client asked to meet after the holidays.' }],
    },
    {
      name: 'cancelling a follow-up with a replacement',
      actor: 'leadGA',
      opportunityId: ids.oppRafiq,
      run: async (c) => {
        const task = await openTask(ids.oppRafiq);
        return send(c, `/api/follow-ups/${task.id}/cancel`, {
          version: task.version,
          reason: 'Superseded by a site visit.',
          replacement: { title: 'Site visit', dueDate: '2026-10-15' },
        });
      },
      status: 200,
      events: [
        { action: 'follow_up.cancelled', changes: ['state'], reason: 'Superseded by a site visit.' },
        { action: 'follow_up.created', changes: ['dueDate'] },
      ],
    },
    {
      name: 'ownership transfer with the open follow-up reassigned',
      actor: 'leadGA',
      opportunityId: ids.oppRafiq,
      run: async (c) =>
        send(c, `/api/opportunities/${ids.oppRafiq}/transfer`, {
          version: await versionOf('opportunities', ids.oppRafiq),
          newOwnerId: ids.salesGA2,
          reason: 'Rafiq moves to the training programme.',
        }),
      status: 200,
      events: [
        { action: 'opportunity.transferred', changes: ['ownerId'], reason: 'Rafiq moves to the training programme.' },
        { action: 'follow_up.reassigned', changes: ['assignedUserId'], reason: true },
      ],
    },
    {
      name: 'organization creation',
      actor: 'salesGA1',
      opportunityId: null,
      run: (c) => send(c, '/api/organizations', { name: 'Coastal Water Authority', type: 'authority' }),
      status: 201,
      events: [{ action: 'organization.created', domain: 'directory', changes: ['name'] }],
    },
    {
      name: 'organization edit',
      actor: 'salesGA1',
      opportunityId: null,
      run: async (c) =>
        patch(c, `/api/organizations/${ids.orgBangla}`, {
          version: await versionOf('organizations', ids.orgBangla),
          location: 'Rajshahi',
        }),
      status: 200,
      events: [{ action: 'organization.updated', domain: 'directory', changes: ['location'] }],
    },
    {
      name: 'organization archive by management',
      actor: 'management',
      opportunityId: null,
      run: async (c) => {
        const created = await send(c, '/api/organizations', { name: 'Short-lived Directorate', type: 'directorate' }).expect(201);
        return send(c, `/api/organizations/${created.body.id}/archive`, {
          version: created.body.version,
          reason: 'Entered by mistake.',
        });
      },
      status: 200,
      events: [{ action: 'organization.archived', domain: 'directory', changes: ['archived'], reason: 'Entered by mistake.' }],
    },
    {
      name: 'new contact created together with its first link',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: (c) =>
        send(c, '/api/contacts', {
          organizationId: ids.orgSylvanHills,
          fullName: 'Shirin Akter',
          designation: 'Deputy Secretary',
          opportunityId: ids.oppRafiq,
          relationshipNotes: 'Chairs the evaluation committee.',
        }),
      status: 201,
      events: [
        { action: 'contact.created', domain: 'directory', changes: ['fullName'] },
        { action: 'contact.linked', changes: ['contactId'] },
      ],
    },
    {
      name: 'linking an existing contact',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: (c) => send(c, `/api/opportunities/${ids.oppRafiq}/contacts`, { contactId: ids.contactFarzana }),
      status: 201,
      events: [{ action: 'contact.linked', changes: ['contactId'] }],
    },
    {
      name: 'relationship notes on one link',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) => {
        const link = await liveLink(ids.oppRafiq, ids.contactGolam);
        return patch(c, `/api/contact-links/${link.id}`, { version: link.version, relationshipNotes: 'Prefers morning meetings.' });
      },
      status: 200,
      events: [{ action: 'contact.notes_updated', changes: ['relationshipNotes'] }],
    },
    {
      name: 'removing a link that is not the contact’s last',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) => {
        const link = await liveLink(ids.oppRafiq, ids.contactGolam);
        return send(c, `/api/contact-links/${link.id}/remove`, { version: link.version, reason: 'Moved to another ministry.' });
      },
      status: 204,
      events: [{ action: 'contact.unlinked', reason: 'Moved to another ministry.' }],
    },
    {
      name: 'shared contact identity edit',
      actor: 'management',
      opportunityId: null,
      run: async (c) =>
        patch(c, `/api/contacts/${ids.contactGolam}`, {
          version: await versionOf('contacts', ids.contactGolam),
          designation: 'Chief Executive (Acting)',
        }),
      status: 200,
      events: [{ action: 'contact.updated', domain: 'directory', changes: ['designation'] }],
    },
    {
      name: 'contact archive by management',
      actor: 'management',
      opportunityId: null,
      run: async (c) =>
        send(c, `/api/contacts/${ids.contactLaila}/archive`, {
          version: await versionOf('contacts', ids.contactLaila),
          reason: 'Retired from public service.',
        }),
      status: 200,
      events: [{ action: 'contact.archived', domain: 'directory', changes: ['archived'], reason: 'Retired from public service.' }],
    },
    {
      name: 'activity with the next follow-up from the same form',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: (c) =>
        send(c, `/api/opportunities/${ids.oppRafiq}/activities`, {
          type: 'meeting',
          occurredAt: EARLIER,
          subject: 'Scope workshop',
          contactId: ids.contactGolam,
          nextFollowUp: { title: 'Share the workshop notes', dueDate: '2026-10-08' },
        }),
      status: 201,
      events: [
        { action: 'activity.logged', changes: ['type', 'occurredAt'] },
        { action: 'follow_up.created', changes: ['dueDate'] },
      ],
    },
    {
      name: 'activity amendment',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) =>
        patch(c, `/api/activities/${ids.activityRafiqVisit}`, {
          version: await versionOf('activities', ids.activityRafiqVisit),
          notes: 'Corrected: the CEO attended in person.',
        }),
      status: 200,
      events: [{ action: 'activity.updated', changes: ['notes'] }],
    },
    {
      name: 'new tender notice superseding the current one',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiqTender,
      run: (c) =>
        send(c, `/api/opportunities/${ids.oppRafiqTender}/tenders`, {
          procuringOrganizationId: ids.orgSylvanHills,
          title: 'Re-tender: digital records platform',
          reference: 'SH/ICT/2026/07-R',
          publicationDate: TODAY,
          submissionDeadline: '2026-11-01T12:00:00+06:00',
          bidStatus: 'reviewing',
        }),
      status: 201,
      events: [
        { action: 'tender.superseded', changes: ['noticeState'], reason: true },
        { action: 'tender.created', changes: ['title', 'submissionDeadline'] },
      ],
    },
    {
      name: 'tender edit',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiqTender,
      run: async (c) =>
        patch(c, `/api/tenders/${ids.tenderRafiq}`, {
          version: await versionOf('tenders', ids.tenderRafiq),
          bidStatus: 'preparing',
        }),
      status: 200,
      events: [{ action: 'tender.updated', changes: ['bidStatus'] }],
    },
    {
      name: 'bid submission with the accepted stage change, atomically (FR-051)',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiqTender,
      run: async (c) =>
        send(c, `/api/tenders/${ids.tenderRafiq}/submit`, {
          version: await versionOf('tenders', ids.tenderRafiq),
          submittedAt: EARLIER,
          moveOpportunityToBidSubmitted: true,
        }),
      status: 200,
      events: [
        { action: 'tender.submitted', changes: ['bidStatus', 'submittedAt'] },
        { action: 'opportunity.stage_changed', changes: ['stage'] },
      ],
    },
    {
      name: 'cancelling a tender notice',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiqTender,
      run: async (c) =>
        send(c, `/api/tenders/${ids.tenderRafiq}/cancel`, {
          version: await versionOf('tenders', ids.tenderRafiq),
          reason: 'The notice was withdrawn by the procuring entity.',
        }),
      status: 200,
      events: [{ action: 'tender.cancelled', changes: ['noticeState'], reason: 'The notice was withdrawn by the procuring entity.' }],
    },
    {
      name: 'document upload finalization, then the system scan verdict',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) => {
        const staged = await stage(c, ids.oppRafiq, 'scope.pdf', PDF).expect(201);
        return send(c, `/api/document-uploads/${staged.body.uploadId}/finalize`, { category: 'requirements' });
      },
      status: 201,
      events: [{ action: 'document.uploaded', changes: ['fileName', 'category'] }],
      systemEvents: ['document.scanned'],
    },
    {
      name: 'document revision',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) => {
        const document = await uploadDocument(c, ids.oppRafiq);
        const staged = await stage(c, ids.oppRafiq, 'proposal-v2.txt', TEXT).expect(201);
        return send(c, `/api/document-uploads/${staged.body.uploadId}/finalize`, { documentId: document.id, note: 'Second draft' });
      },
      status: 201,
      events: [{ action: 'document.revised', changes: ['revisionNumber'] }],
      systemEvents: ['document.scanned'],
    },
    {
      name: 'document category change',
      actor: 'salesGA1',
      opportunityId: ids.oppRafiq,
      run: async (c) => {
        const document = await uploadDocument(c, ids.oppRafiq);
        return patch(c, `/api/documents/${document.id}`, { version: document.version, category: 'correspondence' });
      },
      status: 200,
      events: [{ action: 'document.updated', changes: ['category'] }],
    },
    {
      name: 'document archive by management',
      actor: 'management',
      opportunityId: ids.oppRafiq,
      run: async (c, as) => {
        const document = await uploadDocument(await as('salesGA1'), ids.oppRafiq);
        return send(c, `/api/documents/${document.id}/archive`, { version: document.version, reason: 'Superseded by the signed copy.' });
      },
      status: 200,
      events: [{ action: 'document.archived', changes: ['archived'], reason: 'Superseded by the signed copy.' }],
    },
    {
      name: 'account creation with its invitation',
      actor: 'admin',
      opportunityId: null,
      run: (c) =>
        send(c, '/api/admin/users', { fullName: 'Nusrat Jahan', email: 'nusrat.jahan@example.com', role: 'sales', sectionId: ids.sectionGA }),
      status: 201,
      events: [
        { action: 'account.created', domain: 'administrative', changes: ['role', 'sectionId', 'managerId'] },
        { action: 'account.invitation_issued', domain: 'administrative', changes: ['expiresAt'] },
      ],
    },
    {
      name: 'account edit',
      actor: 'admin',
      opportunityId: null,
      run: async (c) =>
        patch(c, `/api/admin/users/${ids.salesGA2}`, { version: await versionOf('users', ids.salesGA2), fullName: 'Tasnia Karim Chowdhury' }),
      status: 200,
      events: [{ action: 'account.updated', domain: 'administrative', changes: ['fullName'] }],
    },
    {
      name: 'role change, audited as its own event',
      actor: 'admin',
      opportunityId: null,
      run: async (c) => {
        const person = await createSalesperson(c, 'Role Change Person');
        return patch(c, `/api/admin/users/${person.id}`, { version: person.version, role: 'management' });
      },
      status: 200,
      events: [{ action: 'account.role_changed', domain: 'administrative', changes: ['role', 'sectionId', 'managerId'] }],
    },
    {
      name: 'deactivation with a reason',
      actor: 'admin',
      opportunityId: null,
      run: async (c) => {
        const person = await createSalesperson(c, 'Leaving Person');
        return send(c, `/api/admin/users/${person.id}/deactivate`, { version: person.version, reason: 'Left the company.' });
      },
      status: 200,
      events: [{ action: 'account.deactivated', domain: 'administrative', changes: ['active'], reason: 'Left the company.' }],
    },
    {
      name: 'reactivation',
      actor: 'admin',
      opportunityId: null,
      run: async (c) =>
        send(c, `/api/admin/users/${ids.inactiveGA}/reactivate`, {
          version: await versionOf('users', ids.inactiveGA),
          reason: 'Returned from leave.',
        }),
      status: 200,
      events: [{ action: 'account.reactivated', domain: 'administrative', changes: ['active'], reason: 'Returned from leave.' }],
    },
    {
      name: 'password reset link',
      actor: 'admin',
      opportunityId: null,
      run: (c) => send(c, `/api/admin/users/${ids.salesGA2}/link`, {}),
      status: 201,
      events: [{ action: 'account.reset_issued', domain: 'administrative', changes: ['expiresAt'] }],
    },
    {
      name: 'section creation',
      actor: 'admin',
      opportunityId: null,
      run: (c) => send(c, '/api/admin/sections', { name: 'Health Systems' }),
      status: 201,
      events: [{ action: 'section.created', domain: 'administrative', changes: ['name'] }],
    },
    {
      name: 'section rename',
      actor: 'admin',
      opportunityId: null,
      run: async (c) =>
        patch(c, `/api/admin/sections/${ids.sectionGA}`, { version: await versionOf('sections', ids.sectionGA), name: 'Government Applications and Portals' }),
      status: 200,
      events: [{ action: 'section.renamed', domain: 'administrative', changes: ['name'] }],
    },
    {
      name: 'section lead replacement: both role changes, each re-pointed reporting line, the section',
      actor: 'admin',
      opportunityId: null,
      run: async (c) =>
        send(c, `/api/admin/sections/${ids.sectionGA}/replace-lead`, {
          version: await versionOf('sections', ids.sectionGA),
          newLeadId: ids.salesGA2,
          reason: 'Nadia moves to the bid office.',
        }),
      status: 200,
      events: [
        { action: 'account.role_changed', domain: 'administrative', changes: ['role', 'managerId'], reason: true },
        { action: 'account.role_changed', domain: 'administrative', changes: ['role'], reason: true },
        // Every other salesperson in the section now reports to Tasnia (FR-062:
        // an account change). Rafiq, Shuvo (inactive) and Mehjabin.
        { action: 'account.manager_changed', domain: 'administrative', changes: ['managerId'], reason: true },
        { action: 'account.manager_changed', domain: 'administrative', changes: ['managerId'], reason: true },
        { action: 'account.manager_changed', domain: 'administrative', changes: ['managerId'], reason: true },
        { action: 'section.lead_replaced', domain: 'administrative', changes: ['leadUserId'], reason: true },
      ],
    },
    {
      name: 'section deactivation',
      actor: 'admin',
      opportunityId: null,
      run: async (c) => {
        const section = await createSection(c, 'Pilot Section');
        return send(c, `/api/admin/sections/${section.id}/deactivate`, { version: section.version, reason: 'Pilot ended.' });
      },
      status: 200,
      events: [{ action: 'section.deactivated', domain: 'administrative', changes: ['active'], reason: 'Pilot ended.' }],
    },
    {
      name: 'CSV export request',
      actor: 'leadGA',
      opportunityId: null,
      run: (c) => send(c, '/api/exports', { kind: 'pipeline', filters: {} }),
      status: 202,
      events: [{ action: 'report.export_requested', domain: 'reporting', changes: ['kind'] }],
    },
  ];

  describe('FR-062: each mutation is audited once, by its actor, under its own request id', () => {
    it.each(auditCases.map((auditCase) => [auditCase.name, auditCase] as const))('%s', async (_name, auditCase) => {
      const sessions = new Map<string, SignedInClient>();
      const as = async (who: keyof typeof emails) => {
        if (!sessions.has(who)) sessions.set(who, await signIn(ctx.app, emails[who]));
        return sessions.get(who) as SignedInClient;
      };
      const client = await as(auditCase.actor);
      const response = await auditCase.run(client, as);
      expect(response.status, JSON.stringify(response.body)).toBe(auditCase.status);

      const rows = await auditFor(response);
      const opportunityId =
        typeof auditCase.opportunityId === 'function' ? auditCase.opportunityId(response) : auditCase.opportunityId;
      const userEvents = rows.filter((row) => row.actorId !== null);
      const systemEvents = rows.filter((row) => row.actorId === null);

      expect(userEvents.map((row) => row.action)).toEqual(auditCase.events.map((event) => event.action));
      expect(systemEvents.map((row) => row.action)).toEqual(auditCase.systemEvents ?? []);

      for (const [index, expected] of auditCase.events.entries()) {
        const row = userEvents[index]!;
        const domain = expected.domain ?? 'commercial';
        expect(row.actorId).toBe(actorIds[auditCase.actor]);
        expect(row.domain).toBe(domain);
        expect(row.occurredAt.toISOString()).toBe(new Date(NOW).toISOString());
        expect(row.entityId).toMatch(/^[0-9a-f-]{36}$/);
        // SEC-012: commercial events carry their opportunity, so history
        // inherits its scope; nothing else may point at one.
        expect(row.opportunityId).toBe(domain === 'commercial' ? opportunityId : null);

        const before = (row.beforeData ?? {}) as Record<string, unknown>;
        const after = (row.afterData ?? {}) as Record<string, unknown>;
        for (const key of expected.changes ?? []) {
          expect(key in after || key in before, `${row.action} records ${key}`).toBe(true);
          if (row.beforeData !== null && key in before && key in after) {
            expect(after[key], `${row.action} ${key} changed`).not.toEqual(before[key]);
          }
        }
        if (expected.reason === true) expect(row.reason?.trim()).toBeTruthy();
        else if (expected.reason) expect(row.reason).toBe(expected.reason);

        // FR-062: never a password, token or file content.
        const serialized = JSON.stringify([row.beforeData, row.afterData]);
        expect(serialized).not.toMatch(/password|token|\$argon2|%PDF/i);
      }
      for (const row of systemEvents) expect(row.opportunityId).toBe(opportunityId);
    });

    it('covers every audit action the services can write', async () => {
      // A new mutation must join the matrix above. Actions written only by
      // flows exercised elsewhere are listed with where they are tested.
      const exercisedElsewhere = new Map([
        ['tender.designated_current', 'designating a superseded notice current, below'],
        ['account.invitation_accepted', 'auth.test.ts / administration.test.ts set-password flows'],
        ['account.password_reset', 'auth.test.ts / administration.test.ts set-password flows'],
        ['section.reactivated', 'administration.test.ts'],
        ['report.exported', 'reports.test.ts (job), and the export case in §6 below'],
        ['report.export_downloaded', 'reports.test.ts, and §6 below'],
      ]);
      const covered = new Set(auditCases.flatMap((auditCase) => [...auditCase.events.map((e) => e.action), ...(auditCase.systemEvents ?? [])]));
      const { readdirSync, readFileSync } = await import('node:fs');
      const path = await import('node:path');
      const servicesDir = path.join(process.cwd(), 'server', 'services');
      const written = new Set<string>();
      for (const file of readdirSync(servicesDir)) {
        const source = readFileSync(path.join(servicesDir, file), 'utf8');
        for (const match of source.matchAll(/'((?:opportunity|follow_up|contact|organization|activity|tender|document|account|section|report)\.[a-z_]+)'/g)) {
          written.add(match[1]!);
        }
      }
      const uncovered = [...written].filter((action) => !covered.has(action) && !exercisedElsewhere.has(action));
      expect(uncovered).toEqual([]);
    });

    it('audits designating a superseded notice as current', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await send(rafiq, `/api/opportunities/${ids.oppRafiqTender}/tenders`, {
        procuringOrganizationId: ids.orgSylvanHills,
        title: 'Replacement notice',
        reference: 'SH/ICT/2026/07-B',
        publicationDate: TODAY,
        submissionDeadline: '2026-11-01T12:00:00+06:00',
        bidStatus: 'reviewing',
      }).expect(201);
      const response = await send(rafiq, `/api/tenders/${ids.tenderRafiq}/designate-current`, {
        version: await versionOf('tenders', ids.tenderRafiq),
      });
      expect(response.status).toBe(200);
      const rows = await auditFor(response);
      expect(rows.map((row) => row.action)).toEqual(['tender.superseded', 'tender.designated_current']);
      for (const row of rows) {
        expect(row.actorId).toBe(ids.salesGA1);
        expect(row.opportunityId).toBe(ids.oppRafiqTender);
      }
    });

    it('writes nothing to the audit trail for a refused or invalid mutation', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const before = await auditCount();
      const version = await versionOf('opportunities', ids.oppRafiq);
      const refused = [
        // 403: a salesperson cannot transfer.
        await send(rafiq, `/api/opportunities/${ids.oppRafiq}/transfer`, { version, newOwnerId: ids.salesGA2, reason: 'Please' }),
        // 404: someone else's record.
        await patch(rafiq, `/api/opportunities/${ids.oppTasnia}`, { version: 1, name: 'Mine now' }),
        // 422: an invalid field.
        await patch(rafiq, `/api/opportunities/${ids.oppRafiq}`, { version, estimatedValue: '-5' }),
        // 409: a stale version.
        await patch(rafiq, `/api/opportunities/${ids.oppRafiq}`, { version: version - 1 || 99, name: 'Stale edit' }),
      ];
      expect(refused.map((response) => response.status)).toEqual([403, 404, 422, 409]);
      expect(await auditCount()).toBe(before);
    });
  });

  // =========================================================================
  // 2. BR-091: retries are recognised, never applied twice
  // =========================================================================

  type As = (who: keyof typeof emails) => Promise<SignedInClient>;

  function sessionsFor() {
    const sessions = new Map<string, SignedInClient>();
    const as: As = async (who) => {
      if (!sessions.has(who)) sessions.set(who, await signIn(ctx.app, emails[who]));
      return sessions.get(who) as SignedInClient;
    };
    return as;
  }

  /** Management moves a record to another section, out of the GA team's reach. */
  async function transferAway(as: As, opportunityId: string): Promise<void> {
    const arif = await as('management');
    const response = await send(arif, `/api/opportunities/${opportunityId}/transfer`, {
      version: await versionOf('opportunities', opportunityId),
      newOwnerId: ids.salesIS1,
      reason: 'Moved to Infrastructure and Security.',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  interface PreparedRequest {
    path: string;
    body: unknown;
    /** The same operation with a different payload. */
    altered: unknown;
  }

  interface IdempotentCase {
    name: string;
    actor: keyof typeof emails;
    prepare: (as: As) => Promise<PreparedRequest>;
    created: number;
    entity: (response: Response) => string;
    /** The opportunity whose transfer revokes the actor's access, if any. */
    revokes?: string | ((response: Response) => string);
    /** The opportunity row the request locks, for the queued-retry race. */
    locks?: string;
  }

  const idempotentCases: IdempotentCase[] = [
    {
      name: 'opportunity creation',
      actor: 'salesGA1',
      prepare: async () => ({
        path: '/api/opportunities',
        body: createOpportunityPayload({ name: 'Idempotent creation' }),
        altered: createOpportunityPayload({ name: 'A different opportunity' }),
      }),
      created: 201,
      entity: (r) => r.body.opportunity.id,
      revokes: (r) => r.body.opportunity.id,
    },
    {
      name: 'follow-up creation',
      actor: 'salesGA1',
      prepare: async () => ({
        path: `/api/opportunities/${ids.oppRafiq}/follow-ups`,
        body: { title: 'Call the PD', dueDate: '2026-10-10', assigneeId: ids.salesGA1 },
        altered: { title: 'Call the PD again', dueDate: '2026-10-10', assigneeId: ids.salesGA1 },
      }),
      created: 201,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'follow-up completion',
      actor: 'salesGA1',
      prepare: async () => {
        const task = await openTask(ids.oppRafiq);
        const replacement = { title: 'Next step', dueDate: '2026-10-20' };
        return {
          path: `/api/follow-ups/${task.id}/complete`,
          body: { version: task.version, replacement },
          altered: { version: task.version, completionNote: 'Different', replacement },
        };
      },
      created: 200,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'follow-up rescheduling',
      actor: 'salesGA1',
      prepare: async () => {
        const task = await openTask(ids.oppRafiq);
        return {
          path: `/api/follow-ups/${task.id}/reschedule`,
          body: { version: task.version, dueDate: '2026-12-01', reason: 'Client travel.' },
          altered: { version: task.version, dueDate: '2026-12-02', reason: 'Client travel.' },
        };
      },
      created: 200,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'follow-up cancellation',
      actor: 'salesGA1',
      prepare: async () => {
        const task = await openTask(ids.oppRafiq);
        const replacement = { title: 'Instead', dueDate: '2026-10-21' };
        return {
          path: `/api/follow-ups/${task.id}/cancel`,
          body: { version: task.version, reason: 'Not needed.', replacement },
          altered: { version: task.version, reason: 'Not needed at all.', replacement },
        };
      },
      created: 200,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'stage change',
      actor: 'salesGA1',
      prepare: async () => {
        const version = await versionOf('opportunities', ids.oppRafiq);
        return {
          path: `/api/opportunities/${ids.oppRafiq}/stage`,
          body: { version, stage: 'awaiting_tender' },
          altered: { version, stage: 'tender_published', explanation: 'Notice out early.' },
        };
      },
      created: 200,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'status change',
      actor: 'salesGA1',
      prepare: async () => {
        const version = await versionOf('opportunities', ids.oppRafiq);
        return {
          path: `/api/opportunities/${ids.oppRafiq}/status`,
          body: { version, status: 'on_hold', reason: 'Budget review.' },
          altered: { version, status: 'cancelled', reason: 'Budget review.' },
        };
      },
      created: 200,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'reopening',
      actor: 'management',
      prepare: async () => {
        const version = await versionOf('opportunities', ids.oppRafiqAwarded);
        const nextFollowUp = { title: 'Restart', dueDate: '2026-10-22' };
        return {
          path: `/api/opportunities/${ids.oppRafiqAwarded}/reopen`,
          body: { version, stage: 'evaluation', reason: 'Appeal upheld.', nextFollowUp },
          altered: { version, stage: 'bid_submitted', reason: 'Appeal upheld.', nextFollowUp },
        };
      },
      created: 200,
      entity: (r) => r.body.id,
      locks: ids.oppRafiqAwarded,
    },
    {
      name: 'ownership transfer',
      actor: 'leadGA',
      prepare: async () => {
        const version = await versionOf('opportunities', ids.oppRafiq);
        return {
          path: `/api/opportunities/${ids.oppRafiq}/transfer`,
          body: { version, newOwnerId: ids.salesGA2, reason: 'Workload.' },
          altered: { version, newOwnerId: ids.noManagerGA, reason: 'Workload.' },
        };
      },
      created: 200,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'contact creation with its first link',
      actor: 'salesGA1',
      prepare: async () => {
        const body = {
          organizationId: ids.orgSylvanHills,
          fullName: 'Retried Contact',
          designation: 'Programme Director',
          opportunityId: ids.oppRafiq,
        };
        return { path: '/api/contacts', body, altered: { ...body, designation: 'Deputy Director' } };
      },
      created: 201,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'contact link',
      actor: 'salesGA1',
      prepare: async () => ({
        path: `/api/opportunities/${ids.oppRafiq}/contacts`,
        body: { contactId: ids.contactFarzana },
        altered: { contactId: ids.contactFarzana, relationshipNotes: 'Different' },
      }),
      created: 201,
      entity: (r) => r.body.linkId,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'activity',
      actor: 'salesGA1',
      prepare: async () => {
        const body = { type: 'phone_call', occurredAt: EARLIER, subject: 'Retried call' };
        return { path: `/api/opportunities/${ids.oppRafiq}/activities`, body, altered: { ...body, subject: 'Another call' } };
      },
      created: 201,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'tender creation',
      actor: 'salesGA1',
      prepare: async () => {
        const body = {
          procuringOrganizationId: ids.orgSylvanHills,
          title: 'Retried notice',
          reference: 'SH/R/1',
          publicationDate: TODAY,
          submissionDeadline: '2026-11-01T12:00:00+06:00',
          bidStatus: 'reviewing',
        };
        return { path: `/api/opportunities/${ids.oppRafiqTender}/tenders`, body, altered: { ...body, reference: 'SH/R/2' } };
      },
      created: 201,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiqTender,
      locks: ids.oppRafiqTender,
    },
    {
      name: 'bid submission',
      actor: 'salesGA1',
      prepare: async () => {
        const version = await versionOf('tenders', ids.tenderRafiq);
        return {
          path: `/api/tenders/${ids.tenderRafiq}/submit`,
          body: { version, submittedAt: EARLIER, moveOpportunityToBidSubmitted: true },
          altered: { version, submittedAt: EARLIER, moveOpportunityToBidSubmitted: false },
        };
      },
      created: 200,
      entity: (r) => r.body.tender.id,
      revokes: ids.oppRafiqTender,
      locks: ids.oppRafiqTender,
    },
    {
      name: 'document upload finalization',
      actor: 'salesGA1',
      prepare: async (as) => {
        const staged = await stage(await as('salesGA1'), ids.oppRafiq, 'retry.pdf', PDF).expect(201);
        return {
          path: `/api/document-uploads/${staged.body.uploadId}/finalize`,
          body: { category: 'proposal' },
          altered: { category: 'correspondence' },
        };
      },
      created: 201,
      entity: (r) => r.body.id,
      revokes: ids.oppRafiq,
      locks: ids.oppRafiq,
    },
    {
      name: 'organization creation',
      actor: 'salesGA1',
      prepare: async () => ({
        path: '/api/organizations',
        body: { name: 'Retried Authority', type: 'authority' },
        altered: { name: 'Retried Authority', type: 'ministry' },
      }),
      created: 201,
      entity: (r) => r.body.id,
    },
    {
      name: 'account creation',
      actor: 'admin',
      prepare: async () => {
        const body = { fullName: 'Retried Person', email: 'retried.person@example.com', role: 'sales', sectionId: ids.sectionGA };
        return { path: '/api/admin/users', body, altered: { ...body, sectionId: ids.sectionIS } };
      },
      created: 201,
      entity: (r) => r.body.user.id,
    },
    {
      name: 'section creation',
      actor: 'admin',
      prepare: async () => ({ path: '/api/admin/sections', body: { name: 'Retried Section' }, altered: { name: 'Other Section' } }),
      created: 201,
      entity: (r) => r.body.id,
    },
    {
      name: 'CSV export request',
      actor: 'leadGA',
      prepare: async () => ({
        path: '/api/exports',
        body: { kind: 'pipeline', filters: {} },
        altered: { kind: 'lost_reasons', filters: {} },
      }),
      created: 202,
      entity: (r) => r.body.id,
    },
  ];

  describe('BR-091: retry deduplication for every keyed operation', () => {
    it.each(idempotentCases.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
      const as = sessionsFor();
      const client = await as(testCase.actor);
      const request = await testCase.prepare(as);
      const key = nextIdempotencyKey('retry');

      const first = await send(client, request.path, request.body, key);
      expect(first.status, JSON.stringify(first.body)).toBe(testCase.created);
      const afterFirst = await fingerprint();

      // The same request again: the stored outcome, re-read, and nothing new.
      const retry = await send(client, request.path, request.body, key);
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      expect(testCase.entity(retry)).toBe(testCase.entity(first));
      expect(await fingerprint()).toEqual(afterFirst);

      // The same key with another payload is refused and changes nothing.
      const reused = await send(client, request.path, request.altered, key);
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('idempotency_key_reuse');
      expect(await fingerprint()).toEqual(afterFirst);

      // A replay re-checks current access: once the record has moved out of
      // reach, the stored outcome is not handed back (plan §5).
      if (testCase.revokes) {
        const revoked = typeof testCase.revokes === 'function' ? testCase.revokes(first) : testCase.revokes;
        await transferAway(as, revoked);
        const afterRevocation = await send(client, request.path, request.body, key);
        expect(afterRevocation.status).toBe(404);
        expect(withoutRequestId(afterRevocation)).toEqual(await missingNotFound(client));
      }
    });

    it('replays an activity creation that is not on the first page of a busy record', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('busy');
      const body = { type: 'meeting', occurredAt: '2026-01-15T10:00:00+06:00', subject: 'Back-dated kickoff' };
      const first = await send(rafiq, `/api/opportunities/${ids.oppRafiq}/activities`, body, key).expect(201);
      // A hundred later activities push it off the first page of the timeline.
      await owner.query(
        `INSERT INTO activities (opportunity_id, occurred_at, type, subject, author_id, created_at, updated_at)
         SELECT $1, $2::timestamptz + make_interval(mins => n), 'other', 'Later note ' || n, $3, $2::timestamptz, $2::timestamptz
           FROM generate_series(1, 100) AS n`,
        [ids.oppRafiq, '2026-09-01T10:00:00+06:00', ids.salesGA1],
      );
      const retry = await send(rafiq, `/api/opportunities/${ids.oppRafiq}/activities`, body, key);
      expect(retry.status).toBe(200);
      expect(retry.body.id).toBe(first.body.id);
    });

    it('scopes keys by actor: another person’s identical key is a separate request', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const nadia = await signIn(ctx.app, emails.leadGA);
      const key = nextIdempotencyKey('shared');
      const mine = await send(rafiq, '/api/opportunities', createOpportunityPayload({ name: 'Rafiq’s' }), key);
      const theirs = await send(nadia, '/api/opportunities', createOpportunityPayload({ name: 'Nadia’s' }), key);
      expect([mine.status, theirs.status]).toEqual([201, 201]);
      expect(theirs.body.opportunity.id).not.toBe(mine.body.opportunity.id);
      expect(theirs.body.opportunity.name).toBe('Nadia’s');
    });

    it('scopes keys by operation: one key on two different operations', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('two-ops');
      const created = await send(
        rafiq,
        `/api/opportunities/${ids.oppRafiq}/follow-ups`,
        { title: 'One key', dueDate: '2026-10-10', assigneeId: ids.salesGA1 },
        key,
      );
      const logged = await send(
        rafiq,
        `/api/opportunities/${ids.oppRafiq}/activities`,
        { type: 'other', occurredAt: EARLIER, subject: 'Same key, other operation' },
        key,
      );
      expect([created.status, logged.status]).toEqual([201, 201]);
    });

    it.each(idempotentCases.filter((c) => c.locks).map((c) => [c.name, c] as const))(
      'a genuinely concurrent duplicate of %s is refused while the first is in flight, then replays it',
      async (_name, testCase) => {
        const as = sessionsFor();
        const client = await as(testCase.actor);
        const request = await testCase.prepare(as);
        const key = nextIdempotencyKey('concurrent');

        // The first request takes the key, then queues behind the held row lock.
        const lock = await holdOpportunity(testCase.locks as string);
        let first: Promise<Response> | undefined;
        try {
          first = start(send(client, request.path, request.body, key));
          await waitForLockWaiters(1);
          // The duplicate arrives while the first is mid-transaction.
          const duplicate = await send(client, request.path, request.body, key);
          expect(duplicate.status).toBe(409);
          expect(duplicate.body.code).toBe('idempotency_in_progress');
        } finally {
          await lock.release();
        }
        const firstResponse = await (first as Promise<Response>);
        expect(firstResponse.status, JSON.stringify(firstResponse.body)).toBe(testCase.created);
        const settled = await fingerprint();

        const retry = await send(client, request.path, request.body, key);
        expect(retry.status).toBe(200);
        expect(testCase.entity(retry)).toBe(testCase.entity(firstResponse));
        expect(await fingerprint()).toEqual(settled);
      },
    );
  });

  // =========================================================================
  // 3. BR-090: a stale version is a 409 that preserves the committed state
  // =========================================================================

  interface StaleCase {
    name: string;
    actor: keyof typeof emails;
    table: string;
    /** Returns the row id; may create what the case needs first. */
    target: (as: As) => Promise<string>;
    request: (id: string, version: number) => { method: Method; path: string; body: unknown };
  }

  const newerNotice = {
    procuringOrganizationId: ids.orgSylvanHills,
    title: 'Newer notice',
    reference: 'SH/N/1',
    publicationDate: TODAY,
    submissionDeadline: '2026-11-01T12:00:00+06:00',
    bidStatus: 'reviewing',
  };

  const staleCases: StaleCase[] = [
    {
      name: 'basic opportunity edit',
      actor: 'salesGA1',
      table: 'opportunities',
      target: async () => ids.oppRafiq,
      request: (id, version) => ({ method: 'patch', path: `/api/opportunities/${id}`, body: { version, name: 'Overwritten?' } }),
    },
    {
      name: 'stage change',
      actor: 'salesGA1',
      table: 'opportunities',
      target: async () => ids.oppRafiq,
      request: (id, version) => ({ method: 'post', path: `/api/opportunities/${id}/stage`, body: { version, stage: 'awaiting_tender' } }),
    },
    {
      name: 'status change',
      actor: 'salesGA1',
      table: 'opportunities',
      target: async () => ids.oppRafiq,
      request: (id, version) => ({
        method: 'post',
        path: `/api/opportunities/${id}/status`,
        body: { version, status: 'on_hold', reason: 'Paused.' },
      }),
    },
    {
      name: 'reopening',
      actor: 'management',
      table: 'opportunities',
      target: async () => ids.oppRafiqAwarded,
      request: (id, version) => ({
        method: 'post',
        path: `/api/opportunities/${id}/reopen`,
        body: { version, stage: 'evaluation', reason: 'Appeal.', nextFollowUp: { title: 'Restart', dueDate: '2026-10-22' } },
      }),
    },
    {
      name: 'ownership transfer',
      actor: 'leadGA',
      table: 'opportunities',
      target: async () => ids.oppRafiq,
      request: (id, version) => ({
        method: 'post',
        path: `/api/opportunities/${id}/transfer`,
        body: { version, newOwnerId: ids.salesGA2, reason: 'Workload.' },
      }),
    },
    {
      name: 'follow-up completion',
      actor: 'salesGA1',
      table: 'follow_ups',
      target: async () => (await openTask(ids.oppRafiq)).id,
      request: (id, version) => ({
        method: 'post',
        path: `/api/follow-ups/${id}/complete`,
        body: { version, replacement: { title: 'Next', dueDate: '2026-10-20' } },
      }),
    },
    {
      name: 'follow-up rescheduling',
      actor: 'salesGA1',
      table: 'follow_ups',
      target: async () => (await openTask(ids.oppRafiq)).id,
      request: (id, version) => ({
        method: 'post',
        path: `/api/follow-ups/${id}/reschedule`,
        body: { version, dueDate: '2026-12-01', reason: 'Later.' },
      }),
    },
    {
      name: 'follow-up cancellation',
      actor: 'salesGA1',
      table: 'follow_ups',
      target: async () => (await openTask(ids.oppRafiq)).id,
      request: (id, version) => ({
        method: 'post',
        path: `/api/follow-ups/${id}/cancel`,
        body: { version, reason: 'Dropped.', replacement: { title: 'Instead', dueDate: '2026-10-20' } },
      }),
    },
    {
      name: 'organization edit',
      actor: 'salesGA1',
      table: 'organizations',
      target: async () => ids.orgBangla,
      request: (id, version) => ({ method: 'patch', path: `/api/organizations/${id}`, body: { version, location: 'Khulna' } }),
    },
    {
      name: 'organization archive',
      actor: 'management',
      table: 'organizations',
      target: async (as) =>
        (await send(await as('management'), '/api/organizations', { name: 'Archivable Office', type: 'other' }).expect(201)).body.id,
      request: (id, version) => ({ method: 'post', path: `/api/organizations/${id}/archive`, body: { version, reason: 'Unused.' } }),
    },
    {
      name: 'shared contact edit',
      actor: 'management',
      table: 'contacts',
      target: async () => ids.contactGolam,
      request: (id, version) => ({ method: 'patch', path: `/api/contacts/${id}`, body: { version, designation: 'Adviser' } }),
    },
    {
      name: 'contact archive',
      actor: 'management',
      table: 'contacts',
      target: async () => ids.contactLaila,
      request: (id, version) => ({ method: 'post', path: `/api/contacts/${id}/archive`, body: { version, reason: 'Retired.' } }),
    },
    {
      name: 'relationship notes',
      actor: 'salesGA1',
      table: 'opportunity_contacts',
      target: async () => (await liveLink(ids.oppRafiq, ids.contactGolam)).id,
      request: (id, version) => ({
        method: 'patch',
        path: `/api/contact-links/${id}`,
        body: { version, relationshipNotes: 'Overwritten?' },
      }),
    },
    {
      name: 'link removal',
      actor: 'salesGA1',
      table: 'opportunity_contacts',
      target: async () => (await liveLink(ids.oppRafiq, ids.contactGolam)).id,
      request: (id, version) => ({ method: 'post', path: `/api/contact-links/${id}/remove`, body: { version } }),
    },
    {
      name: 'activity amendment',
      actor: 'salesGA1',
      table: 'activities',
      target: async () => ids.activityRafiqVisit,
      request: (id, version) => ({ method: 'patch', path: `/api/activities/${id}`, body: { version, subject: 'Overwritten?' } }),
    },
    {
      name: 'tender edit',
      actor: 'salesGA1',
      table: 'tenders',
      target: async () => ids.tenderRafiq,
      request: (id, version) => ({ method: 'patch', path: `/api/tenders/${id}`, body: { version, bidStatus: 'preparing' } }),
    },
    {
      name: 'bid submission',
      actor: 'salesGA1',
      table: 'tenders',
      target: async () => ids.tenderRafiq,
      request: (id, version) => ({
        method: 'post',
        path: `/api/tenders/${id}/submit`,
        body: { version, submittedAt: EARLIER, moveOpportunityToBidSubmitted: true },
      }),
    },
    {
      name: 'tender notice cancellation',
      actor: 'salesGA1',
      table: 'tenders',
      target: async () => ids.tenderRafiq,
      request: (id, version) => ({ method: 'post', path: `/api/tenders/${id}/cancel`, body: { version, reason: 'Withdrawn.' } }),
    },
    {
      name: 'designating a notice current',
      actor: 'salesGA1',
      table: 'tenders',
      target: async (as) => {
        await send(await as('salesGA1'), `/api/opportunities/${ids.oppRafiqTender}/tenders`, newerNotice).expect(201);
        return ids.tenderRafiq;
      },
      request: (id, version) => ({ method: 'post', path: `/api/tenders/${id}/designate-current`, body: { version } }),
    },
    {
      name: 'document category',
      actor: 'salesGA1',
      table: 'documents',
      target: async (as) => (await uploadDocument(await as('salesGA1'), ids.oppRafiq)).id,
      request: (id, version) => ({ method: 'patch', path: `/api/documents/${id}`, body: { version, category: 'correspondence' } }),
    },
    {
      name: 'document archive',
      actor: 'management',
      table: 'documents',
      target: async (as) => (await uploadDocument(await as('salesGA1'), ids.oppRafiq)).id,
      request: (id, version) => ({ method: 'post', path: `/api/documents/${id}/archive`, body: { version, reason: 'Replaced.' } }),
    },
    {
      name: 'account edit',
      actor: 'admin',
      table: 'users',
      target: async () => ids.salesGA2,
      request: (id, version) => ({ method: 'patch', path: `/api/admin/users/${id}`, body: { version, fullName: 'Overwritten Name' } }),
    },
    {
      name: 'deactivation',
      actor: 'admin',
      table: 'users',
      target: async (as) => (await createSalesperson(await as('admin'), 'Stale Deactivation')).id,
      request: (id, version) => ({ method: 'post', path: `/api/admin/users/${id}/deactivate`, body: { version } }),
    },
    {
      name: 'reactivation',
      actor: 'admin',
      table: 'users',
      target: async () => ids.inactiveGA,
      request: (id, version) => ({ method: 'post', path: `/api/admin/users/${id}/reactivate`, body: { version } }),
    },
    {
      name: 'section rename',
      actor: 'admin',
      table: 'sections',
      target: async () => ids.sectionGA,
      request: (id, version) => ({ method: 'patch', path: `/api/admin/sections/${id}`, body: { version, name: 'Overwritten Section' } }),
    },
    {
      name: 'section lead replacement',
      actor: 'admin',
      table: 'sections',
      target: async () => ids.sectionGA,
      request: (id, version) => ({
        method: 'post',
        path: `/api/admin/sections/${id}/replace-lead`,
        body: { version, newLeadId: ids.salesGA2, reason: 'Change.' },
      }),
    },
    {
      name: 'section deactivation',
      actor: 'admin',
      table: 'sections',
      target: async (as) => (await createSection(await as('admin'), 'Stale Section')).id,
      request: (id, version) => ({ method: 'post', path: `/api/admin/sections/${id}/deactivate`, body: { version } }),
    },
  ];

  describe('BR-090: stale versions return 409 and never overwrite', () => {
    it.each(staleCases.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
      const as = sessionsFor();
      const client = await as(testCase.actor);
      const id = await testCase.target(as);
      const readVersion = await versionOf(testCase.table, id);

      // Someone else's change commits after this client read the record.
      await owner.query(`UPDATE ${testCase.table} SET version = version + 1 WHERE id = $1`, [id]);
      const committed = await fingerprint();

      const stale = testCase.request(id, readVersion);
      const response = await mutate(client, stale.method, stale.path, stale.body);
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body.code).toBe('version_conflict');
      expect(await fingerprint()).toEqual(committed);

      // Control: the same change against the current version is accepted, so
      // the 409 above was the version and nothing else.
      const fresh = testCase.request(id, readVersion + 1);
      const accepted = await mutate(client, fresh.method, fresh.path, fresh.body);
      expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
    });

    it('two edits from the same version, genuinely concurrent: one wins, the other is a 409', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const nadia = await signIn(ctx.app, emails.leadGA);
      const version = await versionOf('opportunities', ids.oppRafiq);

      const lock = await holdOpportunity(ids.oppRafiq);
      let a: Promise<Response> | undefined;
      let b: Promise<Response> | undefined;
      try {
        a = start(patch(rafiq, `/api/opportunities/${ids.oppRafiq}`, { version, name: 'Rafiq’s title' }));
        await waitForLockWaiters(1);
        b = start(patch(nadia, `/api/opportunities/${ids.oppRafiq}`, { version, name: 'Nadia’s title' }));
        await waitForLockWaiters(2);
      } finally {
        await lock.release();
      }
      const first = await (a as Promise<Response>);
      const second = await (b as Promise<Response>);
      expect([first.status, second.status]).toEqual([200, 409]);
      const { name } = await one<{ name: string }>('SELECT name FROM opportunities WHERE id = $1', [ids.oppRafiq]);
      expect(name).toBe('Rafiq’s title');
      expect(await auditFor(second)).toHaveLength(0);
      expect((await auditFor(first)).map((row) => row.action)).toEqual(['opportunity.updated']);
    });
  });

  // =========================================================================
  // 4. A failure late in a transaction leaves nothing behind
  // =========================================================================

  interface FailureCase {
    name: string;
    actor: keyof typeof emails;
    /** The audit action whose insert fails — the last write of the operation. */
    failOn: string;
    prepare: (as: As) => Promise<{ path: string; body: unknown }>;
    succeeds: number;
  }

  const failureCases: FailureCase[] = [
    {
      name: 'opportunity creation',
      actor: 'salesGA1',
      failOn: 'opportunity.created',
      prepare: async () => ({ path: '/api/opportunities', body: createOpportunityPayload({ name: 'Never half-created' }) }),
      succeeds: 201,
    },
    {
      name: 'transfer, after the owner change and its audit',
      actor: 'leadGA',
      failOn: 'follow_up.reassigned',
      prepare: async () => ({
        path: `/api/opportunities/${ids.oppRafiq}/transfer`,
        body: { version: await versionOf('opportunities', ids.oppRafiq), newOwnerId: ids.salesGA2, reason: 'Workload.' },
      }),
      succeeds: 200,
    },
    {
      name: 'Lost, after the stage change, while cancelling follow-ups',
      actor: 'salesGA1',
      failOn: 'follow_up.cancelled',
      prepare: async () => ({
        path: `/api/opportunities/${ids.oppRafiq}/stage`,
        body: {
          version: await versionOf('opportunities', ids.oppRafiq),
          stage: 'lost',
          lossReason: 'price',
          closedDate: TODAY,
          explanation: 'Outcome known.',
        },
      }),
      succeeds: 200,
    },
    {
      name: 'Cancelled status, while cancelling follow-ups',
      actor: 'salesGA1',
      failOn: 'follow_up.cancelled',
      prepare: async () => ({
        path: `/api/opportunities/${ids.oppRafiq}/status`,
        body: { version: await versionOf('opportunities', ids.oppRafiq), status: 'cancelled', reason: 'Project dropped.' },
      }),
      succeeds: 200,
    },
    {
      name: 'reopening, at its required follow-up',
      actor: 'management',
      failOn: 'follow_up.created',
      prepare: async () => ({
        path: `/api/opportunities/${ids.oppRafiqAwarded}/reopen`,
        body: {
          version: await versionOf('opportunities', ids.oppRafiqAwarded),
          stage: 'evaluation',
          reason: 'Appeal.',
          nextFollowUp: { title: 'Restart', dueDate: '2026-10-22' },
        },
      }),
      succeeds: 200,
    },
    {
      name: 'completion, at its replacement',
      actor: 'salesGA1',
      failOn: 'follow_up.created',
      prepare: async () => {
        const task = await openTask(ids.oppRafiq);
        return {
          path: `/api/follow-ups/${task.id}/complete`,
          body: { version: task.version, replacement: { title: 'Next', dueDate: '2026-10-20' } },
        };
      },
      succeeds: 200,
    },
    {
      name: 'contact creation, at its first link',
      actor: 'salesGA1',
      failOn: 'contact.linked',
      prepare: async () => ({
        path: '/api/contacts',
        body: { organizationId: ids.orgSylvanHills, fullName: 'Never Orphaned', designation: 'Officer', opportunityId: ids.oppRafiq },
      }),
      succeeds: 201,
    },
    {
      name: 'activity, at its next follow-up',
      actor: 'salesGA1',
      failOn: 'follow_up.created',
      prepare: async () => ({
        path: `/api/opportunities/${ids.oppRafiq}/activities`,
        body: { type: 'meeting', occurredAt: EARLIER, subject: 'Workshop', nextFollowUp: { title: 'Notes', dueDate: '2026-10-08' } },
      }),
      succeeds: 201,
    },
    {
      name: 'new tender, after superseding the current one',
      actor: 'salesGA1',
      failOn: 'tender.created',
      prepare: async () => ({
        path: `/api/opportunities/${ids.oppRafiqTender}/tenders`,
        body: { ...newerNotice, title: 'Atomic notice', reference: 'SH/A/1' },
      }),
      succeeds: 201,
    },
    {
      name: 'bid submission, at the accepted stage change',
      actor: 'salesGA1',
      failOn: 'opportunity.stage_changed',
      prepare: async () => ({
        path: `/api/tenders/${ids.tenderRafiq}/submit`,
        body: { version: await versionOf('tenders', ids.tenderRafiq), submittedAt: EARLIER, moveOpportunityToBidSubmitted: true },
      }),
      succeeds: 200,
    },
    {
      name: 'document finalization, after the revision row',
      actor: 'salesGA1',
      failOn: 'document.uploaded',
      prepare: async (as) => {
        const staged = await stage(await as('salesGA1'), ids.oppRafiq, 'atomic.pdf', PDF).expect(201);
        return { path: `/api/document-uploads/${staged.body.uploadId}/finalize`, body: { category: 'proposal' } };
      },
      succeeds: 201,
    },
    {
      name: 'account creation, at its invitation',
      actor: 'admin',
      failOn: 'account.invitation_issued',
      prepare: async () => ({
        path: '/api/admin/users',
        body: { fullName: 'Atomic Person', email: 'atomic.person@example.com', role: 'sales', sectionId: ids.sectionGA },
      }),
      succeeds: 201,
    },
    {
      name: 'lead replacement, after both role changes and the reporting lines',
      actor: 'admin',
      failOn: 'section.lead_replaced',
      prepare: async () => ({
        path: `/api/admin/sections/${ids.sectionGA}/replace-lead`,
        body: { version: await versionOf('sections', ids.sectionGA), newLeadId: ids.salesGA2, reason: 'Change of lead.' },
      }),
      succeeds: 200,
    },
    {
      name: 'CSV export request',
      actor: 'leadGA',
      failOn: 'report.export_requested',
      prepare: async () => ({ path: '/api/exports', body: { kind: 'pipeline', filters: {} } }),
      succeeds: 202,
    },
  ];

  describe('atomicity: an induced failure leaves no partial business record', () => {
    it.each(failureCases.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
      const as = sessionsFor();
      const client = await as(testCase.actor);
      const request = await testCase.prepare(as);
      const key = nextIdempotencyKey('atomic');

      await installFailureTrigger(testCase.failOn);
      try {
        const before = await fingerprint();
        const failed = await send(client, request.path, request.body, key);
        expect(failed.status).toBe(500);
        expect(JSON.stringify(failed.body)).not.toMatch(/induced failure/);
        // Every table, the idempotency records included: the claim was released.
        expect(await fingerprint()).toEqual(before);
      } finally {
        await dropFailureTrigger();
      }

      // The released key works: a retry is applied, once.
      const retried = await send(client, request.path, request.body, key);
      expect(retried.status, JSON.stringify(retried.body)).toBe(testCase.succeeds);
      const events = await auditFor(retried);
      expect(events.filter((row) => row.action === testCase.failOn).length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 5. BR-090: transfers racing other writes, on separate connections
  // =========================================================================

  describe('BR-090: transfer races with deterministic interleaving', () => {
    async function prepareTwoTasks(rafiq: SignedInClient) {
      const second = await send(rafiq, `/api/opportunities/${ids.oppRafiq}/follow-ups`, {
        title: 'Second task',
        dueDate: '2026-10-12',
        assigneeId: ids.salesGA1,
      });
      expect(second.status).toBe(201);
      return openTask(ids.oppRafiq);
    }

    async function openTasksOf(opportunityId: string) {
      return (
        await owner.query<{ id: string; assigned_user_id: string }>(
          `SELECT id, assigned_user_id FROM follow_ups WHERE opportunity_id = $1 AND state = 'open'`,
          [opportunityId],
        )
      ).rows;
    }

    /** Starts `first`, waits until it is queued, then `second`, then releases the row. */
    async function race(opportunityId: string, first: () => PromiseLike<Response>, second: () => PromiseLike<Response>) {
      const lock = await holdOpportunity(opportunityId);
      let a: Promise<Response> | undefined;
      let b: Promise<Response> | undefined;
      try {
        a = start(first());
        await waitForLockWaiters(1);
        b = start(second());
        await waitForLockWaiters(2);
      } finally {
        await lock.release();
      }
      return [await (a as Promise<Response>), await (b as Promise<Response>)] as const;
    }

    it('transfer first, then the old owner’s completion: 404, and no open task stays with the old owner', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const nadia = await signIn(ctx.app, emails.leadGA);
      const task = await prepareTwoTasks(rafiq);
      const version = await versionOf('opportunities', ids.oppRafiq);

      const [moved, completed] = await race(
        ids.oppRafiq,
        () => send(nadia, `/api/opportunities/${ids.oppRafiq}/transfer`, { version, newOwnerId: ids.salesGA2, reason: 'Race A' }),
        () => send(rafiq, `/api/follow-ups/${task.id}/complete`, { version: task.version }),
      );
      expect(moved.status).toBe(200);
      expect(completed.status).toBe(404);
      expect(await auditFor(completed)).toHaveLength(0);

      const open = await openTasksOf(ids.oppRafiq);
      expect(open.map((row) => row.id)).toContain(task.id);
      for (const row of open) expect(row.assigned_user_id).toBe(ids.salesGA2);
    });

    it('completion first, then the transfer: both apply; the completed task keeps its history', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const nadia = await signIn(ctx.app, emails.leadGA);
      const task = await prepareTwoTasks(rafiq);
      const version = await versionOf('opportunities', ids.oppRafiq);

      const [completed, moved] = await race(
        ids.oppRafiq,
        () => send(rafiq, `/api/follow-ups/${task.id}/complete`, { version: task.version }),
        () => send(nadia, `/api/opportunities/${ids.oppRafiq}/transfer`, { version, newOwnerId: ids.salesGA2, reason: 'Race B' }),
      );
      expect(completed.status).toBe(200);
      expect(moved.status).toBe(200);

      const done = await one<{ state: string; assigned_user_id: string; completed_by: string }>(
        'SELECT state, assigned_user_id, completed_by FROM follow_ups WHERE id = $1',
        [task.id],
      );
      expect(done).toEqual({ state: 'completed', assigned_user_id: ids.salesGA1, completed_by: ids.salesGA1 });
      const open = await openTasksOf(ids.oppRafiq);
      expect(open.length).toBeGreaterThan(0);
      for (const row of open) expect(row.assigned_user_id).toBe(ids.salesGA2);
    });

    it('a lead’s completion queued behind the transfer that reassigned the task is a 409, not an overwrite', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const nadia = await signIn(ctx.app, emails.leadGA);
      const arif = await signIn(ctx.app, emails.management);
      const task = await prepareTwoTasks(rafiq);
      const version = await versionOf('opportunities', ids.oppRafiq);

      const [moved, completed] = await race(
        ids.oppRafiq,
        () => send(arif, `/api/opportunities/${ids.oppRafiq}/transfer`, { version, newOwnerId: ids.salesGA2, reason: 'Race C' }),
        () => send(nadia, `/api/follow-ups/${task.id}/complete`, { version: task.version }),
      );
      expect(moved.status).toBe(200);
      expect(completed.status).toBe(409);
      expect(completed.body.code).toBe('version_conflict');
      const row = await one<{ state: string; assigned_user_id: string }>(
        'SELECT state, assigned_user_id FROM follow_ups WHERE id = $1',
        [task.id],
      );
      expect(row).toEqual({ state: 'open', assigned_user_id: ids.salesGA2 });
    });

    // Every write the previous owner could make, queued behind a transfer
    // that removes their access: each is the standard 404 and writes nothing.
    const oldOwnerWrites: {
      name: string;
      opportunityId: string;
      /** Prepares what the write needs and returns the (not yet started) request. */
      build: (rafiq: SignedInClient) => Promise<() => PromiseLike<Response>>;
    }[] = [
      {
        name: 'basic edit',
        opportunityId: ids.oppRafiq,
        build: async (c) => {
          const version = await versionOf('opportunities', ids.oppRafiq);
          return () => patch(c, `/api/opportunities/${ids.oppRafiq}`, { version, name: 'Late edit' });
        },
      },
      {
        name: 'stage change',
        opportunityId: ids.oppRafiq,
        build: async (c) => {
          const version = await versionOf('opportunities', ids.oppRafiq);
          return () => send(c, `/api/opportunities/${ids.oppRafiq}/stage`, { version, stage: 'awaiting_tender' });
        },
      },
      {
        name: 'follow-up creation',
        opportunityId: ids.oppRafiq,
        build: async (c) => () =>
          send(c, `/api/opportunities/${ids.oppRafiq}/follow-ups`, { title: 'Late task', dueDate: '2026-10-10', assigneeId: ids.salesGA1 }),
      },
      {
        name: 'activity log',
        opportunityId: ids.oppRafiq,
        build: async (c) => () =>
          send(c, `/api/opportunities/${ids.oppRafiq}/activities`, { type: 'other', occurredAt: EARLIER, subject: 'Late note' }),
      },
      {
        name: 'activity amendment',
        opportunityId: ids.oppRafiq,
        build: async (c) => {
          const version = await versionOf('activities', ids.activityRafiqVisit);
          return () => patch(c, `/api/activities/${ids.activityRafiqVisit}`, { version, notes: 'Late amendment' });
        },
      },
      {
        name: 'relationship notes',
        opportunityId: ids.oppRafiq,
        build: async (c) => {
          const link = await liveLink(ids.oppRafiq, ids.contactGolam);
          return () => patch(c, `/api/contact-links/${link.id}`, { version: link.version, relationshipNotes: 'Late note' });
        },
      },
      {
        name: 'contact link',
        opportunityId: ids.oppRafiq,
        build: async (c) => () => send(c, `/api/opportunities/${ids.oppRafiq}/contacts`, { contactId: ids.contactFarzana }),
      },
      {
        name: 'document category',
        opportunityId: ids.oppRafiq,
        build: async (c) => {
          const document = await uploadDocument(c, ids.oppRafiq);
          return () => patch(c, `/api/documents/${document.id}`, { version: document.version, category: 'correspondence' });
        },
      },
      {
        name: 'document finalization',
        opportunityId: ids.oppRafiq,
        build: async (c) => {
          const staged = await stage(c, ids.oppRafiq, 'late.pdf', PDF).expect(201);
          return () => send(c, `/api/document-uploads/${staged.body.uploadId}/finalize`, { category: 'proposal' });
        },
      },
      {
        name: 'tender edit',
        opportunityId: ids.oppRafiqTender,
        build: async (c) => {
          const version = await versionOf('tenders', ids.tenderRafiq);
          return () => patch(c, `/api/tenders/${ids.tenderRafiq}`, { version, bidStatus: 'preparing' });
        },
      },
      {
        name: 'bid submission',
        opportunityId: ids.oppRafiqTender,
        build: async (c) => {
          const version = await versionOf('tenders', ids.tenderRafiq);
          return () =>
            send(c, `/api/tenders/${ids.tenderRafiq}/submit`, { version, submittedAt: EARLIER, moveOpportunityToBidSubmitted: false });
        },
      },
    ];

    it.each(oldOwnerWrites.map((w) => [w.name, w] as const))(
      'the previous owner’s %s, queued behind the transfer, is a 404 that writes nothing (SEC-005)',
      async (_name, write) => {
        const rafiq = await signIn(ctx.app, emails.salesGA1);
        const arif = await signIn(ctx.app, emails.management);
        const late = await write.build(rafiq);
        const version = await versionOf('opportunities', write.opportunityId);

        const [moved, response] = await race(
          write.opportunityId,
          () =>
            send(arif, `/api/opportunities/${write.opportunityId}/transfer`, { version, newOwnerId: ids.salesIS1, reason: 'Race' }),
          late,
        );
        expect(moved.status).toBe(200);
        expect(response.status, JSON.stringify(response.body)).toBe(404);
        expect(withoutRequestId(response)).toEqual(await missingNotFound(rafiq));
        expect(await auditFor(response)).toHaveLength(0);
      },
    );
  });

  describe('ADR 0004: an administrator who loses the role while a change waits', () => {
    it.each([
      ['creating a section', (admin: SignedInClient) => send(admin, '/api/admin/sections', { name: 'Late Section' })],
      [
        'creating an account',
        (admin: SignedInClient) =>
          send(admin, '/api/admin/users', { fullName: 'Late Person', email: 'late.person@example.com', role: 'sales', sectionId: ids.sectionGA }),
      ],
      ['issuing a sign-in link', (admin: SignedInClient) => send(admin, `/api/admin/users/${ids.salesGA2}/link`, {})],
    ] as const)('is refused when %s, and nothing is written', async (_label, run) => {
      const admin = await signIn(ctx.app, emails.admin);
      // Another administrator's deactivation of this account is mid-commit.
      const blocker = await ctx.database.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query('UPDATE users SET active = false WHERE id = $1', [ids.admin]);
        pending = start(run(admin));
        await waitForLockWaiters(1);
        await blocker.query('COMMIT');
      } catch (error) {
        await blocker.query('ROLLBACK');
        throw error;
      } finally {
        blocker.release();
      }
      const before = await fingerprint();
      const response = await (pending as Promise<Response>);
      expect(response.status, JSON.stringify(response.body)).toBe(403);
      expect(await auditFor(response)).toHaveLength(0);
      expect(await fingerprint()).toEqual(before);
    });
  });

  // =========================================================================
  // 6. SEC-005: a transfer removes the previous team's access on every channel
  // =========================================================================

  describe('SEC-005: transfer revokes old access across every implemented channel', () => {
    it('the previous owner and lead lose the record, its children, contacts, files, alerts and exports at once', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const nadia = await signIn(ctx.app, emails.leadGA);
      const arif = await signIn(ctx.app, emails.management);
      const imran = await signIn(ctx.app, emails.salesIS1);

      // Before: a document, an alert and a prepared export, all reachable.
      const document = await uploadDocument(rafiq, ids.oppRafiq);
      expect(document.latest.scanState).toBe('clean');
      const revisionPath = `/api/document-revisions/${document.latest.id}/download`;
      await rafiq.agent.get(revisionPath).expect(200);

      await send(rafiq, `/api/opportunities/${ids.oppRafiq}/follow-ups`, {
        title: 'Due today',
        dueDate: TODAY,
        assigneeId: ids.salesGA1,
      }).expect(201);
      await runNotificationScan(ctx.database.db);
      const alertsFor = async (client: SignedInClient) =>
        ((await client.agent.get('/api/notifications').query({ pageSize: 100 }).expect(200)).body.items as { path: string }[]).filter(
          (item) => item.path.includes(ids.oppRafiq),
        );
      const unread = async (client: SignedInClient) =>
        (await client.agent.get('/api/notifications/unread-count').expect(200)).body.unreadCount as number;
      expect(await alertsFor(rafiq)).not.toHaveLength(0);
      expect(await alertsFor(nadia)).not.toHaveLength(0);
      const rafiqUnread = await unread(rafiq);

      const requested = await send(rafiq, '/api/exports', { kind: 'opportunities', filters: {} }).expect(202);
      await runDueJobs(ctx.database.db, createJobHandlers(ctx.database.db, { exportTtlHours: 24, exportMaxRows: 50_000 }));
      expect((await rafiq.agent.get(`/api/exports/${requested.body.id}`).expect(200)).body.status).toBe('ready');

      const searchFor = async (client: SignedInClient) =>
        JSON.stringify((await client.agent.get('/api/search').query({ q: 'Municipal Service' }).expect(200)).body);
      expect(await searchFor(rafiq)).toContain(ids.oppRafiq);

      // Management moves the record to Imran in Infrastructure and Security.
      await send(arif, `/api/opportunities/${ids.oppRafiq}/transfer`, {
        version: await versionOf('opportunities', ids.oppRafiq),
        newOwnerId: ids.salesIS1,
        reason: 'Cross-section transfer.',
      }).expect(200);

      const missing = await missingNotFound(rafiq);
      const task = await openTask(ids.oppRafiq);
      const objectReads = [
        `/api/opportunities/${ids.oppRafiq}`,
        `/api/opportunities/${ids.oppRafiq}/follow-ups`,
        `/api/opportunities/${ids.oppRafiq}/history`,
        `/api/opportunities/${ids.oppRafiq}/activities`,
        `/api/opportunities/${ids.oppRafiq}/contacts`,
        `/api/opportunities/${ids.oppRafiq}/documents`,
        `/api/opportunities/${ids.oppRafiq}/tenders`,
        `/api/opportunities/${ids.oppRafiq}/follow-up-assignees`,
        `/api/contacts/${ids.contactLaila}`,
        `/api/contacts/${ids.contactGolam}`,
        `/api/documents/${document.id}`,
        revisionPath,
      ];
      for (const client of [rafiq, nadia]) {
        for (const path of objectReads) {
          const response = await client.agent.get(path);
          expect(response.status, path).toBe(404);
          expect(withoutRequestId(response), path).toEqual(missing);
        }
        // Collections, search and alerts no longer mention it.
        const list = JSON.stringify((await client.agent.get('/api/opportunities').query({ pageSize: 100 }).expect(200)).body);
        expect(list).not.toContain(ids.oppRafiq);
        const contacts = JSON.stringify((await client.agent.get('/api/contacts').query({ pageSize: 100 }).expect(200)).body);
        expect(contacts).not.toContain(ids.contactLaila);
        expect(await searchFor(client)).not.toContain(ids.oppRafiq);
        expect(await alertsFor(client)).toHaveLength(0);
        const followUps = JSON.stringify((await client.agent.get('/api/follow-ups').query({ view: 'all', pageSize: 100 }).expect(200)).body);
        expect(followUps).not.toContain(ids.oppRafiq);
      }
      expect(await unread(rafiq)).toBeLessThan(rafiqUnread);

      // Writes through old ids are the same 404.
      const writes = [
        await patch(rafiq, `/api/activities/${ids.activityRafiqVisit}`, { version: await versionOf('activities', ids.activityRafiqVisit), notes: 'x' }),
        await send(rafiq, `/api/follow-ups/${task.id}/reschedule`, { version: task.version, dueDate: '2026-12-01', reason: 'Later.' }),
        await patch(rafiq, `/api/documents/${document.id}`, { version: document.version, category: 'correspondence' }),
      ];
      for (const response of writes) expect(withoutRequestId(response)).toEqual(missing);

      // The export prepared before the transfer is no longer delivered.
      const download = await rafiq.agent.get(`/api/exports/${requested.body.id}/download`);
      expect(download.status).toBe(409);
      expect(download.text).not.toContain('Municipal Service Portal');

      // The new owner has it all, without anything being copied.
      await imran.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200);
      await imran.agent.get(revisionPath).expect(200);
      await imran.agent.get(`/api/contacts/${ids.contactLaila}`).expect(200);
      const history = (await imran.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).query({ pageSize: 100 }).expect(200)).body
        .items as { action: string; actorName: string }[];
      // SEC-012: earlier authors are preserved in the history that moved with the record.
      expect(history.some((entry) => entry.actorName === 'Rafiq Hasan' && entry.action === 'document.uploaded')).toBe(true);
      const actions = history.map((entry) => entry.action);
      // Newest first: the transfer (with its task reassignment) above the older work.
      expect(actions.indexOf('opportunity.transferred')).toBeGreaterThanOrEqual(0);
      expect(actions.indexOf('opportunity.transferred')).toBeLessThan(actions.indexOf('document.uploaded'));
    });
  });

  // =========================================================================
  // 7. SEC-012: bounded, paginated, correctly scoped history views
  // =========================================================================

  describe('SEC-012: history views', () => {
    it('pages commercial history completely and stably, even when every event shares one timestamp', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      for (let index = 0; index < 23; index += 1) {
        await patch(rafiq, `/api/opportunities/${ids.oppRafiq}`, {
          version: await versionOf('opportunities', ids.oppRafiq),
          name: `Municipal Service Portal, edit ${index}`,
        }).expect(200);
      }
      const expected = (
        await owner.query<{ id: string }>(
          `SELECT id FROM audit_events WHERE opportunity_id = $1 AND domain = 'commercial' ORDER BY occurred_at DESC, sequence DESC`,
          [ids.oppRafiq],
        )
      ).rows.map((row) => row.id);
      expect(expected.length).toBeGreaterThanOrEqual(23);

      const seen: string[] = [];
      for (let page = 1; ; page += 1) {
        const body = (await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).query({ page, pageSize: 7 }).expect(200)).body;
        expect(body.total).toBe(expected.length);
        if (body.items.length === 0) break;
        expect(body.items.length).toBeLessThanOrEqual(7);
        seen.push(...body.items.map((item: { id: string }) => item.id));
      }
      // Every event exactly once, newest first in append order.
      expect(seen).toEqual(expected);
    });

    it.each([
      ['a page size above 100', { pageSize: '101' }],
      ['page zero', { page: '0' }],
      ['a non-numeric page size', { pageSize: 'all' }],
      ['an unknown parameter', { domain: 'administrative' }],
    ])('refuses %s with 422', async (_label, query) => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const admin = await signIn(ctx.app, emails.admin);
      expect((await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).query(query)).status).toBe(422);
      expect((await admin.agent.get('/api/admin/audit').query(query)).status).toBe(422);
    });

    it('scopes commercial history to the opportunity: others, and the administrator, get the standard 404', async () => {
      const missing = await missingNotFound(await signIn(ctx.app, emails.salesGA1));
      for (const who of ['salesGA2', 'salesIS1', 'leadIS', 'admin'] as const) {
        const client = await signIn(ctx.app, emails[who]);
        const response = await client.agent.get(`/api/opportunities/${ids.oppRafiq}/history`);
        expect(response.status, who).toBe(404);
        expect(withoutRequestId(response)).toEqual(missing);
      }
      for (const who of ['salesGA1', 'leadGA', 'management'] as const) {
        const client = await signIn(ctx.app, emails[who]);
        await client.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);
      }
    });

    it('keeps directory, reporting and administrative events out of commercial history', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const admin = await signIn(ctx.app, emails.admin);
      await send(rafiq, '/api/contacts', {
        organizationId: ids.orgSylvanHills,
        fullName: 'Directory Person',
        designation: 'Officer',
        opportunityId: ids.oppRafiq,
      }).expect(201);
      await send(rafiq, '/api/exports', { kind: 'opportunities', filters: {} }).expect(202);
      await patch(admin, `/api/admin/users/${ids.salesGA1}`, { version: await versionOf('users', ids.salesGA1), fullName: 'Rafiq Hasan Khan' }).expect(200);

      const nadia = await signIn(ctx.app, emails.leadGA);
      const items = (await nadia.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).query({ pageSize: 100 }).expect(200)).body
        .items as { action: string }[];
      const actions = items.map((item) => item.action);
      expect(actions).toContain('contact.linked');
      expect(actions.filter((action) => /^(contact\.created|report\.|account\.|section\.)/.test(action))).toEqual([]);
    });

    it('restricts the administrative audit to administrators, and pages it stably', async () => {
      for (const who of ['management', 'leadGA', 'salesGA1'] as const) {
        const client = await signIn(ctx.app, emails[who]);
        expect((await client.agent.get('/api/admin/audit')).status, who).toBe(403);
      }

      const admin = await signIn(ctx.app, emails.admin);
      for (let index = 0; index < 12; index += 1) await createSection(admin, `Paged Section ${index}`);
      const expected = (
        await owner.query<{ id: string }>(
          `SELECT id FROM audit_events WHERE domain = 'administrative' ORDER BY occurred_at DESC, sequence DESC`,
        )
      ).rows.map((row) => row.id);

      const seen: string[] = [];
      for (let page = 1; ; page += 1) {
        const body = (await admin.agent.get('/api/admin/audit').query({ page, pageSize: 5 }).expect(200)).body;
        expect(body.total).toBe(expected.length);
        if (body.items.length === 0) break;
        for (const item of body.items as { action: string }[]) expect(item.action).toMatch(/^(account|section)\./);
        seen.push(...body.items.map((item: { id: string }) => item.id));
      }
      expect(seen).toEqual(expected);
    });
  });

  // =========================================================================
  // 8. SEC-012: the runtime role cannot alter or remove audit events
  // =========================================================================

  describe('SEC-012: append-only audit for the runtime role', () => {
    it('has SELECT and INSERT on audit_events and nothing else, at table or column level', async () => {
      const { rows } = await ctx.database.pool.query(`
        SELECT has_table_privilege(current_user, 'audit_events', 'SELECT') AS select,
               has_table_privilege(current_user, 'audit_events', 'INSERT') AS insert,
               has_table_privilege(current_user, 'audit_events', 'UPDATE') AS update,
               has_table_privilege(current_user, 'audit_events', 'DELETE') AS delete,
               has_table_privilege(current_user, 'audit_events', 'TRUNCATE') AS truncate,
               has_table_privilege(current_user, 'audit_events', 'TRIGGER') AS trigger,
               has_table_privilege(current_user, 'audit_events', 'REFERENCES') AS references,
               has_any_column_privilege(current_user, 'audit_events', 'UPDATE') AS column_update`);
      expect(rows[0]).toEqual({
        select: true,
        insert: true,
        update: false,
        delete: false,
        truncate: false,
        trigger: false,
        references: false,
        column_update: false,
      });
    });

    it('is not a superuser, owns nothing it could alter, and cannot assume the owner role', async () => {
      const { rows } = await ctx.database.pool.query(`
        SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
               pg_has_role(current_user, t.tableowner, 'USAGE') AS owner_usage,
               pg_has_role(current_user, t.tableowner, 'MEMBER') AS owner_member
          FROM pg_roles r, pg_tables t
         WHERE r.rolname = current_user AND t.schemaname = 'public' AND t.tablename = 'audit_events'`);
      expect(rows[0]).toEqual({
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
        owner_usage: false,
        owner_member: false,
      });
      await expect(ctx.database.pool.query('ALTER TABLE audit_events DISABLE TRIGGER ALL')).rejects.toThrow(/owner|permission/i);
    });

    it('cannot erase history by deleting the records it refers to', async () => {
      const before = await auditCount();
      const error = await ctx.database.pool.query('DELETE FROM opportunities WHERE id = $1', [ids.oppRafiq]).catch((e: unknown) => e);
      // 23001 restrict_violation / 23503 foreign_key_violation: audit rows pin their records.
      expect(['23001', '23503']).toContain((error as { code?: string }).code);
      const actor = await ctx.database.pool.query('DELETE FROM users WHERE id = $1', [ids.salesGA1]).catch((e: unknown) => e);
      expect(['23001', '23503']).toContain((actor as { code?: string }).code);
      expect(await auditCount()).toBe(before);
    });

    it('cannot set or rewrite the append order', async () => {
      await expect(
        ctx.database.pool.query(
          `INSERT INTO audit_events (entity_type, entity_id, action, request_id, sequence)
           VALUES ('test', $1, 'test.forged', 'm7', 1)`,
          [ABSENT_UUID],
        ),
      ).rejects.toThrow(/GENERATED ALWAYS|cannot insert/i);
      await expect(ctx.database.pool.query('UPDATE audit_events SET sequence = 1')).rejects.toThrow(
        /permission denied|can only be updated to DEFAULT/i,
      );
    });
  });
});
