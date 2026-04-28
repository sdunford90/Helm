import React, { useState, useMemo } from 'react';
import {
  ClipboardCheck, Search, Plus, X, AlertTriangle,
  Eye, CheckCircle2, Clock, Camera, Droplets,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

/* ── API types (from server) ─────────────────────────────── */

interface ApiDockWalk {
  id: string;
  inspectorId: string;
  dockId: string | null;
  startedAt: string;
  completedAt: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED';
  items: { id: string; status: 'OK' | 'VIOLATION' | 'NEEDS_ATTENTION'; slipId: string | null }[];
}

interface ApiIssue {
  id: string;
  status: 'VIOLATION' | 'NEEDS_ATTENTION';
  notes: string | null;
  violationType: string | null;
  slip: { id: string; slipNumber: string; dockId: string } | null;
  dockWalk: { id: string; startedAt: string; inspectorId: string; status: string };
}

interface ApiPumpOut {
  id: string;
  slipId: string;
  staffId: string | null;
  eventDate: string;
  gallons: number;
  feeCents: number | null;
  slip: { id: string; slipNumber: string; dockId: string } | null;
}

interface TeamMember {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  active: boolean;
}

/* ── Frontend types ──────────────────────────────────────── */

type WalkStatus = 'In Progress' | 'Completed';
type Severity = 'Low' | 'Medium' | 'High' | 'Critical';

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
  number: string;
  walkDate: string;
  slip: string;
  type: string;
  severity: Severity;
  description: string;
  status: 'Open' | 'Resolved';
  reportedBy: string;
}

interface PumpOut {
  id: string;
  date: string;
  slip: string;
  gallons: number;
  performedBy: string;
  feeCents: number | null;
}

/* ── Helpers ─────────────────────────────────────────────── */

const DOCKS = ['A', 'B', 'C', 'D', 'Fuel'];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}

function violationSeverity(violationType: string | null): Severity {
  if (!violationType) return 'Medium';
  if (violationType === 'SAFETY_HAZARD') return 'Critical';
  if (violationType === 'ELECTRICAL') return 'High';
  if (violationType === 'LINE_CONDITION') return 'Medium';
  if (violationType === 'CLEANLINESS') return 'Low';
  return 'Medium';
}

function violationTypeLabel(violationType: string | null): string {
  if (!violationType) return 'Other';
  return violationType.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
}

