import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import {
  Ship,
  Plus,
  Search,
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
  LayoutGrid,
  List,
  X,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type Tab = 'products' | 'reservations' | 'pricing';
type Category = 'WATERCRAFT' | 'STORAGE' | 'EQUIPMENT' | 'SLIP' | 'OTHER';
type ResStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';

interface RentalProduct {
  id: string;
  name: string;
  category: Category;
  hourlyRateCents: number | null;
  dailyRateCents: number | null;
  weeklyRateCents: number | null;
  totalQuantity: number;
  availableQuantity: number;
  utilizationPct: number;
  isActive: boolean;
}

interface Reservation {
  id: string;
  productName: string;
  customerName: string;
  startDate: string;
  endDate: string;
  status: ResStatus;
  totalCents: number;
}

/* ── Data fetching hook ──────────────────────────────── */

function useRentalsData() {
  const [allProducts, setAllProducts] = useState<RentalProduct[]>([]);
  const [allReservations, setAllReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get<{ products: Array<Record<string, unknown>> }>('/rentals/products'),
      api.get<{ reservations: Array<Record<string, unknown>> }>('/rentals/reservations'),
    ]).then(([prodRes, resRes]) => {
      if (prodRes.status === 'fulfilled') {
        setAllProducts((prodRes.value.products ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          category: (p.category as Category) ?? 'OTHER',
          hourlyRateCents: (p.basePriceCents as number) ?? null,
          dailyRateCents: (p.basePriceCents as number) ?? null,
          weeklyRateCents: null,
          totalQuantity: 1,
          availableQuantity: p.active ? 1 : 0,
          utilizationPct: 0,
          isActive: (p.active as boolean) ?? true,
        })));
      }
      if (resRes.status === 'fulfilled') {
        setAllReservations((resRes.value.reservations ?? []).map((r) => ({
          id: r.id as string,
          productName: ((r.product as Record<string, unknown>)?.name as string) ?? '',
          customerName: ((r.customer as Record<string, unknown>)?.firstName as string ?? '') + ' ' + ((r.customer as Record<string, unknown>)?.lastName as string ?? ''),
          startDate: ((r.startDate as string) ?? '').slice(0, 10),
          endDate: ((r.endDate as string) ?? '').slice(0, 10),
          status: (r.status as ResStatus) ?? 'PENDING',
          totalCents: (r.totalCents as number) ?? 0,
        })));
      }
    }).finally(() => setLoading(false));
  }, []);

  return { allProducts, allReservations, loading };
}

/* ── Colors ────────────────────────────────────────────── */

const STATUS_COLORS: Record<ResStatus, { bg: string; text: string }> = {
  PENDING: { bg: '#FFF3CD', text: '#856404' },
  CONFIRMED: { bg: '#D6E8F4', text: '#0A2342' },
  CHECKED_IN: { bg: '#E8F5E9', text: '#1B5E20' },
  CHECKED_OUT: { bg: '#F3F4F6', text: '#6B7280' },
  CANCELLED: { bg: '#FDECEA', text: '#B71C1C' },
  NO_SHOW: { bg: '#FCE4EC', text: '#880E4F' },
};

