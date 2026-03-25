import { useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Anchor,
  Ship,
  Users,
  FileText,
  Download,
  Calendar,
  ArrowRight,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type ReportTab = 'overview' | 'revenue' | 'occupancy' | 'rentals' | 'ar-aging' | 'deferred';

/* ── Mock Data ─────────────────────────────────────────── */

const REVENUE_BY_MONTH = [
  { month: '2026-01', cents: 12450000 },
  { month: '2026-02', cents: 13890000 },
  { month: '2026-03', cents: 15670000 },
];

const REVENUE_BY_METHOD: Record<string, number> = {
  CARD: 9850000,
  ACH: 4200000,
  CASH: 1120000,
  CHARGE_TO_SLIP: 500000,
};

const AR_AGING = {
  current: 4500000,
  days1to30: 1250000,
  days31to60: 450000,
  days61to90: 180000,
  days90plus: 95000,
};

const OCCUPANCY = {
  totalSlips: 120,
  occupied: 98,
  vacant: 12,
  maintenance: 6,
  reserved: 4,
  occupancyRate: 81.67,
};

const RENTAL_STATS = {
  totalBookings: 156,
  completedBookings: 128,
  cancelledBookings: 18,
  noShows: 10,
  revenueCents: 2340000,
  avgBookingCents: 18281,
  npsScore: 72,
};

const DEFERRED = {
  totalDeferredCents: 8500000,
  totalRecognizedCents: 3200000,
  totalRemainingCents: 5300000,
  scheduleCount: 24,
};

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '2px solid #E2E8F0', flexWrap: 'wrap' as const },
  tab: { padding: '10px 16px', fontSize: '14px', fontWeight: 600, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: '-2px', whiteSpace: 'nowrap' as const },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #0A2342' },
  dateRange: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' },
  dateInput: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '6px' },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' },
  metricCard: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  metricLabel: { fontSize: '13px', color: '#64748B', margin: '0 0 4px 0' },
  metricValue: { fontSize: '28px', fontWeight: 700, color: '#0A2342', margin: 0 },
  metricSub: { fontSize: '12px', color: '#64748B', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' },
  card: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '24px' },
  cardTitle: { fontSize: '18px', fontWeight: 600, color: '#0A2342', margin: '0 0 16px 0' },
  table: { width: '100%', borderCollapse: 'collapse' as const, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  th: { backgroundColor: '#0A2342', color: '#FFF', padding: '12px 16px', fontSize: '13px', fontWeight: 600, textAlign: 'left' as const },
  thRight: { backgroundColor: '#0A2342', color: '#FFF', padding: '12px 16px', fontSize: '13px', fontWeight: 600, textAlign: 'right' as const },
  td: { padding: '12px 16px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  tdRight: { padding: '12px 16px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0', textAlign: 'right' as const, fontWeight: 600 },
  barOuter: { height: '24px', background: '#E2E8F0', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' },
  barInner: { height: '100%', borderRadius: '4px', display: 'flex', alignItems: 'center', paddingLeft: '8px', color: '#FFF', fontSize: '12px', fontWeight: 600 },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, lineHeight: '18px' },
  exportBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: '#0A2342', background: '#FFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
};

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

/* ── Component ─────────────────────────────────────────── */

export default function Reports() {
  const [tab, setTab] = useState<ReportTab>('overview');

  const totalRevenue = REVENUE_BY_MONTH.reduce((s, m) => s + m.cents, 0);
  const totalAR = Object.values(AR_AGING).reduce((s, v) => s + v, 0);

  return (
    <div style={s.page}>
      <h1 style={s.title}>Reports</h1>
      <hr style={s.divider} />

      {/* Tabs */}
      <div style={s.tabs}>
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'revenue', label: 'Revenue' },
          { key: 'occupancy', label: 'Occupancy' },
          { key: 'rentals', label: 'Rentals' },
          { key: 'ar-aging', label: 'AR Aging' },
          { key: 'deferred', label: 'Deferred Revenue' },
        ] as { key: ReportTab; label: string }[]).map((t) => (
          <button key={t.key} style={{ ...s.tab, ...(tab === t.key ? s.tabActive : {}) }} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <>
          <div style={s.metricGrid}>
            <div style={s.metricCard}>
              <p style={s.metricLabel}>YTD Revenue</p>
              <p style={s.metricValue}>{fmt(totalRevenue)}</p>
              <p style={s.metricSub}><TrendingUp size={14} color="#1B5E20" /> +12.4% vs last year</p>
            </div>
            <div style={s.metricCard}>
              <p style={s.metricLabel}>Occupancy Rate</p>
              <p style={s.metricValue}>{OCCUPANCY.occupancyRate}%</p>
              <p style={s.metricSub}>{OCCUPANCY.occupied} / {OCCUPANCY.totalSlips} slips</p>
            </div>
            <div style={s.metricCard}>
              <p style={s.metricLabel}>A/R Outstanding</p>
              <p style={s.metricValue}>{fmt(totalAR)}</p>
              <p style={s.metricSub}><TrendingDown size={14} color="#DC2626" /> {fmt(AR_AGING.days90plus)} 90+ days</p>
            </div>
            <div style={s.metricCard}>
              <p style={s.metricLabel}>Rental Bookings</p>
              <p style={s.metricValue}>{RENTAL_STATS.totalBookings}</p>
              <p style={s.metricSub}>NPS: {RENTAL_STATS.npsScore}</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div style={s.card}>
              <h3 style={s.cardTitle}>Revenue by Month</h3>
              {REVENUE_BY_MONTH.map((m) => (
                <div key={m.month} style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                    <span style={{ color: '#64748B' }}>{m.month}</span>
                    <span style={{ fontWeight: 600, color: '#0A2342' }}>{fmt(m.cents)}</span>
                  </div>
                  <div style={s.barOuter}>
                    <div style={{ ...s.barInner, width: `${(m.cents / 20000000) * 100}%`, background: '#0A2342' }}>
                      {fmt(m.cents)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={s.card}>
              <h3 style={s.cardTitle}>Revenue by Payment Method</h3>
              {Object.entries(REVENUE_BY_METHOD).map(([method, cents]) => (
                <div key={method} style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                    <span style={{ color: '#64748B' }}>{method}</span>
                    <span style={{ fontWeight: 600, color: '#0A2342' }}>{fmt(cents)}</span>
                  </div>
                  <div style={s.barOuter}>
                    <div style={{ ...s.barInner, width: `${(cents / totalRevenue) * 100}%`, background: method === 'CARD' ? '#0A2342' : method === 'ACH' ? '#0369A1' : method === 'CASH' ? '#1B5E20' : '#6B21A8' }}>
                      {Math.round((cents / totalRevenue) * 100)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Revenue */}
      {tab === 'revenue' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <div style={s.dateRange}>
              <Calendar size={16} color="#64748B" />
              <input style={s.dateInput} type="date" defaultValue="2026-01-01" />
              <ArrowRight size={16} color="#64748B" />
              <input style={s.dateInput} type="date" defaultValue="2026-03-25" />
            </div>
            <button style={s.exportBtn}><Download size={14} /> Export CSV</button>
          </div>
          <div style={s.metricGrid}>
            <div style={s.metricCard}><p style={s.metricLabel}>Total Revenue</p><p style={s.metricValue}>{fmt(totalRevenue)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Invoices</p><p style={s.metricValue}>{fmt(REVENUE_BY_MONTH.reduce((s, m) => s + m.cents, 0))}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>POS Sales</p><p style={s.metricValue}>{fmt(342500)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Rental Revenue</p><p style={s.metricValue}>{fmt(RENTAL_STATS.revenueCents)}</p></div>
          </div>
          <div style={s.card}>
            <h3 style={s.cardTitle}>Monthly Revenue Breakdown</h3>
            <table style={s.table}>
              <thead><tr><th style={s.th}>Month</th><th style={s.thRight}>Revenue</th><th style={s.thRight}>MoM Change</th></tr></thead>
              <tbody>
                {REVENUE_BY_MONTH.map((m, idx) => {
                  const prev = idx > 0 ? REVENUE_BY_MONTH[idx - 1].cents : m.cents;
                  const change = ((m.cents - prev) / prev) * 100;
                  return (
                    <tr key={m.month} style={{ backgroundColor: idx % 2 === 0 ? '#FFF' : '#D6E8F4' }}>
                      <td style={s.td}>{m.month}</td>
                      <td style={s.tdRight}>{fmt(m.cents)}</td>
                      <td style={{ ...s.tdRight, color: change >= 0 ? '#1B5E20' : '#B71C1C' }}>
                        {idx > 0 ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Occupancy */}
      {tab === 'occupancy' && (
        <>
          <div style={s.metricGrid}>
            <div style={s.metricCard}><p style={s.metricLabel}>Total Slips</p><p style={s.metricValue}>{OCCUPANCY.totalSlips}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Occupied</p><p style={{ ...s.metricValue, color: '#1B5E20' }}>{OCCUPANCY.occupied}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Vacant</p><p style={{ ...s.metricValue, color: '#0369A1' }}>{OCCUPANCY.vacant}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Occupancy Rate</p><p style={s.metricValue}>{OCCUPANCY.occupancyRate}%</p></div>
          </div>
          <div style={s.card}>
            <h3 style={s.cardTitle}>Slip Status Breakdown</h3>
            {[
              { label: 'Occupied', value: OCCUPANCY.occupied, color: '#1B5E20', bg: '#E8F5E9' },
              { label: 'Vacant', value: OCCUPANCY.vacant, color: '#0369A1', bg: '#D6E8F4' },
              { label: 'Maintenance', value: OCCUPANCY.maintenance, color: '#856404', bg: '#FFF3CD' },
              { label: 'Reserved', value: OCCUPANCY.reserved, color: '#6B21A8', bg: '#E8D5F5' },
            ].map((item) => (
              <div key={item.label} style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600, color: item.color }}>{item.label}</span>
                  <span style={{ fontWeight: 600 }}>{item.value} ({Math.round((item.value / OCCUPANCY.totalSlips) * 100)}%)</span>
                </div>
                <div style={s.barOuter}>
                  <div style={{ ...s.barInner, width: `${(item.value / OCCUPANCY.totalSlips) * 100}%`, background: item.color }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Rentals */}
      {tab === 'rentals' && (
        <>
          <div style={s.metricGrid}>
            <div style={s.metricCard}><p style={s.metricLabel}>Total Bookings</p><p style={s.metricValue}>{RENTAL_STATS.totalBookings}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Revenue</p><p style={s.metricValue}>{fmt(RENTAL_STATS.revenueCents)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Avg Booking</p><p style={s.metricValue}>{fmt(RENTAL_STATS.avgBookingCents)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>NPS Score</p><p style={{ ...s.metricValue, color: RENTAL_STATS.npsScore >= 50 ? '#1B5E20' : '#B71C1C' }}>{RENTAL_STATS.npsScore}</p></div>
          </div>
          <div style={s.card}>
            <h3 style={s.cardTitle}>Booking Outcomes</h3>
            <table style={s.table}>
              <thead><tr><th style={s.th}>Status</th><th style={s.thRight}>Count</th><th style={s.thRight}>%</th></tr></thead>
              <tbody>
                {[
                  { status: 'Completed', count: RENTAL_STATS.completedBookings, color: '#E8F5E9', text: '#1B5E20' },
                  { status: 'Cancelled', count: RENTAL_STATS.cancelledBookings, color: '#FDECEA', text: '#B71C1C' },
                  { status: 'No-Show', count: RENTAL_STATS.noShows, color: '#FCE4EC', text: '#880E4F' },
                ].map((item, idx) => (
                  <tr key={item.status} style={{ backgroundColor: idx % 2 === 0 ? '#FFF' : '#D6E8F4' }}>
                    <td style={s.td}><span style={{ ...s.badge, backgroundColor: item.color, color: item.text }}>{item.status}</span></td>
                    <td style={s.tdRight}>{item.count}</td>
                    <td style={s.tdRight}>{Math.round((item.count / RENTAL_STATS.totalBookings) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* AR Aging */}
      {tab === 'ar-aging' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <button style={s.exportBtn}><Download size={14} /> Export CSV</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', marginBottom: '24px' }}>
            {[
              { label: 'Current', cents: AR_AGING.current, color: '#1B5E20' },
              { label: '1-30 Days', cents: AR_AGING.days1to30, color: '#0369A1' },
              { label: '31-60 Days', cents: AR_AGING.days31to60, color: '#856404' },
              { label: '61-90 Days', cents: AR_AGING.days61to90, color: '#C2410C' },
              { label: '90+ Days', cents: AR_AGING.days90plus, color: '#B71C1C' },
            ].map((bucket) => (
              <div key={bucket.label} style={s.metricCard}>
                <p style={s.metricLabel}>{bucket.label}</p>
                <p style={{ ...s.metricValue, color: bucket.color, fontSize: '22px' }}>{fmt(bucket.cents)}</p>
              </div>
            ))}
          </div>
          <div style={s.card}>
            <h3 style={s.cardTitle}>Total Outstanding: {fmt(totalAR)}</h3>
            <div style={{ ...s.barOuter, height: '32px' }}>
              <div style={{ display: 'flex', height: '100%' }}>
                {[
                  { cents: AR_AGING.current, color: '#1B5E20' },
                  { cents: AR_AGING.days1to30, color: '#0369A1' },
                  { cents: AR_AGING.days31to60, color: '#F59E0B' },
                  { cents: AR_AGING.days61to90, color: '#C2410C' },
                  { cents: AR_AGING.days90plus, color: '#B71C1C' },
                ].map((b, i) => (
                  <div key={i} style={{ width: `${(b.cents / totalAR) * 100}%`, background: b.color, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: '11px', fontWeight: 600 }}>
                    {Math.round((b.cents / totalAR) * 100)}%
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Deferred Revenue */}
      {tab === 'deferred' && (
        <>
          <div style={s.metricGrid}>
            <div style={s.metricCard}><p style={s.metricLabel}>Total Deferred</p><p style={s.metricValue}>{fmt(DEFERRED.totalDeferredCents)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Recognized</p><p style={{ ...s.metricValue, color: '#1B5E20' }}>{fmt(DEFERRED.totalRecognizedCents)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Remaining</p><p style={{ ...s.metricValue, color: '#0369A1' }}>{fmt(DEFERRED.totalRemainingCents)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Active Schedules</p><p style={s.metricValue}>{DEFERRED.scheduleCount}</p></div>
          </div>
          <div style={s.card}>
            <h3 style={s.cardTitle}>Recognition Progress</h3>
            <div style={{ ...s.barOuter, height: '32px' }}>
              <div style={{ display: 'flex', height: '100%' }}>
                <div style={{ width: `${(DEFERRED.totalRecognizedCents / DEFERRED.totalDeferredCents) * 100}%`, background: '#1B5E20', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: '12px', fontWeight: 600 }}>
                  Recognized ({Math.round((DEFERRED.totalRecognizedCents / DEFERRED.totalDeferredCents) * 100)}%)
                </div>
                <div style={{ flex: 1, background: '#0369A1', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: '12px', fontWeight: 600 }}>
                  Remaining ({Math.round((DEFERRED.totalRemainingCents / DEFERRED.totalDeferredCents) * 100)}%)
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
