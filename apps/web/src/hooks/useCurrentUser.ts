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
  };
}
