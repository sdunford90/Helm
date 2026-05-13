import React, { CSSProperties, useEffect, useRef, useState } from 'react';

// Plan 17 — Notification bell.
//
// Mounted in each app's top bar. Polls a configurable endpoint every 60s
// for the current user's unread + recent notifications. Renders a button
// with the unread count badge; click opens a dropdown panel of items.
// Each app passes its own `endpointBase` so the bell hits the right path
// (web/admin → /api/notifications, portal → /api/portal/notifications).

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

interface ApiResponse {
  unread: NotificationItem[];
  recent: NotificationItem[];
  unreadCount: number;
}

export interface NotificationBellProps {
  /** Base endpoint without trailing slash (e.g. "/api/notifications"). */
  endpointBase: string;
  /** Function that returns a Clerk auth token. Mirror of getToken from useAuth. */
  getToken?: () => Promise<string | null>;
  /** Optional brand color for the badge. Defaults to red. */
  badgeColor?: string;
  /** Optional dark/light theme. "dark" inverts the icon color for navy backgrounds. */
  theme?: 'light' | 'dark';
}

const REFRESH_MS = 60_000;

const buttonStyle: CSSProperties = {
  position: 'relative',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
  padding: 6,
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  width: 360,
  maxHeight: 480,
  overflowY: 'auto',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 10,
  boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
  zIndex: 200,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 14px',
  borderBottom: '1px solid #E2E8F0',
  fontWeight: 700,
  color: '#0A2342',
};

const itemStyle: CSSProperties = {
  display: 'block',
  padding: '12px 14px',
  borderBottom: '1px solid #F1F5F9',
  textDecoration: 'none',
  color: '#0A2342',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NotificationBell({ endpointBase, getToken, badgeColor = '#DC2626', theme = 'light' }: NotificationBellProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const fetchAuth = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (getToken) {
      const token = await getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(path, { ...init, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  };

  const refresh = async () => {
    try {
      const next = await fetchAuth<ApiResponse>(endpointBase);
      setData(next);
    } catch { /* swallow — bell stays at last known state */ }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointBase]);

  // Close panel on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await fetchAuth(`${endpointBase}/${id}/read`, { method: 'POST' });
      await refresh();
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await fetchAuth(`${endpointBase}/read-all`, { method: 'POST' });
      await refresh();
    } catch { /* ignore */ }
  };

  const unreadCount = data?.unreadCount ?? 0;
  const iconColor = theme === 'dark' ? '#FFFFFF' : '#0A2342';

  const items = open
    ? [...(data?.unread ?? []), ...(data?.recent ?? [])]
    : [];

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        aria-label={`Notifications (${unreadCount} unread)`}
        style={buttonStyle}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: 0,
            right: 0,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            background: badgeColor,
            color: '#FFFFFF',
            borderRadius: 8,
            fontSize: 10,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={panelStyle}>
          <div style={headerStyle}>
            <span style={{ fontSize: 14 }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  background: 'transparent', border: 0, color: '#0EA5E9',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              You're all caught up.
            </div>
          ) : (
            items.map((n) => {
              const isUnread = !n.readAt;
              const body = (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ fontWeight: isUnread ? 700 : 500, fontSize: 13 }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap' }}>{timeAgo(n.createdAt)}</div>
                  </div>
                  {n.body && <div style={{ fontSize: 12, color: '#475569' }}>{n.body}</div>}
                </div>
              );
              const wrap: CSSProperties = {
                ...itemStyle,
                background: isUnread ? '#F0F9FF' : '#FFFFFF',
              };
              if (n.linkUrl) {
                return (
                  <a key={n.id} href={n.linkUrl} style={wrap} onClick={() => { void markRead(n.id); }}>
                    {body}
                  </a>
                );
              }
              return (
                <div key={n.id} style={{ ...wrap, cursor: 'pointer' }} onClick={() => { void markRead(n.id); }}>
                  {body}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
