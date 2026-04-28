import React, { createContext, useCallback, useContext } from 'react';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';

interface AuthCtx {
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthCtx>({ getToken: async () => null });

export const ClerkAuthBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getToken } = useClerkAuth();
  const value: AuthCtx = { getToken: () => getToken() };
  return React.createElement(AuthContext.Provider, { value }, children);
};

export const NoAuthBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value: AuthCtx = { getToken: async () => null };
  return React.createElement(AuthContext.Provider, { value }, children);
};

export type ApiFetch = <T = unknown>(path: string, init?: RequestInit) => Promise<T>;

export function useApiFetch(): ApiFetch {
  const { getToken } = useContext(AuthContext);
  return useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, { ...init, headers });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }, [getToken]);
}
