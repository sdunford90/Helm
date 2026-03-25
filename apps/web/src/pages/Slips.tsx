import React, { useState } from 'react';
import {
  Anchor, Search, Plus, List, LayoutGrid, X,
  Zap, Waves,
} from 'lucide-react';
import SlipDetailPanel from '../components/SlipDetailPanel';

/* ── Types ─────────────────────────────────────────────── */

type SlipStatus = 'Vacant' | 'Occupied' | 'Maintenance' | 'Reserved';

interface Slip {
  id: string;
  number: string;
  dock: string;
  length: number;
  width: number;
  depth: number;
  type: string;
  power: string;
  electricityMode: string;
  status: SlipStatus;
  occupant: string;
  compliance: number; // 0-100
  occupantDetail?: {
    name: string;
    boat: string;
    contractStart: string;
    contractEnd: string;
  };
  meterReadings: Array<{ date: string; kWh: number; amount: number }>;
}

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_SLIPS: Slip[] = [
  { id: '1', number: 'A-01', dock: 'A', length: 40, width: 14, depth: 8, type: 'Covered', power: '30A/50A', electricityMode: 'Metered', status: 'Occupied', occupant: 'James Harborview', compliance: 95, occupantDetail: { name: 'James Harborview', boat: 'Sea Spirit (38\' Sailboat)', contractStart: '2024-03-15', contractEnd: '2025-03-14' }, meterReadings: [{ date: '2025-03-01', kWh: 1240, amount: 148.80 }, { date: '2025-02-01', kWh: 1080, amount: 129.60 }, { date: '2025-01-01', kWh: 920, amount: 110.40 }] },
  { id: '2', number: 'A-02', dock: 'A', length: 40, width: 14, depth: 8, type: 'Covered', power: '30A', electricityMode: 'Flat Rate', status: 'Occupied', occupant: 'Maria Seabreeze', compliance: 88, occupantDetail: { name: 'Maria Seabreeze', boat: 'Coastal Dream (32\' Powerboat)', contractStart: '2024-06-01', contractEnd: '2025-05-31' }, meterReadings: [{ date: '2025-03-01', kWh: 800, amount: 75.00 }] },
  { id: '3', number: 'A-03', dock: 'A', length: 35, width: 12, depth: 7, type: 'Open', power: '30A', electricityMode: 'Metered', status: 'Vacant', occupant: '', compliance: 0, meterReadings: [] },
  { id: '4', number: 'A-04', dock: 'A', length: 35, width: 12, depth: 7, type: 'Open', power: '30A', electricityMode: 'Metered', status: 'Reserved', occupant: 'Robert Dockside (pending)', compliance: 0, meterReadings: [] },
  { id: '5', number: 'B-01', dock: 'B', length: 50, width: 16, depth: 10, type: 'Covered', power: '50A/100A', electricityMode: 'Metered', status: 'Occupied', occupant: 'David Tidewater', compliance: 62, occupantDetail: { name: 'David Tidewater', boat: 'Tidewater Express (48\' Yacht)', contractStart: '2024-01-05', contractEnd: '2025-01-04' }, meterReadings: [{ date: '2025-03-01', kWh: 2100, amount: 252.00 }, { date: '2025-02-01', kWh: 1950, amount: 234.00 }] },
  { id: '6', number: 'B-02', dock: 'B', length: 50, width: 16, depth: 10, type: 'Covered', power: '50A', electricityMode: 'Flat Rate', status: 'Maintenance', occupant: '', compliance: 0, meterReadings: [] },
  { id: '7', number: 'B-03', dock: 'B', length: 45, width: 14, depth: 9, type: 'Open', power: '30A/50A', electricityMode: 'Metered', status: 'Vacant', occupant: '', compliance: 0, meterReadings: [] },
  { id: '8', number: 'C-01', dock: 'C', length: 30, width: 10, depth: 6, type: 'Open', power: '30A', electricityMode: 'Flat Rate', status: 'Occupied', occupant: 'Elena Windward', compliance: 91, occupantDetail: { name: 'Elena Windward', boat: 'Windward (28\' Sailboat)', contractStart: '2025-04-01', contractEnd: '2025-10-31' }, meterReadings: [] },
  { id: '9', number: 'C-02', dock: 'C', length: 30, width: 10, depth: 6, type: 'Open', power: '30A', electricityMode: 'Metered', status: 'Vacant', occupant: '', compliance: 0, meterReadings: [] },
  { id: '10', number: 'C-03', dock: 'C', length: 30, width: 10, depth: 6, type: 'Open', power: '30A', electricityMode: 'Metered', status: 'Vacant', occupant: '', compliance: 0, meterReadings: [] },
];

/* ── Styles ─────────────────────────────────────────────── */

const statusColors: Record<SlipStatus, { bg: string; color: string; border?: string }> = {
  Vacant: { bg: '#FFFFFF', color: '#64748B', border: '#CCC' },
  Occupied: { bg: '#D6E8F4', color: '#0A2342' },
  Maintenance: { bg: '#FFF3CD', color: '#856404' },
  Reserved: { bg: '#E0F7FF', color: '#0A2342', border: '#00D4FF' },
};

