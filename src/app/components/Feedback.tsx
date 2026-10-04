/**
 * Shared loading, error and unavailable states for API mode.
 *
 * Each error is reported with the server's own message and its request id, so
 * a user can quote something traceable to support without the response ever
 * carrying internal detail (SEC-020).
 */
import { useNavigate } from 'react-router-dom';
import { AlertTriangleIcon, LockIcon } from 'lucide-react';

import type { ApiRequestError } from '../../api/client.js';
import { Button } from '../../components/ui/Button';
import { tdCls } from '../../components/ui/Layout';

export function LoadingRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} aria-hidden="true">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex} className={tdCls}>
              <span className="block h-3 w-full max-w-[160px] animate-pulse rounded bg-slate-100" />
            </td>
          ))}
        </tr>
      ))}
      <tr className="sr-only">
        <td colSpan={columns}>Loading…</td>
      </tr>
    </>
  );
}

export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-12">
      <p className="text-sm text-slate-500" role="status">
        {label}
      </p>
    </div>
  );
}

export function ErrorPanel({ error, onRetry }: { error: ApiRequestError; onRetry?: () => void }) {
  const isAccessIssue = error.status === 403 || error.status === 404;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        {isAccessIssue ? <LockIcon className="h-5 w-5" /> : <AlertTriangleIcon className="h-5 w-5" />}
      </div>
      <h2 className="text-base font-bold text-slate-900">
        {error.status === 404
          ? 'Not available'
          : error.status === 403
            ? 'Not permitted'
            : 'Something went wrong'}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{error.message}</p>
      {error.requestId && (
        <p className="mt-2 text-[11px] tabular-nums text-slate-400">Reference: {error.requestId}</p>
      )}
      {onRetry && !isAccessIssue && (
        <Button variant="primary" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Shown when an authenticated account reaches a screen its role has no access
 * to. Mirrors what the server would answer, so the two never disagree, and
 * offers the route the account can actually use.
 */
export function AccessDeniedPanel({
  title,
  message,
  actionLabel,
  actionTo,
}: {
  title: string;
  message: string;
  actionLabel: string;
  actionTo: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <LockIcon className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{message}</p>
        <Button variant="primary" className="mt-5" onClick={() => navigate(actionTo, { replace: true })}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Shown in place of a feature whose server endpoints do not exist yet. States
 * the reason plainly rather than presenting an empty or fabricated screen.
 */
export function UnavailableFeature({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <LockIcon className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">{title} is not available yet</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{reason}</p>
        <p className="mx-auto mt-3 max-w-md text-[12px] text-slate-500">
          The approved design for this screen is unchanged and can be reviewed in the separate
          synthetic demo build. It is not connected to real data.
        </p>
      </div>
    </div>
  );
}
