import { useState } from 'react';
import {
  Search,
  Plus,
  Bell,
  Check,
  Trash2,
  X,
  Anchor,
  Calendar,
  Ship,
  Mail,
  Phone,
} from 'lucide-react';
import { useApiClient, useList } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { customerName, type CustomerRef } from '../lib/dto';
import { formatDate, formatPhone } from '../lib/format';
import CustomerPicker from '../components/CustomerPicker';
import { ComingSoonButton, ErrorState, InlineError, LoadingState } from '../components/StateViews';
import { useToast } from '../components/Toast';

/* ── Types ─────────────────────────────────────────────── */

type WaitlistStatus = 'Waiting' | 'Notified' | 'Hold' | 'Accepted' | 'Expired';
type SlipType = 'Annual' | 'Seasonal' | 'Transient' | 'Liveaboard';

interface WaitlistEntry {
  id: string;
  position: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  slipType: string;
  boatLength: number | null;
  desiredDate: string;
  status: WaitlistStatus;
  dateAdded: string;
  notifiedAt: string;
  holdExpiresAt: string;
}

interface WaitlistDTO {
  id: string;
  queuePosition: number;
  slipType?: string | null;
  boatLength?: number | null;
  desiredDate?: string | null;
  status: 'WAITING' | 'NOTIFIED' | 'HOLD' | 'ACCEPTED' | 'EXPIRED' | 'REMOVED';
  notifiedAt?: string | null;
  holdExpiresAt?: string | null;
  createdAt: string;
  customer?: CustomerRef | null;
  lead?: CustomerRef | null;
}

const STATUS_LABEL: Record<string, WaitlistStatus> = {
  WAITING: 'Waiting', NOTIFIED: 'Notified', HOLD: 'Hold', ACCEPTED: 'Accepted', EXPIRED: 'Expired',
};
const STATUS_ENUM: Record<string, string> = {
  Waiting: 'WAITING', Notified: 'NOTIFIED', Hold: 'HOLD', Accepted: 'ACCEPTED', Expired: 'EXPIRED',
};

function toEntry(e: WaitlistDTO): WaitlistEntry {
  const person = e.customer ?? e.lead ?? null;
  return {
    id: e.id,
    position: e.queuePosition,
    firstName: person?.firstName ?? '',
    lastName: person?.lastName ?? (person ? '' : customerName(null)),
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    slipType: e.slipType ?? '—',
    boatLength: e.boatLength ?? null,
    desiredDate: e.desiredDate ?? '',
    status: STATUS_LABEL[e.status] ?? 'Expired',
    dateAdded: e.createdAt,
    notifiedAt: e.notifiedAt ?? '',
    holdExpiresAt: e.holdExpiresAt ?? '',
  };
}

const ACCEPT_REASON = 'Coming soon: accepting an offer creates a contract and needs a slip, start date and rate; this form is not built yet.';

const SLIP_TYPES: SlipType[] = ['Annual', 'Seasonal', 'Transient', 'Liveaboard'];
const STATUSES: WaitlistStatus[] = ['Waiting', 'Notified', 'Hold', 'Accepted', 'Expired'];

