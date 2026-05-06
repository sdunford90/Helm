import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
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
  recordLabel?: string;
  recordHref?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
  description: string;
  changedFields?: string;
  ipAddress: string;
}

interface ApiAuditEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  recordType: string;
  recordId: string;
  recordLabel?: string | null;
  recordHref?: string | null;
  action: string;
  changedFieldsJson: unknown;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditApiResponse {
  data: ApiAuditEntry[];
  pagination: { offset: number; limit: number; total: number };
}

const ACTION_VERBS: Record<string, string> = {
  CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted', STATUS_CHANGE: 'Status changed on',
};

function mapApiEntry(e: ApiAuditEntry): AuditEntry {
  const verb = ACTION_VERBS[e.action] ?? e.action;
  const shortId = e.recordId.length > 8 ? e.recordId.slice(0, 8) : e.recordId;
  return {
    id: e.id,
    timestamp: new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 19),
    userId: e.userId ?? '',
    userName: e.userName ?? 'System',
    recordType: e.recordType,
    recordId: e.recordId,
    recordLabel: e.recordLabel ?? undefined,
    recordHref: e.recordHref ?? undefined,
    action: e.action as AuditEntry['action'],
    description: `${verb} ${e.recordType} ${shortId}`,
    changedFields: e.changedFieldsJson ? JSON.stringify(e.changedFieldsJson, null, 2) : undefined,
    ipAddress: e.ipAddress ?? '',
  };
}

function shortenId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Render the record reference: a Link when href is present, plain text otherwise.
 *  Shows the human-readable label with the short ID as secondary text when available. */
function RecordRef({
  entry,
  onNavigate,
  size = 'normal',
}: {
  entry: AuditEntry;
  onNavigate?: () => void;
  size?: 'normal' | 'large';
}) {
  const shortId = shortenId(entry.recordId);
  const labelStyle: React.CSSProperties = {
    color: '#0A2342',
    fontWeight: 500,
    fontSize: size === 'large' ? '15px' : '14px',
  };
  const linkStyle: React.CSSProperties = {
    ...labelStyle,
    color: '#0A2342',
    textDecoration: 'underline',
    textDecorationColor: '#00D4FF',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  };
  const subStyle: React.CSSProperties = {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '12px',
    color: '#64748B',
    marginLeft: '6px',
  };

  if (entry.recordLabel && entry.recordHref) {
    return (
      <span>
        <Link
          to={entry.recordHref}
          style={linkStyle}
          onClick={(ev) => {
            ev.stopPropagation();
            onNavigate?.();
          }}
        >
          {entry.recordLabel}
        </Link>
        <span style={subStyle}>{shortId}</span>
      </span>
    );
  }
  if (entry.recordLabel) {
    return (
      <span>
        <span style={labelStyle}>{entry.recordLabel}</span>
        <span style={subStyle}>{shortId}</span>
      </span>
    );
  }
  return (
    <span
      style={{
        ...subStyle,
        marginLeft: 0,
        color: '#0A2342',
        fontSize: size === 'large' ? '14px' : '13px',
      }}
    >
      {shortId}
    </span>
  );
}

