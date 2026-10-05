/**
 * Date and time presentation for API mode.
 *
 * Instants are stored in UTC and rendered in Bangladesh time. §20 requires the
 * explicit "Bangladesh time (UTC+6)" wording rather than the ambiguous "BST"
 * the prototype used.
 */
import { BUSINESS_TIME_LABEL, BUSINESS_TIME_ZONE } from '../../../shared/enums.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dhakaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dhakaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Today's calendar date in Asia/Dhaka, from the real clock (FR-080). */
export function dhakaToday(): string {
  return dhakaDate.format(new Date());
}

/** DD MMM YYYY from a date-only value. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** DD MMM YYYY, HH:mm Bangladesh time (UTC+6) from a UTC instant. */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${formatCalendarDate(dhakaDate.format(parsed))}, ${dhakaTime.format(parsed)} ${BUSINESS_TIME_LABEL}`;
}

export { BUSINESS_TIME_LABEL };

/** A UTC instant as the value of a datetime-local input, in Bangladesh time. */
export function toDhakaInput(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return `${dhakaDate.format(date)}T${dhakaTime.format(date)}`;
}

/** A datetime-local value entered in Bangladesh time, as an instant (UTC+6, no DST). */
export function fromDhakaInput(value: string): string {
  return value ? `${value}:00+06:00` : '';
}
