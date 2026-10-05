/**
 * Opportunity documents (FR-060, FR-061, SEC-010, SEC-011).
 *
 * An upload is two steps. The bytes are streamed to private storage under a
 * generated key, validated, and recorded as a staged upload that nobody can
 * see. Finalizing turns the staged upload into a document, or a new revision
 * of one, in a single transaction with its audit event. Finalizing is
 * idempotent twice over: by the Idempotency-Key, and because a staged upload
 * becomes at most one revision (unique index), so a retry returns the same
 * document instead of a duplicate. Abandoned staged uploads expire and are
 * removed with their files.
 *
 * A file is downloadable only after a clean scan verdict. Every upload,
 * finalize, metadata read and download locates the parent opportunity through
 * `opportunityScope`, so a transfer revokes access to the files with the
 * record, and an old download link stops working on the next request.
 */
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Readable } from 'node:stream';
import type { z } from 'zod';

import type { DocumentDetailDto, DocumentDto, DocumentRevisionDto, StagedUploadDto } from '../../shared/api.js';
import { DOCUMENT_CATEGORY_LABELS } from '../../shared/enums.js';
import type { archiveSchema, finalizeUploadSchema, updateDocumentSchema } from '../../shared/validation.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { documentRevisions, documents, documentUploads, opportunities, users } from '../db/schema.js';
import {
  acceptedTypeForMime,
  acceptedTypeForName,
  FileRejectedError,
  sanitizeFileName,
  validateContent,
} from '../documents/fileTypes.js';
import type { DocumentScanner } from '../documents/scanner.js';
import { UploadTooLargeError, type DocumentStorage } from '../documents/storage.js';
import { ApiError, conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canArchiveDocument, canUploadDocuments, opportunityScope, scopedWhere } from '../policy/scope.js';
import { recordAuditEvent } from './audit.js';
import { lockOpportunity } from './followUps.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { assertOpportunityVisible } from './opportunities.js';

export interface DocumentServices {
  db: Database;
  storage: DocumentStorage;
  scanner: DocumentScanner;
  maxUploadBytes: number;
  uploadTtlMinutes: number;
}

