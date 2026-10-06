/**
 * Scoped dashboard (FR-080, FR-081, §10.1).
 *
 * Every figure is an SQL aggregate over `opportunityScope`, composed with the
 * shared definitions in ./metrics.ts so the cards, the stage chart, the
 * drill-down lists, the reports and the CSV exports agree (AT-12). Nothing
 * here is computed in the browser and no record list is sent to build a
 * total. Section and owner filters narrow inside scope; they are offered and
 * accepted only where FR-082 allows them.
 */
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import type {
  DashboardDto,
  DashboardStageDto,
  DashboardWorkloadRowDto,
} from '../../shared/api.js';
import { PIPELINE_STAGES } from '../../shared/enums.js';
import type { dashboardQuerySchema } from '../../shared/validation.js';
import { dhakaDateOf, dhakaQuarter, now } from '../clock.js';
import type { Database } from '../db/client.js';
import { activities, followUps, opportunities, sections, tenders, users } from '../db/schema.js';
import { forbidden } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import {
  canFilterByOwner,
  canFilterBySection,
  canViewCommercialReports,
  opportunityScope,
  ownerFilterOptionScope,
  scopedWhere,
} from '../policy/scope.js';
import {
  activePipeline,
  awardedInQuarter,
  dashboardRangeBounds,
  dateWithin,
  opportunityOpen,
  overdueFollowUp,
  participatingCurrentNotice,
  SEVEN_DAYS_HOURS,
  sumMoney,
  tenderDueWithin,
} from './metrics.js';
import { tenderIndicator } from './tenders.js';

type DashboardQuery = z.output<typeof dashboardQuerySchema>;

const NEXT_ACTION_LIMIT = 7;
const TENDER_LIMIT = 5;
const ACTIVITY_LIMIT = 6;

/**
 * FR-082 filter checks shared by the dashboard and the reports. A filter
 * outside the role's entitlement is refused rather than ignored, so a forged
 * request is visible as such; one inside it can only narrow the scope.
 */
export function assertReportFilters(actor: Actor, filters: { sectionId?: string | undefined; ownerId?: string | undefined }): void {
  if (!canViewCommercialReports(actor)) {
    throw forbidden('Commercial dashboards and reports are not available to the System Administrator role.');
  }
  if (filters.sectionId && !canFilterBySection(actor)) {
    throw forbidden('Only management can filter by section.');
  }
  if (filters.ownerId && !canFilterByOwner(actor)) {
    throw forbidden('Salespeople see their own records and cannot filter by another person.');
  }
}

/** The narrowing predicates for the optional section and owner filters. */
export function narrowingFilters(filters: { sectionId?: string | undefined; ownerId?: string | undefined }): SQL[] {
  const parts: SQL[] = [];
  if (filters.sectionId) parts.push(eq(opportunities.sectionId, filters.sectionId));
  if (filters.ownerId) parts.push(eq(opportunities.ownerId, filters.ownerId));
  return parts;
}

export function scopeLabel(actor: Actor, sectionName: string | null = null): string {
  if (actor.role === 'management') return sectionName ?? 'Organization-wide';
  if (actor.role === 'lead') return `${actor.sectionName ?? 'Your section'} — every opportunity in your section`;
  return 'Opportunities you own';
}

