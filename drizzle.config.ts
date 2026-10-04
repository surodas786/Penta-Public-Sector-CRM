import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated from server/db/schema.ts and applied by
 * `npm run db:migrate` using the schema-owner role, never the restricted
 * application role (plan 4.4).
 */
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? 'postgres://localhost:55432/penta_crm_dev',
  },
  strict: true,
  verbose: true,
});
