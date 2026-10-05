/**
 * Follow-up endpoints (FR-042, FR-043).
 *
 * A follow-up is addressed by its own id here, but every read and write
 * resolves it through its parent opportunity's scope, so a follow-up on an
 * inaccessible record is the same 404 as one that does not exist (SEC-003,
 * SEC-004). There is deliberately no GET-by-id route.
 */
import { Router, type RequestHandler } from 'express';

import type { FollowUpDto } from '../../shared/api.js';
import {
  cancelFollowUpSchema,
  completeFollowUpSchema,
  listFollowUpsQuerySchema,
  rescheduleFollowUpSchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth, requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { notFound, unauthenticated } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import type { Actor } from '../policy/actor.js';
import {
  cancelFollowUp,
  completeFollowUp,
  getScopedFollowUp,
  listFollowUps,
  rescheduleFollowUp,
} from '../services/followUps.js';
import { runIdempotent, type CompleteClaimInTransaction } from '../services/idempotency.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function readIdParam(value: unknown): string {
  const result = uuidField.safeParse(value);
  if (!result.success) throw notFound('malformed follow-up id parameter');
  return result.data;
}

interface ActionArgs {
  actor: Actor;
  followUpId: string;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}

export function createFollowUpsRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();

  // Same guard placement as opportunities: the collection refuses an account
  // with no sales access (403); object routes fall through to the scope
  // predicate (404).
  router.use(requireAuth);

  router.get(
    '/',
    requireSalesAccess,
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const query = parseOrThrow(listFollowUpsQuerySchema, singleValueQuery(req.query));
      res.json(await listFollowUps(db, actor, query));
    }),
  );

  /**
   * `build` validates the body (422 before any lookup) and returns the
   * operation to run inside the idempotency wrapper.
   */
  const action = (
    operation: string,
    build: (body: unknown) => (args: ActionArgs) => Promise<FollowUpDto>,
  ): RequestHandler =>
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const followUpId = readIdParam(req.params.id);
      const run = build(req.body);
      const key = requireIdempotencyKey(req);

      const { result } = await runIdempotent({
        db,
        actorId: actor.id,
        operation,
        key,
        payload: { id: followUpId, body: req.body },
        execute: (completeClaim) => run({ actor, followUpId, requestId: req.requestId, completeClaim }),
        // A double-clicked completion replays the first answer instead of
        // writing a second history entry (BR-030).
        replay: (entityId) => getScopedFollowUp(db, actor, entityId),
      });
      res.json(result);
    });

  router.post(
    '/:id/complete',
    csrfGuard,
    action('follow_up.complete', (body) => {
      const command = parseOrThrow(completeFollowUpSchema, body);
      return (args) => completeFollowUp({ db, command, ...args });
    }),
  );

  router.post(
    '/:id/reschedule',
    csrfGuard,
    action('follow_up.reschedule', (body) => {
      const command = parseOrThrow(rescheduleFollowUpSchema, body);
      return (args) => rescheduleFollowUp({ db, command, ...args });
    }),
  );

  router.post(
    '/:id/cancel',
    csrfGuard,
    action('follow_up.cancel', (body) => {
      const command = parseOrThrow(cancelFollowUpSchema, body);
      return (args) => cancelFollowUp({ db, command, ...args });
    }),
  );

  return router;
}
