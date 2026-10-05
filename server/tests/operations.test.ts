/**
 * Plan 7.6 scenarios 24 and 25: environment guards around migrations, seeds
 * and production builds; append-only audit enforcement at the database role
 * level; and the absence of secrets or business notes in error output.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEvents, opportunities } from '../db/schema.js';
import { loadServerConfig, resolveTestDatabaseUrl, sameDatabase } from '../env.js';
import { assertSeedTargetIsSafe, seedDatabase } from '../db/seed.js';
import { runMigrations } from '../db/migrate.js';
import {
  CSRF_HEADER,
  TEST_ORIGIN,
  createOpportunityPayload,
  createTestApp,
  emails,
  ids,
  nextIdempotencyKey,
  resetFixtures,
  runAsMigrator,
  signIn,
  startSession,
  type TestContext,
} from './helpers/harness.js';

/**
 * The seed password from .env.example, read two ways.
 *
 * `literal` is what a developer reads and types. `parsed` is what Node's
 * env-file parser actually hands the application. They differ when a value
 * contains an unquoted '#', and that difference is invisible unless something
 * compares them — which is precisely how a truncated password shipped.
 */
function readDocumentedSeedPassword(): { literal: string; parsed: string | undefined } {
  const file = readFileSync(path.resolve('.env.example'), 'utf8');

  let literal = '';
  for (const raw of file.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('SEED_DEFAULT_PASSWORD=')) continue;
    let value = line.slice('SEED_DEFAULT_PASSWORD='.length).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) value = value.slice(1, -1);
    literal = value;
  }

  const saved = process.env.SEED_DEFAULT_PASSWORD;
  delete process.env.SEED_DEFAULT_PASSWORD;
  try {
    process.loadEnvFile(path.resolve('.env.example'));
    return { literal, parsed: process.env.SEED_DEFAULT_PASSWORD };
  } finally {
    if (saved === undefined) delete process.env.SEED_DEFAULT_PASSWORD;
    else process.env.SEED_DEFAULT_PASSWORD = saved;
  }
}

const execFileAsync = promisify(execFile);

/**
 * Drizzle wraps a driver error, so the PostgreSQL message lives on the cause
 * chain rather than on the thrown error itself.
 */
async function expectRejectionMatching(
  operation: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }

  expect(thrown, 'expected the operation to be rejected').toBeDefined();

  const messages: string[] = [];
  let current: unknown = thrown;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }

  expect(messages.join(' | ')).toMatch(pattern);
}

