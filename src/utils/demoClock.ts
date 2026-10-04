import { dhakaParts } from './format';

/** Fixed demo date. All due/overdue/deadline indicators are calculated against this. */
export const DEMO_TODAY = '2026-10-02';
export const DEMO_NOW = '2026-10-02T10:00:00+06:00';
export const DEMO_DATE_LABEL = '02 Oct 2026';

/** Timestamp for new records: the fixed demo date combined with the real current Bangladesh time. */
export function demoTimestamp(): string {
  const now = new Date();
  const t = dhakaParts(now.toISOString()).time;
  return `${DEMO_TODAY}T${t}:${String(now.getSeconds()).padStart(2, '0')}+06:00`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export type DateRangeKey = 'last30' | 'quarter' | 'year' | 'all';

export const DATE_RANGE_LABELS: Record<DateRangeKey, string> = {
  last30: 'Last 30 days',
  quarter: 'This quarter',
  year: 'This year',
  all: 'All time'
};

export const QUARTER_START = '2026-10-01';
export const QUARTER_END = '2026-12-31';

export function dateRangeBounds(key: DateRangeKey): {from: string;to: string;} | null {
  switch (key) {
    case 'last30':
      return { from: addDays(DEMO_TODAY, -30), to: DEMO_TODAY };
    case 'quarter':
      return { from: QUARTER_START, to: QUARTER_END };
    case 'year':
      return { from: '2026-01-01', to: '2026-12-31' };
    default:
      return null;
  }
}

export function inDateRange(date: string | undefined, key: DateRangeKey): boolean {
  const b = dateRangeBounds(key);
  if (!b) return true;
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= b.from && d <= b.to;
}

export function inCustomRange(date: string | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!date) return false;
  const d = date.length > 10 ? dhakaParts(date).date : date;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}