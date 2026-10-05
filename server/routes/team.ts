/**
 * Management's structure and workload view (FR-071). The service decides who
 * may see it; any other role gets 403.
 */
import { Router, type RequestHandler } from 'express';

import { requireAuth } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { unauthenticated } from '../http/errors.js';
import { getTeam } from '../services/team.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function createTeamRouter(options: { db: Database }): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    '/',
    handle(async (req, res) => {
      if (!req.actor) throw unauthenticated();
      res.json(await getTeam(options.db, req.actor));
    }),
  );
  return router;
}
