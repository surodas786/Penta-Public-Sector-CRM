import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchIcon } from 'lucide-react';
import { useScope } from '../../hooks/useScope';
import { useClickOutside } from '../../hooks/useClickOutside';
import { orgName } from '../../utils/lookup';
import { StageBadge } from '../ui/Badges';

interface Result {
  id: string;
  group: string;
  title: string;
  sub: string;
  to: string;
  badge?: React.ReactNode;
}

/** Searches only the records in the current user's permitted scope (including archived opportunities). */
export function GlobalSearch() {
  const scope = useScope();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const has = (...vals: string[]) => vals.some((v) => v.toLowerCase().includes(term));
    const out: Result[] = [];
    scope.opportunities.
    filter((o) => has(o.name, o.description, orgName(scope.organizations, o.orgId))).
    slice(0, 6).
    forEach((o) =>
    out.push({ id: o.id, group: 'Opportunities', title: o.name, sub: orgName(scope.organizations, o.orgId), to: `/opportunities/${o.id}`, badge: <StageBadge stage={o.stage} /> })
    );
    scope.tenders.
    filter((t) => has(t.title, t.reference, t.procuringEntity)).
    slice(0, 4).
    forEach((t) => out.push({ id: t.id, group: 'Tenders', title: t.reference, sub: t.title, to: `/tenders/${t.id}` }));
    scope.contacts.
    filter((c) => has(c.name, c.designation, c.email)).
    slice(0, 4).
    forEach((c) => out.push({ id: c.id, group: 'Contacts', title: c.name, sub: `${c.designation} · ${orgName(scope.organizations, c.orgId)}`, to: `/contacts/${c.id}` }));
    scope.organizations.
    filter((o) => has(o.name, o.location)).
    slice(0, 4).
    forEach((o) => out.push({ id: o.id, group: 'Organizations', title: o.name, sub: `${o.type} · ${o.location}`, to: `/organizations/${o.id}` }));
    return out;
  }, [q, scope]);

  const go = (r: Result) => {
    setOpen(false);
    setQ('');
    navigate(r.to);
  };

  const groups = Array.from(new Set(results.map((r) => r.group)));

  if (!scope.salesAccess) {
    return (
      <div className="hidden max-w-sm flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-400 md:flex">
        <SearchIcon className="h-4 w-4" />
        Search is limited to sales roles
      </div>);

  }

  return (
    <div className="relative max-w-sm flex-1" ref={ref}>
      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-100 px-3 py-2 focus-within:border-brand focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/20">
        <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="sr-only">Search records</span>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(results[0]);
          }}
          placeholder="Search opportunities, tenders, contacts…"
          className="w-full bg-transparent text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none" />
        
      </label>
      {open && q.trim().length >= 2 &&
      <div className="absolute left-0 right-0 top-11 z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg sm:min-w-[26rem]">
          {results.length === 0 ?
        <p className="px-4 py-6 text-center text-sm text-slate-500">No accessible records match “{q.trim()}”.</p> :

        groups.map((g) =>
        <div key={g} className="py-1">
                <p className="px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{g}</p>
                {results.
          filter((r) => r.group === g).
          map((r) =>
          <button
            key={`${g}-${r.id}`}
            type="button"
            onClick={() => go(r)}
            className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-slate-50">
            
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-slate-800">{r.title}</span>
                        <span className="block truncate text-[11.5px] text-slate-500">{r.sub}</span>
                      </span>
                      {r.badge}
                    </button>
          )}
              </div>
        )
        }
        </div>
      }
    </div>);

}