function staffName(teamMembers: TeamMember[], staffId: string | null): string {
  if (!staffId) return '—';
  const m = teamMembers.find((u) => u.id === staffId);
  if (!m) return staffId.slice(0, 8);
  return [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;
}

/* ── Styles ─────────────────────────────────────────────── */

const severityColors: Record<Severity, { bg: string; color: string }> = {
  Low: { bg: '#DBEAFE', color: '#1E40AF' },
  Medium: { bg: '#FFF3CD', color: '#856404' },
  High: { bg: '#FED7AA', color: '#C2410C' },
  Critical: { bg: '#FDE8E8', color: '#9B1C1C' },
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

function StartWalkModal({
  onClose,
  onSave,
  teamMembers,
}: {
  onClose: () => void;
  onSave?: (walk: DockWalk) => void;
  teamMembers: TeamMember[];
}) {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const dockStaff = teamMembers.filter((m) => m.active);
  const firstStaff = dockStaff[0];
  const [inspector, setInspector] = useState(firstStaff?.id ?? '');
  const [selectedDocks, setSelectedDocks] = useState<string[]>(['A']);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDock = (d: string) =>
    setSelectedDocks((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const handleStart = async () => {
    if (!inspector || selectedDocks.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const raw = await api.post<ApiDockWalk>(
        '/api/dock-walks',
        { inspectorId: inspector, dockId: selectedDocks[0], notes },
        token,
      );
      const inspName = staffName(teamMembers, raw.inspectorId);
      const newWalk: DockWalk = {
        id: raw.id,
        number: `DW-${raw.id.slice(-6).toUpperCase()}`,
        date: fmtDate(raw.startedAt),
        inspector: inspName,
        docks: raw.dockId ? [raw.dockId] : selectedDocks,
        slipsChecked: 0,
        violations: 0,
        status: 'In Progress',
        duration: '—',
      };
      onSave?.(newWalk);
      onClose();
      // Drop the inspector straight into the mobile-first per-slip walk.
      navigate(`/dock-walks/${raw.id}/walk`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start dock walk';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Start Dock Walk</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.field}>
            <label style={st.label}>Inspector *</label>
            <select style={st.input} value={inspector} onChange={(e) => setInspector(e.target.value)}>
              {dockStaff.map((m) => (
                <option key={m.id} value={m.id}>
                  {[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}
                </option>
              ))}
            </select>
          </div>
          <div style={st.field}>
            <label style={st.label}>Dock(s) *</label>
            <div style={{ display: 'flex', gap: '16px', marginTop: '4px', flexWrap: 'wrap' as const }}>
              {DOCKS.map((d) => (
                <label key={d} style={st.checkboxLabel}>
                  <input type="checkbox" checked={selectedDocks.includes(d)} onChange={() => toggleDock(d)} /> Dock {d}
                </label>
              ))}
            </div>
          </div>
          <div style={st.field}>
            <label style={st.label}>Notes</label>
            <textarea style={{ ...st.input, minHeight: '60px', resize: 'vertical' as const }} placeholder="Any pre-walk notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {error && (
          <div style={{ padding: '0 24px', color: '#B91C1C', fontSize: 13 }}>
            {error}
          </div>
        )}
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={handleStart} disabled={saving || selectedDocks.length === 0}>
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
  const { getToken } = useAuth();
  const sc = severityColors[violation.severity];
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(violation.status === 'Resolved');

  const handleResolve = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      const walkId = violation.id.split('::')[0];
      const itemId = violation.id.split('::')[1] ?? violation.id;
      const token = await getToken();
      await api.put(
        `/api/dock-walks/${walkId}/items/${itemId}`,
        { status: 'OK', notes: resolutionNotes },
        token,
      );
      setResolved(true);
      onResolved?.(violation.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not resolve violation';
      window.alert(msg);
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
        <div style={st.detailValue}>{violation.walkDate}</div>
        <div style={st.detailLabel}>Reported By</div>
        <div style={st.detailValue}>{violation.reportedBy}</div>
      </div>
      <div style={st.detailSection}>
        <div style={st.detailLabel}>Description</div>
        <div style={{ ...st.detailValue, lineHeight: 1.6 }}>{violation.description || '—'}</div>
      </div>
      <div style={st.detailSection}>
        <div style={st.detailLabel}>Photos</div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '8px', background: '#F1F5F9', border: '2px dashed #CBD5E1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Camera size={20} style={{ color: '#94A3B8' }} />
          </div>
        </div>
      </div>
      {!resolved && (
        <div style={{ padding: '20px 24px' }}>
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
  const [dockFilter, setDockFilter] = useState('All');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showStartWalk, setShowStartWalk] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null);
  const [localWalks, setLocalWalks] = useState<DockWalk[]>([]);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  const { data: teamData } = useApi<{ members: TeamMember[] }>('get', '/api/settings/team', { immediate: true });
  const { data: walksData, loading: walksLoading } = useApi<{ data: ApiDockWalk[]; pagination: unknown }>('get', '/api/dock-walks?take=50', { immediate: true });
  const { data: issuesData, loading: issuesLoading } = useApi<{ data: ApiIssue[]; pagination: unknown }>('get', '/api/dock-walks/issues?take=50', { immediate: true });
  const { data: pumpOutsData, loading: pumpOutsLoading } = useApi<{ data: ApiPumpOut[]; pagination: unknown }>('get', '/api/dock-walks/pump-outs?take=50', { immediate: true });

  const teamMembers = teamData?.members ?? [];

  const walks: DockWalk[] = useMemo(() => {
    const apiWalks = walksData?.data ?? [];
    const mapped = apiWalks.map((w): DockWalk => ({
      id: w.id,
      number: `DW-${w.id.slice(-6).toUpperCase()}`,
      date: fmtDate(w.startedAt),
      inspector: staffName(teamMembers, w.inspectorId),
      docks: w.dockId ? [w.dockId] : [],
      slipsChecked: w.items.length,
      violations: w.items.filter((i) => i.status === 'VIOLATION').length,
      status: w.status === 'IN_PROGRESS' ? 'In Progress' : 'Completed',
      duration: fmtDuration(w.startedAt, w.completedAt),
    }));
    return localWalks.length > 0 ? [...localWalks, ...mapped] : mapped;
  }, [walksData, teamMembers, localWalks]);

  const violations: Violation[] = useMemo(() => {
    const apiIssues = issuesData?.data ?? [];
    return apiIssues.map((item): Violation => ({
      id: `${item.dockWalk.id}::${item.id}`,
      number: `VIO-${item.id.slice(-6).toUpperCase()}`,
      walkDate: fmtDate(item.dockWalk.startedAt),
      slip: item.slip?.slipNumber ?? '—',
      type: violationTypeLabel(item.violationType),
      severity: violationSeverity(item.violationType),
      description: item.notes ?? '',
      status: resolvedIds.has(item.id) ? 'Resolved' : 'Open',
      reportedBy: staffName(teamMembers, item.dockWalk.inspectorId),
    }));
  }, [issuesData, teamMembers, resolvedIds]);

  const pumpOuts: PumpOut[] = useMemo(() => {
    return (pumpOutsData?.data ?? []).map((p): PumpOut => ({
      id: p.id,
      date: new Date(p.eventDate).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
      slip: p.slip?.slipNumber ?? p.slipId.slice(0, 8),
      gallons: p.gallons,
      performedBy: staffName(teamMembers, p.staffId),
      feeCents: p.feeCents,
    }));
  }, [pumpOutsData, teamMembers]);

  const openViolations = violations.filter((v) => v.status === 'Open').length;
  const avgItems = walks.length > 0 ? Math.round(walks.reduce((s, w) => s + w.slipsChecked, 0) / walks.length) : 0;
  const lastWalk = walks[0];

  const filteredWalks = walks.filter((w) => {
    if (dockFilter !== 'All' && !w.docks.includes(dockFilter)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return w.number.toLowerCase().includes(q) || w.inspector.toLowerCase().includes(q);
  });

  const filteredViolations = violations.filter((v) => {
    if (severityFilter !== 'All' && v.severity !== severityFilter) return false;
    if (statusFilter !== 'All' && v.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return v.number.toLowerCase().includes(q) || v.slip.toLowerCase().includes(q) || v.type.toLowerCase().includes(q);
  });

  const loading = walksLoading || issuesLoading || pumpOutsLoading;

  const tabItems: { key: typeof tab; label: string }[] = [
    { key: 'history', label: 'Walk History' },
    { key: 'violations', label: 'Violations' },
    { key: 'pumpouts', label: 'Pump-Outs' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Dock Walks</h1>
      <hr style={st.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading...</div>}

      {/* Stats */}
      <div style={st.statsRow} className="helm-stats-grid">
        <div style={st.statCard}>
          <div style={st.statLabel}>Total Walks</div>
          <div style={st.statValue}>{walks.length}</div>
          <div style={st.statSub}>All recorded walks</div>
        </div>
        <div style={{ ...st.statCard, borderTop: openViolations > 0 ? '3px solid #F59E0B' : '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Open Violations</div>
          <div style={{ ...st.statValue, color: openViolations > 0 ? '#C2410C' : '#03543F' }}>{openViolations}</div>
          <div style={st.statSub}>{violations.filter((v) => (v.severity === 'High' || v.severity === 'Critical') && v.status === 'Open').length} high/critical</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Avg Slips / Walk</div>
          <div style={st.statValue}>{avgItems}</div>
          <div style={st.statSub}>Across all walks</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Last Walk</div>
          <div style={{ ...st.statValue, fontSize: '18px' }}>{lastWalk?.date ?? '—'}</div>
          <div style={st.statSub}>{lastWalk ? `${lastWalk.inspector} — ${lastWalk.status}` : 'No walks yet'}</div>
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
            <select style={st.select} value={dockFilter} onChange={(e) => setDockFilter(e.target.value)}>
              <option value="All">All Docks</option>
              {DOCKS.map((d) => <option key={d} value={d}>Dock {d}</option>)}
            </select>
            <button style={st.addBtn} onClick={() => setShowStartWalk(true)}>
              <ClipboardCheck size={16} /> Start New Walk
            </button>
          </div>
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Walk #</th>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Inspector</th>
                  <th style={st.th}>Dock</th>
                  <th style={st.th}>Slips Checked</th>
                  <th style={st.th}>Violations</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {filteredWalks.length === 0 && !loading && (
                  <tr><td colSpan={8} style={{ ...st.td, textAlign: 'center', padding: '32px', color: '#64748B' }}>No dock walks found.</td></tr>
                )}
                {filteredWalks.map((w, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={w.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{w.number}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{w.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{w.inspector}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{w.docks.map((d) => `Dock ${d}`).join(', ') || '—'}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center', ...st.mono }}>{w.slipsChecked}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>
                        <span style={{ ...st.mono, color: w.violations > 0 ? '#C2410C' : '#03543F', fontWeight: 600 }}>{w.violations}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: w.status === 'In Progress' ? '#E0F7FF' : '#DEF7EC', color: w.status === 'In Progress' ? '#0A2342' : '#03543F' }}>
                          {w.status === 'In Progress'
                            ? <Clock size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                            : <CheckCircle2 size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                          {w.status}
                        </span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{w.duration}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
              <option value="All">All Severities</option>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option>Critical</option>
            </select>
            <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              <option>Open</option>
              <option>Resolved</option>
            </select>
          </div>
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Violation #</th>
                  <th style={st.th}>Walk Date</th>
                  <th style={st.th}>Slip</th>
                  <th style={st.th}>Type</th>
                  <th style={st.th}>Severity</th>
                  <th style={st.th}>Description</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredViolations.length === 0 && !issuesLoading && (
                  <tr><td colSpan={8} style={{ ...st.td, textAlign: 'center', padding: '32px', color: '#64748B' }}>No violations found.</td></tr>
                )}
                {filteredViolations.map((v, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const sc = severityColors[v.severity];
                  return (
                    <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedViolation(v)}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{v.number}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{v.walkDate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{v.slip}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{v.type}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>
                          {(v.severity === 'Critical' || v.severity === 'High') && <AlertTriangle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                          {v.severity}
                        </span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.description || '—'}</td>
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
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pump-Outs */}
      {tab === 'pumpouts' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={{ flex: 1 }} />
            <button style={st.addBtn}><Droplets size={16} /> Log Pump-Out</button>
          </div>
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date / Time</th>
                  <th style={st.th}>Slip</th>
                  <th style={st.th}>Gallons</th>
                  <th style={st.th}>Fee</th>
                  <th style={st.th}>Performed By</th>
                </tr>
              </thead>
              <tbody>
                {pumpOuts.length === 0 && !pumpOutsLoading && (
                  <tr><td colSpan={5} style={{ ...st.td, textAlign: 'center', padding: '32px', color: '#64748B' }}>No pump-outs recorded.</td></tr>
                )}
                {pumpOuts.map((p, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={p.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.slip}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.gallons} gal</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>
                        {p.feeCents != null ? `$${(p.feeCents / 100).toFixed(2)}` : '—'}
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.performedBy}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showStartWalk && (
        <StartWalkModal
          teamMembers={teamMembers}
          onClose={() => setShowStartWalk(false)}
          onSave={(newWalk) => {
            setLocalWalks((prev) => [newWalk, ...prev]);
            setShowStartWalk(false);
          }}
        />
      )}
      {selectedViolation && (
        <ViolationDetail
          violation={selectedViolation}
          onClose={() => setSelectedViolation(null)}
          onResolved={(id) => {
            const itemId = id.split('::')[1] ?? id;
            setResolvedIds((prev) => new Set([...prev, itemId]));
            setSelectedViolation(null);
          }}
        />
      )}
    </div>
  );
}
