// Centralized reporting for failed API calls.
//
// We learned the hard way (location dropdown silently empty in prod because a
// 401 was buried in `.catch(() => {})`) that hiding API failures makes
// production triage painful. This module gives every fetch site a single
// channel to:
//   1. emit a structured `console.warn` with status + endpoint, and
//   2. surface a user-visible toast (unless explicitly opted out for
//      best-effort background cleanups).
//
// The toast is delivered through a window CustomEvent so non-React callers
// (contexts, plain `fetch` blocks, hook helpers) can report without needing
// to be inside the ToastProvider tree.

export const API_ERROR_EVENT = 'helm:api-error';

export interface ApiErrorToastDetail {
  title: string;
  message: string;
}

export interface ReportApiErrorOptions {
  endpoint: string;
  status?: number;
  error?: unknown;
  // Short label shown in the toast title (e.g. "Locations", "Branding").
  // Falls back to a generic "Request failed" when omitted.
  label?: string;
  // Best-effort background calls (e.g. cleanup of orphaned R2 objects)
  // should still log but shouldn't pester the user with a toast.
  silent?: boolean;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err == null) return '';
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function reportApiError(opts: ReportApiErrorOptions): void {
  const { endpoint, status, error, label, silent } = opts;
  const errMsg = describeError(error);

  // Structured console.warn — keep the prefix searchable so ops can grep
  // browser logs / Sentry breadcrumbs for `[helm:api]`.
  // eslint-disable-next-line no-console
  console.warn('[helm:api] request failed', {
    endpoint,
    status: status ?? null,
    error: errMsg || null,
  });

  if (silent) return;
  if (typeof window === 'undefined') return;

  const title = label ? `${label} failed` : 'Request failed';
  const statusPart = status ? `${status} ` : '';
  const tail = errMsg && errMsg !== 'Failed to fetch' ? ` — ${errMsg}` : '';
  const message = `${statusPart}${endpoint}${tail}`.trim();

  window.dispatchEvent(
    new CustomEvent<ApiErrorToastDetail>(API_ERROR_EVENT, {
      detail: { title, message },
    }),
  );
}
