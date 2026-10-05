/**
 * Shared organization directory (FR-031).
 *
 * Basic directory information only: name, type, location. No private contact
 * details, no project commentary, and no opportunity counts — a count would
 * have to be scoped, and scoped counts arrive with the M6 aggregates.
 */
import { Router, type RequestHandler } from 'express';
import { and, asc, count, ilike, isNull, or, type SQL } from 'drizzle-orm';

import type { OrganizationSummaryDto, Paginated } from '../../shared/api.js';
import { listOrganizationsQuerySchema } from '../../shared/validation.js';
import { requireSalesAccess } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { organizations } from '../db/schema.js';
import { unauthenticated } from '../http/errors.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function createOrganizationsRouter(options: { db: Database }): Router {
  const { db } = options;
  const router = Router();

  router.use(requireSalesAccess);

  router.get(
    '/',
    handle(async (req, res) => {
      if (!req.actor) throw unauthenticated();

      const query = parseOrThrow(listOrganizationsQuerySchema, singleValueQuery(req.query));

      const filters: SQL[] = [isNull(organizations.archivedAt)];
      if (query.q) {
        const term = `%${query.q}%`;
        filters.push(or(ilike(organizations.name, term), ilike(organizations.location, term)) as SQL);
      }
      const where = and(...filters) as SQL;

      const totalRows = await db.select({ value: count() }).from(organizations).where(where);
      const total = totalRows[0]?.value ?? 0;

      const rows = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          type: organizations.type,
          location: organizations.location,
        })
        .from(organizations)
        .where(where)
        .orderBy(asc(organizations.name))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const body: Paginated<OrganizationSummaryDto> = {
        items: rows,
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
      res.json(body);
    }),
  );

  // No detail route in M1: the create form needs the searchable list only, and
  // endpoints are added with the feature that uses them (plan section 5).

  return router;
}
