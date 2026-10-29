/**
 * The single place record access is decided (plan 3.3).
 *
 * Scope is expressed as a SQL predicate and composed into every query, so
 * filtering, counting, sorting and pagination all happen inside the database
 * over permitted rows only (SEC-002). Routes never rebuild these rules.
 */
import { and, eq, inArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { contacts, opportunities, opportunityContacts, sectionMemberships, sections, users } from '../db/schema.js';
import type { UserRole } from '../../shared/enums.js';
import { type Actor, hasCoherentScope } from './actor.js';

/** A predicate that matches nothing. Used wherever an account has no scope. */
const MATCH_NOTHING: SQL = sql`false`;

/** A predicate that matches every row. */
const MATCH_EVERYTHING: SQL = sql`true`;

/**
 * Commercial record scope.
 *
 *   management  all sections
 *   lead        opportunities in every section they currently lead (CR4),
 *               with no owner-active or direct-report condition (plan 3.1):
 *               a deactivated owner must not hide a section record from its
 *               lead
 *   sales       opportunities they currently own, in sections they are
 *               currently a member of (CR5). The membership condition fails
 *               closed: a record left behind in a section they no longer
 *               belong to is not theirs to see
 *   admin       nothing at all
 *
 * `actor.sectionIds` is read fresh on every request, so former leadership or
 * membership never grants anything.
 */
export function opportunityScope(actor: Actor): SQL {
  if (!hasCoherentScope(actor)) return MATCH_NOTHING;

  switch (actor.role) {
    case 'management':
      return MATCH_EVERYTHING;
    case 'lead':
      return inArray(opportunities.sectionId, actor.sectionIds);
    case 'sales':
      return and(eq(opportunities.ownerId, actor.id), inArray(opportunities.sectionId, actor.sectionIds)) as SQL;
    case 'admin':
      return MATCH_NOTHING;
    default:
      return MATCH_NOTHING;
  }
}

// ---------------------------------------------------------------------------
// Who works in which section (CR4, CR5), for people other than the requester
// ---------------------------------------------------------------------------

type SqlValue = SQL | AnyColumn;

/** `userId` is the lead of `sectionId`, and the section is active. */
export function leadsSectionSql(userId: SqlValue, sectionId: SqlValue): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${sections} ls
     WHERE ls.id = ${sectionId} AND ls.lead_user_id = ${userId} AND ls.active
  )`;
}

/** `userId` is a current member of `sectionId`, and the section is active. */
export function memberOfSectionSql(userId: SqlValue, sectionId: SqlValue): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${sectionMemberships} sm
      JOIN ${sections} ms ON ms.id = sm.section_id
     WHERE sm.user_id = ${userId} AND sm.section_id = ${sectionId}
       AND sm.ended_at IS NULL AND ms.active
  )`;
}

/**
 * The account in `user` can own records in `sectionId` now: a salesperson
 * who is a current member, or the section's lead (BR-001 as amended by CR4/CR5).
 */
export function worksInSectionSql(user: { id: AnyColumn; role: AnyColumn }, sectionId: SqlValue): SQL {
  return sql`(
    (${user.role} = 'sales' AND ${memberOfSectionSql(user.id, sectionId)})
    OR (${user.role} = 'lead' AND ${leadsSectionSql(user.id, sectionId)})
  )`;
}

/** Convenience: scope combined with any additional filters. */
export function scopedWhere(actor: Actor, ...filters: (SQL | undefined)[]): SQL {
  const parts = [opportunityScope(actor), ...filters].filter(Boolean) as SQL[];
  return and(...parts) as SQL;
}

// ---------------------------------------------------------------------------
// Action permissions
// ---------------------------------------------------------------------------

/** Administrators have no commercial access of any kind (plan 3.1, AT-01). */
export function canAccessSalesRecords(actor: Actor): boolean {
  return hasCoherentScope(actor) && actor.role !== 'admin';
}

export function canCreateOpportunity(actor: Actor): boolean {
  if (!canAccessSalesRecords(actor)) return false;
  return actor.role === 'management' || actor.role === 'lead' || actor.role === 'sales';
}

/**
 * Whether the actor may edit a visible opportunity's basic fields.
 *
 * Visibility is necessary but not sufficient in general; for the M1 basic-edit
 * allowlist, every role that can see a sales record may also edit these fields.
 * Owner, section, stage and status changes are explicitly excluded and handled
 * by the M2/M3 services.
 */
