/**
 * Resolves and re-validates the authenticated account on every request.
 *
 * Nothing is trusted from the cookie except the account id. Role, section and
 * active state are read fresh from the database, so a deactivation, role change
 * or section change takes effect on the account's next request (SEC-005).
 */
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { sections, users } from '../db/schema.js';
import { forbidden, unauthenticated } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canAccessSalesRecords } from '../policy/scope.js';

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

/** Stamps the expiry bookkeeping this module enforces. Called once, at login. */
export function stampSessionLifetimes(
  req: Request,
  options: { idleMinutes: number; absoluteMinutes: number; userSessionVersion: number },
): void {
  const current = now().getTime();
  req.session.absoluteExpiresAt = current + options.absoluteMinutes * 60_000;
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

        const [account] = await db
          .select({
            id: users.id,
            fullName: users.fullName,
            email: users.email,
            role: users.role,
            sectionId: users.sectionId,
            sectionName: sections.name,
            active: users.active,
            sessionVersion: users.sessionVersion,
          })
          .from(users)
          .leftJoin(sections, eq(sections.id, users.sectionId))
          .where(eq(users.id, sessionUser.id))
          .limit(1);

        // Deactivated, deleted, or privileges changed since the session began.
        if (!account || !account.active || account.sessionVersion !== req.session.userSessionVersion) {
          await destroySession(req);
          next();
          return;
        }

        // Sliding idle window.
        req.session.idleExpiresAt = current + idleMinutes * 60_000;

        const actor: Actor = {
          id: account.id,
          fullName: account.fullName,
          email: account.email,
          role: account.role,
          sectionId: account.sectionId,
          sectionName: account.sectionName,
          active: account.active,
          sessionVersion: account.sessionVersion,
        };
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
