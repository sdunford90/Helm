import { useState } from 'react';
import {
  ClipboardCheck,
  Plus,
  Search,
  AlertTriangle,
  CheckCircle,
  Eye,
  Camera,
  MapPin,
  Calendar,
  User,
  X,
  ChevronDown,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type ItemStatus = 'OK' | 'VIOLATION' | 'NEEDS_ATTENTION';

interface DockWalkItem {
  slipNumber: string;
  status: ItemStatus;
  violationType: string | null;
  notes: string | null;
  hasPhoto: boolean;
}

interface DockWalk {
  id: string;
  date: string;
  inspector: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  totalItems: number;
  violations: number;
  needsAttention: number;
  items: DockWalkItem[];
}

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_WALKS: DockWalk[] = [
  {
    id: 'dw1', date: '2026-03-25', inspector: 'Sarah Chen', status: 'COMPLETED', totalItems: 12, violations: 2, needsAttention: 1,
    items: [
      { slipNumber: 'A-01', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'A-02', status: 'VIOLATION', violationType: 'Unsecured lines', notes: 'Dock lines frayed and loose', hasPhoto: true },
      { slipNumber: 'A-03', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'A-04', status: 'NEEDS_ATTENTION', violationType: null, notes: 'Dock cleat showing wear', hasPhoto: true },
      { slipNumber: 'B-01', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'B-02', status: 'VIOLATION', violationType: 'Expired fire extinguisher', notes: 'Ext. expired 01/2026', hasPhoto: true },
      { slipNumber: 'B-03', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'B-04', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'C-01', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'C-02', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'C-03', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'C-04', status: 'OK', violationType: null, notes: null, hasPhoto: false },
    ],
  },
  {
    id: 'dw2', date: '2026-03-22', inspector: 'Mike Torres', status: 'COMPLETED', totalItems: 12, violations: 1, needsAttention: 3,
    items: [
      { slipNumber: 'A-01', status: 'NEEDS_ATTENTION', violationType: null, notes: 'Power pedestal cover loose', hasPhoto: false },
      { slipNumber: 'A-02', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'A-03', status: 'NEEDS_ATTENTION', violationType: null, notes: 'Water hose leaking', hasPhoto: true },
      { slipNumber: 'A-04', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'B-01', status: 'VIOLATION', violationType: 'No registration displayed', notes: 'Vessel missing current reg sticker', hasPhoto: true },
      { slipNumber: 'B-02', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'B-03', status: 'NEEDS_ATTENTION', violationType: null, notes: 'Slip bumper worn', hasPhoto: false },
      { slipNumber: 'B-04', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'C-01', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'C-02', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'C-03', status: 'OK', violationType: null, notes: null, hasPhoto: false },
      { slipNumber: 'C-04', status: 'OK', violationType: null, notes: null, hasPhoto: false },
    ],
  },
  {
    id: 'dw3', date: '2026-03-18', inspector: 'Sarah Chen', status: 'COMPLETED', totalItems: 12, violations: 0, needsAttention: 0,
    items: Array.from({ length: 12 }, (_, i) => ({
      slipNumber: `${['A', 'B', 'C'][Math.floor(i / 4)]}-0${(i % 4) + 1}`,
      status: 'OK' as ItemStatus,
      violationType: null,
      notes: null,
      hasPhoto: false,
    })),
  },
];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute' as const, left: '10px', color: '#2E4A6B', pointerEvents: 'none' as const },
  searchInput: { padding: '8px 12px 8px 34px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', width: '220px', outline: 'none' },
  spacer: { flex: 1 },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' },
  metricCard: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  metricLabel: { fontSize: '13px', color: '#64748B', margin: '0 0 4px 0' },
  metricValue: { fontSize: '28px', fontWeight: 700, color: '#0A2342', margin: 0 },
  walkCard: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '16px', cursor: 'pointer', transition: 'box-shadow 0.15s' },
  walkHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  walkTitle: { fontSize: '16px', fontWeight: 600, color: '#0A2342', margin: 0 },
  walkMeta: { fontSize: '13px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px', margin: '4px 0' },
  walkStats: { display: 'flex', gap: '16px', marginTop: '12px' },
  stat: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, lineHeight: '18px' },
  table: { width: '100%', borderCollapse: 'collapse' as const, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  th: { backgroundColor: '#0A2342', color: '#FFF', padding: '12px 16px', fontSize: '13px', fontWeight: 600, textAlign: 'left' as const },
  td: { padding: '12px 16px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  detailPanel: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '24px', marginBottom: '24px' },
};

const STATUS_CONFIG: Record<ItemStatus, { bg: string; text: string; icon: typeof CheckCircle }> = {
  OK: { bg: '#E8F5E9', text: '#1B5E20', icon: CheckCircle },
  VIOLATION: { bg: '#FDECEA', text: '#B71C1C', icon: AlertTriangle },
  NEEDS_ATTENTION: { bg: '#FFF3CD', text: '#856404', icon: Eye },
};

/* ── Component ─────────────────────────────────────────── */

export default function DockWalks() {
  const [selectedWalk, setSelectedWalk] = useState<DockWalk | null>(null);
  const [showNewWalk, setShowNewWalk] = useState(false);

  const totalWalks = MOCK_WALKS.length;
  const totalViolations = MOCK_WALKS.reduce((s, w) => s + w.violations, 0);
  const totalAttention = MOCK_WALKS.reduce((s, w) => s + w.needsAttention, 0);
  const complianceRate = MOCK_WALKS.length > 0
    ? Math.round(((MOCK_WALKS.reduce((s, w) => s + w.totalItems, 0) - totalViolations - totalAttention) / MOCK_WALKS.reduce((s, w) => s + w.totalItems, 0)) * 10000) / 100
    : 100;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Dock Walks</h1>
      <hr style={s.divider} />

      {/* Metrics */}
      <div style={s.metricGrid}>
        <div style={s.metricCard}><p style={s.metricLabel}>Total Inspections</p><p style={s.metricValue}>{totalWalks}</p></div>
        <div style={s.metricCard}><p style={s.metricLabel}>Open Violations</p><p style={{ ...s.metricValue, color: totalViolations > 0 ? '#DC2626' : '#0A2342' }}>{totalViolations}</p></div>
        <div style={s.metricCard}><p style={s.metricLabel}>Needs Attention</p><p style={{ ...s.metricValue, color: totalAttention > 0 ? '#F59E0B' : '#0A2342' }}>{totalAttention}</p></div>
        <div style={s.metricCard}><p style={s.metricLabel}>Compliance Rate</p><p style={s.metricValue}>{complianceRate}%</p></div>
      </div>

      {/* Actions */}
      <div style={s.filterBar}>
        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input style={s.searchInput} placeholder="Search inspections..." />
        </div>
        <div style={s.spacer} />
        <button style={s.primaryBtn} onClick={() => setShowNewWalk(true)}>
          <Plus size={16} /> Start Dock Walk
        </button>
      </div>

      {/* Detail Panel */}
      {selectedWalk && (
        <div style={s.detailPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 }}>
              Inspection — {selectedWalk.date}
            </h3>
            <button onClick={() => setSelectedWalk(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
          </div>
          <div style={{ display: 'flex', gap: '24px', marginBottom: '16px' }}>
            <span style={s.walkMeta}><User size={14} /> {selectedWalk.inspector}</span>
            <span style={s.walkMeta}><MapPin size={14} /> {selectedWalk.totalItems} slips inspected</span>
          </div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Slip</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Violation Type</th>
                <th style={s.th}>Notes</th>
                <th style={s.th}>Photo</th>
              </tr>
            </thead>
            <tbody>
              {selectedWalk.items.map((item, idx) => {
                const config = STATUS_CONFIG[item.status];
                return (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFF' : '#D6E8F4' }}>
                    <td style={s.td}>{item.slipNumber}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, backgroundColor: config.bg, color: config.text }}>
                        {item.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={s.td}>{item.violationType ?? '—'}</td>
                    <td style={s.td}>{item.notes ?? '—'}</td>
                    <td style={s.td}>{item.hasPhoto ? <Camera size={16} color="#0A2342" /> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Walk List */}
      {MOCK_WALKS.map((walk) => (
        <div
          key={walk.id}
          style={s.walkCard}
          onClick={() => setSelectedWalk(walk)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'; }}
        >
          <div style={s.walkHeader}>
            <div>
              <h3 style={s.walkTitle}>Dock Walk — {walk.date}</h3>
              <div style={s.walkMeta}><User size={14} /> {walk.inspector}</div>
            </div>
            <span style={{ ...s.badge, backgroundColor: walk.status === 'COMPLETED' ? '#E8F5E9' : '#FFF3CD', color: walk.status === 'COMPLETED' ? '#1B5E20' : '#856404' }}>
              {walk.status.replace('_', ' ')}
            </span>
          </div>
          <div style={s.walkStats}>
            <span style={{ ...s.stat, color: '#1B5E20' }}><CheckCircle size={14} /> {walk.totalItems - walk.violations - walk.needsAttention} OK</span>
            <span style={{ ...s.stat, color: '#B71C1C' }}><AlertTriangle size={14} /> {walk.violations} Violations</span>
            <span style={{ ...s.stat, color: '#856404' }}><Eye size={14} /> {walk.needsAttention} Attention</span>
            <span style={{ ...s.stat, color: '#64748B' }}><MapPin size={14} /> {walk.totalItems} slips</span>
          </div>
        </div>
      ))}
    </div>
  );
}
