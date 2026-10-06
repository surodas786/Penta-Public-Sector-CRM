/**
 * Express application factory.
 *
 * Exported as a factory so integration tests can mount the real app against a
 * test database and drive it in-process with supertest — the tests exercise
 * the same middleware chain, session handling and error mapping as production.
 */
import connectPgSimple from 'connect-pg-simple';
import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';

import type { DatabaseHandle } from './db/client.js';
import type { ServerConfig } from './env.js';
import { resolveActor } from './auth/sessionGuard.js';
import { configurePassport } from './auth/passport.js';
import { createCsrfProtection, createOriginGuard } from './http/csrf.js';
import { ApiError, errorHandler, notFoundHandler } from './http/errors.js';
import { requestContext, requestLog } from './http/requestContext.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createActivitiesRouter, createContactLinksRouter, createContactsRouter } from './routes/contacts.js';
import { createFollowUpsRouter } from './routes/followUps.js';
import { createLookupsRouter } from './routes/lookups.js';
import { createOpportunitiesRouter } from './routes/opportunities.js';
import { createOrganizationsRouter } from './routes/organizations.js';
import { createTeamRouter } from './routes/team.js';
import {
  createDashboardRouter,
  createExportsRouter,
  createNotificationsRouter,
  createReportsRouter,
  createSearchRouter,
} from './routes/reporting.js';
import { createOpportunityTendersRouter, createTendersRouter } from './routes/tenders.js';
import {
  createDocumentRevisionsRouter,
  createDocumentsRouter,
  createDocumentUploadsRouter,
  createOpportunityDocumentsRouter,
} from './routes/documents.js';
import { createScanner, type DocumentScanner } from './documents/scanner.js';
import { LocalDocumentStorage, type DocumentStorage } from './documents/storage.js';
import type { DocumentServices } from './services/documents.js';

export const SESSION_COOKIE_NAME = 'penta.sid';

export interface LoginRateLimitOptions {
  windowMs: number;
  limit: number;
}

export interface CreateAppOptions {
  database: DatabaseHandle;
  config: ServerConfig;
  /** Tests raise the limit except in the suite that exercises it. */
  loginRateLimit?: LoginRateLimitOptions;
  /** Tests substitute a scanner to exercise failure; defaults follow the configuration. */
  documentScanner?: DocumentScanner;
  documentStorage?: DocumentStorage;
}

export function createDocumentServices(
  database: DatabaseHandle,
  config: ServerConfig,
  overrides: { scanner?: DocumentScanner; storage?: DocumentStorage } = {},
): DocumentServices {
  return {
    db: database.db,
    storage: overrides.storage ?? new LocalDocumentStorage(config.documents.storageDir),
    scanner: overrides.scanner ?? createScanner(config.documents.scanner),
    maxUploadBytes: config.documents.maxUploadBytes,
    uploadTtlMinutes: config.documents.uploadTtlMinutes,
  };
}

