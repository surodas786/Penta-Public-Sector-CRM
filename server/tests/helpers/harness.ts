/**
 * Shared test harness.
 *
 * Builds the real Express app against the test database using the restricted
 * application role, and drives it in-process with supertest. Nothing here
 * stubs policy, sessions or the database: a test that passes exercises the
 * same code path a browser would.
 */
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';

import { hashPassword } from '../../auth/password.js';
import { createApp, type LoginRateLimitOptions } from '../../app.js';
import { createDatabase, type DatabaseHandle } from '../../db/client.js';
import { legacyUuid } from '../../db/seedData.js';
import { seedDatabase } from '../../db/seed.js';
import { loadServerConfig, resolveTestDatabaseUrl } from '../../env.js';
import { CSRF_HEADER, IDEMPOTENCY_HEADER } from '../../../shared/api.js';

export const TEST_ORIGIN = 'http://localhost:5173';

/**
 * Taken from configuration, not hard-coded.
 *
 * A literal here is how a truncated password went unnoticed: the harness
 * seeded and asserted with the same constant, so both sides agreed while the
 * value a developer would actually type was different. Reading the configured
 * value means the suite exercises what the environment really provides.
 */
export const TEST_PASSWORD = process.env.SEED_DEFAULT_PASSWORD?.trim() || 'Synthetic-Dev-2026';

/** Stable UUIDs for the synthetic fixtures, by their demo identifier. */
export const ids = {
  sectionGA: legacyUuid('GA'),
  sectionIS: legacyUuid('IS'),
  management: legacyUuid('u-arif'),
  leadGA: legacyUuid('u-nadia'),
  leadIS: legacyUuid('u-farhan'),
  salesGA1: legacyUuid('u-rafiq'),
  salesGA2: legacyUuid('u-tasnia'),
  salesIS1: legacyUuid('u-imran'),
  salesIS2: legacyUuid('u-sadia'),
  admin: legacyUuid('u-admin'),
  inactiveGA: legacyUuid('u-shuvo'),
  noManagerGA: legacyUuid('u-mehjabin'),
  // Opportunities
  oppRafiq: legacyUuid('p1'),
  oppTasnia: legacyUuid('p2'),
  oppNadia: legacyUuid('p7'),
  oppRafiqAwarded: legacyUuid('p5'),
  /** Rafiq, Tender Published, one open follow-up. */
  oppRafiqTender: legacyUuid('p3'),
  /** Tasnia, Lost (price). */
  oppTasniaLost: legacyUuid('p6'),
  /** Tasnia, On Hold with Requirements Discussion retained, one open follow-up. */
  oppTasniaOnHold: legacyUuid('p9'),
  oppInactiveOwner: legacyUuid('p22'),
  oppNoManagerOwner: legacyUuid('p23'),
  oppImran: legacyUuid('p11'),
  oppSadia: legacyUuid('p12'),
  oppCancelledIS: legacyUuid('p19'),
  /** Rafiq, Bid Submitted; shares Farzana Yasmin with Tasnia's p2. */
  oppRafiqTraining: legacyUuid('p8'),
  /** Imran, Lost; shares Golam Mostafa with Rafiq's p1. */
  oppImranLost: legacyUuid('p17'),
  /** Sadia, Bid Preparation; shares Rezaul Karim with Nadia's p7. */
  oppSadiaDataCenter: legacyUuid('p12'),
  // Contacts (M4)
  /** Links: p1 (Rafiq, GA, carries the demo note) and p17 (Imran, IS). */
  contactGolam: legacyUuid('c13'),
  /** Links: p1 only. */
  contactLaila: legacyUuid('c14'),
  /** Links: p2 (Tasnia, carries the note) and p8 (Rafiq). Same section, different owners. */
  contactFarzana: legacyUuid('c6'),
  /** Links: p7 (Nadia, GA, carries the note), p12 and p20 (Sadia, IS). */
  contactRezaul: legacyUuid('c17'),
  // Activities (M4)
  /** p1, Office Visit, authored by Rafiq, with Golam Mostafa. */
  activityRafiqVisit: legacyUuid('a1'),
  // Organizations
  orgSylvanHills: legacyUuid('o7'),
  orgCivicRecords: legacyUuid('o2'),
  orgBangla: legacyUuid('o11'),
} as const;

export const emails = {
  management: 'arif.rahman@example.com',
  leadGA: 'nadia.islam@example.com',
  leadIS: 'farhan.ahmed@example.com',
  salesGA1: 'rafiq.hasan@example.com',
  salesGA2: 'tasnia.karim@example.com',
  salesIS1: 'imran.hossain@example.com',
  admin: 'admin@example.com',
} as const;

/** A UUID that is correctly formed but belongs to no record. */
export const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

export interface TestContext {
  app: Express;
  database: DatabaseHandle;
  close: () => Promise<void>;
}

let cachedPasswordHash: string | null = null;

