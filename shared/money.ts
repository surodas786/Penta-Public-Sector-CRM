/**
 * BDT amounts are transported as decimal strings and stored as NUMERIC(14,2).
 *
 * Plan 4.2: money must not pass through a JavaScript float. Converting to
 * `number` is permitted only at a display boundary (chart geometry, shorthand
 * labels) and never as the financial source of truth.
 */

/** Up to 12 integer digits and at most 2 decimals — the NUMERIC(14,2) envelope. */
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export function isValidMoneyString(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/**
 * Normalises an accepted decimal string to its canonical two-decimal form.
 * Throws for anything that is not already a valid amount — callers validate first.
 */
export function canonicalMoney(value: string): string {
  const trimmed = value.trim();
  if (!isValidMoneyString(trimmed)) {
    throw new Error(`Not a valid BDT amount: ${value}`);
  }
  const [whole, fraction = ''] = trimmed.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

/** Sums canonical decimal strings in integer paisa, returning a decimal string. */
export function sumMoney(values: readonly string[]): string {
  const totalPaisa = values.reduce((acc, value) => acc + toPaisa(value), 0n);
  return fromPaisa(totalPaisa);
}

export function toPaisa(value: string): bigint {
  const canonical = canonicalMoney(value);
  const [whole, fraction] = canonical.split('.') as [string, string];
  return BigInt(whole) * 100n + BigInt(fraction);
}

export function fromPaisa(paisa: bigint): string {
  const negative = paisa < 0n;
  const absolute = negative ? -paisa : paisa;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(2, '0')}`;
}

/**
 * Display only. `৳ 42,000,000.00` style grouping used by the approved tables.
 * Never feed the result back into a calculation.
 */
export function formatBdt(value: string): string {
  const canonical = canonicalMoney(value);
  const [whole, fraction] = canonical.split('.') as [string, string];
  const grouped = Number(whole).toLocaleString('en-IN');
  return `৳ ${grouped}.${fraction}`;
}

/**
 * Display only. Crore / Lakh shorthand as shown in the approved demo (§20),
 * presented alongside the exact value rather than replacing it.
 */
export function formatBdtShort(value: string): string {
  const paisa = toPaisa(value);
  const amount = Number(paisa) / 100;
  const absolute = Math.abs(amount);
  if (absolute >= 1e7) return `৳ ${trimTrailingZeros((amount / 1e7).toFixed(2))} Cr`;
  if (absolute >= 1e5) return `৳ ${trimTrailingZeros((amount / 1e5).toFixed(1))} Lakh`;
  return formatBdt(value);
}

function trimTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
