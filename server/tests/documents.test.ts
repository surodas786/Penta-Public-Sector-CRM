/**
 * Milestone 5: private documents (FR-060, FR-061, SEC-010, SEC-011, AT-13).
 *
 * Every test file is synthetic and built in memory (helpers/files.ts). The
 * scanner is the deterministic TEST scanner unless a test replaces it; it
 * recognises the EICAR test string and nothing else.
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CSRF_HEADER, FILE_NAME_HEADER } from '../../shared/api.js';
import { createDocumentServices } from '../app.js';
import { FixedClock, resetClock, setClock } from '../clock.js';
import { auditEvents, documentRevisions, documents, documentUploads, opportunities } from '../db/schema.js';
import type { DocumentScanner } from '../documents/scanner.js';
import { LocalDocumentStorage } from '../documents/storage.js';
import { cleanupAbandonedUploads, scanPendingRevisions } from '../services/documents.js';
import {
  CSV,
  DOCX,
  DOCX_DECLARING_MACROS,
  DOCX_WITH_MACROS,
  EICAR_TEXT,
  JPEG,
  PDF,
  PNG,
  SCANNER_FAILURE_TEXT,
  TEXT,
  WINDOWS_EXECUTABLE,
  XLSX,
} from './helpers/files.js';
import {
  ABSENT_UUID,
  TEST_ORIGIN,
  createTestApp,
  emails,
  ids,
  nextIdempotencyKey,
  resetFixtures,
  send,
  signIn,
  type SignedInClient,
  type TestContext,
} from './helpers/harness.js';

const NOW = '2026-10-05T10:00:00+06:00';

function upload(_ctx: TestContext, client: SignedInClient, opportunityId: string, fileName: string, content: Buffer) {
  return client.agent
    .post(`/api/opportunities/${opportunityId}/document-uploads`)
    .set('Origin', TEST_ORIGIN)
    .set(CSRF_HEADER, client.csrfToken)
    .set(FILE_NAME_HEADER, encodeURIComponent(fileName))
    .set('Content-Type', 'application/octet-stream')
    .send(content);
}

function finalize(client: SignedInClient, uploadId: string, body: Record<string, unknown>, key?: string) {
  return send(client, `/api/document-uploads/${uploadId}/finalize`, body, key);
}

/** Reads a download as raw bytes whatever its declared type. */
function download(client: SignedInClient, revisionId: string, query = '') {
  return client.agent
    .get(`/api/document-revisions/${revisionId}/download${query}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

async function addDocument(
  ctx: TestContext,
  client: SignedInClient,
  opportunityId: string,
  fileName: string,
  content: Buffer,
  category = 'proposal',
) {
  const staged = await upload(ctx, client, opportunityId, fileName, content);
  expect(staged.status).toBe(201);
  const done = await finalize(client, staged.body.uploadId, { category });
  expect(done.status).toBe(201);
  return done.body as {
    id: string;
    version: number;
    latest: { id: string; scanState: string; downloadable: boolean; fileName: string; scanner: string | null };
    revisions: { id: string; revisionNumber: number }[];
  };
}

const sameNotFound = (a: Response, b: Response) => {
  expect(a.status).toBe(404);
  expect({ ...a.body, requestId: null }).toEqual({ ...b.body, requestId: null });
};

describe('documents', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetFixtures();
    // The fixtures reset clears the database; clear the stored files with it.
    rmSync(ctx.config.documents.storageDir, { recursive: true, force: true });
    setClock(new FixedClock(NOW));
  });

  afterEach(() => {
    resetClock();
  });

  const storagePath = (key: string, area = 'objects') =>
    path.join(path.resolve(ctx.config.documents.storageDir), area, key.slice(0, 2), key);

  async function revision(id: string) {
    const [row] = await ctx.database.db.select().from(documentRevisions).where(eq(documentRevisions.id, id));
    return row!;
  }

  // -------------------------------------------------------------------------
  describe('upload, scan and download (AT-13)', () => {
    it.each([
      ['a PDF', 'Technical_Proposal.pdf', PDF, 'application/pdf'],
      ['a DOCX', 'Requirements.docx', DOCX, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['an XLSX', 'BoQ.xlsx', XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['a PNG', 'Site_photo.png', PNG, 'image/png'],
      ['a JPEG', 'Whiteboard.jpeg', JPEG, 'image/jpeg'],
      ['a UTF-8 text file', 'Notes.txt', TEXT, 'text/plain'],
      ['a CSV', 'Items.csv', CSV, 'text/csv'],
    ])('accepts %s, scans it, then serves the identical bytes', async (_label, fileName, content, mimeType) => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, fileName, content);
      expect(document.latest.fileName).toBe(fileName);
      expect(document.latest.scanState).toBe('clean');
      expect(document.latest.scanner).toBe('test-scanner');
      expect(document.latest.downloadable).toBe(true);

      const response = await download(rafiq, document.latest.id).expect(200);
      expect(Buffer.compare(response.body as Buffer, content)).toBe(0);
      expect(response.headers['content-type']).toContain(mimeType);
      expect(response.headers['content-disposition']).toMatch(/^attachment;/);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['content-security-policy']).toContain('sandbox');
    });

    it('records the document with its metadata, uploader and audit event', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'Workshop_Notes.docx', DOCX, 'meeting_notes');
      const listed = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/documents`).expect(200);
      expect(listed.body.items).toHaveLength(1);
      expect(listed.body.items[0]).toMatchObject({
        id: document.id,
        category: 'meeting_notes',
        revisionCount: 1,
        latest: { fileName: 'Workshop_Notes.docx', byteSize: DOCX.length, uploadedByName: 'Rafiq Hasan' },
      });

      const history = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);
      const uploaded = history.body.items.find((entry: { action: string }) => entry.action === 'document.uploaded');
      expect(uploaded.subject).toBe('Workshop_Notes.docx');
      expect(uploaded.actorName).toBe('Rafiq Hasan');
      const scanned = history.body.items.find((entry: { action: string }) => entry.action === 'document.scanned');
      expect(scanned.actorName).toBe('System');
      expect(scanned.changes).toEqual(
        expect.arrayContaining([{ field: 'scanState', label: 'Scan result', before: 'Pending', after: 'Clean' }]),
      );
      // FR-062: no file content in the audit trail.
      const rows = await ctx.database.db.select().from(auditEvents).where(eq(auditEvents.entityId, document.id));
      expect(JSON.stringify(rows)).not.toContain('Synthetic proposal');
    });

    it('stores the file under a generated key, never the user’s filename, and keeps a hostile name harmless', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const staged = await upload(ctx, rafiq, ids.oppRafiq, '..\\..\\etc/<script>"evil"|?.txt', TEXT);
      expect(staged.status).toBe(201);
      expect(staged.body.fileName).toBe('scriptevil.txt');

      const [row] = await ctx.database.db.select().from(documentUploads).where(eq(documentUploads.id, staged.body.uploadId));
      expect(row!.storageKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(existsSync(storagePath(row!.storageKey))).toBe(true);
    });

    it('keeps a Bangla filename and offers it exactly on download', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'সভার নোট.txt', TEXT);
      expect(document.latest.fileName).toBe('সভার নোট.txt');
      const response = await download(rafiq, document.latest.id).expect(200);
      expect(response.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('সভার নোট.txt')}`);
      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
    });

    it('previews only images inline, under a sandbox, and downloads everything else', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const image = await addDocument(ctx, rafiq, ids.oppRafiq, 'Site.png', PNG);
      const pdf = await addDocument(ctx, rafiq, ids.oppRafiq, 'Spec.pdf', PDF);
      expect((await download(rafiq, image.latest.id, '?disposition=inline')).headers['content-disposition']).toMatch(/^inline;/);
      expect((await download(rafiq, pdf.latest.id, '?disposition=inline')).headers['content-disposition']).toMatch(/^attachment;/);
    });
  });

  // -------------------------------------------------------------------------
  describe('file validation (SEC-010)', () => {
    it.each([
      ['an executable by extension', 'setup.exe', WINDOWS_EXECUTABLE, /Executable and macro-enabled/],
      ['an executable renamed to .pdf', 'Proposal.pdf', WINDOWS_EXECUTABLE, /Executable and macro-enabled/],
      ['an executable disguised with a right-to-left override', 'Invoice\u202Efdp.exe', WINDOWS_EXECUTABLE, /Executable and macro-enabled/],
      ['a double extension ending in .exe', 'Proposal.pdf.exe', PDF, /Executable and macro-enabled/],
      ['a macro-enabled extension', 'Budget.xlsm', XLSX, /Executable and macro-enabled/],
      ['a macro-enabled document renamed to .docx', 'Proposal.docx', DOCX_WITH_MACROS, /Executable and macro-enabled/],
      ['a document declaring macros', 'Proposal.docx', DOCX_DECLARING_MACROS, /Executable and macro-enabled/],
      ['a disallowed type', 'archive.zip', DOCX, /not accepted/],
      ['a file with no extension', 'README', TEXT, /not accepted/],
      ['a PDF that is not a PDF', 'Spec.pdf', TEXT, /not a valid PDF/],
      ['a DOCX that is a spreadsheet', 'Letter.docx', XLSX, /not a valid DOCX/],
      ['a PNG that is a JPEG', 'Photo.png', JPEG, /not a valid PNG/],
      ['text that is not UTF-8', 'Notes.txt', Buffer.from([0x48, 0x69, 0xff, 0xfe, 0x21]), /UTF-8/],
      ['an empty file', 'Empty.txt', Buffer.alloc(0), /empty/],
    ])('refuses %s and keeps nothing', async (_label, fileName, content, message) => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await upload(ctx, rafiq, ids.oppRafiq, fileName, content);
      expect(response.status).toBe(422);
      expect(response.body.fieldErrors.file).toMatch(message);
      expect(await ctx.database.db.select().from(documentUploads)).toHaveLength(0);
      const storage = new LocalDocumentStorage(ctx.config.documents.storageDir);
      expect(await storage.listOlderThan(new Date(Date.now() + 60_000))).toHaveLength(0);
    });

    it('refuses a file over the configured limit while streaming, with 413, and keeps nothing', async () => {
      const small = createTestApp({ maxUploadBytes: 64 * 1024 });
      try {
        const rafiq = await signIn(small.app, emails.salesGA1);
        const big = Buffer.alloc(100 * 1024, 'a');
        const response = await upload(small, rafiq, ids.oppRafiq, 'Big.txt', big);
        expect(response.status).toBe(413);
        expect(response.body.code).toBe('payload_too_large');
        const storage = new LocalDocumentStorage(small.config.documents.storageDir);
        expect(await storage.listOlderThan(new Date(Date.now() + 60_000))).toHaveLength(0);

        // Exactly at the limit is accepted.
        const exact = await upload(small, rafiq, ids.oppRafiq, 'Exact.txt', Buffer.alloc(64 * 1024, 'b'));
        expect(exact.status).toBe(201);
      } finally {
        await small.close();
      }
    });

    it('defaults to a 25 MB limit and publishes the accepted types', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const policy = await rafiq.agent.get('/api/documents/policy').expect(200);
      expect(policy.body).toEqual({
        maxUploadBytes: 25 * 1024 * 1024,
        acceptedExtensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'png', 'jpg', 'jpeg'],
        scanner: 'test',
      });
    });

    it('requires a CSRF token for an upload', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const response = await rafiq.agent
        .post(`/api/opportunities/${ids.oppRafiq}/document-uploads`)
        .set('Origin', TEST_ORIGIN)
        .set(FILE_NAME_HEADER, 'Notes.txt')
        .set('Content-Type', 'application/octet-stream')
        .send(TEXT);
      expect(response.status).toBe(403);
      expect(await ctx.database.db.select().from(documentUploads)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('scanning before availability (SEC-010)', () => {
    it('rejects an infected file: never downloadable, moved to quarantine', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'Scanner_check.txt', EICAR_TEXT);
      expect(document.latest.scanState).toBe('infected');
      expect(document.latest.downloadable).toBe(false);

      const response = await download(rafiq, document.latest.id);
      expect(response.status).toBe(409);
      expect(JSON.parse((response.body as Buffer).toString()).code).toBe('document_unavailable');

      const stored = await revision(document.latest.id);
      expect(stored.scanDetail).toBe('EICAR test signature');
      expect(existsSync(storagePath(stored.storageKey))).toBe(false);
      expect(existsSync(storagePath(stored.storageKey, 'quarantine'))).toBe(true);
    });

    it('marks a file the scanner could not check as failed, and never serves it', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'Notes.txt', SCANNER_FAILURE_TEXT);
      expect(document.latest.scanState).toBe('failed');
      expect((await download(rafiq, document.latest.id)).status).toBe(409);
    });

    it('keeps files pending and unavailable while no scanner is configured, and scans them once one is', async () => {
      const unscanned = createTestApp({ documentScannerKind: 'none' });
      try {
        const rafiq = await signIn(unscanned.app, emails.salesGA1);
        const policy = await rafiq.agent.get('/api/documents/policy').expect(200);
        expect(policy.body.scanner).toBe('none');

        const document = await addDocument(unscanned, rafiq, ids.oppRafiq, 'Proposal.pdf', PDF);
        expect(document.latest.scanState).toBe('pending');
        expect(document.latest.scanner).toBeNull();
        const refused = await download(rafiq, document.latest.id);
        expect(refused.status).toBe(409);
        expect(JSON.parse((refused.body as Buffer).toString()).message).toMatch(/waiting for its malware scan/);

        // The maintenance job does nothing without a scanner…
        const none = createDocumentServices(unscanned.database, unscanned.config);
        expect(await scanPendingRevisions(none, 'test-maintenance')).toBe(0);
        expect((await revision(document.latest.id)).scanState).toBe('pending');

        // …and records a verdict once one is configured.
        const scanning = createDocumentServices(unscanned.database, {
          ...unscanned.config,
          documents: { ...unscanned.config.documents, scanner: 'test' },
        });
        expect(await scanPendingRevisions(scanning, 'test-maintenance')).toBe(1);
        expect((await revision(document.latest.id)).scanState).toBe('clean');
        expect((await download(rafiq, document.latest.id)).status).toBe(200);
      } finally {
        await unscanned.close();
      }
    });

    it('treats a scanner that throws as failed, not clean', async () => {
      const broken: DocumentScanner = {
        name: 'broken-scanner',
        available: true,
        scan: () => Promise.reject(new Error('connection refused')),
      };
      const failing = createTestApp({ documentScanner: broken });
      try {
        const rafiq = await signIn(failing.app, emails.salesGA1);
        const document = await addDocument(failing, rafiq, ids.oppRafiq, 'Proposal.pdf', PDF);
        expect(document.latest.scanState).toBe('failed');
        expect((await revision(document.latest.id)).scanDetail).toBe('The scanner could not check this file.');
        expect((await download(rafiq, document.latest.id)).status).toBe(409);
      } finally {
        await failing.close();
      }
    });

    it('refuses the test scanner in production configuration', async () => {
      const { loadServerConfig } = await import('../env.js');
      const saved = { ...process.env };
      try {
        Object.assign(process.env, {
          NODE_ENV: 'production',
          DOCUMENT_SCANNER: 'test',
          SESSION_SECRET: 'p'.repeat(48),
          CSRF_SECRET: 'q'.repeat(48),
          DATABASE_URL: 'postgres://x@localhost:5432/penta',
        });
        expect(() => loadServerConfig()).toThrow(/must not be used in production/);
        process.env.DOCUMENT_SCANNER = 'none';
        expect(loadServerConfig().documents.scanner).toBe('none');
      } finally {
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('idempotent finalization (BR-091)', () => {
    it('returns the same document for a retried finalize, with one revision and one audit event', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const staged = await upload(ctx, rafiq, ids.oppRafiq, 'Proposal.pdf', PDF);
      const key = nextIdempotencyKey('finalize');
      const first = await finalize(rafiq, staged.body.uploadId, { category: 'proposal' }, key);
      const retry = await finalize(rafiq, staged.body.uploadId, { category: 'proposal' }, key);
      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      expect(retry.body.id).toBe(first.body.id);

      // Even under a new key, one staged upload becomes one revision.
      const newKey = await finalize(rafiq, staged.body.uploadId, { category: 'proposal' });
      expect(newKey.body.id).toBe(first.body.id);

      expect(await ctx.database.db.select().from(documents)).toHaveLength(1);
      expect(await ctx.database.db.select().from(documentRevisions)).toHaveLength(1);
      const uploaded = await ctx.database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'document.uploaded'));
      expect(uploaded).toHaveLength(1);
    });

    it('produces one document when the same upload is finalized twice at once', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const staged = await upload(ctx, rafiq, ids.oppRafiq, 'Proposal.pdf', PDF);
      const responses = await Promise.all([
        finalize(rafiq, staged.body.uploadId, { category: 'proposal' }),
        finalize(rafiq, staged.body.uploadId, { category: 'proposal' }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      expect(responses[0]!.body.id).toBe(responses[1]!.body.id);
      expect(await ctx.database.db.select().from(documentRevisions)).toHaveLength(1);
    });

    it('refuses an expired upload, and cleanup removes it with its file', async () => {
      const clock = new FixedClock(NOW);
      setClock(clock);
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const staged = await upload(ctx, rafiq, ids.oppRafiq, 'Proposal.pdf', PDF);
      const [row] = await ctx.database.db.select().from(documentUploads).where(eq(documentUploads.id, staged.body.uploadId));

      clock.advanceMinutes(61);
      const later = await signIn(ctx.app, emails.salesGA1);
      const late = await finalize(later, staged.body.uploadId, { category: 'proposal' });
      expect(late.status).toBe(409);

      const services = createDocumentServices(ctx.database, ctx.config);
      const result = await cleanupAbandonedUploads(services);
      expect(result.expiredUploads).toBe(1);
      expect(await ctx.database.db.select().from(documentUploads)).toHaveLength(0);
      expect(existsSync(storagePath(row!.storageKey))).toBe(false);
    });

    it('removes stored files that no upload refers to, and keeps finalized ones', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const kept = await addDocument(ctx, rafiq, ids.oppRafiq, 'Kept.pdf', PDF);
      const storage = new LocalDocumentStorage(ctx.config.documents.storageDir);
      const { Readable } = await import('node:stream');
      const orphan = await storage.put(Readable.from([Buffer.from('left behind by a crash')]), 1024);

      const services = createDocumentServices(ctx.database, ctx.config);
      // Files younger than the upload lifetime might belong to a request in flight.
      expect((await cleanupAbandonedUploads(services)).orphanedFiles).toBe(0);
      const later = new Date(Date.now() + 2 * 3_600_000);
      expect(await cleanupAbandonedUploads(services, later)).toEqual({ expiredUploads: 0, orphanedFiles: 1 });
      expect(existsSync(storagePath(orphan.key))).toBe(false);
      expect((await download(rafiq, kept.latest.id)).status).toBe(200);
    });

    it('lets the application role delete staged uploads but never documents or revisions', async () => {
      for (const table of ['documents', 'document_revisions']) {
        const failure = await ctx.database.db
          .execute(sql.raw(`DELETE FROM ${table}`))
          .then(() => null, (error: unknown) => error as { cause?: { code?: string } });
        expect(failure?.cause?.code).toBe('42501');
      }
      await expect(ctx.database.db.execute(sql`DELETE FROM document_uploads WHERE false`)).resolves.toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe('revisions and archiving (FR-061)', () => {
    it('adds a revision without overwriting, and keeps the earlier file downloadable', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const original = await addDocument(ctx, rafiq, ids.oppRafiq, 'Proposal_v1.pdf', PDF);
      const second = Buffer.from('%PDF-1.4\n% Synthetic revision two\n%%EOF\n');
      const staged = await upload(ctx, rafiq, ids.oppRafiq, 'Proposal_v2.pdf', second);
      const revised = await finalize(rafiq, staged.body.uploadId, { documentId: original.id, note: 'Updated pricing schedule' });
      expect(revised.status).toBe(201);
      expect(revised.body.id).toBe(original.id);
      expect(revised.body.revisionCount).toBe(2);
      expect(revised.body.category).toBe('proposal');
      expect(revised.body.revisions.map((item: { revisionNumber: number; fileName: string }) => [item.revisionNumber, item.fileName])).toEqual([
        [2, 'Proposal_v2.pdf'],
        [1, 'Proposal_v1.pdf'],
      ]);

      const first = await download(rafiq, original.latest.id).expect(200);
      expect(Buffer.compare(first.body as Buffer, PDF)).toBe(0);
      const latest = await download(rafiq, revised.body.latest.id).expect(200);
      expect(Buffer.compare(latest.body as Buffer, second)).toBe(0);

      const history = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/history`).expect(200);
      const entry = history.body.items.find((item: { action: string }) => item.action === 'document.revised');
      expect(entry.reason).toBe('Updated pricing schedule');
      expect(entry.changes).toEqual(expect.arrayContaining([{ field: 'revisionNumber', label: 'Revision', before: '1', after: '2' }]));
    });

    it('lets only management archive, with a reason, and keeps the file within scope', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const lead = await signIn(ctx.app, emails.leadGA);
      const management = await signIn(ctx.app, emails.management);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'Old_Notes.txt', TEXT);

      for (const client of [rafiq, lead]) {
        const refused = await send(client, `/api/documents/${document.id}/archive`, { version: document.version, reason: 'Superseded' });
        expect(refused.status).toBe(403);
      }
      const noReason = await send(management, `/api/documents/${document.id}/archive`, { version: document.version, reason: '' });
      expect(noReason.status).toBe(422);
      const archived = await send(management, `/api/documents/${document.id}/archive`, {
        version: document.version,
        reason: 'Uploaded to the wrong opportunity.',
      });
      expect(archived.status).toBe(200);
      expect(archived.body.archiveReason).toBe('Uploaded to the wrong opportunity.');

      expect((await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/documents`)).body.items).toHaveLength(0);
      const withArchived = await rafiq.agent.get(`/api/opportunities/${ids.oppRafiq}/documents?includeArchived=true`);
      expect(withArchived.body.items).toHaveLength(1);
      expect((await download(rafiq, document.latest.id)).status).toBe(200);

      const staged = await upload(ctx, rafiq, ids.oppRafiq, 'New_Notes.txt', TEXT);
      const revision = await finalize(rafiq, staged.body.uploadId, { documentId: document.id });
      expect(revision.status).toBe(409);
    });

    it('changes a category with a version check and audit', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'Letter.pdf', PDF, 'other');
      const changed = await rafiq.agent
        .patch(`/api/documents/${document.id}`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, rafiq.csrfToken)
        .send({ version: document.version, category: 'correspondence' });
      expect(changed.status).toBe(200);
      expect(changed.body.category).toBe('correspondence');
      const stale = await rafiq.agent
        .patch(`/api/documents/${document.id}`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_HEADER, rafiq.csrfToken)
        .send({ version: document.version, category: 'proposal' });
      expect(stale.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('scope on every operation (SEC-011)', () => {
    it('answers forged ids exactly like missing ones: upload, finalize, metadata, revision and download', async () => {
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const theirs = await addDocument(ctx, tasnia, ids.oppTasnia, 'ERP_Tender.pdf', PDF, 'tender_document');
      const theirStaged = await upload(ctx, tasnia, ids.oppTasnia, 'Draft.pdf', PDF);

      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const absent = await rafiq.agent.get(`/api/documents/${ABSENT_UUID}`);
      sameNotFound(await upload(ctx, rafiq, ids.oppTasnia, 'Mine.pdf', PDF), absent);
      sameNotFound(await rafiq.agent.get(`/api/opportunities/${ids.oppTasnia}/documents`), absent);
      sameNotFound(await rafiq.agent.get(`/api/documents/${theirs.id}`), absent);
      sameNotFound(await finalize(rafiq, theirStaged.body.uploadId, { category: 'proposal' }), absent);
      const missingDownload = await download(rafiq, ABSENT_UUID);
      const forgedDownload = await download(rafiq, theirs.latest.id);
      expect(forgedDownload.status).toBe(404);
      const parsed = (response: Response) => ({ ...JSON.parse((response.body as Buffer).toString()), requestId: null });
      expect(parsed(forgedDownload)).toEqual(parsed(missingDownload));

      // A revision of a document on another opportunity, through my own upload.
      const mine = await upload(ctx, rafiq, ids.oppRafiq, 'Mine.pdf', PDF);
      sameNotFound(await finalize(rafiq, mine.body.uploadId, { documentId: theirs.id }), absent);
      expect((await ctx.database.db.select().from(documentRevisions).where(eq(documentRevisions.documentId, theirs.id)))).toHaveLength(1);
    });

    it('gives the administrator nothing: 403 on the policy, 404 on files', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'Proposal.pdf', PDF);
      const admin = await signIn(ctx.app, emails.admin);
      expect((await admin.agent.get('/api/documents/policy')).status).toBe(403);
      expect((await admin.agent.get(`/api/documents/${document.id}`)).status).toBe(404);
      expect((await download(admin, document.latest.id)).status).toBe(404);
      expect((await upload(ctx, admin, ids.oppRafiq, 'Admin.pdf', PDF)).status).toBe(404);
    });

    it('revokes an old download link after a transfer, and grants it to the new owner (AT-13, BR-050)', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const tasnia = await signIn(ctx.app, emails.salesGA2);
      const lead = await signIn(ctx.app, emails.leadGA);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'Workshop.pdf', PDF);
      const staged = await upload(ctx, rafiq, ids.oppRafiq, 'Later.pdf', PDF);
      expect((await download(rafiq, document.latest.id)).status).toBe(200);
      expect((await download(tasnia, document.latest.id)).status).toBe(404);

      const [{ version }] = await ctx.database.db
        .select({ version: opportunities.version })
        .from(opportunities)
        .where(eq(opportunities.id, ids.oppRafiq)) as [{ version: number }];
      const moved = await send(lead, `/api/opportunities/${ids.oppRafiq}/transfer`, {
        version,
        newOwnerId: ids.salesGA2,
        reason: 'Account handover',
      });
      expect(moved.status).toBe(200);

      expect((await download(rafiq, document.latest.id)).status).toBe(404);
      expect((await rafiq.agent.get(`/api/documents/${document.id}`)).status).toBe(404);
      // An upload staged before the transfer can no longer be finalized by its stager.
      expect((await finalize(rafiq, staged.body.uploadId, { category: 'proposal' })).status).toBe(404);
      expect(await ctx.database.db.select().from(documents)).toHaveLength(1);

      const handedOver = await download(tasnia, document.latest.id);
      expect(handedOver.status).toBe(200);
      expect(Buffer.compare(handedOver.body as Buffer, PDF)).toBe(0);
    });

    it('lets a section lead and management read and add files across their scope, but not another section', async () => {
      const rafiq = await signIn(ctx.app, emails.salesGA1);
      const document = await addDocument(ctx, rafiq, ids.oppRafiq, 'Proposal.pdf', PDF);
      const lead = await signIn(ctx.app, emails.leadGA);
      const otherLead = await signIn(ctx.app, emails.leadIS);
      const management = await signIn(ctx.app, emails.management);
      expect((await download(lead, document.latest.id)).status).toBe(200);
      expect((await download(management, document.latest.id)).status).toBe(200);
      expect((await download(otherLead, document.latest.id)).status).toBe(404);
      expect((await upload(ctx, lead, ids.oppRafiq, 'Lead.pdf', PDF)).status).toBe(201);
      expect((await upload(ctx, otherLead, ids.oppRafiq, 'Other.pdf', PDF)).status).toBe(404);
    });
  });
});
