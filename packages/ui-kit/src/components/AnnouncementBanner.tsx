import React, { CSSProperties, useEffect, useState } from 'react';

// A12 — Platform announcement banner.
//
// Mounted at the top of every app's chrome. Polls /api/platform-announcements/active
// once per minute, renders any active+matching+not-dismissed rows as a stack
// of dismissable banners. Severity drives color: INFO blue, WARNING amber,
// MAINTENANCE red.

export interface Announcement {
  id: string;
  severity: 'INFO' | 'WARNING' | 'MAINTENANCE' | string;
  title: string;
  body: string;
  link: string | null;
  dismissable: boolean;
}

interface ApiResponse {
  announcements: Announcement[];
}

const REFRESH_MS = 60_000;

function severityColors(severity: string): { background: string; border: string; color: string; iconColor: string } {
  if (severity === 'WARNING') {
    return { background: '#FEF3C7', border: '#FBBF24', color: '#78350F', iconColor: '#92400E' };
  }
  if (severity === 'MAINTENANCE') {
    return { background: '#FEE2E2', border: '#FCA5A5', color: '#991B1B', iconColor: '#B91C1C' };
  }
  return { background: '#DBEAFE', border: '#93C5FD', color: '#1E40AF', iconColor: '#1D4ED8' };
}

function severityIcon(severity: string): string {
  if (severity === 'WARNING') return '⚠';
  if (severity === 'MAINTENANCE') return '🛠';
  return 'ⓘ';
}

interface Props {
  /**
   * Auth-token getter. The hosting app provides this so the banner can
   * call /api/platform-announcements/active behind Clerk.
   */
  getToken?: () => Promise<string | null>;
}

export const AnnouncementBanner: React.FC<Props> = ({ getToken }) => {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchActive = async () => {
      try {
        const token = getToken ? await getToken() : null;
        const res = await fetch('/api/platform-announcements/active', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const body: ApiResponse = await res.json();
        if (!cancelled) setItems(body.announcements ?? []);
      } catch {
        // best-effort; banners are decoration, not critical path
      }
    };

    void fetchActive();
    timer = setInterval(fetchActive, REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [getToken]);

  async function dismiss(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
    try {
      const token = getToken ? await getToken() : null;
      await fetch(`/api/platform-announcements/${id}/dismiss`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // optimistic — leave it dismissed locally even if the API call fails
    }
  }

  if (items.length === 0) return null;

  return (
    <div style={{ position: 'relative', zIndex: 200 }}>
      {items.map((a) => {
        const tones = severityColors(a.severity);
        const row: CSSProperties = {
          background: tones.background,
          borderBottom: `1px solid ${tones.border}`,
          color: tones.color,
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          fontSize: 13,
          lineHeight: 1.45,
        };
        return (
          <div key={a.id} role="status" style={row}>
            <span style={{ fontSize: 16, color: tones.iconColor, lineHeight: '20px' }}>{severityIcon(a.severity)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontWeight: 700 }}>{a.title}</strong>
              {a.body && <span style={{ marginLeft: 8 }}>{a.body}</span>}
              {a.link && (
                <a href={a.link} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: tones.iconColor, fontWeight: 600 }}>
                  Learn more →
                </a>
              )}
            </div>
            {a.dismissable && (
              <button
                onClick={() => dismiss(a.id)}
                aria-label="Dismiss"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: tones.iconColor, fontSize: 18, lineHeight: '20px',
                  padding: '0 4px', flexShrink: 0,
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

AnnouncementBanner.displayName = 'AnnouncementBanner';
