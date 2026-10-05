/**
 * Tender endpoints (FR-050, FR-051, FR-052, BR-040).
 *
 * Guard placement follows the other routers: the tracker collection refuses
 * an account with no sales access (403) before any lookup; object routes fall
 * through to the scope predicates, so an inaccessible tender is the same 404
 * as one that does not exist.
 */
import { Router, type Request, type RequestHandler } from 'express';

import {
  cancelTenderSchema,
  createTenderSchema,
  listTendersQuerySchema,
  submitTenderSchema,
  tenderNoticeSchema,
  updateTenderSchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth, requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { notFound, unauthenticated } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import { runIdempotent } from '../services/idempotency.js';
import {
  cancelTenderNotice,
  createTender,
  designateCurrentTender,
  getSubmissionResult,
  getTender,
  listOpportunityTenders,
  listTenders,
  submitTender,
  updateTender,
} from '../services/tenders.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function readId(value: unknown): string {
  const result = uuidField.safeParse(value);
  if (!result.success) throw notFound('malformed id parameter');
  return result.data;
}

const actorOf = (req: Request) => {
  if (!req.actor) throw unauthenticated();
  return req.actor;
};

/** Mounted at /api/opportunities, beside the opportunity router. */
export function createOpportunityTendersRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/:id/tenders',
    handle(async (req, res) => {
      res.json({ items: await listOpportunityTenders(db, actorOf(req), readId(req.params.id)) });
    }),
  );

  router.post(
    '/:id/tenders',
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const opportunityId = readId(req.params.id);
      const command = parseOrThrow(createTenderSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'tender.create',
        key,
        payload: { opportunityId, body: req.body },
        execute: (completeClaim) =>
          createTender({ db, actor, opportunityId, command, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getTender(db, actor, entityId),
      });
      res.status(replayed ? 200 : 201).json(result);
    }),
  );

  return router;
}

/** Mounted at /api/tenders. */
export function createTendersRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireSalesAccess,
    handle(async (req, res) => {
      const query = parseOrThrow(listTendersQuerySchema, singleValueQuery(req.query));
      res.json(await listTenders(db, actorOf(req), query));
    }),
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      res.json(await getTender(db, actorOf(req), readId(req.params.id)));
    }),
  );

  router.patch(
    '/:id',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(updateTenderSchema, req.body);
      res.json(await updateTender({ db, actor: actorOf(req), tenderId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  // FR-051, BR-091: a retried submission is recognised, never applied twice.
  router.post(
    '/:id/submit',
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const tenderId = readId(req.params.id);
      const command = parseOrThrow(submitTenderSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'tender.submit',
        key,
        payload: { tenderId, body: req.body },
        execute: (completeClaim) =>
          submitTender({ db, actor, tenderId, command, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getSubmissionResult(db, actor, entityId),
      });
      res.json(result);
    }),
  );

  router.post(
    '/:id/designate-current',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(tenderNoticeSchema, req.body);
      res.json(
        await designateCurrentTender({ db, actor: actorOf(req), tenderId: readId(req.params.id), command, requestId: req.requestId }),
      );
    }),
  );

  router.post(
    '/:id/cancel',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(cancelTenderSchema, req.body);
      res.json(await cancelTenderNotice({ db, actor: actorOf(req), tenderId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  return router;
}
