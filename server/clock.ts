/**
 * Injectable clock.
 *
 * Production always uses real time (FR-080). Tests replace the instance so
 * Dhaka-midnight, idle-expiry and absolute-expiry behaviour can be exercised
 * deterministically. Nothing outside this module calls `new Date()` for
 * business logic.
 */
import { BUSINESS_TIME_ZONE } from '../shared/enums.js';

export interface Clock {
  now(): Date;
}

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test double. Advance it explicitly; it never drifts on its own. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date | string) {
    this.current = typeof start === 'string' ? new Date(start) : new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(next: Date | string): void {
    this.current = typeof next === 'string' ? new Date(next) : new Date(next.getTime());
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceDays(days: number): void {
    this.advanceMinutes(days * 24 * 60);
  }
}

let active: Clock = new SystemClock();

export function getClock(): Clock {
  return active;
}

export function setClock(clock: Clock): void {
  active = clock;
}

export function resetClock(): void {
  active = new SystemClock();
}

export function now(): Date {
  return active.now();
}

const dhakaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Today's calendar date in Asia/Dhaka as YYYY-MM-DD. Every date-only comparison
 * (overdue follow-ups, quarter boundaries) uses this, never the server's
 * local date.
 */
export function dhakaToday(at: Date = now()): string {
  return dhakaDateFormatter.format(at);
}

/** The Dhaka calendar date of an instant. */
export function dhakaDateOf(at: Date): string {
  return dhakaDateFormatter.format(at);
}

/**
 * Bangladesh has kept UTC+6 all year since 2009 (no daylight saving), so a
 * Dhaka calendar date starts at a fixed offset. Instants are still stored in
 * UTC; only these boundaries use the offset.
 */
const DHAKA_OFFSET = '+06:00';

/** The instant a Dhaka calendar date begins (00:00 Bangladesh time). */
export function dhakaStartOfDay(date: string): Date {
  return new Date(`${date}T00:00:00${DHAKA_OFFSET}`);
}

/** Calendar arithmetic on YYYY-MM-DD values, independent of any time zone. */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface CalendarQuarter {
  /** e.g. "Q4 2026" */
  label: string;
  /** First and last Dhaka calendar dates, inclusive. */
  start: string;
  end: string;
}

/** FR-080: the calendar quarter containing a Dhaka date. */
export function dhakaQuarter(date: string = dhakaToday()): CalendarQuarter {
  const year = Number(date.slice(0, 4));
  const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
  const firstMonth = (quarter - 1) * 3 + 1;
  const start = `${year}-${String(firstMonth).padStart(2, '0')}-01`;
  const nextStart =
    quarter === 4 ? `${year + 1}-01-01` : `${year}-${String(firstMonth + 3).padStart(2, '0')}-01`;
  return { label: `Q${quarter} ${year}`, start, end: addCalendarDays(nextStart, -1) };
}
