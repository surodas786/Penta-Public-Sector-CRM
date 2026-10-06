/**
 * Consistent, encrypted backup of the database and the document files
 * (NFR-002).
 *
 * Consistency: one REPEATABLE READ transaction exports a snapshot; pg_dump
 * dumps exactly that snapshot (`--snapshot`), and the same transaction lists
 * every stored document revision. Files are immutable once written (a revision
 * is a new key, never an overwrite), so every file the dump refers to exists
 * and is copied and checksummed against the database's own SHA-256. Uploads
 * staged but not finalized are not business records and are not copied;
 * infected files sit in quarantine and are deliberately left out.
 *
 *   BACKUP_ENCRYPTION_KEY=<64 hex> PG_TOOLS_CONTAINER=penta-crm-postgres npm run ops:backup
 *
 * Environment:
 *   BACKUP_DATABASE_URL    connection that may read every table (default MIGRATION_DATABASE_URL)
 *   DOCUMENT_STORAGE_DIR   the private document directory (default ./var/documents)
 *   BACKUP_DIR             where backups are written (default ./var/backups)
 */
import { createReadStream } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';

import {
  BACKUP_FORMAT,
  encryptStream,
  encryptionKey,
  objectPath,
  pgTool,
  writeEncryptedJson,
  writeJson,
  type BackupManifest,
} from './backup-common.js';

try {
  process.loadEnvFile('.env');
} catch {
  // The environment may be supplied directly.
}

export async function runBackup(options: { databaseUrl: string; storageDir: string; backupRoot: string }): Promise<{ directory: string; manifest: BackupManifest; ms: number }> {
  if (process.env.NODE_ENV === 'production' && process.env.BACKUP_ALLOW_PRODUCTION !== 'true') {
    // Production backups run under the operations runbook, deliberately.
    throw new Error('Set BACKUP_ALLOW_PRODUCTION=true to back up a production database.');
  }
  const key = encryptionKey();
  const started = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(options.backupRoot, `backup-${stamp}`);

  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: snapshotRows } = await client.query<{ snapshot: string }>('SELECT pg_export_snapshot() AS snapshot');
    const snapshot = snapshotRows[0]!.snapshot;

    // 1. The database, at the snapshot, encrypted as it streams.
    const dump = pgTool('pg_dump', ['--format=custom', `--snapshot=${snapshot}`], options.databaseUrl);
    const [dumpResult] = await Promise.all([encryptStream(dump.stdout, path.join(directory, 'database.dump.enc'), key), dump.done]);

    // 2. Row counts and the document file list, from the same snapshot.
    const { rows: tables } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const tableCounts: Record<string, number> = {};
    for (const { tablename } of tables) {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${tablename}"`);
      tableCounts[tablename] = rows[0]!.n;
    }
    const { rows: migrationRows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    const { rows: revisions } = await client.query<{ storage_key: string; sha256: string; byte_size: number; scan_state: string }>(
      `SELECT storage_key, sha256, byte_size, scan_state FROM document_revisions ORDER BY storage_key`,
    );
    await client.query('COMMIT');

    // 3. The files, each verified against the database's checksum as it is encrypted.
    const files: BackupManifest['files'] = [];
    const quarantined: string[] = [];
    for (const revision of revisions) {
      if (revision.scan_state === 'infected') {
        quarantined.push(revision.storage_key);
        continue;
      }
      const source = objectPath(options.storageDir, revision.storage_key);
      await access(source).catch(() => {
        throw new Error(`Document file missing for a stored revision (${revision.storage_key}). Backup aborted.`);
      });
      const result = await encryptStream(createReadStream(source), path.join(directory, 'files', `${revision.storage_key}.enc`), key);
      if (result.sha256 !== revision.sha256) {
        throw new Error(`Checksum mismatch for document file ${revision.storage_key}. Backup aborted.`);
      }
      files.push({ key: revision.storage_key, sha256: result.sha256, bytes: result.bytes, scanState: revision.scan_state });
    }

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      snapshot,
      migrations: migrationRows[0]!.n,
      tableCounts,
      files,
      quarantined,
      dump: dumpResult,
    };
    await writeEncryptedJson(path.join(directory, 'manifest.json.enc'), manifest, key);
    await writeJson(path.join(directory, 'backup-info.json'), {
      format: BACKUP_FORMAT,
      createdAt: manifest.createdAt,
      databaseDumpBytes: dumpResult.bytes,
      documentFiles: files.length,
      quarantinedNotCopied: quarantined.length,
      encryption: 'AES-256-GCM per file; key held separately (BACKUP_ENCRYPTION_KEY)',
    });
    return { directory, manifest, ms: Date.now() - started };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Lists backups, newest first (used by retention housekeeping and the drill). */
export async function listBackups(backupRoot: string): Promise<string[]> {
  const entries = await readdir(backupRoot).catch(() => [] as string[]);
  return entries.filter((name) => name.startsWith('backup-')).sort().reverse();
}

const invokedDirectly = process.argv[1]?.endsWith('backup.ts');
if (invokedDirectly) {
  const databaseUrl = process.env.BACKUP_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
  if (!databaseUrl) throw new Error('Set BACKUP_DATABASE_URL (or MIGRATION_DATABASE_URL).');
  runBackup({
    databaseUrl,
    storageDir: process.env.DOCUMENT_STORAGE_DIR ?? './var/documents',
    backupRoot: process.env.BACKUP_DIR ?? './var/backups',
  })
    .then(({ directory, manifest, ms }) => {
      console.log(
        `Backup written to ${directory} in ${ms} ms: database ${manifest.dump.bytes} bytes, ` +
          `${manifest.files.length} document files, ${manifest.quarantined.length} quarantined files not copied.`,
      );
    })
    .catch((error: unknown) => {
      console.error('Backup failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
