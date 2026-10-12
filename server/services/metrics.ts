/**
 * The metric definitions of §10.1, written once as SQL predicates.
 *
 * FR-081 requires cards, charts, lists and exports to share their query
 * definitions, so the dashboard, the reports, the opportunity and follow-up
 * list filters and the CSV exports all compose these fragments rather than
 * restating them. Each one is a filter on top of `opportunityScope`, never a
 * replacement for it.
 */
import { sql, type SQL } from 'drizzle-orm';

import { addCalendarDays, dhakaQuarter, dhakaToday, now } from '../clock.js';
import { followUps, opportunities, procurementCycles, tenders } from '../db/schema.js';
import type { DashboardRange } from '../../shared/reporting.js';

/** §10.1 "Active opportunities": status Active and stage neither Awarded nor Lost (BR-010, D-002). */
export function activePipeline(): SQL {
  return sql`(${opportunities.status} = 'active' AND ${opportunities.stage} NOT IN ('awarded', 'lost'))`;
}

/** Open (not closed) records: neither terminal nor Cancelled. On Hold stays open (BR-014). */
export function opportunityOpen(): SQL {
  return sql`(${opportunities.status} <> 'cancelled' AND ${opportunities.stage} NOT IN ('awarded', 'lost'))`;
}

/** The Dhaka calendar date an opportunity was created (BR-060 pipeline basis, D-005). */
export const opportunityCreatedDate: SQL = sql`((${opportunities.createdAt} AT TIME ZONE 'Asia/Dhaka')::date)`;

/** The Dhaka calendar date of a tender's submission deadline (FR-052 basis). */
export const tenderDeadlineDate: SQL = sql`((${tenders.submissionDeadline} AT TIME ZONE 'Asia/Dhaka')::date)`;

/**
 * §10.1 "Overdue follow-ups": an Open task whose due date is before today's
 * Dhaka date (FR-043). `today` is passed in so one request uses one date.
 */
export function overdueFollowUp(today: string): SQL {
  return sql`(${followUps.state} = 'open' AND ${followUps.dueDate} < ${today}::date)`;
}

export function dueTodayFollowUp(today: string): SQL {
  return sql`(${followUps.state} = 'open' AND ${followUps.dueDate} = ${today}::date)`;
}

/**
 * A notice that can still raise a deadline alert or count toward a deadline
 * metric: the current notice, still being worked on (Reviewing or
 * Preparing), on a record that is not closed. Superseded, cancelled,
 * submitted and Not Participating notices never do (BR-040, AT-10); On Hold
 * keeps its deadlines (BR-014). The same rule as the tracker's indicator.
 */
export function participatingCurrentNotice(): SQL {
  return sql`(${tenders.isCurrent} AND ${tenders.noticeState} = 'current'
    AND ${tenders.bidStatus} IN ('reviewing', 'preparing') AND ${opportunityOpen()})`;
}

/**
 * §10.1 "Tender submissions next seven days": deadlines from now up to but
 * excluding now plus seven days — an instant window, not calendar dates.
 */
export function tenderDueWithin(at: Date, hours: number): SQL {
  const end = new Date(at.getTime() + hours * 3_600_000);
  return sql`(${participatingCurrentNotice()}
    AND ${tenders.submissionDeadline} >= ${at.toISOString()}::timestamptz
    AND ${tenders.submissionDeadline} < ${end.toISOString()}::timestamptz)`;
}

export const SEVEN_DAYS_HOURS = 7 * 24;

/**
 * CR6: the deadline a Software Procurement cycle is working towards: the EOI
 * deadline while the EOI is being prepared, then the proposal deadline from
 * the RFP until the proposal is submitted. Null otherwise. Kept apart from
 * tender deadlines so goods tenders and EOI/RFP submissions are never mixed.
 */
export const procurementOpenDeadline: SQL = sql`(CASE
  WHEN ${procurementCycles.milestone} = 'eoi_preparation' THEN ${procurementCycles.eoiDeadline}
  WHEN ${procurementCycles.milestone} IN ('rfp_received', 'proposal_preparation') THEN ${procurementCycles.proposalDeadline}
  END)`;

/** The Dhaka calendar date of that deadline (the report's date basis). */
export const procurementDeadlineDate: SQL = sql`((${procurementOpenDeadline} AT TIME ZONE 'Asia/Dhaka')::date)`;

/**
 * A cycle that can count toward a deadline metric: the opportunity's current
 * cycle, not ended, not declined, on a record that is not closed. The same
 * rule as the area's indicator.
 */
export function workingProcurementCycle(): SQL {
  return sql`(${procurementCycles.isCurrent}
    AND ${procurementCycles.milestone} NOT IN ('not_shortlisted', 'awarded', 'unsuccessful', 'cancelled')
    AND ${procurementCycles.participation} <> 'not_participating' AND ${opportunityOpen()})`;
}

/** An open procurement deadline from now up to, not including, now plus `hours`. */
export function procurementDueWithin(at: Date, hours: number): SQL {
  const end = new Date(at.getTime() + hours * 3_600_000);
  return sql`(${workingProcurementCycle()}
    AND ${procurementOpenDeadline} >= ${at.toISOString()}::timestamptz
    AND ${procurementOpenDeadline} < ${end.toISOString()}::timestamptz)`;
}

/** An open procurement deadline that has passed without the submission. */
export function procurementOverdue(at: Date): SQL {
  return sql`(${workingProcurementCycle()} AND ${procurementOpenDeadline} < ${at.toISOString()}::timestamptz)`;
}

/**
 * §10.1 "Awarded value this quarter": currently Awarded records whose award
 * date falls in the current Dhaka calendar quarter. The value summed is the
 * actual awarded value, never the estimate (D-006).
 */
export function awardedInQuarter(today: string = dhakaToday()): SQL {
  const quarter = dhakaQuarter(today);
  return sql`(${opportunities.stage} = 'awarded'
    AND ${opportunities.awardDate} BETWEEN ${quarter.start}::date AND ${quarter.end}::date)`;
}

/** Inclusive Dhaka calendar bounds for the approved dashboard range filter. */
export function dashboardRangeBounds(range: DashboardRange, today: string): { from: string; to: string } | null {
  switch (range) {
    case 'last30':
      return { from: addCalendarDays(today, -30), to: today };
    case 'quarter': {
      const quarter = dhakaQuarter(today);
      return { from: quarter.start, to: quarter.end };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default:
      return null;
  }
}

/** `column BETWEEN from AND to` for a date expression, either bound optional. */
export function dateWithin(expression: SQL, from: string | null | undefined, to: string | null | undefined): SQL | undefined {
  if (from && to) return sql`(${expression} BETWEEN ${from}::date AND ${to}::date)`;
  if (from) return sql`(${expression} >= ${from}::date)`;
  if (to) return sql`(${expression} <= ${to}::date)`;
  return undefined;
}

/** Money aggregates stay decimal text; NUMERIC(18,2) leaves room for sums of NUMERIC(14,2). */
export function sumMoney(expression: SQL): SQL<string> {
  return sql<string>`coalesce(sum(${expression}), 0)::numeric(18,2)::text`;
}

export function currentInstant(): Date {
  return now();
}
