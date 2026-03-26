import React, { useState } from 'react';
import {
  ClipboardCheck, Search, Plus, X, AlertTriangle,
  Eye, CheckCircle2, Clock, MapPin, Camera, Droplets,
  Shield,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ── Types ─────────────────────────────────────────────── */

type WalkStatus = 'In Progress' | 'Completed';
type Severity = 'Low' | 'Medium' | 'High' | 'Critical';
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

/* ── Mock Data ─────────────────────────────────────────── */

const WALKS: DockWalk[] = [
  { id: '1', number: 'DW-0042', date: '2026-03-25', inspector: 'Jake Martinez', docks: ['A', 'B'], slipsChecked: 14, violations: 2, status: 'In Progress', duration: '35 min' },
  { id: '2', number: 'DW-0041', date: '2026-03-24', inspector: 'Maria Santos', docks: ['A', 'B', 'C'], slipsChecked: 20, violations: 1, status: 'Completed', duration: '52 min' },
  { id: '3', number: 'DW-0040', date: '2026-03-23', inspector: 'Jake Martinez', docks: ['C'], slipsChecked: 6, violations: 0, status: 'Completed', duration: '18 min' },
  { id: '4', number: 'DW-0039', date: '2026-03-22', inspector: 'Maria Santos', docks: ['A', 'B', 'C'], slipsChecked: 20, violations: 3, status: 'Completed', duration: '58 min' },
  { id: '5', number: 'DW-0038', date: '2026-03-21', inspector: 'Jake Martinez', docks: ['B'], slipsChecked: 7, violations: 1, status: 'Completed', duration: '22 min' },
  { id: '6', number: 'DW-0037', date: '2026-03-20', inspector: 'Maria Santos', docks: ['A', 'B', 'C'], slipsChecked: 20, violations: 2, status: 'Completed', duration: '48 min' },
  { id: '7', number: 'DW-0036', date: '2026-03-19', inspector: 'Jake Martinez', docks: ['A'], slipsChecked: 8, violations: 0, status: 'Completed', duration: '20 min' },
  { id: '8', number: 'DW-0035', date: '2026-03-18', inspector: 'Maria Santos', docks: ['A', 'B', 'C'], slipsChecked: 20, violations: 4, status: 'Completed', duration: '1h 5min' },
];

const VIOLATIONS: Violation[] = [
  { id: '1', number: 'VIO-0089', walkDate: '2026-03-25', slip: 'A-01', type: 'Line Condition', severity: 'Medium', description: 'Port-side dock line frayed near cleat, showing significant wear. Recommend replacement.', status: 'Open', reportedBy: 'Jake Martinez' },
  { id: '2', number: 'VIO-0088', walkDate: '2026-03-25', slip: 'B-01', type: 'Electrical', severity: 'High', description: 'Shore power cord showing exposed insulation near pedestal connection. Fire/shock hazard.', status: 'Open', reportedBy: 'Jake Martinez' },
  { id: '3', number: 'VIO-0087', walkDate: '2026-03-24', slip: 'C-02', type: 'Cleanliness', severity: 'Low', description: 'Oil sheen observed around vessel. Minor leak from engine compartment.', status: 'Open', reportedBy: 'Maria Santos' },
  { id: '4', number: 'VIO-0086', walkDate: '2026-03-22', slip: 'A-04', type: 'Safety Hazard', severity: 'Critical', description: 'Bilge pump failure — vessel taking on water. Owner contacted immediately.', status: 'Resolved', reportedBy: 'Maria Santos' },
  { id: '5', number: 'VIO-0085', walkDate: '2026-03-22', slip: 'B-03', type: 'Unauthorized Modification', severity: 'Medium', description: 'Tenant installed unapproved solar panel mount on dock finger.', status: 'Open', reportedBy: 'Maria Santos' },
  { id: '6', number: 'VIO-0084', walkDate: '2026-03-22', slip: 'A-02', type: 'Line Condition', severity: 'Low', description: 'Spring line showing light wear. Monitor on next walk.', status: 'Resolved', reportedBy: 'Maria Santos' },
  { id: '7', number: 'VIO-0083', walkDate: '2026-03-21', slip: 'B-02', type: 'Cleanliness', severity: 'Low', description: 'Trash and debris on dock near slip. Tenant notified.', status: 'Resolved', reportedBy: 'Jake Martinez' },
  { id: '8', number: 'VIO-0082', walkDate: '2026-03-20', slip: 'A-03', type: 'Safety Hazard', severity: 'High', description: 'Fire extinguisher expired. Vessel non-compliant with marina safety policy.', status: 'Open', reportedBy: 'Maria Santos' },
  { id: '9', number: 'VIO-0081', walkDate: '2026-03-20', slip: 'C-01', type: 'Electrical', severity: 'Medium', description: 'Shore power cord not properly secured. Trip hazard on dock.', status: 'Resolved', reportedBy: 'Maria Santos' },
  { id: '10', number: 'VIO-0080', walkDate: '2026-03-18', slip: 'B-01', type: 'Line Condition', severity: 'High', description: 'Bow line undersized for vessel weight. Must upgrade to 5/8" minimum.', status: 'Resolved', reportedBy: 'Maria Santos' },
];

const PUMP_OUTS: PumpOut[] = [
  { id: '1', date: '2026-03-25 9:30 AM', slip: 'A-01', boatName: 'Sea Spirit', performedBy: 'Jake Martinez', duration: '15 min', notes: '' },
  { id: '2', date: '2026-03-24 2:15 PM', slip: 'B-01', boatName: 'Tidewater Express', performedBy: 'Maria Santos', duration: '20 min', notes: 'Tank nearly full' },
  { id: '3', date: '2026-03-23 10:00 AM', slip: 'C-01', boatName: 'Windward', performedBy: 'Jake Martinez', duration: '12 min', notes: '' },
  { id: '4', date: '2026-03-22 3:45 PM', slip: 'A-02', boatName: 'Coastal Dream', performedBy: 'Maria Santos', duration: '18 min', notes: 'Requested weekly schedule' },
  { id: '5', date: '2026-03-20 11:30 AM', slip: 'B-03', boatName: 'Harbor Light', performedBy: 'Jake Martinez', duration: '14 min', notes: '' },
  { id: '6', date: '2026-03-18 9:00 AM', slip: 'A-01', boatName: 'Sea Spirit', performedBy: 'Maria Santos', duration: '16 min', notes: '' },
];

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

const INSPECTORS = [
  { id: 'staff-jake', name: 'Jake Martinez' },
  { id: 'staff-maria', name: 'Maria Santos' },
  { id: 'staff-tom', name: 'Tom Bradley' },
];

const DOCKS = ['A', 'B', 'C', 'D', 'Fuel'];

function StartWalkModal({ onClose, onSave }: { onClose: () => void; onSave?: (walk: DockWalk) => void }) {
  const [inspector, setInspector] = useState(INSPECTORS[0].id);
  const [selectedDocks, setSelectedDocks] = useState<string[]>(['A', 'B', 'C']);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleDock = (d: string) =>
    setSelectedDocks((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const handleStart = async () => {
    if (!inspector || selectedDocks.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/dock-walks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectorId: inspector, dockId: selectedDocks[0], notes }),
      });
      const inspectorName = INSPECTORS.find((i) => i.id === inspector)?.name ?? inspector;
      const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const newWalk: DockWalk = res.ok
        ? await res.json()
        : {
            id: `walk-${Date.now()}`,
            number: `DW-${String(Date.now()).slice(-4)}`,
            date: today,
            inspector: inspectorName,
            docks: selectedDocks,
            slipsChecked: 0,
            violations: 0,
            status: 'In Progress',
            duration: '—',
          };
      onSave?.(newWalk);
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Start Dock Walk</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.field}>
            <label style={st.label}>Inspector *</label>
            <select style={st.input} value={inspector} onChange={(e) => setInspector(e.target.value)}>
              {INSPECTORS.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
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
  const sc = severityColors[violation.severity];
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(violation.status === 'Resolved');

  const handleResolve = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await fetch(`/api/dock-walks/violations/${violation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RESOLVED', resolutionNotes }),
      });
      setResolved(true);
      onResolved?.(violation.id);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div style={st.detailPanel}>
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
        <div style={{ ...st.detailValue, lineHeight: 1.6 }}>{violation.description}</div>
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
  const [severityFilter, setSeverityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showStartWalk, setShowStartWalk] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null);

  const { data: apiWalks, loading: walksLoading } = useApi<DockWalk[]>('get', '/api/dock-walks', { immediate: true });
  const { data: apiViolations, loading: violationsLoading } = useApi<Violation[]>('get', '/api/dock-walks/violations', { immediate: true });

  const [localWalks, setLocalWalks] = useState<DockWalk[]>([]);
  const [localViolations, setLocalViolations] = useState<Violation[] | null>(null);

  const walks = localWalks.length > 0 ? localWalks : (apiWalks || WALKS);
  const violations = localViolations ?? (apiViolations || VIOLATIONS);

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
      <h1 style={st.title}>Dock Walks</h1>
      <hr style={st.divider} />

      {(walksLoading || violationsLoading) && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading dock walks...</div>}

      {/* Stats */}
      <div style={st.statsRow}>
        <div style={st.statCard}>
          <div style={st.statLabel}>Total Walks</div>
          <div style={st.statValue}>{walks.length}</div>
          <div style={st.statSub}>This month</div>
        </div>
        <div style={{ ...st.statCard, borderTop: openViolations > 0 ? '3px solid #F59E0B' : '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Open Violations</div>
          <div style={{ ...st.statValue, color: openViolations > 0 ? '#C2410C' : '#03543F' }}>{openViolations}</div>
          <div style={st.statSub}>{violations.filter((v) => v.severity === 'High' || v.severity === 'Critical').filter((v) => v.status === 'Open').length} high/critical</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Avg Slips / Walk</div>
          <div style={st.statValue}>{avgItems}</div>
          <div style={st.statSub}>Across all walks</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Last Walk</div>
          <div style={st.statValue}>{lastWalk.date}</div>
          <div style={st.statSub}>{lastWalk.inspector} — {lastWalk.status}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={st.tabs}>
        {tabItems.map((t) => (
          <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Walk History */}
      {tab === 'history' && (
        <>
          <div style={st.filterBar}>
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search walks..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button style={st.addBtn} onClick={() => setShowStartWalk(true)}>
              <ClipboardCheck size={16} /> Start New Walk
            </button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Walk #</th>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Inspector</th>
                  <th style={st.th}>Dock(s)</th>
                  <th style={st.th}>Slips Checked</th>
                  <th style={st.th}>Violations</th>
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
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{w.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{w.inspector}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{(w.docks ?? []).map((d) => `Dock ${d}`).join(', ')}</td>
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
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Violations */}
      {tab === 'violations' && (
        <>
          <div style={st.filterBar}>
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
          <div style={st.tableWrap}>
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
                {violations.filter((v) => {
                  if (severityFilter !== 'All' && v.severity !== severityFilter) return false;
                  if (statusFilter !== 'All' && v.status !== statusFilter) return false;
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return v.number.toLowerCase().includes(q) || v.slip.toLowerCase().includes(q) || v.type.toLowerCase().includes(q);
                }).map((v, idx) => {
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
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pump-Outs */}
      {tab === 'pumpouts' && (
        <>
          <div style={st.filterBar}>
            <div style={{ flex: 1 }} />
            <button style={st.addBtn}><Droplets size={16} /> Log Pump-Out</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date / Time</th>
                  <th style={st.th}>Slip</th>
                  <th style={st.th}>Boat Name</th>
                  <th style={st.th}>Performed By</th>
                  <th style={st.th}>Duration</th>
                  <th style={st.th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {PUMP_OUTS.map((p, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={p.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.slip}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.boatName}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.performedBy}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.duration}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, color: p.notes ? '#0A2342' : '#94A3B8' }}>{p.notes || '—'}</td>
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
          onClose={() => setShowStartWalk(false)}
          onSave={(newWalk) => {
            setLocalWalks((prev) => [newWalk, ...(prev.length > 0 ? prev : apiWalks || WALKS)]);
            setShowStartWalk(false);
          }}
        />
      )}
      {selectedViolation && (
        <ViolationDetail
          violation={selectedViolation}
          onClose={() => setSelectedViolation(null)}
          onResolved={(id) => {
            const base = localViolations ?? (apiViolations || VIOLATIONS);
            setLocalViolations(base.map((v) => v.id === id ? { ...v, status: 'Resolved' } : v));
          }}
        />
      )}
    </div>
  );
}
