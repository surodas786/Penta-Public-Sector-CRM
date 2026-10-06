/**
 * Filters that arrived with a dashboard drill-down (FR-014), shown in words
 * with their date basis so the list never silently means something else
 * (BR-060). Each can be removed on its own.
 */
import { XIcon } from 'lucide-react';

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function FilterChips({ chips }: { chips: FilterChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Applied filters">
      {chips.map((chip) => (
        <li key={chip.key}>
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-light py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-brand-dark">
            {chip.label}
            <button
              type="button"
              onClick={chip.onRemove}
              className="rounded-full p-0.5 hover:bg-brand/10"
              aria-label={`Remove filter: ${chip.label}`}
            >
              <XIcon className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