const complianceDot = (score: number): string => {
  if (score >= 90) return '#1B5E20';
  if (score >= 70) return '#856404';
  if (score > 0) return '#B71C1C';
  return 'transparent';
};

const st: Record<string, React.CSSProperties> = {
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
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  viewToggle: {
    display: 'flex',
    border: '1px solid #CCC',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  viewBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  searchWrap: {
    position: 'relative' as const,
    flex: 1,
    minWidth: '200px',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#64748B',
    pointerEvents: 'none' as const,
  },
  searchInput: {
    width: '100%',
    padding: '8px 12px 8px 36px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    boxSizing: 'border-box' as const,
  },
  addButton: {
    display: 'flex',
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
    whiteSpace: 'nowrap' as const,
  },
  tableWrap: {
    background: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '14px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    borderBottom: '2px solid #00D4FF',
  },
  td: {
    padding: '12px 16px',
    color: '#0A2342',
    borderBottom: '1px solid #E2E8F0',
    cursor: 'pointer',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '9999px',
  },
  mono: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '14px',
  },
  /* Dock Map */
  mapWrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '32px',
  },
  dockSection: {
    background: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    padding: '24px',
  },
  dockTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#0A2342',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  slipGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '12px',
  },
  slipCard: {
    borderRadius: '8px',
    padding: '16px',
    cursor: 'pointer',
    position: 'relative' as const,
    transition: 'box-shadow 0.15s',
    minHeight: '100px',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-between',
  },
  slipNumber: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#0A2342',
    marginBottom: '4px',
  },
  slipSize: {
    fontSize: '12px',
    color: '#64748B',
    fontFamily: '"JetBrains Mono", monospace',
  },
  slipOccupant: {
    fontSize: '12px',
    color: '#2E4A6B',
    marginTop: '8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  compDot: {
    position: 'absolute' as const,
    top: '8px',
    right: '8px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  legend: {
    display: 'flex',
    gap: '24px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#2E4A6B',
  },
  legendSwatch: {
    width: '16px',
    height: '16px',
    borderRadius: '4px',
    border: '1px solid #CCC',
  },
  /* Modal */
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#FFFFFF',
    borderRadius: '8px',
    width: '560px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 32px 16px',
    borderBottom: '1px solid #E2E8F0',
  },
  modalTitle: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#2E4A6B',
    padding: '4px',
  },
  modalBody: {
    padding: '24px 32px',
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    marginBottom: '16px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#0A2342',
  },
  input: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    outline: 'none',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    background: '#FFFFFF',
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 32px 24px',
    borderTop: '1px solid #E2E8F0',
  },
  cancelBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2E4A6B',
    background: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

/* ── Add Slip Modal ─────────────────────────────────────── */

function AddSlipModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Add Slip</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.twoCol}>
            <div style={st.field}>
              <label style={st.label}>Slip Number *</label>
              <input style={st.input} placeholder="e.g. A-05" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Dock *</label>
              <select style={st.select}>
                <option value="">Select dock...</option>
                <option value="A">Dock A</option>
                <option value="B">Dock B</option>
                <option value="C">Dock C</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Length (ft)</label>
              <input style={st.input} type="number" placeholder="40" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Width (ft)</label>
              <input style={st.input} type="number" placeholder="14" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Depth (ft)</label>
              <input style={st.input} type="number" placeholder="8" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Type</label>
              <select style={st.select}>
                <option value="Open">Open</option>
                <option value="Covered">Covered</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Power</label>
              <select style={st.select}>
                <option value="30A">30A</option>
                <option value="50A">50A</option>
                <option value="30A/50A">30A/50A</option>
                <option value="50A/100A">50A/100A</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Electricity Mode</label>
              <select style={st.select}>
                <option value="Metered">Metered</option>
                <option value="Flat Rate">Flat Rate</option>
                <option value="Included">Included</option>
              </select>
            </div>
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={onClose}>Save Slip</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function Slips() {
  const [view, setView] = useState<'list' | 'map'>('list');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState<Slip | null>(null);

  const filtered = MOCK_SLIPS.filter((sl) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      sl.number.toLowerCase().includes(q) ||
      sl.dock.toLowerCase().includes(q) ||
      sl.occupant.toLowerCase().includes(q)
    );
  });

  const docks = Array.from(new Set(MOCK_SLIPS.map((s) => s.dock))).sort();

  const slipCardStyle = (slip: Slip): React.CSSProperties => {
    const sc = statusColors[slip.status];
    return {
      ...st.slipCard,
      backgroundColor: sc.bg,
      border: slip.status === 'Vacant'
        ? '2px dashed #CCC'
        : slip.status === 'Reserved'
        ? `2px solid #00D4FF`
        : `1px solid #E2E8F0`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    };
  };

  return (
    <div style={st.page}>
      <h1 style={st.title}>Slips</h1>
      <hr style={st.divider} />

      {/* Filter Bar */}
      <div style={st.filterBar}>
        <div style={st.viewToggle}>
          <button
            style={{
              ...st.viewBtn,
              backgroundColor: view === 'list' ? '#0A2342' : '#FFFFFF',
              color: view === 'list' ? '#FFFFFF' : '#2E4A6B',
            }}
            onClick={() => setView('list')}
          >
            <List size={14} /> List
          </button>
          <button
            style={{
              ...st.viewBtn,
              backgroundColor: view === 'map' ? '#0A2342' : '#FFFFFF',
              color: view === 'map' ? '#FFFFFF' : '#2E4A6B',
            }}
            onClick={() => setView('map')}
          >
            <LayoutGrid size={14} /> Dock Map
          </button>
        </div>

        <div style={st.searchWrap}>
          <Search size={16} style={st.searchIcon} />
          <input
            style={st.searchInput}
            placeholder="Search slips, docks, or occupants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button style={st.addButton} onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add Slip
        </button>
      </div>

      {/* List View */}
      {view === 'list' && (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Slip #</th>
                <th style={st.th}>Dock</th>
                <th style={st.th}>Size (L x W x D)</th>
                <th style={st.th}>Type</th>
                <th style={st.th}>Power</th>
                <th style={st.th}>Electricity</th>
                <th style={st.th}>Status</th>
                <th style={st.th}>Occupant</th>
                <th style={st.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sl, idx) => {
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                const sc = statusColors[sl.status];
                return (
                  <tr
                    key={sl.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedSlip(sl)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#B8D8EA'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = rowBg; }}
                  >
                    <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{sl.number}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{sl.dock}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{sl.length}' x {sl.width}' x {sl.depth}'</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{sl.type}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{sl.power}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{sl.electricityMode}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>
                      <span style={{
                        ...st.badge,
                        backgroundColor: sc.bg,
                        color: sc.color,
                        border: sc.border ? `1px solid ${sc.border}` : 'none',
                      }}>
                        {sl.status}
                      </span>
                    </td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{sl.occupant || '—'}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>
                      <button
                        style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                        onClick={(e) => { e.stopPropagation(); setSelectedSlip(sl); }}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dock Map View */}
      {view === 'map' && (
        <div>
          {/* Legend */}
          <div style={st.legend}>
            <div style={st.legendItem}>
              <div style={{ ...st.legendSwatch, backgroundColor: '#FFFFFF', border: '2px dashed #CCC' }} /> Vacant
            </div>
            <div style={st.legendItem}>
              <div style={{ ...st.legendSwatch, backgroundColor: '#D6E8F4' }} /> Occupied
            </div>
            <div style={st.legendItem}>
              <div style={{ ...st.legendSwatch, backgroundColor: '#FFF3CD' }} /> Maintenance
            </div>
            <div style={st.legendItem}>
              <div style={{ ...st.legendSwatch, backgroundColor: '#FFFFFF', border: '2px solid #00D4FF' }} /> Reserved
            </div>
            <div style={st.legendItem}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#1B5E20' }} />
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#856404' }} />
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#B71C1C' }} />
              Compliance
            </div>
          </div>

          <div style={st.mapWrap}>
            {docks.map((dock) => {
              const dockSlips = filtered.filter((s) => s.dock === dock);
              return (
                <div key={dock} style={st.dockSection}>
                  <div style={st.dockTitle}>
                    <Anchor size={18} style={{ color: '#00D4FF' }} />
                    Dock {dock}
                  </div>
                  <div style={st.slipGrid}>
                    {dockSlips.map((sl) => (
                      <div
                        key={sl.id}
                        style={slipCardStyle(sl)}
                        onClick={() => setSelectedSlip(sl)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'; }}
                      >
                        {sl.compliance > 0 && (
                          <div style={{ ...st.compDot, backgroundColor: complianceDot(sl.compliance) }} />
                        )}
                        <div>
                          <div style={st.slipNumber}>{sl.number}</div>
                          <div style={st.slipSize}>{sl.length}' x {sl.width}'</div>
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                            <Zap size={10} /> {sl.power}
                          </div>
                          {sl.occupant && <div style={st.slipOccupant}>{sl.occupant}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Slip Modal */}
      {showAdd && <AddSlipModal onClose={() => setShowAdd(false)} />}

      {/* Slip Detail Panel */}
      {selectedSlip && (
        <SlipDetailPanel
          slip={{
            id: selectedSlip.id,
            number: selectedSlip.number,
            dock: selectedSlip.dock,
            length: selectedSlip.length,
            width: selectedSlip.width,
            depth: selectedSlip.depth,
            power: selectedSlip.power,
            type: selectedSlip.type,
            electricityMode: selectedSlip.electricityMode,
            status: selectedSlip.status,
            occupant: selectedSlip.occupantDetail,
            meterReadings: selectedSlip.meterReadings,
          }}
          onClose={() => setSelectedSlip(null)}
          onEdit={() => console.log('Edit slip', selectedSlip.id)}
          onAssign={() => console.log('Assign slip', selectedSlip.id)}
          onMaintenance={() => console.log('Maintenance slip', selectedSlip.id)}
        />
      )}
    </div>
  );
}
