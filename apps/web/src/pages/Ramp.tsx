import { useState } from 'react';
import {
  Search,
  Plus,
  X,
  Clock,
  DollarSign,
  TrendingUp,
  CreditCard,
  Waves,
  Car,
  Ticket,
  BadgeCheck,
  Activity,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type TicketType = 'Single Launch' | 'Daily Pass' | 'Seasonal Pass';
type TicketStatus = 'Active' | 'Completed' | 'Void';
type PassStatus = 'Active' | 'Expired' | 'Suspended';
type TabKey = 'today' | 'all' | 'passes';

interface RampTicket {
  id: string;
  ticketNumber: string;
  time: string;
  date: string;
  customerName: string;
  isGuest: boolean;
  boatReg: string;
  licensePlate: string;
  ticketType: TicketType;
  amount: number;
  status: TicketStatus;
  payment: string;
}

interface SeasonalPass {
  id: string;
  passNumber: string;
  customer: string;
  phone: string;
  email: string;
  startDate: string;
  endDate: string;
  launchesUsed: number;
  status: PassStatus;
}

/* ── Mock Data ─────────────────────────────────────────── */

const TICKET_RATES: Record<TicketType, number> = {
  'Single Launch': 25,
  'Daily Pass': 45,
  'Seasonal Pass': 0,
};

const MOCK_TICKETS: RampTicket[] = [
  { id: '1', ticketNumber: 'RM-4001', time: '06:15 AM', date: '2026-03-25', customerName: 'Frank Delaney', isGuest: false, boatReg: 'FL-3821-AB', licensePlate: 'ABC 1234', ticketType: 'Single Launch', amount: 25, status: 'Completed', payment: 'Credit Card' },
  { id: '2', ticketNumber: 'RM-4002', time: '06:42 AM', date: '2026-03-25', customerName: 'Guest', isGuest: true, boatReg: 'GA-1155-CD', licensePlate: 'XYZ 5678', ticketType: 'Single Launch', amount: 25, status: 'Completed', payment: 'Cash' },
  { id: '3', ticketNumber: 'RM-4003', time: '07:10 AM', date: '2026-03-25', customerName: 'Walter Hughes', isGuest: false, boatReg: 'FL-9082-EF', licensePlate: 'WAL 9012', ticketType: 'Seasonal Pass', amount: 0, status: 'Completed', payment: 'Season Pass #SP-201' },
  { id: '4', ticketNumber: 'RM-4004', time: '07:35 AM', date: '2026-03-25', customerName: 'Sarah Nguyen', isGuest: false, boatReg: 'FL-4410-GH', licensePlate: 'SRN 3456', ticketType: 'Daily Pass', amount: 45, status: 'Active', payment: 'Credit Card' },
  { id: '5', ticketNumber: 'RM-4005', time: '08:00 AM', date: '2026-03-25', customerName: 'Guest', isGuest: true, boatReg: 'SC-7722-IJ', licensePlate: 'OUT 7890', ticketType: 'Single Launch', amount: 25, status: 'Active', payment: 'Cash' },
  { id: '6', ticketNumber: 'RM-4006', time: '08:25 AM', date: '2026-03-25', customerName: 'Marcus Bell', isGuest: false, boatReg: 'FL-5567-KL', licensePlate: 'MBL 1122', ticketType: 'Seasonal Pass', amount: 0, status: 'Active', payment: 'Season Pass #SP-204' },
  { id: '7', ticketNumber: 'RM-4007', time: '08:50 AM', date: '2026-03-25', customerName: 'Patricia Coleman', isGuest: false, boatReg: 'FL-2298-MN', licensePlate: 'PCL 3344', ticketType: 'Single Launch', amount: 25, status: 'Active', payment: 'Credit Card' },
  { id: '8', ticketNumber: 'RM-4008', time: '09:15 AM', date: '2026-03-25', customerName: 'Guest', isGuest: true, boatReg: 'AL-8833-OP', licensePlate: 'VIS 5566', ticketType: 'Daily Pass', amount: 45, status: 'Active', payment: 'Credit Card' },
  { id: '9', ticketNumber: 'RM-3990', time: '03:30 PM', date: '2026-03-24', customerName: 'James O\'Brien', isGuest: false, boatReg: 'FL-6640-QR', licensePlate: 'JOB 7788', ticketType: 'Single Launch', amount: 25, status: 'Completed', payment: 'Cash' },
  { id: '10', ticketNumber: 'RM-3991', time: '04:10 PM', date: '2026-03-24', customerName: 'Diane Kowalski', isGuest: false, boatReg: 'FL-1199-ST', licensePlate: 'DKW 9900', ticketType: 'Seasonal Pass', amount: 0, status: 'Completed', payment: 'Season Pass #SP-203' },
  { id: '11', ticketNumber: 'RM-3985', time: '10:00 AM', date: '2026-03-23', customerName: 'Guest', isGuest: true, boatReg: 'NC-5544-UV', licensePlate: 'TMP 1111', ticketType: 'Single Launch', amount: 25, status: 'Void', payment: 'Refunded' },
  { id: '12', ticketNumber: 'RM-3986', time: '11:20 AM', date: '2026-03-23', customerName: 'Carlos Rivera', isGuest: false, boatReg: 'FL-7788-WX', licensePlate: 'CRV 2233', ticketType: 'Daily Pass', amount: 45, status: 'Completed', payment: 'Credit Card' },
];

const MOCK_PASSES: SeasonalPass[] = [
  { id: '1', passNumber: 'SP-201', customer: 'Walter Hughes', phone: '(555) 201-0001', email: 'whughes@email.com', startDate: '2026-01-01', endDate: '2026-12-31', launchesUsed: 34, status: 'Active' },
  { id: '2', passNumber: 'SP-202', customer: 'Linda Prescott', phone: '(555) 202-0002', email: 'lprescott@email.com', startDate: '2026-01-01', endDate: '2026-12-31', launchesUsed: 22, status: 'Active' },
  { id: '3', passNumber: 'SP-203', customer: 'Diane Kowalski', phone: '(555) 203-0003', email: 'dkowalski@email.com', startDate: '2026-01-01', endDate: '2026-12-31', launchesUsed: 41, status: 'Active' },
  { id: '4', passNumber: 'SP-204', customer: 'Marcus Bell', phone: '(555) 204-0004', email: 'mbell@email.com', startDate: '2026-03-01', endDate: '2026-10-31', launchesUsed: 8, status: 'Active' },
  { id: '5', passNumber: 'SP-185', customer: 'Raymond Foster', phone: '(555) 205-0005', email: 'rfoster@email.com', startDate: '2025-01-01', endDate: '2025-12-31', launchesUsed: 52, status: 'Expired' },
];

const TICKET_STATUS_COLORS: Record<TicketStatus, { bg: string; text: string }> = {
  Active: { bg: '#E8F5E9', text: '#1B5E20' },
  Completed: { bg: '#D6E8F4', text: '#0A2342' },
  Void: { bg: '#FDECEA', text: '#B71C1C' },
};

const PASS_STATUS_COLORS: Record<PassStatus, { bg: string; text: string }> = {
  Active: { bg: '#E8F5E9', text: '#1B5E20' },
  Expired: { bg: '#F5F5F5', text: '#616161' },
  Suspended: { bg: '#FFF3CD', text: '#856404' },
};

/* ── Helpers ───────────────────────────────────────────── */

function fmt$(n: number): string {
  return n === 0 ? '--' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  guestBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: '#FFF3CD', color: '#856404', marginLeft: '6px' },
  /* Modal */
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10, 35, 66, 0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { backgroundColor: '#FFFFFF', borderRadius: '12px', width: '520px', maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' as const },
  modalHeader: { padding: '24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { padding: '4px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#2E4A6B', display: 'flex', alignItems: 'center' },
  modalBody: { flex: 1, overflowY: 'auto' as const, padding: '24px' },
  fieldGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  fieldLabel: { fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.03em' },
  input: { padding: '8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', outline: 'none' },
  modalFooter: { padding: '20px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#F7F9FB' },
  cancelBtn: { padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  /* Pass card */
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' },
};

/* ── Component ─────────────────────────────────────────── */

export default function Ramp() {
  const [tab, setTab] = useState<TabKey>('today');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [ticketTypeField, setTicketTypeField] = useState<TicketType>('Single Launch');

  const todayTickets = MOCK_TICKETS.filter((t) => t.date === '2026-03-25');
  const launchesToday = todayTickets.length;
  const revenueToday = todayTickets.reduce((sum, t) => sum + t.amount, 0);
  const activePasses = MOCK_PASSES.filter((p) => p.status === 'Active').length;
  const peakHour = '7:00 - 8:00 AM';

  const filteredAll = MOCK_TICKETS.filter((t) => {
    if (typeFilter !== 'All' && t.ticketType !== typeFilter) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${t.ticketNumber} ${t.customerName} ${t.boatReg} ${t.licensePlate}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={s.page}>
      <h1 style={s.title}>Launch Ramp</h1>
      <hr style={s.divider} />

      {/* Stats */}
      <div style={s.statsRow}>
        <div style={s.statCard}>
          <div style={s.statLabel}>Launches Today</div>
          <div style={s.statValue}>{launchesToday}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Revenue Today</div>
          <div style={s.statValue}>${revenueToday.toFixed(2)}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Active Passes</div>
          <div style={s.statValue}>{activePasses}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Peak Hour</div>
          <div style={{ ...s.statValue, fontSize: '18px' }}>{peakHour}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        <button style={tab === 'today' ? s.tabActive : s.tab} onClick={() => setTab('today')}>Today's Activity</button>
        <button style={tab === 'all' ? s.tabActive : s.tab} onClick={() => setTab('all')}>All Tickets</button>
        <button style={tab === 'passes' ? s.tabActive : s.tab} onClick={() => setTab('passes')}>Seasonal Passes</button>
      </div>

      {/* ── Today's Activity Tab ── */}
      {tab === 'today' && (
        <>
          <div style={s.filterBar}>
            <Activity size={16} style={{ color: '#00D4FF' }} />
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Live Activity Log — March 25, 2026</span>
            <div style={s.spacer} />
            <button style={s.primaryBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Ticket
            </button>
          </div>
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Time</th>
                  <th style={s.th}>Name / Guest</th>
                  <th style={s.th}>Boat Reg</th>
                  <th style={s.th}>License Plate</th>
                  <th style={s.th}>Ticket Type</th>
                  <th style={s.th}>Amount</th>
                  <th style={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {todayTickets.map((t, idx) => (
                  <tr key={t.id} style={idx % 2 === 0 ? s.rowOdd : s.rowEven}>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>
                      <Clock size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                      {t.time}
                    </td>
                    <td style={{ ...s.td, fontWeight: 600 }}>
                      {t.customerName}
                      {t.isGuest && <span style={s.guestBadge}>GUEST</span>}
                    </td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{t.boatReg}</td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>
                      <Car size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                      {t.licensePlate}
                    </td>
                    <td style={s.td}>
                      <Ticket size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                      {t.ticketType}
                    </td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{fmt$(t.amount)}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, backgroundColor: TICKET_STATUS_COLORS[t.status].bg, color: TICKET_STATUS_COLORS[t.status].text }}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── All Tickets Tab ── */}
      {tab === 'all' && (
        <>
          <div style={s.filterBar}>
            <div style={s.searchWrap}>
              <Search size={16} style={s.searchIcon} />
              <input style={s.searchInput} placeholder="Search tickets..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <input type="date" style={s.dateInput} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From" />
            <span style={{ color: '#64748B', fontSize: '13px' }}>to</span>
            <input type="date" style={s.dateInput} value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To" />
            <select style={s.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="All">All Types</option>
              <option value="Single Launch">Single Launch</option>
              <option value="Daily Pass">Daily Pass</option>
              <option value="Seasonal Pass">Seasonal Pass</option>
            </select>
            <div style={s.spacer} />
            <button style={s.primaryBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Ticket
            </button>
          </div>
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Ticket #</th>
                  <th style={s.th}>Date</th>
                  <th style={s.th}>Time</th>
                  <th style={s.th}>Customer</th>
                  <th style={s.th}>Boat Reg</th>
                  <th style={s.th}>License Plate</th>
                  <th style={s.th}>Type</th>
                  <th style={s.th}>Amount</th>
                  <th style={s.th}>Payment</th>
                  <th style={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAll.map((t, idx) => (
                  <tr key={t.id} style={idx % 2 === 0 ? s.rowOdd : s.rowEven}>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{t.ticketNumber}</td>
                    <td style={s.td}>{t.date}</td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{t.time}</td>
                    <td style={{ ...s.td, fontWeight: 600 }}>
                      {t.customerName}
                      {t.isGuest && <span style={s.guestBadge}>GUEST</span>}
                    </td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{t.boatReg}</td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{t.licensePlate}</td>
                    <td style={s.td}>{t.ticketType}</td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{fmt$(t.amount)}</td>
                    <td style={s.td}>{t.payment}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, backgroundColor: TICKET_STATUS_COLORS[t.status].bg, color: TICKET_STATUS_COLORS[t.status].text }}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredAll.length === 0 && (
                  <tr><td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={10}>No tickets match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Seasonal Passes Tab ── */}
      {tab === 'passes' && (
        <>
          <div style={s.filterBar}>
            <BadgeCheck size={16} style={{ color: '#00D4FF' }} />
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Seasonal Pass Holders</span>
            <div style={s.spacer} />
          </div>
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Pass #</th>
                  <th style={s.th}>Customer</th>
                  <th style={s.th}>Phone</th>
                  <th style={s.th}>Start Date</th>
                  <th style={s.th}>End Date</th>
                  <th style={s.th}>Launches Used</th>
                  <th style={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_PASSES.map((p, idx) => (
                  <tr key={p.id} style={idx % 2 === 0 ? s.rowOdd : s.rowEven}>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{p.passNumber}</td>
                    <td style={{ ...s.td, fontWeight: 600 }}>{p.customer}</td>
                    <td style={s.td}>{p.phone}</td>
                    <td style={s.td}>{p.startDate}</td>
                    <td style={s.td}>{p.endDate}</td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', textAlign: 'center' }}>{p.launchesUsed}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, backgroundColor: PASS_STATUS_COLORS[p.status].bg, color: PASS_STATUS_COLORS[p.status].text }}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── New Ticket Modal ── */}
      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>New Ramp Ticket</h2>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={s.modalBody}>
              <div style={s.fieldGrid}>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Customer / Guest Name</span>
                  <input style={s.input} placeholder="Name or 'Guest'" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>License Plate</span>
                  <input style={s.input} placeholder="ABC 1234" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat Registration</span>
                  <input style={s.input} placeholder="FL-0000-XX" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Ticket Type</span>
                  <select
                    style={{ ...s.input, ...s.select }}
                    value={ticketTypeField}
                    onChange={(e) => setTicketTypeField(e.target.value as TicketType)}
                  >
                    <option value="Single Launch">Single Launch</option>
                    <option value="Daily Pass">Daily Pass</option>
                    <option value="Seasonal Pass">Seasonal Pass</option>
                  </select>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Amount ($)</span>
                  <input
                    style={s.input}
                    type="number"
                    step="0.01"
                    value={TICKET_RATES[ticketTypeField]}
                    readOnly={ticketTypeField === 'Seasonal Pass'}
                  />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Payment Method</span>
                  <select style={{ ...s.input, ...s.select }}>
                    <option value="credit">Credit Card</option>
                    <option value="cash">Cash</option>
                    <option value="season">Season Pass</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={s.primaryBtn} onClick={() => setShowModal(false)}>
                <Waves size={16} /> Record Launch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
