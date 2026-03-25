import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  ScrollText, Search, Download, Filter, Eye, User,
  FileText, Clock, ChevronLeft, ChevronRight,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  recordType: string;
  recordId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
  description: string;
  changedFields?: string;
  ipAddress: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

const ENTRIES: AuditEntry[] = [
  { id: '1', timestamp: '2026-03-25 11:42:18', userId: 'u1', userName: 'Sarah Dunford', recordType: 'Payment', recordId: 'pay-1042', action: 'CREATE', description: 'Payment of $2,450.00 received via Card', changedFields: 'status: → COMPLETED', ipAddress: '192.168.1.45' },
  { id: '2', timestamp: '2026-03-25 11:30:05', userId: 'u2', userName: 'Jake Martinez', recordType: 'DockWalk', recordId: 'dw-0042', action: 'CREATE', description: 'Dock walk started for Dock A, B', ipAddress: '10.0.0.12' },
  { id: '3', timestamp: '2026-03-25 10:15:33', userId: 'u1', userName: 'Sarah Dunford', recordType: 'Invoice', recordId: 'inv-1048', action: 'STATUS_CHANGE', description: 'Invoice #1048 status changed', changedFields: 'status: DRAFT → ISSUED', ipAddress: '192.168.1.45' },
  { id: '4', timestamp: '2026-03-25 09:42:11', userId: 'u2', userName: 'Jake Martinez', recordType: 'Customer', recordId: 'cust-204', action: 'UPDATE', description: 'Updated emergency contact info', changedFields: 'emergencyContact: {old} → {new}', ipAddress: '10.0.0.12' },
  { id: '5', timestamp: '2026-03-25 09:15:00', userId: 'u1', userName: 'Sarah Dunford', recordType: 'Contract', recordId: 'con-087', action: 'CREATE', description: 'New slip contract for Coastal Charters LLC (Slip B14)', ipAddress: '192.168.1.45' },
  { id: '6', timestamp: '2026-03-24 16:45:22', userId: 'u3', userName: 'Maria Santos', recordType: 'DockWalkItem', recordId: 'dwi-312', action: 'CREATE', description: 'Violation logged: Electrical hazard at Slip B-01', ipAddress: '10.0.0.15' },
  { id: '7', timestamp: '2026-03-24 15:20:44', userId: 'u1', userName: 'Sarah Dunford', recordType: 'Lead', recordId: 'lead-445', action: 'STATUS_CHANGE', description: 'Lead stage changed for Kevin O\'Malley', changedFields: 'stage: QUALIFIED → WON', ipAddress: '192.168.1.45' },
  { id: '8', timestamp: '2026-03-24 14:10:33', userId: 'u4', userName: 'Lisa Chen', recordType: 'GlEntry', recordId: 'gl-2048', action: 'CREATE', description: 'GL entry posted: Deferred revenue recognition $1,250.00', ipAddress: '192.168.1.50' },
  { id: '9', timestamp: '2026-03-24 13:00:18', userId: 'u2', userName: 'Jake Martinez', recordType: 'Slip', recordId: 'slip-A03', action: 'STATUS_CHANGE', description: 'Slip A-03 status changed', changedFields: 'status: VACANT → RESERVED', ipAddress: '10.0.0.12' },
  { id: '10', timestamp: '2026-03-24 11:30:05', userId: 'u1', userName: 'Sarah Dunford', recordType: 'Customer', recordId: 'cust-189', action: 'UPDATE', description: 'Customer merge: Robert Dockside merged into primary record', changedFields: 'Merged records: cust-189 + cust-203', ipAddress: '192.168.1.45' },
  { id: '11', timestamp: '2026-03-24 10:15:44', userId: 'u5', userName: 'Tom Anderson', recordType: 'PosTransaction', recordId: 'txn-3040', action: 'CREATE', description: 'POS sale: $52.37 (5 items) via Cash', ipAddress: '10.0.0.20' },
  { id: '12', timestamp: '2026-03-24 09:00:00', userId: 'u1', userName: 'Sarah Dunford', recordType: 'Announcement', recordId: 'ann-028', action: 'CREATE', description: 'Announcement sent: "Weekend Marina Events" to 45 recipients', ipAddress: '192.168.1.45' },
  { id: '13', timestamp: '2026-03-23 17:30:12', userId: 'u3', userName: 'Maria Santos', recordType: 'InsuranceRecord', recordId: 'ins-156', action: 'CREATE', description: 'Insurance document uploaded for vessel Sea Spirit', ipAddress: '10.0.0.15' },
  { id: '14', timestamp: '2026-03-23 16:00:33', userId: 'u4', userName: 'Lisa Chen', recordType: 'Payment', recordId: 'pay-1039', action: 'STATUS_CHANGE', description: 'ACH return processed: R01 NSF', changedFields: 'status: COMPLETED → FAILED', ipAddress: '192.168.1.50' },
  { id: '15', timestamp: '2026-03-23 14:22:11', userId: 'u2', userName: 'Jake Martinez', recordType: 'Reservation', recordId: 'res-1045', action: 'CREATE', description: 'Rental reservation created for Elena Windward — Sunset Sailor 28', ipAddress: '10.0.0.12' },
];