const STATUS_COLORS: Record<WaitlistStatus, { bg: string; text: string }> = {
  Waiting: { bg: '#D6E8F4', text: '#0A2342' },
  Notified: { bg: '#FFF3CD', text: '#856404' },
  Hold: { bg: '#E0F7FA', text: '#006064' },
  Accepted: { bg: '#E8F5E9', text: '#1B5E20' },
  Expired: { bg: '#FDECEA', text: '#B71C1C' },
};

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  divider: {
    height: '4px',
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: '12px',
    marginBottom: '32px',
    borderRadius: '2px',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  select: {
    padding: '8px 32px 8px 12px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFF',
    appearance: 'none' as const,
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    cursor: 'pointer',
    minWidth: '140px',
  },
  searchWrap: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: '10px',
    color: '#2E4A6B',
    pointerEvents: 'none' as const,
  },
  searchInput: {
    padding: '8px 12px 8px 34px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFF',
    width: '220px',
    outline: 'none',
  },
  spacer: { flex: 1 },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '16px',
    marginBottom: '24px',
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '8px',
    padding: '16px 20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  statLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    marginBottom: '4px',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#0A2342',
    fontFamily: '"JetBrains Mono", monospace',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  th: {
    backgroundColor: '#0A2342',
    color: '#FFFFFF',
    padding: '12px 16px',
    fontSize: '13px',
    fontWeight: 600,
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#0A2342',
    borderBottom: '1px solid #E2E8F0',
    whiteSpace: 'nowrap' as const,
  },
  rowEven: { backgroundColor: '#D6E8F4' },
  rowOdd: { backgroundColor: '#FFFFFF' },
  badge: {
    display: 'inline-block',
    padding: '3px 12px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: '18px',
  },
  positionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: '#0A2342',
    color: '#FFFFFF',
    fontSize: '13px',
    fontWeight: 700,
    fontFamily: '"JetBrains Mono", monospace',
  },
  actionBtn: {
    padding: '5px 10px',
    fontSize: '12px',
    fontWeight: 600,
    border: '1px solid #CCC',
    borderRadius: '4px',
    backgroundColor: '#FFFFFF',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: '#2E4A6B',
    marginRight: '4px',
  },
  actionBtnNotify: {
    color: '#856404',
    borderColor: '#FFC107',
    backgroundColor: '#FFF8E1',
  },
  actionBtnAccept: {
    color: '#1B5E20',
    borderColor: '#A5D6A7',
    backgroundColor: '#E8F5E9',
  },
  actionBtnRemove: {
    color: '#B71C1C',
    borderColor: '#EF9A9A',
    backgroundColor: '#FDECEA',
  },
  /* Modal */
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    width: '520px',
    maxWidth: '95vw',
    maxHeight: '85vh',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  modalHeader: {
    padding: '24px',
    borderBottom: '1px solid #E2E8F0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
  },
  closeBtn: {
    padding: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: '#2E4A6B',
    display: 'flex',
    alignItems: 'center',
  },
  modalBody: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '24px',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  fieldLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  fieldValue: {
    fontSize: '14px',
    color: '#0A2342',
    fontWeight: 500,
  },
  fieldValueMono: {
    fontSize: '14px',
    color: '#0A2342',
    fontWeight: 500,
    fontFamily: '"JetBrains Mono", monospace',
  },
  notesBox: {
    marginTop: '20px',
    padding: '16px',
    backgroundColor: '#F7F9FB',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
  },
  notesLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    marginBottom: '8px',
  },
  notesText: {
    fontSize: '14px',
    color: '#0A2342',
    lineHeight: 1.6,
  },
  modalFooter: {
    padding: '20px 24px',
    borderTop: '1px solid #E2E8F0',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    backgroundColor: '#F7F9FB',
  },
};

/* ── Component ─────────────────────────────────────────── */

