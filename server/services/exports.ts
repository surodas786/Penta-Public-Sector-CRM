/**
 * Queued CSV exports (FR-083, NFR-011, SEC-005).
 *
 *   request    validates the filters exactly as the visible report or list
 *              does, then records the export, its job and a
 *              `report.export_requested` audit event in one transaction.
 *   generate   (background job) re-reads the requester's account, refuses if
 *              their access has gone, runs the report under their current
 *              scope over every matching row, and stores the file, the row
 *              count and the opportunities it drew on, auditing
 *              `report.exported` with the record count in the same
 *              transaction.
 *   deliver    re-checks on every download that the requester may still see
 *              every one of those opportunities with the same filters. If a
 *              transfer or role change removed any of them, the file is
 *              refused and must be produced again (SEC-005: authorization is
 *              rechecked when the export is delivered, not only when queued).
 */
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { ReportCell, ReportExportDto } from '../../shared/api.js';
import {
  PRIORITY_LABELS,
  SOLUTION_CATEGORY_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
} from '../../shared/enums.js';
import { EXPORT_KIND_LABELS, type ExportKind, type ReportKey } from '../../shared/reporting.js';
import { listOpportunitiesQuerySchema, reportQuerySchema } from '../../shared/validation.js';
import { dhakaDateOf, now } from '../clock.js';
import type { Database } from '../db/client.js';
import { opportunities, reportExports, sections, users } from '../db/schema.js';
import { ApiError, notFound } from '../http/errors.js';
import { parseOrThrow } from '../http/validate.js';
import { enqueueJob } from '../jobs/queue.js';
import type { Actor } from '../policy/actor.js';
import { canViewCommercialReports, scopedWhere } from '../policy/scope.js';
import { recordAuditEvent } from './audit.js';
import { buildCsv, type CsvColumn } from './csv.js';
import { assertReportFilters } from './dashboard.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { listOpportunitiesForExport } from './opportunities.js';
import { assertReportSort, getReportForExport } from './reports.js';

export interface ExportSettings {
  ttlHours: number;
  maxRows: number;
}

const exportUnavailable = (message: string) => new ApiError(409, 'export_unavailable', message);

type ReportExportFilters = z.output<typeof reportQuerySchema>;
type OpportunityExportFilters = z.output<typeof listOpportunitiesQuerySchema>;

/** Paging is the screen's; an export always covers every matching record. */
const PAGING_KEYS = new Set(['page', 'pageSize']);

function withoutPaging(filters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([key]) => !PAGING_KEYS.has(key)));
}

/**
 * Validates an export's filters with the schema of the screen it came from,
 * and applies that screen's filter permissions (FR-082, FR-083).
 */
export function validateExportFilters(actor: Actor, kind: ExportKind, raw: Record<string, string>): Record<string, unknown> {
  if (!canViewCommercialReports(actor)) {
    throw new ApiError(403, 'forbidden', 'Commercial exports are not available to the System Administrator role.');
  }
  const filters = withoutPaging(raw);
  if (kind === 'opportunities') {
    const parsed = parseOrThrow(listOpportunitiesQuerySchema, filters) as OpportunityExportFilters;
    const { page: _page, pageSize: _pageSize, ...rest } = parsed;
    return rest;
  }
  const parsed = parseOrThrow(reportQuerySchema, filters) as ReportExportFilters;
  assertReportFilters(actor, parsed);
  assertReportSort(kind as ReportKey, parsed.sort, parsed.dir);
  const { page: _page, pageSize: _pageSize, ...rest } = parsed;
  return rest;
}

