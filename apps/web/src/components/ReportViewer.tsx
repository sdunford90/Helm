import { useState } from 'react';
import { X, Download, Printer, ChevronDown, ChevronUp } from 'lucide-react';

/* ── Styles ─────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.55)', zIndex: 1200, display: 'flex', justifyContent: 'flex-end' },
  panel: { width: '88vw', maxWidth: '1100px', height: '100vh', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 40px rgba(0,0,0,0.2)', overflowY: 'auto' },
  header: { padding: '20px 28px', backgroundColor: '#0A2342', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  headerTitle: { fontSize: '20px', fontWeight: 700, margin: 0, color: '#FFFFFF' },
  headerSub: { fontSize: '13px', color: '#94A3B8', marginTop: '2px' },
  headerActions: { display: 'flex', gap: '10px', alignItems: 'center' },
  actionBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' },
  closeBtn: { background: 'none', border: 'none', color: '#FFFFFF', cursor: 'pointer', padding: '4px', opacity: 0.8 },
  body: { flex: 1, padding: '28px', overflowY: 'auto' },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '28px' },
  kpiCard: { background: '#FFFFFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  kpiLabel: { fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '6px' },
  kpiValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  kpiSub: { fontSize: '12px', color: '#94A3B8', marginTop: '2px' },
  section: { background: '#FFFFFF', borderRadius: '10px', border: '1px solid #E2E8F0', marginBottom: '24px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  sectionHeader: { padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 16px', backgroundColor: '#F8FAFC', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  thRight: { textAlign: 'right' as const, padding: '10px 16px', backgroundColor: '#F8FAFC', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  td: { padding: '10px 16px', color: '#0A2342', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' as const },
  tdRight: { padding: '10px 16px', color: '#0A2342', borderBottom: '1px solid #F1F5F9', textAlign: 'right' as const, fontFamily: '"JetBrains Mono", monospace', verticalAlign: 'middle' as const },
  tdMuted: { padding: '10px 16px', color: '#64748B', borderBottom: '1px solid #F1F5F9', fontSize: '12px', verticalAlign: 'middle' as const },
  totalRow: { backgroundColor: '#F0F9FF' },
  badge: (color: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700, backgroundColor: color === 'green' ? 'rgba(16,185,129,0.1)' : color === 'red' ? 'rgba(239,68,68,0.1)' : color === 'yellow' ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.15)', color: color === 'green' ? '#059669' : color === 'red' ? '#DC2626' : color === 'yellow' ? '#D97706' : '#475569' }),
  dateRange: { fontSize: '12px', color: '#94A3B8', marginTop: '2px' },
};

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

/* ── Report-specific renderers ──────────────────────────── */