export function canEditOpportunityBasics(actor: Actor): boolean {
  return canAccessSalesRecords(actor);
}

/**
 * Changing an opportunity's procuring organization is the owner's decision
 * alone (product decision, 27 October 2026): a Section Lead or management can
 * see and edit the record's other basic fields, but not this one. The record
 * is still located through `opportunityScope` first.
 */
export function canChangeOpportunityOrganization(actor: Actor, ownerId: string): boolean {
  return canAccessSalesRecords(actor) && actor.id === ownerId;
}

/**
 * Stage and status changes, and the follow-up lifecycle, follow the permission
 * matrix's "Edit sales records" row: every role that can see a sales record may
 * edit it (management all, lead own section, salesperson owned). The record
 * itself is still located through `opportunityScope`, so this decides the
 * action, never the visibility.
 */
export function canChangeStageOrStatus(actor: Actor): boolean {
  return canAccessSalesRecords(actor);
}

export function canManageFollowUps(actor: Actor): boolean {
  return canAccessSalesRecords(actor);
}

/** BR-012: only management reopens an Awarded or Lost opportunity. */
export function canReopenOpportunity(actor: Actor): boolean {
  return canAccessSalesRecords(actor) && actor.role === 'management';
}

/**
 * SQL predicate selecting the users an actor may assign a follow-up to on a
 * given opportunity (FR-042, D-004).
 *
 *   sales       only themselves (a salesperson only sees records they own)
 *   lead        the opportunity owner, or themselves
 *   management  the opportunity owner, the active lead of the opportunity's
 *               section, or a management account
 *
 * Every candidate must be active and must already have access to the record
 * through their own scope; assignment never grants access. Each branch above
 * satisfies that by construction: the owner sees what they own, the section
 * lead sees the section, management sees everything.
 */
export function followUpAssigneeScope(
  actor: Actor,
  opportunity: { ownerId: string; sectionId: string },
): SQL {
  if (!canManageFollowUps(actor)) return MATCH_NOTHING;

  const active = eq(users.active, true);
  const sectionId = sql`${opportunity.sectionId}::uuid`;
  const owner = and(eq(users.id, opportunity.ownerId), worksInSectionSql(users, sectionId));
  const sectionLead = and(eq(users.role, 'lead'), leadsSectionSql(users.id, sectionId));
  const management = eq(users.role, 'management');

  switch (actor.role) {
    case 'sales':
      return and(active, eq(users.id, actor.id), eq(users.id, opportunity.ownerId)) as SQL;
    case 'lead':
      return and(
        active,
        or(owner, and(eq(users.id, actor.id), sectionLead)),
      ) as SQL;
    case 'management':
      return and(active, or(owner, sectionLead, management)) as SQL;
    default:
      return MATCH_NOTHING;
  }
}

/**
 * FR-070: leads transfer within the sections they lead, management across
 * sections, salespeople never. Which owner-and-section pairs are acceptable is
 * `eligibleOwnerScope`, which confines a lead to the sections they lead; a
 * lead of two sections may therefore move a record between them (D-CR4-2).
 */
export function canTransferOpportunity(actor: Actor): boolean {
  return canAccessSalesRecords(actor) && (actor.role === 'lead' || actor.role === 'management');
}

/** FR-011, FR-071: the structure and workload view is management's. */
export function canViewTeam(actor: Actor): boolean {
  return canAccessSalesRecords(actor) && actor.role === 'management';
}

/**
 * Whether a user keeps an open follow-up after the opportunity's owner and
 * section change (BR-050). Assignment never grants access, so a task stays
 * with its assignee only if they would still see the record: management, the
 * new section's lead, or the new owner. Everyone else's open tasks move to
 * the new owner. The previous owner's tasks always move.
 */
export function keepsFollowUpAfterTransfer(
  assignee: { id: string; role: UserRole; active: boolean; leadsNewSection: boolean },
  transfer: { previousOwnerId: string; newOwnerId: string },
): boolean {
  if (assignee.id === transfer.previousOwnerId) return false;
  if (!assignee.active) return false;
  if (assignee.id === transfer.newOwnerId) return true;
  if (assignee.role === 'management') return true;
  return assignee.role === 'lead' && assignee.leadsNewSection;
}

// ---------------------------------------------------------------------------
// Directory, contacts and activities (Milestone 4)
// ---------------------------------------------------------------------------