const RECORD_TYPES = ['All', 'Customer', 'Invoice', 'Payment', 'Contract', 'Lead', 'Slip', 'DockWalk', 'DockWalkItem', 'PosTransaction', 'Reservation', 'Announcement', 'GlEntry', 'InsuranceRecord'];
const ACTIONS = ['All', 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'];

/* ── Styles ─────────────────────────────────────────────── */

const ACTION_COLOR_DEFAULT = { bg: '#F1F5F9', color: '#475569' };

const actionColors: Record<string, { bg: string; color: string }> = {
  CREATE:        { bg: '#DEF7EC', color: '#03543F' },
  CREATED:       { bg: '#DEF7EC', color: '#03543F' },
  UPDATE:        { bg: '#E0F7FF', color: '#0A2342' },
  UPDATED:       { bg: '#E0F7FF', color: '#0A2342' },
  DELETE:        { bg: '#FDE8E8', color: '#9B1C1C' },
  DELETED:       { bg: '#FDE8E8', color: '#9B1C1C' },
  DEACTIVATED:   { bg: '#FDE8E8', color: '#9B1C1C' },
  STATUS_CHANGE: { bg: '#FFF3CD', color: '#856404' },
  REFUNDED:      { bg: '#FDE8E8', color: '#9B1C1C' },
  COMPLETED:     { bg: '#DEF7EC', color: '#03543F' },
  OPENED:        { bg: '#DEF7EC', color: '#03543F' },
  CLOSED:        { bg: '#FFF3CD', color: '#856404' },
  ADJUSTED:      { bg: '#FFF3CD', color: '#856404' },
  SENT:          { bg: '#E0F7FF', color: '#0A2342' },
  VOIDED:        { bg: '#FDE8E8', color: '#9B1C1C' },
  TERMINATED:    { bg: '#FDE8E8', color: '#9B1C1C' },
  RENEWED:       { bg: '#DEF7EC', color: '#03543F' },
  CONVERTED:     { bg: '#DEF7EC', color: '#03543F' },
  FINALIZED:     { bg: '#DEF7EC', color: '#03543F' },
  CHECKED_IN:    { bg: '#DEF7EC', color: '#03543F' },
  CHECKED_OUT:   { bg: '#FFF3CD', color: '#856404' },
  CANCELLED:     { bg: '#FDE8E8', color: '#9B1C1C' },
  STAGE_CHANGED: { bg: '#FFF3CD', color: '#856404' },
  MERGE:         { bg: '#E0F7FF', color: '#0A2342' },
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

  const { data: apiResp, loading: entriesLoading } = useApi<AuditApiResponse>('get', '/api/audit-log?limit=200', { immediate: true });
  const entries = useMemo(() => (apiResp?.data ?? []).map(mapApiEntry), [apiResp]);

  const dynamicUsers = useMemo(() => {
    const names = Array.from(new Set(entries.map((e) => e.userName).filter(Boolean)));
    return ['All', ...names.sort()];
  }, [entries]);

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

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayCount = entries.filter((e) => e.timestamp.startsWith(todayIso)).length;
  const uniqueUsers = new Set(entries.map((e) => e.userName)).size;

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Audit Log</h1>
      <hr style={st.divider} />
      {entriesLoading && (
        <div style={{ padding: '8px 16px', marginBottom: '16px', backgroundColor: 'rgba(0,212,255,0.08)', borderRadius: '8px', fontSize: '13px', color: '#64748B' }}>
          Loading audit log...
        </div>
      )}

      <div style={st.statsRow} className="helm-stats-grid">
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

      <div style={st.filterBar} className="helm-filter-bar">
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
        <select style={st.select} value={userFilter} onChange={(e) => setUserFilter(e.target.value)} disabled={entriesLoading}>
          {entriesLoading
            ? <option value="All">Loading users…</option>
            : dynamicUsers.map((u) => <option key={u} value={u}>{u === 'All' ? 'All Users' : u}</option>)
          }
        </select>
        <button style={st.exportBtn}><Download size={14} /> Export CSV</button>
      </div>

      <div style={st.tableWrap} className="helm-table-wrap">
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
            {paged.length === 0 && !entriesLoading && (
              <tr>
                <td colSpan={7} style={{ ...st.td, textAlign: 'center', color: '#94A3B8', padding: '48px 16px' }}>
                  No audit log entries yet.
                </td>
              </tr>
            )}
            {paged.map((e, idx) => {
              const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
              const ac = actionColors[e.action] ?? ACTION_COLOR_DEFAULT;
              return (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedEntry(e)}>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontSize: '12px', whiteSpace: 'nowrap' }}>{e.timestamp}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 500 }}>{e.userName}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>
                    <span style={{ ...st.badge, backgroundColor: ac.bg, color: ac.color }}>{e.action}</span>
                  </td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>{e.recordType}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>
                    <RecordRef entry={e} />
                  </td>
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
        <div style={st.detailPanel} className="helm-detail-panel">
          <div style={st.detailHeader}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Audit Entry</h2>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px' }} onClick={() => setSelectedEntry(null)}>✕</button>
          </div>
          <div style={st.detailSection}>
            <span style={{ ...st.badge, backgroundColor: (actionColors[selectedEntry.action] ?? ACTION_COLOR_DEFAULT).bg, color: (actionColors[selectedEntry.action] ?? ACTION_COLOR_DEFAULT).color }}>{selectedEntry.action}</span>
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
            <div style={st.detailLabel}>Record</div>
            <div style={st.detailValue}>
              <RecordRef entry={selectedEntry} size="large" onNavigate={() => setSelectedEntry(null)} />
            </div>
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