/** Hashing argon2 once keeps reseeding between tests inexpensive. */
async function getSeedPasswordHash(): Promise<string> {
  cachedPasswordHash ??= await hashPassword(TEST_PASSWORD);
  return cachedPasswordHash;
}

export interface TestAppOptions {
  loginRateLimit?: LoginRateLimitOptions;
  /** Shorten so expiry can be exercised without thousands of clock steps. */
  sessionIdleMinutes?: number;
  sessionAbsoluteMinutes?: number;
}

/**
 * Resolved once, at import time, while DATABASE_URL still holds the development
 * value. The harness must never overwrite DATABASE_URL: the guard in
 * resolveTestDatabaseUrl compares the two, and clobbering one would quietly
 * disable the check that stops the suite truncating the development database.
 */
const testDatabaseUrl = resolveTestDatabaseUrl();

export function createTestApp(options: TestAppOptions = {}): TestContext {
  const databaseUrl = testDatabaseUrl;
  process.env.APP_ORIGIN = TEST_ORIGIN;
  process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';
  process.env.CSRF_SECRET ??= 'test-csrf-secret-at-least-32-characters-long';

  const config = loadServerConfig({
    databaseUrl,
    appOrigin: TEST_ORIGIN,
    ...(options.sessionIdleMinutes !== undefined
      ? { sessionIdleMinutes: options.sessionIdleMinutes }
      : {}),
    ...(options.sessionAbsoluteMinutes !== undefined
      ? { sessionAbsoluteMinutes: options.sessionAbsoluteMinutes }
      : {}),
  });
  const database = createDatabase(databaseUrl);
  const app = createApp({
    database,
    config,
    // Raised far above any single suite's volume, except where a test sets it.
    loginRateLimit: options.loginRateLimit ?? { windowMs: 60_000, limit: 10_000 },
  });

  return {
    app,
    database,
    close: async () => {
      await database.close();
    },
  };
}

/**
 * Runs a statement as the schema owner.
 *
 * Needed only to install and remove the temporary trigger that induces a
 * mid-transaction failure. The application role deliberately has no DDL
 * privileges, which is exactly why this uses a separate connection.
 */
export async function runAsMigrator(statement: string): Promise<void> {
  const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error('TEST_MIGRATION_DATABASE_URL is required by the test harness.');
  const pool = new pg.Pool({ connectionString: migrationUrl, max: 1 });
  try {
    await pool.query(statement);
  } finally {
    await pool.end();
  }
}

/** Truncates and reloads the synthetic fixtures. */
export async function resetFixtures(): Promise<void> {
  const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error('TEST_MIGRATION_DATABASE_URL is required by the test harness.');
  process.env.SEED_DEFAULT_PASSWORD = TEST_PASSWORD;
  await seedDatabase(migrationUrl, { passwordHash: await getSeedPasswordHash() });
}

export interface SignedInClient {
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
}

/** Fetches a CSRF token for an anonymous visitor (needed to POST /login). */
export async function startSession(app: Express): Promise<SignedInClient> {
  const agent = request.agent(app);
  const response = await agent.get('/api/auth/csrf').expect(200);
  return { agent, csrfToken: response.body.csrfToken as string };
}

/**
 * Full browser-shaped sign-in: bootstrap token, POST credentials with the
 * trusted origin, then adopt the post-login token.
 */
export async function signIn(
  app: Express,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<SignedInClient> {
  const client = await startSession(app);
  const response = await client.agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .set(CSRF_HEADER, client.csrfToken)
    .send({ email, password });

  if (response.status !== 200) {
    throw new Error(
      `Sign-in failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return { agent: client.agent, csrfToken: response.body.csrfToken as string };
}

/** A valid create payload. Override fields per test. */
export function createOpportunityPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Integration Test Opportunity',
    organizationId: ids.orgSylvanHills,
    solutionCategory: 'custom_software',
    estimatedValue: '1500000.50',
    ownerId: ids.salesGA1,
    sectionId: ids.sectionGA,
    stage: 'identified',
    priority: 'medium',
    initialFollowUpTitle: 'Arrange the introductory meeting',
    initialFollowUpDueDate: '2027-01-15',
    ...overrides,
  };
}

/**
 * A browser-shaped mutation: trusted origin, CSRF token and an idempotency
 * key (a fresh one unless the test is exercising a retry).
 */
export function send(
  client: SignedInClient,
  path: string,
  body: unknown,
  key: string | null = nextIdempotencyKey('m2'),
) {
  const request = client.agent
    .post(path)
    .set('Origin', TEST_ORIGIN)
    .set(CSRF_HEADER, client.csrfToken);
  if (key !== null) request.set(IDEMPOTENCY_HEADER, key);
  return request.send(body as object);
}

let idempotencyCounter = 0;

export function nextIdempotencyKey(prefix = 'test'): string {
  idempotencyCounter += 1;
  return `${prefix}-key-${idempotencyCounter.toString().padStart(6, '0')}-abcdef`;
}

export { CSRF_HEADER, IDEMPOTENCY_HEADER };
