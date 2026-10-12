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
import { changePasswordSchema, loginSchema, setPasswordSchema } from '../../shared/validation.js';
import { GENERIC_LOGIN_FAILURE, type ConfiguredPassport } from '../auth/passport.js';
import {
  SESSION_COOKIE_NAME,
  destroySession,
  requireAuth,
  stampSessionLifetimes,
} from '../auth/sessionGuard.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { CSRF_COOKIE_NAME } from '../http/csrf.js';
import { expireShadowingCookies } from '../http/duplicateCookies.js';
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
import { changeOwnPassword } from '../services/ownPassword.js';
import { signalJobsEnqueued } from '../jobs/queue.js';

export interface AuthRouterOptions {
  db: Database;
  passport: ConfiguredPassport;
  loginRateLimiter: RequestHandler;
  recoveryRateLimiter: RequestHandler;
  passwordChangeRateLimiter: RequestHandler;
  csrfGuard: RequestHandler;
  generateCsrfToken: (req: Request, res: Response, options?: { overwrite?: boolean }) => string;
  idleMinutes: number;
  absoluteMinutes: number;
  secureCookies: boolean;
}

export function toCurrentUserDto(actor: Actor): CurrentUserDto {
  return {
    id: actor.id,
    fullName: actor.fullName,
    email: actor.email,
    role: actor.role,
    sections: actor.sections.map((section) => ({ ...section, active: true })),
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
   * Starts an authenticated session under a brand-new session id (session
   * fixation defence). Used at sign-in and when a password change re-issues
   * the caller's own session.
   */
  async function establishSession(
    req: Request,
    user: Express.User,
    lifetimes: { userSessionVersion: number; absoluteExpiresAt?: number },
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((regenerateError) => (regenerateError ? reject(regenerateError) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      req.login(user, (loginError) => (loginError ? reject(loginError) : resolve()));
    });
    stampSessionLifetimes(req, {
      idleMinutes: options.idleMinutes,
      absoluteMinutes: options.absoluteMinutes,
      ...lifetimes,
    });
    req.session.insertOnSave = true;
    await new Promise<void>((resolve, reject) => {
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  }

  /**
   * Bootstraps a CSRF token before sign-in. Writing to the session here is what
   * gives an anonymous visitor a stable session id for the token to bind to.
   */
  router.get('/csrf', (req, res) => {
    // Sign-in always starts here, so this is where stale copies of our
    // cookies are removed; both are re-issued below in the same response.
    expireShadowingCookies(req, res, [SESSION_COOKIE_NAME, CSRF_COOKIE_NAME], { secure: options.secureCookies });
    req.session.bootstrapped = true;
    req.session.insertOnSave = true;
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

            await establishSession(req, user, { userSessionVersion: account.sessionVersion });

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
        res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
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

  /**
   * Changes the signed-in account's own password (CR3). Every other session
   * ends on its next request; this one continues under a new session id and
   * its original absolute expiry, so the response carries a new CSRF token.
   */
  router.post('/password', requireAuth, options.passwordChangeRateLimiter, csrfGuard, (req, res, next) => {
    void (async () => {
      try {
        const actor = req.actor;
        if (!actor) throw unauthenticated();
        const { currentPassword, newPassword } = parseOrThrow(changePasswordSchema, req.body);
        const userSessionVersion = await changeOwnPassword({
          db,
          actor,
          currentPassword,
          newPassword,
          requestId: req.requestId,
        });
        // The "password changed" email, if one was queued, can go now.
        signalJobsEnqueued();
        // Read before the session is regenerated, which discards it.
        const { absoluteExpiresAt } = req.session;
        await establishSession(req, req.user as Express.User, { userSessionVersion, absoluteExpiresAt });
        res.status(200).json({ csrfToken: generateCsrfToken(req, res, { overwrite: true }) });
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
