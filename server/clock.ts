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
