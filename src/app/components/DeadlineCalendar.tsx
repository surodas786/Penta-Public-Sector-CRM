/**
 * The approved month calendar, for API mode. Same layout and tones as the
 * demo's MonthCalendar; "today" is the real Bangladesh date rather than the
 * demo's fixed one.
 */
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { dhakaToday } from '../ui/dates.js';

export interface CalendarEvent {
  id: string;
  /** YYYY-MM-DD in Bangladesh time. */
  date: string;
  label: string;
  tone: 'red' | 'amber' | 'green' | 'slate';
  onClick: () => void;
}

const TONES: Record<CalendarEvent['tone'], string> = {
  red: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  amber: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
  green: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
  slate: 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function DeadlineCalendar({
  year,
  month,
  events,
  onMonthChange,
}: {
  year: number;
  /** 0-based. */
  month: number;
  events: CalendarEvent[];
  onMonthChange: (year: number, month: number) => void;
}) {
  const today = dhakaToday();
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < first.getUTCDay(); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);

  const shift = (delta: number) => {
    const next = month + delta;
    onMonthChange(year + Math.floor(next / 12), ((next % 12) + 12) % 12);
  };
  const goToday = () => onMonthChange(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">
          {MONTHS[month]} {year}
        </h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Previous month">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={goToday} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            This month
          </button>
          <button type="button" onClick={() => shift(1)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Next month">
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7">
          {WEEKDAYS.map((day) => (
            <div key={day} className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {day}
            </div>
          ))}
          {cells.map((date, index) => {
            const dayEvents = date ? (byDate.get(date) ?? []) : [];
            const isToday = date === today;
            return (
              <div key={index} className={`min-h-[104px] border-b border-r border-slate-100 p-1.5 ${date ? 'bg-white' : 'bg-slate-50/60'}`}>
                {date && (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                          isToday ? 'bg-brand text-white' : 'text-slate-600'
                        }`}
                      >
                        {Number(date.slice(8))}
                      </span>
                      {isToday && <span className="text-[10px] font-semibold text-brand">Today</span>}
                    </div>
                    <div className="flex flex-col gap-1">
                      {dayEvents.slice(0, 3).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={event.onClick}
                          title={event.label}
                          className={`truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-medium transition-colors duration-150 ${TONES[event.tone]}`}
                        >
                          {event.label}
                        </button>
                      ))}
                      {dayEvents.length > 3 && <span className="px-1 text-[11px] text-slate-500">+{dayEvents.length - 3} more</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