function toDto(row: typeof reportExports.$inferSelect): ReportExportDto {
  return {
    id: row.id,
    kind: row.kind,
    label: EXPORT_KIND_LABELS[row.kind],
    status: row.status,
    rowCount: row.rowCount,
    fileName: row.fileName,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    failureReason: row.failureReason,
  };
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export async function requestExport(options: {
  db: Database;
  actor: Actor;
  kind: ExportKind;
  filters: Record<string, string>;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<ReportExportDto> {
  const { db, actor, kind, requestId, completeClaim } = options;
  const filters = validateExportFilters(actor, kind, options.filters);

  const id = await db.transaction(async (tx) => {
    const timestamp = now();
    const [created] = await tx
      .insert(reportExports)
      .values({ requestedBy: actor.id, kind, filters, requestId, createdAt: timestamp })
      .returning({ id: reportExports.id });
    if (!created) throw new Error('Export insert returned no row.');

    await enqueueJob(tx, { kind: 'report_export', payload: { exportId: created.id }, maxAttempts: 3 });
    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'report_export',
      entityId: created.id,
      action: 'report.export_requested',
      domain: 'reporting',
      after: { kind, filters },
      requestId,
    });
    await completeClaim(tx, created.id);
    return created.id;
  });

  return getExport(db, actor, id);
}

/** Only the requester sees an export; anyone else gets the standard 404. */
export async function getExport(db: Database, actor: Actor, exportId: string): Promise<ReportExportDto> {
  const [row] = await db
    .select()
    .from(reportExports)
    .where(and(eq(reportExports.id, exportId), eq(reportExports.requestedBy, actor.id)))
    .limit(1);
  if (!row) throw notFound(`export ${exportId} absent or not requested by actor ${actor.id}`);
  return toDto(row);
}

// ---------------------------------------------------------------------------
// Generation (background job)
// ---------------------------------------------------------------------------

/** The requester as they are now, read fresh, never from the queued request. */
async function loadActor(db: Database, userId: string): Promise<Actor | null> {
  const [row] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      sectionId: users.sectionId,
      sectionName: sections.name,
      active: users.active,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .leftJoin(sections, eq(sections.id, users.sectionId))
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

const OPPORTUNITY_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'reference', label: 'Reference', kind: 'text' },
  { key: 'name', label: 'Opportunity', kind: 'text' },
  { key: 'organization', label: 'Procuring organization', kind: 'text' },
  { key: 'solutionCategory', label: 'Solution category', kind: 'text' },
  { key: 'stage', label: 'Stage', kind: 'text' },
  { key: 'status', label: 'Status', kind: 'text' },
  { key: 'priority', label: 'Priority', kind: 'text' },
  { key: 'owner', label: 'Owner', kind: 'text' },
  { key: 'section', label: 'Section', kind: 'text' },
  { key: 'estimatedValue', label: 'Estimated value (BDT)', kind: 'money' },
  { key: 'awardedValue', label: 'Actual awarded value (BDT)', kind: 'money' },
  { key: 'expectedAwardDate', label: 'Expected award date', kind: 'date' },
  { key: 'nextAction', label: 'Next action', kind: 'text' },
  { key: 'nextActionDue', label: 'Next action due', kind: 'date' },
  { key: 'createdAt', label: 'Created', kind: 'instant' },
];

async function produceRows(
  db: Database,
  actor: Actor,
  kind: ExportKind,
  filters: Record<string, unknown>,
  maxRows: number,
): Promise<{ columns: CsvColumn[]; rows: Record<string, ReportCell>[]; opportunityIds: string[] }> {
  if (kind === 'opportunities') {
    const query = filters as Omit<OpportunityExportFilters, 'page' | 'pageSize'>;
    const items = await listOpportunitiesForExport(db, actor, query, maxRows + 1);
    return {
      columns: OPPORTUNITY_EXPORT_COLUMNS,
      opportunityIds: items.map((item) => item.id),
      rows: items.map((item) => ({
        reference: item.reference,
        name: item.name,
        organization: item.organization.name,
        solutionCategory: SOLUTION_CATEGORY_LABELS[item.solutionCategory],
        stage: STAGE_LABELS[item.stage],
        status: STATUS_LABELS[item.status],
        priority: PRIORITY_LABELS[item.priority],
        owner: item.ownerName,
        section: item.sectionName,
        estimatedValue: item.estimatedValue,
        awardedValue: item.awardedValue,
        expectedAwardDate: item.expectedAwardDate,
        nextAction: item.nextAction?.title ?? null,
        nextActionDue: item.nextAction?.dueDate ?? null,
        createdAt: item.createdAt,
      })),
    };
  }
  const report = await getReportForExport(db, actor, kind as ReportKey, filters as ReportExportFilters);
  return {
    columns: report.columns,
    rows: report.rows.map((row) => row.cells),
    opportunityIds: report.opportunityIds,
  };
}

async function failExport(db: Database, exportId: string, reason: string): Promise<void> {
  await db
    .update(reportExports)
    .set({ status: 'failed', failureReason: reason, completedAt: now() })
    .where(and(eq(reportExports.id, exportId), inArray(reportExports.status, ['queued', 'running'])));
}

/**
 * Produces one export. A refusal that will not change on retry (access gone,
 * too many rows) fails the export at once; anything unexpected is thrown so
 * the job is retried, and `onFinalFailure` fails the export after the last
 * attempt.
 */
