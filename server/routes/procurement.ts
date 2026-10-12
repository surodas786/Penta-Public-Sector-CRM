/**
 * Software Procurement endpoints (CR6).
 *
 * The area's collection refuses an account with no sales access (403) before
 * any lookup; object routes fall through to the scope predicates, so an
 * inaccessible cycle, contact or document is the same 404 as a missing one.
 * Creating a cycle and moving it to a milestone are retry-safe (BR-091).
 */
import { Router, type Request, type RequestHandler } from 'express';

import {
  advanceProcurementCycleSchema,
  createProcurementCycleSchema,
  linkProcurementContactSchema,
  linkProcurementDocumentSchema,
  listProcurementCyclesQuerySchema,
  updateProcurementCycleSchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth, requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { notFound, unauthenticated } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import { runIdempotent } from '../services/idempotency.js';
import {
  advanceProcurementCycle,
  createProcurementCycle,
  getMilestoneResult,
  getProcurementCycle,
  linkProcurementContact,
  linkProcurementDocument,
  listOpportunityProcurementCycles,
  listProcurementCycles,
  unlinkProcurementContact,
  unlinkProcurementDocument,
  updateProcurementCycle,
} from '../services/procurement.js';

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
export function createOpportunityProcurementRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/:id/procurement',
    handle(async (req, res) => {
      res.json({ items: await listOpportunityProcurementCycles(db, actorOf(req), readId(req.params.id)) });
    }),
  );

  router.post(
    '/:id/procurement',
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const opportunityId = readId(req.params.id);
      const command = parseOrThrow(createProcurementCycleSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'procurement.create',
        key,
        payload: { opportunityId, body: req.body },
        execute: (completeClaim) =>
          createProcurementCycle({ db, actor, opportunityId, command, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getProcurementCycle(db, actor, entityId),
      });
      res.status(replayed ? 200 : 201).json(result);
    }),
  );

  return router;
}

/** Mounted at /api/procurement. */
export function createProcurementRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireSalesAccess,
    handle(async (req, res) => {
      const query = parseOrThrow(listProcurementCyclesQuerySchema, singleValueQuery(req.query));
      res.json(await listProcurementCycles(db, actorOf(req), query));
    }),
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      res.json(await getProcurementCycle(db, actorOf(req), readId(req.params.id)));
    }),
  );

  router.patch(
    '/:id',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(updateProcurementCycleSchema, req.body);
      res.json(await updateProcurementCycle({ db, actor: actorOf(req), cycleId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  router.post(
    '/:id/milestone',
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const cycleId = readId(req.params.id);
      const command = parseOrThrow(advanceProcurementCycleSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'procurement.milestone',
        key,
        payload: { cycleId, body: req.body },
        execute: (completeClaim) =>
          advanceProcurementCycle({ db, actor, cycleId, command, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getMilestoneResult(db, actor, entityId),
      });
      res.json(result);
    }),
  );

  router.post(
    '/:id/contacts',
    csrfGuard,
    handle(async (req, res) => {
      const { contactId } = parseOrThrow(linkProcurementContactSchema, req.body);
      res.json(await linkProcurementContact({ db, actor: actorOf(req), cycleId: readId(req.params.id), contactId, requestId: req.requestId }));
    }),
  );

  router.delete(
    '/:id/contacts/:contactId',
    csrfGuard,
    handle(async (req, res) => {
      res.json(
        await unlinkProcurementContact({
          db,
          actor: actorOf(req),
          cycleId: readId(req.params.id),
          contactId: readId(req.params.contactId),
          requestId: req.requestId,
        }),
      );
    }),
  );

  router.post(
    '/:id/documents',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(linkProcurementDocumentSchema, req.body);
      res.json(await linkProcurementDocument({ db, actor: actorOf(req), cycleId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  router.delete(
    '/:id/documents/:documentId',
    csrfGuard,
    handle(async (req, res) => {
      res.json(
        await unlinkProcurementDocument({
          db,
          actor: actorOf(req),
          cycleId: readId(req.params.id),
          documentId: readId(req.params.documentId),
          requestId: req.requestId,
        }),
      );
    }),
  );

  return router;
}
