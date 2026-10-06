/**
 * Reports (FR-082, FR-083, BR-060).
 *
 * Each report is a scoped SQL query: `opportunityScope` is applied before any
 * filter, sort, count, aggregate or page (SEC-002), and the populations come
 * from the shared definitions in ./metrics.ts. A report's columns are
 * declared once and used for the screen and for its CSV export, so the two
 * cannot drift. Every report names the date its date filter applies to.
 */
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { ReportDto, ReportRowDto, ReportSummaryItemDto } from '../../shared/api.js';
import {
  BID_STATUS_LABELS,
  BOARD_LANES,
  LOSS_REASON_LABELS,
  PRIORITY_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  TENDER_DUE_SOON_HOURS,
  TENDER_INDICATOR_LABELS,
  boardLaneTitle,
  type BoardLane,
  type LossReason,
} from '../../shared/enums.js';
import { toPaisa } from '../../shared/money.js';
import {
  DATE_BASIS_LABELS,
  reportDefinition,
  type ReportColumnKind,
  type ReportKey,
} from '../../shared/reporting.js';
import type { reportFiltersSchema } from '../../shared/validation.js';
import { dhakaDateOf, now } from '../clock.js';
import type { Database } from '../db/client.js';
import { followUps, opportunities, organizations, sections, tenders, users } from '../db/schema.js';
import { validationFailed } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { scopedWhere } from '../policy/scope.js';
import { assertReportFilters, narrowingFilters, scopeLabel } from './dashboard.js';
import {
  activePipeline,
  dateWithin,
  opportunityCreatedDate,
  overdueFollowUp,
  participatingCurrentNotice,
  SEVEN_DAYS_HOURS,
  sumMoney,
  tenderDeadlineDate,
  tenderDueWithin,
} from './metrics.js';
import { tenderIndicator } from './tenders.js';

export type ReportFilters = z.output<typeof reportFiltersSchema>;

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
  /** The ORDER BY expression. */
  sort?: SQL;
  /** Sorted after aggregation instead (only the fixed list of board lanes). */
  sortAfterAggregation?: true;
}

export interface ReportOrder {
  key: string;
  dir: 'asc' | 'desc';
  sql: SQL[];
}

export interface ReportContext {
  db: Database;
  actor: Actor;
  filters: ReportFilters;
  at: Date;
  today: string;
}

interface RowPage {
  rows: ReportRowDto[];
  total: number;
}

