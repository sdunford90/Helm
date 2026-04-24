import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';

type Method = 'get' | 'post' | 'put' | 'delete';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function usePortalApi<T>(
  method: Method,
  path: string,
  options?: { immediate?: boolean },
): State<T> & {
  execute: (body?: unknown) => Promise<T | null>;
} {
  const { getToken } = useAuth();
  const [state, setState] = useState<State<T>>({
    data: null,
    loading: options?.immediate ?? false,
    error: null,
  });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function execute(body?: unknown): Promise<T | null> {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const token = await getToken();
      const res = await fetch(path, {
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: method === 'get' || method === 'delete' ? undefined : JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const errBody = await res.json();
          if (errBody?.error) message = errBody.error;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      const data = (await res.json()) as T;
      if (mountedRef.current) setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (mountedRef.current) setState({ data: null, loading: false, error: message });
      return null;
    }
  }

  useEffect(() => {
    if (options?.immediate) void execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, execute };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
