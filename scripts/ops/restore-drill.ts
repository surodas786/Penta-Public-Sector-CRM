/**
 * Backup and restore drill (NFR-002, AT-16 "backup restore brings back record
 * relationships and attachment access"), in an isolated nonproduction
 * environment:
 *
 *   1. reseeds the TEST database with the synthetic fixtures and uploads real
 *      documents through the application (a revision, a Bangla file name, an
 *      infected test file that ends up quarantined);
 *   2. backs it up (database snapshot + files, encrypted);
 *   3. restores into a scratch database `penta_crm_restore_check` and a new
 *      document directory, with the restore's own verification;
 *   4. runs the application against the RESTORED database and storage: signs
 *      in, reads an opportunity with its history, follow-ups and contacts,
 *      and downloads every document, comparing bytes with the originals;
 *   5. shows that a tampered backup is refused;
 *   6. times a database-only backup and restore of the capacity database
 *      (NFR-010 size), when it exists, for recovery-time planning.
 *
 * Writes docs/evidence/operations/restore-drill.md. Never touches the
 * development database.
 *
 *   BACKUP_ENCRYPTION_KEY=<64 hex> PG_TOOLS_CONTAINER=penta-crm-postgres npm run ops:restore-drill
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import pg from 'pg';
import request from 'supertest';

import { CSRF_HEADER, FILE_NAME_HEADER, IDEMPOTENCY_HEADER } from '../../shared/api.js';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db/client.js';
import { legacyUuid } from '../../server/db/seedData.js';
import { seedDatabase } from '../../server/db/seed.js';
import { loadServerConfig } from '../../server/env.js';
import { hashPassword } from '../../server/auth/password.js';
import { runBackup } from './backup.js';
import { runRestore, restoreOptionsFromEnv } from './restore.js';

try {
  process.loadEnvFile('.env');
} catch {
  // The environment may be supplied directly.
}

const ORIGIN = 'http://localhost:5173';
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD?.trim() || 'Synthetic-Dev-2026';
const RAFIQ = 'rafiq.hasan@example.com';
const OPPORTUNITY = legacyUuid('p1');
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('');

const lines: string[] = [];
const log = (line: string) => {
  console.log(line);
  lines.push(line);
};

function appFor(databaseUrl: string, storageDir: string) {
  process.env.SESSION_SECRET ??= randomBytes(32).toString('hex');
  process.env.CSRF_SECRET ??= randomBytes(32).toString('hex');
  process.env.APP_ORIGIN = ORIGIN;
  const config = loadServerConfig({
    databaseUrl,
    appOrigin: ORIGIN,
    requestLog: 'off',
    documents: { storageDir, scanner: 'test', maxUploadBytes: 25 * 1024 * 1024, uploadTtlMinutes: 60 },
  });
  const database = createDatabase(databaseUrl);
  return { app: createApp({ database, config, loginRateLimit: { windowMs: 60_000, limit: 1_000 } }), database };
}

async function signIn(app: ReturnType<typeof appFor>['app']) {
  const agent = request.agent(app);
  const bootstrap = await agent.get('/api/auth/csrf').expect(200);
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set(CSRF_HEADER, bootstrap.body.csrfToken)
    .send({ email: RAFIQ, password: PASSWORD })
    .expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

async function upload(client: Awaited<ReturnType<typeof signIn>>, fileName: string, content: Buffer, documentId?: string) {
  const staged = await client.agent
    .post(`/api/opportunities/${OPPORTUNITY}/document-uploads`)
    .set('Origin', ORIGIN)
    .set(CSRF_HEADER, client.csrf)
    .set(FILE_NAME_HEADER, encodeURIComponent(fileName))
    .set('Content-Type', 'application/octet-stream')
    .send(content)
    .expect(201);
  const finalized = await client.agent
    .post(`/api/document-uploads/${staged.body.uploadId}/finalize`)
    .set('Origin', ORIGIN)
    .set(CSRF_HEADER, client.csrf)
    .set(IDEMPOTENCY_HEADER, `drill-${randomBytes(8).toString('hex')}`)
    .send(documentId ? { documentId } : { category: 'proposal' })
    .expect(201);
  return finalized.body as { id: string; latest: { id: string; scanState: string } };
}

const withDatabase = (url: string, name: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('The drill never runs in production.');
  const testRuntime = process.env.TEST_DATABASE_URL;
  const testMigrator = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!testRuntime || !testMigrator) throw new Error('TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are required.');
  const workRoot = mkdtempSync(path.join(os.tmpdir(), 'penta-restore-drill-'));
  const sourceStorage = path.join(workRoot, 'source-documents');
  const backupRoot = path.join(workRoot, 'backups');

  log(`# Backup and restore drill — ${new Date().toISOString()}`);
  log('');
  log('Source: the isolated TEST database, reseeded with synthetic fixtures; documents uploaded through the application.');
  log('');

  // 1. Source data, including real files.
  await seedDatabase(testMigrator, { passwordHash: await hashPassword(PASSWORD) });
  const source = appFor(testRuntime, sourceStorage);
  const originals = new Map<string, Buffer>();
  try {
    const client = await signIn(source.app);
    const proposal = Buffer.from('%PDF-1.4\n% Synthetic proposal for the restore drill\n%%EOF\n');
    const notes = Buffer.from('সভার নোট: পুনরুদ্ধার পরীক্ষা।\nSynthetic meeting notes.\n', 'utf8');
    const revised = Buffer.from('Synthetic meeting notes, second revision.\n', 'utf8');
    const first = await upload(client, 'proposal.pdf', proposal);
    originals.set(first.latest.id, proposal);
    const bangla = await upload(client, 'সভার নোট.txt', notes);
    originals.set(bangla.latest.id, notes);
    const second = await upload(client, 'সভার নোট v2.txt', revised, bangla.id);
    originals.set(second.latest.id, revised);
    const infected = await upload(client, 'scanner-check.txt', Buffer.from(`Synthetic.\n${EICAR}\n`, 'latin1'));
    log(`Uploaded 4 files (one a revision, one with a Bangla name); the EICAR test file was ${infected.latest.scanState} and quarantined.`);
  } finally {
    await source.database.close();
  }

  // 2. Backup.
  const backup = await runBackup({ databaseUrl: testMigrator, storageDir: sourceStorage, backupRoot });
  log(`Backup: ${backup.ms} ms; database dump ${backup.manifest.dump.bytes} bytes; ${backup.manifest.files.length} files; ${backup.manifest.quarantined.length} quarantined file not copied.`);
  const plaintext = readFileSync(path.join(backup.directory, 'database.dump.enc'));
  const leaks = ['rafiq.hasan@example.com', 'Municipal Service Portal'].filter((needle) => plaintext.includes(Buffer.from(needle)));
  if (leaks.length) throw new Error(`Encrypted dump contains plaintext: ${leaks.join(', ')}`);
  log('The encrypted dump contains no readable account or opportunity text.');

  // 3. Restore into a scratch database and a new directory.
  const options = { ...restoreOptionsFromEnv(backup.directory), migratorUrl: testMigrator, runtimeUrl: testRuntime, storageDir: path.join(workRoot, 'restored-documents') };
  const report = await runRestore(options);
  log(`Restore into \`${report.targetDatabase}\`: ${report.ms} ms.`);
  for (const check of report.checks) log(`- ok: ${check}`);

  // 4. The application on the restored copy.
  const restored = appFor(withDatabase(testRuntime, report.targetDatabase), report.storageDir);
  try {
    const client = await signIn(restored.app);
    const detail = await client.agent.get(`/api/opportunities/${OPPORTUNITY}`).expect(200);
    const history = await client.agent.get(`/api/opportunities/${OPPORTUNITY}/history`).expect(200);
    const followUps = await client.agent.get(`/api/opportunities/${OPPORTUNITY}/follow-ups`).expect(200);
    const contacts = await client.agent.get(`/api/opportunities/${OPPORTUNITY}/contacts`).expect(200);
    log(
      `- ok: signed in on the restored copy; "${detail.body.name}" with ${history.body.total} history events, ` +
        `${followUps.body.total} follow-ups and ${contacts.body.items.length} linked contacts`,
    );
    for (const [revisionId, bytes] of originals) {
      const download = await client.agent
        .get(`/api/document-revisions/${revisionId}/download`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      if (!Buffer.from(download.body as Buffer).equals(bytes)) throw new Error(`Restored download of ${revisionId} differs from the original.`);
    }
    log(`- ok: all ${originals.size} documents (including the earlier revision) download from the restored copy, byte-identical`);
    const created = await client.agent
      .post('/api/opportunities')
      .set('Origin', ORIGIN)
      .set(CSRF_HEADER, client.csrf)
      .set(IDEMPOTENCY_HEADER, `drill-${randomBytes(8).toString('hex')}`)
      .send({
        name: 'Created after restore',
        organizationId: legacyUuid('o7'),
        solutionCategory: 'erp',
        estimatedValue: '100.00',
        ownerId: legacyUuid('u-rafiq'),
        sectionId: legacyUuid('GA'),
        stage: 'identified',
        priority: 'medium',
        initialFollowUpTitle: 'Check the restored system',
        initialFollowUpDueDate: '2027-01-01',
      });
    if (created.status !== 201) throw new Error(`Creating a record on the restored copy failed: ${created.status}`);
    log(`- ok: the restored copy accepts new work (reference ${created.body.opportunity.reference} continues the sequence)`);
  } finally {
    await restored.database.close();
  }

  // 5. Tampering is refused.
  const tamperedDir = path.join(workRoot, 'tampered');
  mkdirSync(tamperedDir);
  for (const name of ['manifest.json.enc', 'backup-info.json']) writeFileSync(path.join(tamperedDir, name), readFileSync(path.join(backup.directory, name)));
  const dump = readFileSync(path.join(backup.directory, 'database.dump.enc'));
  const middle = Math.floor(dump.length / 2);
  dump[middle] = (dump[middle] ?? 0) ^ 0xff;
  writeFileSync(path.join(tamperedDir, 'database.dump.enc'), dump);
  const refused = await runRestore({ ...options, backupDirectory: tamperedDir, storageDir: path.join(workRoot, 'tampered-docs') }).then(
    () => false,
    () => true,
  );
  if (!refused) throw new Error('A tampered backup was restored.');
  log('- ok: a backup with one altered byte is refused before anything is restored');

  // 6. Database-only timing at the capacity envelope, if that database exists.
  const capacityMigrator = withDatabase(testMigrator, 'penta_crm_capacity');
  const probe = new pg.Client({ connectionString: capacityMigrator });
  const capacityExists = await probe.connect().then(
    () => true,
    () => false,
  );
  if (capacityExists) {
    await probe.end();
    const { pgTool, encryptStream, encryptionKey, decryptToBuffer } = await import('./backup-common.js');
    const key = encryptionKey();
    let started = Date.now();
    const capacityDump = pgTool('pg_dump', ['--format=custom'], capacityMigrator);
    const target = path.join(workRoot, 'capacity.dump.enc');
    const [result] = await Promise.all([encryptStream(capacityDump.stdout, target, key), capacityDump.done]);
    const dumpMs = Date.now() - started;
    started = Date.now();
    const restoreTarget = 'penta_crm_restore_capacity';
    const admin = new pg.Client({ connectionString: options.adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${restoreTarget} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${restoreTarget} OWNER penta_migrator`);
    await admin.end();
    const restoreRun = pgTool('pg_restore', ['--exit-on-error', '--single-transaction', '--no-comments'], withDatabase(testMigrator, restoreTarget), await decryptToBuffer(target, key));
    restoreRun.stdout.resume();
    await restoreRun.done;
    const restoreMs = Date.now() - started;
    const admin2 = new pg.Client({ connectionString: options.adminUrl });
    await admin2.connect();
    await admin2.query(`DROP DATABASE IF EXISTS ${restoreTarget} WITH (FORCE)`);
    await admin2.end();
    log('');
    log(
      `Capacity database (NFR-010 envelope, database only — its documents are metadata without files): ` +
        `encrypted dump ${result.bytes} bytes in ${dumpMs} ms; decrypt and restore in ${restoreMs} ms.`,
    );
  } else {
    log('');
    log('Capacity database not present: capacity backup timing skipped (run `npm run capacity:seed` first).');
  }

  // Leave nothing behind but the evidence.
  const cleanup = new pg.Client({ connectionString: options.adminUrl });
  await cleanup.connect();
  await cleanup.query(`DROP DATABASE IF EXISTS ${report.targetDatabase} WITH (FORCE)`);
  await cleanup.end();
  log('');
  log(`Scratch database dropped; working files in ${workRoot} (temporary directory).`);

  const dir = path.join('docs', 'evidence', 'operations');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'restore-drill.md'), `${lines.join('\n')}\n`);
}

main().catch((error: unknown) => {
  console.error('Restore drill FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