interface ReportSpec {
  key: ReportKey;
  columns: ReportColumn[];
  defaultSort: string;
  defaultDir: 'asc' | 'desc';
  /** One page, or every row when `limit` is undefined (exports). */
  rows(context: ReportContext, order: ReportOrder, limit: number | undefined, offset: number): Promise<RowPage>;
  summary(context: ReportContext): Promise<ReportSummaryItemDto[]>;
  /** BR-060: matching records with no value for the date basis; null when the basis is never empty. */
  undated?: (context: ReportContext) => Promise<number>;
  /** Every opportunity the report draws on, for the export's delivery re-check. */
  coveredOpportunityIds(context: ReportContext): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const owner = alias(users, 'report_owner');
const assignee = alias(users, 'report_assignee');

function count(value: number): ReportSummaryItemDto['value'] {
  return String(value);
}

function opportunityWhere(context: ReportContext, ...extra: (SQL | undefined)[]): SQL {
  return scopedWhere(context.actor, ...narrowingFilters(context.filters), ...extra);
}

async function idsOf(rows: Promise<{ id: string }[]>): Promise<string[]> {
  return [...new Set((await rows).map((row) => row.id))];
}

/** Sorting in memory is used only for the fixed, already-aggregated lane list. */
function compareCells(a: unknown, b: unknown, kind: ReportColumnKind): number {
  if (kind === 'money') return Number(toPaisa(String(a ?? '0')) - toPaisa(String(b ?? '0')));
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

// ---------------------------------------------------------------------------
// Pipeline by stage (D-005: opportunity created date)
// ---------------------------------------------------------------------------

const laneExpression = sql<BoardLane>`CASE
  WHEN ${opportunities.status} IN ('on_hold', 'cancelled') THEN ${opportunities.status}::text
  ELSE ${opportunities.stage}::text END`;

const pipelineReport: ReportSpec = {
  key: 'pipeline',
  columns: [
    { key: 'lane', label: 'Stage or status', kind: 'text', sortAfterAggregation: true },
    { key: 'opportunities', label: 'Opportunities', kind: 'count', sortAfterAggregation: true },
    // D-006: an estimate-labelled report shows estimates, Awarded included.
    { key: 'estimatedValue', label: 'Estimated value (BDT)', kind: 'money', sortAfterAggregation: true },
  ],
  defaultSort: 'lane',
  defaultDir: 'asc',
  async rows(context, order, limit, offset) {
    const where = opportunityWhere(context, dateWithin(opportunityCreatedDate, context.filters.from, context.filters.to));
    const grouped = await context.db
      .select({ lane: laneExpression, count: sql<number>`count(*)::int`, value: sumMoney(sql`${opportunities.estimatedValue}`) })
      .from(opportunities)
      .where(where)
      .groupBy(laneExpression);
    // Every lane is listed, empty ones included, in board order.
    const all = BOARD_LANES.map((lane, index) => {
      const row = grouped.find((candidate) => candidate.lane === lane);
      return {
        index,
        cells: { lane: boardLaneTitle(lane), opportunities: row?.count ?? 0, estimatedValue: row?.value ?? '0.00' },
      };
    });
    if (order.key !== 'lane') {
      const key = order.key as keyof (typeof all)[number]['cells'];
      const kind = pipelineReport.columns.find((candidate) => candidate.key === key)?.kind ?? 'text';
      all.sort((a, b) => compareCells(a.cells[key], b.cells[key], kind) || a.index - b.index);
    }
    if (order.dir === 'desc') all.reverse();
    const page = limit === undefined ? all : all.slice(offset, offset + limit);
    return { rows: page.map((row) => ({ cells: row.cells, opportunityId: null })), total: all.length };
  },
  async summary(context) {
    const where = opportunityWhere(context, dateWithin(opportunityCreatedDate, context.filters.from, context.filters.to));
    const [row] = await context.db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) FILTER (WHERE ${activePipeline()})::int`,
        activeValue: sql<string>`coalesce(sum(${opportunities.estimatedValue}) FILTER (WHERE ${activePipeline()}), 0)::numeric(18,2)::text`,
        held: sql<number>`count(*) FILTER (WHERE ${opportunities.status} = 'on_hold')::int`,
        heldValue: sql<string>`coalesce(sum(${opportunities.estimatedValue}) FILTER (WHERE ${opportunities.status} = 'on_hold'), 0)::numeric(18,2)::text`,
      })
      .from(opportunities)
      .where(where);
    return [
      { label: 'Opportunities', value: count(row?.total ?? 0), kind: 'count' },
      { label: 'Active opportunities', value: count(row?.active ?? 0), kind: 'count' },
      { label: 'Estimated active pipeline', value: row?.activeValue ?? '0.00', kind: 'money' },
      { label: 'On Hold (not in active pipeline)', value: row?.heldValue ?? '0.00', kind: 'money' },
    ];
  },
  coveredOpportunityIds(context) {
    return idsOf(
      context.db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(opportunityWhere(context, dateWithin(opportunityCreatedDate, context.filters.from, context.filters.to))),
    );
  },
};

// ---------------------------------------------------------------------------
// Opportunities by section and owner (created date)
// ---------------------------------------------------------------------------

const closedRecord = sql`(${opportunities.stage} IN ('awarded', 'lost') OR ${opportunities.status} = 'cancelled')`;

const sectionOwnerAggregates = {
  active: sql<number>`count(*) FILTER (WHERE ${activePipeline()})::int`,
  onHold: sql<number>`count(*) FILTER (WHERE ${opportunities.status} = 'on_hold')::int`,
  closed: sql<number>`count(*) FILTER (WHERE ${closedRecord})::int`,
  estimatedPipeline: sql<string>`coalesce(sum(${opportunities.estimatedValue}) FILTER (WHERE ${activePipeline()}), 0)::numeric(18,2)::text`,
  awardedValue: sql<string>`coalesce(sum(${opportunities.awardedValue}) FILTER (WHERE ${opportunities.stage} = 'awarded'), 0)::numeric(18,2)::text`,
};

const sectionOwnerReport: ReportSpec = {
  key: 'section_owner',
  columns: [
    { key: 'section', label: 'Section', kind: 'text', sort: sql`${sections.name}` },
    { key: 'owner', label: 'Owner', kind: 'text', sort: sql`${owner.fullName}` },
    { key: 'active', label: 'Active', kind: 'count', sort: sectionOwnerAggregates.active },
    { key: 'onHold', label: 'On Hold', kind: 'count', sort: sectionOwnerAggregates.onHold },
    { key: 'closed', label: 'Closed', kind: 'count', sort: sectionOwnerAggregates.closed },
    { key: 'estimatedPipeline', label: 'Est. active pipeline (BDT)', kind: 'money', sort: sql`sum(${opportunities.estimatedValue}) FILTER (WHERE ${activePipeline()})` },
    { key: 'awardedValue', label: 'Awarded value, actual (BDT)', kind: 'money', sort: sql`sum(${opportunities.awardedValue}) FILTER (WHERE ${opportunities.stage} = 'awarded')` },
  ],
  defaultSort: 'section',
  defaultDir: 'asc',
  async rows(context, order, limit, offset) {
    const where = opportunityWhere(context, dateWithin(opportunityCreatedDate, context.filters.from, context.filters.to));
    const grouped = context.db
      .select({
        ownerId: owner.id,
        owner: owner.fullName,
        section: sections.name,
        ...sectionOwnerAggregates,
      })
      .from(opportunities)
      .innerJoin(owner, eq(owner.id, opportunities.ownerId))
      .innerJoin(sections, eq(sections.id, opportunities.sectionId))
      .where(where)
      .groupBy(owner.id, owner.fullName, sections.id, sections.name)
      .orderBy(...order.sql, asc(sections.name), asc(owner.fullName), asc(owner.id));
    const rows = limit === undefined ? await grouped : await grouped.limit(limit).offset(offset);
    const [total] = await context.db
      .select({ value: sql<number>`count(DISTINCT (${opportunities.ownerId}, ${opportunities.sectionId}))::int` })
      .from(opportunities)
      .where(where);
    return {
      rows: rows.map(({ ownerId: _ownerId, ...cells }) => ({ cells, opportunityId: null })),
      total: total?.value ?? 0,
    };
  },
  async summary(context) {
    const where = opportunityWhere(context, dateWithin(opportunityCreatedDate, context.filters.from, context.filters.to));
    const [row] = await context.db
      .select({ owners: sql<number>`count(DISTINCT ${opportunities.ownerId})::int`, ...sectionOwnerAggregates })
      .from(opportunities)
      .where(where);
    return [
      { label: 'Owners', value: count(row?.owners ?? 0), kind: 'count' },
      { label: 'Active opportunities', value: count(row?.active ?? 0), kind: 'count' },
      { label: 'Estimated active pipeline', value: row?.estimatedPipeline ?? '0.00', kind: 'money' },
      { label: 'Awarded value (actual)', value: row?.awardedValue ?? '0.00', kind: 'money' },
    ];
  },
  coveredOpportunityIds: (context) => pipelineReport.coveredOpportunityIds(context),
};

// ---------------------------------------------------------------------------
// Overdue follow-ups (follow-up due date)
// ---------------------------------------------------------------------------

function overdueWhere(context: ReportContext): SQL {
  return opportunityWhere(
    context,
    overdueFollowUp(context.today),
    dateWithin(sql`${followUps.dueDate}`, context.filters.from, context.filters.to),
  );
}

const overdueReport: ReportSpec = {
  key: 'overdue_follow_ups',
  columns: [
    { key: 'task', label: 'Task', kind: 'text', sort: sql`${followUps.title}` },
    { key: 'opportunity', label: 'Opportunity', kind: 'text', sort: sql`${opportunities.name}` },
    { key: 'reference', label: 'Reference', kind: 'text', sort: sql`${opportunities.reference}` },
    { key: 'assignee', label: 'Assigned to', kind: 'text', sort: sql`${assignee.fullName}` },
    { key: 'owner', label: 'Opportunity owner', kind: 'text', sort: sql`${owner.fullName}` },
    { key: 'section', label: 'Section', kind: 'text', sort: sql`${sections.name}` },
    { key: 'dueDate', label: 'Due date', kind: 'date', sort: sql`${followUps.dueDate}` },
    { key: 'daysOverdue', label: 'Days overdue', kind: 'count', sort: sql`${followUps.dueDate}` },
    { key: 'priority', label: 'Priority', kind: 'text', sort: sql`CASE ${followUps.priority} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END` },
    { key: 'opportunityStatus', label: 'Opportunity status', kind: 'text', sort: sql`${opportunities.status}` },
  ],
  defaultSort: 'dueDate',
  defaultDir: 'asc',
  async rows(context, order, limit, offset) {
    const where = overdueWhere(context);
    const query = context.db
      .select({
        id: followUps.id,
        opportunityId: opportunities.id,
        task: followUps.title,
        opportunity: opportunities.name,
        reference: opportunities.reference,
        assignee: assignee.fullName,
        owner: owner.fullName,
        section: sections.name,
        dueDate: followUps.dueDate,
        daysOverdue: sql<number>`(${context.today}::date - ${followUps.dueDate})::int`,
        priority: followUps.priority,
        status: opportunities.status,
      })
      .from(followUps)
      .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
      .innerJoin(assignee, eq(assignee.id, followUps.assignedUserId))
      .innerJoin(owner, eq(owner.id, opportunities.ownerId))
      .innerJoin(sections, eq(sections.id, opportunities.sectionId))
      .where(where)
      .orderBy(...order.sql, asc(followUps.dueDate), asc(followUps.createdAt), asc(followUps.id));
    const rows = limit === undefined ? await query : await query.limit(limit).offset(offset);
    const [total] = await context.db
      .select({ value: sql<number>`count(*)::int` })
      .from(followUps)
      .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
      .where(where);
    return {
      rows: rows.map((row) => ({
        opportunityId: row.opportunityId,
        cells: {
          task: row.task,
          opportunity: row.opportunity,
          reference: row.reference,
          assignee: row.assignee,
          owner: row.owner,
          section: row.section,
          dueDate: row.dueDate,
          daysOverdue: row.daysOverdue,
          priority: PRIORITY_LABELS[row.priority],
          opportunityStatus: STATUS_LABELS[row.status],
        },
      })),
      total: total?.value ?? 0,
    };
  },
  async summary(context) {
    const [row] = await context.db
      .select({
        notHeld: sql<number>`count(*) FILTER (WHERE ${opportunities.status} <> 'on_hold')::int`,
        held: sql<number>`count(*) FILTER (WHERE ${opportunities.status} = 'on_hold')::int`,
        high: sql<number>`count(*) FILTER (WHERE ${followUps.priority} = 'high')::int`,
      })
      .from(followUps)
      .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
      .where(overdueWhere(context));
    return [
      { label: 'Overdue follow-ups', value: count(row?.notHeld ?? 0), kind: 'count' },
      { label: 'Overdue on On Hold records', value: count(row?.held ?? 0), kind: 'count' },
      { label: 'High priority', value: count(row?.high ?? 0), kind: 'count' },
    ];
  },
  coveredOpportunityIds(context) {
    return idsOf(
      context.db
        .select({ id: opportunities.id })
        .from(followUps)
        .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
        .where(overdueWhere(context)),
    );
  },
};

// ---------------------------------------------------------------------------
// Upcoming tender submissions (submission deadline)
// ---------------------------------------------------------------------------

function upcomingTenderWhere(context: ReportContext): SQL {
  return opportunityWhere(
    context,
    participatingCurrentNotice(),
    sql`${tenders.submissionDeadline} >= ${context.at.toISOString()}::timestamptz`,
    dateWithin(tenderDeadlineDate, context.filters.from, context.filters.to),
  );
}

const tenderReport: ReportSpec = {
  key: 'upcoming_tenders',
  columns: [
    { key: 'reference', label: 'Reference', kind: 'text', sort: sql`${tenders.reference}` },
    { key: 'tender', label: 'Tender', kind: 'text', sort: sql`${tenders.title}` },
    { key: 'opportunity', label: 'Opportunity', kind: 'text', sort: sql`${opportunities.name}` },
    { key: 'owner', label: 'Responsible owner', kind: 'text', sort: sql`${owner.fullName}` },
    { key: 'section', label: 'Section', kind: 'text', sort: sql`${sections.name}` },
    { key: 'submissionDeadline', label: 'Submission deadline', kind: 'instant', sort: sql`${tenders.submissionDeadline}` },
    { key: 'bidStatus', label: 'Bid status', kind: 'text', sort: sql`${tenders.bidStatus}` },
    { key: 'indicator', label: 'Deadline indicator', kind: 'text', sort: sql`${tenders.submissionDeadline}` },
  ],
  defaultSort: 'submissionDeadline',
  defaultDir: 'asc',
  async rows(context, order, limit, offset) {
    const where = upcomingTenderWhere(context);
    const query = context.db
      .select({
        opportunityId: opportunities.id,
        reference: tenders.reference,
        tender: tenders.title,
        opportunity: opportunities.name,
        owner: owner.fullName,
        section: sections.name,
        submissionDeadline: tenders.submissionDeadline,
        bidStatus: tenders.bidStatus,
        noticeState: tenders.noticeState,
        opportunityStage: opportunities.stage,
        opportunityStatus: opportunities.status,
      })
      .from(tenders)
      .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
      .innerJoin(owner, eq(owner.id, opportunities.ownerId))
      .innerJoin(sections, eq(sections.id, opportunities.sectionId))
      .where(where)
      .orderBy(...order.sql, asc(tenders.submissionDeadline), asc(tenders.id));
    const rows = limit === undefined ? await query : await query.limit(limit).offset(offset);
    const [total] = await context.db
      .select({ value: sql<number>`count(*)::int` })
      .from(tenders)
      .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
      .where(where);
    return {
      rows: rows.map((row) => ({
        opportunityId: row.opportunityId,
        cells: {
          reference: row.reference,
          tender: row.tender,
          opportunity: row.opportunity,
          owner: row.owner,
          section: row.section,
          submissionDeadline: row.submissionDeadline.toISOString(),
          bidStatus: BID_STATUS_LABELS[row.bidStatus],
          indicator: TENDER_INDICATOR_LABELS[tenderIndicator(row, context.at)],
        },
      })),
      total: total?.value ?? 0,
    };
  },
  async summary(context) {
    const [row] = await context.db
      .select({
        total: sql<number>`count(*)::int`,
        dueSoon: sql<number>`count(*) FILTER (WHERE ${tenderDueWithin(context.at, TENDER_DUE_SOON_HOURS)})::int`,
        dueWeek: sql<number>`count(*) FILTER (WHERE ${tenderDueWithin(context.at, SEVEN_DAYS_HOURS)})::int`,
      })
      .from(tenders)
      .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
      .where(upcomingTenderWhere(context));
    return [
      { label: 'Upcoming submissions', value: count(row?.total ?? 0), kind: 'count' },
      { label: 'Due within 72 hours', value: count(row?.dueSoon ?? 0), kind: 'count' },
      { label: 'Due within 7 days', value: count(row?.dueWeek ?? 0), kind: 'count' },
    ];
  },
  coveredOpportunityIds(context) {
    return idsOf(
      context.db
        .select({ id: opportunities.id })
        .from(tenders)
        .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
        .where(upcomingTenderWhere(context)),
    );
  },
};

// ---------------------------------------------------------------------------
// Awarded and lost opportunities (award date / lost date)
// ---------------------------------------------------------------------------

const outcomeDate = sql`(CASE WHEN ${opportunities.stage} = 'awarded' THEN ${opportunities.awardDate} ELSE ${opportunities.closedDate} END)`;
const isOutcome = sql`${opportunities.stage} IN ('awarded', 'lost')`;

function outcomeWhere(context: ReportContext, dated = true): SQL {
  return opportunityWhere(context, isOutcome, dated ? dateWithin(outcomeDate, context.filters.from, context.filters.to) : undefined);
}

const outcomesReport: ReportSpec = {
  key: 'outcomes',
  columns: [
    { key: 'opportunity', label: 'Opportunity', kind: 'text', sort: sql`${opportunities.name}` },
    { key: 'reference', label: 'Reference', kind: 'text', sort: sql`${opportunities.reference}` },
    { key: 'organization', label: 'Organization', kind: 'text', sort: sql`${organizations.name}` },
    { key: 'owner', label: 'Owner', kind: 'text', sort: sql`${owner.fullName}` },
    { key: 'section', label: 'Section', kind: 'text', sort: sql`${sections.name}` },
    { key: 'outcome', label: 'Outcome', kind: 'text', sort: sql`${opportunities.stage}` },
    { key: 'estimatedValue', label: 'Estimated (BDT)', kind: 'money', sort: sql`${opportunities.estimatedValue}` },
    { key: 'awardedValue', label: 'Actual awarded (BDT)', kind: 'money', sort: sql`${opportunities.awardedValue}` },
    { key: 'outcomeDate', label: 'Award or lost date', kind: 'date', sort: outcomeDate },
    { key: 'lostReason', label: 'Lost reason', kind: 'text', sort: sql`${opportunities.lossReason}` },
  ],
  defaultSort: 'outcomeDate',
  defaultDir: 'desc',
  async rows(context, order, limit, offset) {
    const where = outcomeWhere(context);
    const query = context.db
      .select({
        opportunityId: opportunities.id,
        opportunity: opportunities.name,
        reference: opportunities.reference,
        organization: organizations.name,
        owner: owner.fullName,
        section: sections.name,
        stage: opportunities.stage,
        estimatedValue: opportunities.estimatedValue,
        awardedValue: opportunities.awardedValue,
        outcomeDate: sql<string | null>`${outcomeDate}::text`,
        lossReason: opportunities.lossReason,
        lossNote: opportunities.lossNote,
      })
      .from(opportunities)
      .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
      .innerJoin(owner, eq(owner.id, opportunities.ownerId))
      .innerJoin(sections, eq(sections.id, opportunities.sectionId))
      .where(where)
      .orderBy(...order.sql, desc(opportunities.createdAt), asc(opportunities.id));
    const rows = limit === undefined ? await query : await query.limit(limit).offset(offset);
    const [total] = await context.db.select({ value: sql<number>`count(*)::int` }).from(opportunities).where(where);
    return {
      rows: rows.map((row) => ({
        opportunityId: row.opportunityId,
        cells: {
          opportunity: row.opportunity,
          reference: row.reference,
          organization: row.organization,
          owner: row.owner,
          section: row.section,
          outcome: STAGE_LABELS[row.stage],
          estimatedValue: row.estimatedValue,
          awardedValue: row.stage === 'awarded' ? row.awardedValue : null,
          outcomeDate: row.outcomeDate,
          lostReason:
            row.stage === 'lost' && row.lossReason
              ? `${LOSS_REASON_LABELS[row.lossReason as LossReason]}${row.lossNote ? ` — ${row.lossNote}` : ''}`
              : null,
        },
      })),
      total: total?.value ?? 0,
    };
  },
  async summary(context) {
    const [row] = await context.db
      .select({
        awarded: sql<number>`count(*) FILTER (WHERE ${opportunities.stage} = 'awarded')::int`,
        awardedValue: sql<string>`coalesce(sum(${opportunities.awardedValue}) FILTER (WHERE ${opportunities.stage} = 'awarded'), 0)::numeric(18,2)::text`,
        lost: sql<number>`count(*) FILTER (WHERE ${opportunities.stage} = 'lost')::int`,
      })
      .from(opportunities)
      .where(outcomeWhere(context));
    const awarded = row?.awarded ?? 0;
    const lost = row?.lost ?? 0;
    return [
      { label: 'Awarded', value: count(awarded), kind: 'count' },
      { label: 'Actual awarded value', value: row?.awardedValue ?? '0.00', kind: 'money' },
      { label: 'Lost', value: count(lost), kind: 'count' },
      { label: 'Win rate', value: awarded + lost > 0 ? `${Math.round((awarded / (awarded + lost)) * 100)}%` : '—', kind: 'percent' },
    ];
  },
  async undated(context) {
    const [row] = await context.db
      .select({ value: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(and(outcomeWhere(context, false), sql`${outcomeDate} IS NULL`));
    return row?.value ?? 0;
  },
  coveredOpportunityIds(context) {
    return idsOf(context.db.select({ id: opportunities.id }).from(opportunities).where(outcomeWhere(context)));
  },
};

// ---------------------------------------------------------------------------
// Lost reasons (lost date)
// ---------------------------------------------------------------------------

function lostWhere(context: ReportContext, dated = true): SQL {
  return opportunityWhere(
    context,
    eq(opportunities.stage, 'lost'),
    dated ? dateWithin(sql`${opportunities.closedDate}`, context.filters.from, context.filters.to) : undefined,
  );
}

const lostReasonsReport: ReportSpec = {
  key: 'lost_reasons',
  columns: [
    { key: 'reason', label: 'Reason', kind: 'text', sort: sql`${opportunities.lossReason}` },
    { key: 'count', label: 'Count', kind: 'count', sort: sql`count(*)` },
    { key: 'estimatedValue', label: 'Estimated value lost (BDT)', kind: 'money', sort: sql`sum(${opportunities.estimatedValue})` },
    { key: 'opportunities', label: 'Opportunities', kind: 'text' },
  ],
  defaultSort: 'count',
  defaultDir: 'desc',
  async rows(context, order, limit, offset) {
    const where = lostWhere(context);
    const query = context.db
      .select({
        reason: opportunities.lossReason,
        count: sql<number>`count(*)::int`,
        estimatedValue: sumMoney(sql`${opportunities.estimatedValue}`),
        opportunities: sql<string>`string_agg(${opportunities.name}, '; ' ORDER BY ${opportunities.name})`,
      })
      .from(opportunities)
      .where(where)
      .groupBy(opportunities.lossReason)
      .orderBy(...order.sql, asc(opportunities.lossReason));
    const rows = limit === undefined ? await query : await query.limit(limit).offset(offset);
    const [total] = await context.db
      .select({ value: sql<number>`count(DISTINCT ${opportunities.lossReason})::int` })
      .from(opportunities)
      .where(where);
    return {
      rows: rows.map((row) => ({
        opportunityId: null,
        cells: {
          reason: row.reason ? LOSS_REASON_LABELS[row.reason as LossReason] : 'Not specified',
          count: row.count,
          estimatedValue: row.estimatedValue,
          opportunities: row.opportunities,
        },
      })),
      total: total?.value ?? 0,
    };
  },
  async summary(context) {
    const [row] = await context.db
      .select({ count: sql<number>`count(*)::int`, value: sumMoney(sql`${opportunities.estimatedValue}`) })
      .from(opportunities)
      .where(lostWhere(context));
    return [
      { label: 'Lost opportunities', value: count(row?.count ?? 0), kind: 'count' },
      { label: 'Estimated value lost', value: row?.value ?? '0.00', kind: 'money' },
    ];
  },
  async undated(context) {
    const [row] = await context.db
      .select({ value: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(and(lostWhere(context, false), sql`${opportunities.closedDate} IS NULL`));
    return row?.value ?? 0;
  },
  coveredOpportunityIds(context) {
    return idsOf(context.db.select({ id: opportunities.id }).from(opportunities).where(lostWhere(context)));
  },
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const SPECS: Record<ReportKey, ReportSpec> = {
  pipeline: pipelineReport,
  section_owner: sectionOwnerReport,
  overdue_follow_ups: overdueReport,
  upcoming_tenders: tenderReport,
  outcomes: outcomesReport,
  lost_reasons: lostReasonsReport,
};

export function reportColumns(key: ReportKey): ReportColumn[] {
  return SPECS[key].columns;
}

function isSortable(column: ReportColumn): boolean {
  return column.sort !== undefined || column.sortAfterAggregation === true;
}

/** Sort keys are an allowlist: a report's own sortable columns, nothing else (plan 3.3). */
function resolveOrder(spec: ReportSpec, sort: string | undefined, dir: 'asc' | 'desc' | undefined): ReportOrder {
  const key = sort ?? spec.defaultSort;
  const column = spec.columns.find((candidate) => candidate.key === key);
  if (!column || !isSortable(column)) {
    throw validationFailed({ sort: 'This report cannot be sorted by that column.' });
  }
  const direction = dir ?? spec.defaultDir;
  const expression = column.sort;
  return {
    key,
    dir: direction,
    sql: expression ? [direction === 'asc' ? sql`${expression} ASC NULLS LAST` : sql`${expression} DESC NULLS LAST`] : [],
  };
}

/** Request-time check for an export, so an unknown sort fails with 422 instead of in the job. */
export function assertReportSort(key: ReportKey, sort: string | undefined, dir: 'asc' | 'desc' | undefined): void {
  resolveOrder(SPECS[key], sort, dir);
}

function createContext(db: Database, actor: Actor, filters: ReportFilters): ReportContext {
  assertReportFilters(actor, filters);
  const at = now();
  return { db, actor, filters, at, today: dhakaDateOf(at) };
}

export async function getReport(
  db: Database,
  actor: Actor,
  key: ReportKey,
  query: ReportFilters & { page: number; pageSize: number; sort?: string | undefined; dir?: 'asc' | 'desc' | undefined },
): Promise<ReportDto> {
  const spec = SPECS[key];
  const context = createContext(db, actor, query);
  const order = resolveOrder(spec, query.sort, query.dir);

  const page = await spec.rows(context, order, query.pageSize, (query.page - 1) * query.pageSize);
  const summary = await spec.summary(context);
  const definition = reportDefinition(key);

  let undated: ReportDto['undated'] = null;
  if (spec.undated) {
    const value = await spec.undated(context);
    const basis = DATE_BASIS_LABELS[definition.dateBasis];
    undated = {
      count: value,
      note:
        value === 0
          ? `Every matching record has a date for this basis (${basis}).`
          : `${value} matching record${value === 1 ? ' has' : 's have'} no date for this basis (${basis}) and ${
              query.from || query.to ? (value === 1 ? 'is' : 'are') + ' not included in this date range' : (value === 1 ? 'is' : 'are') + ' included above'
            }.`,
    };
  }

  return {
    report: key,
    label: definition.label,
    dateBasis: { key: definition.dateBasis, label: DATE_BASIS_LABELS[definition.dateBasis] },
    filters: {
      from: query.from ?? null,
      to: query.to ?? null,
      sectionId: query.sectionId ?? null,
      ownerId: query.ownerId ?? null,
    },
    sort: order.key,
    dir: order.dir,
    columns: spec.columns.map((column) => ({
      key: column.key,
      label: column.label,
      kind: column.kind,
      sortable: isSortable(column),
    })),
    items: page.rows,
    total: page.total,
    page: query.page,
    pageSize: query.pageSize,
    summary,
    undated,
    today: context.today,
    scopeLabel: scopeLabel(actor),
  };
}

/**
 * Every row of a report under the requester's current scope, for the CSV
 * export (FR-083: all matching records, not just the visible page). Returns
 * the opportunities it drew on so delivery can re-check access.
 */
export async function getReportForExport(
  db: Database,
  actor: Actor,
  key: ReportKey,
  filters: ReportFilters & { sort?: string | undefined; dir?: 'asc' | 'desc' | undefined },
): Promise<{ columns: ReportColumn[]; rows: ReportRowDto[]; opportunityIds: string[] }> {
  const spec = SPECS[key];
  const context = createContext(db, actor, filters);
  const page = await spec.rows(context, resolveOrder(spec, filters.sort, filters.dir), undefined, 0);
  return { columns: spec.columns, rows: page.rows, opportunityIds: await spec.coveredOpportunityIds(context) };
}
