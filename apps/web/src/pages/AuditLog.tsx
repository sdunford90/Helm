import React, { useState } from 'react';
import { useList } from '../hooks/useApi';
import type { AuditLogDTO } from '../lib/dto';
import { formatDateTime, todayKey } from '../lib/format';
import { downloadCsv } from '../lib/csv';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
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
  action: string;
  description: string;
  changedFields?: string;
  ipAddress: string;
}

/* ── API mapping ───────────────────────────────────────── */

function describeChanges(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  return Object.entries(json as Record<string, unknown>)
    .map(([k, v]) => {
      if (v && typeof v === 'object' && ('old' in (v as object) || 'new' in (v as object))) {
        const o = v as { old?: unknown; new?: unknown };
        return `${k}: ${JSON.stringify(o.old ?? null)} → ${JSON.stringify(o.new ?? null)}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');
}

function toEntry(e: AuditLogDTO): AuditEntry {
  const user = e.userName ?? e.user?.email ?? (e.userId ? e.userId : 'System');
  return {
    id: e.id,
    timestamp: e.createdAt,
    userId: e.userId ?? '',
    userName: user,
    recordType: e.recordType,
    recordId: e.recordId,
    action: e.action,
    description: `${e.action.replace(/_/g, ' ').toLowerCase()} ${e.recordType}`,
    changedFields: describeChanges(e.changedFieldsJson),
    ipAddress: e.ipAddress ?? '—',
  };
}

const RECORD_TYPES = ['All', 'Customer', 'Invoice', 'Payment', 'Contract', 'Lead', 'Slip', 'DockWalk', 'DockWalkItem', 'PosTransaction', 'Reservation', 'Announcement', 'GlEntry', 'InsuranceRecord'];
const ACTIONS = ['All', 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'];

/* ── Styles ─────────────────────────────────────────────── */

const actionColors: Record<string, { bg: string; color: string }> = {
  CREATE: { bg: '#DEF7EC', color: '#03543F' },
  UPDATE: { bg: '#E0F7FF', color: '#0A2342' },
  DELETE: { bg: '#FDE8E8', color: '#9B1C1C' },
  STATUS_CHANGE: { bg: '#FFF3CD', color: '#856404' },
};
const DEFAULT_ACTION_COLOR = { bg: '#F2F4F6', color: '#334155' };

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

  // Record type / action filters and paging run on the server.
  const params = new URLSearchParams({ limit: String(perPage), offset: String((page - 1) * perPage) });
  if (typeFilter !== 'All') params.set('recordType', typeFilter);
  if (actionFilter !== 'All') params.set('action', actionFilter);
  const list = useList<AuditEntry, AuditLogDTO>(`/audit-log?${params.toString()}`, { map: toEntry });
  const today = useList<AuditLogDTO>(`/audit-log?limit=1&startDate=${todayKey()}`);
  const entries = list.items;
  const total = list.pagination?.total ?? entries.length;

  // User and text filters apply to the loaded page.
  const users = ['All', ...Array.from(new Set(entries.map((e) => e.userName)))];
  const filtered = entries.filter((e) => {
    if (userFilter !== 'All' && e.userName !== userFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return e.description.toLowerCase().includes(q) || e.recordId.toLowerCase().includes(q) || e.userName.toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const paged = filtered;

  const exportCsv = () =>
    downloadCsv(
      `audit-log-${todayKey()}.csv`,
      ['Timestamp', 'User', 'Action', 'Record Type', 'Record ID', 'Changed Fields', 'IP Address'],
      filtered.map((e) => [e.timestamp, e.userName, e.action, e.recordType, e.recordId, e.changedFields ?? '', e.ipAddress]),
    );

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Audit Log</h1>
      <hr style={st.divider} />

      <div style={st.statsRow} className="helm-stats-grid">
        <div style={st.statCard}>
          <div style={st.statLabel}>Total Entries</div>
          <div style={st.statValue}>{list.loading ? '—' : total}</div>
          <div style={st.statSub}>{typeFilter !== 'All' || actionFilter !== 'All' ? 'Matching filters' : 'All time'}</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Today's Activity</div>
          <div style={st.statValue}>{today.loading || today.error ? '—' : today.pagination?.total ?? 0}</div>
          <div style={st.statSub}>Actions logged today</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Active Users</div>
          <div style={st.statValue}>{users.length - 1}</div>
          <div style={st.statSub}>On this page</div>
        </div>
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Record Types</div>
          <div style={st.statValue}>{new Set(entries.map((e) => e.recordType)).size}</div>
          <div style={st.statSub}>On this page</div>
        </div>
      </div>

      <div style={st.filterBar} className="helm-filter-bar">
        <div style={st.searchWrap}>
          <Search size={16} style={st.searchIcon} />
          <input style={st.searchInput} placeholder="Search descriptions, record IDs, users..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select style={st.select} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
          {RECORD_TYPES.map((t) => <option key={t} value={t}>{t === 'All' ? 'All Record Types' : t}</option>)}
        </select>
        <select style={st.select} value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
          {ACTIONS.map((a) => <option key={a} value={a}>{a === 'All' ? 'All Actions' : a}</option>)}
        </select>
        <select style={st.select} value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          {users.map((u) => <option key={u} value={u}>{u === 'All' ? 'All Users (this page)' : u}</option>)}
        </select>
        <button style={st.exportBtn} onClick={exportCsv} disabled={filtered.length === 0}><Download size={14} /> Export CSV</button>
      </div>

      {list.loading ? <LoadingState label="Loading audit log…" /> : list.error ? <ErrorState title="Could not load the audit log" message={list.error} onRetry={list.refetch} /> : entries.length === 0 ? <EmptyState title="No audit entries" message={typeFilter !== 'All' || actionFilter !== 'All' ? 'No entries match these filters.' : 'Actions taken in Helm will be recorded here.'} /> : (
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
            {paged.map((e, idx) => {
              const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
              const ac = actionColors[e.action] ?? DEFAULT_ACTION_COLOR;
              return (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedEntry(e)}>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontSize: '12px', whiteSpace: 'nowrap' }}>{formatDateTime(e.timestamp)}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 500 }}>{e.userName}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>
                    <span style={{ ...st.badge, backgroundColor: ac.bg, color: ac.color }}>{e.action}</span>
                  </td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>{e.recordType}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{e.recordId}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>
                    <button style={{ background: 'none', border: 'none', color: '#0077A3', cursor: 'pointer' }} aria-label="View entry" onClick={(ev) => { ev.stopPropagation(); setSelectedEntry(e); }}>
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={st.pagination}>
          <span style={{ fontSize: '13px', color: '#64748B' }}>Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total} entries</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={st.pageBtn} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /> Prev</button>
            <button style={st.pageBtn} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={14} /></button>
          </div>
        </div>
      </div>
      )}

      {selectedEntry && (
        <div style={st.detailPanel} className="helm-detail-panel">
          <div style={st.detailHeader}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Audit Entry</h2>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px' }} onClick={() => setSelectedEntry(null)}>✕</button>
          </div>
          <div style={st.detailSection}>
            <span style={{ ...st.badge, backgroundColor: (actionColors[selectedEntry.action] ?? DEFAULT_ACTION_COLOR).bg, color: (actionColors[selectedEntry.action] ?? DEFAULT_ACTION_COLOR).color }}>{selectedEntry.action}</span>
          </div>
          <div style={st.detailSection}>
            <div style={st.detailLabel}>Timestamp</div>
            <div style={{ ...st.detailValue, ...st.mono }}>{formatDateTime(selectedEntry.timestamp)}</div>
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
