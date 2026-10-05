import type { Actor } from '../policy/actor.js';

declare global {
  namespace Express {
    interface Request {
      /** Unique per request. Echoed in every error body and audit event. */
      requestId: string;
      /**
       * The authenticated account, resolved from the session on every request
       * against current database state. Never from the request body.
       */
      actor?: Actor;
    }

    /** Shape stored by passport in `req.session.passport.user`. */
    interface User {
      id: string;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    /** Absolute expiry stamped at login (SEC-031). */
    absoluteExpiresAt?: number;
    /** Idle expiry, refreshed on each authorised request. */
    idleExpiresAt?: number;
    /** users.session_version at login; a bump invalidates this session. */
    userSessionVersion?: number;
    /**
     * Written by GET /api/auth/csrf so an anonymous visitor gets a stable
     * session id for the double-submit token to bind to.
     */
    bootstrapped?: boolean;
  }
}

export {};
