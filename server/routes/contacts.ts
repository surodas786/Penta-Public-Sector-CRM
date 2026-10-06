/**
 * Contacts, contact links and activities (FR-032, FR-040, FR-041, BR-020,
 * BR-021, SEC-004).
 *
 * Guard placement follows the opportunity routes: collections refuse an
 * account with no sales access (403) before any lookup; object routes fall
 * through to the scope predicates, so an inaccessible contact, link or
 * activity is the same 404 as one that does not exist.
 */
import { Router, type Request, type RequestHandler } from 'express';

import {
  archiveSchema,
  createContactSchema,
  listActivitiesQuerySchema,
  listContactsQuerySchema,
  removeLinkSchema,
  updateActivitySchema,
  updateContactSchema,
  updateLinkSchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth, requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { notFound, unauthenticated } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import { listActivities, updateActivity } from '../services/activities.js';
import {
  archiveContact,
  createContact,
  getContact,
  listContacts,
  removeLink,
  updateContact,
  updateLinkNotes,
} from '../services/contacts.js';
import { runIdempotent } from '../services/idempotency.js';

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

export function createContactsRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireSalesAccess,
    handle(async (req, res) => {
      const query = parseOrThrow(listContactsQuerySchema, singleValueQuery(req.query));
      res.json(await listContacts(db, actorOf(req), query));
    }),
  );

  router.post(
    '/',
    requireSalesAccess,
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const command = parseOrThrow(createContactSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'contact.create',
        key,
        payload: req.body,
        execute: (completeClaim) => createContact({ db, actor, command, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getContact(db, actor, entityId),
      });
      res.status(replayed ? 200 : 201).json(result);
    }),
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      res.json(await getContact(db, actorOf(req), readId(req.params.id)));
    }),
  );

  router.patch(
    '/:id',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(updateContactSchema, req.body);
      res.json(await updateContact({ db, actor: actorOf(req), contactId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  router.post(
    '/:id/archive',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(archiveSchema, req.body);
      res.json(await archiveContact({ db, actor: actorOf(req), contactId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  return router;
}

export function createContactLinksRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.patch(
    '/:id',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(updateLinkSchema, req.body);
      res.json(await updateLinkNotes({ db, actor: actorOf(req), linkId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  router.post(
    '/:id/remove',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(removeLinkSchema, req.body);
      await removeLink({ db, actor: actorOf(req), linkId: readId(req.params.id), command, requestId: req.requestId });
      res.status(204).end();
    }),
  );

  return router;
}

export function createActivitiesRouter(options: { db: Database; csrfGuard: RequestHandler }): Router {
  const { db, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireSalesAccess,
    handle(async (req, res) => {
      const query = parseOrThrow(listActivitiesQuerySchema, singleValueQuery(req.query));
      res.json(await listActivities(db, actorOf(req), query));
    }),
  );

  router.patch(
    '/:id',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(updateActivitySchema, req.body);
      res.json(await updateActivity({ db, actor: actorOf(req), activityId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  return router;
}
