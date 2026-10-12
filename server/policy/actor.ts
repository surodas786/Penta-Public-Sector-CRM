import { eq, sql, type SQL } from 'drizzle-orm';

import type { UserRole } from '../../shared/enums.js';
import type { Database } from '../db/client.js';
import { sectionMemberships, sections, users } from '../db/schema.js';

export interface ActorSection {
  id: string;
  name: string;
}

/**
 * The authenticated account as the policy layer sees it.
 *
 * Always built from the session's user id plus a fresh database read — never
 * from anything the client sent (SEC-001).
 */
export interface Actor {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  /**
   * The sections this account works in *now* (CR4, CR5): for a lead, the
   * active sections they lead; for a salesperson, the active sections they
   * are a current member of. Empty for management and administrators.
   * Former leadership or membership is never included.
   */
  sections: ActorSection[];
  sectionIds: string[];
  active: boolean;
  sessionVersion: number;
}

/**
 * A lead or salesperson with no current section is malformed or between
 * assignments. Plan 3.1 requires such an account to fail closed rather than
 * widen its scope, so this is checked wherever scope is derived.
 */
export function hasCoherentScope(actor: Actor): boolean {
  if (!actor.active) return false;
  if (actor.role === 'lead' || actor.role === 'sales') return actor.sectionIds.length > 0;
  return true;
}

/**
 * The sections the current `users` row works in now, for use inside a query
 * over sections aliased `s`: the active sections it leads (leads) or belongs
 * to through an open membership (salespeople).
 *
 * The users columns are written out in full on purpose. In a single-table
 * select Drizzle renders `users.id` as a bare "id" in the select list, which
 * inside this subquery would bind to the section's own id.
 */
const USER_ID = sql.raw('"users"."id"');
const USER_ROLE = sql.raw('"users"."role"');

function worksInNow(): SQL {
  return sql`s.active AND (
    (${USER_ROLE} = 'lead' AND s.lead_user_id = ${USER_ID})
    OR (${USER_ROLE} = 'sales' AND EXISTS (
      SELECT 1 FROM ${sectionMemberships} m
       WHERE m.user_id = ${USER_ID} AND m.section_id = s.id AND m.ended_at IS NULL))
  )`;
}

function currentSectionsJson() {
  return sql<ActorSection[]>`coalesce((
    SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name, s.id)
      FROM ${sections} s WHERE ${worksInNow()}
  ), '[]'::json)`;
}

/**
 * The names of the sections the `users` row in the surrounding query works in
 * now, sorted. For display only. The query must select from `users` itself,
 * not an alias of it.
 */
export function currentSectionNamesSql() {
  return sql<string[]>`coalesce((
    SELECT array_agg(s.name ORDER BY s.name) FROM ${sections} s WHERE ${worksInNow()}
  ), '{}')`;
}

/** Reads an account as an actor, or null if it does not exist. */
export async function loadActor(db: Database, userId: string): Promise<Actor | null> {
  const [row] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      sections: currentSectionsJson(),
      active: users.active,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return { ...row, sectionIds: row.sections.map((section) => section.id) };
}