/**
 * SEC-004 / BR-020: a contact is visible only through a live link to an
 * opportunity the actor can see. Management sees every contact. The predicate
 * reuses `opportunityScope`, so a transfer changes contact visibility on the
 * next request with no separate bookkeeping.
 */
export function contactScope(actor: Actor): SQL {
  if (!canAccessSalesRecords(actor)) return MATCH_NOTHING;
  if (actor.role === 'management') return MATCH_EVERYTHING;
  return sql`EXISTS (
    SELECT 1 FROM ${opportunityContacts}
    JOIN ${opportunities} ON ${opportunities.id} = ${opportunityContacts.opportunityId}
    WHERE ${opportunityContacts.contactId} = ${contacts.id}
      AND ${opportunityContacts.removedAt} IS NULL
      AND ${opportunityScope(actor)}
  )`;
}

/** FR-033: every sales role may add to and correct the shared directory. */
export function canEditDirectory(actor: Actor): boolean {
  return canAccessSalesRecords(actor);
}

/** FR-033: archiving an organization or a contact is management's decision. */
export function canArchiveDirectory(actor: Actor): boolean {
  return canAccessSalesRecords(actor) && actor.role === 'management';
}

/**
 * FR-041: a salesperson amends only activities they authored, and only while
 * the record is still theirs to see; leads and management amend any activity
 * in scope. Visibility is decided separately, through the opportunity: an
 * author who has lost access gets a 404 before this is ever asked.
 */
export function canEditActivity(actor: Actor, activity: { authorId: string }): boolean {
  if (!canAccessSalesRecords(actor)) return false;
  if (actor.role === 'management' || actor.role === 'lead') return true;
  return activity.authorId === actor.id;
}

// ---------------------------------------------------------------------------
// Tenders and documents (Milestone 5)
// ---------------------------------------------------------------------------

/**
 * Tender records follow the "Edit sales records" row: every role that can see
 * the opportunity may maintain its tenders. Tender ownership is derived from
 * the opportunity (BR-050), so there is no separate tender owner to check.
 */
export function canManageTenders(actor: Actor): boolean {
  return canAccessSalesRecords(actor);
}

/**
 * CR6: a Software Procurement cycle belongs to its opportunity, so whoever may
 * work on the opportunity's tenders may work on its cycles, within scope.
 */
export function canManageProcurement(actor: Actor): boolean {
  return canAccessSalesRecords(actor);
}

/**
 * CR6: only management may record the documented exception of an RFP
 * invitation without an EOI (the "direct RFP" route).
 */
export function canApproveDirectRfp(actor: Actor): boolean {
  return actor.role === 'management';
}

/**
 * FR-060, FR-061: a user may upload a document or a revision only while
 * authorized to edit the parent opportunity. The opportunity is still located
 * through `opportunityScope` on every upload, finalize, read and download.
 */
export function canUploadDocuments(actor: Actor): boolean {
  return canAccessSalesRecords(actor);
}

/** FR-061: removal is a management soft-archive with a reason. */
export function canArchiveDocument(actor: Actor): boolean {
  return canAccessSalesRecords(actor) && actor.role === 'management';
}

export function canAdministerAccounts(actor: Actor): boolean {
  return actor.active && actor.role === 'admin';
}

// ---------------------------------------------------------------------------
// Dashboards, reports, exports, search and notifications (Milestone 6)
// ---------------------------------------------------------------------------

/**
 * Permission matrix "View reports and export": management all, leads their
 * section, salespeople their own records — always through
 * `opportunityScope`. Administrators get no commercial dashboard, report,
 * export, search result or notification (AT-01).
 */
export function canViewCommercialReports(actor: Actor): boolean {
  return canAccessSalesRecords(actor);
}

/** FR-082: only management receives cross-section filters. */
export function canFilterBySection(actor: Actor): boolean {
  return canAccessSalesRecords(actor) && actor.role === 'management';
}

/** FR-082: salespeople receive no other-user selector. */
export function canFilterByOwner(actor: Actor): boolean {
  return canAccessSalesRecords(actor) && (actor.role === 'management' || actor.role === 'lead');
}

/**
 * The people an owner filter may offer (FR-082), optionally narrowed to one
 * section. Management sees every owner; a lead sees the people who work in,
 * or own records in, the sections they lead. Inactive owners and people who
 * have left a section stay listed while they own records there, because those
 * records remain in the lead's scope (plan 3.1); listing a name grants nothing.
 */
