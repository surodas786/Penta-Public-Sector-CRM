/**
 * The single place record access is decided (plan 3.3).
 *
 * Scope is expressed as a SQL predicate and composed into every query, so
 * filtering, counting, sorting and pagination all happen inside the database
 * over permitted rows only (SEC-002). Routes never rebuild these rules.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { opportunities, users } from '../db/schema.js';
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
