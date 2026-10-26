import { useState } from 'react';
import {
  Search,
  Plus,
  X,
  Calendar,
  Ship,
  LogIn,
  LogOut,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { useApiClient, useList } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { dateKey, formatCents, formatDate, nightsBetween, todayKey } from '../lib/format';
import { ErrorState, InlineError, LoadingState } from '../components/StateViews';
import { useToast } from '../components/Toast';

/* ── Types ─────────────────────────────────────────────── */

type BookingStatus = 'Booked' | 'Checked In' | 'Checked Out' | 'Overstay' | 'Cancelled';
type TabKey = 'current' | 'all' | 'calendar';

interface Booking {
  id: string;
  bookingNumber: string;
  guestName: string;
  email: string;
  phone: string;
  boatName: string;
  boatLength: number | null;
  slip: string;
  checkIn: string; // YYYY-MM-DD (local calendar date)
  checkOut: string; // YYYY-MM-DD or ''
  nightlyRate: number; // cents
  total: number; // cents, from the server
  status: BookingStatus;
  paidViaStripe: boolean;
}

/* ── API mapping ───────────────────────────────────────── */

interface TransientDTO {
  id: string;
  slipId: string;
  guestName: string;
  guestEmail?: string | null;
  guestPhone?: string | null;
  boatName?: string | null;
  boatLength?: number | null;
  checkIn: string;
  checkOut?: string | null;
  rateCents: number;
  totalCents: number;
  stripePaymentId?: string | null;
  status: 'BOOKED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'OVERSTAY';
  slip?: { slipNumber?: string | null } | null;
}

interface AvailableSlip {
  id: string;
  slipNumber: string;
  lengthFt?: number | null;
}

const STATUS_LABEL: Record<TransientDTO['status'], BookingStatus> = {
  BOOKED: 'Booked', CHECKED_IN: 'Checked In', CHECKED_OUT: 'Checked Out', CANCELLED: 'Cancelled', OVERSTAY: 'Overstay',
};

function toBooking(b: TransientDTO): Booking {
  return {
    id: b.id,
    // No human booking number in the API yet; show a short form of the id.
    bookingNumber: b.id.slice(0, 8).toUpperCase(),
    guestName: b.guestName,
    email: b.guestEmail ?? '',
    phone: b.guestPhone ?? '',
    boatName: b.boatName ?? '—',
    boatLength: b.boatLength ?? null,
    slip: b.slip?.slipNumber ?? '—',
    checkIn: dateKey(b.checkIn),
    checkOut: dateKey(b.checkOut),
    nightlyRate: b.rateCents,
    total: b.totalCents,
    status: STATUS_LABEL[b.status] ?? 'Booked',
    paidViaStripe: !!b.stripePaymentId,
  };
}

/** Local calendar date -> ISO datetime at local midnight (what the API's z.datetime() accepts). */
function localDateToIso(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

const STATUS_COLORS: Record<BookingStatus, { bg: string; text: string }> = {
  Booked: { bg: '#D6E8F4', text: '#0A2342' },
  'Checked In': { bg: '#E8F5E9', text: '#1B5E20' },
  'Checked Out': { bg: '#F5F5F5', text: '#616161' },
  Overstay: { bg: '#FDECEA', text: '#B71C1C' },
  Cancelled: { bg: '#FFF3CD', text: '#856404' },
};

const STATUS_ENUM: Record<string, TransientDTO['status']> = {
  Booked: 'BOOKED', 'Checked In': 'CHECKED_IN', 'Checked Out': 'CHECKED_OUT', Overstay: 'OVERSTAY', Cancelled: 'CANCELLED',
};

/* ── Helpers ───────────────────────────────────────────── */

function nights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  return Math.max(0, nightsBetween(checkIn, checkOut));
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
  const client = useApiClient();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('current');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const listPath = `/transient?take=200${statusFilter !== 'All' ? `&status=${STATUS_ENUM[statusFilter]}` : ''}`;
  const list = useList<Booking, TransientDTO>(listPath, { map: toBooking });
  const allBookings = list.items;

  /* New booking form state */
  const [nbName, setNbName] = useState('');
  const [nbEmail, setNbEmail] = useState('');
  const [nbPhone, setNbPhone] = useState('');
  const [nbBoat, setNbBoat] = useState('');
  const [nbLength, setNbLength] = useState('');
  const [nbSlip, setNbSlip] = useState('');
  const [nbCheckIn, setNbCheckIn] = useState('');
  const [nbCheckOut, setNbCheckOut] = useState('');
  const [nbRate, setNbRate] = useState('');
  const [nbSaving, setNbSaving] = useState(false);
  const [nbError, setNbError] = useState('');

  // Slips come from the availability endpoint for the chosen dates.
  const availPath =
    nbCheckIn && nbCheckOut && nbCheckOut > nbCheckIn
      ? `/transient/availability?dateFrom=${encodeURIComponent(localDateToIso(nbCheckIn))}&dateTo=${encodeURIComponent(localDateToIso(nbCheckOut))}`
      : null;
  const availability = useList<AvailableSlip>(showModal ? availPath : null);

  const resetBookingForm = () => {
    setNbName(''); setNbEmail(''); setNbPhone(''); setNbBoat('');
    setNbLength(''); setNbSlip(''); setNbCheckIn(''); setNbCheckOut('');
    setNbRate(''); setNbError('');
  };

  const nbNights = nights(nbCheckIn, nbCheckOut);
  const nbRateCents = Math.round(Number(nbRate) * 100);
  const formProblem =
    !nbName.trim() ? 'Guest name is required.'
      : !nbCheckIn || !nbCheckOut ? 'Check-in and check-out dates are required.'
        : nbNights < 1 ? 'Check-out must be at least one night after check-in.'
          : !nbSlip ? 'Choose an available slip.'
            : !(nbRateCents > 0) ? 'Enter the nightly rate.'
              : null;

  const handleCreateBooking = async () => {
    if (formProblem || nbSaving) return;
    setNbSaving(true);
    setNbError('');
    try {
      await client.post('/transient', {
        slipId: nbSlip,
        guestName: nbName.trim(),
        guestEmail: nbEmail.trim() || null,
        guestPhone: nbPhone.trim() || null,
        boatName: nbBoat.trim() || null,
        boatLength: Number(nbLength) > 0 ? Number(nbLength) : null,
        checkIn: localDateToIso(nbCheckIn),
        checkOut: localDateToIso(nbCheckOut),
        rateCents: nbRateCents,
        totalCents: nbRateCents * nbNights,
      });
      toast.success(`Booking created for ${nbName.trim()}`);
      resetBookingForm();
      setShowModal(false);
      list.refetch();
    } catch (err) {
      setNbError(errorMessage(err));
    } finally {
      setNbSaving(false);
    }
  };

  const runAction = async (b: Booking, action: 'check-in' | 'check-out' | 'cancel') => {
    if (busyId) return;
    if (action === 'check-out' && !window.confirm(`Check out ${b.guestName} from slip ${b.slip}?`)) return;
    if (action === 'cancel' && !window.confirm(`Cancel the booking for ${b.guestName}?`)) return;
    setBusyId(b.id);
    setActionError(null);
    try {
      if (action === 'cancel') await client.delete(`/transient/${b.id}`);
      else await client.put(`/transient/${b.id}/${action}`);
      toast.success(action === 'check-in' ? `${b.guestName} checked in` : action === 'check-out' ? `${b.guestName} checked out` : 'Booking cancelled');
      list.refetch();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  /* Derived (from loaded bookings) */
  const today = todayKey();
  const monthPrefix = today.slice(0, 7);
  const activeGuests = allBookings.filter((b) => b.status === 'Checked In' || b.status === 'Overstay').length;
  const checkInsToday = allBookings.filter((b) => b.checkIn === today && (b.status === 'Booked' || b.status === 'Checked In')).length;
  const avgStay = (() => {
    const stays = allBookings.filter((b) => b.checkOut).map((b) => nights(b.checkIn, b.checkOut));
    return stays.length > 0 ? (stays.reduce((a, c) => a + c, 0) / stays.length).toFixed(1) : '0';
  })();
  const bookedThisMonth = allBookings
    .filter((b) => b.checkIn.startsWith(monthPrefix) && b.status !== 'Cancelled')
    .reduce((sum, b) => sum + b.total, 0);

  const currentGuests = allBookings.filter((b) => b.status === 'Checked In' || b.status === 'Overstay' || b.status === 'Booked');

  const filteredAll = allBookings.filter((b) => {
    if (dateFilter && b.checkIn !== dateFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${b.bookingNumber} ${b.guestName} ${b.boatName} ${b.slip}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const rowActions = (b: Booking) => (
    <>
      {b.status === 'Booked' && (
        <>
          <button style={{ ...s.actionBtn, color: '#1B5E20', borderColor: '#1B5E20' }} disabled={!!busyId} onClick={() => runAction(b, 'check-in')}>
            <LogIn size={12} /> {busyId === b.id ? '…' : 'Check In'}
          </button>
          <button style={{ ...s.actionBtn, color: '#B71C1C', borderColor: '#F5C2C0' }} disabled={!!busyId} onClick={() => runAction(b, 'cancel')}>
            <Ban size={12} /> Cancel
          </button>
        </>
      )}
      {(b.status === 'Checked In' || b.status === 'Overstay') && (
        <button style={{ ...s.actionBtn, color: '#0A2342', borderColor: '#0A2342' }} disabled={!!busyId} onClick={() => runAction(b, 'check-out')}>
          <LogOut size={12} /> {busyId === b.id ? '…' : 'Check Out'}
        </button>
      )}
    </>
  );

  const body = list.loading ? (
    <LoadingState label="Loading bookings…" />
  ) : list.error ? (
    <ErrorState title="Could not load transient bookings" message={list.error} onRetry={list.refetch} />
  ) : null;

  return (
    <div style={s.page}>
      <h1 style={s.title} className="helm-page-title">Transient Bookings</h1>
      <hr style={s.divider} />

      {actionError && <div style={{ marginBottom: 16 }}><InlineError message={actionError} /></div>}

      {/* Stats */}
      <div style={s.statsRow} className="helm-stats-grid">
        <div style={s.statCard}>
          <div style={s.statLabel}>Active Guests</div>
          <div style={s.statValue}>{list.loading ? '—' : activeGuests}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Check-ins Today</div>
          <div style={s.statValue}>{list.loading ? '—' : checkInsToday}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Avg Stay (nights)</div>
          <div style={s.statValue}>{list.loading ? '—' : avgStay}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Booked This Month</div>
          <div style={s.statValue}>{list.loading ? '—' : formatCents(bookedThisMonth)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs} className="helm-tabs">
        <button style={tab === 'current' ? s.tabActive : s.tab} onClick={() => setTab('current')}>Current Guests</button>
        <button style={tab === 'all' ? s.tabActive : s.tab} onClick={() => setTab('all')}>All Bookings</button>
        <button style={tab === 'calendar' ? s.tabActive : s.tab} onClick={() => setTab('calendar')}>Calendar</button>
      </div>

      {/* ── Current Guests Tab ── */}
      {tab === 'current' && (
        <>
          <div style={s.filterBar} className="helm-filter-bar">
            <div style={s.spacer} />
            <button style={s.primaryBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Booking
            </button>
          </div>
          {body ?? (
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }} className="helm-table-wrap">
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
                  const isOverstay = b.status === 'Overstay';
                  return (
                    <tr key={b.id} style={isOverstay ? s.overstayRow : idx % 2 === 0 ? s.rowOdd : s.rowEven}>
                      <td style={{ ...s.td, fontWeight: 600 }}>{b.guestName}</td>
                      <td style={s.td}>
                        <Ship size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                        {b.boatName}{b.boatLength ? ` (${b.boatLength} ft)` : ''}
                      </td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{b.slip}</td>
                      <td style={s.td}>{formatDate(b.checkIn)}</td>
                      <td style={s.td}>
                        {b.checkOut ? formatDate(b.checkOut) : 'Open'}
                        {isOverstay && <AlertTriangle size={14} style={{ marginLeft: '6px', color: '#B71C1C', verticalAlign: 'middle' }} />}
                      </td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{formatCents(b.nightlyRate)}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{formatCents(b.total)}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, backgroundColor: STATUS_COLORS[b.status].bg, color: STATUS_COLORS[b.status].text }}>
                          {b.status}
                        </span>
                      </td>
                      <td style={s.td}>{rowActions(b)}</td>
                    </tr>
                  );
                })}
                {currentGuests.length === 0 && (
                  <tr><td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={9}>No current or upcoming guests.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {/* ── All Bookings Tab ── */}
      {tab === 'all' && (
        <>
          <div style={s.filterBar} className="helm-filter-bar">
            <div style={s.searchWrap}>
              <Search size={16} style={s.searchIcon} />
              <input style={s.searchInput} placeholder="Search bookings..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <input type="date" style={s.dateInput} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} aria-label="Check-in date" />
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
          {body ?? (
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }} className="helm-table-wrap">
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Booking</th>
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
                  <th style={s.th}>Actions</th>
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
                      <td style={s.td}>{b.boatName}{b.boatLength ? ` (${b.boatLength} ft)` : ''}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{b.slip}</td>
                      <td style={s.td}>{formatDate(b.checkIn)}</td>
                      <td style={s.td}>{b.checkOut ? formatDate(b.checkOut) : 'Open'}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', textAlign: 'center' }}>{b.checkOut ? n : '—'}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{formatCents(b.nightlyRate)}</td>
                      <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{formatCents(b.total)}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, backgroundColor: STATUS_COLORS[b.status].bg, color: STATUS_COLORS[b.status].text }}>
                          {b.status}
                        </span>
                      </td>
                      <td style={{ ...s.td, color: '#64748B', fontSize: 12 }}>{b.paidViaStripe ? 'Stripe payment on file' : 'Not recorded'}</td>
                      <td style={s.td}>{rowActions(b)}</td>
                    </tr>
                  );
                })}
                {filteredAll.length === 0 && (
                  <tr><td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={12}>{allBookings.length === 0 ? 'No transient bookings yet.' : 'No bookings match the current filters.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {/* ── Calendar Tab ── */}
      {tab === 'calendar' && (
        <div style={s.calendarPlaceholder}>
          <div style={{ textAlign: 'center' }}>
            <Calendar size={48} style={{ color: '#CCC', marginBottom: '12px' }} />
            <div>Calendar view is not available yet.</div>
          </div>
        </div>
      )}

      {/* ── New Booking Modal ── */}
      {showModal && (
        <div style={s.overlay}>
          <div style={s.modal} className="helm-modal" role="dialog" aria-modal="true" aria-labelledby="nb-title">
            <div style={s.modalHeader}>
              <h2 id="nb-title" style={s.modalTitle}>New Transient Booking</h2>
              <button style={s.closeBtn} onClick={() => setShowModal(false)} disabled={nbSaving} aria-label="Close"><X size={20} /></button>
            </div>
            <div style={s.modalBody}>
              {nbError && <div style={{ marginBottom: 12 }}><InlineError message={nbError} /></div>}
              <div style={s.fieldGrid}>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Guest Name *</span>
                  <input style={s.input} placeholder="Full name" value={nbName} onChange={(e) => setNbName(e.target.value)} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Email</span>
                  <input style={s.input} placeholder="email@example.com" type="email" value={nbEmail} onChange={(e) => setNbEmail(e.target.value)} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Phone</span>
                  <input style={s.input} placeholder="(555) 000-0000" value={nbPhone} onChange={(e) => setNbPhone(e.target.value)} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Boat Name</span>
                  <input style={s.input} placeholder="Vessel name" value={nbBoat} onChange={(e) => setNbBoat(e.target.value)} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Boat Length (ft)</span>
                  <input style={s.input} placeholder="e.g. 32" type="number" value={nbLength} onChange={(e) => setNbLength(e.target.value)} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Nightly Rate ($) *</span>
                  <input style={s.input} placeholder="0.00" type="number" step="0.01" value={nbRate} onChange={(e) => setNbRate(e.target.value)} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Check-In Date *</span>
                  <input style={s.input} type="date" min={todayKey()} value={nbCheckIn} onChange={(e) => { setNbCheckIn(e.target.value); setNbSlip(''); }} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Check-Out Date *</span>
                  <input style={s.input} type="date" min={nbCheckIn || todayKey()} value={nbCheckOut} onChange={(e) => { setNbCheckOut(e.target.value); setNbSlip(''); }} />
                </label>
                <label style={s.fieldFull}>
                  <span style={s.fieldLabel}>Slip * (transient-capable, available for these dates)</span>
                  <select style={{ ...s.input, ...s.select }} value={nbSlip} onChange={(e) => setNbSlip(e.target.value)} disabled={!availPath || availability.loading || !!availability.error}>
                    <option value="">
                      {!availPath ? 'Choose dates first' : availability.loading ? 'Checking availability…' : availability.error ? 'Could not load availability' : availability.items.length === 0 ? 'No transient slips available' : 'Select slip...'}
                    </option>
                    {availability.items
                      .filter((sl) => !(Number(nbLength) > 0) || !sl.lengthFt || sl.lengthFt >= Number(nbLength))
                      .map((sl) => (
                        <option key={sl.id} value={sl.id}>{sl.slipNumber}{sl.lengthFt ? ` (${sl.lengthFt}')` : ''}</option>
                      ))}
                  </select>
                  {availability.error && <span style={{ fontSize: 12, color: '#B71C1C' }}>{availability.error}</span>}
                </label>
              </div>
              {nbNights > 0 && nbRateCents > 0 && (
                <div style={{ fontSize: 13, color: '#2E4A6B', marginTop: 12 }}>
                  {nbNights} night{nbNights === 1 ? '' : 's'} × {formatCents(nbRateCents)} = <strong>{formatCents(nbNights * nbRateCents)}</strong>. Payment is taken separately.
                </div>
              )}
              {formProblem && (nbName || nbCheckIn || nbCheckOut || nbRate) && (
                <div style={{ fontSize: 12, color: '#B71C1C', marginTop: 8 }}>{formProblem}</div>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} disabled={nbSaving} onClick={() => { setShowModal(false); resetBookingForm(); }}>Cancel</button>
              <button
                style={{ ...s.primaryBtn, opacity: formProblem || nbSaving ? 0.5 : 1 }}
                onClick={handleCreateBooking}
                disabled={nbSaving || !!formProblem}
              >
                <Plus size={16} /> {nbSaving ? 'Creating…' : 'Create Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
