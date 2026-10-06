/**
 * Restores a backup made by `scripts/ops/backup.ts` into a NEW database and
 * a NEW document directory, then verifies it (NFR-002).
 *
 * It never restores over an existing database: the target must not exist,
 * except a `penta_crm_restore*` scratch database, which is dropped and
 * recreated for a drill. Restoring production is a runbook decision
 * (docs/operations/backup-and-restore.md), not a default.
 *
 * Verification, all of which must pass:
 *   - every encrypted file decrypts (GCM authentication: no tampering);
 *   - the dump and every document file match the checksums in the manifest;
 *   - every table has exactly the row count recorded at the snapshot;
 *   - the applied-migration count matches;
 *   - the runtime role still cannot UPDATE, DELETE or TRUNCATE audit events.
 *
 *   BACKUP_ENCRYPTION_KEY=… PG_TOOLS_CONTAINER=penta-crm-postgres npm run ops:restore -- <backup directory>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';

import { decryptToBuffer, encryptionKey, objectPath, pgTool, readEncryptedJson, sha256, type BackupManifest } from './backup-common.js';
import { listBackups } from './backup.js';

try {
  process.loadEnvFile('.env');
} catch {
  // The environment may be supplied directly.
}

export interface RestoreOptions {
  backupDirectory: string;
  /** A role that may CREATE DATABASE, connected to the maintenance database. */
  adminUrl: string;
  /** The schema owner's URL; its database name is replaced by `targetDatabase`. */
  migratorUrl: string;
  /** The runtime role's URL, likewise; used for the privilege check. */
  runtimeUrl: string;
  targetDatabase: string;
  storageDir: string;
}

export interface RestoreReport {
  targetDatabase: string;
  storageDir: string;
  ms: number;
  tables: number;
  rows: number;
  files: number;
  checks: string[];
}

const withDatabase = (url: string, name: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
};

