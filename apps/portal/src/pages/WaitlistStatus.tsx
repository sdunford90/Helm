import { Clock, Users, MapPin, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { usePortalApi, formatDate } from '../lib/api';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

interface WaitlistEntry {
  id: string;
  slipType: string | null;
  boatLength: number | null;
  queuePosition: number;
  status: string;
  createdAt: string;
  notifiedAt: string | null;
  holdExpiresAt: string | null;
}

export default function WaitlistStatus() {
  const { data, loading, error } = usePortalApi<WaitlistEntry[]>(
    'get',
    '/api/portal/waitlist',
    { immediate: true },
  );

  if (loading) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Waitlist</h1>
        </div>
        <div style={{ textAlign: 'center', padding: 48, color: '#64748B' }}>Loading waitlist...</div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Waitlist</h1>
          <p style={{ color: '#64748B', fontSize: 14 }}>You are not currently on any waitlist.</p>
        </div>
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <Users size={48} color="#94A3B8" style={{ marginBottom: 16 }} />
          <h2 style={{ fontSize: 20, fontWeight: 600, color: NAVY, marginBottom: 8 }}>No Active Waitlist</h2>
          <p style={{ color: '#64748B', fontSize: 14, maxWidth: 400, margin: '0 auto 20px' }}>
            Interested in a slip? Contact the marina office to be added to the waitlist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Waitlist Status</h1>
        <p style={{ color: '#64748B', fontSize: 14 }}>Track your position on the slip waitlist.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {data.map((entry) => (
          <div key={entry.id}>
            <div
              style={{
                ...card,
                marginBottom: 0,
                background: `linear-gradient(135deg, ${NAVY} 0%, #0F3460 100%)`,
                color: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#A0AEC0', fontWeight: 500, marginBottom: 8 }}>Your Position</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 56, fontWeight: 800, color: CYAN, lineHeight: 1 }}>#{entry.queuePosition}</span>
                    <span style={{ fontSize: 16, color: '#A0AEC0' }}>in queue</span>
                  </div>
                  {entry.slipType && (
                    <div style={{ fontSize: 15, marginTop: 8 }}>
                      for <strong>{entry.slipType}{entry.boatLength ? ` (${entry.boatLength} ft)` : ''}</strong>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <MapPin size={16} color="#A0AEC0" />
                    <div>
                      <div style={{ fontSize: 12, color: '#A0AEC0' }}>Joined</div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{formatDate(entry.createdAt)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Clock size={16} color="#A0AEC0" />
                    <div>
                      <div style={{ fontSize: 12, color: '#A0AEC0' }}>Status</div>
                      <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{entry.status.toLowerCase().replace('_', ' ')}</div>
                    </div>
                  </div>
                  {entry.holdExpiresAt && (
                    <div style={{ marginTop: 12, padding: '6px 12px', background: 'rgba(255,193,7,0.2)', borderRadius: 8, fontSize: 12, color: '#FCD34D' }}>
                      Hold expires {formatDate(entry.holdExpiresAt)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
