/**
 * Minimal data-fetching hook with cancellation and stale-response protection.
 *
 * When filters or the signed-in account change, the previous request is
 * aborted and any late answer is ignored, so an older response can never
 * overwrite a newer one (plan 4.2).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiRequestError } from '../api/client.js';
import { useAuth } from './AuthContext.js';

export interface ApiResource<T> {
  data: T | null;
  error: ApiRequestError | null;
  loading: boolean;
  /** Refetches immediately, e.g. after a successful mutation. */
  reload: () => void;
}

export function useApiResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  dependencies: readonly unknown[],
): ApiResource<T> {
  const { sessionKey } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  // Only the newest request may write to state.
  const requestSequence = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    requestSequence.current += 1;
    const sequence = requestSequence.current;

    setLoading(true);
    setError(null);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (sequence !== requestSequence.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        if (sequence !== requestSequence.current) return;
        setData(null);
        setError(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError(0, 'internal_error', 'Something went wrong loading this view.'),
        );
        setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, reloadToken, sessionKey]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, error, loading, reload };
}
