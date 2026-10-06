/**
 * Choose one of the caller's accessible opportunities by searching for it.
 * The list comes from the scoped, paginated opportunity query, so it can never
 * offer a record the caller could not open (SEC-002).
 */
import { useCallback, useState } from 'react';
import { SearchIcon } from 'lucide-react';

import { fetchOpportunities } from '../../api/endpoints.js';
import { Field, inputCls } from '../../components/ui/FormFields';
import { useApiResource } from '../useApiResource.js';

export function OpportunityPicker({
  value,
  onChange,
  error,
  label = 'Linked opportunity',
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string;
  label?: string;
}) {
  const [q, setQ] = useState('');
  const options = useApiResource(
    useCallback(
      (signal: AbortSignal) => fetchOpportunities({ q: q || undefined, pageSize: 50, sort: 'name', dir: 'asc' }, signal),
      [q],
    ),
    [q],
  );

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <Field label={label} htmlFor="pick-opp" required error={error}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <span className="relative sm:w-56">
            <span className="sr-only">Search opportunities</span>
            <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search…"
              aria-label="Search opportunities"
              className={inputCls(undefined, 'pl-8')}
            />
          </span>
          <select id="pick-opp" className={inputCls(error)} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select opportunity…</option>
            {options.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.reference}
              </option>
            ))}
          </select>
        </div>
      </Field>
      {options.data && options.data.total > options.data.items.length && (
        <p className="-mt-1 text-xs text-slate-500">
          Showing {options.data.items.length} of {options.data.total}. Type to narrow the list.
        </p>
      )}
    </div>
  );
}
