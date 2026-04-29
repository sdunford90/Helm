import { useEffect, useState } from 'react';

// --------------------------------------------------------------------------
// useAdminMe
//
// Fetches the current platform-admin's identity and sub-role from the API.
// The result is cached in a module-level promise so every page can call
// the hook without triggering duplicate network requests.
// --------------------------------------------------------------------------

export type AdminRole = 'SUPERUSER' | 'BILLING_ADMIN' | 'READ_ONLY_SUPPORT';

export interface AdminMe {
  id: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  adminRole: AdminRole | null;
}

let cached: Promise<AdminMe> | null = null;

function fetchMe(): Promise<AdminMe> {
  if (!cached) {
    cached = fetch('/api/admin/me', { headers: { 'Content-Type': 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load /me (${res.status})`);
        return (await res.json()) as AdminMe;
      })
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}

export function useAdminMe(): { me: AdminMe | null; loading: boolean; error: string | null } {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((data) => {
        if (alive) setMe(data);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { me, loading, error };
}

export function isSuperuser(me: AdminMe | null): boolean {
  return me?.adminRole === 'SUPERUSER';
}

export function canMutate(me: AdminMe | null): boolean {
  return me?.adminRole === 'SUPERUSER' || me?.adminRole === 'BILLING_ADMIN';
}

export function adminRoleLabel(role: AdminRole | null | string | undefined): string {
  switch (role) {
    case 'SUPERUSER': return 'Superuser';
    case 'BILLING_ADMIN': return 'Billing Admin';
    case 'READ_ONLY_SUPPORT': return 'Read-only Support';
    default: return role ?? '—';
  }
}