const RECORD_TYPES = ['All', 'Customer', 'Invoice', 'Payment', 'Contract', 'Lead', 'Slip', 'DockWalk', 'DockWalkItem', 'PosTransaction', 'Reservation', 'Announcement', 'GlEntry', 'InsuranceRecord'];
const ACTIONS = ['All', 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'];
const USERS = ['All', 'Sarah Dunford', 'Jake Martinez', 'Maria Santos', 'Lisa Chen', 'Tom Anderson'];

/* ── Styles ─────────────────────────────────────────────── */

const actionColors: Record<string, { bg: string; color: string }> = {
  CREATE: { bg: '#DEF7EC', color: '#03543F' },
  UPDATE: { bg: '#E0F7FF', color: '#0A2342' },
  DELETE: { bg: '#FDE8E8', color: '#9B1C1C' },
  STATUS_CHANGE: { bg: '#FFF3CD', color: '#856404' },
};

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '24px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '13px', color: '#2E4A6B', marginTop: '2px' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, flex: 1, minWidth: '200px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  exportBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '13px' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC' },
  pageBtn: { display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '13px', fontWeight: 600, border: '1px solid #CCC', borderRadius: '4px', background: '#FFFFFF', cursor: 'pointer', color: '#0A2342' },
  detailPanel: { position: 'fixed' as const, top: 0, right: 0, width: '440px', height: '100vh', background: '#FFFFFF', boxShadow: '-4px 0 12px rgba(0,0,0,0.1)', zIndex: 1000, overflow: 'auto' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', borderBottom: '1px solid #E2E8F0' },
  detailSection: { padding: '20px 24px', borderBottom: '1px solid #E2E8F0' },
  detailLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  detailValue: { fontSize: '15px', color: '#0A2342', marginBottom: '12px' },
};

/* ── Main Component ─────────────────────────────────────── */

export default function AuditLog() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [actionFilter, setActionFilter] = useState('All');
  const [userFilter, setUserFilter] = useState('All');
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 10;

  // API call with fallback to mock
  const { data: apiEntries, loading: entriesLoading } = useApi<AuditEntry[]>('get', '/api/audit-log', { immediate: true });
  const entries = apiEntries ?? ENTRIES;

  const filtered = entries.filter((e) => {
    if (typeFilter !== 'All' && e.recordType !== typeFilter) return false;
    if (actionFilter !== 'All' && e.action !== actionFilter) return false;
    if (userFilter !== 'All' && e.userName !== userFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return e.description.toLowerCase().includes(q) || e.recordId.toLowerCase().includes(q) || e.userName.toLowerCase().includes(q);
  });

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  const todayCount = entries.filter((e) => e.timestamp.startsWith('2026-03-25')).length;
  const uniqueUsers = new Set(entries.map((e) => e.userName)).size;

  return (
    <div style={st.page}>
      <h1 style={st.title}>Audit Log</h1>
      <hr style={st.divider} />
      {entriesLoading && (
        <div style={{ padding: '8px 16px', marginBottom: '16px', backgroundColor: 'rgba(0,212,255,0.08)', borderRadius: '8px', fontSize: '13px', color: '#64748B' }}>
          Loading audit log...
        </div>
      )}

      <div style={st.statsRow}>
        <div style={st.statCard}>
          <div style={st.statLabel}>Total Entries</div>
          <div style={st.statValue}>{entries.length}</div>
          <div style={st.statSub}>All time</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Today's Activity</div>
          <div style={st.statValue}>{todayCount}</div>
          <div style={st.statSub}>Actions logged today</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Active Users</div>
          <div style={st.statValue}>{uniqueUsers}</div>
          <div style={st.statSub}>Staff members</div>
        </div>
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Record Types</div>
          <div style={st.statValue}>{new Set(entries.map((e) => e.recordType)).size}</div>
          <div style={st.statSub}>Tracked entities</div>
        </div>
      </div>

      <div style={st.filterBar}>
        <div style={st.searchWrap}>
          <Search size={16} style={st.searchIcon} />
          <input style={st.searchInput} placeholder="Search descriptions, record IDs, users..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select style={st.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          {RECORD_TYPES.map((t) => <option key={t} value={t}>{t === 'All' ? 'All Record Types' : t}</option>)}
        </select>
        <select style={st.select} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          {ACTIONS.map((a) => <option key={a} value={a}>{a === 'All' ? 'All Actions' : a}</option>)}
        </select>
        <select style={st.select} value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          {USERS.map((u) => <option key={u} value={u}>{u === 'All' ? 'All Users' : u}</option>)}
        </select>
        <button style={st.exportBtn}><Download size={14} /> Export CSV</button>
      </div>

      <div style={st.tableWrap}>
        <table style={st.table}>
          <thead>
            <tr>
              <th style={st.th}>Timestamp</th>
              <th style={st.th}>User</th>
              <th style={st.th}>Action</th>
              <th style={st.th}>Record Type</th>
              <th style={st.th}>Record ID</th>
              <th style={st.th}>Description</th>
              <th style={st.th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((e, idx) => {
              const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
              const ac = actionColors[e.action];
              return (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedEntry(e)}>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontSize: '12px', whiteSpace: 'nowrap' }}>{e.timestamp}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 500 }}>{e.userName}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>
                    <span style={{ ...st.badge, backgroundColor: ac.bg, color: ac.color }}>{e.action}</span>
                  </td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>{e.recordType}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{e.recordId}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>
                    <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer' }} onClick={(ev) => { ev.stopPropagation(); setSelectedEntry(e); }}>
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={st.pagination}>
          <span style={{ fontSize: '13px', color: '#64748B' }}>Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length} entries</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={st.pageBtn} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /> Prev</button>
            <button style={st.pageBtn} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {selectedEntry && (
        <div style={st.detailPanel}>
          <div style={st.detailHeader}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Audit Entry</h2>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px' }} onClick={() => setSelectedEntry(null)}>✕</button>
          </div>
          <div style={st.detailSection}>
            <span style={{ ...st.badge, backgroundColor: actionColors[selectedEntry.action].bg, color: actionColors[selectedEntry.action].color }}>{selectedEntry.action}</span>
          </div>
          <div style={st.detailSection}>
            <div style={st.detailLabel}>Timestamp</div>
            <div style={{ ...st.detailValue, ...st.mono }}>{selectedEntry.timestamp} UTC</div>
            <div style={st.detailLabel}>User</div>
            <div style={st.detailValue}>{selectedEntry.userName} ({selectedEntry.userId})</div>
            <div style={st.detailLabel}>IP Address</div>
            <div style={{ ...st.detailValue, ...st.mono }}>{selectedEntry.ipAddress}</div>
          </div>
          <div style={st.detailSection}>
            <div style={st.detailLabel}>Record Type</div>
            <div style={st.detailValue}>{selectedEntry.recordType}</div>
            <div style={st.detailLabel}>Record ID</div>
            <div style={{ ...st.detailValue, ...st.mono }}>{selectedEntry.recordId}</div>
          </div>
          <div style={st.detailSection}>
            <div style={st.detailLabel}>Description</div>
            <div style={{ ...st.detailValue, lineHeight: 1.6 }}>{selectedEntry.description}</div>
            {selectedEntry.changedFields && (
              <>
                <div style={st.detailLabel}>Changed Fields</div>
                <div style={{ ...st.detailValue, ...st.mono, fontSize: '13px', background: '#F8FAFC', padding: '12px', borderRadius: '6px', whiteSpace: 'pre-wrap' as const }}>{selectedEntry.changedFields}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
