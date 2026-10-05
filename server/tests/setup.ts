/**
 * Loads local configuration for the test run.
 *
 * In CI the variables come from the workflow environment and no .env exists,
 * which is why the load is optional. The actual safety checks — production
 * refusal and dev/test database separation — live in globalSetup.ts and in
 * server/env.ts, not here.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No local .env (CI). Environment variables are expected to be set already.
}

// Vitest sets this, but be explicit: several guards key off it.
process.env.NODE_ENV = 'test';
