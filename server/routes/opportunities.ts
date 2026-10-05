/**
 * Opportunity endpoints (plan 7.3).
 *
 * Routes are thin: they validate input, read the actor from the session and
 * delegate to the services, which own the scope predicates and transactions.
 * No permission rule is reimplemented here (plan 3.3).
 */
import { Router, type RequestHandler } from 'express';

import type { OpportunityDetailDto } from '../../shared/api.js';
import {
  FORBIDDEN_PATCH_FIELDS,
  boardQuerySchema,
  changeStageSchema,
  changeStatusSchema,
  createFollowUpSchema,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  paginationQuerySchema,
  patchOpportunitySchema,
  reopenOpportunitySchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth, requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { forbidden, notFound, unauthenticated } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import type { Actor } from '../policy/actor.js';
import { canCreateOpportunity } from '../policy/scope.js';
import { createFollowUp, getScopedFollowUp, listAssigneeOptions } from '../services/followUps.js';
import { runIdempotent, type CompleteClaimInTransaction } from '../services/idempotency.js';
import {
  assertOpportunityVisible,
  createOpportunity,
  getBoard,
  getCreationResult,
  getOpportunityDetail,
  listOpportunities,
  listOpportunityFollowUps,
  listOpportunityHistory,
  patchOpportunity,
} from '../services/opportunities.js';
import { changeStage, changeStatus, reopenOpportunity } from '../services/transitions.js';

interface TransitionArgs {
  actor: Actor;
  opportunityId: string;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}

/** Wraps an async handler so a rejection reaches the error middleware. */
function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Path parameters are validated like any other input (§13). */
function readIdParam(value: unknown, field = 'id'): string {
  const result = uuidField.safeParse(value);
  if (!result.success) {
    // A malformed id is indistinguishable from an absent record, so a caller
    // cannot tell "bad format" from "not yours".
    throw notFound(`malformed ${field} parameter`);
  }
  return result.data;
}

export function createOpportunitiesRouter(options: {
  db: Database;
  csrfGuard: RequestHandler;
}): Router {
  const { db, csrfGuard } = options;
  const router = Router();

  /*
   * Guard placement is deliberate (plan 7.6 scenario 7):
   *
   *   collection routes -> requireSalesAccess, so an administrator reaching a
   *     commercial collection gets 403 before any lookup happens;
   *   object routes     -> requireAuth only, so an administrator addressing a
   *     specific record falls through to the scope predicate and gets the same
   *     404 as anyone else outside scope, disclosing nothing about the record.
   */
  router.use(requireAuth);

  // --- List -----------------------------------------------------------------
  router.get(
    '/',
    requireSalesAccess,
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const query = parseOrThrow(listOpportunitiesQuerySchema, singleValueQuery(req.query));
      const page = await listOpportunities(db, actor, query);
      res.json(page);
    }),
  );

  // --- Create ---------------------------------------------------------------
  router.post(
    '/',
    requireSalesAccess,
    csrfGuard,
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      if (!canCreateOpportunity(actor)) {
        throw forbidden('Your account cannot create opportunities.');
      }

      const command = parseOrThrow(createOpportunitySchema, req.body);
      const key = requireIdempotencyKey(req);

      // The claim is taken before the business transaction, so a concurrent
      // duplicate collides on the unique index instead of racing through, and
      // it is completed inside that transaction (BR-091).
      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'opportunity.create',
        key,
        payload: req.body,
        execute: (completeClaim) =>
          createOpportunity({ db, actor, command, requestId: req.requestId, completeClaim }),
        // Re-read through the scoped query: a replay after access was revoked
        // must 404 rather than return stored commercial data.
        replay: (entityId) => getCreationResult(db, actor, entityId),
      });

      if (replayed) {
        res.status(200).json({ ...result, replayed: true });
        return;
      }
      res.status(201).json(result);
    }),
  );

  // --- Pipeline board (registered before /:id) ----------------------------
  router.get(
    '/board',
    requireSalesAccess,
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const query = parseOrThrow(boardQuerySchema, singleValueQuery(req.query));
      res.json(await getBoard(db, actor, query));
    }),
  );

  // --- Detail ---------------------------------------------------------------
  router.get(
    '/:id',
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const id = readIdParam(req.params.id);
      res.json(await getOpportunityDetail(db, actor, id));
    }),
  );

  // --- Basic edit -----------------------------------------------------------
  router.patch(
    '/:id',
    csrfGuard,
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const id = readIdParam(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;

      // Owner, section, stage and status are escalation attempts on a visible
      // record, not validation mistakes: 403, before any other interpretation.
      // The 404 for an invisible record is produced inside the service, so an
      // escalation attempt on a record the caller cannot see still 404s.
      const attempted = FORBIDDEN_PATCH_FIELDS.filter((field) => field in body);
      if (attempted.length > 0) {
        await assertOpportunityVisible(db, actor, id);
        throw forbidden(
          `These fields cannot be changed here: ${attempted.join(', ')}. ` +
            'Ownership transfers and stage changes use their own workflows.',
        );
      }

      const command = parseOrThrow(patchOpportunitySchema, body);
      const updated = await patchOpportunity({
        db,
        actor,
        opportunityId: id,
        command,
        requestId: req.requestId,
      });
      res.json(updated);
    }),
  );

  // --- Child reads ----------------------------------------------------------
  router.get(
    '/:id/follow-ups',
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const id = readIdParam(req.params.id);
      const { page, pageSize } = parseOrThrow(paginationQuerySchema, singleValueQuery(req.query));
      res.json(await listOpportunityFollowUps({ db, actor, opportunityId: id, page, pageSize }));
    }),
  );

  router.get(
    '/:id/history',
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const id = readIdParam(req.params.id);
      const { page, pageSize } = parseOrThrow(paginationQuerySchema, singleValueQuery(req.query));
      res.json(await listOpportunityHistory({ db, actor, opportunityId: id, page, pageSize }));
    }),
  );

  // --- Stage, status and reopening (M2) -----------------------------------
  //
  // Each is a dedicated, versioned, idempotent operation. The fingerprint
  // covers the record id as well as the body, so a key can never be replayed
  // against a different opportunity. `build` validates the body first (422
  // before any lookup, so it says nothing about the record).
  const transition = (
    operation: string,
    build: (body: unknown) => (args: TransitionArgs) => Promise<OpportunityDetailDto>,
  ): RequestHandler =>
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const id = readIdParam(req.params.id);
      const run = build(req.body);
      const key = requireIdempotencyKey(req);

      const { result } = await runIdempotent({
        db,
        actorId: actor.id,
        operation,
        key,
        payload: { id, body: req.body },
        execute: (completeClaim) =>
          run({ actor, opportunityId: id, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getOpportunityDetail(db, actor, entityId),
      });
      res.json(result);
    });

  router.post(
    '/:id/stage',
    csrfGuard,
    transition('opportunity.stage', (body) => {
      const command = parseOrThrow(changeStageSchema, body);
      return (args) => changeStage({ db, command, ...args });
    }),
  );

  router.post(
    '/:id/status',
    csrfGuard,
    transition('opportunity.status', (body) => {
      const command = parseOrThrow(changeStatusSchema, body);
      return (args) => changeStatus({ db, command, ...args });
    }),
  );

  router.post(
    '/:id/reopen',
    csrfGuard,
    transition('opportunity.reopen', (body) => {
      const command = parseOrThrow(reopenOpportunitySchema, body);
      return (args) => reopenOpportunity({ db, command, ...args });
    }),
  );

  // --- Follow-ups on one opportunity (M2) ----------------------------------
  router.get(
    '/:id/follow-up-assignees',
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const id = readIdParam(req.params.id);
      res.json({ items: await listAssigneeOptions(db, actor, id) });
    }),
  );

  router.post(
    '/:id/follow-ups',
    csrfGuard,
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const id = readIdParam(req.params.id);
      const command = parseOrThrow(createFollowUpSchema, req.body);
      const key = requireIdempotencyKey(req);

      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'follow_up.create',
        key,
        payload: { id, body: req.body },
        execute: (completeClaim) =>
          createFollowUp({ db, actor, opportunityId: id, command, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getScopedFollowUp(db, actor, entityId),
      });
      res.status(replayed ? 200 : 201).json(result);
    }),
  );

  return router;
}
