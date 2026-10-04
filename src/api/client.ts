/**
 * Browser HTTP client for the Penta CRM API.
 *
 * Responsibilities kept in one place (plan 4.2):
 *  - send the session cookie and the double-submit CSRF token,
 *  - surface 422 field errors and 409 conflicts as typed errors the forms can
 *    render, rather than as generic failures,
 *  - report 401 once, centrally, so the app can clear cached data and return
 *    the person to the sign-in screen,
 *  - support cancellation so a slower earlier response cannot overwrite a
 *    newer one.
 */
import type { ApiErrorBody, ApiErrorCode } from '../../shared/api.js';
import { CSRF_HEADER, IDEMPOTENCY_HEADER } from '../../shared/api.js';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'network_error';
  readonly fieldErrors: Record<string, string>;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: ApiErrorCode | 'network_error',
    message: string,
    fieldErrors: Record<string, string> = {},
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.requestId = requestId;
  }

  /** True when the request never reached a server answer, so a retry is safe. */
  get isUncertain(): boolean {
    return this.code === 'network_error';
  }
}

// --- CSRF token -------------------------------------------------------------

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

// --- Session expiry notification -------------------------------------------

type UnauthenticatedListener = () => void;
const unauthenticatedListeners = new Set<UnauthenticatedListener>();

/** Registered by the auth provider; fires on any 401 from any request. */
export function onUnauthenticated(listener: UnauthenticatedListener): () => void {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

let notifying = false;

function notifyUnauthenticated(): void {
  // Guard against a cascade when several in-flight requests all 401 at once.
  if (notifying) return;
  notifying = true;
  try {
    for (const listener of unauthenticatedListeners) listener();
  } finally {
    // Allow the next genuine expiry to notify again.
    setTimeout(() => {
      notifying = false;
    }, 0);
  }
}

// --- Request ----------------------------------------------------------------

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Required for create-style mutations; preserved across retries (BR-091). */
  idempotencyKey?: string;
  /** Set for the sign-in call itself, where a 401 is an expected answer. */
  suppressUnauthenticatedNotice?: boolean;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, idempotencyKey, suppressUnauthenticatedNotice } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;
  if (idempotencyKey) headers[IDEMPOTENCY_HEADER] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      // First-party session cookie.
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // The request may or may not have been applied. Callers must retry with
    // the same idempotency key rather than assuming either outcome.
    throw new ApiRequestError(
      0,
      'network_error',
      'The server could not be reached. Check your connection and try again — your work has not been lost.',
    );
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (response.ok) return payload as T;

  const errorBody = (payload ?? {}) as Partial<ApiErrorBody>;

  if (response.status === 401 && !suppressUnauthenticatedNotice) {
    notifyUnauthenticated();
  }

  throw new ApiRequestError(
    response.status,
    errorBody.code ?? 'internal_error',
    errorBody.message ?? 'The request could not be completed.',
    errorBody.fieldErrors ?? {},
    errorBody.requestId ?? response.headers.get('x-request-id'),
  );
}

/** Builds a query string from defined values only. */
export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** Idempotency keys are generated once per submission and reused on retry. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
