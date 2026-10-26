import { useState } from 'react';
import { useApiClient, useList, useResource } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { customerName, type CustomerRef } from '../lib/dto';
import { dateKey, formatDate, todayKey } from '../lib/format';
import { ErrorState, InlineError, LoadingState } from '../components/StateViews';
import { useToast } from '../components/Toast';
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

/* ── API mapping ───────────────────────────────────────── */

interface RampTicketDTO {
  id: string;
  customerId?: string | null;
  guestName?: string | null;
  licensePlate?: string | null;
  boatRegistration?: string | null;
  ticketType: 'SINGLE_LAUNCH' | 'DAILY_PASS' | 'SEASONAL_PASS';
  amountCents: number;
  paymentMethod?: string | null;
  createdAt: string;
  customer?: CustomerRef | null;
}

const TYPE_LABEL: Record<RampTicketDTO['ticketType'], TicketType> = {
  SINGLE_LAUNCH: 'Single Launch', DAILY_PASS: 'Daily Pass', SEASONAL_PASS: 'Seasonal Pass',
};
const TYPE_ENUM: Record<TicketType, RampTicketDTO['ticketType']> = {
  'Single Launch': 'SINGLE_LAUNCH', 'Daily Pass': 'DAILY_PASS', 'Seasonal Pass': 'SEASONAL_PASS',
};

function toTicket(t: RampTicketDTO): RampTicket {
  const created = new Date(t.createdAt);
  return {
    id: t.id,
    ticketNumber: t.id.slice(0, 8).toUpperCase(),
    time: created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    date: dateKey(t.createdAt),
    customerName: t.customer ? customerName(t.customer) : t.guestName ?? 'Guest',
    isGuest: !t.customerId,
    boatReg: t.boatRegistration ?? '—',
    licensePlate: t.licensePlate ?? '—',
    ticketType: TYPE_LABEL[t.ticketType] ?? 'Single Launch',
    amount: t.amountCents / 100,
    // The API has no ticket status; a recorded ticket is shown as completed.
    status: 'Completed',
    payment: t.paymentMethod ?? '—',
  };
}

