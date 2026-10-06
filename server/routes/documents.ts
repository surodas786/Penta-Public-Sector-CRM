/**
 * Document endpoints (FR-060, FR-061, SEC-010, SEC-011).
 *
 * The upload body is the raw file, streamed straight to private storage; the
 * JSON parser never sees it. Downloads stream through an authorized endpoint
 * with safe headers — there is no public or permanent file URL.
 */
import { PassThrough } from 'node:stream';

import { Router, type Request, type RequestHandler } from 'express';

import { FILE_NAME_HEADER, type DocumentPolicyDto } from '../../shared/api.js';
import {
  archiveSchema,
  finalizeUploadSchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
  uuidField,
} from '../../shared/validation.js';
import { requireAuth, requireSalesAccess } from '../auth/sessionGuard.js';
import { ACCEPTED_EXTENSIONS } from '../documents/fileTypes.js';
import { notFound, unauthenticated, validationFailed } from '../http/errors.js';
import { requireIdempotencyKey } from '../http/idempotencyKey.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import {
  archiveDocument,
  finalizeUpload,
  getDocument,
  listOpportunityDocuments,
  openRevisionForDownload,
  stageUpload,
  updateDocumentCategory,
  type DocumentServices,
} from '../services/documents.js';
import { runIdempotent } from '../services/idempotency.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function readId(value: unknown): string {
  const result = uuidField.safeParse(value);
  if (!result.success) throw notFound('malformed id parameter');
  return result.data;
}

const actorOf = (req: Request) => {
  if (!req.actor) throw unauthenticated();
  return req.actor;
};

/**
 * Reads and discards whatever is left of a refused upload so the response can
 * be delivered on the same connection. A client that keeps sending far past
 * the limit is disconnected instead.
 */
function discardBody(req: Request, limit: number): Promise<void> {
  if (req.readableEnded || req.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) {
        req.destroy();
        resolve();
      }
    });
    req.on('end', () => resolve());
    req.on('close', () => resolve());
    req.on('error', () => resolve());
    req.resume();
  });
}

function readFileName(req: Request): string {
  const raw = req.get(FILE_NAME_HEADER);
  if (!raw) throw validationFailed({ file: 'Choose a file to upload.' });
  try {
    return decodeURIComponent(raw);
  } catch {
    throw validationFailed({ file: 'The file name could not be read.' });
  }
}

/** RFC 6266 / 5987: an ASCII fallback plus the exact UTF-8 name (Bangla names survive). */
function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Mounted at /api/opportunities, beside the opportunity router. */
export function createOpportunityDocumentsRouter(options: {
  services: DocumentServices;
  csrfGuard: RequestHandler;
}): Router {
  const { services, csrfGuard } = options;
  const { db } = services;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/:id/documents',
    handle(async (req, res) => {
      const query = parseOrThrow(listDocumentsQuerySchema, singleValueQuery(req.query));
      res.json({
        items: await listOpportunityDocuments(db, actorOf(req), readId(req.params.id), query.includeArchived === 'true'),
      });
    }),
  );

  // Step 1: the raw bytes. Not idempotent by key: a staged upload is invisible,
  // and a retry simply stages another one that expires if never finalized.
  router.post(
    '/:id/document-uploads',
    csrfGuard,
    handle(async (req, res) => {
      const body = new PassThrough();
      req.pipe(body);
      try {
        const lengthHeader = req.get('content-length');
        const staged = await stageUpload({
          services,
          actor: actorOf(req),
          opportunityId: readId(req.params.id),
          rawFileName: readFileName(req),
          declaredLength: lengthHeader ? Number(lengthHeader) : null,
          body,
        });
        res.status(201).json(staged);
      } catch (error) {
        req.unpipe(body);
        body.destroy();
        await discardBody(req, services.maxUploadBytes * 2);
        throw error;
      }
    }),
  );

  return router;
}

/** Mounted at /api/document-uploads. */
export function createDocumentUploadsRouter(options: { services: DocumentServices; csrfGuard: RequestHandler }): Router {
  const { services, csrfGuard } = options;
  const router = Router();
  router.use(requireAuth);

  // Step 2: idempotent by key, and by the upload itself (one revision per upload).
  router.post(
    '/:id/finalize',
    csrfGuard,
    handle(async (req, res) => {
      const actor = actorOf(req);
      const uploadId = readId(req.params.id);
      const command = parseOrThrow(finalizeUploadSchema, req.body);
      const key = requireIdempotencyKey(req);
      const { result, replayed } = await runIdempotent({
        db: services.db,
        actorId: actor.id,
        operation: 'document.finalize',
        key,
        payload: { uploadId, body: req.body },
        execute: (completeClaim) =>
          finalizeUpload({ services, actor, uploadId, command, requestId: req.requestId, completeClaim }),
        replay: (entityId) => getDocument(services.db, actor, entityId),
      });
      res.status(replayed ? 200 : 201).json(result);
    }),
  );

  return router;
}

/** Mounted at /api/documents. */
export function createDocumentsRouter(options: {
  services: DocumentServices;
  csrfGuard: RequestHandler;
  scanner: DocumentPolicyDto['scanner'];
}): Router {
  const { services, csrfGuard, scanner } = options;
  const { db } = services;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/policy',
    requireSalesAccess,
    handle(async (_req, res) => {
      const policy: DocumentPolicyDto = {
        maxUploadBytes: services.maxUploadBytes,
        acceptedExtensions: ACCEPTED_EXTENSIONS,
        scanner,
      };
      res.json(policy);
    }),
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      res.json(await getDocument(db, actorOf(req), readId(req.params.id)));
    }),
  );

  router.patch(
    '/:id',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(updateDocumentSchema, req.body);
      res.json(
        await updateDocumentCategory({ db, actor: actorOf(req), documentId: readId(req.params.id), command, requestId: req.requestId }),
      );
    }),
  );

  router.post(
    '/:id/archive',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(archiveSchema, req.body);
      res.json(await archiveDocument({ db, actor: actorOf(req), documentId: readId(req.params.id), command, requestId: req.requestId }));
    }),
  );

  return router;
}

/** Mounted at /api/document-revisions. */
export function createDocumentRevisionsRouter(options: { services: DocumentServices }): Router {
  const { services } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/:id/download',
    handle(async (req, res, next) => {
      const revision = await openRevisionForDownload(services.db, actorOf(req), readId(req.params.id));
      const inline = req.query.disposition === 'inline' && revision.previewable;
      const contentType = revision.mimeType.startsWith('text/') ? `${revision.mimeType}; charset=utf-8` : revision.mimeType;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(revision.byteSize));
      res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', revision.fileName));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      // Nothing in a served file may run script or load anything else.
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

      const stream = services.storage.open(revision.storageKey);
      stream.on('error', (error) => {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        for (const header of ['Content-Disposition', 'Content-Length', 'Content-Type']) res.removeHeader(header);
        next(error);
      });
      stream.pipe(res);
    }),
  );

  return router;
}
