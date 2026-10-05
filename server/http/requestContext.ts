import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Stamps every request with an identifier used by error bodies, audit events
 * and server logs, so a user-visible failure can be traced without exposing
 * internal detail (SEC-020, FR-062).
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