export async function generateExport(db: Database, exportId: string, settings: ExportSettings): Promise<void> {
  const [record] = await db.select().from(reportExports).where(eq(reportExports.id, exportId)).limit(1);
  if (!record || (record.status !== 'queued' && record.status !== 'running')) return;

  const actor = await loadActor(db, record.requestedBy);
  if (!actor || !canViewCommercialReports(actor)) {
    await failExport(db, exportId, 'Your access changed before the export was prepared.');
    return;
  }
  await db.update(reportExports).set({ status: 'running' }).where(eq(reportExports.id, exportId));

  let produced: Awaited<ReturnType<typeof produceRows>>;
  try {
    produced = await produceRows(db, actor, record.kind, record.filters as Record<string, unknown>, settings.maxRows);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      // The filters are no longer permitted for this account (FR-082).
      await failExport(db, exportId, 'Your access changed before the export was prepared.');
      return;
    }
    throw error;
  }
  if (produced.rows.length > settings.maxRows) {
    await failExport(db, exportId, `More than ${settings.maxRows} rows match. Narrow the filters and export again.`);
    return;
  }

  const at = now();
  const fileName = `penta-${record.kind.replace(/_/g, '-')}-${dhakaDateOf(at)}.csv`;
  const content = buildCsv(produced.columns, produced.rows);

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(reportExports)
      .set({
        status: 'ready',
        content,
        fileName,
        rowCount: produced.rows.length,
        opportunityIds: produced.opportunityIds,
        completedAt: at,
        expiresAt: new Date(at.getTime() + settings.ttlHours * 3_600_000),
      })
      .where(and(eq(reportExports.id, exportId), eq(reportExports.status, 'running')))
      .returning({ id: reportExports.id });
    if (updated.length === 0) return;
    // FR-083 / FR-062: who exported which report, and how many records.
    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'report_export',
      entityId: exportId,
      action: 'report.exported',
      domain: 'reporting',
      after: { kind: record.kind, filters: record.filters, rowCount: produced.rows.length },
      requestId: record.requestId,
    });
  });
}

export async function failExportAfterRetries(db: Database, exportId: string): Promise<void> {
  await failExport(db, exportId, 'The export could not be prepared. Try again later.');
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export async function downloadExport(
  db: Database,
  actor: Actor,
  exportId: string,
  requestId: string,
): Promise<{ fileName: string; content: string }> {
  const [record] = await db
    .select()
    .from(reportExports)
    .where(and(eq(reportExports.id, exportId), eq(reportExports.requestedBy, actor.id)))
    .limit(1);
  if (!record) throw notFound(`export ${exportId} absent or not requested by actor ${actor.id}`);

  if (record.status === 'failed') throw exportUnavailable(record.failureReason ?? 'The export failed.');
  if (record.status !== 'ready' || !record.content || !record.opportunityIds) {
    throw exportUnavailable('The export is still being prepared.');
  }
  if (record.expiresAt && record.expiresAt.getTime() <= now().getTime()) {
    throw exportUnavailable('This export has expired. Run it again.');
  }

  // The filters must still be permitted, and every record must still be visible.
  const stale = exportUnavailable('Your access has changed since this export was prepared. Run the export again.');
  if (record.kind !== 'opportunities') {
    try {
      assertReportFilters(actor, record.filters as { sectionId?: string; ownerId?: string });
    } catch {
      throw stale;
    }
  }
  const ids = record.opportunityIds;
  if (ids.length > 0) {
    const [visible] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(scopedWhere(actor, inArray(opportunities.id, ids)));
    if ((visible?.value ?? 0) !== new Set(ids).size) throw stale;
  }
  await db.transaction(async (tx) => {
    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'report_export',
      entityId: record.id,
      action: 'report.export_downloaded',
      domain: 'reporting',
      after: { kind: record.kind, rowCount: record.rowCount },
      requestId,
    });
  });

  return { fileName: record.fileName ?? 'penta-export.csv', content: record.content };
}

/** Housekeeping: ready files past their expiry and old failures are removed. */
export async function purgeExpiredExports(db: Database, at: Date = now()): Promise<number> {
  const weekAgo = new Date(at.getTime() - 7 * 24 * 3_600_000);
  const removed = await db
    .delete(reportExports)
    .where(
      or(
        lt(reportExports.expiresAt, at),
        and(eq(reportExports.status, 'failed'), lt(reportExports.createdAt, weekAgo)),
      ),
    )
    .returning({ id: reportExports.id });
  return removed.length;
}
