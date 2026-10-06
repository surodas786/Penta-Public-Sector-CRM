/**
 * The capacity database: a separate, synthetic-only database used to measure
 * the NFR-010 envelope. Never the development, test or any production
 * database.
 *
 * Connections (all local, all overridable):
 *   CAPACITY_ADMIN_DATABASE_URL      a role allowed to CREATE DATABASE (the
 *                                    local docker superuser); used only to
 *                                    create the database and its grants
 *   CAPACITY_MIGRATION_DATABASE_URL  schema owner, for migrations and the seed
 *   CAPACITY_DATABASE_URL            the restricted runtime role, for the API
 */
export const CAPACITY_DATABASE_NAME = 'penta_crm_capacity';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Derives the capacity URLs from the development ones unless set explicitly. */
export function capacityUrls(): { admin: string; migrator: string; runtime: string } {
  const migrationBase = process.env.MIGRATION_DATABASE_URL;
  const runtimeBase = process.env.DATABASE_URL;
  const migrator = process.env.CAPACITY_MIGRATION_DATABASE_URL ?? (migrationBase ? withDatabase(migrationBase, CAPACITY_DATABASE_NAME) : '');
  const runtime = process.env.CAPACITY_DATABASE_URL ?? (runtimeBase ? withDatabase(runtimeBase, CAPACITY_DATABASE_NAME) : '');
  const admin =
    process.env.CAPACITY_ADMIN_DATABASE_URL ??
    `postgres://penta_superuser:${process.env.POSTGRES_SUPERUSER_PASSWORD ?? 'penta_local_superuser'}@127.0.0.1:55432/postgres`;
  for (const [name, value] of [
    ['migrator', migrator],
    ['runtime', runtime],
  ] as const) {
    if (!value) throw new Error(`No ${name} connection for the capacity database. Set DATABASE_URL and MIGRATION_DATABASE_URL.`);
  }
  return { admin, migrator, runtime };
}

/** Refuses anything but the local capacity database, and production outright. */
export function assertCapacityTarget(url: string): void {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run capacity tooling with NODE_ENV=production.');
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');
  if (name !== CAPACITY_DATABASE_NAME) {
    throw new Error(`Capacity tooling only writes to "${CAPACITY_DATABASE_NAME}", not "${name}".`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) && process.env.CAPACITY_ALLOW_REMOTE !== 'true') {
    throw new Error(`Refusing a non-local capacity database host "${parsed.hostname}" (set CAPACITY_ALLOW_REMOTE=true for an isolated staging host).`);
  }
}

/** Password for every synthetic capacity account: the development seed password. */
export function capacityPassword(): string {
  return process.env.SEED_DEFAULT_PASSWORD?.trim() || 'Synthetic-Dev-2026';
}
