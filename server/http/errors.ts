/**
 * The SEC-020 error model.
 *
 * Every failure leaves the server as `{code, message, fieldErrors?, requestId}`
 * with no stack trace and no private value. Critically, a missing object and an
 * inaccessible object produce an identical body apart from the request ID, so a
 * caller cannot use error shape to probe for records they cannot see (SEC-003).
 */
import type { NextFunction, Request, Response } from 'express';

import type { ApiErrorBody, ApiErrorCode } from '../../shared/api.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fieldErrors?: Record<string, string>;
  /** Logged server-side only. Never serialised to the client. */
  readonly internalDetail?: string;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: { fieldErrors?: Record<string, string>; internalDetail?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options.internalDetail) this.internalDetail = options.internalDetail;
  }
}

/**
 * The single wording used for both "does not exist" and "exists but is outside
 * your scope". Do not add a variant: the equality of these two responses is an
 * access-control guarantee, verified by an integration test.
 */
export const NOT_FOUND_MESSAGE =
  'The requested record does not exist or is not available to your account.';

export const unauthenticated = (message = 'Sign in to continue.') =>
  new ApiError(401, 'unauthenticated', message);

export const forbidden = (message = 'Your account is not permitted to perform this action.') =>
  new ApiError(403, 'forbidden', message);

export const notFound = (internalDetail?: string) =>
  new ApiError(404, 'not_found', NOT_FOUND_MESSAGE, internalDetail ? { internalDetail } : {});

export const conflict = (message: string, code: ApiErrorCode = 'conflict') =>
  new ApiError(409, code, message);

export const versionConflict = () =>
  new ApiError(
    409,
    'version_conflict',
    'This record changed after you opened it. Reload to see the current values, then reapply your edit.',
  );

export const validationFailed = (
  fieldErrors: Record<string, string>,
  message = 'Some fields need attention.',
) => new ApiError(422, 'validation_failed', message, { fieldErrors });

/** Express error handler. Must be registered last. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';

  if (error instanceof ApiError) {
    const body: ApiErrorBody = {
      code: error.code,
      message: error.message,
      requestId,
    };
    if (error.fieldErrors) body.fieldErrors = error.fieldErrors;

    if (error.internalDetail) {
      // Server log only — the detail explains *why* a 404 was produced and
      // must never reach the client.
      console.warn(`[${requestId}] ${error.code}: ${error.internalDetail}`);
    }
    res.status(error.status).json(body);
    return;
  }

  // Anything unexpected: log server-side, return an opaque body.
  console.error(`[${requestId}] Unhandled error:`, error);
  const body: ApiErrorBody = {
    code: 'internal_error',
    message: 'Something went wrong. Try again, and contact support if it continues.',
    requestId,
  };
  res.status(500).json(body);
}

/** 404 for unmatched API routes, using the same body as an inaccessible record. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    code: 'not_found',
    message: NOT_FOUND_MESSAGE,
    requestId: req.requestId ?? 'unknown',
  };
  res.status(404).json(body);
}
