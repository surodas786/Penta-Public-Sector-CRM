/**
 * Authentication endpoints (plan 7.3).
 *
 * Session establishment, revocation and the current-account view. No public
 * registration endpoint exists, and no demo-password path is registered in any
 * environment (SEC-030).
 */
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { eq } from 'drizzle-orm';

import type { CurrentUserDto } from '../../shared/api.js';
import { loginSchema, setPasswordSchema } from '../../shared/validation.js';
import { GENERIC_LOGIN_FAILURE, type ConfiguredPassport } from '../auth/passport.js';
import { destroySession, requireAuth, stampSessionLifetimes } from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { ApiError, unauthenticated } from '../http/errors.js';
import { parseOrThrow } from '../http/validate.js';
import type { Actor } from '../policy/actor.js';
import {
  canAccessSalesRecords,
  canAdministerAccounts,
  canCreateOpportunity,
  canTransferOpportunity,
  canViewTeam,
} from '../policy/scope.js';
import { redeemAccountLink } from '../services/accountTokens.js';

export interface AuthRouterOptions {
  db: Database;
  passport: ConfiguredPassport;
  loginRateLimiter: RequestHandler;
  recoveryRateLimiter: RequestHandler;
  csrfGuard: RequestHandler;
  generateCsrfToken: (req: Request, res: Response, options?: { overwrite?: boolean }) => string;
  idleMinutes: number;
  absoluteMinutes: number;
}

export function toCurrentUserDto(actor: Actor): CurrentUserDto {
  return {
    id: actor.id,
    fullName: actor.fullName,
    email: actor.email,
    role: actor.role,
    section:
      actor.sectionId && actor.sectionName
        ? { id: actor.sectionId, name: actor.sectionName, active: true }
        : null,
    capabilities: {
      salesRecords: canAccessSalesRecords(actor),
      createOpportunity: canCreateOpportunity(actor),
      accountAdministration: canAdministerAccounts(actor),
      transferOpportunities: canTransferOpportunity(actor),
      teamView: canViewTeam(actor),
    },
  };
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const { db, passport, loginRateLimiter, csrfGuard, generateCsrfToken } = options;

  /**
   * Bootstraps a CSRF token before sign-in. Writing to the session here is what
   * gives an anonymous visitor a stable session id for the token to bind to.
   */
  router.get('/csrf', (req, res) => {
    req.session.bootstrapped = true;
    res.json({ csrfToken: generateCsrfToken(req, res, { overwrite: true }) });
  });

  router.post('/login', loginRateLimiter, csrfGuard, (req, res, next) => {
    // Shape-checks the body before passport sees it, so a malformed request is
    // a 422 with field errors rather than a generic 401.
    parseOrThrow(loginSchema, req.body);

    passport.authenticate(
      'local',
      (error: unknown, user: Express.User | false) => {
        void (async () => {
          try {
            if (error) {
              next(error);
              return;
            }
            if (!user) {
              // Same message and status for unknown email, wrong password and
              // deactivated account. No session is created.
              next(new ApiError(401, 'unauthenticated', GENERIC_LOGIN_FAILURE));
              return;
            }

            const [account] = await db
              .select({ sessionVersion: users.sessionVersion })
              .from(users)
              .where(eq(users.id, user.id))
              .limit(1);

            if (!account) {
              next(new ApiError(401, 'unauthenticated', GENERIC_LOGIN_FAILURE));
              return;
            }

            // Session fixation defence: a brand-new session id for the
            // authenticated session.
            await new Promise<void>((resolve, reject) => {
              req.session.regenerate((regenerateError) =>
                regenerateError ? reject(regenerateError) : resolve(),
              );
            });

            await new Promise<void>((resolve, reject) => {
              req.login(user, (loginError) => (loginError ? reject(loginError) : resolve()));
            });

            stampSessionLifetimes(req, {
              idleMinutes: options.idleMinutes,
              absoluteMinutes: options.absoluteMinutes,
              userSessionVersion: account.sessionVersion,
            });

            await new Promise<void>((resolve, reject) => {
              req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
            });

            // The previous token was bound to the pre-login session id.
            const csrfToken = generateCsrfToken(req, res, { overwrite: true });

            res.status(200).json({ csrfToken });
          } catch (thrown) {
            next(thrown);
          }
        })();
      },
    )(req, res, next);
  });

  router.post('/logout', csrfGuard, (req, res, next) => {
    void (async () => {
      try {
        await new Promise<void>((resolve) => {
          if (typeof req.logout === 'function') {
            req.logout({ keepSessionInfo: false }, () => resolve());
          } else {
            resolve();
          }
        });
        await destroySession(req);
        res.clearCookie('penta.sid', { path: '/' });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    })();
  });

  /**
   * Redeems an invitation or reset link (SEC-030). Public by necessity, so it
   * is CSRF-protected and rate limited, and every failure reads the same. The
   * caller then signs in normally; no session is created here.
   */
  router.post('/set-password', options.recoveryRateLimiter, csrfGuard, (req, res, next) => {
    void (async () => {
      try {
        const { token, password } = parseOrThrow(setPasswordSchema, req.body);
        await redeemAccountLink({ db, token, password, requestId: req.requestId });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/me', requireAuth, (req, res) => {
    if (!req.actor) throw unauthenticated();
    res.json({
      user: toCurrentUserDto(req.actor),
      csrfToken: generateCsrfToken(req, res),
    });
  });

  return router;
}
