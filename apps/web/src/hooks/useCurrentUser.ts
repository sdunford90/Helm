import { useApi } from './useApi';

export interface CurrentUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  active: boolean;
}

export interface CurrentUserResult {
  user: CurrentUser | null;
  permissions: string[];
  loading: boolean;
  can: (permission: string) => boolean;
  isAtLeastManager: boolean;
  // Tighter gate than Manager: only the owner / tenant admin can touch
  // things like per-product tax overrides, GL pin changes, role assignments.
  isAtLeastAdmin: boolean;
}

export function useCurrentUser(): CurrentUserResult {
  const { data, loading } = useApi<{ user: CurrentUser; permissions: string[] }>(
    'get',
    '/api/auth/me',
    { immediate: true },
  );

  const user = data?.user ?? null;
  const permissions = data?.permissions ?? [];

  return {
    user,
    permissions,
    loading,
    can: (permission: string) => permissions.includes(permission),
    isAtLeastManager: !!(user && ['MARINA_OWNER', 'MARINA_MANAGER', 'TENANT_ADMIN', 'PLATFORM_ADMIN'].includes(user.role)),
    isAtLeastAdmin: !!(user && ['MARINA_OWNER', 'TENANT_ADMIN', 'PLATFORM_ADMIN'].includes(user.role)),
  };
}
