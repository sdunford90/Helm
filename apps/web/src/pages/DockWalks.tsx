import React, { useState } from 'react';
import {
  ClipboardCheck, Search, Plus, X, AlertTriangle,
  Eye, CheckCircle2, Clock, MapPin, Camera, Droplets,
  Shield,
} from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import { useApiClient, useList } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { formatDate, formatDateTime, humanizeEnum } from '../lib/format';
import { ComingSoonButton, ErrorState, InlineError, LoadingState } from '../components/StateViews';

/* ── Types ─────────────────────────────────────────────── */

type WalkStatus = 'In Progress' | 'Completed';
type Severity = 'Violation' | 'Needs Attention';
type ViolationStatus = 'Open' | 'Resolved';

interface DockWalk {
  id: string;
  number: string;
  date: string;
  inspector: string;
  docks: string[];
  slipsChecked: number;
  violations: number;
  status: WalkStatus;
  duration: string;
}

interface Violation {
  id: string;
  walkId: string;
  number: string;
  walkDate: string;
  slip: string;
  type: string;
  severity: Severity;
  description: string;
  status: ViolationStatus;
  reportedBy: string;
}

interface PumpOut {
  id: string;
  date: string;
  slip: string;
  boatName: string;
  performedBy: string;
  duration: string;
  notes: string;
}

/* ── API mapping ───────────────────────────────────────── */

interface DockWalkDTO {
  id: string;
  inspectorId: string;
  dockId?: string | null;
  startedAt: string;
  completedAt?: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED';
  items?: { id: string; status: 'OK' | 'VIOLATION' | 'NEEDS_ATTENTION' }[];
}

interface IssueDTO {
  id: string;
  status: 'VIOLATION' | 'NEEDS_ATTENTION';
  notes?: string | null;
  violationType?: string | null;
  slip?: { slipNumber?: string | null } | null;
  dockWalk?: { id: string; startedAt: string; inspectorId?: string | null } | null;
}

interface PumpOutDTO {
  id: string;
  eventDate: string;
  gallons?: number | null;
  slip?: { slipNumber?: string | null } | null;
  staffId?: string | null;
}

