import React from 'react';
import type { SectionId } from '../../types/crm';
import { formatBDTShort } from '../../utils/format';

export interface SectionPipelineRow {
  id: SectionId;
  name: string;
  value: number;
  count: number;
}

export function SectionPipeline({ rows, onOpen }: {rows: SectionPipelineRow[];onOpen: (id: SectionId) => void;}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) =>
      <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className="-mx-2 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-slate-50">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-slate-800">{r.name}</span>
              <span className="text-[13px] font-bold tabular-nums text-slate-900">{formatBDTShort(r.value)}</span>
            </span>
            <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(2, r.value / max * 100)}%` }} />
            </span>
            <span className="mt-1 block text-[11px] text-slate-500">{r.count} active opportunities · estimate</span>
          </button>
        </li>
      )}
    </ul>);

}