export async function getDashboard(db: Database, actor: Actor, query: DashboardQuery): Promise<DashboardDto> {
  assertReportFilters(actor, query);

  const at = now();
  const today = dhakaDateOf(at);
  const quarter = dhakaQuarter(today);
  const bounds = dashboardRangeBounds(query.range, today);
  const narrow = narrowingFilters(query);
  const inScope = (...extra: (SQL | undefined)[]) => scopedWhere(actor, ...narrow, ...extra);

  // --- Opportunity totals: one scan, every population named once ----------
  const [totals] = await db
    .select({
      activeCount: sql<number>`count(*) FILTER (WHERE ${activePipeline()})::int`,
      activeValue: sql<string>`coalesce(sum(${opportunities.estimatedValue}) FILTER (WHERE ${activePipeline()}), 0)::numeric(18,2)::text`,
      holdCount: sql<number>`count(*) FILTER (WHERE ${opportunities.status} = 'on_hold')::int`,
      holdValue: sql<string>`coalesce(sum(${opportunities.estimatedValue}) FILTER (WHERE ${opportunities.status} = 'on_hold'), 0)::numeric(18,2)::text`,
      cancelledCount: sql<number>`count(*) FILTER (WHERE ${opportunities.status} = 'cancelled')::int`,
      cancelledValue: sql<string>`coalesce(sum(${opportunities.estimatedValue}) FILTER (WHERE ${opportunities.status} = 'cancelled'), 0)::numeric(18,2)::text`,
      awardedQuarterCount: sql<number>`count(*) FILTER (WHERE ${awardedInQuarter(today)})::int`,
      awardedQuarterValue: sql<string>`coalesce(sum(${opportunities.awardedValue}) FILTER (WHERE ${awardedInQuarter(today)}), 0)::numeric(18,2)::text`,
    })
    .from(opportunities)
    .where(inScope());

  // --- Stage chart: active pipeline by stage; Awarded and Lost by date -----
  const stageRows = await db
    .select({
      stage: opportunities.stage,
      count: sql<number>`count(*)::int`,
      value: sumMoney(sql`${opportunities.estimatedValue}`),
    })
    .from(opportunities)
    .where(inScope(activePipeline()))
    .groupBy(opportunities.stage);

  const [awardedRow] = await db
    .select({ count: sql<number>`count(*)::int`, value: sumMoney(sql`${opportunities.awardedValue}`) })
    .from(opportunities)
    .where(inScope(eq(opportunities.stage, 'awarded'), dateWithin(sql`${opportunities.awardDate}`, bounds?.from, bounds?.to)));
  const [lostRow] = await db
    .select({ count: sql<number>`count(*)::int`, value: sumMoney(sql`${opportunities.estimatedValue}`) })
    .from(opportunities)
    .where(inScope(eq(opportunities.stage, 'lost'), dateWithin(sql`${opportunities.closedDate}`, bounds?.from, bounds?.to)));

  const stages: DashboardStageDto[] = [
    ...PIPELINE_STAGES.map((stage): DashboardStageDto => {
      const row = stageRows.find((candidate) => candidate.stage === stage);
      return { stage, count: row?.count ?? 0, value: row?.value ?? '0.00', valueBasis: 'estimated' };
    }),
    { stage: 'awarded', count: awardedRow?.count ?? 0, value: awardedRow?.value ?? '0.00', valueBasis: 'awarded' },
    { stage: 'lost', count: lostRow?.count ?? 0, value: lostRow?.value ?? '0.00', valueBasis: 'estimated' },
  ];

  // --- Overdue follow-ups, On Hold shown separately (§10.1) ---------------
  const [overdueRow] = await db
    .select({
      notHeld: sql<number>`count(*) FILTER (WHERE ${opportunities.status} <> 'on_hold')::int`,
      held: sql<number>`count(*) FILTER (WHERE ${opportunities.status} = 'on_hold')::int`,
    })
    .from(followUps)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .where(inScope(overdueFollowUp(today)));

  // --- Tender submissions in the next seven days (exclusive end) ----------
  const [tenderRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenders)
    .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
    .where(inScope(tenderDueWithin(at, SEVEN_DAYS_HOURS)));

  // --- Team workload (leads and management) -------------------------------
  const workload = canFilterByOwner(actor) ? await loadWorkload(db, actor, query, today, at) : null;

  // --- Pipeline value by section (management) -----------------------------
  const sectionRows =
    actor.role === 'management'
      ? await db
          .select({
            id: sections.id,
            name: sections.name,
            activeOpportunities: sql<number>`count(${opportunities.id})::int`,
            estimatedPipeline: sumMoney(sql`${opportunities.estimatedValue}`),
          })
          .from(sections)
          .leftJoin(
            opportunities,
            and(
              eq(opportunities.sectionId, sections.id),
              activePipeline(),
              opportunityScope(actor),
              query.ownerId ? eq(opportunities.ownerId, query.ownerId) : undefined,
            ),
          )
          .where(eq(sections.active, true))
          .groupBy(sections.id, sections.name)
          .orderBy(asc(sections.name))
      : null;

  // --- Next actions: one person's open follow-ups, earliest first ---------
  const targetId = query.ownerId ?? actor.id;
  const [target] = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  const nextActionWhere = inScope(eq(followUps.state, 'open'), eq(followUps.assignedUserId, targetId));
  const [nextActionTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(followUps)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .where(nextActionWhere);
  const nextActionRows = await db
    .select({
      followUpId: followUps.id,
      title: followUps.title,
      dueDate: followUps.dueDate,
      opportunityId: opportunities.id,
      opportunityName: opportunities.name,
      assigneeName: users.fullName,
      status: opportunities.status,
    })
    .from(followUps)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .innerJoin(users, eq(users.id, followUps.assignedUserId))
    .where(nextActionWhere)
    .orderBy(asc(followUps.dueDate), asc(followUps.createdAt))
    .limit(NEXT_ACTION_LIMIT);

  // --- Upcoming tender deadlines: open bids, soonest first ----------------
  const tenderRows = await db
    .select({
      id: tenders.id,
      reference: tenders.reference,
      title: tenders.title,
      opportunityId: opportunities.id,
      opportunityName: opportunities.name,
      opportunityStage: opportunities.stage,
      opportunityStatus: opportunities.status,
      submissionDeadline: tenders.submissionDeadline,
      bidStatus: tenders.bidStatus,
      noticeState: tenders.noticeState,
    })
    .from(tenders)
    .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
    .where(inScope(participatingCurrentNotice()))
    .orderBy(asc(tenders.submissionDeadline), asc(tenders.id))
    .limit(TENDER_LIMIT);

  // --- Recent activity, on the activity date basis (BR-060) --------------
  const activityRows = await db
    .select({
      id: activities.id,
      opportunityId: opportunities.id,
      opportunityName: opportunities.name,
      type: activities.type,
      subject: activities.subject,
      occurredAt: activities.occurredAt,
      authorName: users.fullName,
    })
    .from(activities)
    .innerJoin(opportunities, eq(opportunities.id, activities.opportunityId))
    .innerJoin(users, eq(users.id, activities.authorId))
    .where(
      inScope(
        dateWithin(sql`((${activities.occurredAt} AT TIME ZONE 'Asia/Dhaka')::date)`, bounds?.from, bounds?.to),
      ),
    )
    .orderBy(desc(activities.occurredAt), desc(activities.id))
    .limit(ACTIVITY_LIMIT);

  // --- Filter choices -----------------------------------------------------
  const ownerOptions = canFilterByOwner(actor)
    ? await db
        .select({ id: users.id, fullName: users.fullName, sectionId: users.sectionId, active: users.active })
        .from(users)
        .where(
          and(
            ownerFilterOptionScope(actor),
            query.sectionId ? eq(users.sectionId, query.sectionId) : undefined,
          ),
        )
        .orderBy(asc(users.fullName))
    : [];
  const sectionOptions = canFilterBySection(actor)
    ? await db
        .select({ id: sections.id, name: sections.name })
        .from(sections)
        .where(eq(sections.active, true))
        .orderBy(asc(sections.name))
    : [];
  const selectedSectionName = query.sectionId
    ? (sectionOptions.find((section) => section.id === query.sectionId)?.name ?? null)
    : null;

  return {
    today,
    generatedAt: at.toISOString(),
    scopeLabel: scopeLabel(actor, selectedSectionName),
    filters: { sectionId: query.sectionId ?? null, ownerId: query.ownerId ?? null, range: query.range },
    quarter,
    rangeBounds: bounds,
    kpis: {
      activeOpportunities: totals?.activeCount ?? 0,
      estimatedActivePipeline: totals?.activeValue ?? '0.00',
      overdueFollowUps: overdueRow?.notHeld ?? 0,
      overdueFollowUpsOnHold: overdueRow?.held ?? 0,
      tendersDueNext7Days: tenderRow?.count ?? 0,
      awardedValueThisQuarter: totals?.awardedQuarterValue ?? '0.00',
      awardedCountThisQuarter: totals?.awardedQuarterCount ?? 0,
    },
    stages,
    onHold: { count: totals?.holdCount ?? 0, estimatedValue: totals?.holdValue ?? '0.00' },
    cancelled: { count: totals?.cancelledCount ?? 0, estimatedValue: totals?.cancelledValue ?? '0.00' },
    workload,
    sections: sectionRows,
    nextActions: {
      target: { id: targetId, fullName: target?.fullName ?? '' },
      total: nextActionTotal?.count ?? 0,
      items: nextActionRows.map((row) => ({
        followUpId: row.followUpId,
        title: row.title,
        dueDate: row.dueDate,
        dueState: row.dueDate < today ? 'overdue' : row.dueDate === today ? 'today' : 'upcoming',
        opportunityId: row.opportunityId,
        opportunityName: row.opportunityName,
        assigneeName: row.assigneeName,
        onHold: row.status === 'on_hold',
      })),
    },
    upcomingTenders: tenderRows.map((row) => ({
      id: row.id,
      reference: row.reference,
      title: row.title,
      opportunityId: row.opportunityId,
      opportunityName: row.opportunityName,
      submissionDeadline: row.submissionDeadline.toISOString(),
      bidStatus: row.bidStatus,
      indicator: tenderIndicator(row, at),
    })),
    recentActivity: activityRows.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
    })),
    ownerOptions: ownerOptions
      .filter((option): option is typeof option & { sectionId: string } => option.sectionId !== null)
      .map((option) => ({ ...option })),
    sectionOptions,
  };
}

