import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
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
  CheckCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';

/* ── Types ─────────────────────────────────────────────── */

type BookingStatus = 'Booked' | 'Checked In' | 'Checked Out' | 'Overstay' | 'Cancelled';
type PaymentStatus = 'Paid' | 'Pending' | 'Partial' | 'Refunded';
type TabKey = 'current' | 'all' | 'calendar';

interface ApiSlip {
  id: string;
  slipNumber: string;
  lengthFt: number;
  widthFt: number;
  dockId: string | null;
}

interface ApiBooking {
  id: string;
  bookingNumber?: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  boatName: string | null;
  boatLength: number | null;
  checkIn: string;
  checkOut: string | null;
  rateCents: number;
  status: string;
  slip: { id: string; slipNumber: string } | null;
  customer: { firstName: string; lastName: string; email: string; phone: string | null } | null;
}

function mapApiBooking(b: ApiBooking): Booking {
  const statusMap: Record<string, BookingStatus> = {
    BOOKED: 'Booked',
    CHECKED_IN: 'Checked In',
    CHECKED_OUT: 'Checked Out',
    OVERSTAY: 'Overstay',
    CANCELLED: 'Cancelled',
  };
  return {
    id: b.id,
    bookingNumber: b.bookingNumber ?? `TRN-${b.id.slice(-6).toUpperCase()}`,
    guestName: b.guestName,
    email: b.guestEmail ?? b.customer?.email ?? '—',
    phone: b.guestPhone ?? b.customer?.phone ?? '—',
    boatName: b.boatName ?? '—',
    boatLength: b.boatLength ?? 0,
    slip: b.slip?.slipNumber ?? '—',
    checkIn: new Date(b.checkIn).toISOString().slice(0, 10),
    checkOut: b.checkOut ? new Date(b.checkOut).toISOString().slice(0, 10) : '—',
    nightlyRate: b.rateCents / 100,
    status: statusMap[b.status] ?? 'Booked',
    payment: 'Paid',
  };
}

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

interface AvailableSlip {
  id: string;
  slipNumber: string;
  length: number;
  width: number;
  dock: string | null;
}

interface CalBooking {
  id: string;
  guestName: string;
  checkIn: string;
  checkOut: string | null;
  status: string;
  rateCents: number;
  slip: { id: string; slipNumber: string } | null;
}

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

/* SLIP_OPTIONS is now fetched from /api/slips?transientCapable=true */

// Module-level calendar window: today through 14 days (recomputed on page load)
function getCalWindow(offsetWeeks: number) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() + offsetWeeks * 7);
  const to = new Date(from);
  to.setDate(to.getDate() + 14);
  return { from, to };
}

