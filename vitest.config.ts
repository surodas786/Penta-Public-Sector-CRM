import { defineConfig } from 'vitest/config';

/**
 * Backend integration tests.
 *
 * They run against a real PostgreSQL test database using the restricted
 * application role, driving the real Express app in-process through supertest.
 * A single fork runs them sequentially so suites cannot truncate each other's
 * fixtures (plan 7.6).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/tests/**/*.test.ts'],
    setupFiles: ['server/tests/setup.ts'],
    globalSetup: ['server/tests/globalSetup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
  },
});
