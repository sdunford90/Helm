import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, List, LayoutGrid, X,
} from 'lucide-react';
import SlipDetailPanel from '../components/SlipDetailPanel';
import DockMapSVG from '../components/DockMapSVG';
import { useApiClient, useList } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { customerName, type CustomerRef } from '../lib/dto';
import { ErrorState, InlineError, LoadingState } from '../components/StateViews';
import { useToast } from '../components/Toast';

/* ── Types ─────────────────────────────────────────────── */

type SlipStatus = 'Vacant' | 'Occupied' | 'Maintenance' | 'Reserved';

interface Slip {
  id: string;
  number: string;
  dock: string;
  length: number;
  beam: number;
  draft: number;
  height: number;
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

/* ── API mapping ───────────────────────────────────────── */

interface SlipDTO {
  id: string;
  slipNumber: string;
  dockId?: string | null;
  lengthFt: number;
  beamFt?: number | null;
  depthFt?: number | null;
  slipType?: string | null;
  shorePower?: string | null;
  status: 'VACANT' | 'OCCUPIED' | 'MAINTENANCE' | 'RESERVED';
  electricityMode: 'FLAT_FEE' | 'METERED';
  transientCapable?: boolean;
  currentOccupant?: {
    startDate: string;
    endDate?: string | null;
    customer?: CustomerRef | null;
    boat?: { name?: string | null; lengthFt?: number | null } | null;
  } | null;
}

const STATUS_LABEL: Record<SlipDTO['status'], SlipStatus> = {
  VACANT: 'Vacant', OCCUPIED: 'Occupied', MAINTENANCE: 'Maintenance', RESERVED: 'Reserved',
};
const STATUS_ENUM: Record<SlipStatus, SlipDTO['status']> = {
  Vacant: 'VACANT', Occupied: 'OCCUPIED', Maintenance: 'MAINTENANCE', Reserved: 'RESERVED',
};

function toSlip(d: SlipDTO): Slip {
  const occ = d.currentOccupant;
  return {
    id: d.id,
    number: d.slipNumber,
    dock: d.dockId ?? '',
    length: d.lengthFt,
    beam: d.beamFt ?? 0,
    draft: d.depthFt ?? 0,
    height: 0,
    type: d.slipType ?? '',
    power: d.shorePower ?? '',
    electricityMode: d.electricityMode === 'METERED' ? 'Metered' : 'Flat Fee',
    status: STATUS_LABEL[d.status] ?? 'Vacant',
    occupant: occ?.customer ? customerName(occ.customer) : '',
    compliance: 0,
    occupantDetail: occ
      ? {
          name: customerName(occ.customer),
          boat: occ.boat?.name ? `${occ.boat.name}${occ.boat.lengthFt ? ` (${occ.boat.lengthFt}')` : ''}` : '—',
          contractStart: occ.startDate?.slice(0, 10) ?? '',
          contractEnd: occ.endDate?.slice(0, 10) ?? '',
        }
      : undefined,
    // Meter readings are not part of the slip list response.
    meterReadings: [],
  };
}

/** Form values -> Create/UpdateSlip schema. */
function slipPayload(v: { number: string; dock: string; length: string; beam: string; draft: string; type: string; power: string; electricityMode: string }) {
  const num = (x: string) => (Number(x) > 0 ? Number(x) : null);
  return {
    slipNumber: v.number.trim(),
    dockId: v.dock.trim() || null,
    lengthFt: Number(v.length),
    beamFt: num(v.beam),
    depthFt: num(v.draft),
    slipType: v.type || null,
    shorePower: v.power || null,
    electricityMode: v.electricityMode === 'Metered' ? 'METERED' : 'FLAT_FEE',
  };
}

const statusColors: Record<SlipStatus, { bg: string; color: string; border?: string }> = {
  Vacant: { bg: '#FFFFFF', color: '#64748B', border: '#CCC' },
  Occupied: { bg: '#D6E8F4', color: '#0A2342' },
  Maintenance: { bg: '#FFF3CD', color: '#856404' },
  Reserved: { bg: '#E0F7FF', color: '#0A2342', border: '#00D4FF' },
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

function SlipFormFields({ v, set, showStatus }: {
  v: Record<string, string>;
  set: (k: string, val: string) => void;
  showStatus?: boolean;
}) {
  return (
    <div style={st.twoCol} className="helm-form-grid">
      <div style={st.field}>
        <label style={st.label}>Slip Number *</label>
        <input style={st.input} placeholder="e.g. A-05" value={v.number} onChange={(e) => set('number', e.target.value)} />
      </div>
      <div style={st.field}>
        <label style={st.label}>Dock</label>
        <input style={st.input} placeholder="e.g. A" value={v.dock} onChange={(e) => set('dock', e.target.value)} />
      </div>
      <div style={st.field}>
        <label style={st.label}>Length (ft) *</label>
        <input style={st.input} type="number" placeholder="40" value={v.length} onChange={(e) => set('length', e.target.value)} />
      </div>
      <div style={st.field}>
        <label style={st.label}>Beam (ft)</label>
        <input style={st.input} type="number" placeholder="14" value={v.beam} onChange={(e) => set('beam', e.target.value)} />
      </div>
      <div style={st.field}>
        <label style={st.label}>Depth (ft)</label>
        <input style={st.input} type="number" placeholder="8" value={v.draft} onChange={(e) => set('draft', e.target.value)} />
      </div>
      <div style={st.field}>
        <label style={st.label}>Type</label>
        <select style={st.select} value={v.type} onChange={(e) => set('type', e.target.value)}>
          <option value="">—</option>
          <option value="Open">Open</option>
          <option value="Covered">Covered</option>
        </select>
      </div>
      <div style={st.field}>
        <label style={st.label}>Power</label>
        <select style={st.select} value={v.power} onChange={(e) => set('power', e.target.value)}>
          <option value="">—</option>
          <option value="30A">30A</option>
          <option value="50A">50A</option>
          <option value="30A/50A">30A/50A</option>
          <option value="50A/100A">50A/100A</option>
        </select>
      </div>
      <div style={st.field}>
        <label style={st.label}>Electricity Mode</label>
        <select style={st.select} value={v.electricityMode} onChange={(e) => set('electricityMode', e.target.value)}>
          <option value="Metered">Metered</option>
          <option value="Flat Fee">Flat Fee</option>
        </select>
      </div>
      {showStatus && (
        <div style={st.field}>
          <label style={st.label}>Status</label>
          <select style={st.select} value={v.status} onChange={(e) => set('status', e.target.value)}>
            <option value="Vacant">Vacant</option>
            <option value="Reserved">Reserved</option>
            <option value="Maintenance">Maintenance</option>
            {v.status === 'Occupied' && <option value="Occupied">Occupied (set by contract)</option>}
          </select>
        </div>
      )}
    </div>
  );
}

function AddSlipModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const client = useApiClient();
  const [v, setV] = useState<Record<string, string>>({ number: '', dock: '', length: '', beam: '', draft: '', type: '', power: '', electricityMode: 'Metered' });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleSave = async () => {
    if (!v.number.trim() || !(Number(v.length) > 0)) { setError('Slip number and a length greater than 0 are required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await client.post('/slips', slipPayload(v as Parameters<typeof slipPayload>[0]));
      onSaved();
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
          <h2 style={st.modalTitle}>Add Slip</h2>
          <button style={st.closeBtn} onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          {error && <div style={{ marginBottom: 12 }}><InlineError message={error} /></div>}
          <SlipFormFields v={v} set={set} />
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Slip'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Edit Slip Modal ────────────────────────────────────── */

function EditSlipModal({ slip, onClose, onSaved }: {
  slip: Slip;
  onClose: () => void;
  onSaved: () => void;
}) {
  const client = useApiClient();
  const [v, setV] = useState<Record<string, string>>({
    number: slip.number, dock: slip.dock, length: String(slip.length), beam: slip.beam ? String(slip.beam) : '',
    draft: slip.draft ? String(slip.draft) : '', type: slip.type, power: slip.power, electricityMode: slip.electricityMode,
    status: slip.status,
  });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!v.number.trim() || !(Number(v.length) > 0)) { setError('Slip number and a length greater than 0 are required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await client.put(`/slips/${slip.id}`, {
        ...slipPayload(v as Parameters<typeof slipPayload>[0]),
        ...(v.status !== slip.status ? { status: STATUS_ENUM[v.status as SlipStatus] } : {}),
      });
      onSaved();
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
          <h2 style={st.modalTitle}>Edit Slip {slip.number}</h2>
          <button style={st.closeBtn} onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          {error && <div style={{ marginBottom: 12 }}><InlineError message={error} /></div>}
          <SlipFormFields v={v} set={set} showStatus />
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Slips() {
  const toast = useToast();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState<Slip | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const client = useApiClient();
  const navigate = useNavigate();

  const list = useList<Slip, SlipDTO>('/slips?take=200', { map: toSlip });
  const slips = list.items;

  const filtered = slips.filter((sl) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      sl.number.toLowerCase().includes(q) ||
      sl.dock.toLowerCase().includes(q) ||
      sl.occupant.toLowerCase().includes(q)
    );
  });

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Slips</h1>
      <hr style={st.divider} />

      {actionError && <div style={{ marginBottom: 16 }}><InlineError message={actionError} /></div>}
      {list.loading && <LoadingState label="Loading slips…" />}
      {list.error && <ErrorState title="Could not load slips" message={list.error} onRetry={list.refetch} />}

      {/* Filter Bar */}
      <div style={st.filterBar} className="helm-filter-bar">
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
      {!list.loading && !list.error && view === 'list' && (
        <div style={st.tableWrap} className="helm-table-wrap">
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Slip #</th>
                <th style={st.th}>Dock</th>
                <th style={st.th}>Length</th>
                <th style={st.th}>Beam</th>
                <th style={st.th}>Depth</th>
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
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{sl.dock || '—'}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{sl.length}'</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{sl.beam ? `${sl.beam}'` : '—'}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{sl.draft ? `${sl.draft}'` : '—'}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{sl.type || '—'}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{sl.power || '—'}</td>
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
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748B', fontSize: 14 }}>{slips.length === 0 ? 'No slips set up yet. Add your first slip.' : 'No slips match your search.'}</div>
          )}
        </div>
      )}

      {/* Dock Map View */}
      {!list.loading && !list.error && view === 'map' && (
        <DockMapSVG
          slips={filtered.map((sl) => ({
            id: sl.id,
            number: sl.number,
            dock: sl.dock,
            length: sl.length,
            beam: sl.beam,
            status: sl.status,
            occupant: sl.occupant || undefined,
            compliance: sl.compliance,
          }))}
          onSlipClick={(slipId) => {
            const slip = slips.find((s) => s.id === slipId);
            if (slip) setSelectedSlip(slip);
          }}
          selectedSlipId={selectedSlip?.id}
        />
      )}

      {/* Add Slip Modal */}
      {showAdd && <AddSlipModal onClose={() => setShowAdd(false)} onSaved={() => { toast.success('Slip added'); list.refetch(); }} />}

      {/* Slip Detail Panel */}
      {selectedSlip && (
        <SlipDetailPanel
          slip={{
            id: selectedSlip.id,
            number: selectedSlip.number,
            dock: selectedSlip.dock,
            length: selectedSlip.length,
            beam: selectedSlip.beam,
            draft: selectedSlip.draft,
            height: selectedSlip.height,
            power: selectedSlip.power,
            type: selectedSlip.type,
            electricityMode: selectedSlip.electricityMode,
            status: selectedSlip.status,
            occupant: selectedSlip.occupantDetail,
            meterReadings: selectedSlip.meterReadings,
          }}
          onClose={() => setSelectedSlip(null)}
          onEdit={() => setShowEditModal(true)}
          onAssign={() => {
            // Slips are occupied through a contract; assigning here used to set
            // OCCUPIED without creating one.
            toast.info('Assign with a contract', `Create a contract for slip ${selectedSlip.number} on the Contracts page.`);
            navigate('/contracts');
          }}
          onMaintenance={() => {
            const slip = selectedSlip;
            toast.confirm('Maintenance Mode', `Mark slip ${slip.number} as under maintenance?`, async () => {
              setActionError(null);
              try {
                await client.put(`/slips/${slip.id}`, { status: 'MAINTENANCE' });
                toast.success(`Slip ${slip.number} marked as under maintenance`);
                setSelectedSlip(null);
                list.refetch();
              } catch (err) {
                setActionError(errorMessage(err));
              }
            });
          }}
        />
      )}

      {showEditModal && selectedSlip && (
        <EditSlipModal
          slip={selectedSlip}
          onClose={() => setShowEditModal(false)}
          onSaved={() => {
            toast.success(`Slip ${selectedSlip.number} updated`);
            setSelectedSlip(null);
            list.refetch();
          }}
        />
      )}
    </div>
  );
}
