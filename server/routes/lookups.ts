/**
 * Minimal lookups for the creation form (plan 7.3).
 *
 * Deliberately NOT a user directory. The response carries only what a form
 * option needs — id, display name and section — and is filtered by the same
 * eligibility predicate the create service re-applies on submission, so the
 * list can never advertise an owner the caller may not actually assign.
 */
import { Router, type RequestHandler } from 'express';
import { asc } from 'drizzle-orm';

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

      // One option per owner and section: a salesperson in two sections, or a
      // lead of two sections, is offered once in each (CR4, CR5).
      const items: OwnerOptionDto[] = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          sectionId: sections.id,
          sectionName: sections.name,
        })
        .from(users)
        .innerJoin(sections, eligibleOwnerScope(actor, sections.id))
        .orderBy(asc(sections.name), asc(users.fullName));

      res.json({ items });
    }),
  );

  return router;
}