function RevenueSummary() {
  const rows = [
    { cat: 'Slip Rentals', mtd: 89420, prev: 86100, ytd: 261480 },
    { cat: 'Transient Dockage', mtd: 12340, prev: 9870, ytd: 31250 },
    { cat: 'Boat Rentals', mtd: 18650, prev: 15200, ytd: 52900 },
    { cat: 'POS / Ship Store', mtd: 8920, prev: 7540, ytd: 24310 },
    { cat: 'Fuel Sales', mtd: 34100, prev: 28900, ytd: 95600 },
    { cat: 'Concierge Services', mtd: 3210, prev: 2890, ytd: 8740 },
    { cat: 'Launch Ramp Fees', mtd: 1540, prev: 1200, ytd: 4120 },
    { cat: 'Late Fees & Other', mtd: 2100, prev: 1800, ytd: 6300 },
  ];
  const total = rows.reduce((s, r) => ({ mtd: s.mtd + r.mtd, prev: s.prev + r.prev, ytd: s.ytd + r.ytd }), { mtd: 0, prev: 0, ytd: 0 });
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'MTD Revenue', v: fmt(total.mtd) }, { l: 'Prior Month', v: fmt(total.prev) }, { l: 'YTD Revenue', v: fmt(total.ytd) }, { l: 'MoM Growth', v: pct(((total.mtd - total.prev) / total.prev) * 100) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Revenue by Category</h3><span style={s.dateRange}>March 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Category</th><th style={s.thRight}>MTD</th><th style={s.thRight}>Prior Month</th><th style={s.thRight}>YTD</th><th style={s.thRight}>MoM Δ</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat}><td style={s.td}>{r.cat}</td><td style={s.tdRight}>{fmt(r.mtd)}</td><td style={s.tdRight}>{fmt(r.prev)}</td><td style={s.tdRight}>{fmt(r.ytd)}</td><td style={s.tdRight}><span style={s.badge(r.mtd >= r.prev ? 'green' : 'red')}>{r.mtd >= r.prev ? '+' : ''}{pct(((r.mtd - r.prev) / r.prev) * 100)}</span></td></tr>
            ))}
            <tr style={s.totalRow}><td style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(total.mtd)}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(total.prev)}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(total.ytd)}</td><td style={{ ...s.tdRight, fontWeight: 700 }}><span style={s.badge('green')}>{pct(((total.mtd - total.prev) / total.prev) * 100)}</span></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function ARAgingReport() {
  const rows = [
    { customer: 'Blue Water Excursions', current: 0, d30: 4810, d60: 4810, d90: 0, d120: 0, total: 9620, status: 'Overdue' },
    { customer: 'Robert Dockside', current: 1742, d30: 0, d60: 0, d90: 0, d120: 0, total: 1742, status: 'Current' },
    { customer: 'Coastal Charters LLC', current: 3950, d30: 3950, d60: 0, d90: 0, d120: 0, total: 7900, status: 'Overdue' },
    { customer: 'Amy Portview', current: 990, d30: 0, d60: 0, d90: 0, d120: 0, total: 990, status: 'Current' },
    { customer: 'Derek Harborview', current: 0, d30: 0, d60: 2200, d90: 0, d120: 0, total: 2200, status: 'Overdue' },
    { customer: 'Pacific Marine LLC', current: 0, d30: 0, d60: 0, d90: 3600, d120: 1800, total: 5400, status: 'Collections' },
  ];
  const buckets = ['current', 'd30', 'd60', 'd90', 'd120'] as const;
  const totals = buckets.reduce((acc, b) => ({ ...acc, [b]: rows.reduce((s, r) => s + r[b], 0) }), {} as Record<string, number>);
  totals['total'] = rows.reduce((s, r) => s + r.total, 0);
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total Outstanding', v: fmt(totals['total'] as number) }, { l: '30+ Days', v: fmt(rows.reduce((s, r) => s + r.d30 + r.d60 + r.d90 + r.d120, 0)) }, { l: '90+ Days', v: fmt(rows.reduce((s, r) => s + r.d90 + r.d120, 0)) }, { l: 'Accounts', v: String(rows.length) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Accounts Receivable Aging</h3><span style={s.dateRange}>As of March 25, 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Customer</th><th style={s.thRight}>Current</th><th style={s.thRight}>1–30 Days</th><th style={s.thRight}>31–60 Days</th><th style={s.thRight}>61–90 Days</th><th style={s.thRight}>90+ Days</th><th style={s.thRight}>Total</th><th style={s.th}>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer}>
                <td style={s.td}>{r.customer}</td>
                <td style={s.tdRight}>{r.current > 0 ? fmt(r.current) : '—'}</td>
                <td style={s.tdRight}>{r.d30 > 0 ? fmt(r.d30) : '—'}</td>
                <td style={s.tdRight}>{r.d60 > 0 ? fmt(r.d60) : '—'}</td>
                <td style={s.tdRight}>{r.d90 > 0 ? fmt(r.d90) : '—'}</td>
                <td style={s.tdRight}>{r.d120 > 0 ? fmt(r.d120) : '—'}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(r.total)}</td>
                <td style={s.td}><span style={s.badge(r.status === 'Current' ? 'green' : r.status === 'Collections' ? 'red' : 'yellow')}>{r.status}</span></td>
              </tr>
            ))}
            <tr style={s.totalRow}>
              <td style={{ ...s.td, fontWeight: 700 }}>Total</td>
              {buckets.map((b) => <td key={b} style={{ ...s.tdRight, fontWeight: 700 }}>{(totals[b] as number) > 0 ? fmt(totals[b] as number) : '—'}</td>)}
              <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totals['total'] as number)}</td>
              <td style={s.td} />
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function OccupancyReport() {
  const docks = [
    { dock: 'Dock A', total: 20, occupied: 17, transient: 1, vacant: 2, rate: 90.0 },
    { dock: 'Dock B', total: 16, occupied: 14, transient: 1, vacant: 1, rate: 93.8 },
    { dock: 'Dock C', total: 18, occupied: 15, transient: 0, vacant: 3, rate: 83.3 },
    { dock: 'Dock D', total: 14, occupied: 11, transient: 2, vacant: 1, rate: 92.9 },
    { dock: 'Fuel Dock', total: 4, occupied: 0, transient: 4, vacant: 0, rate: 100.0 },
  ];
  const totals = docks.reduce((a, d) => ({ total: a.total + d.total, occupied: a.occupied + d.occupied, transient: a.transient + d.transient, vacant: a.vacant + d.vacant }), { total: 0, occupied: 0, transient: 0, vacant: 0 });
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total Slips', v: String(totals.total) }, { l: 'Occupied (Long-Term)', v: String(totals.occupied) }, { l: 'Transient', v: String(totals.transient) }, { l: 'Vacant', v: String(totals.vacant) }, { l: 'Occupancy Rate', v: pct(((totals.occupied + totals.transient) / totals.total) * 100) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Dock Occupancy Summary</h3><span style={s.dateRange}>March 25, 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Dock</th><th style={s.thRight}>Total Slips</th><th style={s.thRight}>Long-Term</th><th style={s.thRight}>Transient</th><th style={s.thRight}>Vacant</th><th style={s.thRight}>Rate</th></tr></thead>
          <tbody>
            {docks.map((d) => (
              <tr key={d.dock}><td style={s.td}>{d.dock}</td><td style={s.tdRight}>{d.total}</td><td style={s.tdRight}>{d.occupied}</td><td style={s.tdRight}>{d.transient}</td><td style={s.tdRight}>{d.vacant}</td><td style={s.tdRight}><span style={s.badge(d.rate >= 90 ? 'green' : d.rate >= 80 ? 'yellow' : 'red')}>{pct(d.rate)}</span></td></tr>
            ))}
            <tr style={s.totalRow}><td style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.total}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.occupied}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.transient}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.vacant}</td><td style={{ ...s.tdRight, fontWeight: 700 }}><span style={s.badge('green')}>{pct(((totals.occupied + totals.transient) / totals.total) * 100)}</span></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function POSSalesReport() {
  const rows = [
    { cat: 'Fuel', txns: 142, revenue: 34100, top: 'Regular Gas (gal)', avg: 240.14 },
    { cat: 'Provisions', txns: 98, revenue: 8620, top: 'Bottled Water', avg: 87.96 },
    { cat: 'Bait & Tackle', txns: 74, revenue: 4180, top: 'Live Shrimp (dz)', avg: 56.49 },
    { cat: 'Marine Supplies', txns: 36, revenue: 5420, top: 'Boat Fender', avg: 150.56 },
    { cat: 'Apparel', txns: 22, revenue: 2640, top: 'Marina T-Shirt', avg: 120.00 },
    { cat: 'Other', txns: 8, revenue: 490, top: '—', avg: 61.25 },
  ];
  const totals = rows.reduce((a, r) => ({ txns: a.txns + r.txns, revenue: a.revenue + r.revenue }), { txns: 0, revenue: 0 });
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total Transactions', v: String(totals.txns) }, { l: 'Total Revenue', v: fmt(totals.revenue) }, { l: 'Avg Transaction', v: fmt(totals.revenue / totals.txns) }, { l: 'Categories', v: String(rows.length) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>POS Sales by Category</h3><span style={s.dateRange}>March 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Category</th><th style={s.thRight}>Transactions</th><th style={s.thRight}>Revenue</th><th style={s.thRight}>Avg Sale</th><th style={s.th}>Top Product</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat}><td style={s.td}>{r.cat}</td><td style={s.tdRight}>{r.txns}</td><td style={s.tdRight}>{fmt(r.revenue)}</td><td style={s.tdRight}>{fmt(r.avg)}</td><td style={s.td}>{r.top}</td></tr>
            ))}
            <tr style={s.totalRow}><td style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.txns}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totals.revenue)}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totals.revenue / totals.txns)}</td><td style={s.td} /></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function RentalUtilReport() {
  const rows = [
    { asset: 'Bay Cruiser 24', type: 'Pontoon', bookings: 18, hours: 96, revenue: 8160, util: 68.6 },
    { asset: 'Island Runner', type: 'Pontoon', bookings: 15, hours: 78, revenue: 6630, util: 55.7 },
    { asset: 'Wave Rider Pro', type: 'Jet Ski', bookings: 24, hours: 48, revenue: 5280, util: 68.6 },
    { asset: 'Sea Breeze 2', type: 'Jet Ski', bookings: 20, hours: 40, revenue: 4400, util: 57.1 },
    { asset: 'Kayak #1', type: 'Kayak', bookings: 31, hours: 62, revenue: 1736, util: 88.6 },
    { asset: 'Kayak #2', type: 'Kayak', bookings: 28, hours: 56, revenue: 1568, util: 80.0 },
    { asset: 'SUP Board A', type: 'Paddleboard', bookings: 22, hours: 44, revenue: 880, util: 62.9 },
    { asset: 'Sailboat Classic', type: 'Sailboat', bookings: 8, hours: 64, revenue: 7040, util: 45.7 },
  ];
  const totals = rows.reduce((a, r) => ({ bookings: a.bookings + r.bookings, hours: a.hours + r.hours, revenue: a.revenue + r.revenue }), { bookings: 0, hours: 0, revenue: 0 });
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total Bookings', v: String(totals.bookings) }, { l: 'Total Hours', v: String(totals.hours) }, { l: 'Total Revenue', v: fmt(totals.revenue) }, { l: 'Avg Rev/Asset', v: fmt(totals.revenue / rows.length) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Rental Asset Utilization</h3><span style={s.dateRange}>March 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Asset</th><th style={s.th}>Type</th><th style={s.thRight}>Bookings</th><th style={s.thRight}>Hours</th><th style={s.thRight}>Revenue</th><th style={s.thRight}>Utilization</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.asset}><td style={s.td}>{r.asset}</td><td style={s.tdMuted}>{r.type}</td><td style={s.tdRight}>{r.bookings}</td><td style={s.tdRight}>{r.hours}</td><td style={s.tdRight}>{fmt(r.revenue)}</td><td style={s.tdRight}><span style={s.badge(r.util >= 70 ? 'green' : r.util >= 50 ? 'yellow' : 'red')}>{pct(r.util)}</span></td></tr>
            ))}
            <tr style={s.totalRow}><td style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={s.td} /><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.bookings}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.hours}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totals.revenue)}</td><td style={s.td} /></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function InventoryReport() {
  const rows = [
    { sku: 'FUEL-REG', name: 'Regular Gas (gal)', cat: 'Fuel', stock: 2400, reorder: 500, cost: 3.20, price: 4.29, value: 7680 },
    { sku: 'FUEL-DSL', name: 'Diesel (gal)', cat: 'Fuel', stock: 1800, reorder: 400, cost: 3.75, price: 4.89, value: 6750 },
    { sku: 'ICE-BAG', name: 'Bag of Ice (10lb)', cat: 'Provisions', stock: 85, reorder: 20, cost: 1.20, price: 3.99, value: 102 },
    { sku: 'BAIT-SHP', name: 'Live Shrimp (dz)', cat: 'Bait & Tackle', stock: 24, reorder: 10, cost: 4.50, price: 8.99, value: 108 },
    { sku: 'BAIT-MIN', name: 'Minnows (dz)', cat: 'Bait & Tackle', stock: 18, reorder: 8, cost: 2.80, price: 5.99, value: 50.40 },
    { sku: 'SNK-WTER', name: 'Bottled Water', cat: 'Provisions', stock: 144, reorder: 48, cost: 0.60, price: 2.49, value: 86.40 },
    { sku: 'SNK-SODA', name: 'Soft Drink (can)', cat: 'Provisions', stock: 200, reorder: 60, cost: 0.55, price: 1.99, value: 110 },
    { sku: 'SUN-SPF', name: 'Sunscreen SPF 50', cat: 'Marine Supplies', stock: 32, reorder: 10, cost: 5.80, price: 12.99, value: 185.60 },
    { sku: 'MRN-LINE', name: 'Dock Line 3/8" 15\'', cat: 'Marine Supplies', stock: 15, reorder: 5, cost: 9.40, price: 18.99, value: 141 },
    { sku: 'MRN-FEND', name: 'Boat Fender', cat: 'Marine Supplies', stock: 12, reorder: 4, cost: 12.00, price: 24.99, value: 144 },
    { sku: 'APR-HAT', name: 'Marina Cap', cat: 'Apparel', stock: 48, reorder: 12, cost: 8.50, price: 22.00, value: 408 },
    { sku: 'APR-TEE', name: 'Marina T-Shirt', cat: 'Apparel', stock: 36, reorder: 10, cost: 12.00, price: 28.00, value: 432 },
  ];
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total SKUs', v: String(rows.length) }, { l: 'Total Cost Value', v: fmt(totalValue) }, { l: 'Retail Value', v: fmt(rows.reduce((s, r) => s + r.stock * r.price, 0)) }, { l: 'Low Stock Items', v: String(rows.filter(r => r.stock <= r.reorder).length) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Inventory Valuation</h3><span style={s.dateRange}>As of March 25, 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>SKU</th><th style={s.th}>Product</th><th style={s.th}>Category</th><th style={s.thRight}>In Stock</th><th style={s.thRight}>Reorder Pt</th><th style={s.thRight}>Unit Cost</th><th style={s.thRight}>Retail</th><th style={s.thRight}>Cost Value</th><th style={s.th}>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku}>
                <td style={s.tdMuted}>{r.sku}</td><td style={s.td}>{r.name}</td><td style={s.tdMuted}>{r.cat}</td>
                <td style={s.tdRight}>{r.stock}</td><td style={s.tdRight}>{r.reorder}</td>
                <td style={s.tdRight}>{fmt(r.cost)}</td><td style={s.tdRight}>{fmt(r.price)}</td>
                <td style={{ ...s.tdRight, fontWeight: 600 }}>{fmt(r.value)}</td>
                <td style={s.td}><span style={s.badge(r.stock <= r.reorder ? 'red' : r.stock <= r.reorder * 1.5 ? 'yellow' : 'green')}>{r.stock <= r.reorder ? 'Reorder' : 'OK'}</span></td>
              </tr>
            ))}
            <tr style={s.totalRow}><td colSpan={7} style={{ ...s.td, fontWeight: 700 }}>Total Cost Value</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totalValue)}</td><td style={s.td} /></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function DockWalkReport() {
  const rows = [
    { date: '2026-03-25', inspector: 'Jake M.', dock: 'Dock A', issues: 2, resolved: 2, open: 0, notes: 'Minor debris on A-07; dock light out at A-12 — repaired same day.' },
    { date: '2026-03-24', inspector: 'Maria S.', dock: 'Dock B', issues: 1, resolved: 0, open: 1, notes: 'Cleat loose on B-03, flagged for maintenance.' },
    { date: '2026-03-23', inspector: 'Jake M.', dock: 'Dock C', issues: 3, resolved: 2, open: 1, notes: 'Electrical issue on C-08 open; trash cans full — resolved; handrail paint peeling — resolved.' },
    { date: '2026-03-22', inspector: 'James P.', dock: 'Dock D', issues: 0, resolved: 0, open: 0, notes: 'No issues found.' },
    { date: '2026-03-21', inspector: 'Maria S.', dock: 'Dock A', issues: 1, resolved: 1, open: 0, notes: 'Life ring missing at A-15 — replaced.' },
    { date: '2026-03-20', inspector: 'Jake M.', dock: 'Fuel Dock', issues: 2, resolved: 2, open: 0, notes: 'Spill kit restocked; hose reel serviced.' },
  ];
  const totals = rows.reduce((a, r) => ({ issues: a.issues + r.issues, resolved: a.resolved + r.resolved, open: a.open + r.open }), { issues: 0, resolved: 0, open: 0 });
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Walks (30 Days)', v: String(rows.length) }, { l: 'Total Issues', v: String(totals.issues) }, { l: 'Resolved', v: String(totals.resolved) }, { l: 'Open Issues', v: String(totals.open) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Dock Walk Log</h3><span style={s.dateRange}>Recent Inspections</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Date</th><th style={s.th}>Inspector</th><th style={s.th}>Dock</th><th style={s.thRight}>Issues</th><th style={s.thRight}>Resolved</th><th style={s.thRight}>Open</th><th style={s.th}>Notes</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}><td style={s.td}>{r.date}</td><td style={s.td}>{r.inspector}</td><td style={s.td}>{r.dock}</td><td style={s.tdRight}>{r.issues}</td><td style={s.tdRight}>{r.resolved}</td><td style={s.tdRight}><span style={s.badge(r.open > 0 ? 'yellow' : 'green')}>{r.open}</span></td><td style={{ ...s.td, fontSize: '12px', color: '#64748B', maxWidth: '280px' }}>{r.notes}</td></tr>
            ))}
            <tr style={s.totalRow}><td colSpan={3} style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.issues}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.resolved}</td><td style={{ ...s.tdRight, fontWeight: 700 }}><span style={s.badge(totals.open > 0 ? 'yellow' : 'green')}>{totals.open}</span></td><td style={s.td} /></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function MaintenanceReport() {
  const rows = [
    { wo: 'WO-0142', issue: 'Dock light replacement — A-12', dock: 'Dock A', status: 'Completed', priority: 'Low', cost: 85, completed: '2026-03-25', tech: 'Jake M.' },
    { wo: 'WO-0141', issue: 'Loose cleat — B-03', dock: 'Dock B', status: 'In Progress', priority: 'Medium', cost: 0, completed: '', tech: 'Facilities' },
    { wo: 'WO-0140', issue: 'Electrical fault at C-08 pedestal', dock: 'Dock C', status: 'In Progress', priority: 'High', cost: 0, completed: '', tech: 'Electrician' },
    { wo: 'WO-0139', issue: 'Fuel hose reel serviced', dock: 'Fuel Dock', status: 'Completed', priority: 'Medium', cost: 240, completed: '2026-03-20', tech: 'Jake M.' },
    { wo: 'WO-0138', issue: 'Pump-out station quarterly maintenance', dock: 'Dock C', status: 'Completed', priority: 'Medium', cost: 380, completed: '2026-03-18', tech: 'Facilities' },
    { wo: 'WO-0137', issue: 'Security camera replacement — Gate 2', dock: 'Main', status: 'Completed', priority: 'High', cost: 620, completed: '2026-03-15', tech: 'Security Co.' },
    { wo: 'WO-0136', issue: 'Handrail repainting — Dock C south', dock: 'Dock C', status: 'Completed', priority: 'Low', cost: 180, completed: '2026-03-22', tech: 'Jake M.' },
  ];
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Open Work Orders', v: String(rows.filter(r => r.status !== 'Completed').length) }, { l: 'Completed (30d)', v: String(rows.filter(r => r.status === 'Completed').length) }, { l: 'Total Cost (30d)', v: fmt(totalCost) }, { l: 'High Priority Open', v: String(rows.filter(r => r.priority === 'High' && r.status !== 'Completed').length) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Maintenance Work Orders</h3><span style={s.dateRange}>Last 30 Days</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>WO #</th><th style={s.th}>Issue</th><th style={s.th}>Dock</th><th style={s.th}>Priority</th><th style={s.th}>Status</th><th style={s.thRight}>Cost</th><th style={s.th}>Technician</th><th style={s.th}>Completed</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.wo}>
                <td style={s.tdMuted}>{r.wo}</td><td style={s.td}>{r.issue}</td><td style={s.tdMuted}>{r.dock}</td>
                <td style={s.td}><span style={s.badge(r.priority === 'High' ? 'red' : r.priority === 'Medium' ? 'yellow' : 'default')}>{r.priority}</span></td>
                <td style={s.td}><span style={s.badge(r.status === 'Completed' ? 'green' : 'yellow')}>{r.status}</span></td>
                <td style={s.tdRight}>{r.cost > 0 ? fmt(r.cost) : '—'}</td>
                <td style={s.tdMuted}>{r.tech}</td><td style={s.tdMuted}>{r.completed || '—'}</td>
              </tr>
            ))}
            <tr style={s.totalRow}><td colSpan={5} style={{ ...s.td, fontWeight: 700 }}>Total Cost</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totalCost)}</td><td colSpan={2} style={s.td} /></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function CustomerActivityReport() {
  const rows = [
    { customer: 'David Tidewater', slip: 'B-01', transactions: 3, lastActivity: '2026-03-24', balance: 0, status: 'Active' },
    { customer: 'James Harborview', slip: 'A-01', transactions: 4, lastActivity: '2026-03-23', balance: 0, status: 'Active' },
    { customer: 'Coastal Charters LLC', slip: 'B-03', transactions: 2, lastActivity: '2026-02-01', balance: 3950, status: 'Overdue' },
    { customer: 'Blue Water Excursions', slip: 'B-04', transactions: 1, lastActivity: '2026-02-01', balance: 9620, status: 'Overdue' },
    { customer: 'Maria Seabreeze', slip: 'A-02', transactions: 5, lastActivity: '2026-03-25', balance: 0, status: 'Active' },
    { customer: 'Tom Seaside', slip: 'A-05', transactions: 2, lastActivity: '2026-01-01', balance: 0, status: 'Active' },
    { customer: 'Elena Windward', slip: 'C-01', transactions: 3, lastActivity: '2026-03-20', balance: 0, status: 'Active' },
    { customer: 'Robert Dockside', slip: 'A-04', transactions: 2, lastActivity: '2026-02-01', balance: 1742, status: 'Overdue' },
  ];
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Active Tenants', v: String(rows.filter(r => r.status === 'Active').length) }, { l: 'Overdue Accounts', v: String(rows.filter(r => r.status === 'Overdue').length) }, { l: 'Total Transactions', v: String(rows.reduce((s, r) => s + r.transactions, 0)) }, { l: 'Total AR Balance', v: fmt(rows.reduce((s, r) => s + r.balance, 0)) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Customer Activity Summary</h3><span style={s.dateRange}>March 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Customer</th><th style={s.th}>Slip</th><th style={s.thRight}>Transactions</th><th style={s.th}>Last Activity</th><th style={s.thRight}>Balance</th><th style={s.th}>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer}>
                <td style={{ ...s.td, fontWeight: 600 }}>{r.customer}</td>
                <td style={s.tdMuted}>{r.slip}</td>
                <td style={s.tdRight}>{r.transactions}</td>
                <td style={s.tdMuted}>{r.lastActivity}</td>
                <td style={s.tdRight}>{r.balance > 0 ? <span style={{ color: '#DC2626', fontFamily: '"JetBrains Mono", monospace' }}>{fmt(r.balance)}</span> : <span style={{ color: '#64748B' }}>—</span>}</td>
                <td style={s.td}><span style={s.badge(r.status === 'Active' ? 'green' : 'red')}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LeadConversionReport() {
  const rows = [
    { source: 'Website Form', leads: 42, qualified: 28, converted: 12, rate: 28.6 },
    { source: 'Phone Inquiry', leads: 18, qualified: 14, converted: 8, rate: 44.4 },
    { source: 'Referral', leads: 12, qualified: 11, converted: 9, rate: 75.0 },
    { source: 'Walk-In', leads: 9, qualified: 7, converted: 5, rate: 55.6 },
    { source: 'Social Media', leads: 24, qualified: 10, converted: 3, rate: 12.5 },
    { source: 'Boat Show', leads: 31, qualified: 18, converted: 7, rate: 22.6 },
  ];
  const totals = rows.reduce((a, r) => ({ leads: a.leads + r.leads, qualified: a.qualified + r.qualified, converted: a.converted + r.converted }), { leads: 0, qualified: 0, converted: 0 });
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total Leads', v: String(totals.leads) }, { l: 'Qualified', v: String(totals.qualified) }, { l: 'Converted', v: String(totals.converted) }, { l: 'Overall Rate', v: pct((totals.converted / totals.leads) * 100) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Lead Conversion by Source</h3><span style={s.dateRange}>Q1 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Source</th><th style={s.thRight}>Leads</th><th style={s.thRight}>Qualified</th><th style={s.thRight}>Converted</th><th style={s.thRight}>Conv. Rate</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source}><td style={s.td}>{r.source}</td><td style={s.tdRight}>{r.leads}</td><td style={s.tdRight}>{r.qualified}</td><td style={s.tdRight}>{r.converted}</td><td style={s.tdRight}><span style={s.badge(r.rate >= 40 ? 'green' : r.rate >= 20 ? 'yellow' : 'red')}>{pct(r.rate)}</span></td></tr>
            ))}
            <tr style={s.totalRow}><td style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.leads}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.qualified}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.converted}</td><td style={{ ...s.tdRight, fontWeight: 700 }}><span style={s.badge('yellow')}>{pct((totals.converted / totals.leads) * 100)}</span></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function SlipUtilizationReport() {
  const rows = [
    { slip: 'A-01', dock: 'A', tenant: 'James Harborview', daysOccupied: 354, turnover: 1, avgStay: 354, rate: 97.0 },
    { slip: 'A-02', dock: 'A', tenant: 'Maria Seabreeze', daysOccupied: 298, turnover: 1, avgStay: 298, rate: 81.6 },
    { slip: 'A-03', dock: 'A', tenant: '— Vacant —', daysOccupied: 0, turnover: 0, avgStay: 0, rate: 0 },
    { slip: 'A-04', dock: 'A', tenant: 'Robert Dockside', daysOccupied: 145, turnover: 1, avgStay: 145, rate: 39.7 },
    { slip: 'B-01', dock: 'B', tenant: 'David Tidewater', daysOccupied: 365, turnover: 1, avgStay: 365, rate: 100.0 },
    { slip: 'B-03', dock: 'B', tenant: 'Coastal Charters LLC', daysOccupied: 298, turnover: 1, avgStay: 298, rate: 81.6 },
    { slip: 'B-04', dock: 'B', tenant: 'Blue Water Excursions', daysOccupied: 334, turnover: 1, avgStay: 334, rate: 91.5 },
    { slip: 'C-01', dock: 'C', tenant: 'Elena Windward', daysOccupied: 220, turnover: 2, avgStay: 110, rate: 60.3 },
  ];
  const avgRate = rows.reduce((s, r) => s + r.rate, 0) / rows.length;
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Avg Utilization', v: pct(avgRate) }, { l: 'Occupied Slips', v: String(rows.filter(r => r.rate > 0).length) }, { l: 'Vacant Slips', v: String(rows.filter(r => r.rate === 0).length) }, { l: 'Avg Stay (Days)', v: String(Math.round(rows.filter(r => r.avgStay > 0).reduce((s, r) => s + r.avgStay, 0) / rows.filter(r => r.avgStay > 0).length)) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Slip Utilization Detail</h3><span style={s.dateRange}>Trailing 12 Months</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Slip</th><th style={s.th}>Dock</th><th style={s.th}>Current Tenant</th><th style={s.thRight}>Days Occupied</th><th style={s.thRight}>Turnovers</th><th style={s.thRight}>Avg Stay</th><th style={s.thRight}>Utilization</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slip}><td style={{ ...s.td, fontWeight: 600 }}>{r.slip}</td><td style={s.tdMuted}>{r.dock}</td><td style={s.td}>{r.tenant}</td><td style={s.tdRight}>{r.daysOccupied > 0 ? r.daysOccupied : '—'}</td><td style={s.tdRight}>{r.turnover > 0 ? r.turnover : '—'}</td><td style={s.tdRight}>{r.avgStay > 0 ? `${r.avgStay}d` : '—'}</td><td style={s.tdRight}><span style={s.badge(r.rate >= 80 ? 'green' : r.rate >= 50 ? 'yellow' : r.rate === 0 ? 'red' : 'default')}>{pct(r.rate)}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CollectionsReport() {
  const rows = [
    { customer: 'Blue Water Excursions', due: 9620, paid: 0, method: 'ACH', returns: 2, status: 'Collections', lastContact: '2026-03-20' },
    { customer: 'Coastal Charters LLC', due: 3950, paid: 3950, method: 'Card', returns: 0, status: 'Paid', lastContact: '2026-03-01' },
    { customer: 'Robert Dockside', due: 1742, paid: 0, method: 'Check', returns: 0, status: 'Outstanding', lastContact: '2026-03-15' },
    { customer: 'Pacific Marine LLC', due: 5400, paid: 2000, method: 'ACH', returns: 1, status: 'Partial', lastContact: '2026-03-22' },
    { customer: 'Amy Portview', due: 990, paid: 990, method: 'ACH', returns: 0, status: 'Paid', lastContact: '2026-03-01' },
    { customer: 'Derek Harborview', due: 2200, paid: 0, method: 'Check', returns: 0, status: 'Outstanding', lastContact: '2026-03-18' },
  ];
  const totals = rows.reduce((a, r) => ({ due: a.due + r.due, paid: a.paid + r.paid }), { due: 0, paid: 0 });
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total Due', v: fmt(totals.due) }, { l: 'Collected', v: fmt(totals.paid) }, { l: 'Outstanding', v: fmt(totals.due - totals.paid) }, { l: 'ACH Returns', v: String(rows.reduce((s, r) => s + r.returns, 0)) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Collections Detail</h3><span style={s.dateRange}>March 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Customer</th><th style={s.thRight}>Amount Due</th><th style={s.thRight}>Paid</th><th style={s.th}>Method</th><th style={s.thRight}>ACH Returns</th><th style={s.th}>Status</th><th style={s.th}>Last Contact</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer}>
                <td style={{ ...s.td, fontWeight: 600 }}>{r.customer}</td>
                <td style={s.tdRight}>{fmt(r.due)}</td>
                <td style={s.tdRight}>{fmt(r.paid)}</td>
                <td style={s.tdMuted}>{r.method}</td>
                <td style={s.tdRight}>{r.returns > 0 ? <span style={s.badge('red')}>{r.returns}</span> : '—'}</td>
                <td style={s.td}><span style={s.badge(r.status === 'Paid' ? 'green' : r.status === 'Collections' ? 'red' : r.status === 'Partial' ? 'yellow' : 'default')}>{r.status}</span></td>
                <td style={s.tdMuted}>{r.lastContact}</td>
              </tr>
            ))}
            <tr style={s.totalRow}><td style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totals.due)}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totals.paid)}</td><td colSpan={4} style={s.td} /></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function GLSummaryReport() {
  const rows = [
    { account: '4000 · Slip Rental Revenue', type: 'Revenue', debit: 0, credit: 89420 },
    { account: '4010 · Transient Revenue', type: 'Revenue', debit: 0, credit: 12340 },
    { account: '4020 · Rental Revenue', type: 'Revenue', debit: 0, credit: 18650 },
    { account: '4030 · POS Revenue', type: 'Revenue', debit: 0, credit: 8920 },
    { account: '4040 · Fuel Revenue', type: 'Revenue', debit: 0, credit: 34100 },
    { account: '5000 · Cost of Fuel', type: 'COGS', debit: 22950, credit: 0 },
    { account: '5010 · Cost of Goods Sold', type: 'COGS', debit: 3840, credit: 0 },
    { account: '6000 · Wages & Salaries', type: 'Expense', debit: 28400, credit: 0 },
    { account: '6010 · Utilities', type: 'Expense', debit: 4200, credit: 0 },
    { account: '6020 · Maintenance & Repairs', type: 'Expense', debit: 1505, credit: 0 },
    { account: '6030 · Insurance', type: 'Expense', debit: 2800, credit: 0 },
    { account: '2000 · Accounts Receivable', type: 'Asset', debit: 27912, credit: 0 },
    { account: '2100 · Deferred Revenue', type: 'Liability', debit: 0, credit: 14820 },
  ];
  const totalDebits = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredits = rows.reduce((s, r) => s + r.credit, 0);
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total Debits', v: fmt(totalDebits) }, { l: 'Total Credits', v: fmt(totalCredits) }, { l: 'Net Revenue', v: fmt(rows.filter(r => r.type === 'Revenue').reduce((s, r) => s + r.credit, 0)) }, { l: 'Total Expenses', v: fmt(rows.filter(r => r.type === 'Expense').reduce((s, r) => s + r.debit, 0)) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>General Ledger Summary</h3><span style={s.dateRange}>March 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Account</th><th style={s.th}>Type</th><th style={s.thRight}>Debit</th><th style={s.thRight}>Credit</th><th style={s.thRight}>Net</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.account}><td style={s.td}>{r.account}</td><td style={s.tdMuted}>{r.type}</td><td style={s.tdRight}>{r.debit > 0 ? fmt(r.debit) : '—'}</td><td style={s.tdRight}>{r.credit > 0 ? fmt(r.credit) : '—'}</td><td style={{ ...s.tdRight, fontWeight: 600, color: r.credit - r.debit >= 0 ? '#059669' : '#DC2626' }}>{fmt(Math.abs(r.credit - r.debit))}</td></tr>
            ))}
            <tr style={s.totalRow}><td colSpan={2} style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totalDebits)}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totalCredits)}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(Math.abs(totalCredits - totalDebits))}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function DeferredRevenueReport() {
  const rows = [
    { customer: 'Tom Seaside', slip: 'A-05', period: 'Q1 2026', prepaid: 6975, recognized: 2325, deferred: 4650, term: 'Quarterly' },
    { customer: 'David Tidewater', slip: 'B-01', period: 'Annual 2026', prepaid: 50400, recognized: 12600, deferred: 37800, term: 'Annual' },
    { customer: 'Lisa Bayfront', slip: 'C-04', period: 'Q1 2026', prepaid: 4305, recognized: 1435, deferred: 2870, term: 'Quarterly' },
    { customer: 'Mike Anchorage', slip: 'C-02', period: 'H1 2026', prepaid: 6600, recognized: 2200, deferred: 4400, term: 'Semi-Annual' },
  ];
  const totals = rows.reduce((a, r) => ({ prepaid: a.prepaid + r.prepaid, recognized: a.recognized + r.recognized, deferred: a.deferred + r.deferred }), { prepaid: 0, recognized: 0, deferred: 0 });
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'Total Prepaid', v: fmt(totals.prepaid) }, { l: 'Recognized', v: fmt(totals.recognized) }, { l: 'Deferred Balance', v: fmt(totals.deferred) }, { l: 'Contracts', v: String(rows.length) }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Deferred Revenue Schedule</h3><span style={s.dateRange}>As of March 25, 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Customer</th><th style={s.th}>Slip</th><th style={s.th}>Term</th><th style={s.th}>Period</th><th style={s.thRight}>Prepaid</th><th style={s.thRight}>Recognized</th><th style={s.thRight}>Deferred</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer}><td style={{ ...s.td, fontWeight: 600 }}>{r.customer}</td><td style={s.tdMuted}>{r.slip}</td><td style={s.tdMuted}>{r.term}</td><td style={s.tdMuted}>{r.period}</td><td style={s.tdRight}>{fmt(r.prepaid)}</td><td style={s.tdRight}>{fmt(r.recognized)}</td><td style={{ ...s.tdRight, fontWeight: 600, color: '#D97706' }}>{fmt(r.deferred)}</td></tr>
            ))}
            <tr style={s.totalRow}><td colSpan={4} style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totals.prepaid)}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmt(totals.recognized)}</td><td style={{ ...s.tdRight, fontWeight: 700, color: '#D97706' }}>{fmt(totals.deferred)}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function WaitlistReport() {
  const rows = [
    { customer: 'Greg Harborton', position: 1, slipSize: '40–45 ft', requestDate: '2024-08-12', waitDays: 591, preferredDock: 'Dock B', notes: 'Flexible on start date' },
    { customer: 'Sarah Bayview', position: 2, slipSize: '25–30 ft', requestDate: '2024-11-03', waitDays: 508, preferredDock: 'Any', notes: '' },
    { customer: 'Pacific Marine LLC', position: 3, slipSize: '50+ ft', requestDate: '2025-01-15', waitDays: 435, preferredDock: 'Dock B', notes: 'Needs shore power 50A' },
    { customer: 'Frank Tideline', position: 4, slipSize: '30–35 ft', requestDate: '2025-04-22', waitDays: 337, preferredDock: 'Dock A', notes: '' },
    { customer: 'Carol Portsmouth', position: 5, slipSize: '20–25 ft', requestDate: '2025-08-10', waitDays: 227, preferredDock: 'Dock C', notes: 'Seasonal only' },
  ];
  return (
    <>
      <div style={s.kpiRow}>
        {[{ l: 'On Waitlist', v: String(rows.length) }, { l: 'Avg Wait (Days)', v: String(Math.round(rows.reduce((s, r) => s + r.waitDays, 0) / rows.length)) }, { l: 'Longest Wait', v: `${rows[0].waitDays}d` }, { l: 'Slips Available', v: '3' }].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Waitlist Queue</h3><span style={s.dateRange}>As of March 25, 2026</span></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>#</th><th style={s.th}>Customer</th><th style={s.th}>Slip Size</th><th style={s.th}>Preferred Dock</th><th style={s.th}>Request Date</th><th style={s.thRight}>Wait (Days)</th><th style={s.th}>Notes</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.position}><td style={{ ...s.tdMuted, fontWeight: 700, color: '#0A2342' }}>{r.position}</td><td style={{ ...s.td, fontWeight: 600 }}>{r.customer}</td><td style={s.tdMuted}>{r.slipSize}</td><td style={s.tdMuted}>{r.preferredDock}</td><td style={s.tdMuted}>{r.requestDate}</td><td style={s.tdRight}>{r.waitDays}</td><td style={{ ...s.tdMuted, fontSize: '12px' }}>{r.notes || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Report metadata ────────────────────────────────────── */

const reportMeta: Record<string, { title: string; subtitle: string; component: () => JSX.Element }> = {
  revenue: { title: 'Revenue Summary', subtitle: 'March 2026', component: RevenueSummary },
  aging: { title: 'Accounts Receivable Aging', subtitle: 'As of March 25, 2026', component: ARAgingReport },
  collections: { title: 'Collections Report', subtitle: 'March 2026', component: CollectionsReport },
  deferred: { title: 'Deferred Revenue', subtitle: 'As of March 25, 2026', component: DeferredRevenueReport },
  gl: { title: 'GL Summary', subtitle: 'March 2026', component: GLSummaryReport },
  occupancy: { title: 'Occupancy Report', subtitle: 'March 25, 2026', component: OccupancyReport },
  utilization: { title: 'Slip Utilization', subtitle: 'Trailing 12 Months', component: SlipUtilizationReport },
  dockwalk: { title: 'Dock Walk Summary', subtitle: 'Last 30 Days', component: DockWalkReport },
  maintenance: { title: 'Maintenance Log', subtitle: 'Last 30 Days', component: MaintenanceReport },
  customer_activity: { title: 'Customer Activity', subtitle: 'March 2026', component: CustomerActivityReport },
  leads: { title: 'Lead Conversion', subtitle: 'Q1 2026', component: LeadConversionReport },
  waitlist: { title: 'Waitlist Analytics', subtitle: 'As of March 25, 2026', component: WaitlistReport },
  rental_util: { title: 'Rental Utilization', subtitle: 'March 2026', component: RentalUtilReport },
  pos_sales: { title: 'POS Sales Summary', subtitle: 'March 2026', component: POSSalesReport },
  inventory: { title: 'Inventory Valuation', subtitle: 'As of March 25, 2026', component: InventoryReport },
};

/* ── Main viewer ────────────────────────────────────────── */

interface ReportViewerProps {
  reportId: string;
  onClose: () => void;
}

export default function ReportViewer({ reportId, onClose }: ReportViewerProps) {
  const meta = reportMeta[reportId];
  if (!meta) return null;
  const ReportContent = meta.component;
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.panel} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <h2 style={s.headerTitle}>{meta.title}</h2>
            <div style={s.headerSub}>{meta.subtitle} · Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          </div>
          <div style={s.headerActions}>
            <button style={s.actionBtn}><Printer size={14} /> Print</button>
            <button style={s.actionBtn}><Download size={14} /> Export CSV</button>
            <button style={s.closeBtn} onClick={onClose}><X size={22} /></button>
          </div>
        </div>
        <div style={s.body}>
          <ReportContent />
        </div>
      </div>
    </div>
  );
}
