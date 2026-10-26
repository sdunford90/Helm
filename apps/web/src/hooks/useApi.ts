import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api, ApiError, errorMessage, unwrapList, type Pagination } from '../lib/api';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Authenticated API client. Use this instead of raw `fetch` so the Clerk
 * session token is always attached. Paths are passed WITHOUT `/api`.
 * Every method throws `ApiError` on a non-2xx response.
 */
export function useApiClient() {
  const { getToken } = useAuth();
  return useMemo(
    () => ({
      get: async <T>(path: string, signal?: AbortSignal) => api.get<T>(path, await getToken(), signal),
      post: async <T>(path: string, body?: unknown) => api.post<T>(path, body, await getToken()),
      put: async <T>(path: string, body?: unknown) => api.put<T>(path, body, await getToken()),
      patch: async <T>(path: string, body?: unknown) => api.patch<T>(path, body, await getToken()),
      delete: async <T>(path: string) => api.delete<T>(path, await getToken()),
    }),
    [getToken],
  );
}

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  /**
   * Run the request. Resolves with the response body on 2xx and REJECTS with
   * an `ApiError` otherwise — callers must only show success after it
   * resolves.
   */
  execute: (body?: unknown) => Promise<T>;
  reset: () => void;
}

/**
 * Low-level request hook, mainly for mutations. For reads prefer `useList`
 * (list envelopes) or `useResource` (single records).
 */
export function useApi<T>(
  method: Method,
  path: string,
  options?: { immediate?: boolean },
): UseApiReturn<T> {
  const client = useApiClient();
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: options?.immediate ?? false,
    error: null,
  });
  const mountedRef = useRef(true);
  const seqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async (body?: unknown): Promise<T> => {
      const seq = ++seqRef.current;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result =
          method === 'get' || method === 'delete'
            ? await client[method]<T>(path)
            : await client[method]<T>(path, body);
        if (mountedRef.current && seq === seqRef.current) {
          setState({ data: result, loading: false, error: null });
        }
        return result;
      } catch (err) {
        if (mountedRef.current && seq === seqRef.current) {
          setState({ data: null, loading: false, error: errorMessage(err) });
        }
        throw err;
      }
    },
    [client, method, path],
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  useEffect(() => {
    if (options?.immediate) {
      execute().catch(() => {
        /* error is in state */
      });
    }
    // Re-run when the path changes (e.g. /customers/:id navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, options?.immediate]);

  return { ...state, execute, reset };
}

// ---------------------------------------------------------------------------
// Typed read hooks
// ---------------------------------------------------------------------------

interface FetchState<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  code: string | null;
}

function useFetch<T>(path: string | null, transform: (body: unknown) => T) {
  const client = useApiClient();
  const [state, setState] = useState<FetchState<T>>({
    value: null,
    loading: path !== null,
    error: null,
    status: null,
    code: null,
  });
  const [nonce, setNonce] = useState(0);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  useEffect(() => {
    if (path === null) {
      setState({ value: null, loading: false, error: null, status: null, code: null });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null, status: null, code: null }));
    client
      .get<unknown>(path, ctrl.signal)
      .then((body) => {
        if (ctrl.signal.aborted) return;
        try {
          const value = transformRef.current(body);
          setState({ value, loading: false, error: null, status: 200, code: null });
        } catch (err) {
          setState({ value: null, loading: false, error: errorMessage(err), status: 200, code: 'UNEXPECTED_SHAPE' });
        }
      })
      .catch((err) => {
        if (ctrl.signal.aborted || (err as Error)?.name === 'AbortError') return;
        setState({
          value: null,
          loading: false,
          error: errorMessage(err),
          status: err instanceof ApiError ? err.status : null,
          code: err instanceof ApiError ? err.code ?? null : null,
        });
      });
    return () => ctrl.abort();
  }, [client, path, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refetch };
}

export interface UseListReturn<T> {
  items: T[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;
  /** HTTP status of the failure, if any (403, 404, 503...). */
  status: number | null;
  /** API error code of the failure, e.g. MODULE_DISABLED. */
  code: string | null;
  refetch: () => void;
}

/**
 * Fetch a list endpoint and unwrap its envelope. `items` is ALWAYS an array.
 *
 * @param path  path without `/api`, or null to skip
 * @param opts.key  envelope key holding the array (default `data`)
 * @param opts.map  DTO -> view-model mapper applied to every item
 */
export function useList<T, R = T>(
  path: string | null,
  opts?: { key?: string; map?: (raw: R) => T },
): UseListReturn<T> {
  const key = opts?.key;
  const map = opts?.map;
  const mapRef = useRef(map);
  mapRef.current = map;
  const { value, refetch, ...rest } = useFetch(path, (body) => {
    const { items, pagination } = unwrapList<R>(body, key);
    const m = mapRef.current;
    return { items: m ? items.map(m) : (items as unknown as T[]), pagination };
  });
  return {
    items: value?.items ?? EMPTY,
    pagination: value?.pagination ?? null,
    loading: rest.loading,
    error: rest.error,
    status: rest.status,
    code: rest.code,
    refetch,
  };
}

const EMPTY: never[] = [];

export interface UseResourceReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  code: string | null;
  notFound: boolean;
  refetch: () => void;
}

/** Fetch a single record (or report object). 404 is reported as `notFound`. */
export function useResource<T, R = T>(
  path: string | null,
  opts?: { map?: (raw: R) => T },
): UseResourceReturn<T> {
  const mapRef = useRef(opts?.map);
  mapRef.current = opts?.map;
  const { value, refetch, ...rest } = useFetch<T>(path, (body) => {
    if (body === null || body === undefined || typeof body !== 'object') {
      throw new ApiError('Unexpected response shape from server', 200, 'UNEXPECTED_SHAPE');
    }
    const m = mapRef.current;
    return m ? m(body as R) : (body as T);
  });
  return {
    data: value,
    loading: rest.loading,
    error: rest.error,
    status: rest.status,
    code: rest.code,
    notFound: rest.status === 404,
    refetch,
  };
}
