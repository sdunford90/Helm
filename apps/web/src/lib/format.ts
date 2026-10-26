const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  const dollars = Math.abs(cents) / 100;
  const formatted = dollars.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `-$${formatted}` : `$${formatted}`;
}

// ---------------------------------------------------------------------------
// Dates
//
// Date-only values ('YYYY-MM-DD') are calendar dates, not instants. `new
// Date('2026-03-01')` parses them as UTC midnight, which is the previous
// evening in every US time zone, so they rendered one day early. The API
// also serialises Prisma date-only columns (issuedDate, dueDate, startDate,
// ...) as UTC midnight ('2026-03-01T00:00:00.000Z'); those are treated as
// calendar dates too.
// ---------------------------------------------------------------------------

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_MIDNIGHT_RE = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0+)?(?:Z|[+-]00:?00)$/;

/** Parse 'YYYY-MM-DD' as a LOCAL calendar date (midnight local time). */
export function parseDateOnly(value: string): Date | null {
  const m = DATE_ONLY_RE.exec(value) ?? UTC_MIDNIGHT_RE.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Parse any API date value; date-only values become local calendar dates. */
export function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return parseDateOnly(value) ?? new Date(value);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (date === null || date === undefined || date === '') return '—';
  const d = parseDate(date);
  if (Number.isNaN(d.getTime())) return typeof date === 'string' ? date : '—';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (date === null || date === undefined || date === '') return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return typeof date === 'string' ? date : '—';
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${displayHours}:${displayMinutes} ${ampm}`;
}

/** Local calendar key 'YYYY-MM-DD' for a Date (never via toISOString, which is UTC). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's local calendar date as 'YYYY-MM-DD'. */
export function todayKey(): string {
  return toDateKey(new Date());
}

/** Calendar-date key for any API date value. */
export function dateKey(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = parseDate(value);
  return Number.isNaN(d.getTime()) ? '' : toDateKey(d);
}

/** Whole nights between two calendar dates ('YYYY-MM-DD'), DST-safe. */
export function nightsBetween(from: string, to: string): number {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  if (!a || !b) return 0;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) {
    return phone;
  }
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/** Turn an API enum like 'PAST_DUE' into 'Past Due'. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
