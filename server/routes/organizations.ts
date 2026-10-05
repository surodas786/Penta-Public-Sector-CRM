/**
 * The shared organization directory (FR-030, FR-031, FR-033).
 *
 * Every sales role may read and maintain basic organization details; the
 * System Administrator has no sales directory (403). The services own every
 * rule; this router validates input and adapts HTTP.
 */
import { Router, type RequestHandler } from 'express';

import {
  archiveSchema,
  createOrganizationSchema,
  listDirectoryQuerySchema,
  updateOrganizationSchema,
  uuidField,
} from '../../shared/validation.js';
import { requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { notFound, unauthenticated } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import {
  archiveOrganization,
  createOrganization,
  getOrganization,
  listDirectory,
  updateOrganization,
} from '../services/directory.js';
import { runIdempotent } from '../services/idempotency.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function readId(value: unknown): string {
  const result = uuidField.safeParse(value);
  if (!result.success) throw notFound('malformed organization id');
  return result.data;
}

export function createOrganizationsRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();

  router.use(requireSalesAccess);

  router.get(
    '/',
    handle(async (req, res) => {
      if (!req.actor) throw unauthenticated();
      const query = parseOrThrow(listDirectoryQuerySchema, singleValueQuery(req.query));
      res.json(await listDirectory(db, req.actor, query));
    }),
  );

  router.post(
    '/',
    csrfGuard,
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();
      const command = parseOrThrow(createOrganizationSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'organization.create',
        key,
        payload: req.body,
        execute: (completeClaim) => createOrganization({ db, actor, command, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getOrganization(db, actor, entityId),
      });
      res.status(replayed ? 200 : 201).json(result);
    }),
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      if (!req.actor) throw unauthenticated();
      res.json(await getOrganization(db, req.actor, readId(req.params.id)));
    }),
  );

  router.patch(
    '/:id',
    csrfGuard,
    handle(async (req, res) => {
      if (!req.actor) throw unauthenticated();
      const command = parseOrThrow(updateOrganizationSchema, req.body);
      res.json(
        await updateOrganization({ db, actor: req.actor, organizationId: readId(req.params.id), command, requestId: req.requestId }),
      );
    }),
  );

  router.post(
    '/:id/archive',
    csrfGuard,
    handle(async (req, res) => {
      if (!req.actor) throw unauthenticated();
      const command = parseOrThrow(archiveSchema, req.body);
      res.json(
        await archiveOrganization({ db, actor: req.actor, organizationId: readId(req.params.id), command, requestId: req.requestId }),
      );
    }),
  );

  return router;
}
