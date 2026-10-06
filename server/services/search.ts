/**
 * Scoped search (FR-091, SEC-002).
 *
 * Sales roles search accessible opportunity names, permitted contacts, basic
 * organization names and permitted tender references. Each type is filtered
 * by its own scope predicate *before* matching, counting and limiting, so an
 * inaccessible record cannot surface as a result, a summary, a label or a
 * count. Summaries name only things the reader could open themselves: no
 * contact email or phone, no owner of a record they cannot see, no notes.
 *
 * Results are bounded: a few per type without `type`, one paged type with it.
 * Administrators search accounts and sections only, never commercial records.
 */
import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import type { SearchGroupDto, SearchResponseDto, SearchResultDto } from '../../shared/api.js';
import { ORGANIZATION_TYPE_LABELS, ROLE_LABELS, STAGE_LABELS, STATUS_LABELS } from '../../shared/enums.js';
import { SEARCH_GROUP_LABELS, SEARCH_RESULT_TYPES, type SearchResultType } from '../../shared/reporting.js';
import type { searchQuerySchema } from '../../shared/validation.js';
import type { Database } from '../db/client.js';
import { contacts, opportunities, organizations, sections, tenders, users } from '../db/schema.js';
import { forbidden } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canAccessSalesRecords, canSearchAdministration, contactScope, scopedWhere } from '../policy/scope.js';

type SearchQuery = z.output<typeof searchQuerySchema>;

/** Per type when no type is chosen (the top-bar suggestions). */
const PREVIEW_PER_TYPE = 5;

/** The term as a literal substring: `%`, `_` and `\` in it match only themselves. */
function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

interface TypeSearch {
  where: (pattern: string) => SQL;
  count: (where: SQL) => Promise<number>;
  rows: (where: SQL, limit: number, offset: number) => Promise<SearchResultDto[]>;
}

function salesSearches(db: Database, actor: Actor): Record<SearchResultType, TypeSearch> {
  return {
    opportunity: {
      where: (pattern) =>
        scopedWhere(
          actor,
          or(ilike(opportunities.name, pattern), ilike(opportunities.reference, pattern), ilike(organizations.name, pattern)),
        ),
      count: async (where) =>
        (
          await db
            .select({ value: count() })
            .from(opportunities)
            .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
            .where(where)
        )[0]?.value ?? 0,
      rows: async (where, limit, offset) =>
        (
          await db
            .select({
              id: opportunities.id,
              name: opportunities.name,
              reference: opportunities.reference,
              organization: organizations.name,
              stage: opportunities.stage,
              status: opportunities.status,
            })
            .from(opportunities)
            .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
            .where(where)
            .orderBy(asc(opportunities.name), asc(opportunities.id))
            .limit(limit)
            .offset(offset)
        ).map((row) => ({
          type: 'opportunity',
          id: row.id,
          title: row.name,
          summary: `${row.reference} · ${row.organization} · ${
            row.status === 'active' ? STAGE_LABELS[row.stage] : STATUS_LABELS[row.status]
          }`,
          path: `/opportunities/${row.id}`,
          stage: row.stage,
          status: row.status,
        })),
    },
    tender: {
      // Tenders inherit the opportunity's scope (SEC-004).
      where: (pattern) => scopedWhere(actor, or(ilike(tenders.reference, pattern), ilike(tenders.title, pattern))),
      count: async (where) =>
        (
          await db
            .select({ value: count() })
            .from(tenders)
            .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
            .where(where)
        )[0]?.value ?? 0,
      rows: async (where, limit, offset) =>
        (
          await db
            .select({
              id: tenders.id,
              reference: tenders.reference,
              title: tenders.title,
              opportunityId: opportunities.id,
              opportunityName: opportunities.name,
              isCurrent: tenders.isCurrent,
            })
            .from(tenders)
            .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
            .where(where)
            .orderBy(sql`${tenders.isCurrent} DESC`, asc(tenders.reference), asc(tenders.id))
            .limit(limit)
            .offset(offset)
        ).map((row) => ({
          type: 'tender',
          id: row.id,
          title: row.reference,
          summary: `${row.title} · ${row.opportunityName}${row.isCurrent ? '' : ' · earlier notice'}`,
          path: `/opportunities/${row.opportunityId}?tab=tender`,
        })),
    },
    contact: {
      // SEC-004: only contacts linked to an accessible opportunity.
      where: (pattern) =>
        and(
          contactScope(actor),
          isNull(contacts.archivedAt),
          or(ilike(contacts.fullName, pattern), ilike(contacts.designation, pattern)),
        ) as SQL,
      count: async (where) => (await db.select({ value: count() }).from(contacts).where(where))[0]?.value ?? 0,
      rows: async (where, limit, offset) =>
        (
          await db
            .select({
              id: contacts.id,
              fullName: contacts.fullName,
              designation: contacts.designation,
              organization: organizations.name,
            })
            .from(contacts)
            .innerJoin(organizations, eq(organizations.id, contacts.organizationId))
            .where(where)
            .orderBy(asc(contacts.fullName), asc(contacts.id))
            .limit(limit)
            .offset(offset)
        ).map((row) => ({
          type: 'contact',
          id: row.id,
          title: row.fullName,
          // Designation and the shared organization only; never email, phone or notes.
          summary: [row.designation, row.organization].filter(Boolean).join(' · '),
          path: `/contacts/${row.id}`,
        })),
    },
    organization: {
      // FR-031: the shared directory's basic information, for every sales role.
      where: (pattern) =>
        and(isNull(organizations.archivedAt), or(ilike(organizations.name, pattern), ilike(organizations.location, pattern))) as SQL,
      count: async (where) => (await db.select({ value: count() }).from(organizations).where(where))[0]?.value ?? 0,
      rows: async (where, limit, offset) =>
        (
          await db
            .select({ id: organizations.id, name: organizations.name, type: organizations.type, location: organizations.location })
            .from(organizations)
            .where(where)
            .orderBy(asc(organizations.name), asc(organizations.id))
            .limit(limit)
            .offset(offset)
        ).map((row) => ({
          type: 'organization',
          id: row.id,
          title: row.name,
          summary: [ORGANIZATION_TYPE_LABELS[row.type], row.location].filter(Boolean).join(' · '),
          path: `/organizations/${row.id}`,
        })),
    },
  };
}

