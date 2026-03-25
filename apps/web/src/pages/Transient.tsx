import { useState } from 'react';
import {
  Search,
  Plus,
  X,
  Calendar,
  Ship,
  Users,
  DollarSign,
  Moon,
  LogOut,
  AlertTriangle,
  CreditCard,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ── Types ─────────────────────────────────────────────── */

type BookingStatus = 'Booked' | 'Checked In' | 'Checked Out' | 'Overstay' | 'Cancelled';
type PaymentStatus = 'Paid' | 'Pending' | 'Partial' | 'Refunded';
type TabKey = 'current' | 'all' | 'calendar';

interface Booking {
  id: string;
  bookingNumber: string;
  guestName: string;
  email: string;
  phone: string;
  boatName: string;
  boatLength: number;
  slip: string;
  checkIn: string;
  checkOut: string;
  nightlyRate: number;
  status: BookingStatus;
  payment: PaymentStatus;
}

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_BOOKINGS: Booking[] = [
  { id: '1', bookingNumber: 'TB-1001', guestName: 'Robert Clarkson', email: 'rclarkson@email.com', phone: '(555) 101-2001', boatName: 'Sea Breeze', boatLength: 32, slip: 'T-01', checkIn: '2026-03-22', checkOut: '2026-03-25', nightlyRate: 85, status: 'Checked In', payment: 'Paid' },
  { id: '2', bookingNumber: 'TB-1002', guestName: 'Maria Fontaine', email: 'mfontaine@email.com', phone: '(555) 102-2002', boatName: 'Windward Spirit', boatLength: 28, slip: 'T-02', checkIn: '2026-03-23', checkOut: '2026-03-26', nightlyRate: 75, status: 'Checked In', payment: 'Paid' },
  { id: '3', bookingNumber: 'TB-1003', guestName: 'Thomas Benavides', email: 'tbenavides@email.com', phone: '(555) 103-2003', boatName: 'Reel Deal', boatLength: 36, slip: 'T-03', checkIn: '2026-03-20', checkOut: '2026-03-24', nightlyRate: 95, status: 'Overstay', payment: 'Partial' },
  { id: '4', bookingNumber: 'TB-1004', guestName: 'Jennifer Albright', email: 'jalbright@email.com', phone: '(555) 104-2004', boatName: 'Lady Luck', boatLength: 24, slip: 'T-04', checkIn: '2026-03-25', checkOut: '2026-03-27', nightlyRate: 65, status: 'Booked', payment: 'Pending' },
  { id: '5', bookingNumber: 'TB-1005', guestName: 'Daniel Marsh', email: 'dmarsh@email.com', phone: '(555) 105-2005', boatName: 'Poseidon\'s Trident', boatLength: 42, slip: 'T-05', checkIn: '2026-03-25', checkOut: '2026-03-30', nightlyRate: 110, status: 'Booked', payment: 'Paid' },
  { id: '6', bookingNumber: 'TB-1006', guestName: 'Susan Whitaker', email: 'swhitaker@email.com', phone: '(555) 106-2006', boatName: 'Calm Waters', boatLength: 30, slip: 'T-06', checkIn: '2026-03-18', checkOut: '2026-03-22', nightlyRate: 80, status: 'Checked Out', payment: 'Paid' },
  { id: '7', bookingNumber: 'TB-1007', guestName: 'Kevin Okafor', email: 'kokafor@email.com', phone: '(555) 107-2007', boatName: 'African Queen', boatLength: 38, slip: 'T-07', checkIn: '2026-03-19', checkOut: '2026-03-23', nightlyRate: 95, status: 'Overstay', payment: 'Pending' },
  { id: '8', bookingNumber: 'TB-1008', guestName: 'Patricia Langley', email: 'plangley@email.com', phone: '(555) 108-2008', boatName: 'Blue Horizon', boatLength: 26, slip: 'T-08', checkIn: '2026-03-24', checkOut: '2026-03-26', nightlyRate: 70, status: 'Checked In', payment: 'Paid' },
  { id: '9', bookingNumber: 'TB-1009', guestName: 'Andrew Gilmore', email: 'agilmore@email.com', phone: '(555) 109-2009', boatName: 'Wave Dancer', boatLength: 34, slip: 'T-09', checkIn: '2026-03-15', checkOut: '2026-03-18', nightlyRate: 85, status: 'Checked Out', payment: 'Paid' },
  { id: '10', bookingNumber: 'TB-1010', guestName: 'Emily Stafford', email: 'estafford@email.com', phone: '(555) 110-2010', boatName: 'Starboard Dream', boatLength: 22, slip: 'T-10', checkIn: '2026-03-26', checkOut: '2026-03-28', nightlyRate: 60, status: 'Booked', payment: 'Pending' },
];

const STATUS_COLORS: Record<BookingStatus, { bg: string; text: string }> = {
  Booked: { bg: '#D6E8F4', text: '#0A2342' },
  'Checked In': { bg: '#E8F5E9', text: '#1B5E20' },
  'Checked Out': { bg: '#F5F5F5', text: '#616161' },
  Overstay: { bg: '#FDECEA', text: '#B71C1C' },
  Cancelled: { bg: '#FFF3CD', text: '#856404' },
};

const PAYMENT_COLORS: Record<PaymentStatus, { bg: string; text: string }> = {
  Paid: { bg: '#E8F5E9', text: '#1B5E20' },
  Pending: { bg: '#FFF3CD', text: '#856404' },
  Partial: { bg: '#E0F7FA', text: '#006064' },
  Refunded: { bg: '#F5F5F5', text: '#616161' },
};

/* ── Helpers ───────────────────────────────────────────── */

function nights(checkIn: string, checkOut: string): number {
  const d1 = new Date(checkIn);
  const d2 = new Date(checkOut);
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000));
}