function durationText(start: string, end?: string | null): string {
  if (!end) return '—';
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (!(mins >= 0)) return '—';
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

function toWalk(w: DockWalkDTO): DockWalk {
  return {
    id: w.id,
    number: w.id.slice(0, 8).toUpperCase(),
    date: w.startedAt,
    inspector: w.inspectorId,
    docks: w.dockId ? [w.dockId] : [],
    slipsChecked: w.items?.length ?? 0,
    violations: (w.items ?? []).filter((i) => i.status !== 'OK').length,
    status: w.status === 'COMPLETED' ? 'Completed' : 'In Progress',
    duration: durationText(w.startedAt, w.completedAt),
  };
}

function toViolation(i: IssueDTO): Violation {
  return {
    id: i.id,
    walkId: i.dockWalk?.id ?? '',
    number: i.id.slice(0, 8).toUpperCase(),
    walkDate: i.dockWalk?.startedAt ?? '',
    slip: i.slip?.slipNumber ?? '—',
    type: i.violationType ?? '—',
    severity: i.status === 'VIOLATION' ? 'Violation' : 'Needs Attention',
    description: i.notes ?? '',
    // GET /dock-walks/issues returns open items only.
    status: 'Open',
    reportedBy: i.dockWalk?.inspectorId ?? '—',
  };
}

function toPumpOut(p: PumpOutDTO): PumpOut {
  return {
    id: p.id,
    date: p.eventDate,
    slip: p.slip?.slipNumber ?? '—',
    boatName: p.gallons ? `${p.gallons} gal` : '—',
    performedBy: p.staffId ?? '—',
    duration: '—',
    notes: '',
  };
}

/* ── Styles ─────────────────────────────────────────────── */

const severityColors: Record<Severity, { bg: string; color: string }> = {
  'Needs Attention': { bg: '#FFF3CD', color: '#856404' },
  Violation: { bg: '#FDE8E8', color: '#9B1C1C' },
};

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '13px', color: '#2E4A6B', marginTop: '2px' },
  tabs: { display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px', transition: 'all 0.15s' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, flex: 1, minWidth: '200px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '14px' },
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10, 35, 66, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '8px', width: '520px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px 16px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: '22px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px' },
  modalBody: { padding: '24px 32px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const, width: '100%' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 32px 24px', borderTop: '1px solid #E2E8F0' },
  cancelBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  saveBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  detailPanel: { position: 'fixed' as const, top: 0, right: 0, width: '440px', height: '100vh', background: '#FFFFFF', boxShadow: '-4px 0 12px rgba(0,0,0,0.1)', zIndex: 1000, overflow: 'auto' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', borderBottom: '1px solid #E2E8F0' },
  detailSection: { padding: '20px 24px', borderBottom: '1px solid #E2E8F0' },
  detailLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  detailValue: { fontSize: '15px', color: '#0A2342', marginBottom: '12px' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#0A2342', cursor: 'pointer', padding: '4px 0' },
};

/* ── Start Walk Modal ──────────────────────────────────── */

function StartWalkModal({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const client = useApiClient();
  const { user } = useUser();
  const [dock, setDock] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await client.post('/dock-walks', { inspectorId: user.id, dockId: dock.trim() || null, notes: notes || null });
      onStarted();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={() => { if (!saving) onClose(); }}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Start Dock Walk</h2>
          <button style={st.closeBtn} onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          {error && <div style={{ marginBottom: 12 }}><InlineError message={error} /></div>}
          <div style={st.field}>
            <label style={st.label}>Inspector</label>
            <div style={{ fontSize: 14, color: '#0A2342' }}>{user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Signed-in user'}</div>
          </div>
          <div style={st.field}>
            <label style={st.label}>Dock</label>
            <input style={st.input} placeholder="e.g. A (leave blank for all docks)" value={dock} onChange={(e) => setDock(e.target.value)} />
          </div>
          <div style={st.field}>
            <label style={st.label}>Notes</label>
            <textarea style={{ ...st.input, minHeight: '60px', resize: 'vertical' as const }} placeholder="Any pre-walk notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleStart} disabled={saving || !user}>
            <ClipboardCheck size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
            {saving ? 'Starting…' : 'Start Walk'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Violation Detail Panel ────────────────────────────── */

function ViolationDetail({ violation, onClose, onResolved }: {
  violation: Violation;
  onClose: () => void;
  onResolved?: (id: string) => void;
}) {
  const client = useApiClient();
  const sc = severityColors[violation.severity];
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(violation.status === 'Resolved');
  const [error, setError] = useState<string | null>(null);

  // Resolving sets the walk item back to OK (PUT /dock-walks/:walkId/items/:itemId).
  const handleResolve = async () => {
    if (resolving || !violation.walkId) return;
    setResolving(true);
    setError(null);
    try {
      await client.put(`/dock-walks/${violation.walkId}/items/${violation.id}`, {
        status: 'OK',
        notes: [violation.description, resolutionNotes && `Resolved: ${resolutionNotes}`].filter(Boolean).join('\n'),
      });
      setResolved(true);
      onResolved?.(violation.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div style={st.detailPanel} className="helm-detail-panel">
      <div style={st.detailHeader}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 }}>{violation.number}</h2>
        <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
      </div>
      <div style={st.detailSection}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{violation.severity}</span>
          <span style={{ ...st.badge, backgroundColor: resolved ? '#DEF7EC' : '#FFF3CD', color: resolved ? '#03543F' : '#856404' }}>
            {resolved ? 'Resolved' : 'Open'}
          </span>
        </div>
      </div>
      <div style={st.detailSection}>
        <div style={st.detailLabel}>Slip</div>
        <div style={st.detailValue}>{violation.slip}</div>
        <div style={st.detailLabel}>Type</div>
        <div style={st.detailValue}>{violation.type}</div>
        <div style={st.detailLabel}>Walk Date</div>
        <div style={st.detailValue}>{formatDate(violation.walkDate)}</div>
        <div style={st.detailLabel}>Reported By</div>
        <div style={st.detailValue}>{violation.reportedBy}</div>
      </div>
      <div style={st.detailSection}>
        <div style={st.detailLabel}>Description</div>
        <div style={{ ...st.detailValue, lineHeight: 1.6 }}>{violation.description || '—'}</div>
      </div>
      {!resolved && (
        <div style={{ padding: '20px 24px' }}>
          {error && <div style={{ marginBottom: 12 }}><InlineError message={error} /></div>}
          <div style={st.field}>
            <label style={st.label}>Resolution Notes</label>
            <textarea
              style={{ ...st.input, minHeight: '60px', resize: 'vertical' as const }}
              placeholder="Describe how the violation was resolved..."
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
            />
          </div>
          <button style={st.saveBtn} onClick={handleResolve} disabled={resolving}>
            <CheckCircle2 size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
            {resolving ? 'Saving…' : 'Mark Resolved'}
          </button>
        </div>
      )}
      {resolved && (
        <div style={{ padding: '20px 24px', background: '#DEF7EC', borderRadius: '8px', margin: '16px 24px', textAlign: 'center', color: '#03543F', fontWeight: 600 }}>
          ✓ Violation resolved
        </div>
      )}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function DockWalks() {
  const [tab, setTab] = useState<'history' | 'violations' | 'pumpouts'>('history');
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showStartWalk, setShowStartWalk] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null);

  const walksList = useList<DockWalk, DockWalkDTO>('/dock-walks?take=100', { map: toWalk });
  const issuesList = useList<Violation, IssueDTO>('/dock-walks/issues?take=100', { map: toViolation });
  const pumpOutsList = useList<PumpOut, PumpOutDTO>(tab === 'pumpouts' ? '/dock-walks/pump-outs?take=100' : null, { map: toPumpOut });
  const walks = walksList.items;
  const violations = issuesList.items;

  const openViolations = violations.filter((v) => v.status === 'Open').length;
  const avgItems = walks.length > 0 ? Math.round(walks.reduce((s, w) => s + w.slipsChecked, 0) / walks.length) : 0;
  const lastWalk = walks[0];

  const tabItems: { key: typeof tab; label: string }[] = [
    { key: 'history', label: 'Walk History' },
    { key: 'violations', label: 'Violations' },
    { key: 'pumpouts', label: 'Pump-Outs' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Dock Walks</h1>
      <hr style={st.divider} />


      {/* Stats */}
      <div style={st.statsRow} className="helm-stats-grid">
        <div style={st.statCard}>
          <div style={st.statLabel}>Total Walks</div>
          <div style={st.statValue}>{walksList.loading ? '—' : walksList.pagination?.total ?? walks.length}</div>
          <div style={st.statSub}>All time</div>
        </div>
        <div style={{ ...st.statCard, borderTop: openViolations > 0 ? '3px solid #F59E0B' : '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Open Issues</div>
          <div style={{ ...st.statValue, color: openViolations > 0 ? '#C2410C' : '#03543F' }}>{issuesList.loading ? '—' : issuesList.pagination?.total ?? openViolations}</div>
          <div style={st.statSub}>{violations.filter((v) => v.severity === 'Violation').length} violations</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Avg Slips / Walk</div>
          <div style={st.statValue}>{avgItems}</div>
          <div style={st.statSub}>Across all walks</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Last Walk</div>
          <div style={st.statValue}>{lastWalk ? formatDate(lastWalk.date) : '—'}</div>
          <div style={st.statSub}>{lastWalk ? lastWalk.status : 'No walks yet'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={st.tabs} className="helm-tabs">
        {tabItems.map((t) => (
          <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Walk History */}
      {tab === 'history' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search walks..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button style={st.addBtn} onClick={() => setShowStartWalk(true)}>
              <ClipboardCheck size={16} /> Start New Walk
            </button>
          </div>
          {walksList.loading ? <LoadingState label="Loading dock walks…" /> : walksList.error ? <ErrorState title="Could not load dock walks" message={walksList.error} onRetry={walksList.refetch} /> : (
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Walk</th>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Inspector ID</th>
                  <th style={st.th}>Dock</th>
                  <th style={st.th}>Items Checked</th>
                  <th style={st.th}>Issues</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {walks.filter((w) => !search || w.number.toLowerCase().includes(search.toLowerCase()) || w.inspector.toLowerCase().includes(search.toLowerCase())).map((w, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={w.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{w.number}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{formatDateTime(w.date)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: 12 }}>{w.inspector}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{(w.docks ?? []).length ? w.docks.map((d) => `Dock ${d}`).join(', ') : 'All'}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center', ...st.mono }}>{w.slipsChecked}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>
                        <span style={{ ...st.mono, color: w.violations > 0 ? '#C2410C' : '#03543F', fontWeight: 600 }}>{w.violations}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: w.status === 'In Progress' ? '#E0F7FF' : '#DEF7EC', color: w.status === 'In Progress' ? '#0A2342' : '#03543F' }}>
                          {w.status === 'In Progress' ? <Clock size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> : <CheckCircle2 size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                          {w.status}
                        </span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{w.duration}</td>
                    </tr>
                  );
                })}
                {walks.length === 0 && (
                  <tr><td colSpan={8} style={{ ...st.td, textAlign: 'center', color: '#64748B', padding: 24 }}>No dock walks recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {/* Violations */}
      {tab === 'violations' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search violations..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select style={st.select} value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="All">All Findings</option>
              <option>Violation</option>
              <option>Needs Attention</option>
            </select>
          </div>
          {issuesList.loading ? <LoadingState label="Loading issues…" /> : issuesList.error ? <ErrorState title="Could not load open issues" message={issuesList.error} onRetry={issuesList.refetch} /> : (
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Item</th>
                  <th style={st.th}>Walk Date</th>
                  <th style={st.th}>Slip</th>
                  <th style={st.th}>Type</th>
                  <th style={st.th}>Finding</th>
                  <th style={st.th}>Notes</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {violations.filter((v) => {
                  if (severityFilter !== 'All' && v.severity !== severityFilter) return false;
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return v.number.toLowerCase().includes(q) || v.slip.toLowerCase().includes(q) || v.type.toLowerCase().includes(q);
                }).map((v, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const sc = severityColors[v.severity];
                  return (
                    <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedViolation(v)}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{v.number}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{formatDate(v.walkDate)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{v.slip}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{v.type}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>
                          {v.severity === 'Violation' && <AlertTriangle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                          {v.severity}
                        </span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.description}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: v.status === 'Open' ? '#FFF3CD' : '#DEF7EC', color: v.status === 'Open' ? '#856404' : '#03543F' }}>{v.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setSelectedViolation(v); }}>
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {violations.length === 0 && (
                  <tr><td colSpan={8} style={{ ...st.td, textAlign: 'center', color: '#64748B', padding: 24 }}>No open issues.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {/* Pump-Outs */}
      {tab === 'pumpouts' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={{ flex: 1 }} />
            <ComingSoonButton style={st.addBtn} reason="Coming soon: logging pump-outs from this screen is not wired up yet."><Droplets size={16} /> Log Pump-Out</ComingSoonButton>
          </div>
          {pumpOutsList.loading ? <LoadingState label="Loading pump-outs…" /> : pumpOutsList.error ? <ErrorState title="Could not load pump-outs" message={pumpOutsList.error} onRetry={pumpOutsList.refetch} /> : (
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date / Time</th>
                  <th style={st.th}>Slip</th>
                  <th style={st.th}>Volume</th>
                  <th style={st.th}>Staff ID</th>
                  <th style={st.th}>Duration</th>
                  <th style={st.th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {pumpOutsList.items.map((p, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={p.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{formatDateTime(p.date)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.slip}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.boatName}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.performedBy}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.duration}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, color: p.notes ? '#0A2342' : '#94A3B8' }}>{p.notes || '—'}</td>
                    </tr>
                  );
                })}
                {pumpOutsList.items.length === 0 && (
                  <tr><td colSpan={6} style={{ ...st.td, textAlign: 'center', color: '#64748B', padding: 24 }}>No pump-outs recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {showStartWalk && (
        <StartWalkModal
          onClose={() => setShowStartWalk(false)}
          onStarted={() => walksList.refetch()}
        />
      )}
      {selectedViolation && (
        <ViolationDetail
          violation={selectedViolation}
          onClose={() => setSelectedViolation(null)}
          onResolved={() => { issuesList.refetch(); walksList.refetch(); }}
        />
      )}
    </div>
  );
}
