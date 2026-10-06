/**
 * Account and section administration endpoints (FR-071, SEC-012).
 *
 * The whole router is the System Administrator's: any other role gets 403
 * before a lookup happens. The services re-check the role and own every rule.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

import {
  accountStateSchema,
  createUserSchema,
  listUsersQuerySchema,
  paginationQuerySchema,
  renameSectionSchema,
  replaceLeadSchema,
  sectionNameSchema,
  sectionStateSchema,
  updateUserSchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { forbidden, notFound, unauthenticated } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import { canAdministerAccounts } from '../policy/scope.js';
import {
  createSection,
  createUser,
  deactivateUser,
  getCreatedUser,
  getSection,
  issueUserLink,
  listAdminAudit,
  listSections,
  listUsers,
  reactivateUser,
  renameSection,
  replaceSectionLead,
  setSectionActive,
  updateUser,
} from '../services/admin.js';
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

function requireAdministrator(req: Request, _res: Response, next: NextFunction): void {
  if (!req.actor) {
    next(unauthenticated());
    return;
  }
  if (!canAdministerAccounts(req.actor)) {
    next(forbidden('Account administration is limited to the System Administrator.'));
    return;
  }
  next();
}

export function createAdminRouter(options: {
  db: Database;
  csrfGuard: RequestHandler;
  appOrigin: string;
}): Router {
  const { db, csrfGuard, appOrigin } = options;
  const router = Router();
  router.use(requireAuth, requireAdministrator);

  const actorOf = (req: Request) => {
    if (!req.actor) throw unauthenticated();
    return req.actor;
  };

  // --- Accounts -------------------------------------------------------------
  router.get(
    '/users',
    handle(async (req, res) => {
      const query = parseOrThrow(listUsersQuerySchema, singleValueQuery(req.query));
      res.json(await listUsers(db, actorOf(req), query));
    }),
  );

  router.post(
    '/users',
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const command = parseOrThrow(createUserSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'admin.user.create',
        key,
        payload: req.body,
        execute: (completeClaim) =>
          createUser({ db, actor, command, requestId: req.requestId, appOrigin, completeClaim }),
        // The invitation link is never shown twice; a replay returns the account only.
        replay: (entityId) => getCreatedUser(db, actor, entityId),
      });
      res.status(replayed ? 200 : 201).json(result);
    }),
  );

  router.patch(
    '/users/:id',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(updateUserSchema, req.body);
      res.json(await updateUser({ db, actor: actorOf(req), userId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  router.post(
    '/users/:id/deactivate',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(accountStateSchema, req.body);
      res.json(await deactivateUser({ db, actor: actorOf(req), userId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  router.post(
    '/users/:id/reactivate',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(accountStateSchema, req.body);
      res.json(await reactivateUser({ db, actor: actorOf(req), userId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  router.post(
    '/users/:id/link',
    csrfGuard,
    handle(async (req, res) => {
      res.status(201).json(
        await issueUserLink({ db, actor: actorOf(req), userId: readId(req.params.id), requestId: req.requestId, appOrigin }),
      );
    }),
  );

  // --- Sections -------------------------------------------------------------
  router.get(
    '/sections',
    handle(async (req, res) => {
      res.json({ items: await listSections(db, actorOf(req)) });
    }),
  );

  router.post(
    '/sections',
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const { name } = parseOrThrow(sectionNameSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result, replayed } = await runIdempotent({
        db,
        actorId: actor.id,
        operation: 'admin.section.create',
        key,
        payload: req.body,
        execute: (completeClaim) => createSection({ db, actor, name, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getSection(db, actor, entityId),
      });
      res.status(replayed ? 200 : 201).json(result);
    }),
  );

  router.patch(
    '/sections/:id',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(renameSectionSchema, req.body);
      res.json(await renameSection({ db, actor: actorOf(req), sectionId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  router.post(
    '/sections/:id/replace-lead',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(replaceLeadSchema, req.body);
      res.json(
        await replaceSectionLead({ db, actor: actorOf(req), sectionId: readId(req.params.id), command, requestId: req.requestId }),
      );
    }),
  );

  for (const [path, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    router.post(
      `/sections/:id/${path}`,
      csrfGuard,
      handle(async (req, res) => {
        const command = parseOrThrow(sectionStateSchema, req.body);
        res.json(
          await setSectionActive({
            db,
            actor: actorOf(req),
            sectionId: readId(req.params.id),
            active,
            command,
            requestId: req.requestId,
          }),
        );
      }),
    );
  }

  // --- Administrative audit ---------------------------------------------------
  router.get(
    '/audit',
    handle(async (req, res) => {
      const { page, pageSize } = parseOrThrow(paginationQuerySchema, singleValueQuery(req.query));
      res.json(await listAdminAudit(db, actorOf(req), page, pageSize));
    }),
  );

  return router;
}