export async function search(db: Database, actor: Actor, query: SearchQuery): Promise<SearchResponseDto> {
  const pattern = containsPattern(query.q);

  if (canSearchAdministration(actor)) {
    if (query.type) throw forbidden('Administrative search covers accounts and sections only.');
    return searchAdministration(db, query, pattern);
  }
  if (!canAccessSalesRecords(actor)) throw forbidden('Search is not available to this account.');

  const searches = salesSearches(db, actor);
  const types = query.type ? [query.type] : [...SEARCH_RESULT_TYPES];
  const limit = query.type ? query.pageSize : PREVIEW_PER_TYPE;
  const offset = query.type ? (query.page - 1) * query.pageSize : 0;

  const groups: SearchGroupDto[] = [];
  for (const type of types) {
    const handler = searches[type];
    const where = handler.where(pattern);
    const total = await handler.count(where);
    groups.push({
      type,
      label: SEARCH_GROUP_LABELS[type],
      total,
      items: total === 0 ? [] : await handler.rows(where, limit, offset),
    });
  }
  return { q: query.q, groups, page: query.type ? query.page : 1, pageSize: limit };
}

/** FR-091: administrators find accounts and sections, nothing commercial. */
async function searchAdministration(db: Database, query: SearchQuery, pattern: string): Promise<SearchResponseDto> {
  const accountWhere = or(ilike(users.fullName, pattern), ilike(users.email, pattern));
  const [accountTotal] = await db.select({ value: count() }).from(users).where(accountWhere);
  const accounts = await db
    .select({ id: users.id, fullName: users.fullName, role: users.role, active: users.active, section: sections.name })
    .from(users)
    .leftJoin(sections, eq(sections.id, users.sectionId))
    .where(accountWhere)
    .orderBy(asc(users.fullName), asc(users.id))
    .limit(PREVIEW_PER_TYPE);

  const sectionWhere = ilike(sections.name, pattern);
  const [sectionTotal] = await db.select({ value: count() }).from(sections).where(sectionWhere);
  const sectionRows = await db
    .select({ id: sections.id, name: sections.name, active: sections.active })
    .from(sections)
    .where(sectionWhere)
    .orderBy(asc(sections.name))
    .limit(PREVIEW_PER_TYPE);

  return {
    q: query.q,
    page: 1,
    pageSize: PREVIEW_PER_TYPE,
    groups: [
      {
        type: 'account',
        label: SEARCH_GROUP_LABELS.account,
        total: accountTotal?.value ?? 0,
        items: accounts.map((row) => ({
          type: 'account',
          id: row.id,
          title: row.fullName,
          summary: [ROLE_LABELS[row.role], row.section, row.active ? null : 'Inactive'].filter(Boolean).join(' · '),
          path: `/administration?q=${encodeURIComponent(row.fullName)}`,
        })),
      },
      {
        type: 'section',
        label: SEARCH_GROUP_LABELS.section,
        total: sectionTotal?.value ?? 0,
        items: sectionRows.map((row) => ({
          type: 'section',
          id: row.id,
          title: row.name,
          summary: row.active ? 'Section' : 'Section · Inactive',
          path: '/administration',
        })),
      },
    ],
  };
}
