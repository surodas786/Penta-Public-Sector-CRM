/**
 * Shared submit behaviour for API-mode dialogs (FR-013, BR-091, plan 4.2).
 *
 *  - One idempotency key per intended change. It survives an uncertain
 *    network failure, so the retry is recognised by the server rather than
 *    applied twice, and is discarded after a confirmed answer.
 *  - Double submission is ignored while a request is in flight.
 *  - 422 field errors, 409 version conflicts and other refusals are kept apart
 *    so the dialog can show each one where it belongs, with typed values kept.
 */
import { useCallback, useRef, useState } from 'react';

import { ApiRequestError, newIdempotencyKey } from '../api/client.js';

export interface Submission {
  submitting: boolean;
  fieldErrors: Record<string, string>;
  formError: string | null;
  /** True after a 409 version conflict; the dialog offers a reload. */
  conflict: boolean;
  /** Clears every error and starts a fresh key. Call when a dialog opens. */
  reset: () => void;
  clearField: (field: string) => void;
  /** Runs `request` with the current key. Resolves to undefined on failure. */
  run: <T>(request: (idempotencyKey: string) => Promise<T>) => Promise<T | undefined>;
}

export function useSubmission(): Submission {
  const key = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const reset = useCallback(() => {
    key.current = null;
    setFieldErrors({});
    setFormError(null);
    setConflict(false);
  }, []);

  const clearField = useCallback((field: string) => {
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const run = useCallback(async <T,>(request: (idempotencyKey: string) => Promise<T>) => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    setConflict(false);
    key.current ??= newIdempotencyKey();

    try {
      const result = await request(key.current);
      key.current = null;
      return result;
    } catch (error) {
      if (!(error instanceof ApiRequestError)) {
        setFormError('The change could not be saved. Try again.');
        return undefined;
      }
      if (error.isUncertain) {
        // The change may or may not have been applied: keep the key so a
        // retry is answered with the original result, never applied twice.
        setFormError(error.message);
        return undefined;
      }
      // The server answered, so this key has served its purpose.
      key.current = null;
      if (error.code === 'version_conflict') {
        setConflict(true);
        setFormError(error.message);
      } else if (Object.keys(error.fieldErrors).length > 0) {
        setFieldErrors(error.fieldErrors);
        setFormError(error.status === 422 ? 'Please correct the highlighted fields.' : error.message);
      } else {
        setFormError(error.message);
      }
      return undefined;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, []);

  return { submitting, fieldErrors, formError, conflict, reset, clearField, run };
}
