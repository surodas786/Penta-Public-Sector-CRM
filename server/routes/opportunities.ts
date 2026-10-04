/**
 * Opportunity endpoints (plan 7.3).
 *
 * Routes are thin: they validate input, read the actor from the session and
 * delegate to the services, which own the scope predicates and transactions.
 * No permission rule is reimplemented here (plan 3.3).
 */
import { Router, type RequestHandler } from 'express';

import { IDEMPOTENCY_HEADER } from '../../shared/api.js';
import {
  FORBIDDEN_PATCH_FIELDS,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  paginationQuerySchema,
  patchOpportunitySchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth, requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { forbidden, notFound, unauthenticated, validationFailed } from '../http/errors.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import { canCreateOpportunity } from '../policy/scope.js';
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
  releaseIdempotencyClaim,
} from '../services/idempotency.js';
import {
  assertOpportunityVisible,
  createOpportunity,
  getOpportunityDetail,
  listOpportunities,
  listOpportunityFollowUps,
  listOpportunityHistory,
  patchOpportunity,
} from '../services/opportunities.js';

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

      const idempotencyKey = req.get(IDEMPOTENCY_HEADER)?.trim();
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
        throw validationFailed({
          [IDEMPOTENCY_HEADER]:
            'Provide an Idempotency-Key header between 8 and 200 characters so a retry cannot create a duplicate.',
        });
      }

      // Claimed before the business transaction so a concurrent duplicate
      // collides on the unique index instead of racing through (BR-091).
      const claim = await claimIdempotencyKey({
        db,
        actorId: actor.id,
        operation: 'opportunity.create',
        key: idempotencyKey,
        payload: req.body,
      });

      if (claim.kind === 'replay') {
        // Re-read through the scoped query: a replay after access was revoked
        // must 404 rather than return stored commercial data.
        const opportunity = await getOpportunityDetail(db, actor, claim.entityId);
        const followUps = await listOpportunityFollowUps({
          db,
          actor,
          opportunityId: claim.entityId,
          page: 1,
          pageSize: 1,
        });
        res.status(200).json({
          opportunity,
          firstFollowUp: followUps.items[0] ?? null,
          warnings: [],
          replayed: true,
        });
        return;
      }

      try {
        const result = await createOpportunity({
          db,
          actor,
          command,
          requestId: req.requestId,
        });
        await completeIdempotencyClaim({
          db,
          claimId: claim.claimId,
          entityId: result.opportunity.id,
        });
        res.status(201).json(result);
      } catch (error) {
        // Release the key so an immediate corrected retry is not blocked by a
        // claim that produced nothing.
        await releaseIdempotencyClaim({ db, claimId: claim.claimId });
        throw error;
      }
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

  return router;
}
