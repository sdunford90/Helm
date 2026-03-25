/**
 * Shared API client for Helm embeddable widgets.
 *
 * Resolves the base URL and tenant from data-attributes on the host element and
 * provides typed helpers for common HTTP verbs.
 */

const DEFAULT_API_BASE = "https://api.helm.com";

export interface ApiClientOptions {
  /** The Helm tenant / marina ID */
  tenantId: string;
  /** Override the default API base URL */
  apiBase?: string;
}

function resolveApiBase(el: HTMLElement): string {
  return el.dataset.helmApiBase ?? DEFAULT_API_BASE;
}

function resolveTenantId(el: HTMLElement): string {
  const id = el.dataset.helmTenantId ?? el.dataset.tenantId ?? "";
  if (!id) {
    console.warn("[Helm Widget] Missing data-helm-tenant-id on host element.");
  }
  return id;
}

export function createApiClient(hostElement: HTMLElement) {
  const apiBase = resolveApiBase(hostElement);
  const tenantId = resolveTenantId(hostElement);

  async function request<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ data: T | null; error: string | null }> {
    const url = `${apiBase}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(tenantId ? { "x-helm-tenant-id": tenantId } : {}),
      ...(options.headers as Record<string, string>),
    };

    try {
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message =
          (body as Record<string, string>).message ??
          `Request failed (${res.status})`;
        return { data: null, error: message };
      }
      const data = (await res.json()) as T;
      return { data, error: null };
    } catch (err) {
      return {
        data: null,
        error:
          err instanceof Error ? err.message : "An unexpected error occurred",
      };
    }
  }

  return {
    tenantId,
    apiBase,

    get<T = unknown>(path: string) {
      return request<T>(path, { method: "GET" });
    },

    post<T = unknown>(path: string, body: unknown) {
      return request<T>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    put<T = unknown>(path: string, body: unknown) {
      return request<T>(path, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
