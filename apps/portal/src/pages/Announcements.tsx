import { useState, useEffect } from 'react';
import { Megaphone, AlertTriangle, Calendar, Circle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { usePortalApi } from '../lib/api';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

interface Announcement {
  id: string;
  title: string;
  body: string;
  date: string;
  category: string;
  urgent: boolean;
  unread: boolean;
}

const categoryColors: Record<string, string> = {
  Maintenance: '#8B5CF6',
  Operations: '#3B82F6',
  Emergency: '#DC2626',
  Events: '#F59E0B',
  Policy: '#64748B',
  Improvements: '#0D9F6E',
  Compliance: '#D97706',
};

export default function Announcements() {
  const { data, loading, error, execute } = usePortalApi<Announcement[]>(
    'get',
    '/api/portal/announcements',
    { immediate: true },
  );

  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    if (data) setItems(data);
  }, [data]);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Announcements</h1>
        <p style={{ color: '#64748B', fontSize: 14 }}>Stay up to date with marina news and updates.</p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748B' }}>Loading announcements...</div>
      )}

      {error && (
        <div style={{ ...card, textAlign: 'center', padding: 32, color: '#DC2626' }}>
          Failed to load announcements.
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <Megaphone size={40} color="#94A3B8" style={{ marginBottom: 12 }} />
          <p style={{ color: '#64748B', fontSize: 14 }}>No announcements yet.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((a) => (
          <div
            key={a.id}
            style={{
              ...card,
              borderLeft: a.urgent ? '4px solid #DC2626' : a.unread ? `4px solid ${CYAN}` : '4px solid transparent',
              background: a.urgent ? '#FFF5F5' : '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {a.urgent ? (
                  <AlertTriangle size={18} color="#DC2626" />
                ) : (
                  <Megaphone size={18} color={categoryColors[a.category] || '#64748B'} />
                )}
                <h3 style={{ fontSize: 16, fontWeight: 600, color: a.urgent ? '#DC2626' : NAVY, margin: 0 }}>
                  {a.title}
                </h3>
                {a.unread && (
                  <Circle
                    size={8}
                    fill={CYAN}
                    color={CYAN}
                    style={{ flexShrink: 0 }}
                  />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    background: `${categoryColors[a.category] || '#64748B'}18`,
                    color: categoryColors[a.category] || '#64748B',
                  }}
                >
                  {a.category}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 12px 0' }}>
              {a.body}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94A3B8' }}>
              <Calendar size={12} />
              {a.date}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
