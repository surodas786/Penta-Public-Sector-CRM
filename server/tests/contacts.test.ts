/**
 * Milestone 4: contacts and their opportunity links (FR-032, FR-033, BR-020,
 * BR-021, SEC-004) and the contact portion of AT-08.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEvents, contacts, opportunities, opportunityContacts } from '../db/schema.js';
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

/** The demo notes the seed placed on each shared contact's first link. */
const FARZANA_P2_NOTE = 'Executive sponsor for ERP and eLearning initiatives.';
const GOLAM_P1_NOTE = 'Final approver for city digital projects.';
const REZAUL_P7_NOTE = 'Engaged across archive, data centre and cloud programmes.';

describe('contacts and links', () => {
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

  async function contactRow(id: string) {
    const [row] = await ctx.database.db.select().from(contacts).where(eq(contacts.id, id));
    return row!;
  }

  async function liveLinks(contactId: string) {
    return ctx.database.db
      .select()
      .from(opportunityContacts)
      .where(and(eq(opportunityContacts.contactId, contactId), isNull(opportunityContacts.removedAt)));
  }

  const linkedOpportunities = (body: { links: { opportunity: { id: string } }[] }) =>
    body.links.map((link) => link.opportunity.id).sort();

  // -------------------------------------------------------------------------
  describe('visibility through accessible links only (SEC-004, BR-020)', () => {
    it('shows a salesperson only the contacts on their own records', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const list = await rafiq.agent.get('/api/contacts').query({ pageSize: 100 }).expect(200);
      const visible = list.body.items.map((item: { id: string }) => item.id);
      expect(visible).toEqual(expect.arrayContaining([ids.contactGolam, ids.contactLaila, ids.contactFarzana]));
      expect(visible).not.toContain(ids.contactRezaul);
      expect(list.body.total).toBe(visible.length);
    });

    it('returns only the caller’s link and notes on a contact shared within a section', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await rafiq.agent.get(`/api/contacts/${ids.contactFarzana}`).expect(200);

      expect(linkedOpportunities(response.body)).toEqual([ids.oppRafiqTraining]);
      expect(response.body.accessibleLinks).toBe(1);
      // Tasnia's link and its note are neither returned nor counted.
      expect(JSON.stringify(response.body)).not.toContain(FARZANA_P2_NOTE);
      expect(JSON.stringify(response.body)).not.toContain(ids.oppTasnia);
      expect(response.body.canEditIdentity).toBe(false);

      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const hers = await tasnia.agent.get(`/api/contacts/${ids.contactFarzana}`).expect(200);
      expect(linkedOpportunities(hers.body)).toEqual([ids.oppTasnia]);
      expect(hers.body.links[0].relationshipNotes).toBe(FARZANA_P2_NOTE);
    });

    it('shows a contact shared across sections to each lead with only their section’s links', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const ga = await nadia.agent.get(`/api/contacts/${ids.contactRezaul}`).expect(200);
      expect(linkedOpportunities(ga.body)).toEqual([ids.oppNadia]);
      expect(ga.body.links[0].relationshipNotes).toBe(REZAUL_P7_NOTE);
      expect(ga.body.canEditIdentity).toBe(false);

      const farhan = await signIn(ctx.app, emails.leadIS);
      const is = await farhan.agent.get(`/api/contacts/${ids.contactRezaul}`).expect(200);
      expect(is.body.links.every((link: { opportunity: { sectionName: string } }) => link.opportunity.sectionName === 'Infrastructure & Security')).toBe(true);
      expect(JSON.stringify(is.body)).not.toContain(REZAUL_P7_NOTE);
      expect(JSON.stringify(is.body)).not.toContain(ids.oppNadia);

      const arif = await signIn(ctx.app, emails.management);
      const all = await arif.agent.get(`/api/contacts/${ids.contactRezaul}`).expect(200);
      expect(all.body.links).toHaveLength(3);
      expect(all.body.canEditIdentity).toBe(true);
    });

    it('answers an invisible contact exactly like a missing one', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const hidden = await rafiq.agent.get(`/api/contacts/${ids.contactRezaul}`);
      const missing = await rafiq.agent.get(`/api/contacts/${ABSENT_UUID}`);
      expect(hidden.status).toBe(404);
      const strip = ({ requestId: _requestId, ...rest }: Record<string, unknown>) => rest;
      expect(strip(hidden.body)).toEqual(strip(missing.body));
    });

    it('gives the administrator no contacts at all', async () => {
      const admin = await signIn(ctx.app, emails.admin);
      await admin.agent.get('/api/contacts').expect(403);
      await admin.agent.get(`/api/contacts/${ids.contactGolam}`).expect(404);
      await admin.agent.get(`/api/opportunities/${ids.oppRafiq}/contacts`).expect(404);
    });

    it('lists an opportunity’s contacts with that link’s notes', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/contacts`).expect(200);
      const golam = response.body.items.find((item: { contact: { id: string } }) => item.contact.id === ids.contactGolam);
      expect(golam.relationshipNotes).toBe(GOLAM_P1_NOTE);
      await rafiq.agent.get(`/api/opportunities/${ids.oppTasnia}/contacts`).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('creating and linking (BR-020)', () => {
    it('creates a contact with its first link, in Bangla, and finds it by Bangla search', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const key = nextIdempotencyKey('contact');
      const body = {
        organizationId: ids.orgSylvanHills,
        fullName: 'মোঃ রফিকুল ইসলাম',
        designation: 'উপসচিব (আইসিটি)',
        department: 'আইসিটি সেল',
        email: 'Rafiqul.Islam@Example.com',
        phone: '+880 1700-000999',
        opportunityId: ids.oppRafiq,
        relationshipNotes: 'নাগরিক সেবা পোর্টালের প্রধান সমন্বয়ক।',
      };
      const created = await send(rafiq, '/api/contacts', body, key);
      expect(created.status).toBe(201);
      expect(created.body.fullName).toBe('মোঃ রফিকুল ইসলাম');
      expect(created.body.email).toBe('rafiqul.islam@example.com');
      expect(created.body.phone).toBe('+880 1700-000999');
      expect(created.body.links[0].relationshipNotes).toBe('নাগরিক সেবা পোর্টালের প্রধান সমন্বয়ক।');

      // A retry creates nothing new.
      const retry = await send(rafiq, '/api/contacts', body, key);
      expect(retry.status).toBe(200);
      expect(retry.body.id).toBe(created.body.id);
      expect(await liveLinks(created.body.id)).toHaveLength(1);

      const search = await rafiq.agent.get('/api/contacts').query({ q: 'রফিকুল' }).expect(200);
      expect(search.body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id]);

      const history = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);
      const linked = history.body.items.find((entry: { action: string }) => entry.action === 'contact.linked');
      expect(linked.subject).toBe('মোঃ রফিকুল ইসলাম');
    });

    it('refuses to create a contact on someone else’s record, writing nothing', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const before = (await ctx.database.db.select().from(contacts)).length;
      const response = await send(rafiq, '/api/contacts', {
        organizationId: ids.orgSylvanHills,
        fullName: 'Nobody Here',
        designation: 'Officer',
        opportunityId: ids.oppTasnia,
      });
      expect(response.status).toBe(404);
      expect((await ctx.database.db.select().from(contacts)).length).toBe(before);
    });

    it('links a visible contact, refuses an invisible one, and refuses a duplicate', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const linked = await send(rafiq, `/api/opportunities/${ids.oppRafiqTender}/contacts`, {
        contactId: ids.contactGolam,
        relationshipNotes: 'Also approves the records system.',
      });
      expect(linked.status).toBe(201);
      expect(linked.body.relationshipNotes).toBe('Also approves the records system.');

      const invisible = await send(rafiq, `/api/opportunities/${ids.oppRafiqTender}/contacts`, { contactId: ids.contactRezaul });
      expect(invisible.status).toBe(404);

      const duplicate = await send(rafiq, `/api/opportunities/${ids.oppRafiq}/contacts`, { contactId: ids.contactGolam });
      expect(duplicate.status).toBe(409);
    });

    it('rejects invalid contact details with field errors', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await send(rafiq, '/api/contacts', {
        organizationId: ids.orgSylvanHills,
        fullName: 'X',
        designation: '',
        email: 'not-an-email',
        phone: 'call me',
        opportunityId: ids.oppRafiq,
      });
      expect(response.status).toBe(422);
      expect(Object.keys(response.body.fieldErrors)).toEqual(expect.arrayContaining(['fullName', 'designation', 'email', 'phone']));
    });
  });

  // -------------------------------------------------------------------------
  describe('editing (BR-021)', () => {
    it('lets anyone with the link edit its notes, but only someone who sees every link edit identity', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const contact = await contactRow(ids.contactFarzana);

      const identity = await patch(rafiq, `/api/contacts/${ids.contactFarzana}`, { version: contact.version, designation: 'Secretary' });
      expect(identity.status).toBe(403);
      expect(identity.body.message).toMatch(/management/);
      expect((await contactRow(ids.contactFarzana)).designation).toBe('Director General');

      const [link] = (await liveLinks(ids.contactFarzana)).filter((row) => row.opportunityId === ids.oppRafiqTraining);
      const notes = await patch(rafiq, `/api/contact-links/${link!.id}`, { version: link!.version, relationshipNotes: 'Prefers a phone call first.' });
      expect(notes.status).toBe(200);
      expect(notes.body.relationshipNotes).toBe('Prefers a phone call first.');
      // Tasnia's note on her link is untouched.
      const [hers] = (await liveLinks(ids.contactFarzana)).filter((row) => row.opportunityId === ids.oppTasnia);
      expect(hers!.relationshipNotes).toBe(FARZANA_P2_NOTE);

      // The section lead sees both links, so may correct the shared identity.
      const nadia = await signIn(ctx.app, emails.leadGA);
      const corrected = await patch(nadia, `/api/contacts/${ids.contactFarzana}`, { version: contact.version, designation: 'Secretary' });
      expect(corrected.status).toBe(200);
      expect(corrected.body.designation).toBe('Secretary');

      const stale = await patch(nadia, `/api/contacts/${ids.contactFarzana}`, { version: contact.version, designation: 'Again' });
      expect(stale.status).toBe(409);
    });

    it('refuses to edit a link the caller cannot see', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const [hers] = (await liveLinks(ids.contactFarzana)).filter((row) => row.opportunityId === ids.oppTasnia);
      const response = await patch(rafiq, `/api/contact-links/${hers!.id}`, { version: hers!.version, relationshipNotes: 'overwrite' });
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('removing links and archiving (FR-033)', () => {
    it('removes a link but never a contact’s last one', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const [only] = await liveLinks(ids.contactLaila);
      const last = await send(rafiq, `/api/contact-links/${only!.id}/remove`, { version: only!.version });
      expect(last.status).toBe(409);
      expect(last.body.message).toMatch(/archive/);

      await send(rafiq, `/api/opportunities/${ids.oppRafiqTender}/contacts`, { contactId: ids.contactLaila }).expect(201);
      const removed = await send(rafiq, `/api/contact-links/${only!.id}/remove`, { version: only!.version, reason: 'Moved off the portal project' });
      expect(removed.status).toBe(204);
      expect(await liveLinks(ids.contactLaila)).toHaveLength(1);
      // Kept, marked removed, with its notes.
      const [kept] = await ctx.database.db.select().from(opportunityContacts).where(eq(opportunityContacts.id, only!.id));
      expect(kept!.removedAt).not.toBeNull();
    });

    it('lets only one of two simultaneous removals take the last two links', async () => {
      for (let round = 0; round < 4; round += 1) {
        await resetFixtures();
        const rafiq = await signIn(ctx.app, emails.salesGA1);
        await send(rafiq, `/api/opportunities/${ids.oppRafiqTender}/contacts`, { contactId: ids.contactLaila }).expect(201);
        const [a, b] = await liveLinks(ids.contactLaila);
        const results = await Promise.all([
          send(rafiq, `/api/contact-links/${a!.id}/remove`, { version: a!.version }),
          send(rafiq, `/api/contact-links/${b!.id}/remove`, { version: b!.version }),
        ]);
        expect(results.map((response) => response.status).sort()).toEqual([204, 409]);
        expect(await liveLinks(ids.contactLaila)).toHaveLength(1);
      }
    });

    it('archives a contact for management only; it then leaves lists and cannot be linked', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const contact = await contactRow(ids.contactLaila);
      expect((await send(nadia, `/api/contacts/${ids.contactLaila}/archive`, { version: contact.version, reason: 'Retired' })).status).toBe(403);

      const arif = await signIn(ctx.app, emails.management);
      const archived = await send(arif, `/api/contacts/${ids.contactLaila}/archive`, { version: contact.version, reason: 'Retired from the City Corporation' });
      expect(archived.status).toBe(200);
      expect(archived.body.archived).toBe(true);

      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const list = await rafiq.agent.get('/api/contacts').query({ pageSize: 100 }).expect(200);
      expect(list.body.items.map((item: { id: string }) => item.id)).not.toContain(ids.contactLaila);
      const link = await send(rafiq, `/api/opportunities/${ids.oppRafiqTender}/contacts`, { contactId: ids.contactLaila });
      expect(link.status).toBe(409);
      // Its history stays readable through the link.
      await rafiq.agent.get(`/api/contacts/${ids.contactLaila}`).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('AT-08 contact portion: transfers move contact visibility with the record', () => {
    it('shows the new owner only their permitted link on a contact shared within the old section', async () => {
      const arif = await signIn(ctx.app, emails.management);
      const [p8] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiqTraining));
      await send(arif, `/api/opportunities/${ids.oppRafiqTraining}/transfer`, {
        version: p8!.version,
        newOwnerId: ids.salesIS1,
        reason: 'eLearning now delivered by Infrastructure & Security',
      }).expect(200);

      const imran = await signIn(ctx.app, emails.salesIS1);
      const his = await imran.agent.get(`/api/contacts/${ids.contactFarzana}`).expect(200);
      expect(linkedOpportunities(his.body)).toEqual([ids.oppRafiqTraining]);
      expect(JSON.stringify(his.body)).not.toContain(FARZANA_P2_NOTE);

      // The old owner loses the contact (it was visible only through p8).
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      await rafiq.agent.get(`/api/contacts/${ids.contactFarzana}`).expect(404);

      // The old section lead still sees Tasnia's link, and no longer p8's.
      const nadia = await signIn(ctx.app, emails.leadGA);
      const lead = await nadia.agent.get(`/api/contacts/${ids.contactFarzana}`).expect(200);
      expect(linkedOpportunities(lead.body)).toEqual([ids.oppTasnia]);
    });

    it('gives the new owner the transferred link’s notes and the old team nothing', async () => {
      const arif = await signIn(ctx.app, emails.management);
      const [p1] = await ctx.database.db.select().from(opportunities).where(eq(opportunities.id, ids.oppRafiq));
      await send(arif, `/api/opportunities/${ids.oppRafiq}/transfer`, {
        version: p1!.version,
        newOwnerId: ids.salesIS1,
        reason: 'Consolidating Sylvan Hills under one owner',
      }).expect(200);

      const imran = await signIn(ctx.app, emails.salesIS1);
      const golam = await imran.agent.get(`/api/contacts/${ids.contactGolam}`).expect(200);
      expect(linkedOpportunities(golam.body)).toEqual([ids.oppRafiq, ids.oppImranLost].sort());
      const p1Link = golam.body.links.find((link: { opportunity: { id: string } }) => link.opportunity.id === ids.oppRafiq);
      expect(p1Link.relationshipNotes).toBe(GOLAM_P1_NOTE);
      expect(golam.body.canEditIdentity).toBe(true);

      for (const email of [emails.salesGA1, emails.leadGA]) {
        const client = await signIn(ctx.app, email);
        await client.agent.get(`/api/contacts/${ids.contactGolam}`).expect(404);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('audit', () => {
    it('records link events in commercial history and identity events in the directory domain', async () => {
      const nadia = await signIn(ctx.app, emails.leadGA);
      const contact = await contactRow(ids.contactFarzana);
      await patch(nadia, `/api/contacts/${ids.contactFarzana}`, { version: contact.version, phone: '+880 1711-000106' }).expect(200);

      const [event] = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, ids.contactFarzana), eq(auditEvents.action, 'contact.updated')));
      expect(event!.domain).toBe('directory');
      expect(event!.opportunityId).toBeNull();
      expect((event!.afterData as Record<string, unknown>).phone).toBe('+880 1711-000106');
    });
  });
});
