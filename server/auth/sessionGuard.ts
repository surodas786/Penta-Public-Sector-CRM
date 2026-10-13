/**
 * Resolves and re-validates the authenticated account on every request.
 *
 * Nothing is trusted from the cookie except the account id. Role, sections and
 * active state are read fresh from the database, so a deactivation, role change,
 * lead replacement or membership change takes effect on the account's next
 * request (SEC-005).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { BACKGROUND_REQUEST_HEADER } from '../../shared/api.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { forbidden, unauthenticated } from '../http/errors.js';
import { loadActor } from '../policy/actor.js';
import { canAccessSalesRecords } from '../policy/scope.js';

export const SESSION_COOKIE_NAME = 'penta.sid';

export interface SessionGuardOptions {
  db: Database;
  idleMinutes: number;
  absoluteMinutes: number;
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve) => {
    if (!req.session) {
      resolve();
      return;
    }
    req.session.destroy(() => resolve());
  });
}

/**
 * Stamps the expiry bookkeeping this module enforces. Called at login, and
 * when a password change re-issues the session; that passes the original
 * `absoluteExpiresAt` so re-issuing never extends the absolute limit.
 */
export function stampSessionLifetimes(
  req: Request,
  options: { idleMinutes: number; absoluteMinutes: number; userSessionVersion: number; absoluteExpiresAt?: number },
): void {
  const current = now().getTime();
  req.session.absoluteExpiresAt = options.absoluteExpiresAt ?? current + options.absoluteMinutes * 60_000;
  req.session.idleExpiresAt = current + options.idleMinutes * 60_000;
  req.session.userSessionVersion = options.userSessionVersion;
}

/**
 * Populates `req.actor` when a valid session is present. Does not reject:
 * route guards decide what an anonymous caller may do.
 */
export function resolveActor({ db, idleMinutes }: SessionGuardOptions): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const sessionUser = req.user as Express.User | undefined;
        if (!sessionUser?.id || !req.session) {
          next();
          return;
        }

        const current = now().getTime();

        // Absolute and idle expiry are tracked here (rather than relying only
        // on the cookie) so the injectable clock can drive them in tests.
        const absoluteExpiresAt = req.session.absoluteExpiresAt ?? 0;
        const idleExpiresAt = req.session.idleExpiresAt ?? 0;
        if (current >= absoluteExpiresAt || current >= idleExpiresAt) {
          await destroySession(req);
          next();
          return;
        }

        const actor = await loadActor(db, sessionUser.id);

        // Deactivated, deleted, or privileges changed since the session began.
        if (!actor || !actor.active || actor.sessionVersion !== req.session.userSessionVersion) {
          await destroySession(req);
          next();
          return;
        }

        // Sliding idle window. A background poll is not activity: an open but
        // unattended tab must still reach the idle limit (SEC-031).
        if (req.get(BACKGROUND_REQUEST_HEADER) !== '1') {
          req.session.idleExpiresAt = current + idleMinutes * 60_000;
        }

        req.actor = actor;
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/** 401 unless a valid session resolved an account. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.actor) {
    next(unauthenticated());
    return;
  }
  next();
}

/**
 * 401 unauthenticated, then 403 for an authenticated account with no
 * commercial access at all (an administrator reaching a sales collection).
 */
export function requireSalesAccess(req: Request, _res: Response, next: NextFunction): void {
  if (!req.actor) {
    next(unauthenticated());
    return;
  }
  if (!canAccessSalesRecords(req.actor)) {
    next(
      forbidden(
        'The System Administrator role has no access to commercial records. ' +
          'Account administration is available instead.',
      ),
    );
    return;
  }
  next();
}
