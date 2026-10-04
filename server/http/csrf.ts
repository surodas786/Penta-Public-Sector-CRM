/**
 * CSRF protection for cookie-authenticated mutations (SEC-031).
 *
 * Three independent layers, because none of them is sufficient alone:
 *
 *   1. SameSite=Strict on the session cookie — blocks the simplest cross-site
 *      submissions, but is a browser default, not a server control.
 *   2. A signed double-submit token bound to the session, via csrf-csrf.
 *   3. Trusted-origin validation on every state-changing request.
 *
 * Layer 3 deliberately rejects a *missing* Origin as well as a wrong one: a
 * browser always sends it on a cross-origin mutation, so its absence on a
 * mutation is not something to wave through.
 */
import { doubleCsrf } from 'csrf-csrf';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ApiError } from './errors.js';

export const CSRF_COOKIE_NAME = 'penta.csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfOptions {
  secret: string;
  secureCookies: boolean;
  appOrigin: string;
}

export function createCsrfProtection(options: CsrfOptions) {
  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => options.secret,
    // Binds the token to the current session, so a token minted for one
    // account cannot be replayed under another.
    getSessionIdentifier: (req) => req.sessionID ?? '',
    cookieName: CSRF_COOKIE_NAME,
    cookieOptions: {
      sameSite: 'strict',
      path: '/',
      secure: options.secureCookies,
      // Readable by the SPA so it can echo the token in the request header.
      httpOnly: false,
    },
    size: 32,
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
  });

  /** Normalises the library's http-error into the SEC-020 envelope. */
  const guard: RequestHandler = (req, res, next) => {
    doubleCsrfProtection(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      next(
        new ApiError(403, 'invalid_csrf', 'Your session security token is missing or invalid. Reload the page and try again.', {
          internalDetail: error instanceof Error ? error.message : 'csrf validation failed',
        }),
      );
    });
  };

  return { csrfGuard: guard, generateCsrfToken };
}

/** Layer 3. Registered before the token check so a forged origin never reaches it. */
export function createOriginGuard(appOrigin: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get('origin');
    if (origin && origin.replace(/\/$/, '') === appOrigin) {
      next();
      return;
    }

    next(
      new ApiError(403, 'invalid_csrf', 'This request did not come from a trusted origin.', {
        internalDetail: `origin "${origin ?? '(absent)'}" did not match "${appOrigin}"`,
      }),
    );
  };
}
