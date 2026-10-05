import { defineConfig, devices } from '@playwright/test';

// The config itself needs TEST_DATABASE_URL before it can hand it to the
// server process. CI supplies the environment directly, so this is optional.
try {
  process.loadEnvFile('.env');
} catch {
  // No local .env; rely on the ambient environment.
}

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL must be set. The browser smoke test runs against the test database so it ' +
      'never disturbs development data.',
  );
}

/**
 * Browser smoke test (plan 7.6).
 *
 * Deliberately small: sign in, create, refresh, sign out. The permission and
 * data-integrity rules are proved by the backend integration suite, which
 * exercises them far more thoroughly than a browser can; duplicating them here
 * would be slow and would not add evidence.
 *
 * Runs against the TEST database so a smoke run never disturbs development
 * data. Both servers are started by Playwright and torn down afterwards.
 */
const API_PORT = 4801;
const WEB_PORT = 5174;
const APP_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Screenshot capture is run on demand (`npm run evidence`), not as part of
  // the smoke gate.
  // `npm run evidence` names the spec on the command line, which is enough to
  // include it; without that, the spec was ignored and the documented script
  // found no tests.
  testIgnore:
    process.env.CAPTURE_EVIDENCE === 'true' || process.argv.some((arg) => /evidence(-\w+)?\.spec/.test(arg))
      ? []
      : ['**/evidence*.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: APP_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // Reseed, then serve the API against the test database.
      command: `npm run db:seed:test && npx tsx --env-file-if-exists=.env server/index.ts`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        APP_ORIGIN,
        HOST: '127.0.0.1',
        // Smoke tests never touch the development database.
        DATABASE_URL: TEST_DATABASE_URL,
        SESSION_SECRET: process.env.SESSION_SECRET ?? '',
        CSRF_SECRET: process.env.CSRF_SECRET ?? '',
        SEED_DEFAULT_PASSWORD: process.env.SEED_DEFAULT_PASSWORD ?? '',
        TEST_MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL ?? '',
        // Browser checks use their own private file directory and the
        // development TEST scanner, whatever a developer's .env says.
        DOCUMENT_STORAGE_DIR: './var/e2e-documents',
        DOCUMENT_SCANNER: 'test',
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: APP_ORIGIN,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
      env: {
        VITE_DEMO_MODE: 'false',
        PORT: String(API_PORT),
      },
    },
  ],
});
