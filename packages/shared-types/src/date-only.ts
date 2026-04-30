// Calendar-date helpers shared by the API and web app.
//
//   - parseDateOnly       — accepts a `YYYY-MM-DD` string, ISO timestamp,
//                           or `Date`; returns a `Date` at UTC 00:00 on
//                           that calendar day.
//   - normalizeDateOnly   — alias of parseDateOnly.
//   - todayDateOnly       — UTC-midnight `Date` for "now".
//   - formatDateOnlyISO   — `YYYY-MM-DD` for wire / diffing.
//   - formatDateOnlyDisplay — `Mon D, YYYY` for human-facing rendering.
//   - todayDateOnlyISO    — `YYYY-MM-DD` for "today" (clients).

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function parseDateOnly(input: Date | string): Date {
  if (typeof input === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (m) {
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    }
    const d = new Date(input);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date string: ${input}`);
    }
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }
  return new Date(
    Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()),
  );
}

export function normalizeDateOnly(input: Date | string): Date {
  return parseDateOnly(input);
}

export function todayDateOnly(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function formatDateOnlyISO(
  input: Date | string | null | undefined,
): string | null {
  if (input === null || input === undefined || input === '') return null;
  const d = parseDateOnly(input);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateOnlyDisplay(
  input: Date | string | null | undefined,
  fallback = '—',
): string {
  const iso = formatDateOnlyISO(input);
  if (!iso) return fallback;
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function todayDateOnlyISO(): string {
  return formatDateOnlyISO(todayDateOnly()) as string;
}