export async function runRestore(options: RestoreOptions): Promise<RestoreReport> {
  const started = Date.now();
  const key = encryptionKey();
  const checks: string[] = [];
  const target = options.targetDatabase;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(target)) throw new Error('Invalid target database name.');
  if (['penta_crm_dev', 'penta_crm_test', 'penta_crm_capacity', 'postgres'].includes(target)) {
    throw new Error(`Refusing to restore over ${target}.`);
  }

  // 1. Decrypt and verify the manifest and the dump before touching anything.
  const manifest = await readEncryptedJson<BackupManifest>(path.join(options.backupDirectory, 'manifest.json.enc'), key);
  const dump = await decryptToBuffer(path.join(options.backupDirectory, 'database.dump.enc'), key);
  if (sha256(dump) !== manifest.dump.sha256) throw new Error('Database dump checksum does not match the manifest.');
  checks.push('manifest and database dump decrypt and authenticate; dump checksum matches');

  // 2. A new, locked-down database owned by the schema owner.
  const admin = new pg.Client({ connectionString: options.adminUrl });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target]);
    if (exists.rowCount) {
      if (!target.startsWith('penta_crm_restore')) throw new Error(`Database ${target} already exists. Restore only into a new database.`);
      await admin.query(`DROP DATABASE ${target} WITH (FORCE)`);
    }
    await admin.query(`CREATE DATABASE ${target} OWNER penta_migrator`);
  } finally {
    await admin.end();
  }
  const scoped = new pg.Client({ connectionString: withDatabase(options.adminUrl, target) });
  await scoped.connect();
  try {
    await scoped.query(`
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      REVOKE ALL ON DATABASE ${target} FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${target} TO penta_app, penta_migrator;
      ALTER SCHEMA public OWNER TO penta_migrator;`);
  } finally {
    await scoped.end();
  }

  // 3. The database, in one transaction, as the schema owner (grants included).
  const migratorUrl = withDatabase(options.migratorUrl, target);
  const restore = pgTool('pg_restore', ['--exit-on-error', '--single-transaction', '--no-comments'], migratorUrl, dump);
  restore.stdout.resume();
  await restore.done;
  checks.push('pg_restore completed in a single transaction');

  // 4. The files, each decrypted, authenticated and checksummed.
  for (const file of manifest.files) {
    const content = await decryptToBuffer(path.join(options.backupDirectory, 'files', `${file.key}.enc`), key);
    if (sha256(content) !== file.sha256) throw new Error(`Document file ${file.key} does not match its checksum.`);
    const destination = objectPath(options.storageDir, file.key);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, content, { mode: 0o600, flag: 'wx' });
  }
  checks.push(`${manifest.files.length} document files restored, each matching its database checksum`);

  // 5. Verify the restored database against the snapshot.
  const restored = new pg.Client({ connectionString: migratorUrl });
  await restored.connect();
  let rows = 0;
  try {
    for (const [table, expected] of Object.entries(manifest.tableCounts)) {
      const { rows: result } = await restored.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
      if (result[0]!.n !== expected) throw new Error(`Table ${table}: ${result[0]!.n} rows restored, ${expected} expected.`);
      rows += expected;
    }
    checks.push(`${Object.keys(manifest.tableCounts).length} tables, ${rows} rows: every count matches the snapshot`);
    const { rows: migrations } = await restored.query<{ n: number }>('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    if (migrations[0]!.n !== manifest.migrations) throw new Error('Applied migration count differs from the backup.');
    checks.push(`${manifest.migrations} applied migrations recorded, as in the source`);
    const { rows: missing } = await restored.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM document_revisions WHERE scan_state <> 'infected' AND storage_key <> ALL($1::text[])`,
      [manifest.files.map((file) => file.key)],
    );
    if (missing[0]!.n !== 0) throw new Error(`${missing[0]!.n} restored revisions have no restored file.`);
    checks.push('every non-quarantined document revision has its file');
  } finally {
    await restored.end();
  }

  const runtime = new pg.Client({ connectionString: withDatabase(options.runtimeUrl, target) });
  await runtime.connect();
  try {
    const { rows: privileges } = await runtime.query(`
      SELECT has_table_privilege(current_user, 'audit_events', 'INSERT') AS insert,
             has_table_privilege(current_user, 'audit_events', 'UPDATE') AS update,
             has_table_privilege(current_user, 'audit_events', 'DELETE') AS delete,
             has_table_privilege(current_user, 'audit_events', 'TRUNCATE') AS truncate`);
    const p = privileges[0] as Record<string, boolean>;
    if (!p.insert || p.update || p.delete || p.truncate) throw new Error(`Runtime privileges on audit_events not restored correctly: ${JSON.stringify(p)}`);
    checks.push('runtime role: audit events still append-only (INSERT yes; UPDATE, DELETE, TRUNCATE no)');
  } finally {
    await runtime.end();
  }

  return { targetDatabase: target, storageDir: options.storageDir, ms: Date.now() - started, tables: Object.keys(manifest.tableCounts).length, rows, files: manifest.files.length, checks };
}

export function restoreOptionsFromEnv(backupDirectory: string): RestoreOptions {
  const migratorUrl = process.env.RESTORE_MIGRATION_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.RESTORE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!migratorUrl || !runtimeUrl) throw new Error('Set MIGRATION_DATABASE_URL and DATABASE_URL (or the RESTORE_* equivalents).');
  return {
    backupDirectory,
    adminUrl:
      process.env.RESTORE_ADMIN_DATABASE_URL ??
      `postgres://penta_superuser:${process.env.POSTGRES_SUPERUSER_PASSWORD ?? 'penta_local_superuser'}@127.0.0.1:55432/postgres`,
    migratorUrl,
    runtimeUrl,
    targetDatabase: process.env.RESTORE_TARGET_DATABASE ?? 'penta_crm_restore_check',
    storageDir: process.env.RESTORE_STORAGE_DIR ?? `./var/restore-check/documents-${Date.now()}`,
  };
}

const invokedDirectly = process.argv[1]?.endsWith('restore.ts');
if (invokedDirectly) {
  void (async () => {
    const backupRoot = process.env.BACKUP_DIR ?? './var/backups';
    const chosen = process.argv[2] ?? (await listBackups(backupRoot)).map((name) => path.join(backupRoot, name))[0];
    if (!chosen) throw new Error('No backup given and none found in BACKUP_DIR.');
    const report = await runRestore(restoreOptionsFromEnv(chosen));
    console.log(`Restored ${chosen} into ${report.targetDatabase} (${report.storageDir}) in ${report.ms} ms:`);
    for (const check of report.checks) console.log(`  ok  ${check}`);
  })().catch((error: unknown) => {
    console.error('Restore failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
