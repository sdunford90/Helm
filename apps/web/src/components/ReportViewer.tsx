import React, { useState, createContext, useContext, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { X, Download, Printer } from 'lucide-react';

/* ── Report context (navigate + date range) ─────────────── */
interface ReportCtx { navigate: (to: string) => void; dateFrom: string; dateTo: string; }
const ReportContext = createContext<ReportCtx>({ navigate: () => {}, dateFrom: '2026-03-01', dateTo: '2026-03-25' });
const useReport = () => useContext(ReportContext);

/* ── Styles ─────────────────────────────────────────────── */

const s = {
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10,35,66,0.55)', zIndex: 1200, display: 'flex', justifyContent: 'flex-end' as const },
  panel: { width: '88vw', maxWidth: '1100px', height: '100vh', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column' as const, boxShadow: '-8px 0 40px rgba(0,0,0,0.2)', overflowY: 'auto' as const },
  header: { padding: '20px 28px', backgroundColor: '#0A2342', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  headerTitle: { fontSize: '20px', fontWeight: 700, margin: 0, color: '#FFFFFF' },
  headerSub: { fontSize: '13px', color: '#94A3B8', marginTop: '2px' },
  headerActions: { display: 'flex', gap: '10px', alignItems: 'center' },
  actionBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' },
  closeBtn: { background: 'none', border: 'none', color: '#FFFFFF', cursor: 'pointer', padding: '4px', opacity: 0.8 },
  body: { flex: 1, padding: '28px', overflowY: 'auto' as const },
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
  empty: { padding: '48px 24px', textAlign: 'center' as const, color: '#94A3B8', fontSize: '14px' },
  loading: { padding: '48px 24px', textAlign: 'center' as const, color: '#94A3B8', fontSize: '14px' },
};

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtC = (cents: number) => fmt(cents / 100);
const pct = (n: number) => `${n.toFixed(1)}%`;

/* ── Sort helpers ────────────────────────────────────────── */
function useSortState<T extends object>(initial: T[], defaultKey: keyof T) {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggle = (key: string) => {
    if ((key as keyof T) === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key as keyof T); setSortDir('asc'); }
  };
  const sorted = [...initial].sort((a, b) => {
    const av = a[sortKey]; const bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
  return { sorted, sortKey, sortDir, toggle };
}

function SortTh({ label, colKey, sortKey, sortDir, toggle, right }: { label: string; colKey: string; sortKey: string; sortDir: 'asc' | 'desc'; toggle: (k: string) => void; right?: boolean }) {
  const active = colKey === sortKey;
  return (
    <th style={{ ...(right ? s.thRight : s.th), cursor: 'pointer', userSelect: 'none', backgroundColor: '#0A2342', color: active ? '#00D4FF' : '#64748B' } as React.CSSProperties}
      onClick={() => toggle(colKey)}>
      {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
}

/* ── Clickable customer cell ─────────────────────────────── */
function CustomerCell({ name, id }: { name: string; id?: string }) {
  const { navigate } = useReport();
  return (
    <td style={{ ...s.td, fontWeight: 600, color: '#0066CC', cursor: 'pointer', textDecoration: 'underline' }}
      onClick={() => navigate(id ? `/customers/${id}` : '/customers')}>
      {name}
    </td>
  );
}

/* ── Generic report data hook ────────────────────────────── */
function useReportData<T>(endpoint: string) {
  const { dateFrom, dateTo } = useReport();
  const { getToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ startDate: dateFrom, endDate: dateTo });
      const res = await fetch(`/api/reports/${endpoint}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [endpoint, dateFrom, dateTo, getToken]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error };
}

function LoadingRow({ cols }: { cols: number }) {
  return <tr><td colSpan={cols} style={s.loading}>Loading…</td></tr>;
}
function EmptyRow({ cols, msg = 'No data for this period.' }: { cols: number; msg?: string }) {
  return <tr><td colSpan={cols} style={s.empty}>{msg}</td></tr>;
}

/* ── Report-specific renderers ──────────────────────────── */

interface RevenueApiData {
  revenue: { totalCents: number; paymentCount: number };
  invoiced: { totalCents: number; invoiceCount: number };
  byPaymentMethod: { method: string; totalCents: number; count: number }[];
}

function RevenueSummary() {
  const { data, loading } = useReportData<RevenueApiData>('revenue');
  const rows = data?.byPaymentMethod ?? [];
  const totalCollected = data?.revenue.totalCents ?? 0;
  const totalInvoiced = data?.invoiced.totalCents ?? 0;
  const txnCount = data?.revenue.paymentCount ?? 0;
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Collected', v: fmtC(totalCollected) },
          { l: 'Invoiced', v: fmtC(totalInvoiced) },
          { l: 'Transactions', v: String(txnCount) },
          { l: 'Invoice Count', v: String(data?.invoiced.invoiceCount ?? 0) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Revenue by Payment Method</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Method</th><th style={s.thRight}>Transactions</th><th style={s.thRight}>Total</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={3} /> : rows.length === 0 ? <EmptyRow cols={3} /> : rows.map((r) => (
              <tr key={r.method}><td style={s.td}>{r.method}</td><td style={s.tdRight}>{r.count}</td><td style={s.tdRight}>{fmtC(r.totalCents)}</td></tr>
            ))}
            {!loading && rows.length > 0 && (
              <tr style={s.totalRow}>
                <td style={{ ...s.td, fontWeight: 700 }}>Total Collected</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{txnCount}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(totalCollected)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface ArAgingDetail {
  invoiceId: string;
  invoiceNumber: string;
  customer: { id: string; firstName: string; lastName: string; email: string };
  dueDate: string;
  balanceCents: number;
  daysOverdue: number;
  bucket: 'current' | 'days30' | 'days60' | 'days90' | 'days120plus';
}
interface ArAgingApiData {
  buckets: { current: number; days30: number; days60: number; days90: number; days120plus: number };
  totalOutstanding: number;
  invoiceCount: number;
  details: ArAgingDetail[];
}

function ARAgingReport() {
  const { data, loading } = useReportData<ArAgingApiData>('ar-aging');
  const details = data?.details ?? [];
  const b = data?.buckets ?? { current: 0, days30: 0, days60: 0, days90: 0, days120plus: 0 };

  const rows = details.map((d) => ({
    id: d.customer.id,
    customer: `${d.customer.firstName} ${d.customer.lastName}`,
    invoice: d.invoiceNumber,
    current: d.bucket === 'current' ? d.balanceCents : 0,
    d30: d.bucket === 'days30' ? d.balanceCents : 0,
    d60: d.bucket === 'days60' ? d.balanceCents : 0,
    d90: d.bucket === 'days90' ? d.balanceCents : 0,
    d120: d.bucket === 'days120plus' ? d.balanceCents : 0,
    total: d.balanceCents,
    daysOverdue: d.daysOverdue,
  }));
  const { sorted, sortKey, sortDir, toggle } = useSortState(rows, 'total');
  const sk = sortKey as string; const sd = sortDir;

  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Total Outstanding', v: fmtC(data?.totalOutstanding ?? 0) },
          { l: '30+ Days', v: fmtC((b.days30 + b.days60 + b.days90 + b.days120plus)) },
          { l: '90+ Days', v: fmtC(b.days90 + b.days120plus) },
          { l: 'Open Invoices', v: String(data?.invoiceCount ?? 0) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Accounts Receivable Aging</h3></div>
        <table style={s.table}>
          <thead><tr>
            <SortTh label="Customer" colKey="customer" sortKey={sk} sortDir={sd} toggle={toggle} />
            <th style={s.th}>Invoice</th>
            <SortTh label="Current" colKey="current" sortKey={sk} sortDir={sd} toggle={toggle} right />
            <SortTh label="1–30 Days" colKey="d30" sortKey={sk} sortDir={sd} toggle={toggle} right />
            <SortTh label="31–60 Days" colKey="d60" sortKey={sk} sortDir={sd} toggle={toggle} right />
            <SortTh label="61–90 Days" colKey="d90" sortKey={sk} sortDir={sd} toggle={toggle} right />
            <SortTh label="90+ Days" colKey="d120" sortKey={sk} sortDir={sd} toggle={toggle} right />
            <SortTh label="Total" colKey="total" sortKey={sk} sortDir={sd} toggle={toggle} right />
          </tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={8} /> : sorted.length === 0 ? <EmptyRow cols={8} msg="No outstanding invoices." /> : sorted.map((r) => (
              <tr key={r.invoice}>
                <CustomerCell name={r.customer} id={r.id} />
                <td style={s.tdMuted}>{r.invoice}</td>
                <td style={s.tdRight}>{r.current > 0 ? fmtC(r.current) : '—'}</td>
                <td style={s.tdRight}>{r.d30 > 0 ? fmtC(r.d30) : '—'}</td>
                <td style={s.tdRight}>{r.d60 > 0 ? fmtC(r.d60) : '—'}</td>
                <td style={s.tdRight}>{r.d90 > 0 ? fmtC(r.d90) : '—'}</td>
                <td style={s.tdRight}>{r.d120 > 0 ? fmtC(r.d120) : '—'}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(r.total)}</td>
              </tr>
            ))}
            {!loading && rows.length > 0 && (
              <tr style={s.totalRow}>
                <td colSpan={2} style={{ ...s.td, fontWeight: 700 }}>Total</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(b.current)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(b.days30)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(b.days60)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(b.days90)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(b.days120plus)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(data?.totalOutstanding ?? 0)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface OccupancyApiData {
  summary: { total: number; occupied: number; vacant: number; maintenance: number; reserved: number; occupancyRate: string };
  byDock: { dock: string; total: number; occupied: number; rate: string }[];
}

function OccupancyReport() {
  const { data, loading } = useReportData<OccupancyApiData>('occupancy');
  const docks = data?.byDock ?? [];
  const sum = data?.summary ?? { total: 0, occupied: 0, vacant: 0, maintenance: 0, reserved: 0, occupancyRate: '0.0' };
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Total Slips', v: String(sum.total) },
          { l: 'Occupied', v: String(sum.occupied) },
          { l: 'Vacant', v: String(sum.vacant) },
          { l: 'Maintenance', v: String(sum.maintenance) },
          { l: 'Occupancy Rate', v: pct(parseFloat(sum.occupancyRate)) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Dock Occupancy Summary</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Dock</th><th style={s.thRight}>Total Slips</th><th style={s.thRight}>Occupied</th><th style={s.thRight}>Rate</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={4} /> : docks.length === 0 ? <EmptyRow cols={4} /> : docks.map((d) => (
              <tr key={d.dock}>
                <td style={s.td}>{d.dock || '(no dock)'}</td>
                <td style={s.tdRight}>{d.total}</td>
                <td style={s.tdRight}>{d.occupied}</td>
                <td style={s.tdRight}><span style={s.badge(parseFloat(d.rate) >= 90 ? 'green' : parseFloat(d.rate) >= 70 ? 'yellow' : 'red')}>{pct(parseFloat(d.rate))}</span></td>
              </tr>
            ))}
            {!loading && docks.length > 0 && (
              <tr style={s.totalRow}>
                <td style={{ ...s.td, fontWeight: 700 }}>Total</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{sum.total}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{sum.occupied}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}><span style={s.badge('green')}>{pct(parseFloat(sum.occupancyRate))}</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface POSSalesApiData {
  transactionCount: number;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  shiftCount: number;
}

function POSSalesReport() {
  const { data, loading } = useReportData<POSSalesApiData>('pos-sales');
  const avgSale = (data?.transactionCount ?? 0) > 0 ? (data!.totalCents / data!.transactionCount) : 0;
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Transactions', v: loading ? '…' : String(data?.transactionCount ?? 0) },
          { l: 'Total Revenue', v: loading ? '…' : fmtC(data?.totalCents ?? 0) },
          { l: 'Avg Transaction', v: loading ? '…' : fmtC(avgSale) },
          { l: 'Shifts', v: loading ? '…' : String(data?.shiftCount ?? 0) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>POS Revenue Breakdown</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Line</th><th style={s.thRight}>Amount</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={2} /> : !data ? <EmptyRow cols={2} /> : (
              <>
                <tr><td style={s.td}>Subtotal</td><td style={s.tdRight}>{fmtC(data.subtotalCents)}</td></tr>
                <tr><td style={s.td}>Tax</td><td style={s.tdRight}>{fmtC(data.taxCents)}</td></tr>
                <tr><td style={s.td}>Tips</td><td style={s.tdRight}>{fmtC(data.tipCents)}</td></tr>
                <tr style={s.totalRow}><td style={{ ...s.td, fontWeight: 700 }}>Total Collected</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(data.totalCents)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface RentalUtilApiData {
  totalBookings: number;
  totalRevenueCents: number;
  byProduct: { productId: string; name: string; bookings: number; revenueCents: number }[];
}

function RentalUtilReport() {
  const { data, loading } = useReportData<RentalUtilApiData>('rental-utilization');
  const rows = data?.byProduct ?? [];
  const totals = { bookings: data?.totalBookings ?? 0, revenue: data?.totalRevenueCents ?? 0 };
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Total Bookings', v: loading ? '…' : String(totals.bookings) },
          { l: 'Total Revenue', v: loading ? '…' : fmtC(totals.revenue) },
          { l: 'Active Products', v: loading ? '…' : String(rows.length) },
          { l: 'Avg Rev/Product', v: loading || rows.length === 0 ? '—' : fmtC(totals.revenue / rows.length) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Rental Asset Utilization</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Product</th><th style={s.thRight}>Bookings</th><th style={s.thRight}>Revenue</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={3} /> : rows.length === 0 ? <EmptyRow cols={3} /> : rows.map((r) => (
              <tr key={r.productId}><td style={s.td}>{r.name}</td><td style={s.tdRight}>{r.bookings}</td><td style={s.tdRight}>{fmtC(r.revenueCents)}</td></tr>
            ))}
            {!loading && rows.length > 0 && (
              <tr style={s.totalRow}><td style={{ ...s.td, fontWeight: 700 }}>Total</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{totals.bookings}</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(totals.revenue)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface InventoryItem { productId: string; name: string; sku: string | null; costCents: number; priceCents: number; qtyOnHand: number; reorderQty: number; valueCents: number; needsReorder: boolean; }
interface InventoryApiData { productCount: number; totalValueCents: number; reorderAlerts: number; items: InventoryItem[]; }

function InventoryReport() {
  const { data, loading } = useReportData<InventoryApiData>('inventory');
  const rows = data?.items ?? [];
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Total SKUs', v: loading ? '…' : String(data?.productCount ?? 0) },
          { l: 'Total Cost Value', v: loading ? '…' : fmtC(data?.totalValueCents ?? 0) },
          { l: 'Retail Value', v: loading ? '…' : fmtC(rows.reduce((s, r) => s + r.qtyOnHand * r.priceCents, 0)) },
          { l: 'Reorder Alerts', v: loading ? '…' : String(data?.reorderAlerts ?? 0) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Inventory Valuation</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>SKU</th><th style={s.th}>Product</th><th style={s.thRight}>In Stock</th><th style={s.thRight}>Reorder Pt</th><th style={s.thRight}>Unit Cost</th><th style={s.thRight}>Retail</th><th style={s.thRight}>Cost Value</th><th style={s.th}>Status</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={8} /> : rows.length === 0 ? <EmptyRow cols={8} /> : rows.map((r) => (
              <tr key={r.productId}>
                <td style={s.tdMuted}>{r.sku || '—'}</td>
                <td style={s.td}>{r.name}</td>
                <td style={s.tdRight}>{r.qtyOnHand}</td>
                <td style={s.tdRight}>{r.reorderQty}</td>
                <td style={s.tdRight}>{fmtC(r.costCents)}</td>
                <td style={s.tdRight}>{fmtC(r.priceCents)}</td>
                <td style={{ ...s.tdRight, fontWeight: 600 }}>{fmtC(r.valueCents)}</td>
                <td style={s.td}><span style={s.badge(r.needsReorder ? 'red' : 'green')}>{r.needsReorder ? 'Reorder' : 'OK'}</span></td>
              </tr>
            ))}
            {!loading && rows.length > 0 && (
              <tr style={s.totalRow}><td colSpan={6} style={{ ...s.td, fontWeight: 700 }}>Total Cost Value</td><td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(data!.totalValueCents)}</td><td style={s.td} /></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface DockWalkApiData {
  totalWalks: number;
  completed: number;
  completionRate: string;
  violationsByType: { type: string | null; count: number }[];
  totalViolations: number;
  pumpOuts: number;
}

function DockWalkReport() {
  const { data, loading } = useReportData<DockWalkApiData>('dock-walk-summary');
  const violations = data?.violationsByType ?? [];
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Total Walks', v: loading ? '…' : String(data?.totalWalks ?? 0) },
          { l: 'Completed', v: loading ? '…' : String(data?.completed ?? 0) },
          { l: 'Completion Rate', v: loading ? '…' : pct(parseFloat(data?.completionRate ?? '0')) },
          { l: 'Total Violations', v: loading ? '…' : String(data?.totalViolations ?? 0) },
          { l: 'Pump-Outs', v: loading ? '…' : String(data?.pumpOuts ?? 0) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Violations by Type</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Violation Type</th><th style={s.thRight}>Count</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={2} /> : violations.length === 0 ? <EmptyRow cols={2} msg="No violations in this period." /> : violations.map((v, i) => (
              <tr key={i}><td style={s.td}>{v.type || 'Unspecified'}</td><td style={s.tdRight}>{v.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MaintenanceReport() {
  const { data, loading } = useReportData<DockWalkApiData>('dock-walk-summary');
  const violations = data?.violationsByType ?? [];
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Dock Walks', v: loading ? '…' : String(data?.totalWalks ?? 0) },
          { l: 'Open Violations', v: loading ? '…' : String(data?.totalViolations ?? 0) },
          { l: 'Pump-Outs', v: loading ? '…' : String(data?.pumpOuts ?? 0) },
          { l: 'Completion Rate', v: loading ? '…' : pct(parseFloat(data?.completionRate ?? '0')) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Maintenance Issues by Type</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Issue Type</th><th style={s.thRight}>Count</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={2} /> : violations.length === 0 ? <EmptyRow cols={2} msg="No maintenance issues in this period." /> : violations.map((v, i) => (
              <tr key={i}><td style={s.td}>{v.type || 'General'}</td><td style={s.tdRight}>{v.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface CustomerActivityApiData {
  total: number;
  active: number;
  newInPeriod: number;
  byStatus: { status: string; count: number }[];
}

function CustomerActivityReport() {
  const { data, loading } = useReportData<CustomerActivityApiData>('customer-activity');
  const byStatus = data?.byStatus ?? [];
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Total Customers', v: loading ? '…' : String(data?.total ?? 0) },
          { l: 'Active', v: loading ? '…' : String(data?.active ?? 0) },
          { l: 'New This Period', v: loading ? '…' : String(data?.newInPeriod ?? 0) },
          { l: 'Statuses', v: loading ? '…' : String(byStatus.length) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Customer Activity by Status</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Status</th><th style={s.thRight}>Count</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={2} /> : byStatus.length === 0 ? <EmptyRow cols={2} /> : byStatus.map((s_) => (
              <tr key={s_.status}><td style={s.td}>{s_.status}</td><td style={s.tdRight}>{s_.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface LeadConversionApiData {
  totalLeads: number;
  won: number;
  lost: number;
  conversionRate: string;
  byStage: { stage: string; count: number }[];
  bySource: { source: string; count: number }[];
}

function LeadConversionReport() {
  const { data, loading } = useReportData<LeadConversionApiData>('lead-conversion');
  const bySource = data?.bySource ?? [];
  const byStage = data?.byStage ?? [];
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Total Leads', v: loading ? '…' : String(data?.totalLeads ?? 0) },
          { l: 'Won', v: loading ? '…' : String(data?.won ?? 0) },
          { l: 'Lost', v: loading ? '…' : String(data?.lost ?? 0) },
          { l: 'Conversion Rate', v: loading ? '…' : pct(parseFloat(data?.conversionRate ?? '0')) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Leads by Source</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Source</th><th style={s.thRight}>Count</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={2} /> : bySource.length === 0 ? <EmptyRow cols={2} /> : bySource.map((r) => (
              <tr key={r.source}><td style={s.td}>{r.source || 'Direct'}</td><td style={s.tdRight}>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Pipeline by Stage</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Stage</th><th style={s.thRight}>Count</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={2} /> : byStage.length === 0 ? <EmptyRow cols={2} /> : byStage.map((r) => (
              <tr key={r.stage}><td style={s.td}>{r.stage}</td><td style={s.tdRight}>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SlipUtilizationReport() {
  const { data, loading } = useReportData<OccupancyApiData>('occupancy');
  const docks = data?.byDock ?? [];
  const sum = data?.summary ?? { total: 0, occupied: 0, vacant: 0, maintenance: 0, reserved: 0, occupancyRate: '0.0' };
  const avgRate = docks.length > 0 ? docks.reduce((s, d) => s + parseFloat(d.rate), 0) / docks.length : 0;
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Avg Utilization', v: loading ? '…' : pct(avgRate) },
          { l: 'Occupied Slips', v: loading ? '…' : String(sum.occupied) },
          { l: 'Vacant Slips', v: loading ? '…' : String(sum.vacant) },
          { l: 'Total Slips', v: loading ? '…' : String(sum.total) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Slip Utilization by Dock</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Dock</th><th style={s.thRight}>Total</th><th style={s.thRight}>Occupied</th><th style={s.thRight}>Utilization</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={4} /> : docks.length === 0 ? <EmptyRow cols={4} /> : docks.map((d) => (
              <tr key={d.dock}>
                <td style={{ ...s.td, fontWeight: 600 }}>{d.dock || '(no dock)'}</td>
                <td style={s.tdRight}>{d.total}</td>
                <td style={s.tdRight}>{d.occupied}</td>
                <td style={s.tdRight}><span style={s.badge(parseFloat(d.rate) >= 80 ? 'green' : parseFloat(d.rate) >= 50 ? 'yellow' : 'red')}>{pct(parseFloat(d.rate))}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface CollectionsAccount { id: string; status: string; balanceAtHandoffCents: number; recoveredCents: number; customer: { firstName: string; lastName: string } | null; }
interface CollectionsApiData { accountCount: number; totalHandoffCents: number; totalRecoveredCents: number; recoveryRate: string; byStatus: Record<string, number>; accounts: CollectionsAccount[]; }

function CollectionsReport() {
  const { data, loading } = useReportData<CollectionsApiData>('collections');
  const accounts = data?.accounts ?? [];
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Accounts', v: loading ? '…' : String(data?.accountCount ?? 0) },
          { l: 'Total Handed Off', v: loading ? '…' : fmtC(data?.totalHandoffCents ?? 0) },
          { l: 'Recovered', v: loading ? '…' : fmtC(data?.totalRecoveredCents ?? 0) },
          { l: 'Recovery Rate', v: loading ? '…' : pct(parseFloat(data?.recoveryRate ?? '0')) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Collections Accounts</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Customer</th><th style={s.th}>Status</th><th style={s.thRight}>Balance Handed Off</th><th style={s.thRight}>Recovered</th><th style={s.thRight}>Remaining</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={5} /> : accounts.length === 0 ? <EmptyRow cols={5} msg="No collections accounts." /> : accounts.map((a) => (
              <tr key={a.id}>
                <td style={{ ...s.td, fontWeight: 600 }}>{a.customer ? `${a.customer.firstName} ${a.customer.lastName}` : '—'}</td>
                <td style={s.td}><span style={s.badge(a.status === 'RECOVERED' ? 'green' : a.status === 'ACTIVE' ? 'red' : 'yellow')}>{a.status}</span></td>
                <td style={s.tdRight}>{fmtC(a.balanceAtHandoffCents)}</td>
                <td style={s.tdRight}>{fmtC(a.recoveredCents)}</td>
                <td style={s.tdRight}>{fmtC(a.balanceAtHandoffCents - a.recoveredCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface DeferredSchedule { id: string; customerId: string | null; startDate: string; endDate: string; totalCents: number; recognizedCents: number; }
interface DeferredApiData { scheduleCount: number; totalDeferredCents: number; totalRecognizedCents: number; remainingCents: number; schedules: DeferredSchedule[]; }

function DeferredRevenueReport() {
  const { data, loading } = useReportData<DeferredApiData>('deferred-revenue');
  const schedules = data?.schedules ?? [];
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Contracts', v: loading ? '…' : String(data?.scheduleCount ?? 0) },
          { l: 'Total Deferred', v: loading ? '…' : fmtC(data?.totalDeferredCents ?? 0) },
          { l: 'Recognized', v: loading ? '…' : fmtC(data?.totalRecognizedCents ?? 0) },
          { l: 'Remaining', v: loading ? '…' : fmtC(data?.remainingCents ?? 0) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Deferred Revenue Schedules</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Period</th><th style={s.thRight}>Total</th><th style={s.thRight}>Recognized</th><th style={s.thRight}>Deferred</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={4} /> : schedules.length === 0 ? <EmptyRow cols={4} msg="No deferred revenue schedules." /> : schedules.map((sc) => (
              <tr key={sc.id}>
                <td style={s.td}>{sc.startDate?.slice(0, 10)} → {sc.endDate?.slice(0, 10)}</td>
                <td style={s.tdRight}>{fmtC(sc.totalCents)}</td>
                <td style={s.tdRight}>{fmtC(sc.recognizedCents)}</td>
                <td style={s.tdRight}>{fmtC(sc.totalCents - sc.recognizedCents)}</td>
              </tr>
            ))}
            {!loading && schedules.length > 0 && (
              <tr style={s.totalRow}>
                <td style={{ ...s.td, fontWeight: 700 }}>Total</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(data!.totalDeferredCents)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(data!.totalRecognizedCents)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(data!.remainingCents)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface GlAccount { accountNumber: string; name: string; type: string; debitsCents: number; creditsCents: number; netCents: number; }
interface GlApiData { period: { startDate: string; endDate: string }; accounts: GlAccount[]; }

function GLSummaryReport() {
  const { data, loading } = useReportData<GlApiData>('gl-summary');
  const accounts = data?.accounts ?? [];
  const totalDebits = accounts.reduce((s, a) => s + a.debitsCents, 0);
  const totalCredits = accounts.reduce((s, a) => s + a.creditsCents, 0);
  const netRevenue = accounts.filter((a) => a.type === 'REVENUE').reduce((s, a) => s + a.creditsCents, 0);
  const totalExpenses = accounts.filter((a) => a.type === 'EXPENSE').reduce((s, a) => s + a.debitsCents, 0);
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'Total Debits', v: loading ? '…' : fmtC(totalDebits) },
          { l: 'Total Credits', v: loading ? '…' : fmtC(totalCredits) },
          { l: 'Net Revenue', v: loading ? '…' : fmtC(netRevenue) },
          { l: 'Total Expenses', v: loading ? '…' : fmtC(totalExpenses) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>General Ledger Summary</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Account</th><th style={s.th}>Type</th><th style={s.thRight}>Debit</th><th style={s.thRight}>Credit</th><th style={s.thRight}>Net</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={5} /> : accounts.length === 0 ? <EmptyRow cols={5} msg="No GL entries for this period." /> : accounts.map((a) => (
              <tr key={a.accountNumber}>
                <td style={s.td}>{a.accountNumber} · {a.name}</td>
                <td style={s.tdMuted}>{a.type}</td>
                <td style={s.tdRight}>{a.debitsCents > 0 ? fmtC(a.debitsCents) : '—'}</td>
                <td style={s.tdRight}>{a.creditsCents > 0 ? fmtC(a.creditsCents) : '—'}</td>
                <td style={{ ...s.tdRight, fontWeight: 600, color: a.netCents >= 0 ? '#059669' : '#DC2626' }}>{fmtC(Math.abs(a.netCents))}</td>
              </tr>
            ))}
            {!loading && accounts.length > 0 && (
              <tr style={s.totalRow}>
                <td colSpan={2} style={{ ...s.td, fontWeight: 700 }}>Total</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(totalDebits)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(totalCredits)}</td>
                <td style={{ ...s.tdRight, fontWeight: 700 }}>{fmtC(Math.abs(totalCredits - totalDebits))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface WaitlistApiData { totalEntries: number; bySlipType: { slipType: string | null; count: number }[]; byStatus: { status: string; count: number }[]; }

function WaitlistReport() {
  const { data, loading } = useReportData<WaitlistApiData>('waitlist');
  const bySlipType = data?.bySlipType ?? [];
  const byStatus = data?.byStatus ?? [];
  return (
    <>
      <div style={s.kpiRow}>
        {[
          { l: 'On Waitlist', v: loading ? '…' : String(data?.totalEntries ?? 0) },
          { l: 'Slip Types', v: loading ? '…' : String(bySlipType.length) },
          { l: 'Active', v: loading ? '…' : String(byStatus.find((s_) => s_.status === 'ACTIVE')?.count ?? 0) },
          { l: 'Offered', v: loading ? '…' : String(byStatus.find((s_) => s_.status === 'OFFERED')?.count ?? 0) },
        ].map((k) => (
          <div key={k.l} style={s.kpiCard}><div style={s.kpiLabel}>{k.l}</div><div style={s.kpiValue}>{k.v}</div></div>
        ))}
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Waitlist by Slip Type</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Slip Type</th><th style={s.thRight}>Count</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={2} /> : bySlipType.length === 0 ? <EmptyRow cols={2} msg="Waitlist is empty." /> : bySlipType.map((r) => (
              <tr key={r.slipType ?? 'none'}><td style={s.td}>{r.slipType || 'Any'}</td><td style={s.tdRight}>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={s.section}>
        <div style={s.sectionHeader}><h3 style={s.sectionTitle}>Waitlist by Status</h3></div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Status</th><th style={s.thRight}>Count</th></tr></thead>
          <tbody>
            {loading ? <LoadingRow cols={2} /> : byStatus.length === 0 ? <EmptyRow cols={2} msg="Waitlist is empty." /> : byStatus.map((r) => (
              <tr key={r.status}><td style={s.td}>{r.status}</td><td style={s.tdRight}>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Report metadata ────────────────────────────────────── */

const reportMeta: Record<string, { title: string; subtitle: string; component: () => JSX.Element }> = {
  revenue: { title: 'Revenue Summary', subtitle: 'Payment collections & invoicing', component: RevenueSummary },
  aging: { title: 'Accounts Receivable Aging', subtitle: 'Open invoices by age', component: ARAgingReport },
  collections: { title: 'Collections Report', subtitle: 'Collections accounts', component: CollectionsReport },
  deferred: { title: 'Deferred Revenue', subtitle: 'Prepaid revenue schedules', component: DeferredRevenueReport },
  gl: { title: 'GL Summary', subtitle: 'General ledger activity', component: GLSummaryReport },
  occupancy: { title: 'Occupancy Report', subtitle: 'Current slip occupancy', component: OccupancyReport },
  utilization: { title: 'Slip Utilization', subtitle: 'Dock-by-dock occupancy rates', component: SlipUtilizationReport },
  dockwalk: { title: 'Dock Walk Summary', subtitle: 'Inspection activity & violations', component: DockWalkReport },
  maintenance: { title: 'Maintenance Log', subtitle: 'Issues from dock walk inspections', component: MaintenanceReport },
  customer_activity: { title: 'Customer Activity', subtitle: 'Customer status breakdown', component: CustomerActivityReport },
  leads: { title: 'Lead Conversion', subtitle: 'Pipeline & source analytics', component: LeadConversionReport },
  waitlist: { title: 'Waitlist Analytics', subtitle: 'Waitlist queue by type & status', component: WaitlistReport },
  rental_util: { title: 'Rental Utilization', subtitle: 'Booking & revenue by product', component: RentalUtilReport },
  pos_sales: { title: 'POS Sales Summary', subtitle: 'Point-of-sale transactions', component: POSSalesReport },
  inventory: { title: 'Inventory Valuation', subtitle: 'Tracked product stock & value', component: InventoryReport },
};

/* ── Main viewer ────────────────────────────────────────── */

interface ReportViewerProps {
  reportId: string;
  onClose: () => void;
}

export default function ReportViewer({ reportId, onClose }: ReportViewerProps) {
  const navigate = useNavigate();
  const meta = reportMeta[reportId];
  const [dateFrom, setDateFrom] = useState('2026-03-01');
  const [dateTo, setDateTo] = useState('2026-03-25');
  if (!meta) return null;
  const ReportContent = meta.component;
  return (
    <ReportContext.Provider value={{ navigate: (to) => { onClose(); navigate(to); }, dateFrom, dateTo }}>
      <div style={s.overlay} onClick={onClose}>
        <div style={s.panel} className="helm-detail-panel" onClick={(e) => e.stopPropagation()}>
          <div style={s.header}>
            <div>
              <h2 style={s.headerTitle}>{meta.title}</h2>
              <div style={s.headerSub}>{meta.subtitle} · Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
            </div>
            <div style={s.headerActions}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#FFFFFF' }}>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' }}
                />
                <span style={{ opacity: 0.6 }}>→</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' }}
                />
              </div>
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
    </ReportContext.Provider>
  );
}
