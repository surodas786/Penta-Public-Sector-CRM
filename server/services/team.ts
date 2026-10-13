/**
 * Management's Team Management view (FR-011, FR-071, §10.1 "Team workload").
 *
 * Read-only structure plus commercial workload, for management only. It shows
 * names and roles, never emails, credentials or account-administration
 * controls. Workload is computed in SQL over the same active-pipeline
 * definition as the board (status Active, stage neither Awarded nor Lost),
 * and overdue against today's Dhaka date.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { TeamDto } from '../../shared/api.js';
import { canonicalMoney } from '../../shared/money.js';
import { dhakaToday } from '../clock.js';
import type { Database } from '../db/client.js';
import { followUps, opportunities, sectionMemberships, sections, users } from '../db/schema.js';
import { forbidden } from '../http/errors.js';
import { currentSectionNamesSql, type Actor } from '../policy/actor.js';
import { canViewTeam } from '../policy/scope.js';

export async function getTeam(db: Database, actor: Actor): Promise<TeamDto> {
  if (!canViewTeam(actor)) throw forbidden('Team Management is available to management.');
  const today = dhakaToday();

  const people = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .orderBy(asc(users.fullName));

  const memberships = await db
    .select({ userId: sectionMemberships.userId, sectionId: sectionMemberships.sectionId })
    .from(sectionMemberships)
    .where(isNull(sectionMemberships.endedAt));

  const sectionRows = await db
    .select({ id: sections.id, name: sections.name, leadUserId: sections.leadUserId })
    .from(sections)
    .where(eq(sections.active, true))
    .orderBy(asc(sections.name));

  const workloadRows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      role: users.role,
      // A person may work in several sections (CR4, CR5).
      sectionNames: currentSectionNamesSql(),
      // "users"."id" in full: in a single-table select Drizzle would render
      // a bare "id", which these subqueries would bind to their own table.
      activeOpportunities: sql<number>`(
        SELECT count(*)::int FROM ${opportunities} o
        WHERE o.owner_id = "users"."id" AND o.status = 'active' AND o.stage NOT IN ('awarded', 'lost'))`,
      estimatedPipeline: sql<string>`(
        SELECT coalesce(sum(o.estimated_value), 0)::numeric(16,2)::text FROM ${opportunities} o
        WHERE o.owner_id = "users"."id" AND o.status = 'active' AND o.stage NOT IN ('awarded', 'lost'))`,
      openTasks: sql<number>`(
        SELECT count(*)::int FROM ${followUps} f WHERE f.assigned_user_id = "users"."id" AND f.state = 'open')`,
      overdueTasks: sql<number>`(
        SELECT count(*)::int FROM ${followUps} f
        WHERE f.assigned_user_id = "users"."id" AND f.state = 'open' AND f.due_date < ${today}::date)`,
    })
    .from(users)
    .where(and(eq(users.active, true), sql`${users.role} IN ('sales', 'lead')`))
    .orderBy(asc(users.fullName));

  return {
    management: people
      .filter((person) => person.role === 'management' && person.active)
      .map((person) => ({ id: person.id, fullName: person.fullName })),
    sections: sectionRows.map((section) => {
      const lead = people.find((person) => person.id === section.leadUserId && person.active) ?? null;
      return {
        id: section.id,
        name: section.name,
        lead: lead ? { id: lead.id, fullName: lead.fullName } : null,
        // Current members; each reports to this section's lead (CR5).
        members: people
          .filter(
            (person) =>
              person.role === 'sales' &&
              memberships.some((row) => row.userId === person.id && row.sectionId === section.id),
          )
          .map((person) => ({ id: person.id, fullName: person.fullName, active: person.active })),
      };
    }),
    workload: workloadRows
      .filter((row) => row.sectionNames.length > 0)
      .map((row) => ({ ...row, estimatedPipeline: canonicalMoney(row.estimatedPipeline) })),
    today,
  };
}
