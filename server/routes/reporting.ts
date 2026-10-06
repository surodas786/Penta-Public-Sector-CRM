/**
 * Dashboards, reports, CSV exports, search and notifications (Milestone 6).
 *
 * Thin adapters: validation here, every access decision in the services
 * through server/policy/scope.ts. Commercial collections refuse an account
 * without sales access with 403 (an administrator); object routes answer the
 * standard 404 for anything the caller may not see. Search is the exception:
 * an administrator gets account and section results instead (FR-091).
 */
import { Router, type Request, type RequestHandler } from 'express';

import {
  createExportSchema,
  dashboardQuerySchema,
  listNotificationsQuerySchema,
  reportKeySchema,
  reportQuerySchema,
  searchQuerySchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth, requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { notFound, unauthenticated } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import { signalJobsEnqueued } from '../jobs/queue.js';
import { getDashboard } from '../services/dashboard.js';
import { downloadExport, getExport, requestExport } from '../services/exports.js';
import { runIdempotent } from '../services/idempotency.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadCount,
} from '../services/notifications.js';
import { getReport } from '../services/reports.js';
import { search } from '../services/search.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

const actorOf = (req: Request) => {
  if (!req.actor) throw unauthenticated();
  return req.actor;
};

function readId(value: unknown): string {
  const result = uuidField.safeParse(value);
  if (!result.success) throw notFound('malformed id parameter');
  return result.data;
}

/** Mounted at /api/dashboard. */
export function createDashboardRouter(options: { db: Database }): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    '/',
    requireSalesAccess,
    handle(async (req, res) => {
      const query = parseOrThrow(dashboardQuerySchema, singleValueQuery(req.query));
      res.json(await getDashboard(options.db, actorOf(req), query));
    }),
  );
  return router;
}

/** Mounted at /api/reports. */
export function createReportsRouter(options: { db: Database }): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    '/:report',
    requireSalesAccess,
    handle(async (req, res) => {
      const key = reportKeySchema.safeParse(req.params.report);
      if (!key.success) throw notFound('unknown report');
      const query = parseOrThrow(reportQuerySchema, singleValueQuery(req.query));
      res.json(await getReport(options.db, actorOf(req), key.data, query));
    }),
  );
  return router;
}

/** Mounted at /api/exports. */
export function createExportsRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/',
    csrfGuard,
    requireSalesAccess,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const command = parseOrThrow(createExportSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'report.export',
        key,
        payload: command,
        execute: (completeClaim) =>
          requestExport({ db, actor, kind: command.kind, filters: command.filters, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getExport(db, actor, entityId),
      });
      if (!replayed) signalJobsEnqueued();
      res.status(replayed ? 200 : 202).json(result);
    }),
  );

  // Object routes: anything not requested by the caller is the standard 404.
  router.get(
    '/:id',
    handle(async (req, res) => {
      res.json(await getExport(db, actorOf(req), readId(req.params.id)));
    }),
  );

  router.get(
    '/:id/download',
    handle(async (req, res) => {
      const file = await downloadExport(db, actorOf(req), readId(req.params.id), req.requestId);
      const body = Buffer.from(file.content, 'utf8');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Length', String(body.length));
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).end(body);
    }),
  );

  return router;
}

/** Mounted at /api/search. */
export function createSearchRouter(options: { db: Database }): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    '/',
    handle(async (req, res) => {
      const query = parseOrThrow(searchQuerySchema, singleValueQuery(req.query));
      res.json(await search(options.db, actorOf(req), query));
    }),
  );
  return router;
}

/** Mounted at /api/notifications. No endpoint creates an alert or chooses a recipient (§13). */
export function createNotificationsRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireSalesAccess,
    handle(async (req, res) => {
      const query = parseOrThrow(listNotificationsQuerySchema, singleValueQuery(req.query));
      res.json(await listNotifications(db, actorOf(req), query));
    }),
  );

  router.get(
    '/unread-count',
    requireSalesAccess,
    handle(async (req, res) => {
      res.json({ unreadCount: await unreadCount(db, actorOf(req)) });
    }),
  );

  router.post(
    '/read-all',
    csrfGuard,
    requireSalesAccess,
    handle(async (req, res) => {
      const actor = actorOf(req);
      await markAllNotificationsRead(db, actor);
      res.json({ unreadCount: await unreadCount(db, actor) });
    }),
  );

  router.post(
    '/:id/read',
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const notification = await markNotificationRead(db, actor, readId(req.params.id));
      res.json({ notification, unreadCount: await unreadCount(db, actor) });
    }),
  );

  return router;
}
