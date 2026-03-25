import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  execute: (...args: unknown[]) => Promise<T | null>;
  reset: () => void;
}

export function useApi<T>(
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  options?: { immediate?: boolean }
): UseApiReturn<T> {
  const { getToken } = useAuth();
  const [state, setState] = useState<UseApiState<T>>({
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

  const execute = useCallback(
    async (...args: unknown[]): Promise<T | null> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const token = await getToken();
        let result: T;

        if (method === 'get' || method === 'delete') {
          result = await api[method]<T>(path, token);
        } else {
          const body = args[0];
          result = await api[method]<T>(path, body, token);
        }

        if (mountedRef.current) {
          setState({ data: result, loading: false, error: null });
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        if (mountedRef.current) {
          setState({ data: null, loading: false, error: message });
        }
        return null;
      }
    },
    [getToken, method, path]
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  useEffect(() => {
    if (options?.immediate) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, execute, reset };
}