const TICKET_STATUS_COLORS: Record<TicketStatus, { bg: string; text: string }> = {
  Active: { bg: '#E8F5E9', text: '#1B5E20' },
  Completed: { bg: '#D6E8F4', text: '#0A2342' },
  Void: { bg: '#FDECEA', text: '#B71C1C' },
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

  const client = useApiClient();
  const toast = useToast();
  const list = useList<RampTicket, RampTicketDTO>('/ramp/tickets?take=200', { map: toTicket });
  const passes = useList<RampTicket, RampTicketDTO>(tab === 'passes' ? '/ramp/tickets?take=200&ticketType=SEASONAL_PASS' : null, { map: toTicket });
  const stats = useResource<{ launchesToday: number; launchesThisWeek: number; weekRevenueCents: number }, { data: { launchesToday: number; launchesThisWeek: number; weekRevenueCents: number } }>('/ramp/stats', { map: (r) => r.data });
  const tickets = list.items;

  const today = todayKey();
  const todayTickets = tickets.filter((t) => t.date === today);
  const revenueToday = todayTickets.reduce((sum, t) => sum + t.amount, 0);

  // New ticket form
  const [ntName, setNtName] = useState('');
  const [ntPlate, setNtPlate] = useState('');
  const [ntReg, setNtReg] = useState('');
  const [ntAmount, setNtAmount] = useState('');
  const [ntMethod, setNtMethod] = useState<'CARD' | 'CASH' | 'CHARGE_TO_SLIP'>('CARD');
  const [ntSaving, setNtSaving] = useState(false);
  const [ntError, setNtError] = useState<string | null>(null);
  const recordTicket = async () => {
    const cents = Math.round(Number(ntAmount) * 100);
    if (!(cents >= 0) || ntAmount.trim() === '') { setNtError('Enter the amount charged.'); return; }
    setNtSaving(true);
    setNtError(null);
    try {
      await client.post('/ramp/tickets', {
        guestName: ntName.trim() || null,
        licensePlate: ntPlate.trim() || null,
        boatRegistration: ntReg.trim() || null,
        ticketType: TYPE_ENUM[ticketTypeField],
        amountCents: cents,
        paymentMethod: ntMethod,
      });
      toast.success('Launch recorded');
      setShowModal(false);
      setNtName(''); setNtPlate(''); setNtReg(''); setNtAmount('');
      list.refetch();
      stats.refetch();
    } catch (err) {
      setNtError(errorMessage(err));
    } finally {
      setNtSaving(false);
    }
  };

  const filteredAll = tickets.filter((t) => {
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
      <h1 style={s.title} className="helm-page-title">Launch Ramp</h1>
      <hr style={s.divider} />

      {/* Stats */}
      <div style={s.statsRow} className="helm-stats-grid">
        <div style={s.statCard}>
          <div style={s.statLabel}>Launches Today</div>
          <div style={s.statValue}>{stats.data ? stats.data.launchesToday : list.loading ? '—' : todayTickets.length}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Revenue Today</div>
          <div style={s.statValue}>{list.loading ? '—' : `$${revenueToday.toFixed(2)}`}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Launches This Week</div>
          <div style={s.statValue}>{stats.data ? stats.data.launchesThisWeek : '—'}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Revenue This Week</div>
          <div style={s.statValue}>{stats.data ? `$${(stats.data.weekRevenueCents / 100).toFixed(2)}` : '—'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs} className="helm-tabs">
        <button style={tab === 'today' ? s.tabActive : s.tab} onClick={() => setTab('today')}>Today's Activity</button>
        <button style={tab === 'all' ? s.tabActive : s.tab} onClick={() => setTab('all')}>All Tickets</button>
        <button style={tab === 'passes' ? s.tabActive : s.tab} onClick={() => setTab('passes')}>Seasonal Passes</button>
      </div>

      {/* ── Today's Activity Tab ── */}
      {tab === 'today' && (
        <>
          <div style={s.filterBar} className="helm-filter-bar">
            <Activity size={16} style={{ color: '#00D4FF' }} />
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Activity Log — {formatDate(today)}</span>
            <div style={s.spacer} />
            <button style={s.primaryBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Ticket
            </button>
          </div>
          {list.loading ? <LoadingState label="Loading ramp tickets…" /> : list.error ? <ErrorState title="Could not load ramp tickets" message={list.error} onRetry={list.refetch} /> : (
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }} className="helm-table-wrap">
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
                {todayTickets.length === 0 && (
                  <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#64748B', padding: 24 }}>No launches recorded today.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {/* ── All Tickets Tab ── */}
      {tab === 'all' && (
        <>
          <div style={s.filterBar} className="helm-filter-bar">
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
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }} className="helm-table-wrap">
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
          <div style={s.filterBar} className="helm-filter-bar">
            <BadgeCheck size={16} style={{ color: '#00D4FF' }} />
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Seasonal Pass Holders</span>
            <div style={s.spacer} />
          </div>
          {passes.loading ? <LoadingState label="Loading passes…" /> : passes.error ? <ErrorState title="Could not load seasonal passes" message={passes.error} onRetry={passes.refetch} /> : (
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }} className="helm-table-wrap">
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Pass</th>
                  <th style={s.th}>Customer</th>
                  <th style={s.th}>Boat Reg</th>
                  <th style={s.th}>Sold</th>
                  <th style={s.th}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {passes.items.map((p, idx) => (
                  <tr key={p.id} style={idx % 2 === 0 ? s.rowOdd : s.rowEven}>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{p.ticketNumber}</td>
                    <td style={{ ...s.td, fontWeight: 600 }}>{p.customerName}</td>
                    <td style={s.td}>{p.boatReg}</td>
                    <td style={s.td}>{formatDate(p.date)}</td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{fmt$(p.amount)}</td>
                  </tr>
                ))}
                {passes.items.length === 0 && (
                  <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: '#64748B', padding: 24 }}>No seasonal passes sold. Pass expiry and launch counts are not tracked by the API yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {/* ── New Ticket Modal ── */}
      {showModal && (
        <div style={s.overlay} onClick={() => { if (!ntSaving) setShowModal(false); }}>
          <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>New Ramp Ticket</h2>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={s.modalBody}>
              {ntError && <div style={{ marginBottom: 12 }}><InlineError message={ntError} /></div>}
              <div style={s.fieldGrid}>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Guest Name</span>
                  <input style={s.input} placeholder="Name" value={ntName} onChange={(e) => setNtName(e.target.value)} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>License Plate</span>
                  <input style={s.input} placeholder="ABC 1234" value={ntPlate} onChange={(e) => setNtPlate(e.target.value)} />
                </label>
                <label style={s.field}>
                  <span style={s.fieldLabel}>Boat Registration</span>
                  <input style={s.input} placeholder="FL-0000-XX" value={ntReg} onChange={(e) => setNtReg(e.target.value)} />
                </label>
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
                    placeholder="0.00"
                    value={ntAmount}
                    onChange={(e) => setNtAmount(e.target.value)}
                  />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Payment Method</span>
                  <select style={{ ...s.input, ...s.select }} value={ntMethod} onChange={(e) => setNtMethod(e.target.value as typeof ntMethod)}>
                    <option value="CARD">Card</option>
                    <option value="CASH">Cash</option>
                    <option value="CHARGE_TO_SLIP">Charge to Slip</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} disabled={ntSaving} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={{ ...s.primaryBtn, opacity: ntSaving ? 0.7 : 1 }} disabled={ntSaving} onClick={recordTicket}>
                <Waves size={16} /> {ntSaving ? 'Recording...' : 'Record Launch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