export function ownerFilterOptionScope(actor: Actor, sectionId?: string): SQL {
  if (!canFilterByOwner(actor)) return MATCH_NOTHING;
  const owners = sql`${users.role} IN ('sales', 'lead')`;
  let sectionIds: string[] | null;
  if (actor.role === 'management') {
    sectionIds = sectionId ? [sectionId] : null;
  } else {
    if (sectionId && !actor.sectionIds.includes(sectionId)) return MATCH_NOTHING;
    sectionIds = sectionId ? [sectionId] : actor.sectionIds;
  }
  if (!sectionIds) return owners;
  if (sectionIds.length === 0) return MATCH_NOTHING;
  const inSections = sql.join(
    sectionIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return and(
    owners,
    sql`(
      EXISTS (SELECT 1 FROM ${opportunities} oo WHERE oo.owner_id = ${users.id} AND oo.section_id IN (${inSections}))
      OR EXISTS (SELECT 1 FROM ${sectionMemberships} om
                  WHERE om.user_id = ${users.id} AND om.ended_at IS NULL AND om.section_id IN (${inSections}))
      OR EXISTS (SELECT 1 FROM ${sections} os
                  WHERE os.lead_user_id = ${users.id} AND os.active AND os.id IN (${inSections}))
    )`,
  ) as SQL;
}

/** FR-091: administrative search covers accounts and sections only. */
export function canSearchAdministration(actor: Actor): boolean {
  return canAdministerAccounts(actor);
}

/**
 * Whether the account in `user` (any alias of the users table) can currently
 * see the opportunity row in the same query. This is `opportunityScope`
 * restated for a person other than the requester — the notification
 * generator needs it to choose recipients and to retire alerts whose
 * recipient lost access (BR-070, SEC-005). A test checks the two agree for
 * every account.
 */
export function userSeesOpportunitySql(user: { id: AnyColumn; role: AnyColumn; active: AnyColumn }): SQL {
  return sql`(${user.active} AND (
    ${user.role} = 'management'
    OR (${user.role} = 'lead' AND ${leadsSectionSql(user.id, opportunities.sectionId)})
    OR (${user.role} = 'sales' AND ${opportunities.ownerId} = ${user.id}
        AND ${memberOfSectionSql(user.id, opportunities.sectionId)})
  ))`;
}

/**
 * FR-090: who is alerted about a record. The person responsible (a task's
 * assignee, or the owner), the section's lead ("leads see their section
 * alerts") and management ("all permitted alerts") — each only while they
 * can see the record, so an alert never grants or outlives access.
 */
export function alertRecipientSql(
  user: { id: AnyColumn; role: AnyColumn; active: AnyColumn },
  responsibleUserId: SQL | AnyColumn,
): SQL {
  // A lead who can see the record leads its section, so "the section's lead"
  // needs no further condition here.
  return sql`(${userSeesOpportunitySql(user)} AND (
    ${user.id} = ${responsibleUserId}
    OR ${user.role} = 'management'
    OR ${user.role} = 'lead'
  ))`;
}

/**
 * SQL predicate over `users` selecting who the actor may name as the owner of
 * a record in `section`: a section id, or a sections column when listing
 * owner-and-section pairs.
 *
 * BR-001 as amended by CR4/CR5: an eligible owner is active and works in the
 * section, either as a current member salesperson or as the section's lead.
 * The section must be one the actor works in, unless the actor is management.
 * Management is never an owner in this release.
 *
 *   sales       only themselves, in their own sections
 *   lead        eligible owners in the sections they lead
 *   management  eligible owners in any active section
 */
export function eligibleOwnerScope(actor: Actor, section: string | AnyColumn): SQL {
  if (!canAccessSalesRecords(actor)) return MATCH_NOTHING;

  const sectionSql = typeof section === 'string' ? sql`${section}::uuid` : sql`${section}`;
  const base = and(eq(users.active, true), worksInSectionSql(users, sectionSql)) as SQL;
  const inActorSections =
    typeof section === 'string'
      ? actor.sectionIds.includes(section)
        ? MATCH_EVERYTHING
        : MATCH_NOTHING
      : inArray(section, actor.sectionIds);

  switch (actor.role) {
    case 'management':
      return base;
    case 'lead':
      return and(base, inActorSections) as SQL;
    case 'sales':
      return and(base, eq(users.id, actor.id), inActorSections) as SQL;
    default:
      return MATCH_NOTHING;
  }
}
