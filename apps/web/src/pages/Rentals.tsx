import React, { useState } from 'react';
import {
  Ship, Search, Plus, X, Calendar, Tag, DollarSign,
  Star, Clock, Users, Filter, Eye,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type ProductStatus = 'Available' | 'Maintenance' | 'Retired';
type ReservationStatus = 'Pending' | 'Confirmed' | 'Checked In' | 'Checked Out' | 'Cancelled' | 'No Show';

interface RentalProduct {
  id: string;
  name: string;
  type: string;
  capacity: number;
  hourlyRate: number;
  halfDayRate: number;
  dailyRate: number;
  status: ProductStatus;
  rating: number;
  totalBookings: number;
}

interface Reservation {
  id: string;
  number: string;
  customer: string;
  product: string;
  date: string;
  timeSlot: string;
  duration: string;
  total: number;
  status: ReservationStatus;
  notes: string;
}

interface PricingRule {
  id: string;
  name: string;
  type: string;
  adjustment: number;
  startDate: string;
  endDate: string;
  active: boolean;
}

interface PromoCode {
  id: string;
  code: string;
  discount: number;
  discountType: '%' | '$';
  validFrom: string;
  validTo: string;
  uses: number;
  maxUses: number;
  active: boolean;
}

/* ── Mock Data ─────────────────────────────────────────── */

const PRODUCTS: RentalProduct[] = [
  { id: '1', name: 'Bay Cruiser 24', type: 'Pontoon', capacity: 10, hourlyRate: 85, halfDayRate: 280, dailyRate: 450, status: 'Available', rating: 4.8, totalBookings: 142 },
  { id: '2', name: 'Wave Runner Pro', type: 'Jet Ski', capacity: 2, hourlyRate: 65, halfDayRate: 200, dailyRate: 350, status: 'Available', rating: 4.6, totalBookings: 218 },
  { id: '3', name: 'Harbor Explorer', type: 'Kayak', capacity: 2, hourlyRate: 25, halfDayRate: 60, dailyRate: 90, status: 'Available', rating: 4.9, totalBookings: 305 },
  { id: '4', name: 'Sunset Sailor 28', type: 'Sailboat', capacity: 6, hourlyRate: 95, halfDayRate: 320, dailyRate: 520, status: 'Available', rating: 4.7, totalBookings: 87 },
  { id: '5', name: 'Fishing Charter 30', type: 'Powerboat', capacity: 8, hourlyRate: 120, halfDayRate: 400, dailyRate: 650, status: 'Maintenance', rating: 4.5, totalBookings: 64 },
  { id: '6', name: 'Paddleboard Classic', type: 'Paddleboard', capacity: 1, hourlyRate: 20, halfDayRate: 45, dailyRate: 70, status: 'Available', rating: 4.4, totalBookings: 189 },
  { id: '7', name: 'Family Pontoon 28', type: 'Pontoon', capacity: 12, hourlyRate: 110, halfDayRate: 360, dailyRate: 580, status: 'Available', rating: 4.8, totalBookings: 96 },
  { id: '8', name: 'Speed Demon X2', type: 'Jet Ski', capacity: 2, hourlyRate: 70, halfDayRate: 220, dailyRate: 380, status: 'Retired', rating: 4.2, totalBookings: 156 },
];

const RESERVATIONS: Reservation[] = [
  { id: '1', number: 'RES-1042', customer: 'James Harborview', product: 'Bay Cruiser 24', date: '2026-03-25', timeSlot: '9:00 AM - 1:00 PM', duration: '4 hours', total: 340, status: 'Checked In', notes: '' },
  { id: '2', number: 'RES-1043', customer: 'Maria Seabreeze', product: 'Wave Runner Pro', date: '2026-03-25', timeSlot: '10:00 AM - 12:00 PM', duration: '2 hours', total: 130, status: 'Confirmed', notes: 'Birthday celebration' },
  { id: '3', number: 'RES-1044', customer: 'Robert Dockside', product: 'Harbor Explorer', date: '2026-03-25', timeSlot: '2:00 PM - 4:00 PM', duration: '2 hours', total: 50, status: 'Pending', notes: '' },
  { id: '4', number: 'RES-1045', customer: 'Elena Windward', product: 'Sunset Sailor 28', date: '2026-03-26', timeSlot: '8:00 AM - 4:00 PM', duration: 'Full Day', total: 520, status: 'Confirmed', notes: 'Experienced sailor' },
  { id: '5', number: 'RES-1046', customer: 'David Tidewater', product: 'Bay Cruiser 24', date: '2026-03-24', timeSlot: '1:00 PM - 5:00 PM', duration: '4 hours', total: 340, status: 'Checked Out', notes: '' },
  { id: '6', number: 'RES-1047', customer: 'Sarah Coastline', product: 'Paddleboard Classic', date: '2026-03-24', timeSlot: '10:00 AM - 12:00 PM', duration: '2 hours', total: 40, status: 'No Show', notes: '' },
  { id: '7', number: 'RES-1048', customer: 'Mike Anchorage', product: 'Family Pontoon 28', date: '2026-03-27', timeSlot: '9:00 AM - 5:00 PM', duration: 'Full Day', total: 580, status: 'Confirmed', notes: 'Family reunion - 10 guests' },
  { id: '8', number: 'RES-1049', customer: 'Lisa Bayfront', product: 'Wave Runner Pro', date: '2026-03-23', timeSlot: '3:00 PM - 5:00 PM', duration: '2 hours', total: 130, status: 'Cancelled', notes: 'Weather concern' },
  { id: '9', number: 'RES-1050', customer: 'Tom Seaside', product: 'Harbor Explorer', date: '2026-03-26', timeSlot: '8:00 AM - 10:00 AM', duration: '2 hours', total: 50, status: 'Pending', notes: '' },
  { id: '10', number: 'RES-1051', customer: 'Amy Portview', product: 'Fishing Charter 30', date: '2026-03-28', timeSlot: '6:00 AM - 2:00 PM', duration: 'Full Day', total: 650, status: 'Confirmed', notes: 'Deep sea fishing' },
];

const PRICING_RULES: PricingRule[] = [
  { id: '1', name: 'Summer Peak Season', type: 'Seasonal', adjustment: 25, startDate: '2026-06-01', endDate: '2026-09-01', active: true },
  { id: '2', name: 'Weekend Surcharge', type: 'Peak Day', adjustment: 15, startDate: '2026-01-01', endDate: '2026-12-31', active: true },
  { id: '3', name: 'Early Bird Discount', type: 'Lead Time', adjustment: -10, startDate: '2026-01-01', endDate: '2026-12-31', active: true },
  { id: '4', name: 'Multi-Day Discount', type: 'Multi-day', adjustment: -15, startDate: '2026-01-01', endDate: '2026-12-31', active: true },
  { id: '5', name: 'Holiday Premium', type: 'Peak Day', adjustment: 30, startDate: '2026-05-22', endDate: '2026-05-25', active: true },
  { id: '6', name: 'Winter Off-Season', type: 'Seasonal', adjustment: -20, startDate: '2026-11-01', endDate: '2027-03-01', active: false },
];

const PROMO_CODES: PromoCode[] = [
  { id: '1', code: 'WELCOME20', discount: 20, discountType: '%', validFrom: '2026-01-01', validTo: '2026-12-31', uses: 34, maxUses: 100, active: true },
  { id: '2', code: 'SUMMER50', discount: 50, discountType: '$', validFrom: '2026-06-01', validTo: '2026-08-31', uses: 0, maxUses: 50, active: true },
  { id: '3', code: 'LOYALTY15', discount: 15, discountType: '%', validFrom: '2026-01-01', validTo: '2026-12-31', uses: 12, maxUses: 0, active: true },
  { id: '4', code: 'SPRING10', discount: 10, discountType: '%', validFrom: '2026-03-01', validTo: '2026-05-31', uses: 8, maxUses: 25, active: true },
  { id: '5', code: 'FLASHSALE', discount: 30, discountType: '%', validFrom: '2026-02-01', validTo: '2026-02-28', uses: 25, maxUses: 25, active: false },
];

/* ── Styles ─────────────────────────────────────────────── */

const productStatusColors: Record<ProductStatus, { bg: string; color: string }> = {
  Available: { bg: '#DEF7EC', color: '#03543F' },
  Maintenance: { bg: '#FFF3CD', color: '#856404' },
  Retired: { bg: '#FDE8E8', color: '#9B1C1C' },
};

const resStatusColors: Record<ReservationStatus, { bg: string; color: string }> = {
  Pending: { bg: '#E0F7FF', color: '#0A2342' },
  Confirmed: { bg: '#DEF7EC', color: '#03543F' },
  'Checked In': { bg: '#D6E8F4', color: '#0A2342' },
  'Checked Out': { bg: '#F3F4F6', color: '#64748B' },
  Cancelled: { bg: '#FDE8E8', color: '#9B1C1C' },
  'No Show': { bg: '#FFF3CD', color: '#856404' },
};

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '13px', color: '#2E4A6B', marginTop: '2px' },
  tabs: { display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px', transition: 'all 0.15s' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, flex: 1, minWidth: '200px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '14px' },
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10, 35, 66, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '8px', width: '560px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px 16px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: '22px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px' },
  modalBody: { padding: '24px 32px' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const, width: '100%' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 32px 24px', borderTop: '1px solid #E2E8F0' },
  cancelBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  saveBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  detailPanel: { position: 'fixed' as const, top: 0, right: 0, width: '420px', height: '100vh', background: '#FFFFFF', boxShadow: '-4px 0 12px rgba(0,0,0,0.1)', zIndex: 1000, overflow: 'auto' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', borderBottom: '1px solid #E2E8F0' },
  detailSection: { padding: '20px 24px', borderBottom: '1px solid #E2E8F0' },
  detailLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  detailValue: { fontSize: '15px', color: '#0A2342', marginBottom: '12px' },
  toggleTrack: { width: '40px', height: '22px', borderRadius: '11px', cursor: 'pointer', position: 'relative' as const, transition: 'background 0.2s', border: 'none', padding: 0 },
  toggleThumb: { width: '18px', height: '18px', borderRadius: '50%', background: '#FFFFFF', position: 'absolute' as const, top: '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' },
};

/* ── Add Product Modal ─────────────────────────────────── */

function AddProductModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Add Rental Product</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.field}>
            <label style={st.label}>Product Name *</label>
            <input style={st.input} placeholder="e.g. Bay Cruiser 24" />
          </div>
          <div style={st.twoCol}>
            <div style={st.field}>
              <label style={st.label}>Type *</label>
              <select style={{ ...st.input, cursor: 'pointer' }}>
                <option value="">Select type...</option>
                <option>Pontoon</option>
                <option>Jet Ski</option>
                <option>Kayak</option>
                <option>Paddleboard</option>
                <option>Sailboat</option>
                <option>Powerboat</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Capacity</label>
              <input style={st.input} type="number" placeholder="e.g. 10" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Hourly Rate ($)</label>
              <input style={st.input} type="number" placeholder="85.00" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Half-Day Rate ($)</label>
              <input style={st.input} type="number" placeholder="280.00" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Daily Rate ($)</label>
              <input style={st.input} type="number" placeholder="450.00" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Status</label>
              <select style={{ ...st.input, cursor: 'pointer' }}>
                <option>Available</option>
                <option>Maintenance</option>
                <option>Retired</option>
              </select>
            </div>
          </div>
          <div style={st.field}>
            <label style={st.label}>Description</label>
            <textarea style={{ ...st.input, minHeight: '80px', resize: 'vertical' as const }} placeholder="Brief description of the rental product..." />
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={onClose}>Save Product</button>
        </div>
      </div>
    </div>
  );
}