describe('operational guards', () => {
  let ctx: TestContext;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    ctx = createTestApp();
    await resetFixtures();
  });

  afterAll(async () => {
    await ctx.close();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  });

  // --- Scenario 24 --------------------------------------------------------
  describe('scenario 24 — migrations, seeds and production guards', () => {
    it('applies the committed migrations repeatedly without error', async () => {
      const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
      // globalSetup already applied them once; a second run must be a no-op.
      await expect(runMigrations(migrationUrl)).resolves.toBeUndefined();
      await expect(runMigrations(migrationUrl)).resolves.toBeUndefined();
    });

    it('creates every table up to the current milestone and none from a later one', async () => {
      const result = await ctx.database.db.execute<{ table_name: string }>(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);
      const tables = result.rows.map((row) => row.table_name).sort();

      for (const expected of [
        'audit_events',
        'follow_ups',
        'idempotency_records',
        'opportunities',
        'organizations',
        'sections',
        'session',
        'users',
        // Milestone 5
        'tenders',
        'documents',
        'document_revisions',
        'document_uploads',
      ]) {
        expect(tables).toContain(expected);
      }

      // Tables arrive with the feature that uses them (plan section 5).
      for (const deferred of ['notifications']) {
        expect(tables).not.toContain(deferred);
      }
    });

    it('refuses to seed when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      expect(() =>
        assertSeedTargetIsSafe('postgres://penta_migrator:x@127.0.0.1:55432/penta_crm_dev'),
      ).toThrow(/NODE_ENV=production/);
    });

    it('refuses to seed a database outside the development and test allowlist', () => {
      process.env.NODE_ENV = 'development';
      expect(() =>
        assertSeedTargetIsSafe('postgres://penta_migrator:x@127.0.0.1:55432/penta_crm_prod'),
      ).toThrow(/Refusing to seed database "penta_crm_prod"/);
    });

    it('refuses to seed a non-local host unless explicitly allowed', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ALLOW_REMOTE_SEED;
      expect(() =>
        assertSeedTargetIsSafe('postgres://penta_migrator:x@db.penta.example.com:5432/penta_crm_dev'),
      ).toThrow(/non-local host/);
    });

    it('accepts the documented local development and test targets', () => {
      process.env.NODE_ENV = 'development';
      expect(
        assertSeedTargetIsSafe('postgres://penta_migrator:x@127.0.0.1:55432/penta_crm_dev')
          .databaseName,
      ).toBe('penta_crm_dev');
      expect(
        assertSeedTargetIsSafe('postgres://penta_migrator:x@127.0.0.1:55432/penta_crm_test')
          .databaseName,
      ).toBe('penta_crm_test');
    });

    it('refuses to run the test suite against production', () => {
      process.env.NODE_ENV = 'production';
      expect(() => resolveTestDatabaseUrl()).toThrow(/NODE_ENV=production/);
    });

    it('refuses to run the test suite without a test database configured', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.TEST_DATABASE_URL;
      expect(() => resolveTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL is not set/);
    });

    it('refuses a test URL that resolves to the development database', () => {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgres://penta_app:x@127.0.0.1:55432/penta_crm_dev';
      process.env.TEST_DATABASE_URL = 'postgres://other_user:y@localhost:55432/penta_crm_dev';
      // Different credentials, same host/port/database: still the same database.
      expect(() => resolveTestDatabaseUrl()).toThrow(/same database as DATABASE_URL/);
    });

    it('compares databases by host, port and name, ignoring credentials', () => {
      expect(
        sameDatabase(
          'postgres://a:1@127.0.0.1:55432/penta_crm_dev',
          'postgres://b:2@127.0.0.1:55432/penta_crm_dev',
        ),
      ).toBe(true);
      expect(
        sameDatabase(
          'postgres://a:1@127.0.0.1:55432/penta_crm_dev',
          'postgres://a:1@127.0.0.1:55432/penta_crm_test',
        ),
      ).toBe(false);
    });

    it('refuses a production server configuration that exposes demo mode', () => {
      Object.assign(process.env, {
        NODE_ENV: 'production',
        VITE_DEMO_MODE: 'true',
        SESSION_SECRET: 'b'.repeat(64),
        CSRF_SECRET: 'c'.repeat(64),
        DATABASE_URL: 'postgres://u:p@db:5432/penta_crm_prod',
      });
      expect(() => loadServerConfig()).toThrow(/VITE_DEMO_MODE/);
    });

    it('refuses a production server configuration with a placeholder secret', () => {
      Object.assign(process.env, {
        NODE_ENV: 'production',
        VITE_DEMO_MODE: 'false',
        SESSION_SECRET: 'replace-me-with-a-32-byte-random-hex-value',
        CSRF_SECRET: 'c'.repeat(64),
        DATABASE_URL: 'postgres://u:p@db:5432/penta_crm_prod',
      });
      expect(() => loadServerConfig()).toThrow(/placeholder or too short/);
    });

    it('forces secure cookies in production', () => {
      Object.assign(process.env, {
        NODE_ENV: 'production',
        VITE_DEMO_MODE: 'false',
        SESSION_SECRET: 'b'.repeat(64),
        CSRF_SECRET: 'c'.repeat(64),
        DATABASE_URL: 'postgres://u:p@db:5432/penta_crm_prod',
        // A development .env enables the test scanner, which production refuses.
        DOCUMENT_SCANNER: 'none',
      });
      expect(loadServerConfig().secureCookies).toBe(true);
    });

    it('passes the demo-exclusion build check', async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'scripts/check-demo-exclusion.ts'],
        { cwd: process.cwd(), env: { ...savedEnv, NODE_ENV: 'production', VITE_DEMO_MODE: 'false' } },
      );
      expect(stdout).toMatch(/Demo-exclusion check passed/);
    }, 60_000);

    it('fails the demo-exclusion build check when demo mode is enabled', async () => {
      await expect(
        execFileAsync(
          process.execPath,
          ['node_modules/tsx/dist/cli.mjs', 'scripts/check-demo-exclusion.ts'],
          { cwd: process.cwd(), env: { ...savedEnv, NODE_ENV: 'production', VITE_DEMO_MODE: 'true' } },
        ),
      ).rejects.toThrow();
    }, 60_000);

    it('documents a seed password that survives parsing and actually authenticates', async () => {
      // The check that was missing. Previously the harness seeded and asserted
      // with the same hard-coded constant, so both sides agreed while the value
      // a developer reads from .env.example was silently truncated by Node's
      // env-file parser at an unquoted '#'.
      const isolated = { ...process.env };
      const { literal, parsed } = readDocumentedSeedPassword();

      expect(literal, '.env.example must define SEED_DEFAULT_PASSWORD').toBeTruthy();

      // The value must survive parsing: otherwise the file shows one password
      // and the application receives another.
      expect(
        parsed,
        `.env.example shows ${JSON.stringify(literal)} but Node parses ` +
          `${JSON.stringify(parsed)} — quote the value`,
      ).toBe(literal);

      try {
        // Seed with what the application actually receives...
        process.env.SEED_DEFAULT_PASSWORD = parsed;
        await seedDatabase(process.env.TEST_MIGRATION_DATABASE_URL!);

        // ...then sign in with what a developer reads and types.
        const client = await startSession(ctx.app);
        const response = await client.agent
          .post('/api/auth/login')
          .set('Origin', TEST_ORIGIN)
          .set(CSRF_HEADER, client.csrfToken)
          .send({ email: emails.admin, password: literal });

        expect(
          response.status,
          `the password documented in .env.example (${JSON.stringify(literal)}) must sign in`,
        ).toBe(200);
      } finally {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, isolated);
        // Restore the fixtures for whatever runs next.
        await resetFixtures();
      }
    }, 60_000);

    it('registers no demo, seed, reset or user-switch endpoint', async () => {
      const { agent } = await signIn(ctx.app, emails.management);
      for (const route of [
        '/api/demo',
        '/api/demo/reset',
        '/api/seed',
        '/api/reset',
        '/api/auth/switch-user',
        '/api/auth/impersonate',
      ]) {
        const response = await agent.get(route);
        expect(response.status).toBe(404);
      }
    });
  });

  // --- Scenario 25 --------------------------------------------------------
  describe('scenario 25 — append-only audit and safe error output', () => {
    beforeEach(async () => {
      await resetFixtures();
    });

    it('lets the runtime role insert and read audit rows', async () => {
      const client = await signIn(ctx.app, emails.salesGA1);
      const response = await client.agent
        .post('/api/opportunities')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, client.csrfToken)
        .set('Idempotency-Key', nextIdempotencyKey('audit'))
        .send(createOpportunityPayload());

      expect(response.status).toBe(201);

      const rows = await ctx.database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.opportunityId, response.body.opportunity.id));
      expect(rows).toHaveLength(1);
    });

    it('denies the runtime role UPDATE on audit_events', async () => {
      const [existing] = await ctx.database.db.select({ id: auditEvents.id }).from(auditEvents).limit(1);
      // Make sure there is a row to attempt against.
      const targetId = existing?.id ?? null;
      if (!targetId) {
        await ctx.database.db.insert(auditEvents).values({
          actorId: ids.salesGA1,
          entityType: 'opportunity',
          entityId: ids.oppRafiq,
          action: 'test.seeded',
          requestId: 'operations-test',
        });
      }

      await expectRejectionMatching(
        ctx.database.db.execute(sql`UPDATE audit_events SET action = 'tampered'`),
        /permission denied/i,
      );
    });

    it('denies the runtime role DELETE on audit_events', async () => {
      await expectRejectionMatching(
        ctx.database.db.execute(sql`DELETE FROM audit_events`),
        /permission denied/i,
      );
    });

    it('denies the runtime role TRUNCATE on audit_events', async () => {
      await expectRejectionMatching(
        ctx.database.db.execute(sql`TRUNCATE TABLE audit_events`),
        /permission denied|must be owner/i,
      );
    });

    it('denies the runtime role any DDL', async () => {
      await expectRejectionMatching(
        ctx.database.db.execute(sql`CREATE TABLE should_not_exist (id int)`),
        /permission denied/i,
      );
    });

    it('confirms the runtime role is not a superuser', async () => {
      const result = await ctx.database.db.execute<{ usesuper: boolean; current_user: string }>(
        sql`SELECT current_user, usesuper FROM pg_user WHERE usename = current_user`,
      );
      expect(result.rows[0]!.current_user).toBe('penta_app');
      expect(result.rows[0]!.usesuper).toBe(false);
    });

    it('returns no secret, connection string or stack trace in an error body', async () => {
      // Induce a genuine server fault.
      await runAsMigrator(`
        CREATE OR REPLACE FUNCTION test_boom() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'internal detail that must not leak'; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_boom_trigger
          BEFORE INSERT ON follow_ups FOR EACH ROW EXECUTE FUNCTION test_boom();
      `);

      try {
        const client = await signIn(ctx.app, emails.salesGA1);
        const response = await client.agent
          .post('/api/opportunities')
          .set('Origin', TEST_ORIGIN)
          .set(CSRF_HEADER, client.csrfToken)
          .set('Idempotency-Key', nextIdempotencyKey('error-shape'))
          .send(createOpportunityPayload());

        expect(response.status).toBe(500);
        expect(Object.keys(response.body).sort()).toEqual(['code', 'message', 'requestId']);

        const serialised = JSON.stringify(response.body);
        expect(serialised).not.toContain('internal detail that must not leak');
        expect(serialised).not.toContain('postgres://');
        expect(serialised).not.toContain(process.env.SESSION_SECRET ?? '__absent__');
        expect(serialised).not.toContain(process.env.CSRF_SECRET ?? '__absent__');
        expect(serialised).not.toMatch(/\bat \w+ \(/); // no stack frames
        expect(serialised).not.toContain('node_modules');
      } finally {
        await runAsMigrator(`
          DROP TRIGGER IF EXISTS test_boom_trigger ON follow_ups;
          DROP FUNCTION IF EXISTS test_boom();
        `);
      }
    });

    it('returns no business note or record name in a 404 body', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const [record] = await ctx.database.db
        .select({ description: opportunities.description, name: opportunities.name })
        .from(opportunities)
        .where(eq(opportunities.id, ids.oppImran));

      const response = await agent.get(`/api/opportunities/${ids.oppImran}`);
      const serialised = JSON.stringify(response.body);

      expect(response.status).toBe(404);
      expect(serialised).not.toContain(record!.name);
      expect(serialised).not.toContain(record!.description);
    });

    it('returns a unique request id on every response', async () => {
      const { agent } = await signIn(ctx.app, emails.salesGA1);
      const first = await agent.get(`/api/opportunities/${ids.oppTasnia}`);
      const second = await agent.get(`/api/opportunities/${ids.oppTasnia}`);

      expect(first.body.requestId).toBeTruthy();
      expect(first.body.requestId).not.toBe(second.body.requestId);
      expect(first.headers['x-request-id']).toBe(first.body.requestId);
    });
  });
});
