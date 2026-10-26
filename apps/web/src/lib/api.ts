/**
 * Single HTTP client for the staff app.
 *
 * Convention: callers pass paths WITHOUT the `/api` prefix, e.g.
 * `api.get('/invoices')`. The client adds the prefix (and an optional
 * `VITE_API_URL` origin) exactly once.
 *
 * Every non-2xx response throws an `ApiError`. Nothing in here swallows
 * failures — callers decide how to show them.
 */

const API_ORIGIN = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
const API_BASE = `${API_ORIGIN}/api`;

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** @deprecated kept as an alias for older imports */
export const ApiClientError = ApiError;

export type TokenGetter = () => Promise<string | null>;

export interface RequestOptions {
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  if (path === '/api' || path.startsWith('/api/')) {
    // Guard against the old double-prefix bug (`/api/api/...`).
    throw new Error(`api paths must not include the /api prefix: ${path}`);
  }
  return `${API_BASE}${path}`;
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }

  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; code?: string; details?: unknown };
    throw new ApiError(
      b.error || b.message || `Request failed with status ${res.status}`,
      res.status,
      b.code,
      b.details,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string, token?: string | null, signal?: AbortSignal) =>
    request<T>('GET', path, { token, signal }),
  post: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>('POST', path, { body, token }),
  put: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>('PUT', path, { body, token }),
  patch: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>('PATCH', path, { body, token }),
  delete: <T>(path: string, token?: string | null) =>
    request<T>('DELETE', path, { token }),
};

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    if (err.status === 403) return 'You do not have permission to do this.';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

// ---------------------------------------------------------------------------
// Response envelopes
// ---------------------------------------------------------------------------

export interface Pagination {
  total: number;
  skip?: number;
  take?: number;
  page?: number;
  limit?: number;
  offset?: number;
  totalPages?: number;
}

export interface ListResult<T> {
  items: T[];
  pagination: Pagination | null;
}

/**
 * Normalise the API's list envelopes into `{ items, pagination }`.
 *
 * The API uses several shapes: `{data, pagination}`, `{data, total}`,
 * `{data}`, or a named key such as `{members}` / `{sales}`. A bare array is
 * accepted too. Anything else is a contract error and throws, so the page
 * shows an error state instead of crashing on `.filter is not a function`.
 */
export function unwrapList<T>(body: unknown, key?: string): ListResult<T> {
  if (Array.isArray(body)) {
    return { items: body as T[], pagination: { total: body.length } };
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const k = key ?? 'data';
    const arr = obj[k];
    if (Array.isArray(arr)) {
      const p = obj.pagination as Partial<Pagination> | undefined;
      const total =
        typeof p?.total === 'number'
          ? p.total
          : typeof obj.total === 'number'
            ? (obj.total as number)
            : typeof obj.count === 'number'
              ? (obj.count as number)
              : arr.length;
      return { items: arr as T[], pagination: { ...(p ?? {}), total } };
    }
  }
  throw new ApiError(
    `Unexpected response shape from server${key ? ` (expected "${key}" list)` : ''}`,
    200,
    'UNEXPECTED_SHAPE',
  );
}
