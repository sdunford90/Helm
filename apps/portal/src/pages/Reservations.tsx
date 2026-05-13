import type { CSSProperties } from 'react';
import { Calendar, Ship } from 'lucide-react';
import { usePortalApi, formatCents, formatDate } from '../lib/api';

const NAVY = '#0A2342';

interface ReservationItem {
  kind: 'rental' | 'transient';
  id: string;
  title: string;
  subtitle: string | null;
  status: string;
  startAt: string;
  endAt: string | null;
  totalCents: number;
}

interface ReservationsData {
  upcoming: ReservationItem[];
  past: ReservationItem[];
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const STATUS_TONE: Record<string, { bg: string; color: string; label: string }> = {
  BOOKED: { bg: '#DBEAFE', color: '#1E40AF', label: 'Booked' },
  CONFIRMED: { bg: '#DBEAFE', color: '#1E40AF', label: 'Confirmed' },
  PENDING: { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  CHECKED_IN: { bg: '#DCFCE7', color: '#166534', label: 'Checked in' },
  CHECKED_OUT: { bg: '#F1F5F9', color: '#475569', label: 'Checked out' },
  COMPLETED: { bg: '#F1F5F9', color: '#475569', label: 'Completed' },
  CANCELLED: { bg: '#FEE2E2', color: '#991B1B', label: 'Cancelled' },
  OVERSTAY: { bg: '#FEE2E2', color: '#991B1B', label: 'Overstay' },
};

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? { bg: '#F1F5F9', color: '#475569', label: status };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, background: tone.bg, color: tone.color,
    }}>
      {tone.label}
    </span>
  );
}

function ReservationRow({ item }: { item: ReservationItem }) {
  const Icon = item.kind === 'rental' ? Ship : Calendar;
  return (
    <div style={{
      padding: '14px 18px',
      display: 'grid',
      gridTemplateColumns: '32px 1fr auto auto',
      gap: 16,
      alignItems: 'center',
      borderTop: '1px solid #F1F5F9',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'rgba(0,212,255,0.10)', color: NAVY,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} />
      </div>
      <div>
        <div style={{ fontWeight: 600, color: NAVY, fontSize: 14 }}>{item.title}</div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
          {item.subtitle ? `${item.subtitle} · ` : ''}
          {formatDate(item.startAt)}
          {item.endAt ? ` — ${formatDate(item.endAt)}` : ''}
        </div>
      </div>
      <StatusBadge status={item.status} />
      <div style={{ fontWeight: 600, color: NAVY, fontSize: 14 }}>{formatCents(item.totalCents)}</div>
    </div>
  );
}

export default function Reservations() {
  const { data, loading, error } = usePortalApi<ReservationsData>('get', '/api/portal/reservations', { immediate: true });

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: NAVY, marginTop: 0, marginBottom: 20 }}>
        My reservations
      </h1>

      {error && (
        <div style={{ ...card, color: '#991B1B', background: '#FEE2E2', marginBottom: 16 }}>
          {error}
        </div>
      )}
      {loading && !data && (
        <div style={{ ...card, color: '#64748B' }}>Loading…</div>
      )}

      {data && (
        <>
          <section style={{ ...card, padding: 0, marginBottom: 20 }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Upcoming ({data.upcoming.length})
              </div>
            </div>
            {data.upcoming.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                Nothing booked. Browse rentals on the main site to book.
              </div>
            ) : (
              data.upcoming.map((it) => <ReservationRow key={`${it.kind}-${it.id}`} item={it} />)
            )}
          </section>

          <section style={{ ...card, padding: 0 }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Past ({data.past.length})
              </div>
            </div>
            {data.past.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                No past reservations.
              </div>
            ) : (
              data.past.slice(0, 50).map((it) => <ReservationRow key={`${it.kind}-${it.id}`} item={it} />)
            )}
            {data.past.length > 50 && (
              <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>
                Showing the 50 most recent.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