function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' },
  statCard: { backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  statLabel: { fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.03em', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  tabs: { display: 'flex', gap: '0px', marginBottom: '24px', borderBottom: '2px solid #E2E8F0' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#64748B', cursor: 'pointer', border: 'none', backgroundColor: 'transparent', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabActive: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#0A2342', cursor: 'pointer', border: 'none', backgroundColor: 'transparent', borderBottom: '2px solid #00D4FF', marginBottom: '-2px' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  select: { padding: '8px 32px 8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', appearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', cursor: 'pointer', minWidth: '140px' },
  searchWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute' as const, left: '10px', color: '#2E4A6B', pointerEvents: 'none' as const },
  searchInput: { padding: '8px 12px 8px 34px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', width: '220px', outline: 'none' },
  dateInput: { padding: '8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', outline: 'none' },
  spacer: { flex: 1 },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' as const, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  th: { backgroundColor: '#0A2342', color: '#FFFFFF', padding: '12px 16px', fontSize: '13px', fontWeight: 600, textAlign: 'left' as const, whiteSpace: 'nowrap' as const },
  td: { padding: '12px 16px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  rowEven: { backgroundColor: '#D6E8F4' },
  rowOdd: { backgroundColor: '#FFFFFF' },
  badge: { display: 'inline-block', padding: '3px 12px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600, lineHeight: '18px' },
  actionBtn: { padding: '5px 10px', fontSize: '12px', fontWeight: 600, border: '1px solid #CCC', borderRadius: '4px', backgroundColor: '#FFFFFF', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#2E4A6B', marginRight: '4px' },
  overstayRow: { backgroundColor: '#FFF0F0' },
  /* Modal */
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10, 35, 66, 0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { backgroundColor: '#FFFFFF', borderRadius: '12px', width: '560px', maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' as const },
  modalHeader: { padding: '24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { padding: '4px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#2E4A6B', display: 'flex', alignItems: 'center' },
  modalBody: { flex: 1, overflowY: 'auto' as const, padding: '24px' },
  fieldGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  fieldFull: { display: 'flex', flexDirection: 'column' as const, gap: '4px', gridColumn: '1 / -1' },
  fieldLabel: { fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.03em' },
  input: { padding: '8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', outline: 'none' },
  modalFooter: { padding: '20px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#F7F9FB' },
  cancelBtn: { padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  calendarPlaceholder: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#64748B', fontSize: '16px', border: '1px dashed #CCC', borderRadius: '8px', backgroundColor: '#F7F9FB' },
};

/* ── Component ─────────────────────────────────────────── */

export default function Transient() {
  const { data: apiBookings, loading, error } = useApi<Booking[]>('get', '/api/transient', { immediate: true });
  const createBooking = useApi<Booking>('post', '/api/transient');

  const [bookings, setBookings] = useState<Booking[]>(MOCK_BOOKINGS);
  const [tab, setTab] = useState<TabKey>('current');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');
  const [showModal, setShowModal] = useState(false);

  const allBookings = apiBookings || bookings;

  /* Derived */
  const activeGuests = allBookings.filter((b) => b.status === 'Checked In' || b.status === 'Overstay').length;
  const checkInsToday = allBookings.filter((b) => b.checkIn === '2026-03-25' && (b.status === 'Booked' || b.status === 'Checked In')).length;
  const avgStay = (() => {
    const stays = allBookings.map((b) => nights(b.checkIn, b.checkOut));
    return stays.length > 0 ? (stays.reduce((a, c) => a + c, 0) / stays.length).toFixed(1) : '0';
  })();
  const revenueMonth = allBookings
    .filter((b) => b.checkIn.startsWith('2026-03') && b.payment !== 'Refunded')
    .reduce((sum, b) => sum + b.nightlyRate * nights(b.checkIn, b.checkOut), 0);

  const currentGuests = allBookings.filter((b) => b.status === 'Checked In' || b.status === 'Overstay' || b.status === 'Booked');

  const filteredAll = allBookings.filter((b) => {
    if (statusFilter !== 'All' && b.status !== statusFilter) return false;
    if (dateFilter && b.checkIn !== dateFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${b.bookingNumber} ${b.guestName} ${b.boatName} ${b.slip}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const handleCheckOut = (id: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setBookings(bookings.map((b) => (b.id === id ? { ...b, status: 'Checked Out' as BookingStatus } : b)));
  };

  return (
    <div style={s.page}>
      <h1 style={s.title}>Transient Bookings</h1>
      <hr style={s.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading bookings...</div>}
      {error && <div style={{ textAlign: 'center', padding: '12px', color: '#B71C1C', marginBottom: '16px' }}>Failed to load bookings. Showing cached data.</div>}

      {/* Stats */}
      <div style={s.statsRow}>
        <div style={s.statCard}>
          <div style={s.statLabel}>Active Guests</div>
          <div style={s.statValue}>{activeGuests}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Check-ins Today</div>
          <div style={s.statValue}>{checkInsToday}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Avg Stay (nights)</div>
          <div style={s.statValue}>{avgStay}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Revenue This Month</div>
          <div style={s.statValue}>{fmt$(revenueMonth)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        <button style={tab === 'current' ? s.tabActive : s.tab} onClick={() => setTab('current')}>Current Guests</button>
        <button style={tab === 'all' ? s.tabActive : s.tab} onClick={() => setTab('all')}>All Bookings</button>
        <button style={tab === 'calendar' ? s.tabActive : s.tab} onClick={() => setTab('calendar')}>Calendar</button>
      </div>

      {/* ── Current Guests Tab ── */}
      {tab === 'current' && (
        <>
          <div style={s.filterBar}>
            <div style={s.spacer} />
            <button style={s.primaryBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Booking
            </button>
          </div>
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Guest Name</th>
                  <th style={s.th}>Boat</th>
                  <th style={s.th}>Slip</th>
                  <th style={s.th}>Check-In</th>
                  <th style={s.th}>Expected Check-Out</th>
                  <th style={s.th}>Nightly Rate</th>
                  <th style={s.th}>Total</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentGuests.map((b, idx) => {
                  const n = nights(b.checkIn, b.checkOut);
                  const isOverstay = b.status === 'Overstay';
                  return (
                    <tr
                      key={b.id}
                      style={isOverstay ? s.overstayRow : idx % 2 === 0 ? s.rowOdd : s.rowEven}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#EBF2FA'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = isOverstay ? '#FFF0F0' : idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; }}
                    >
                      <td style={{ ...s.td, fontWeight: 600 }}>{b.guestName}</td>
                      <td style={s.td}>
                        <Ship size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                        {b.boatName} ({b.boatLength} ft)
                      </td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{b.slip}</td>
                      <td style={s.td}>{b.checkIn}</td>
                      <td style={s.td}>
                        {b.checkOut}
                        {isOverstay && <AlertTriangle size={14} style={{ marginLeft: '6px', color: '#B71C1C', verticalAlign: 'middle' }} />}
                      </td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{fmt$(b.nightlyRate)}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{fmt$(b.nightlyRate * n)}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, backgroundColor: STATUS_COLORS[b.status].bg, color: STATUS_COLORS[b.status].text }}>
                          {b.status}
                        </span>
                      </td>
                      <td style={s.td}>
                        {(b.status === 'Checked In' || b.status === 'Overstay') && (
                          <button
                            style={{ ...s.actionBtn, color: '#0A2342', borderColor: '#0A2342' }}
                            onClick={(ev) => handleCheckOut(b.id, ev)}
                          >
                            <LogOut size={12} /> Check Out
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {currentGuests.length === 0 && (
                  <tr><td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={9}>No current guests.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── All Bookings Tab ── */}
      {tab === 'all' && (
        <>
          <div style={s.filterBar}>
            <div style={s.searchWrap}>
              <Search size={16} style={s.searchIcon} />
              <input style={s.searchInput} placeholder="Search bookings..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <input type="date" style={s.dateInput} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            <select style={s.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              <option value="Booked">Booked</option>
              <option value="Checked In">Checked In</option>
              <option value="Checked Out">Checked Out</option>
              <option value="Overstay">Overstay</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <div style={s.spacer} />
            <button style={s.primaryBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Booking
            </button>
          </div>
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Booking #</th>
                  <th style={s.th}>Guest</th>
                  <th style={s.th}>Boat</th>
                  <th style={s.th}>Slip</th>
                  <th style={s.th}>Check-In</th>
                  <th style={s.th}>Check-Out</th>
                  <th style={s.th}>Nights</th>
                  <th style={s.th}>Rate</th>
                  <th style={s.th}>Total</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Payment</th>
                </tr>
              </thead>
              <tbody>
                {filteredAll.map((b, idx) => {
                  const n = nights(b.checkIn, b.checkOut);
                  const isOverstay = b.status === 'Overstay';
                  return (
                    <tr key={b.id} style={isOverstay ? s.overstayRow : idx % 2 === 0 ? s.rowOdd : s.rowEven}>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{b.bookingNumber}</td>
                      <td style={{ ...s.td, fontWeight: 600 }}>{b.guestName}</td>
                      <td style={s.td}>{b.boatName} ({b.boatLength} ft)</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{b.slip}</td>
                      <td style={s.td}>{b.checkIn}</td>
                      <td style={s.td}>{b.checkOut}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', textAlign: 'center' }}>{n}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{fmt$(b.nightlyRate)}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{fmt$(b.nightlyRate * n)}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, backgroundColor: STATUS_COLORS[b.status].bg, color: STATUS_COLORS[b.status].text }}>
                          {b.status}
                        </span>
                      </td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, backgroundColor: PAYMENT_COLORS[b.payment].bg, color: PAYMENT_COLORS[b.payment].text }}>
                          {b.payment}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filteredAll.length === 0 && (
                  <tr><td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={11}>No bookings match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Calendar Tab ── */}
      {tab === 'calendar' && (
        <div style={s.calendarPlaceholder}>
          <div style={{ textAlign: 'center' }}>
            <Calendar size={48} style={{ color: '#CCC', marginBottom: '12px' }} />
            <div>Calendar view — slip availability grid coming soon.</div>
          </div>
        </div>
      )}

      {/* ── New Booking Modal ── */}
      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>New Transient Booking</h2>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={s.modalBody}>
              <div style={s.fieldGrid}>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Guest Name</span>
                  <input style={s.input} placeholder="Full name" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Email</span>
                  <input style={s.input} placeholder="email@example.com" type="email" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Phone</span>
                  <input style={s.input} placeholder="(555) 000-0000" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat Name</span>
                  <input style={s.input} placeholder="Vessel name" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat Length (ft)</span>
                  <input style={s.input} placeholder="e.g. 32" type="number" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Slip</span>
                  <select style={{ ...s.input, ...s.select }}>
                    <option value="">Select slip...</option>
                    {['T-01','T-02','T-03','T-04','T-05','T-06','T-07','T-08','T-09','T-10'].map((sl) => (
                      <option key={sl} value={sl}>{sl}</option>
                    ))}
                  </select>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Check-In Date</span>
                  <input style={s.input} type="date" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Check-Out Date</span>
                  <input style={s.input} type="date" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Nightly Rate ($)</span>
                  <input style={s.input} placeholder="85.00" type="number" step="0.01" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Payment Method</span>
                  <select style={{ ...s.input, ...s.select }}>
                    <option value="">Select...</option>
                    <option value="credit">Credit Card</option>
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="ach">ACH Transfer</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={s.primaryBtn} onClick={() => { createBooking.execute({}); setShowModal(false); }}>
                <CreditCard size={16} /> Create Booking
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
