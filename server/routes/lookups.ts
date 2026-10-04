/**
 * Minimal lookups for the creation form (plan 7.3).
 *
 * Deliberately NOT a user directory. The response carries only what a form
 * option needs — id, display name and section — and is filtered by the same
 * eligibility predicate the create service re-applies on submission, so the
 * list can never advertise an owner the caller may not actually assign.
 */
import { Router, type RequestHandler } from 'express';
import { asc, eq } from 'drizzle-orm';

import type { OwnerOptionDto } from '../../shared/api.js';
import { requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { sections, users } from '../db/schema.js';
import { unauthenticated } from '../http/errors.js';
import { eligibleOwnerScope } from '../policy/scope.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function createLookupsRouter(options: { db: Database }): Router {
  const { db } = options;
  const router = Router();

  router.use(requireSalesAccess);

  router.get(
    '/opportunity-owners',
    handle(async (req, res) => {
      const actor = req.actor;
      if (!actor) throw unauthenticated();

      const rows = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          sectionId: users.sectionId,
          sectionName: sections.name,
        })
        .from(users)
        .innerJoin(sections, eq(sections.id, users.sectionId))
        .where(eligibleOwnerScope(actor))
        .orderBy(asc(sections.name), asc(users.fullName));

      // sectionId is non-null for every row because the eligibility predicate
      // requires it and the join enforces it.
      const items: OwnerOptionDto[] = rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        sectionId: row.sectionId as string,
        sectionName: row.sectionName,
      }));

      res.json({ items });
    }),
  );

  return router;
}
