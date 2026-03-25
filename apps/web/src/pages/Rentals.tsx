import { useState } from 'react';
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

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_PRODUCTS: RentalProduct[] = [
  { id: '1', name: '22ft Pontoon Boat', category: 'WATERCRAFT', hourlyRateCents: 15000, dailyRateCents: 60000, weeklyRateCents: 350000, totalQuantity: 4, availableQuantity: 2, utilizationPct: 50, isActive: true },
  { id: '2', name: '16ft Fishing Boat', category: 'WATERCRAFT', hourlyRateCents: 8500, dailyRateCents: 35000, weeklyRateCents: 200000, totalQuantity: 6, availableQuantity: 4, utilizationPct: 33.33, isActive: true },
  { id: '3', name: 'Jet Ski (Yamaha WaveRunner)', category: 'WATERCRAFT', hourlyRateCents: 12000, dailyRateCents: 45000, weeklyRateCents: null, totalQuantity: 8, availableQuantity: 3, utilizationPct: 62.5, isActive: true },
  { id: '4', name: 'Kayak (Single)', category: 'EQUIPMENT', hourlyRateCents: 2500, dailyRateCents: 8000, weeklyRateCents: null, totalQuantity: 12, availableQuantity: 10, utilizationPct: 16.67, isActive: true },
  { id: '5', name: 'Paddleboard', category: 'EQUIPMENT', hourlyRateCents: 2000, dailyRateCents: 6000, weeklyRateCents: null, totalQuantity: 8, availableQuantity: 6, utilizationPct: 25, isActive: true },
  { id: '6', name: 'Dry Storage Unit (10x20)', category: 'STORAGE', hourlyRateCents: null, dailyRateCents: null, weeklyRateCents: 25000, totalQuantity: 20, availableQuantity: 5, utilizationPct: 75, isActive: true },
];

const MOCK_RESERVATIONS: Reservation[] = [
  { id: 'r1', productName: '22ft Pontoon Boat', customerName: 'James Morrison', startDate: '2026-03-26', endDate: '2026-03-26', status: 'CONFIRMED', totalCents: 60000 },
  { id: 'r2', productName: 'Jet Ski (Yamaha WaveRunner)', customerName: 'Linda Park', startDate: '2026-03-26', endDate: '2026-03-26', status: 'CHECKED_IN', totalCents: 12000 },
  { id: 'r3', productName: '16ft Fishing Boat', customerName: 'Robert Chen', startDate: '2026-03-27', endDate: '2026-03-28', status: 'CONFIRMED', totalCents: 70000 },
  { id: 'r4', productName: 'Kayak (Single)', customerName: 'Maria Santos', startDate: '2026-03-25', endDate: '2026-03-25', status: 'CHECKED_OUT', totalCents: 2500 },
  { id: 'r5', productName: '22ft Pontoon Boat', customerName: 'David Kim', startDate: '2026-03-28', endDate: '2026-03-30', status: 'PENDING', totalCents: 180000 },
  { id: 'r6', productName: 'Paddleboard', customerName: 'Susan Wright', startDate: '2026-03-24', endDate: '2026-03-24', status: 'CANCELLED', totalCents: 2000 },
];

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
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showAddProduct, setShowAddProduct] = useState(false);

  const products = MOCK_PRODUCTS.filter((p) => {
    if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const reservations = MOCK_RESERVATIONS.filter((r) => {
    if (statusFilter !== 'All' && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.customerName.toLowerCase().includes(q) && !r.productName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalRevenue = MOCK_RESERVATIONS.filter((r) => r.status === 'CHECKED_OUT').reduce((s, r) => s + r.totalCents, 0);
  const activeBookings = MOCK_RESERVATIONS.filter((r) => ['CONFIRMED', 'CHECKED_IN'].includes(r.status)).length;
  const avgUtilization = MOCK_PRODUCTS.reduce((s, p) => s + p.utilizationPct, 0) / MOCK_PRODUCTS.length;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Rentals</h1>
      <hr style={s.divider} />

      {/* Metrics */}
      <div style={s.metricGrid}>
        <div style={s.metricCard}>
          <p style={s.metricLabel}>Active Bookings</p>
          <p style={s.metricValue}>{activeBookings}</p>
          <p style={s.metricSub}>{MOCK_RESERVATIONS.filter((r) => r.status === 'CHECKED_IN').length} checked in</p>
        </div>
        <div style={s.metricCard}>
          <p style={s.metricLabel}>Revenue (Completed)</p>
          <p style={s.metricValue}>{fmt(totalRevenue)}</p>
          <p style={s.metricSub}>{MOCK_RESERVATIONS.filter((r) => r.status === 'CHECKED_OUT').length} completed</p>
        </div>
        <div style={s.metricCard}>
          <p style={s.metricLabel}>Fleet Size</p>
          <p style={s.metricValue}>{MOCK_PRODUCTS.reduce((s, p) => s + p.totalQuantity, 0)}</p>
          <p style={s.metricSub}>{MOCK_PRODUCTS.length} products</p>
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