/**
 * §10.1 "Team workload": active opportunities and open tasks grouped by
 * current owner within scope. Every count runs over `opportunityScope`, so
 * the rows add up to the dashboard's own totals. Inactive owners appear while
 * they still own open records, so nothing in scope drops out of the sum.
 */
async function loadWorkload(
  db: Database,
  actor: Actor,
  query: DashboardQuery,
  today: string,
  at: Date,
): Promise<DashboardWorkloadRowDto[]> {
  const scope = opportunityScope(actor);

  // Each figure is aggregated once per owner over the scoped rows, then
  // joined to the people. (Measured at the NFR-010 envelope, per-person
  // correlated subqueries rescanned every open follow-up for each person:
  // ~300 ms of a management dashboard's ~330 ms.) The definitions are the
  // shared metric fragments, so the rows still add up to the totals.
  const byOwner = db
    .select({
      ownerId: opportunities.ownerId,
      activeOpportunities: sql<number>`count(*) FILTER (WHERE ${activePipeline()})::int`.as('active_opportunities'),
      estimatedPipeline: sql<string>`coalesce(sum(${opportunities.estimatedValue}) FILTER (WHERE ${activePipeline()}), 0)::numeric(18,2)::text`.as(
        'estimated_pipeline',
      ),
      openRecords: sql<boolean>`bool_or(${opportunityOpen()})`.as('open_records'),
    })
    .from(opportunities)
    .where(scope)
    .groupBy(opportunities.ownerId)
    .as('owner_totals');

  const tasksByOwner = db
    .select({
      ownerId: opportunities.ownerId,
      openTasks: sql<number>`count(*)::int`.as('open_tasks'),
      overdueTasks: sql<number>`count(*) FILTER (WHERE ${overdueFollowUp(today)})::int`.as('overdue_tasks'),
    })
    .from(followUps)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .where(and(scope, eq(followUps.state, 'open')))
    .groupBy(opportunities.ownerId)
    .as('task_totals');

  const tendersByOwner = db
    .select({
      ownerId: opportunities.ownerId,
      tendersDueSoon: sql<number>`count(*)::int`.as('tenders_due_soon'),
    })
    .from(tenders)
    .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
    .where(and(scope, tenderDueWithin(at, SEVEN_DAYS_HOURS)))
    .groupBy(opportunities.ownerId)
    .as('tender_totals');

  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      role: users.role,
      sectionId: users.sectionId,
      sectionName: sections.name,
      active: users.active,
      activeOpportunities: sql<number>`coalesce(${byOwner.activeOpportunities}, 0)::int`,
      estimatedPipeline: sql<string>`coalesce(${byOwner.estimatedPipeline}, '0.00')`,
      openTasks: sql<number>`coalesce(${tasksByOwner.openTasks}, 0)::int`,
      overdueTasks: sql<number>`coalesce(${tasksByOwner.overdueTasks}, 0)::int`,
      tendersDueSoon: sql<number>`coalesce(${tendersByOwner.tendersDueSoon}, 0)::int`,
      openRecords: sql<boolean>`coalesce(${byOwner.openRecords}, false)`,
    })
    .from(users)
    .leftJoin(sections, eq(sections.id, users.sectionId))
    .leftJoin(byOwner, eq(byOwner.ownerId, users.id))
    .leftJoin(tasksByOwner, eq(tasksByOwner.ownerId, users.id))
    .leftJoin(tendersByOwner, eq(tendersByOwner.ownerId, users.id))
    .where(
      and(
        ownerFilterOptionScope(actor),
        query.sectionId ? eq(users.sectionId, query.sectionId) : undefined,
        query.ownerId ? eq(users.id, query.ownerId) : undefined,
      ),
    )
    .orderBy(asc(sections.name), asc(users.fullName));

  return rows
    .filter((row) => row.active || row.openRecords || row.openTasks > 0)
    .map(({ openRecords: _openRecords, ...row }) => row);
}
