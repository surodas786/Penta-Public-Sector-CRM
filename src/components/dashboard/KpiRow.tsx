import React from 'react';
import { formatBDTShort, formatBDT } from '../../utils/format';

interface KpiRowProps {
  pipelineValue: number;
  activeCount: number;
  overdueCount: number;
  tendersDue7: number;
  awardedQuarter: number;
  scopeNote: string;
  onOpen: (target: 'pipeline' | 'active' | 'overdue' | 'tenders' | 'awarded') => void;
}

const ACCENT = {
  teal: 'border-l-brand',
  red: 'border-l-red-600',
  amber: 'border-l-amber-500',
  green: 'border-l-green-600'
};

function KpiCard({ label, value, note, accent, onClick }: {label: string;value: string;note: string;accent: keyof typeof ACCENT;onClick: () => void;}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col justify-center rounded-lg border border-l-[3px] border-slate-200 bg-white px-3.5 py-3 text-left transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${ACCENT[accent]}`}>
      
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="mt-1 text-[22px] font-bold tabular-nums text-slate-900">{value}</span>
      <span className="mt-0.5 text-[11px] text-slate-400">{note}</span>
    </button>);

}

export function KpiRow({ pipelineValue, activeCount, overdueCount, tendersDue7, awardedQuarter, scopeNote, onOpen }: KpiRowProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[1.9fr_1fr_1fr_1fr_1fr]">
      <button
        type="button"
        onClick={() => onOpen('pipeline')}
        className="col-span-2 flex flex-col justify-center rounded-lg bg-navy px-5 py-4 text-left transition-colors duration-150 hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:col-span-4 xl:col-span-1">
        
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#9FB4D1]">Estimated Active Pipeline Value</span>
        <span className="mt-1.5 text-4xl font-extrabold tabular-nums text-white">{formatBDTShort(pipelineValue)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#C9D6E8]">Estimate — excludes Awarded / Lost / Cancelled</span>
          <span className="text-[10.5px] tabular-nums text-[#8FA0BD]">{formatBDT(pipelineValue)}</span>
        </span>
      </button>
      <KpiCard label="Active Opportunities" value={String(activeCount)} note={scopeNote} accent="teal" onClick={() => onOpen('active')} />
      <KpiCard label="Overdue Follow-ups" value={String(overdueCount)} note={overdueCount ? 'Needs attention' : 'All caught up'} accent="red" onClick={() => onOpen('overdue')} />
      <KpiCard label="Tenders Due in 7 Days" value={String(tendersDue7)} note="Submission window" accent="amber" onClick={() => onOpen('tenders')} />
      <KpiCard label="Awarded Value This Quarter" value={formatBDTShort(awardedQuarter)} note="Actual awarded · Q4 2026" accent="green" onClick={() => onOpen('awarded')} />
    </div>);

}