/* ── Reservation Detail Panel ──────────────────────────── */

function ReservationDetail({ res, onClose }: { res: Reservation; onClose: () => void }) {
  const sc = resStatusColors[res.status];
  return (
    <div style={st.detailPanel}>
      <div style={st.detailHeader}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 }}>{res.number}</h2>
        <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
      </div>
      <div style={st.detailSection}>
        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{res.status}</span>
      </div>
      <div style={st.detailSection}>
        <div style={st.detailLabel}>Customer</div>
        <div style={st.detailValue}>{res.customer}</div>
        <div style={st.detailLabel}>Product</div>
        <div style={st.detailValue}>{res.product}</div>
        <div style={st.detailLabel}>Date</div>
        <div style={st.detailValue}>{res.date}</div>
        <div style={st.detailLabel}>Time Slot</div>
        <div style={st.detailValue}>{res.timeSlot}</div>
        <div style={st.detailLabel}>Duration</div>
        <div style={st.detailValue}>{res.duration}</div>
      </div>
      <div style={st.detailSection}>
        <div style={st.detailLabel}>Total</div>
        <div style={{ ...st.detailValue, fontSize: '22px', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>${res.total.toFixed(2)}</div>
        {res.notes && (
          <>
            <div style={st.detailLabel}>Notes</div>
            <div style={st.detailValue}>{res.notes}</div>
          </>
        )}
      </div>
      <div style={{ padding: '20px 24px', display: 'flex', gap: '12px' }}>
        {res.status === 'Confirmed' && <button style={st.saveBtn}>Check In</button>}
        {res.status === 'Checked In' && <button style={st.saveBtn}>Check Out</button>}
        {(res.status === 'Pending' || res.status === 'Confirmed') && (
          <button style={{ ...st.cancelBtn, color: '#9B1C1C', borderColor: '#FCA5A5' }}>Cancel</button>
        )}
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function Rentals() {
  const [tab, setTab] = useState<'products' | 'reservations' | 'pricing' | 'promos'>('products');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);

  const activeProducts = PRODUCTS.filter((p) => p.status === 'Available').length;
  const activeRes = RESERVATIONS.filter((r) => ['Pending', 'Confirmed', 'Checked In'].includes(r.status)).length;
  const monthRevenue = RESERVATIONS.filter((r) => r.status !== 'Cancelled').reduce((sum, r) => sum + r.total, 0);
  const avgRating = (PRODUCTS.reduce((sum, p) => sum + p.rating, 0) / PRODUCTS.length).toFixed(1);

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'products', label: 'Products' },
    { key: 'reservations', label: 'Reservations' },
    { key: 'pricing', label: 'Pricing Rules' },
    { key: 'promos', label: 'Promo Codes' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title}>Rentals</h1>
      <hr style={st.divider} />

      {/* Stats */}
      <div style={st.statsRow}>
        <div style={st.statCard}>
          <div style={st.statLabel}>Total Products</div>
          <div style={st.statValue}>{PRODUCTS.length}</div>
          <div style={st.statSub}>{activeProducts} available</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Active Reservations</div>
          <div style={st.statValue}>{activeRes}</div>
          <div style={st.statSub}>{RESERVATIONS.filter((r) => r.status === 'Checked In').length} checked in today</div>
        </div>
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Revenue This Month</div>
          <div style={st.statValue}>${monthRevenue.toLocaleString()}</div>
          <div style={st.statSub}>+18% vs last month</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Avg Rating</div>
          <div style={st.statValue}>{avgRating}</div>
          <div style={st.statSub}>{PRODUCTS.reduce((s, p) => s + p.totalBookings, 0)} total bookings</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={st.tabs}>
        {tabs.map((t) => (
          <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Products Tab */}
      {tab === 'products' && (
        <>
          <div style={st.filterBar}>
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button style={st.addBtn} onClick={() => setShowAdd(true)}><Plus size={16} /> Add Product</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Name</th>
                  <th style={st.th}>Type</th>
                  <th style={st.th}>Capacity</th>
                  <th style={st.th}>Hourly</th>
                  <th style={st.th}>Half-Day</th>
                  <th style={st.th}>Daily</th>
                  <th style={st.th}>Rating</th>
                  <th style={st.th}>Bookings</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {PRODUCTS.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.type.toLowerCase().includes(search.toLowerCase())).map((p, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const sc = productStatusColors[p.status];
                  return (
                    <tr key={p.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.name}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.type}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{p.capacity}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${p.hourlyRate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${p.halfDayRate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${p.dailyRate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Star size={14} style={{ color: '#F59E0B', fill: '#F59E0B' }} /> {p.rating}
                        </span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.totalBookings}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{p.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Reservations Tab */}
      {tab === 'reservations' && (
        <>
          <div style={st.filterBar}>
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search reservations..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              <option>Pending</option>
              <option>Confirmed</option>
              <option>Checked In</option>
              <option>Checked Out</option>
              <option>Cancelled</option>
              <option>No Show</option>
            </select>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Reservation #</th>
                  <th style={st.th}>Customer</th>
                  <th style={st.th}>Product</th>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Time Slot</th>
                  <th style={st.th}>Duration</th>
                  <th style={st.th}>Total</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {RESERVATIONS.filter((r) => {
                  if (statusFilter !== 'All' && r.status !== statusFilter) return false;
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return r.number.toLowerCase().includes(q) || r.customer.toLowerCase().includes(q) || r.product.toLowerCase().includes(q);
                }).map((r, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const sc = resStatusColors[r.status];
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedRes(r)}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{r.number}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.customer}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.product}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px' }}>{r.timeSlot}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.duration}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${r.total.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{r.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={(e) => { e.stopPropagation(); setSelectedRes(r); }}>
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pricing Rules Tab */}
      {tab === 'pricing' && (
        <>
          <div style={st.filterBar}>
            <div style={{ flex: 1 }} />
            <button style={st.addBtn}><Plus size={16} /> Add Rule</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Name</th>
                  <th style={st.th}>Type</th>
                  <th style={st.th}>Adjustment</th>
                  <th style={st.th}>Start Date</th>
                  <th style={st.th}>End Date</th>
                  <th style={st.th}>Active</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {PRICING_RULES.map((rule, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={rule.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{rule.name}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: '#E0F7FF', color: '#0A2342' }}>{rule.type}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, color: rule.adjustment > 0 ? '#9B1C1C' : '#03543F' }}>
                        {rule.adjustment > 0 ? '+' : ''}{rule.adjustment}%
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{rule.startDate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{rule.endDate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ ...st.toggleTrack, background: rule.active ? '#00D4FF' : '#CBD5E1' }}>
                          <div style={{ ...st.toggleThumb, left: rule.active ? '20px' : '2px' }} />
                        </button>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Promo Codes Tab */}
      {tab === 'promos' && (
        <>
          <div style={st.filterBar}>
            <div style={{ flex: 1 }} />
            <button style={st.addBtn}><Plus size={16} /> Add Promo Code</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Code</th>
                  <th style={st.th}>Discount</th>
                  <th style={st.th}>Valid From</th>
                  <th style={st.th}>Valid To</th>
                  <th style={st.th}>Uses / Max</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {PROMO_CODES.map((pc, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={pc.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600, ...st.mono }}>{pc.code}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>
                        {pc.discountType === '%' ? `${pc.discount}%` : `$${pc.discount}`} off
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{pc.validFrom}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{pc.validTo}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>
                        {pc.uses} / {pc.maxUses || '∞'}
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: pc.active ? '#DEF7EC' : '#F3F4F6', color: pc.active ? '#03543F' : '#64748B' }}>
                          {pc.active ? 'Active' : 'Expired'}
                        </span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showAdd && <AddProductModal onClose={() => setShowAdd(false)} />}
      {selectedRes && <ReservationDetail res={selectedRes} onClose={() => setSelectedRes(null)} />}
    </div>
  );
}