const tooLarge = (maxBytes: number) =>
  new ApiError(
    413,
    'payload_too_large',
    `The file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
  );

const documentUnavailable = (message: string) => new ApiError(409, 'document_unavailable', message);

const uploader = alias(users, 'revision_uploader');
const archiver = alias(users, 'document_archiver');

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const revisionSelection = {
  id: documentRevisions.id,
  documentId: documentRevisions.documentId,
  revisionNumber: documentRevisions.revisionNumber,
  fileName: documentRevisions.fileName,
  mimeType: documentRevisions.mimeType,
  byteSize: documentRevisions.byteSize,
  sha256: documentRevisions.sha256,
  note: documentRevisions.note,
  scanState: documentRevisions.scanState,
  scanner: documentRevisions.scanner,
  scannedAt: documentRevisions.scannedAt,
  uploadedByName: uploader.fullName,
  uploadedAt: documentRevisions.uploadedAt,
} as const;

type RevisionRow = Pick<
  typeof documentRevisions.$inferSelect,
  | 'id'
  | 'revisionNumber'
  | 'fileName'
  | 'mimeType'
  | 'byteSize'
  | 'sha256'
  | 'note'
  | 'scanState'
  | 'scanner'
  | 'scannedAt'
  | 'uploadedAt'
> & { uploadedByName: string };

function toRevisionDto(row: RevisionRow): DocumentRevisionDto {
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    note: row.note,
    scanState: row.scanState,
    scanner: row.scanner,
    scannedAt: row.scannedAt?.toISOString() ?? null,
    uploadedByName: row.uploadedByName,
    uploadedAt: row.uploadedAt.toISOString(),
    downloadable: row.scanState === 'clean',
    previewable: row.scanState === 'clean' && (acceptedTypeForMime(row.mimeType)?.previewable ?? false),
  };
}

const documentSelection = {
  id: documents.id,
  opportunityId: documents.opportunityId,
  category: documents.category,
  latestRevision: documents.latestRevision,
  createdAt: documents.createdAt,
  archivedAt: documents.archivedAt,
  archivedByName: archiver.fullName,
  archiveReason: documents.archiveReason,
  version: documents.version,
} as const;

function documentQuery(db: Database) {
  return db
    .select({ ...documentSelection, ...revisionSelection, revisionId: documentRevisions.id, id: documents.id })
    .from(documents)
    .innerJoin(opportunities, eq(opportunities.id, documents.opportunityId))
    .innerJoin(
      documentRevisions,
      and(
        eq(documentRevisions.documentId, documents.id),
        eq(documentRevisions.revisionNumber, documents.latestRevision),
      ),
    )
    .innerJoin(uploader, eq(uploader.id, documentRevisions.uploadedBy))
    .leftJoin(archiver, eq(archiver.id, documents.archivedBy));
}

type DocumentRow = Awaited<ReturnType<ReturnType<typeof documentQuery>['execute']>>[number];

function toDocumentDto(actor: Actor, row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    category: row.category,
    latest: toRevisionDto({ ...row, id: row.revisionId }),
    revisionCount: row.latestRevision,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedByName: row.archivedByName ?? null,
    archiveReason: row.archiveReason,
    version: row.version,
    canArchive: canArchiveDocument(actor) && row.archivedAt === null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** FR-060: the opportunity's documents, newest revision first. Archived ones on request. */
export async function listOpportunityDocuments(
  db: Database,
  actor: Actor,
  opportunityId: string,
  includeArchived: boolean,
): Promise<DocumentDto[]> {
  await assertOpportunityVisible(db, actor, opportunityId);
  const rows = await documentQuery(db)
    .where(
      scopedWhere(
        actor,
        eq(documents.opportunityId, opportunityId),
        includeArchived ? undefined : isNull(documents.archivedAt),
      ),
    )
    .orderBy(desc(documentRevisions.uploadedAt), desc(documents.id));
  return rows.map((row) => toDocumentDto(actor, row));
}

export async function getDocument(db: Database, actor: Actor, documentId: string): Promise<DocumentDetailDto> {
  const [row] = await documentQuery(db).where(scopedWhere(actor, eq(documents.id, documentId))).limit(1);
  if (!row) throw notFound(`document ${documentId} absent or outside scope for actor ${actor.id}`);
  const revisions = await db
    .select(revisionSelection)
    .from(documentRevisions)
    .innerJoin(uploader, eq(uploader.id, documentRevisions.uploadedBy))
    .where(eq(documentRevisions.documentId, documentId))
    .orderBy(desc(documentRevisions.revisionNumber));
  return { ...toDocumentDto(actor, row), revisions: revisions.map(toRevisionDto) };
}

export interface DownloadableRevision {
  fileName: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  previewable: boolean;
}

/**
 * SEC-011: every download re-checks scope through the parent opportunity, then
 * the scan verdict (SEC-010). Archived documents stay downloadable within the
 * same scope (FR-061).
 */
export async function openRevisionForDownload(
  db: Database,
  actor: Actor,
  revisionId: string,
): Promise<DownloadableRevision> {
  const [row] = await db
    .select({
      fileName: documentRevisions.fileName,
      mimeType: documentRevisions.mimeType,
      byteSize: documentRevisions.byteSize,
      storageKey: documentRevisions.storageKey,
      scanState: documentRevisions.scanState,
    })
    .from(documentRevisions)
    .innerJoin(documents, eq(documents.id, documentRevisions.documentId))
    .innerJoin(opportunities, eq(opportunities.id, documents.opportunityId))
    .where(scopedWhere(actor, eq(documentRevisions.id, revisionId)))
    .limit(1);
  if (!row) throw notFound(`document revision ${revisionId} absent or outside scope for actor ${actor.id}`);

  switch (row.scanState) {
    case 'clean':
      break;
    case 'pending':
      throw documentUnavailable('This file is waiting for its malware scan and cannot be downloaded yet.');
    case 'failed':
      throw documentUnavailable(
        'The malware scan could not check this file, so it cannot be downloaded. Upload it again as a new revision.',
      );
    case 'infected':
      throw documentUnavailable('This file was rejected by the malware scan and cannot be downloaded.');
  }
  return {
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    storageKey: row.storageKey,
    previewable: acceptedTypeForMime(row.mimeType)?.previewable ?? false,
  };
}

// ---------------------------------------------------------------------------
// Upload, step 1: stage the bytes
// ---------------------------------------------------------------------------

/**
 * Streams the body into private storage, enforcing the size limit while
 * writing, then checks the content against the extension. Nothing becomes
 * visible here. A rejected file is removed before the response.
 */
export async function stageUpload(options: {
  services: DocumentServices;
  actor: Actor;
  opportunityId: string;
  rawFileName: string;
  declaredLength: number | null;
  body: Readable;
}): Promise<StagedUploadDto> {
  const { services, actor, opportunityId, rawFileName, declaredLength, body } = options;
  const { db, storage, maxUploadBytes } = services;

  await assertOpportunityVisible(db, actor, opportunityId);
  if (!canUploadDocuments(actor)) throw forbidden();

  const fileName = sanitizeFileName(rawFileName);
  let type;
  try {
    type = acceptedTypeForName(fileName);
  } catch (error) {
    if (error instanceof FileRejectedError) throw validationFailed({ file: error.message }, error.message);
    throw error;
  }
  if (declaredLength !== null && declaredLength > maxUploadBytes) throw tooLarge(maxUploadBytes);

  let stored;
  try {
    stored = await storage.put(body, maxUploadBytes);
  } catch (error) {
    if (error instanceof UploadTooLargeError) throw tooLarge(maxUploadBytes);
    throw error;
  }

  try {
    validateContent(await storage.read(stored.key), type);
  } catch (error) {
    await storage.remove(stored.key);
    if (error instanceof FileRejectedError) throw validationFailed({ file: error.message }, error.message);
    throw error;
  }

  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + services.uploadTtlMinutes * 60_000);
  try {
    const [row] = await db
      .insert(documentUploads)
      .values({
        opportunityId,
        createdBy: actor.id,
        fileName,
        mimeType: type.mimeType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        storageKey: stored.key,
        createdAt,
        expiresAt,
      })
      .returning({ id: documentUploads.id });
    if (!row) throw new Error('Upload insert returned no row.');
    return {
      uploadId: row.id,
      fileName,
      mimeType: type.mimeType,
      byteSize: stored.byteSize,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    await storage.remove(stored.key);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Upload, step 2: finalize into a document or a revision
// ---------------------------------------------------------------------------

export async function finalizeUpload(options: {
  services: DocumentServices;
  actor: Actor;
  uploadId: string;
  command: z.output<typeof finalizeUploadSchema>;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<DocumentDetailDto> {
  const { services, actor, uploadId, command, requestId, completeClaim } = options;
  const { db } = services;

  const outcome = await db.transaction(async (tx) => {
    // Only the person who staged an upload may finalize it; anyone else's id is a 404.
    const [located] = await tx
      .select({ opportunityId: documentUploads.opportunityId })
      .from(documentUploads)
      .where(and(eq(documentUploads.id, uploadId), eq(documentUploads.createdBy, actor.id)))
      .limit(1);
    if (!located) throw notFound(`upload ${uploadId} absent or not staged by actor ${actor.id}`);

    // Scope is checked again here: access may have been revoked since staging.
    const opportunity = await lockOpportunity(tx, actor, located.opportunityId);
    if (!canUploadDocuments(actor)) throw forbidden();

    const [upload] = await tx
      .select()
      .from(documentUploads)
      .where(eq(documentUploads.id, uploadId))
      .for('update')
      .limit(1);
    if (!upload) throw notFound(`upload ${uploadId} removed during the request`);

    if (upload.finalizedAt) {
      // A retry after a lost response: the same document, never a second one.
      const [existing] = await tx
        .select({ documentId: documentRevisions.documentId, revisionId: documentRevisions.id })
        .from(documentRevisions)
        .where(eq(documentRevisions.uploadId, uploadId))
        .limit(1);
      if (!existing) throw new Error('Finalized upload has no revision.');
      await completeClaim(tx, existing.documentId);
      return { documentId: existing.documentId, revisionId: existing.revisionId, created: false };
    }
    if (upload.expiresAt < now()) {
      throw conflict('This upload has expired. Choose the file again.');
    }

    const timestamp = now();
    let documentId: string;
    let revisionNumber: number;

    if (command.documentId) {
      // FR-061: a revision of a document on the same opportunity. A document id
      // from anywhere else is the same 404 as one that does not exist.
      const [current] = await tx
        .select({
          id: documents.id,
          latestRevision: documents.latestRevision,
          archivedAt: documents.archivedAt,
          category: documents.category,
        })
        .from(documents)
        .where(and(eq(documents.id, command.documentId), eq(documents.opportunityId, opportunity.id)))
        .for('update')
        .limit(1);
      if (!current) throw notFound(`document ${command.documentId} not on opportunity ${opportunity.id}`);
      if (current.archivedAt) throw conflict('This document is archived. Archived documents take no new revisions.');

      const [previous] = await tx
        .select({ fileName: documentRevisions.fileName })
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.documentId, current.id),
            eq(documentRevisions.revisionNumber, current.latestRevision),
          ),
        )
        .limit(1);

      documentId = current.id;
      revisionNumber = current.latestRevision + 1;
      await tx
        .update(documents)
        .set({ latestRevision: revisionNumber, updatedAt: timestamp, version: sql`${documents.version} + 1` })
        .where(eq(documents.id, current.id));
      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId: opportunity.id,
        entityType: 'document',
        entityId: current.id,
        action: 'document.revised',
        before: { about: previous?.fileName ?? null, fileName: previous?.fileName ?? null, revisionNumber: current.latestRevision },
        after: { about: upload.fileName, fileName: upload.fileName, revisionNumber, byteSize: upload.byteSize },
        reason: command.note ?? null,
        requestId,
      });
    } else {
      const category = command.category;
      if (!category) throw validationFailed({ category: 'Choose a category.' });
      const [created] = await tx
        .insert(documents)
        .values({
          opportunityId: opportunity.id,
          category,
          latestRevision: 1,
          createdBy: actor.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning({ id: documents.id });
      if (!created) throw new Error('Document insert returned no row.');
      documentId = created.id;
      revisionNumber = 1;
      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId: opportunity.id,
        entityType: 'document',
        entityId: created.id,
        action: 'document.uploaded',
        after: {
          about: upload.fileName,
          fileName: upload.fileName,
          category,
          revisionNumber: 1,
          byteSize: upload.byteSize,
        },
        requestId,
      });
    }

    const [revision] = await tx
      .insert(documentRevisions)
      .values({
        documentId,
        revisionNumber,
        uploadId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        byteSize: upload.byteSize,
        sha256: upload.sha256,
        storageKey: upload.storageKey,
        note: command.note ?? null,
        scanState: 'pending',
        uploadedBy: actor.id,
        uploadedAt: timestamp,
      })
      .returning({ id: documentRevisions.id });
    if (!revision) throw new Error('Revision insert returned no row.');

    await tx.update(documentUploads).set({ finalizedAt: timestamp }).where(eq(documentUploads.id, uploadId));
    await completeClaim(tx, documentId);
    return { documentId, revisionId: revision.id, created: true };
  });

  // The scan runs after commit, so a slow scanner never holds the
  // opportunity lock. Until it records a clean verdict the file stays unavailable.
  if (outcome.created) await scanRevision(services, outcome.revisionId, requestId);
  return getDocument(db, actor, outcome.documentId);
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Records one scan verdict for a pending revision. With no scanner configured
 * it does nothing, and the file stays pending — unavailable, never assumed
 * clean. A scanner error marks the file `failed`; an infected file is moved
 * out of the serving area.
 */
export async function scanRevision(services: DocumentServices, revisionId: string, requestId: string): Promise<void> {
  const { db, storage, scanner } = services;
  if (!scanner.available) return;

  const [revision] = await db
    .select({
      id: documentRevisions.id,
      documentId: documentRevisions.documentId,
      fileName: documentRevisions.fileName,
      storageKey: documentRevisions.storageKey,
      opportunityId: documents.opportunityId,
    })
    .from(documentRevisions)
    .innerJoin(documents, eq(documents.id, documentRevisions.documentId))
    .where(and(eq(documentRevisions.id, revisionId), eq(documentRevisions.scanState, 'pending')))
    .limit(1);
  if (!revision) return;

  let scanState: 'clean' | 'infected' | 'failed';
  let scanDetail: string | null = null;
  try {
    const result = await scanner.scan(await storage.read(revision.storageKey));
    scanState = result.verdict;
    if (result.verdict === 'infected') scanDetail = result.detail;
  } catch {
    scanState = 'failed';
    scanDetail = 'The scanner could not check this file.';
  }

  const recorded = await db.transaction(async (tx) => {
    const updated = await tx
      .update(documentRevisions)
      .set({ scanState, scanner: scanner.name, scanDetail, scannedAt: now() })
      .where(and(eq(documentRevisions.id, revision.id), eq(documentRevisions.scanState, 'pending')))
      .returning({ id: documentRevisions.id });
    if (updated.length === 0) return false;
    await recordAuditEvent(tx, {
      actorId: null,
      opportunityId: revision.opportunityId,
      entityType: 'document',
      entityId: revision.documentId,
      action: 'document.scanned',
      before: { about: revision.fileName, scanState: 'pending' },
      after: { about: revision.fileName, scanState, scanner: scanner.name },
      requestId,
    });
    return true;
  });

  if (recorded && scanState === 'infected') {
    await storage.quarantine(revision.storageKey).catch(() => {
      console.error(`[${requestId}] Could not move an infected upload to quarantine (revision ${revision.id}).`);
    });
  }
}

/** Retries revisions still pending, e.g. after a scanner outage. Returns how many were tried. */
export async function scanPendingRevisions(services: DocumentServices, requestId: string, limit = 100): Promise<number> {
  if (!services.scanner.available) return 0;
  const pending = await services.db
    .select({ id: documentRevisions.id })
    .from(documentRevisions)
    .where(eq(documentRevisions.scanState, 'pending'))
    .orderBy(documentRevisions.uploadedAt)
    .limit(limit);
  for (const revision of pending) await scanRevision(services, revision.id, requestId);
  return pending.length;
}

// ---------------------------------------------------------------------------
// Metadata and archiving
// ---------------------------------------------------------------------------

async function lockDocument(tx: Database, actor: Actor, documentId: string) {
  const [located] = await tx
    .select({ opportunityId: documents.opportunityId })
    .from(documents)
    .innerJoin(opportunities, eq(opportunities.id, documents.opportunityId))
    .where(and(opportunityScope(actor), eq(documents.id, documentId)))
    .limit(1);
  if (!located) throw notFound(`document ${documentId} absent or outside scope for actor ${actor.id}`);
  const opportunity = await lockOpportunity(tx, actor, located.opportunityId);
  const [document] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.opportunityId, opportunity.id)))
    .for('update')
    .limit(1);
  if (!document) throw notFound(`document ${documentId} moved during the request`);
  return { opportunity, document };
}

export async function updateDocumentCategory(options: {
  db: Database;
  actor: Actor;
  documentId: string;
  command: z.output<typeof updateDocumentSchema>;
  requestId: string;
}): Promise<DocumentDetailDto> {
  const { db, actor, documentId, command, requestId } = options;
  await db.transaction(async (tx) => {
    const { opportunity, document } = await lockDocument(tx, actor, documentId);
    if (!canUploadDocuments(actor)) throw forbidden();
    if (document.version !== command.version) throw versionConflict();
    if (document.archivedAt) throw conflict('This document is archived and cannot change.');
    if (document.category === command.category) return;

    const updated = await tx
      .update(documents)
      .set({ category: command.category, updatedAt: now(), version: sql`${documents.version} + 1` })
      .where(and(eq(documents.id, documentId), eq(documents.version, command.version)))
      .returning({ id: documents.id });
    if (updated.length === 0) throw versionConflict();
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'document',
      entityId: documentId,
      action: 'document.updated',
      before: { category: document.category },
      after: { category: command.category },
      requestId,
    });
  });
  return getDocument(db, actor, documentId);
}

/**
 * FR-061: management soft-archives with a reason. The files and every
 * revision are kept and stay readable within the same scope; there is no
 * purge through the application.
 */
export async function archiveDocument(options: {
  db: Database;
  actor: Actor;
  documentId: string;
  command: z.output<typeof archiveSchema>;
  requestId: string;
}): Promise<DocumentDetailDto> {
  const { db, actor, documentId, command, requestId } = options;
  await db.transaction(async (tx) => {
    const { opportunity, document } = await lockDocument(tx, actor, documentId);
    if (!canArchiveDocument(actor)) throw forbidden('Only management can archive a document.');
    if (document.version !== command.version) throw versionConflict();
    if (document.archivedAt) throw conflict('This document is already archived.');

    const timestamp = now();
    const updated = await tx
      .update(documents)
      .set({
        archivedAt: timestamp,
        archivedBy: actor.id,
        archiveReason: command.reason,
        updatedAt: timestamp,
        version: sql`${documents.version} + 1`,
      })
      .where(and(eq(documents.id, documentId), eq(documents.version, command.version)))
      .returning({ id: documents.id });
    if (updated.length === 0) throw versionConflict();
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: opportunity.id,
      entityType: 'document',
      entityId: documentId,
      action: 'document.archived',
      before: { about: DOCUMENT_CATEGORY_LABELS[document.category] },
      after: { about: DOCUMENT_CATEGORY_LABELS[document.category] },
      reason: command.reason,
      requestId,
    });
  });
  return getDocument(db, actor, documentId);
}

// ---------------------------------------------------------------------------
// Abandoned uploads
// ---------------------------------------------------------------------------

export interface CleanupResult {
  expiredUploads: number;
  orphanedFiles: number;
}

/**
 * Removes staged uploads never finalized before they expired, with their
 * files, and any stored file no upload record refers to (a crash between
 * writing the bytes and recording them). Finalized uploads are kept: their
 * revisions point at them.
 */
export async function cleanupAbandonedUploads(services: DocumentServices, at: Date = now()): Promise<CleanupResult> {
  const { db, storage } = services;

  const expired = await db
    .delete(documentUploads)
    .where(and(isNull(documentUploads.finalizedAt), lt(documentUploads.expiresAt, at)))
    .returning({ storageKey: documentUploads.storageKey });
  for (const upload of expired) await storage.remove(upload.storageKey);

  // A file younger than the upload lifetime may belong to a request still in flight.
  const candidates = await storage.listOlderThan(new Date(at.getTime() - services.uploadTtlMinutes * 60_000));
  let orphanedFiles = 0;
  for (let start = 0; start < candidates.length; start += 500) {
    const batch = candidates.slice(start, start + 500);
    const known = await db
      .select({ storageKey: documentUploads.storageKey })
      .from(documentUploads)
      .where(inArray(documentUploads.storageKey, batch));
    const referenced = new Set(known.map((row) => row.storageKey));
    for (const key of batch) {
      if (referenced.has(key)) continue;
      await storage.remove(key);
      orphanedFiles += 1;
    }
  }

  return { expiredUploads: expired.length, orphanedFiles };
}