export function createApp({ database, config, loginRateLimit, documentScanner, documentStorage }: CreateAppOptions): Express {
  const app = express();

  // Behind a reverse proxy in staging/production; needed for secure cookies
  // and for the rate limiter to see the real client address.
  if (config.isProduction) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);
  if (config.requestLog !== 'off') app.use(requestLog(config.requestLog));
  app.use(
    helmet({
      // The SPA is served separately; the API returns JSON only.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  const PgSessionStore = connectPgSimple(session);
  app.use(
    session({
      name: SESSION_COOKIE_NAME,
      secret: config.sessionSecret,
      resave: false,
      // No session for anonymous visitors unless something is actually stored.
      saveUninitialized: false,
      rolling: true,
      store: new PgSessionStore({
        pool: database.pool,
        tableName: 'session',
        // The runtime role has no DDL rights; migration 0001 owns this table.
        createTableIfMissing: false,
        pruneSessionInterval: 60,
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.secureCookies,
        path: '/',
        maxAge: config.sessionIdleMinutes * 60_000,
      },
    }),
  );

  const passportInstance = configurePassport(database.db);
  app.use(passportInstance.initialize());
  app.use(passportInstance.session());

  const { csrfGuard, generateCsrfToken } = createCsrfProtection({
    secret: config.csrfSecret,
    secureCookies: config.secureCookies,
    appOrigin: config.appOrigin,
  });

  // Trusted-origin validation runs before the token check on every mutation.
  app.use('/api', createOriginGuard(config.appOrigin));

  app.use(
    resolveActor({
      db: database.db,
      idleMinutes: config.sessionIdleMinutes,
      absoluteMinutes: config.sessionAbsoluteMinutes,
    }),
  );

  const loginRateLimiter: RequestHandler = rateLimit({
    windowMs: loginRateLimit?.windowMs ?? 15 * 60_000,
    limit: loginRateLimit?.limit ?? 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Count failures and successes alike: the control is about guessing volume.
    handler: (_req, _res, next) => {
      next(
        new ApiError(
          429,
          'rate_limited',
          'Too many sign-in attempts. Wait a few minutes before trying again.',
        ),
      );
    },
  });

  // A separate counter for redeeming invitation and reset links (SEC-031), so
  // setting a password does not spend the person's sign-in attempts.
  const recoveryRateLimiter: RequestHandler = rateLimit({
    windowMs: loginRateLimit?.windowMs ?? 15 * 60_000,
    limit: loginRateLimit?.limit ?? 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new ApiError(429, 'rate_limited', 'Too many attempts. Wait a few minutes before trying again.'));
    },
  });

  app.get('/api/health', (_req, res) => {
    // Liveness. No secrets, no configuration, no counts (NFR-003).
    res.json({ status: 'ok' });
  });

  // Readiness (NFR-003): can this instance reach its database? A load
  // balancer stops routing to it while this is 503. Never says why.
  app.get('/api/health/ready', (_req, res) => {
    void (async () => {
      const ok = await Promise.race([
        database.pool.query('SELECT 1').then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000).unref()),
      ]);
      res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'unavailable', database: ok ? 'ok' : 'unavailable' });
    })();
  });

  app.use(
    '/api/auth',
    createAuthRouter({
      db: database.db,
      passport: passportInstance,
      loginRateLimiter,
      recoveryRateLimiter,
      csrfGuard,
      generateCsrfToken,
      idleMinutes: config.sessionIdleMinutes,
      absoluteMinutes: config.sessionAbsoluteMinutes,
    }),
  );

  const documentServices = createDocumentServices(database, config, {
    ...(documentScanner ? { scanner: documentScanner } : {}),
    ...(documentStorage ? { storage: documentStorage } : {}),
  });

  app.use('/api/opportunities', createOpportunitiesRouter({ db: database.db, csrfGuard }));
  app.use('/api/opportunities', createOpportunityTendersRouter({ db: database.db, csrfGuard }));
  app.use('/api/opportunities', createOpportunityDocumentsRouter({ services: documentServices, csrfGuard }));
  app.use('/api/tenders', createTendersRouter({ db: database.db, csrfGuard }));
  app.use('/api/document-uploads', createDocumentUploadsRouter({ services: documentServices, csrfGuard }));
  app.use('/api/documents', createDocumentsRouter({ services: documentServices, csrfGuard, scanner: config.documents.scanner }));
  app.use('/api/document-revisions', createDocumentRevisionsRouter({ services: documentServices }));
  app.use('/api/follow-ups', createFollowUpsRouter({ db: database.db, csrfGuard }));
  app.use('/api/organizations', createOrganizationsRouter({ db: database.db, csrfGuard }));
  app.use('/api/contacts', createContactsRouter({ db: database.db, csrfGuard }));
  app.use('/api/contact-links', createContactLinksRouter({ db: database.db, csrfGuard }));
  app.use('/api/activities', createActivitiesRouter({ db: database.db, csrfGuard }));
  app.use('/api/lookups', createLookupsRouter({ db: database.db }));
  app.use('/api/team', createTeamRouter({ db: database.db }));
  app.use('/api/dashboard', createDashboardRouter({ db: database.db }));
  app.use('/api/reports', createReportsRouter({ db: database.db }));
  app.use('/api/exports', createExportsRouter({ db: database.db, csrfGuard }));
  app.use('/api/search', createSearchRouter({ db: database.db }));
  app.use('/api/notifications', createNotificationsRouter({ db: database.db, csrfGuard }));
  app.use('/api/admin', createAdminRouter({ db: database.db, csrfGuard, appOrigin: config.appOrigin }));

  // NOTE: no demo, seed or reset endpoint is registered in any environment.
  // Demo data lives in the separate synthetic frontend build (plan 4.4).

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