const CATEGORY_COLORS: Record<Category, { bg: string; text: string }> = {
  WATERCRAFT: { bg: '#D6E8F4', text: '#0A2342' },
  STORAGE: { bg: '#E8D5F5', text: '#6B21A8' },
  EQUIPMENT: { bg: '#E8F5E9', text: '#1B5E20' },
  SLIP: { bg: '#FFF3CD', text: '#856404' },
  OTHER: { bg: '#F3F4F6', text: '#6B7280' },
};

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '2px solid #E2E8F0', paddingBottom: '0' },
  tab: { padding: '10px 20px', fontSize: '14px', fontWeight: 600, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #0A2342' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute' as const, left: '10px', color: '#2E4A6B', pointerEvents: 'none' as const },
  searchInput: { padding: '8px 12px 8px 34px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', width: '220px', outline: 'none' },
  select: { padding: '8px 32px 8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', appearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', cursor: 'pointer', minWidth: '140px' },
  spacer: { flex: 1 },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' },
  metricCard: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  metricLabel: { fontSize: '13px', color: '#64748B', margin: '0 0 4px 0' },
  metricValue: { fontSize: '28px', fontWeight: 700, color: '#0A2342', margin: 0 },
  metricSub: { fontSize: '12px', color: '#64748B', marginTop: '4px' },
  productGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' },
  productCard: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  productName: { fontSize: '17px', fontWeight: 600, color: '#0A2342', margin: '0 0 8px 0' },
  productMeta: { fontSize: '13px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px', margin: '4px 0' },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, lineHeight: '18px' },
  utilBar: { height: '6px', background: '#E2E8F0', borderRadius: '3px', marginTop: '12px', overflow: 'hidden' },
  utilFill: { height: '100%', borderRadius: '3px' },
  table: { width: '100%', borderCollapse: 'collapse' as const, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  th: { backgroundColor: '#0A2342', color: '#FFFFFF', padding: '12px 16px', fontSize: '13px', fontWeight: 600, textAlign: 'left' as const, whiteSpace: 'nowrap' as const },
  td: { padding: '12px 16px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  rowOdd: { backgroundColor: '#FFFFFF' },
  rowEven: { backgroundColor: '#D6E8F4' },
  modal: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { background: '#FFF', borderRadius: '12px', padding: '32px', width: '520px', maxHeight: '80vh', overflow: 'auto' },
  modalTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: '0 0 24px 0' },
  formGroup: { marginBottom: '16px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '4px' },
  input: { width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '6px', boxSizing: 'border-box' as const },
};

/* ── Helpers ───────────────────────────────────────────── */

const fmt = (cents: number | null) => cents != null ? `$${(cents / 100).toFixed(2)}` : '—';

/* ── Component ─────────────────────────────────────────── */

export default function Rentals() {
  const { allProducts, allReservations, loading } = useRentalsData();
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showAddProduct, setShowAddProduct] = useState(false);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '64px', color: '#64748B' }}>Loading rentals...</div>;

  const products = allProducts.filter((p) => {
    if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const reservations = allReservations.filter((r) => {
    if (statusFilter !== 'All' && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.customerName.toLowerCase().includes(q) && !r.productName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalRevenue = allReservations.filter((r) => r.status === 'CHECKED_OUT').reduce((s, r) => s + r.totalCents, 0);
  const activeBookings = allReservations.filter((r) => ['CONFIRMED', 'CHECKED_IN'].includes(r.status)).length;
  const avgUtilization = allProducts.length > 0 ? allProducts.reduce((s, p) => s + p.utilizationPct, 0) / allProducts.length : 0;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Rentals</h1>
      <hr style={s.divider} />

      {/* Metrics */}
      <div style={s.metricGrid}>
        <div style={s.metricCard}>
          <p style={s.metricLabel}>Active Bookings</p>
          <p style={s.metricValue}>{activeBookings}</p>
          <p style={s.metricSub}>{allReservations.filter((r) => r.status === 'CHECKED_IN').length} checked in</p>
        </div>
        <div style={s.metricCard}>
          <p style={s.metricLabel}>Revenue (Completed)</p>
          <p style={s.metricValue}>{fmt(totalRevenue)}</p>
          <p style={s.metricSub}>{allReservations.filter((r) => r.status === 'CHECKED_OUT').length} completed</p>
        </div>
        <div style={s.metricCard}>
          <p style={s.metricLabel}>Fleet Size</p>
          <p style={s.metricValue}>{allProducts.reduce((s, p) => s + p.totalQuantity, 0)}</p>
          <p style={s.metricSub}>{allProducts.length} products</p>
        </div>
        <div style={s.metricCard}>
          <p style={s.metricLabel}>Avg Utilization</p>
          <p style={s.metricValue}>{avgUtilization.toFixed(1)}%</p>
          <div style={s.utilBar}><div style={{ ...s.utilFill, width: `${avgUtilization}%`, background: avgUtilization > 70 ? '#DC2626' : avgUtilization > 40 ? '#F59E0B' : '#10B981' }} /></div>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {(['products', 'reservations', 'pricing'] as Tab[]).map((t) => (
          <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }} onClick={() => setTab(t)}>
            {t === 'products' ? 'Products' : t === 'reservations' ? 'Reservations' : 'Pricing Rules'}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div style={s.filterBar}>
        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input style={s.searchInput} placeholder={tab === 'reservations' ? 'Search bookings...' : 'Search products...'} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {tab === 'products' && (
          <select style={s.select} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="All">All Categories</option>
            {['WATERCRAFT', 'STORAGE', 'EQUIPMENT', 'SLIP', 'OTHER'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {tab === 'reservations' && (
          <select style={s.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All Statuses</option>
            {['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].map((st) => <option key={st} value={st}>{st.replace('_', ' ')}</option>)}
          </select>
        )}
        <div style={s.spacer} />
        {tab === 'products' && (
          <button style={s.primaryBtn} onClick={() => setShowAddProduct(true)}>
            <Plus size={16} /> Add Product
          </button>
        )}
      </div>

      {/* Products Tab */}
      {tab === 'products' && (
        <div style={s.productGrid}>
          {products.map((p) => (
            <div key={p.id} style={s.productCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <h3 style={s.productName}>{p.name}</h3>
                <span style={{ ...s.badge, ...CATEGORY_COLORS[p.category] }}>{p.category}</span>
              </div>
              <div style={s.productMeta}><DollarSign size={13} /> Hourly: {fmt(p.hourlyRateCents)} · Daily: {fmt(p.dailyRateCents)} · Weekly: {fmt(p.weeklyRateCents)}</div>
              <div style={s.productMeta}><Ship size={13} /> {p.availableQuantity} of {p.totalQuantity} available</div>
              <div style={s.utilBar}>
                <div style={{ ...s.utilFill, width: `${p.utilizationPct}%`, background: p.utilizationPct > 70 ? '#DC2626' : p.utilizationPct > 40 ? '#F59E0B' : '#10B981' }} />
              </div>
              <p style={{ fontSize: '12px', color: '#64748B', margin: '6px 0 0 0' }}>{p.utilizationPct.toFixed(1)}% utilized</p>
            </div>
          ))}
          {products.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px', color: '#64748B' }}>
              No products match the current filters.
            </div>
          )}
        </div>
      )}

      {/* Reservations Tab */}
      {tab === 'reservations' && (
        <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Customer</th>
                <th style={s.th}>Product</th>
                <th style={s.th}>Start</th>
                <th style={s.th}>End</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r, idx) => (
                <tr key={r.id} style={idx % 2 === 0 ? s.rowOdd : s.rowEven}>
                  <td style={s.td}>{r.customerName}</td>
                  <td style={s.td}>{r.productName}</td>
                  <td style={s.td}>{r.startDate}</td>
                  <td style={s.td}>{r.endDate}</td>
                  <td style={s.td}><span style={{ ...s.badge, ...STATUS_COLORS[r.status] }}>{r.status.replace('_', ' ')}</span></td>
                  <td style={s.td}>{fmt(r.totalCents)}</td>
                </tr>
              ))}
              {reservations.length === 0 && (
                <tr><td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={6}>No reservations match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pricing Rules Tab */}
      {tab === 'pricing' && (
        <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Rule Name</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Base Rate</th>
                <th style={s.th}>Season</th>
                <th style={s.th}>Multiplier</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Summer Peak', type: 'SEASONAL', baseCents: 0, seasonStart: '06-01', seasonEnd: '08-31', multiplier: 1.5, active: true },
                { name: 'Holiday Surcharge', type: 'SEASONAL', baseCents: 0, seasonStart: '12-20', seasonEnd: '01-02', multiplier: 1.75, active: true },
                { name: 'Weekday Discount', type: 'FLAT', baseCents: 45000, seasonStart: null, seasonEnd: null, multiplier: 0.85, active: true },
                { name: 'High Demand Surge', type: 'DEMAND', baseCents: 0, seasonStart: null, seasonEnd: null, multiplier: 1.25, active: true },
              ].map((rule, idx) => (
                <tr key={idx} style={idx % 2 === 0 ? s.rowOdd : s.rowEven}>
                  <td style={s.td}>{rule.name}</td>
                  <td style={s.td}><span style={{ ...s.badge, bg: '#E0F2FE', text: '#0369A1', backgroundColor: '#E0F2FE', color: '#0369A1' }}>{rule.type}</span></td>
                  <td style={s.td}>{rule.baseCents ? fmt(rule.baseCents) : '—'}</td>
                  <td style={s.td}>{rule.seasonStart && rule.seasonEnd ? `${rule.seasonStart} → ${rule.seasonEnd}` : '—'}</td>
                  <td style={s.td}>{rule.multiplier}x</td>
                  <td style={s.td}><span style={{ ...s.badge, backgroundColor: rule.active ? '#E8F5E9' : '#FDECEA', color: rule.active ? '#1B5E20' : '#B71C1C' }}>{rule.active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddProduct && (
        <div style={s.modal} onClick={() => setShowAddProduct(false)}>
          <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={s.modalTitle}>Add Rental Product</h2>
              <button onClick={() => setShowAddProduct(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div style={s.formGroup}><label style={s.label}>Name</label><input style={s.input} placeholder="e.g., 22ft Pontoon Boat" /></div>
            <div style={s.formGroup}>
              <label style={s.label}>Category</label>
              <select style={{ ...s.input, ...s.select }}><option>WATERCRAFT</option><option>STORAGE</option><option>EQUIPMENT</option><option>SLIP</option><option>OTHER</option></select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div style={s.formGroup}><label style={s.label}>Hourly Rate ($)</label><input style={s.input} type="number" placeholder="0.00" /></div>
              <div style={s.formGroup}><label style={s.label}>Daily Rate ($)</label><input style={s.input} type="number" placeholder="0.00" /></div>
              <div style={s.formGroup}><label style={s.label}>Weekly Rate ($)</label><input style={s.input} type="number" placeholder="0.00" /></div>
            </div>
            <div style={s.formGroup}><label style={s.label}>Total Quantity</label><input style={s.input} type="number" placeholder="1" defaultValue={1} /></div>
            <div style={s.formGroup}><label style={s.label}>Description</label><textarea style={{ ...s.input, minHeight: '80px', resize: 'vertical' }} placeholder="Optional description..." /></div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button style={s.primaryBtn} onClick={() => setShowAddProduct(false)}>Create Product</button>
              <button style={{ ...s.primaryBtn, backgroundColor: '#FFF', color: '#0A2342', border: '1px solid #0A2342' }} onClick={() => setShowAddProduct(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
