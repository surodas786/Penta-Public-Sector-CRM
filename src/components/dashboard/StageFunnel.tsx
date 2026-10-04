import React from 'react';
import { motion } from 'framer-motion';
import type { Stage } from '../../types/crm';
import { formatBDTShort } from '../../utils/format';

export interface FunnelStage {
  stage: Stage;
  count: number;
  value: number;
  kind: 'open' | 'awarded' | 'lost';
}

const FILL = { open: 'bg-brand', awarded: 'bg-green-600', lost: 'bg-slate-400' };

export function StageFunnel({ stages, onSelect }: {stages: FunnelStage[];onSelect: (stage: Stage) => void;}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[860px] items-stretch px-1.5 pb-2.5 pt-3">
        {stages.map((s, i) => {
          const closedStart = s.kind !== 'open' && stages[i - 1]?.kind === 'open';
          const pct = s.count === 0 ? 6 : Math.max(14, s.count / max * 100);
          return (
            <button
              key={s.stage}
              type="button"
              onClick={() => onSelect(s.stage)}
              aria-label={`${s.stage}: ${s.count} opportunities, ${formatBDTShort(s.value)}. Open filtered list.`}
              className={`group relative flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 rounded-md px-1.5 pb-1 pt-0.5 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
              i < stages.length - 1 && !(stages[i + 1]?.kind !== 'open' && s.kind === 'open') ? 'border-r border-dashed border-slate-200' : ''} ${
              closedStart ? 'ml-1.5 border-l-2 border-l-slate-200 bg-slate-50/60 pl-2.5' : s.kind !== 'open' ? 'bg-slate-50/60' : ''}`}>
              
              {s.kind !== 'open' &&
              <span
                className={`absolute left-1/2 top-0.5 -translate-x-1/2 rounded-full px-1.5 text-[8.5px] font-bold ${
                s.kind === 'awarded' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`
                }>
                
                  {s.kind === 'awarded' ? 'WON' : 'LOST'}
                </span>
              }
              <span className="flex h-7 items-end justify-center text-center text-[10px] font-bold uppercase leading-tight tracking-wide text-slate-500 group-hover:text-slate-800">
                {s.stage}
              </span>
              <span className="flex h-14 w-7 items-end overflow-hidden rounded bg-slate-100">
                <motion.span
                  className={`block w-full rounded-t ${s.count === 0 ? 'bg-slate-200' : FILL[s.kind]}`}
                  initial={{ height: 0 }}
                  animate={{ height: `${pct}%` }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1], delay: i * 0.03 }} />
                
              </span>
              <span className={`text-lg font-extrabold tabular-nums ${s.count === 0 ? 'text-slate-300' : 'text-slate-900'}`}>{s.count}</span>
              <span className="whitespace-nowrap text-[10.5px] font-semibold tabular-nums text-slate-500">{s.count === 0 ? '—' : formatBDTShort(s.value)}</span>
            </button>);

        })}
      </div>
    </div>);

}