export default function Waitlist() {
  const [slipFilter, setSlipFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<WaitlistEntry | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const client = useApiClient();
  const toast = useToast();

  // Add form
  const [addCustomer, setAddCustomer] = useState<CustomerRef | null>(null);
  const [addSlipType, setAddSlipType] = useState<string>(SLIP_TYPES[0]);
  const [addLength, setAddLength] = useState('');
  const [addDate, setAddDate] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: '100' });
  if (slipFilter !== 'All') params.set('slipType', slipFilter);
  if (statusFilter !== 'All') params.set('status', STATUS_ENUM[statusFilter]);
  const list = useList<WaitlistEntry, WaitlistDTO>(`/waitlist?${params.toString()}`, { map: toEntry });
  const entries = list.items;

  const filtered = entries.filter((e) => {
    if (search) {
      const q = search.toLowerCase();
      const full = `${e.firstName} ${e.lastName} ${e.email}`.toLowerCase();
      if (!full.includes(q)) return false;
    }
    return true;
  });

  const countByStatus = (status: WaitlistStatus) =>
    entries.filter((e) => e.status === status).length;

  // The API notifies the next WAITING entry for a slip type (POST /waitlist/notify-next),
  // so Notify is offered only on the entry that is actually next in its queue.
  const nextWaitingId = (slipType: string) =>
    entries.filter((e) => e.status === 'Waiting' && e.slipType === slipType).sort((a, b) => a.position - b.position)[0]?.id;

  const handleNotify = async (entry: WaitlistEntry, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (busy) return;
    setBusy(entry.id);
    setActionError(null);
    try {
      await client.post('/waitlist/notify-next', { slipType: entry.slipType });
      toast.success(`Next ${entry.slipType} entry notified and placed on hold`);
      list.refetch();
      setSelectedEntry(null);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (entry: WaitlistEntry, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (busy || !window.confirm(`Remove ${entry.firstName} ${entry.lastName} from the waitlist?`)) return;
    setBusy(entry.id);
    setActionError(null);
    try {
      await client.delete(`/waitlist/${entry.id}`);
      toast.success('Removed from waitlist');
      list.refetch();
      setSelectedEntry(null);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = async () => {
    if (!addCustomer) { setAddError('Select a customer.'); return; }
    setAddSaving(true);
    setAddError(null);
    try {
      await client.post('/waitlist', {
        customerId: addCustomer.id,
        slipType: addSlipType,
        boatLength: Number(addLength) > 0 ? Number(addLength) : null,
        desiredDate: addDate || null,
      });
      toast.success(`${customerName(addCustomer)} added to the waitlist`);
      setShowAddModal(false);
      setAddCustomer(null); setAddLength(''); setAddDate('');
      list.refetch();
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setAddSaving(false);
    }
  };

  return (
    <div style={s.page}>
      <h1 style={s.title} className="helm-page-title">Waitlist</h1>
      <hr style={s.divider} />

      {actionError && <div style={{ marginBottom: 16 }}><InlineError message={actionError} /></div>}

      {/* Stats Row */}
      <div style={s.statsRow} className="helm-stats-grid">
        {STATUSES.map((status) => (
          <div key={status} style={s.statCard}>
            <div style={s.statLabel}>{status}</div>
            <div style={s.statValue}>{list.loading ? '—' : countByStatus(status)}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div style={s.filterBar} className="helm-filter-bar">
        <select
          style={s.select}
          value={slipFilter}
          onChange={(e) => setSlipFilter(e.target.value)}
        >
          <option value="All">All Slip Types</option>
          {SLIP_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          style={s.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="All">All Statuses</option>
          {STATUSES.map((st) => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>

        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="Search waitlist..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={s.spacer} />

        <button style={s.primaryBtn} onClick={() => setShowAddModal(true)}>
          <Plus size={16} />
          Add to Waitlist
        </button>
      </div>

      {/* Table */}
      {list.loading ? <LoadingState label="Loading waitlist…" /> : list.error ? <ErrorState title="Could not load the waitlist" message={list.error} onRetry={list.refetch} /> : (
      <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }} className="helm-table-wrap">
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>#</th>
              <th style={s.th}>Customer Name</th>
              <th style={s.th}>Slip Type</th>
              <th style={s.th}>Boat Length</th>
              <th style={s.th}>Desired Date</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Date Added</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, idx) => (
              <tr
                key={entry.id}
                style={{
                  ...(idx % 2 === 0 ? s.rowOdd : s.rowEven),
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedEntry(entry)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#EBF2FA';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                    idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                }}
              >
                <td style={s.td}>
                  <span style={s.positionBadge}>{entry.position}</span>
                </td>
                <td style={{ ...s.td, fontWeight: 600 }}>
                  {`${entry.firstName} ${entry.lastName}`.trim() || '—'}
                </td>
                <td style={s.td}>{entry.slipType}</td>
                <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>
                  {entry.boatLength ? `${entry.boatLength} ft` : '—'}
                </td>
                <td style={s.td}>{formatDate(entry.desiredDate)}</td>
                <td style={s.td}>
                  <span
                    style={{
                      ...s.badge,
                      backgroundColor: STATUS_COLORS[entry.status].bg,
                      color: STATUS_COLORS[entry.status].text,
                    }}
                  >
                    {entry.status}
                  </span>
                </td>
                <td style={s.td}>{formatDate(entry.dateAdded)}</td>
                <td style={s.td}>
                  {entry.status === 'Waiting' && nextWaitingId(entry.slipType) === entry.id && (
                    <button
                      style={{ ...s.actionBtn, ...s.actionBtnNotify }}
                      onClick={(ev) => handleNotify(entry, ev)}
                      disabled={!!busy}
                      title="Notify this entry (next in queue) and place a hold"
                    >
                      <Bell size={12} />
                      Notify
                    </button>
                  )}
                  {(entry.status === 'Waiting' || entry.status === 'Notified' || entry.status === 'Hold') && (
                    <ComingSoonButton style={{ ...s.actionBtn, ...s.actionBtnAccept }} reason={ACCEPT_REASON}>
                      <Check size={12} />
                      Accept
                    </ComingSoonButton>
                  )}
                  <button
                    style={{ ...s.actionBtn, ...s.actionBtnRemove }}
                    onClick={(ev) => handleRemove(entry, ev)}
                    disabled={!!busy}
                    title="Remove from waitlist"
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={8}>
                  No waitlist entries match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* Add to Waitlist Modal */}
      {showAddModal && (
        <div style={s.overlay}>
          <div style={s.modal} className="helm-modal" role="dialog" aria-modal="true" aria-label="Add to waitlist">
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Add to Waitlist</h2>
              <button style={s.closeBtn} onClick={() => setShowAddModal(false)} disabled={addSaving} aria-label="Close"><X size={20} /></button>
            </div>
            <div style={s.modalBody}>
              {addError && <div style={{ marginBottom: 12 }}><InlineError message={addError} /></div>}
              <div style={s.fieldGrid}>
                <div style={{ ...s.field, gridColumn: '1 / -1' }}>
                  <span style={s.fieldLabel}>Customer *</span>
                  <CustomerPicker value={addCustomer} onChange={setAddCustomer} inputStyle={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }} />
                  <span style={{ fontSize: 12, color: '#64748B' }}>Waitlist entries are linked to an existing customer or lead. Add a new person on the Customers page first.</span>
                </div>
                <label style={s.field}><span style={s.fieldLabel}>Slip Type</span><select value={addSlipType} onChange={(e) => setAddSlipType(e.target.value)} style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }}>{SLIP_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
                <label style={s.field}><span style={s.fieldLabel}>Boat Length (ft)</span><input value={addLength} onChange={(e) => setAddLength(e.target.value)} style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }} type="number" placeholder="30" /></label>
                <label style={s.field}><span style={s.fieldLabel}>Desired Date</span><input value={addDate} onChange={(e) => setAddDate(e.target.value)} style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }} type="date" /></label>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={{ padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' }} disabled={addSaving} onClick={() => setShowAddModal(false)}>Cancel</button>
              <button style={{ ...s.primaryBtn, padding: '8px 24px', opacity: addSaving ? 0.7 : 1 }} disabled={addSaving} onClick={handleAdd}>{addSaving ? 'Adding…' : 'Add to Waitlist'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedEntry && (
        <div style={s.overlay} onClick={() => setSelectedEntry(null)}>
          <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>
                  {selectedEntry.firstName} {selectedEntry.lastName}
                </h2>
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={s.positionBadge}>{selectedEntry.position}</span>
                  <span
                    style={{
                      ...s.badge,
                      backgroundColor: STATUS_COLORS[selectedEntry.status].bg,
                      color: STATUS_COLORS[selectedEntry.status].text,
                    }}
                  >
                    {selectedEntry.status}
                  </span>
                </div>
              </div>
              <button style={s.closeBtn} onClick={() => setSelectedEntry(null)}>
                <X size={20} />
              </button>
            </div>
            <div style={s.modalBody}>
              <div style={s.fieldGrid}>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Email</span>
                  <span style={s.fieldValue}>
                    <Mail size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedEntry.email || '—'}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Phone</span>
                  <span style={s.fieldValue}>
                    <Phone size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedEntry.phone ? formatPhone(selectedEntry.phone) : '—'}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Slip Type</span>
                  <span style={s.fieldValue}>
                    <Anchor size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedEntry.slipType}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat Length</span>
                  <span style={s.fieldValueMono}>
                    <Ship size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedEntry.boatLength ? `${selectedEntry.boatLength} ft` : '—'}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Desired Date</span>
                  <span style={s.fieldValue}>
                    <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {formatDate(selectedEntry.desiredDate)}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Date Added</span>
                  <span style={s.fieldValue}>
                    <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {formatDate(selectedEntry.dateAdded)}
                  </span>
                </div>
              </div>
              {(selectedEntry.notifiedAt || selectedEntry.holdExpiresAt) && (
                <div style={s.notesBox}>
                  <div style={s.notesLabel}>Notification</div>
                  <div style={s.notesText}>
                    {selectedEntry.notifiedAt ? `Notified ${formatDate(selectedEntry.notifiedAt)}.` : ''}
                    {selectedEntry.holdExpiresAt ? ` Hold expires ${formatDate(selectedEntry.holdExpiresAt)}.` : ''}
                  </div>
                </div>
              )}
            </div>
            <div style={s.modalFooter}>
              {selectedEntry.status === 'Waiting' && nextWaitingId(selectedEntry.slipType) === selectedEntry.id && (
                <button
                  style={{ ...s.actionBtn, ...s.actionBtnNotify, padding: '8px 16px', fontSize: '14px' }}
                  disabled={!!busy}
                  onClick={(ev) => handleNotify(selectedEntry, ev)}
                >
                  <Bell size={14} />
                  Notify
                </button>
              )}
              {(selectedEntry.status === 'Waiting' || selectedEntry.status === 'Notified' || selectedEntry.status === 'Hold') && (
                <ComingSoonButton style={{ ...s.actionBtn, ...s.actionBtnAccept, padding: '8px 16px', fontSize: '14px' }} reason={ACCEPT_REASON}>
                  <Check size={14} />
                  Accept
                </ComingSoonButton>
              )}
              <button
                style={{ ...s.actionBtn, ...s.actionBtnRemove, padding: '8px 16px', fontSize: '14px' }}
                disabled={!!busy}
                onClick={(ev) => handleRemove(selectedEntry, ev)}
              >
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
