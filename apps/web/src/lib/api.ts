const API_BASE = '';

class ApiClientError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

// Global Clerk token getter, registered once at app bootstrap. Lets every
// `api.*` call fall back to the user's current Clerk session token when no
// token is passed explicitly, so call sites don't have to thread `getToken`
// through every component. Without this, raw `api.get(...)` calls 302 to the
// SPA index in production and JSON.parse fails silently.
type TokenGetter = () => Promise<string | null>;
let globalTokenGetter: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter | null) {
  globalTokenGetter = getter;
}

async function resolveToken(explicit?: string | null): Promise<string | null> {
  if (explicit !== undefined) return explicit;
  if (!globalTokenGetter) return null;
  try {
    return await globalTokenGetter();
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const resolved = await resolveToken(token);
  if (resolved) {
    headers['Authorization'] = `Bearer ${resolved}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    const parsed = error as { error?: string; code?: string };
    throw new ApiClientError(
      parsed.error || `Request failed with status ${res.status}`,
      res.status,
      parsed.code,
    );
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, token?: string | null) =>
    request<T>(path, { method: 'GET' }, token),

  post: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }, token),

  put: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }, token),

  patch: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }, token),

  delete: <T>(path: string, token?: string | null) =>
    request<T>(path, { method: 'DELETE' }, token),
};

export { ApiClientError };