export default function Transient() {
  const { getToken } = useAuth();
  const toast = useToast();
  const { data: apiBookingData, loading, execute: refetchBookings } = useApi<{ data: ApiBooking[]; total: number }>('get', '/api/transient?take=100', { immediate: true });
  const { data: apiSlipsData } = useApi<{ data: ApiSlip[] }>('get', '/api/slips?transientCapable=true&take=50', { immediate: true });

  const [localBookings, setLocalBookings] = useState<Booking[]>([]);
  const [tab, setTab] = useState<TabKey>('current');

  // Calendar state
  const [calOffset, setCalOffset] = useState(0);
  const [calBookings, setCalBookings] = useState<CalBooking[]>([]);
  const [calAvail, setCalAvail] = useState<AvailableSlip[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');
  const [showModal, setShowModal] = useState(false);

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
  const [nbPayment, setNbPayment] = useState('');
  const [nbSaving, setNbSaving] = useState(false);
  const [nbError, setNbError] = useState('');

  /* Customer search in booking form */
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<{ id: string; name: string; email: string; phone: string }[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchCustomers = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setCustomerResults([]); setShowCustomerDropdown(false); return; }
    setCustomerSearching(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&take=8`, { headers });
      if (!res.ok) return;
      const json = await res.json() as { data: Array<{ id: string; firstName: string; lastName: string; email: string; phone: string | null }> };
      const list = (json.data ?? []).map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        email: c.email,
        phone: c.phone ?? '',
      }));
      setCustomerResults(list);
      setShowCustomerDropdown(list.length > 0);
    } catch { /* ignore */ } finally {
      setCustomerSearching(false);
    }
  }, [getToken]);

  const handleCustomerQueryChange = (q: string) => {
    setCustomerQuery(q);
    setNbName(q);
    if (customerDebounceRef.current) clearTimeout(customerDebounceRef.current);
    customerDebounceRef.current = setTimeout(() => searchCustomers(q), 300);
  };

  const selectCustomer = (c: { id: string; name: string; email: string; phone: string }) => {
    setNbName(c.name);
    setCustomerQuery(c.name);
    setNbEmail(c.email);
    setNbPhone(c.phone);
    setCustomerResults([]);
    setShowCustomerDropdown(false);
  };

  // Fetch calendar data when the calendar tab is active or the week offset changes
  useEffect(() => {
    if (tab !== 'calendar') return;
    const { from, to } = getCalWindow(calOffset);
    const fromStr = from.toISOString();
    const toStr = to.toISOString();

    let cancelled = false;
    setCalLoading(true);

    const fetchCal = async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const [bRes, aRes] = await Promise.all([
          fetch(`/api/transient?dateFrom=${encodeURIComponent(fromStr)}&dateTo=${encodeURIComponent(toStr)}&take=200`, { headers }),
          fetch(`/api/transient/availability?dateFrom=${encodeURIComponent(fromStr)}&dateTo=${encodeURIComponent(toStr)}`, { headers }),
        ]);

        const bookingsData = bRes.ok ? (await bRes.json() as { data?: CalBooking[]; } | CalBooking[]) : [];
        const availData = aRes.ok ? (await aRes.json() as AvailableSlip[]) : [];

        if (!cancelled) {
          const bArr = Array.isArray(bookingsData) ? bookingsData : (bookingsData as { data?: CalBooking[] }).data ?? [];
          setCalBookings(bArr);
          setCalAvail(Array.isArray(availData) ? availData : []);
        }
      } catch {
        if (!cancelled) { setCalBookings([]); setCalAvail([]); }
      } finally {
        if (!cancelled) setCalLoading(false);
      }
    };

    void fetchCal();
    return () => { cancelled = true; };
  }, [tab, calOffset, getToken]);

  const resetBookingForm = () => {
    setNbName(''); setNbEmail(''); setNbPhone(''); setNbBoat('');
    setNbLength(''); setNbSlip(''); setNbCheckIn(''); setNbCheckOut('');
    setNbRate(''); setNbPayment(''); setNbError('');
    setCustomerQuery(''); setCustomerResults([]); setShowCustomerDropdown(false);
  };

  const { execute: createBookingApi } = useApi<{ data: { id: string; bookingNumber?: string } }>('post', '/api/transient');

  const handleCreateBooking = async () => {
    if (!nbName || !nbSlip || !nbCheckIn) return;
    setNbSaving(true);
    setNbError('');
    try {
      const nightCount = nbCheckIn && nbCheckOut
        ? Math.max(1, Math.round((new Date(nbCheckOut).getTime() - new Date(nbCheckIn).getTime()) / 86400000))
        : 1;
      const rate = parseFloat(nbRate) || 85;
      const rateCents = Math.round(rate * 100);
      const totalCents = rateCents * nightCount;

      const result = await createBookingApi({
        slipId: nbSlip,   // UUID from the slip dropdown
        guestName: nbName,
        guestEmail: nbEmail || null,
        guestPhone: nbPhone || null,
        boatName: nbBoat || null,
        boatLength: parseFloat(nbLength) || null,
        checkIn: new Date(nbCheckIn).toISOString(),
        checkOut: nbCheckOut ? new Date(nbCheckOut).toISOString() : null,
        rateCents,
        totalCents,
      });

      if (!result) throw new Error('Failed to create booking');

      // Refresh data from API
      setLocalBookings([]);
      await refetchBookings();
      resetBookingForm();
      setShowModal(false);
      toast.success('Booking Created', `Transient booking for ${nbName} has been created.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create booking';
      setNbError(msg);
    } finally {
      setNbSaving(false);
    }
  };

  /* Check-in a booked guest (calls real API) */
  const handleCheckIn = async (id: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    try {
      const token = await getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/transient/${id}/check-in`, { method: 'PUT', headers });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Check-in failed');
      }
      // Optimistic update + background refresh
      setLocalBookings((prev) =>
        (prev.length > 0 ? prev : apiBookings).map((b) =>
          b.id === id ? { ...b, status: 'Checked In' as BookingStatus } : b
        )
      );
      toast.success('Checked In', 'Guest has been checked in successfully.');
      void refetchBookings().then(() => setLocalBookings([]));
    } catch (err) {
      toast.error('Check-in Failed', err instanceof Error ? err.message : 'Could not check in guest.');
    }
  };

  /* Check-out a guest (calls real API) */
  const handleCheckOut = async (id: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    try {
      const token = await getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/transient/${id}/check-out`, { method: 'PUT', headers });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Check-out failed');
      }
      setLocalBookings((prev) =>
        (prev.length > 0 ? prev : apiBookings).map((b) =>
          b.id === id ? { ...b, status: 'Checked Out' as BookingStatus } : b
        )
      );
      toast.success('Checked Out', 'Guest has been checked out. Slip is now vacant.');
      void refetchBookings().then(() => setLocalBookings([]));
    } catch (err) {
      toast.error('Check-out Failed', err instanceof Error ? err.message : 'Could not check out guest.');
    }
  };

  const apiBookings = (apiBookingData?.data ?? []).map(mapApiBooking);
  const slipOptions = apiSlipsData?.data ?? [];
  const allBookings = localBookings.length > 0 ? localBookings : apiBookings;

  /* Derived */
  const todayStr = new Date().toISOString().slice(0, 10);
  const activeGuests = allBookings.filter((b) => b.status === 'Checked In' || b.status === 'Overstay').length;
  const checkInsToday = allBookings.filter((b) => b.checkIn === todayStr && (b.status === 'Booked' || b.status === 'Checked In')).length;
  const avgStay = (() => {
    const stays = allBookings.map((b) => nights(b.checkIn, b.checkOut));
    return stays.length > 0 ? (stays.reduce((a, c) => a + c, 0) / stays.length).toFixed(1) : '0';
  })();
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const revenueMonth = allBookings
    .filter((b) => b.checkIn.startsWith(currentMonth) && b.payment !== 'Refunded')
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

  return (
    <div style={s.page}>
      <h1 style={s.title} className="helm-page-title">Transient Bookings</h1>
      <hr style={s.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading bookings...</div>}

      {/* Stats */}
      <div style={s.statsRow} className="helm-stats-grid">
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
                        {b.status === 'Booked' && (
                          <button
                            style={{ ...s.actionBtn, color: '#065F46', borderColor: '#10B981', backgroundColor: '#ECFDF5' }}
                            onClick={(ev) => handleCheckIn(b.id, ev)}
                          >
                            <CheckCircle size={12} /> Check In
                          </button>
                        )}
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
          <div style={s.filterBar} className="helm-filter-bar">
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
      {tab === 'calendar' && (() => {
        const { from: calFrom, to: calTo } = getCalWindow(calOffset);

        // Build the 14-day column headers
        const days: Date[] = [];
        for (let i = 0; i < 14; i++) {
          const d = new Date(calFrom);
          d.setDate(d.getDate() + i);
          days.push(d);
        }

        // Collect all slip IDs → slipNumber for rows
        const slipMap = new Map<string, string>();
        calBookings.forEach((b) => {
          if (b.slip) slipMap.set(b.slip.id, b.slip.slipNumber);
        });
        calAvail.forEach((sl) => slipMap.set(sl.id, sl.slipNumber));
        const slips = Array.from(slipMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));

        // Cell lookup: slipId + day (YYYY-MM-DD) → booking
        type CellInfo = { booking: CalBooking | null; available: boolean };
        const cellMap = new Map<string, CellInfo>();
        calAvail.forEach((sl) => {
          days.forEach((d) => {
            cellMap.set(`${sl.id}|${d.toISOString().slice(0, 10)}`, { booking: null, available: true });
          });
        });
        calBookings.forEach((b) => {
          if (!b.slip) return;
          const checkIn = new Date(b.checkIn);
          checkIn.setHours(0, 0, 0, 0);
          const checkOut = b.checkOut ? new Date(b.checkOut) : calTo;
          checkOut.setHours(0, 0, 0, 0);
          days.forEach((d) => {
            if (d >= checkIn && d < checkOut) {
              cellMap.set(`${b.slip!.id}|${d.toISOString().slice(0, 10)}`, { booking: b, available: false });
            }
          });
        });

        const statusColor: Record<string, string> = {
          BOOKED: '#3B82F6',
          CHECKED_IN: '#10B981',
          OVERSTAY: '#EF4444',
          CHECKED_OUT: '#9CA3AF',
          CANCELLED: '#E5E7EB',
        };

        const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const DOW_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return (
          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            {/* Calendar header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F7F9FB' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#0A2342' }}>
                {MONTH_SHORT[calFrom.getMonth()]} {calFrom.getDate()} – {MONTH_SHORT[calTo.getDate() <= calFrom.getDate() || calTo.getMonth() !== calFrom.getMonth() ? calTo.getMonth() : calFrom.getMonth()]} {calTo.getDate()}, {calTo.getFullYear()}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginRight: '16px', fontSize: '12px', color: '#64748B' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 10, height: 10, background: '#10B981', borderRadius: 2, display: 'inline-block' }} /> Checked In</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 10, height: 10, background: '#3B82F6', borderRadius: 2, display: 'inline-block' }} /> Booked</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 10, height: 10, background: '#EF4444', borderRadius: 2, display: 'inline-block' }} /> Overstay</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 10, height: 10, background: '#E8F5E9', border: '1px solid #A7F3D0', borderRadius: 2, display: 'inline-block' }} /> Available</span>
                </div>
                <button onClick={() => setCalOffset(o => o - 2)} style={{ padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#0A2342' }}>
                  <ChevronLeft size={16} />
                </button>
                <button onClick={() => setCalOffset(0)} style={{ padding: '5px 12px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#0A2342' }}>Today</button>
                <button onClick={() => setCalOffset(o => o + 2)} style={{ padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#0A2342' }}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {calLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px', color: '#64748B', gap: '10px' }}>
                <Calendar size={20} /> Loading availability…
              </div>
            ) : slips.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', color: '#94A3B8' }}>
                <CheckCircle size={32} style={{ color: '#10B981', marginBottom: '12px' }} />
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342', marginBottom: '4px' }}>All slips available</div>
                <div style={{ fontSize: '13px' }}>No transient bookings found in this 14-day window.</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '900px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#0A2342' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', color: '#fff', fontWeight: 600, fontSize: '12px', minWidth: '90px', position: 'sticky' as const, left: 0, background: '#0A2342', zIndex: 1 }}>Slip</th>
                      {days.map((d) => {
                        const isToday = d.getTime() === today.getTime();
                        return (
                          <th key={d.toISOString()} style={{ padding: '8px 4px', color: isToday ? '#00D4FF' : '#fff', fontWeight: isToday ? 700 : 500, fontSize: '11px', textAlign: 'center', minWidth: '52px', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
                            <div>{DOW_SHORT[d.getDay()]}</div>
                            <div style={{ fontSize: '13px', fontWeight: 700 }}>{d.getDate()}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {slips.map(([slipId, slipNum], rowIdx) => (
                      <tr key={slipId} style={{ backgroundColor: rowIdx % 2 === 0 ? '#fff' : '#F7F9FB' }}>
                        <td style={{ padding: '8px 16px', fontWeight: 600, color: '#0A2342', fontSize: '13px', position: 'sticky' as const, left: 0, background: rowIdx % 2 === 0 ? '#fff' : '#F7F9FB', zIndex: 1, borderRight: '2px solid #E2E8F0' }}>
                          {slipNum}
                        </td>
                        {days.map((d) => {
                          const key = `${slipId}|${d.toISOString().slice(0, 10)}`;
                          const cell = cellMap.get(key);
                          const isToday = d.getTime() === today.getTime();
                          if (!cell) {
                            return <td key={key} style={{ borderLeft: '1px solid #F1F5F9', backgroundColor: isToday ? 'rgba(0,212,255,0.05)' : undefined }} />;
                          }
                          if (cell.booking) {
                            const b = cell.booking;
                            const color = statusColor[b.status] ?? '#9CA3AF';
                            return (
                              <td key={key} title={`${b.guestName} — ${b.status}`} style={{ padding: '2px 3px', borderLeft: '1px solid #F1F5F9', backgroundColor: isToday ? 'rgba(0,212,255,0.05)' : undefined }}>
                                <div style={{ background: color, color: '#fff', borderRadius: '4px', padding: '3px 5px', fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '46px' }}>
                                  {b.guestName.split(' ')[0]}
                                </div>
                              </td>
                            );
                          }
                          return (
                            <td key={key} title="Available" style={{ padding: '2px 3px', borderLeft: '1px solid #F1F5F9', backgroundColor: isToday ? 'rgba(0,212,255,0.1)' : undefined }}>
                              <div style={{ background: '#E8F5E9', border: '1px solid #A7F3D0', borderRadius: '4px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CheckCircle size={10} color="#10B981" />
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── New Booking Modal ── */}
      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>New Transient Booking</h2>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={s.modalBody}>
              {/* Customer search (live lookup + manual entry) */}
              <div style={{ marginBottom: '16px', position: 'relative' }}>
                <span style={s.fieldLabel}>Guest Name * <span style={{ fontWeight: 400, color: '#94A3B8', textTransform: 'none', letterSpacing: 0 }}>(type to search existing customers)</span></span>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
                  <input
                    style={{ ...s.input, paddingLeft: '32px' }}
                    placeholder="Guest name or search customers…"
                    value={customerQuery}
                    onChange={(e) => handleCustomerQueryChange(e.target.value)}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                    onFocus={() => customerResults.length > 0 && setShowCustomerDropdown(true)}
                    autoComplete="off"
                  />
                  {customerSearching && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#94A3B8' }}>searching…</span>}
                </div>
                {showCustomerDropdown && customerResults.length > 0 && (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 2000, maxHeight: '200px', overflowY: 'auto' }}>
                    {customerResults.map((c) => (
                      <div
                        key={c.id}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9', transition: 'background 0.1s' }}
                        onMouseDown={() => selectCustomer(c)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = '#F0F9FF'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = ''; }}
                      >
                        <div style={{ fontWeight: 600, color: '#0A2342', fontSize: '14px' }}>{c.name}</div>
                        <div style={{ fontSize: '12px', color: '#64748B' }}>{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={s.fieldGrid}>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Email</span>
                  <input style={s.input} placeholder="email@example.com" type="email" value={nbEmail} onChange={(e) => setNbEmail(e.target.value)} />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Phone</span>
                  <input style={s.input} placeholder="(555) 000-0000" value={nbPhone} onChange={(e) => setNbPhone(e.target.value)} />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat Name</span>
                  <input style={s.input} placeholder="Vessel name" value={nbBoat} onChange={(e) => setNbBoat(e.target.value)} />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat Length (ft)</span>
                  <input style={s.input} placeholder="e.g. 32" type="number" value={nbLength} onChange={(e) => setNbLength(e.target.value)} />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Slip * <span style={{ fontWeight: 400, color: '#94A3B8', textTransform: 'none', letterSpacing: 0 }}>(transient-capable)</span></span>
                  <select style={{ ...s.input, ...s.select }} value={nbSlip} onChange={(e) => setNbSlip(e.target.value)}>
                    <option value="">Select available slip…</option>
                    {slipOptions.length === 0 && <option disabled>Loading slips…</option>}
                    {slipOptions.map((sl) => (
                      <option key={sl.id} value={sl.id}>
                        Slip {sl.slipNumber}{sl.lengthFt ? ` (${sl.lengthFt} × ${sl.widthFt} ft)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Check-In Date *</span>
                  <input style={s.input} type="date" value={nbCheckIn} min={todayStr} onChange={(e) => setNbCheckIn(e.target.value)} />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Expected Check-Out</span>
                  <input style={s.input} type="date" value={nbCheckOut} min={nbCheckIn || todayStr} onChange={(e) => setNbCheckOut(e.target.value)} />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Nightly Rate ($)</span>
                  <input style={s.input} placeholder="85.00" type="number" step="0.01" value={nbRate} onChange={(e) => setNbRate(e.target.value)} />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Payment Method</span>
                  <select style={{ ...s.input, ...s.select }} value={nbPayment} onChange={(e) => setNbPayment(e.target.value)}>
                    <option value="">Select…</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Cash">Cash</option>
                    <option value="Check">Check</option>
                    <option value="ACH Transfer">ACH Transfer</option>
                  </select>
                </div>
              </div>

              {/* Price preview */}
              {nbRate && nbCheckIn && nbCheckOut && (
                <div style={{ backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '6px', padding: '12px 16px', marginTop: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#0369A1', marginBottom: '4px' }}>Estimated Total</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>
                    {fmt$(parseFloat(nbRate) * Math.max(1, Math.round((new Date(nbCheckOut).getTime() - new Date(nbCheckIn).getTime()) / 86400000)))}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                    {fmt$(parseFloat(nbRate))} × {Math.max(1, Math.round((new Date(nbCheckOut).getTime() - new Date(nbCheckIn).getTime()) / 86400000))} night(s)
                  </div>
                </div>
              )}

              {nbError && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 10, padding: '8px 12px', backgroundColor: '#FEF2F2', borderRadius: '4px', border: '1px solid #FECACA' }}>{nbError}</div>}
              {(!customerQuery || !nbSlip || !nbCheckIn) && !nbError && (
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>* Guest name, slip, and check-in date are required</div>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => { setShowModal(false); resetBookingForm(); }}>Cancel</button>
              <button
                style={{ ...s.primaryBtn, opacity: (!customerQuery || !nbSlip || !nbCheckIn) ? 0.5 : 1 }}
                onClick={handleCreateBooking}
                disabled={nbSaving || !customerQuery || !nbSlip || !nbCheckIn}
              >
                <CreditCard size={16} /> {nbSaving ? 'Creating…' : 'Create Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
