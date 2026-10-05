const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const dhakaFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

/** Returns the calendar date (YYYY-MM-DD) and time (HH:mm) of an instant in Bangladesh time. */
export function dhakaParts(iso: string): {date: string;time: string;} {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso.slice(0, 10), time: '' };
  const parts = dhakaFormatter.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

/** DD MMM YYYY */
export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = value.length > 10 ? dhakaParts(value).date : value;
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return value;
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatTime(iso: string): string {
  // §20: "BST" is ambiguous (British Summer Time / Bangladesh Standard Time).
  // The specification requires "Bangladesh time" or "UTC+6" instead.
  return `${dhakaParts(iso).time} UTC+6`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

export function toDhakaInput(iso?: string | null): string {
  if (!iso) return '';
  const p = dhakaParts(iso);
  return `${p.date}T${p.time}`;
}

export function fromDhakaInput(value: string): string {
  if (!value) return '';
  return `${value.slice(0, 16)}:00+06:00`;
}

export function formatBDT(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `৳ ${Math.round(n).toLocaleString('en-IN')}`;
}

function trimDecimals(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Readable BDT: Crore / Lakh units. */
export function formatBDTShort(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `৳ ${trimDecimals((n / 1e7).toFixed(2))} Cr`;
  if (abs >= 1e5) return `৳ ${trimDecimals((n / 1e5).toFixed(1))} Lakh`;
  return formatBDT(n);
}

export function initials(name: string): string {
  return name.
  split(' ').
  filter(Boolean).
  slice(0, 2).
  map((p) => p[0]?.toUpperCase() ?? '').
  join('');
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function monthLabel(year: number, monthIndex: number): string {
  return `${FULL_MONTHS[monthIndex]} ${year}`;
}