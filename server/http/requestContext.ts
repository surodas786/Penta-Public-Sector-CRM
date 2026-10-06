import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

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

/** Requests slower than this are logged even in `errors` mode. */
export const SLOW_REQUEST_MS = 2_000;

/**
 * One line per request for monitoring (NFR-003): request id, method, path,
 * status and duration. The query string is dropped — it can carry search
 * terms and filter values — and no body, header or cookie is ever logged
 * (SEC-032). `errors` logs 5xx responses and slow requests only.
 */
export function requestLog(mode: 'all' | 'errors'): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (mode === 'errors' && res.statusCode < 500 && ms < SLOW_REQUEST_MS) return;
      const line = JSON.stringify({
        at: new Date().toISOString(),
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(ms),
      });
      if (res.statusCode >= 500) console.error(line);
      else console.log(line);
    });
    next();
  };
}
