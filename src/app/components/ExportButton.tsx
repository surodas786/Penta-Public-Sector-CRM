/**
 * Export CSV (FR-083). The server queues the export, builds it from every
 * matching record under the current scope, and re-checks access when the
 * file is downloaded (SEC-005). Nothing is assembled in the browser.
 *
 * One idempotency key per click: a retry after an uncertain network result
 * reuses it, so it cannot queue a second export (BR-091).
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DownloadIcon } from 'lucide-react';

import type { ExportKind } from '../../../shared/reporting.js';
import { ApiRequestError, newIdempotencyKey } from '../../api/client.js';
import { exportDownloadUrl, fetchExport, requestExport } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';

const POLL_MS = 1000;
const MAX_POLLS = 120;

export function ExportButton({
  kind,
  filters,
  disabled,
  scopeLabel,
}: {
  kind: ExportKind;
  /** The screen's own filters, as it sends them to the list or report endpoint. */
  filters: Record<string, string | number | undefined>;
  disabled?: boolean;
  scopeLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'working'>('idle');
  const pendingKey = useRef<string | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const run = async () => {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '' && key !== 'page' && key !== 'pageSize') clean[key] = String(value);
    }
    pendingKey.current ??= newIdempotencyKey();
    setState('working');
    try {
      let exported = await requestExport(kind, clean, pendingKey.current);
      for (let poll = 0; (exported.status === 'queued' || exported.status === 'running') && poll < MAX_POLLS; poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled.current) return;
        exported = await fetchExport(exported.id);
      }
      pendingKey.current = null;
      if (exported.status !== 'ready') {
        toast.error(exported.failureReason ?? 'The export is taking longer than expected. Try again shortly.');
        return;
      }
      // A same-origin navigation: the session cookie goes with it and the
      // server re-checks access before sending the file.
      const link = document.createElement('a');
      link.href = exportDownloadUrl(exported.id);
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('CSV exported', { description: `${exported.rowCount ?? 0} rows · scope: ${scopeLabel}` });
    } catch (caught) {
      // Keep the key after a network failure so the retry is recognised.
      if (caught instanceof ApiRequestError && caught.status !== 0) pendingKey.current = null;
      toast.error(caught instanceof ApiRequestError ? caught.message : 'The export could not be prepared.');
    } finally {
      if (!cancelled.current) setState('idle');
    }
  };

  return (
    <Button
      variant="primary"
      icon={<DownloadIcon className="h-4 w-4" />}
      onClick={() => void run()}
      disabled={disabled || state === 'working'}
      aria-busy={state === 'working'}
    >
      {state === 'working' ? 'Preparing CSV…' : 'Export CSV'}
    </Button>
  );
}
