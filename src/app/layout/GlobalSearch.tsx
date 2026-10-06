/**
 * Top-bar search (FR-091) — the approved box and grouped results, answered by
 * the server's scoped search. Typing is debounced; nothing is searched under
 * two characters; each group shows a bounded preview and its true accessible
 * total. Results never come from data cached in the browser. Administrators
 * search accounts and sections.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchIcon } from 'lucide-react';

import type { SearchResponseDto, SearchResultDto } from '../../../shared/api.js';
import { SEARCH_MIN_LENGTH } from '../../../shared/reporting.js';
import { ApiRequestError } from '../../api/client.js';
import { searchRecords } from '../../api/endpoints.js';
import { useAuth } from '../AuthContext.js';
import { StageBadge } from '../ui/ApiBadges.js';

const DEBOUNCE_MS = 250;

export function GlobalSearch() {
  const { user, sessionKey } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SearchResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const term = q.trim();

  // Debounced, cancellable: a slower earlier answer never replaces a newer one.
  useEffect(() => {
    setError(null);
    if (term.length < SEARCH_MIN_LENGTH) {
      setResult(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      searchRecords({ q: term }, controller.signal)
        .then((response) => setResult(response))
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setResult(null);
          setError(caught instanceof ApiRequestError ? caught.message : 'Search is not available right now.');
        })
        .finally(() => setBusy(false));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, sessionKey]);

  // Signing out or switching account clears anything shown.
  useEffect(() => {
    setQ('');
    setResult(null);
  }, [sessionKey]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const go = useCallback(
    (item: SearchResultDto) => {
      setOpen(false);
      setQ('');
      navigate(item.path);
    },
    [navigate],
  );

  if (!user) return null;
  const groups = result?.groups.filter((group) => group.items.length > 0) ?? [];
  const first = groups[0]?.items[0];
  const admin = user.capabilities.accountAdministration;

  return (
    <div className="relative max-w-sm flex-1" ref={ref}>
      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-100 px-3 py-2 focus-within:border-brand focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/20">
        <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="sr-only">Search records</span>
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'Enter' && first) go(first);
          }}
          placeholder={admin ? 'Search accounts and sections…' : 'Search opportunities, tenders, contacts…'}
          className="w-full bg-transparent text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
          aria-expanded={open && term.length >= SEARCH_MIN_LENGTH}
          aria-controls="global-search-results"
        />
      </label>
      {open && term.length > 0 && (
        <div
          id="global-search-results"
          className="absolute left-0 right-0 top-11 z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg sm:min-w-[26rem]"
          role="listbox"
          aria-label="Search results"
        >
          {term.length < SEARCH_MIN_LENGTH ? (
            <p className="px-4 py-4 text-center text-sm text-slate-500">Type at least {SEARCH_MIN_LENGTH} characters.</p>
          ) : error ? (
            <p className="px-4 py-4 text-center text-sm text-red-700">{error}</p>
          ) : !result || busy ? (
            <p className="px-4 py-4 text-center text-sm text-slate-500" role="status">
              Searching…
            </p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No accessible records match “{term}”.</p>
          ) : (
            groups.map((group) => (
              <div key={group.type} className="py-1">
                <p className="px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                  {group.label}
                  {group.total > group.items.length && (
                    <span className="ml-1 font-semibold normal-case tracking-normal">
                      · {group.items.length} of {group.total}, refine to narrow
                    </span>
                  )}
                </p>
                {group.items.map((item) => (
                  <button
                    key={`${group.type}-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => go(item)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-800">{item.title}</span>
                      <span className="block truncate text-[11.5px] text-slate-500">{item.summary}</span>
                    </span>
                    {item.stage && item.status && <StageBadge stage={item.stage} status={item.status} />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
