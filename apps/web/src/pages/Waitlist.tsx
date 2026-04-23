import { useState, useEffect } from 'react';
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
import { useApi } from '../hooks/useApi';

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
  slipType: SlipType;
  boatLength: number;
  desiredDate: string;
  status: WaitlistStatus;
  dateAdded: string;
  notes: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

const SLIP_TYPES: SlipType[] = ['Annual', 'Seasonal', 'Transient', 'Liveaboard'];
const STATUSES: WaitlistStatus[] = ['Waiting', 'Notified', 'Hold', 'Accepted', 'Expired'];

/* ── Status Colors ─────────────────────────────────────── */

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
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSaved, setAddSaved] = useState(false);

  // API calls
  const { data: apiEntries, loading, error, execute: refetchWaitlist } = useApi<WaitlistEntry[]>('get', '/api/waitlist', { immediate: true });
  const addToWaitlistApi = useApi<WaitlistEntry>('post', '/api/waitlist');

  useEffect(() => {
    if (apiEntries) {
      setEntries(apiEntries);
    }
  }, [apiEntries]);

  const filtered = entries.filter((e) => {
    if (slipFilter !== 'All' && e.slipType !== slipFilter) return false;
    if (statusFilter !== 'All' && e.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const full = `${e.firstName} ${e.lastName} ${e.email}`.toLowerCase();
      if (!full.includes(q)) return false;
    }
    return true;
  });

  const countByStatus = (status: WaitlistStatus) =>
    entries.filter((e) => e.status === status).length;

  const handleNotify = (id: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setEntries(entries.map((e) => e.id === id ? { ...e, status: 'Notified' as WaitlistStatus } : e));
  };

  const handleAccept = (id: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setEntries(entries.map((e) => e.id === id ? { ...e, status: 'Accepted' as WaitlistStatus } : e));
  };

  const handleRemove = (id: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setEntries(entries.filter((e) => e.id !== id));
  };

  return (
    <div style={s.page}>
      <h1 style={s.title} className="helm-page-title">Waitlist</h1>
      <hr style={s.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>Loading...</div>}

      {/* Stats Row */}
      <div style={s.statsRow} className="helm-stats-grid">
        {STATUSES.map((status) => (
          <div key={status} style={s.statCard}>
            <div style={s.statLabel}>{status}</div>
            <div style={s.statValue}>{countByStatus(status)}</div>
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
      <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
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
                  {entry.firstName} {entry.lastName}
                </td>
                <td style={s.td}>{entry.slipType}</td>
                <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>
                  {entry.boatLength} ft
                </td>
                <td style={s.td}>{entry.desiredDate}</td>
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
                <td style={s.td}>{entry.dateAdded}</td>
                <td style={s.td}>
                  {entry.status === 'Waiting' && (
                    <button
                      style={{ ...s.actionBtn, ...s.actionBtnNotify }}
                      onClick={(ev) => handleNotify(entry.id, ev)}
                      title="Send notification"
                    >
                      <Bell size={12} />
                      Notify
                    </button>
                  )}
                  {(entry.status === 'Waiting' || entry.status === 'Notified' || entry.status === 'Hold') && (
                    <button
                      style={{ ...s.actionBtn, ...s.actionBtnAccept }}
                      onClick={(ev) => handleAccept(entry.id, ev)}
                      title="Accept entry"
                    >
                      <Check size={12} />
                      Accept
                    </button>
                  )}
                  <button
                    style={{ ...s.actionBtn, ...s.actionBtnRemove }}
                    onClick={(ev) => handleRemove(entry.id, ev)}
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

      {/* Add to Waitlist Modal */}
      {showAddModal && (
        <div style={s.overlay} onClick={() => setShowAddModal(false)}>
          <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Add to Waitlist</h2>
              <button style={s.closeBtn} onClick={() => setShowAddModal(false)}><X size={20} /></button>
            </div>
            {addSaved && <div style={{ padding: '12px 24px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', textAlign: 'center' }}>Added to waitlist!</div>}
            <div style={s.modalBody}>
              <div style={s.fieldGrid}>
                <div style={s.field}><span style={s.fieldLabel}>First Name *</span><input style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }} placeholder="First name" /></div>
                <div style={s.field}><span style={s.fieldLabel}>Last Name *</span><input style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }} placeholder="Last name" /></div>
                <div style={s.field}><span style={s.fieldLabel}>Email *</span><input style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }} placeholder="Email" type="email" /></div>
                <div style={s.field}><span style={s.fieldLabel}>Phone</span><input style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }} placeholder="Phone" /></div>
                <div style={s.field}><span style={s.fieldLabel}>Slip Type</span><select style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }}>{SLIP_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
                <div style={s.field}><span style={s.fieldLabel}>Boat Length (ft)</span><input style={{ padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const }} type="number" placeholder="30" /></div>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={{ padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' }} onClick={() => setShowAddModal(false)}>Cancel</button>
              <button style={{ ...s.primaryBtn, padding: '8px 24px' }} onClick={() => { setAddSaved(true); setTimeout(() => { setAddSaved(false); setShowAddModal(false); }, 1500); }}>Add to Waitlist</button>
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
                    {selectedEntry.email}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Phone</span>
                  <span style={s.fieldValue}>
                    <Phone size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedEntry.phone}
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
                    {selectedEntry.boatLength} ft
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Desired Date</span>
                  <span style={s.fieldValue}>
                    <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedEntry.desiredDate}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Date Added</span>
                  <span style={s.fieldValue}>
                    <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedEntry.dateAdded}
                  </span>
                </div>
              </div>
              <div style={s.notesBox}>
                <div style={s.notesLabel}>Notes</div>
                <div style={s.notesText}>{selectedEntry.notes}</div>
              </div>
            </div>
            <div style={s.modalFooter}>
              {selectedEntry.status === 'Waiting' && (
                <button
                  style={{ ...s.actionBtn, ...s.actionBtnNotify, padding: '8px 16px', fontSize: '14px' }}
                  onClick={(ev) => {
                    handleNotify(selectedEntry.id, ev);
                    setSelectedEntry({ ...selectedEntry, status: 'Notified' });
                  }}
                >
                  <Bell size={14} />
                  Notify
                </button>
              )}
              {(selectedEntry.status === 'Waiting' || selectedEntry.status === 'Notified' || selectedEntry.status === 'Hold') && (
                <button
                  style={{ ...s.actionBtn, ...s.actionBtnAccept, padding: '8px 16px', fontSize: '14px' }}
                  onClick={(ev) => {
                    handleAccept(selectedEntry.id, ev);
                    setSelectedEntry({ ...selectedEntry, status: 'Accepted' });
                  }}
                >
                  <Check size={14} />
                  Accept
                </button>
              )}
              <button
                style={{ ...s.actionBtn, ...s.actionBtnRemove, padding: '8px 16px', fontSize: '14px' }}
                onClick={(ev) => {
                  handleRemove(selectedEntry.id, ev);
                  setSelectedEntry(null);
                }}
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
