/**
 * Milestone 6: scoped search (FR-091, SEC-002, AT-02, AT-14).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SearchResponseDto } from '../../shared/api.js';
import {
  createTestApp,
  emails,
  ids,
  nextIdempotencyKey,
  resetFixtures,
  send,
  signIn,
  startSession,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

describe('scoped search (M6)', () => {
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

  const as = (email: string) => signIn(ctx.app, email);

  async function search(client: SignedInClient, q: string, extra = ''): Promise<SearchResponseDto> {
    return (await client.agent.get(`/api/search?q=${encodeURIComponent(q)}${extra}`).expect(200)).body as SearchResponseDto;
  }

  function titles(response: SearchResponseDto, type: string): string[] {
    return response.groups.find((group) => group.type === type)?.items.map((item) => item.title) ?? [];
  }

  function total(response: SearchResponseDto, type: string): number {
    return response.groups.find((group) => group.type === type)?.total ?? 0;
  }

  it('returns only accessible opportunities, with matching totals', async () => {
    // "Portal" matches Municipal Service Portal (Rafiq, GA) and others across sections.
    const management = await search(await as(emails.management), 'OPP-9000');
    const lead = await search(await as(emails.leadGA), 'OPP-9000');
    const rafiq = await search(await as(emails.salesGA1), 'OPP-9000');
    expect(total(management, 'opportunity')).toBe(23);
    expect(total(lead, 'opportunity')).toBe(13);
    expect(total(rafiq, 'opportunity')).toBe(5);
    // Bounded: at most five per type in the suggestions.
    expect(management.groups.find((group) => group.type === 'opportunity')?.items).toHaveLength(5);
  });

  it('never reveals another salesperson’s or another section’s record names (AT-02, AT-03)', async () => {
    const tasniaRecord = 'Public Training Institute ERP';
    const rafiq = await search(await as(emails.salesGA1), 'Public Training Institute ERP');
    expect(JSON.stringify(rafiq.groups)).not.toContain(tasniaRecord);
    expect(total(rafiq, 'opportunity')).toBe(0);
    // Its tender reference is hidden too.
    const tenders = await search(await as(emails.salesGA1), 'DPTI/ICT/2026/014');
    expect(total(tenders, 'tender')).toBe(0);
    expect(JSON.stringify(tenders.groups)).not.toContain('DPTI/ICT/2026/014');

    const leadIS = await search(await as(emails.leadIS), 'Municipal Service');
    expect(titles(leadIS, 'opportunity')).toEqual([]);
    const leadGA = await search(await as(emails.leadGA), 'Municipal Service');
    expect(titles(leadGA, 'opportunity')).toEqual(['Municipal Service Portal']);
  });

  it('finds permitted contacts only, with a safe summary', async () => {
    // Golam Mostafa is linked to OPP-900001 (Rafiq, GA) and OPP-900017 (Imran, IS).
    const rafiq = await search(await as(emails.salesGA1), 'Golam');
    expect(titles(rafiq, 'contact')).toEqual(['Golam Mostafa']);
    const contact = rafiq.groups.find((group) => group.type === 'contact')?.items[0];
    expect(contact?.summary).not.toMatch(/@|\d{5,}/);
    expect(contact?.path).toBe(`/contacts/${ids.contactGolam}`);

    // Laila is linked to OPP-900001 only: Tasnia cannot find her.
    const tasnia = await search(await as(emails.salesGA2), 'Laila');
    expect(total(tasnia, 'contact')).toBe(0);
    expect(JSON.stringify(tasnia.groups)).not.toContain('Laila');
  });

  it('removes results when a transfer revokes access (SEC-005)', async () => {
    const lead = await as(emails.leadGA);
    const detail = (await lead.agent.get(`/api/opportunities/${ids.oppRafiq}`).expect(200)).body;
    await send(
      lead,
      `/api/opportunities/${ids.oppRafiq}/transfer`,
      { version: detail.version, newOwnerId: ids.salesGA2, reason: 'Rebalance' },
      nextIdempotencyKey('m6'),
    ).expect(200);
    const rafiq = await search(await as(emails.salesGA1), 'Municipal Service');
    expect(total(rafiq, 'opportunity')).toBe(0);
    const laila = await search(await as(emails.salesGA1), 'Laila');
    expect(total(laila, 'contact')).toBe(0);
    const tasnia = await search(await as(emails.salesGA2), 'Municipal Service');
    expect(titles(tasnia, 'opportunity')).toEqual(['Municipal Service Portal']);
  });

  it('searches the shared organization directory for every sales role', async () => {
    const rafiq = await search(await as(emails.salesGA1), 'Sylvan');
    expect(titles(rafiq, 'organization')).toContain('Sylvan Hills City Corporation');
    const summary = rafiq.groups.find((group) => group.type === 'organization')?.items[0]?.summary ?? '';
    expect(summary).not.toMatch(/opportunit/i);
  });

  it('handles Bangla and treats wildcard characters literally', async () => {
    // OPP-900023 (Mehjabin, GA) and its procuring organization have Bangla names.
    const lead = await search(await as(emails.leadGA), 'পল্লী উন্নয়ন');
    expect(titles(lead, 'opportunity')).toEqual(['পল্লী উন্নয়ন তথ্য ব্যবস্থাপনা (Rural Development MIS)']);
    expect(titles(lead, 'organization')).toEqual(['পল্লী উন্নয়ন অধিদপ্তর (Rural Development Directorate)']);
    const otherSection = await search(await as(emails.leadIS), 'পল্লী উন্নয়ন');
    expect(total(otherSection, 'opportunity')).toBe(0);
    expect(total(otherSection, 'organization')).toBe(1);
    const percent = await search(await as(emails.management), '%%');
    expect(percent.groups.every((group) => group.total === 0)).toBe(true);
    const underscore = await search(await as(emails.management), '__');
    expect(underscore.groups.every((group) => group.total === 0)).toBe(true);
  });

  it('pages one result type', async () => {
    const management = await as(emails.management);
    const first = await search(management, 'OPP-9000', '&type=opportunity&pageSize=10&page=1');
    const third = await search(management, 'OPP-9000', '&type=opportunity&pageSize=10&page=3');
    expect(first.groups).toHaveLength(1);
    expect(first.groups[0]?.items).toHaveLength(10);
    expect(third.groups[0]?.items).toHaveLength(3);
    const seen = new Set([...first.groups[0]!.items, ...third.groups[0]!.items].map((item) => item.id));
    expect(seen.size).toBe(13);
  });

  it('validates the term and the parameters', async () => {
    const lead = await as(emails.leadGA);
    await lead.agent.get('/api/search?q=a').expect(422);
    await lead.agent.get('/api/search').expect(422);
    await lead.agent.get(`/api/search?q=${'x'.repeat(101)}`).expect(422);
    await lead.agent.get('/api/search?q=ab&type=user').expect(422);
    await lead.agent.get('/api/search?q=ab&pageSize=500').expect(422);
    const anonymous = await startSession(ctx.app);
    await anonymous.agent.get('/api/search?q=ab').expect(401);
  });

  it('gives administrators accounts and sections only, never commercial records (AT-01)', async () => {
    const admin = await as(emails.admin);
    const response = await search(admin, 'Rafiq');
    expect(response.groups.map((group) => group.type)).toEqual(['account', 'section']);
    expect(titles(response, 'account')).toEqual(['Rafiq Hasan']);
    const commercial = await search(admin, 'Municipal Service');
    expect(commercial.groups.every((group) => group.total === 0)).toBe(true);
    const sections = await search(admin, 'Infrastructure');
    expect(titles(sections, 'section')).toEqual(['Infrastructure & Security']);
    await admin.agent.get('/api/search?q=Municipal&type=opportunity').expect(403);
  });
});
