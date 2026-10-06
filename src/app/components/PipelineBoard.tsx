/**
 * Pipeline (Kanban) board for API mode (FR-021, D-001, D-006).
 *
 * Same markup and styling as the approved demo board. The differences are what
 * persistence requires:
 *
 *  - Lanes, counts and values come from the server, computed over permitted
 *    records only. Awarded sums actual awarded value; the other lanes sum
 *    estimates, and each header says which (D-006).
 *  - A dropped card is shown in its target lane marked "Not saved yet" until
 *    the server confirms. If the dialog is cancelled or the server refuses,
 *    the pending marker is dropped and the card is back where it was — its
 *    original lane and position, because the underlying data never changed.
 */
import { useState } from 'react';

import type { BoardDto, BoardLaneDto, OpportunityListItemDto } from '../../../shared/api.js';
import { boardLaneTitle, type BoardLane } from '../../../shared/enums.js';
import { formatBdtShort } from '../../../shared/money.js';
import { formatCalendarDate } from '../ui/dates.js';
import { Avatar } from '../ui/ApiBadges.js';

const PRIORITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-slate-300' } as const;
const SHADED_LANES: readonly BoardLane[] = ['awarded', 'lost', 'on_hold', 'cancelled'];

export interface PendingMove {
  id: string;
  to: BoardLane;
}

interface PipelineBoardProps {
  board: BoardDto;
  today: string;
  pending: PendingMove | null;
  /** Returns a reason when the card cannot be dragged by this account. */
  dragRefusal: (item: OpportunityListItemDto) => string | null;
  onOpen: (id: string) => void;
  onMove: (item: OpportunityListItemDto, to: BoardLane) => void;
}

export function PipelineBoard({ board, today, pending, dragRefusal, onOpen, onMove }: PipelineBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<BoardLane | null>(null);

  const pendingItem = pending
    ? board.lanes.flatMap((lane) => lane.items).find((item) => item.id === pending.id) ?? null
    : null;

  const itemsFor = (lane: BoardLaneDto): OpportunityListItemDto[] => {
    if (!pending || !pendingItem) return lane.items;
    if (lane.lane === pending.to) return [pendingItem, ...lane.items.filter((item) => item.id !== pending.id)];
    return lane.items.filter((item) => item.id !== pending.id);
  };

  const findItem = (id: string) => board.lanes.flatMap((lane) => lane.items).find((item) => item.id === id);

  return (
    // `relative` keeps the lane headers' screen-reader labels (absolutely
    // positioned) inside the scroller; without it they widen the whole page.
    <div className="relative overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {board.lanes.map((lane) => {
          const items = itemsFor(lane);
          const isOver = overLane === lane.lane && dragId !== null;
          const title = boardLaneTitle(lane.lane);
          const valueLabel = lane.valueBasis === 'awarded' ? 'Actual awarded value' : 'Estimated value';
          const hidden = lane.total - lane.items.length;

          return (
            <section
              key={lane.lane}
              aria-label={`${title} column`}
              onDragOver={(event) => {
                event.preventDefault();
                setOverLane(lane.lane);
              }}
              onDragLeave={() => setOverLane((current) => (current === lane.lane ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData('text/plain');
                setOverLane(null);
                setDragId(null);
                const item = findItem(id);
                if (item) onMove(item, lane.lane);
              }}
              className={`flex w-64 shrink-0 flex-col rounded-lg border transition-colors duration-150 ${
                isOver
                  ? 'border-brand bg-brand-light/60'
                  : SHADED_LANES.includes(lane.lane)
                    ? 'border-slate-200 bg-slate-100/70'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <h3 className="text-[12px] font-bold text-slate-800">{title}</h3>
                  <p className="text-[11px] tabular-nums text-slate-500" title={`${valueLabel} of the ${lane.total} permitted records in this lane`}>
                    {lane.total ? formatBdtShort(lane.value) : '—'}
                    <span className="sr-only"> {valueLabel}</span>
                  </p>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600 ring-1 ring-slate-200">
                  {lane.total}
                </span>
              </header>
              <ul className="flex min-h-[120px] flex-col gap-2 p-2">
                {items.map((item) => {
                  const isPending = pending?.id === item.id;
                  const refusal = dragRefusal(item);
                  const due = item.status === 'active' && item.nextAction ? item.nextAction.dueDate : null;
                  const dueState = due ? (due < today ? 'overdue' : due === today ? 'today' : 'upcoming') : null;
                  const shownValue = item.stage === 'awarded' && item.awardedValue ? item.awardedValue : item.estimatedValue;

                  return (
                    <li
                      key={item.id}
                      draggable={!refusal && !pending}
                      title={refusal ?? undefined}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', item.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDragId(item.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverLane(null);
                      }}
                      className={`rounded-md border bg-white p-2.5 transition-[opacity,box-shadow] duration-150 hover:border-slate-300 hover:shadow-sm ${
                        refusal || pending ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
                      } ${dragId === item.id ? 'opacity-50' : ''} ${
                        isPending ? 'border-dashed border-brand ring-2 ring-brand/20' : 'border-slate-200'
                      }`}
                    >
                      <button type="button" onClick={() => onOpen(item.id)} className="block w-full text-left">
                        <span className="flex items-start gap-1.5">
                          <span
                            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[item.priority]}`}
                            title={`${item.priority} priority`}
                          />
                          <span className="text-[12.5px] font-semibold leading-snug text-slate-900">{item.name}</span>
                        </span>
                        <span className="mt-0.5 block truncate pl-3 text-[11px] text-slate-500">{item.organization.name}</span>
                        <span className="mt-2 flex items-center justify-between pl-3">
                          <span className="text-[12px] font-bold tabular-nums text-slate-800">{formatBdtShort(shownValue)}</span>
                          <span className="flex items-center gap-1.5" title={item.ownerName}>
                            <Avatar name={item.ownerName} />
                          </span>
                        </span>
                        {isPending ? (
                          <span className="mt-2 block rounded bg-brand-light px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-dark" role="status">
                            Not saved yet
                          </span>
                        ) : (
                          dueState && (
                            <span
                              className={`mt-2 block rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${
                                dueState === 'overdue'
                                  ? 'bg-red-50 text-red-700'
                                  : dueState === 'today'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-slate-50 text-slate-500'
                              }`}
                            >
                              {dueState === 'overdue' ? 'Overdue · ' : dueState === 'today' ? 'Due today · ' : 'Next · '}
                              {formatCalendarDate(due)}
                            </span>
                          )
                        )}
                      </button>
                    </li>
                  );
                })}
                {items.length === 0 && <li className="px-2 py-6 text-center text-[11px] text-slate-400">Drop here</li>}
                {hidden > 0 && (
                  <li className="px-2 py-1 text-center text-[11px] text-slate-500">
                    {hidden} more — use the Table view to see them all
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
