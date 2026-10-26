/**
 * HTTP client for the platform-admin app.
 *
 * Callers pass paths relative to the admin API, e.g. `adminFetch('/tenants')`.
 * The client adds `${VITE_API_URL}/api/admin` exactly once and attaches the
 * Clerk session token (registered by <AuthTokenBridge/> in main.tsx).
 *
 * Every non-2xx response throws an `ApiError`; nothing here swallows failures.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const API_ORIGIN = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
const ADMIN_BASE = `${API_ORIGIN}/api/admin`;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;

/** Registered once from inside <ClerkProvider>. */
export function setTokenGetter(fn: TokenGetter) {
  getToken = fn;
}

export async function adminFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  if (path.startsWith('/api')) {
    throw new Error(`adminFetch paths must not include the /api/admin prefix: ${path}`);
  }
  const token = await getToken().catch(() => null);
  let res: Response;
  try {
    res = await fetch(`${ADMIN_BASE}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const b = (body && typeof body === 'object' ? body : {}) as { error?: string; message?: string; code?: string };
    const message =
      b.error || b.message ||
      (res.status === 401 ? 'You are not signed in.' : res.status === 403 ? 'Platform admin access is required.' : `Request failed (${res.status})`);
    throw new ApiError(message, res.status, b.code);
  }
  return body as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Fetch a resource from the admin API. `path = null` skips the request. */
export function useAdminResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const mySeq = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const body = await adminFetch<T>(path);
      if (mySeq !== seq.current) return;
      setData(body);
      setStatus(200);
    } catch (err) {
      if (mySeq !== seq.current) return;
      setData(null);
      setError(errorMessage(err));
      setStatus(err instanceof ApiError ? err.status : null);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, status, refetch: load };
}
