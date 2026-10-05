/**
 * The single place record access is decided (plan 3.3).
 *
 * Scope is expressed as a SQL predicate and composed into every query, so
 * filtering, counting, sorting and pagination all happen inside the database
 * over permitted rows only (SEC-002). Routes never rebuild these rules.
 */
import { and, eq, or, sql, type SQL } from 'drizzle-orm';

import { contacts, opportunities, opportunityContacts, users } from '../db/schema.js';
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
 *   lead        opportunity.section_id = actor.section_id, with no additional
 *               owner-active or direct-report condition (plan 3.1). A
 *               deactivated owner or a missing manager_id must not hide a
 *               section record from its lead.
 *   sales       opportunities they currently own
 *   admin       nothing at all
 */
export function opportunityScope(actor: Actor): SQL {
  if (!hasCoherentScope(actor)) return MATCH_NOTHING;

  switch (actor.role) {
    case 'management':
      return MATCH_EVERYTHING;
    case 'lead':
      return actor.sectionId
        ? eq(opportunities.sectionId, actor.sectionId)
        : /* istanbul ignore next — guarded by hasCoherentScope */ MATCH_NOTHING;
    case 'sales':
      return eq(opportunities.ownerId, actor.id);
    case 'admin':
      return MATCH_NOTHING;
    default:
      return MATCH_NOTHING;
  }
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
  const owner = and(eq(users.id, opportunity.ownerId), sql`${users.role} IN ('sales', 'lead')`, eq(users.sectionId, opportunity.sectionId));
  const sectionLead = and(eq(users.role, 'lead'), eq(users.sectionId, opportunity.sectionId));
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
 * FR-070: leads transfer within their own section, management across
 * sections, salespeople never. Which owners are acceptable is
 * `eligibleOwnerScope(actor)`, which already confines a lead to their own
 * section — the only section whose records a lead can see.
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
  assignee: { id: string; role: UserRole; sectionId: string | null; active: boolean },
  transfer: { previousOwnerId: string; newOwnerId: string; newSectionId: string },
): boolean {
  if (assignee.id === transfer.previousOwnerId) return false;
  if (!assignee.active) return false;
  if (assignee.id === transfer.newOwnerId) return true;
  if (assignee.role === 'management') return true;
  return assignee.role === 'lead' && assignee.sectionId === transfer.newSectionId;
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

export function canAdministerAccounts(actor: Actor): boolean {
  return actor.active && actor.role === 'admin';
}

/**
 * SQL predicate selecting the users an actor may name as an opportunity owner.
 *
 * BR-001: eligible owners are active salespeople and section leads with a
 * section. Management is never an owner in this release.
 *
 *   sales       only themselves
 *   lead        active eligible owners in their own section
 *   management  active eligible owners in any section
 */
export function eligibleOwnerScope(actor: Actor): SQL {
  if (!canAccessSalesRecords(actor)) return MATCH_NOTHING;

  const baseEligibility = and(
    eq(users.active, true),
    sql`${users.role} IN ('sales', 'lead')`,
    sql`${users.sectionId} IS NOT NULL`,
  ) as SQL;

  switch (actor.role) {
    case 'management':
      return baseEligibility;
    case 'lead':
      return actor.sectionId
        ? (and(baseEligibility, eq(users.sectionId, actor.sectionId)) as SQL)
        : MATCH_NOTHING;
    case 'sales':
      return and(baseEligibility, eq(users.id, actor.id)) as SQL;
    default:
      return MATCH_NOTHING;
  }
}
