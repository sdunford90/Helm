import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, List, LayoutGrid, X,
} from 'lucide-react';
import SlipDetailPanel from '../components/SlipDetailPanel';
import DockMapSVG from '../components/DockMapSVG';
import { useApi } from '../hooks/useApi';

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

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_SLIPS: Slip[] = [
  { id: '1', number: 'A-01', dock: 'A', length: 40, beam: 14, draft: 8, height: 20, type: 'Covered', power: '30A/50A', electricityMode: 'Metered', status: 'Occupied', occupant: 'James Harborview', compliance: 95, occupantDetail: { name: 'James Harborview', boat: 'Sea Spirit (38\' Sailboat)', contractStart: '2024-03-15', contractEnd: '2025-03-14' }, meterReadings: [{ date: '2025-03-01', kWh: 1240, amount: 148.80 }, { date: '2025-02-01', kWh: 1080, amount: 129.60 }, { date: '2025-01-01', kWh: 920, amount: 110.40 }] },
  { id: '2', number: 'A-02', dock: 'A', length: 40, beam: 14, draft: 8, height: 20, type: 'Covered', power: '30A', electricityMode: 'Flat Rate', status: 'Occupied', occupant: 'Maria Seabreeze', compliance: 88, occupantDetail: { name: 'Maria Seabreeze', boat: 'Coastal Dream (32\' Powerboat)', contractStart: '2024-06-01', contractEnd: '2025-05-31' }, meterReadings: [{ date: '2025-03-01', kWh: 800, amount: 75.00 }] },
  { id: '3', number: 'A-03', dock: 'A', length: 35, beam: 12, draft: 7, height: 18, type: 'Open', power: '30A', electricityMode: 'Metered', status: 'Vacant', occupant: '', compliance: 0, meterReadings: [] },
  { id: '4', number: 'A-04', dock: 'A', length: 35, beam: 12, draft: 7, height: 18, type: 'Open', power: '30A', electricityMode: 'Metered', status: 'Reserved', occupant: 'Robert Dockside (pending)', compliance: 0, meterReadings: [] },
  { id: '5', number: 'B-01', dock: 'B', length: 50, beam: 16, draft: 10, height: 25, type: 'Covered', power: '50A/100A', electricityMode: 'Metered', status: 'Occupied', occupant: 'David Tidewater', compliance: 62, occupantDetail: { name: 'David Tidewater', boat: 'Tidewater Express (48\' Yacht)', contractStart: '2024-01-05', contractEnd: '2025-01-04' }, meterReadings: [{ date: '2025-03-01', kWh: 2100, amount: 252.00 }, { date: '2025-02-01', kWh: 1950, amount: 234.00 }] },
  { id: '6', number: 'B-02', dock: 'B', length: 50, beam: 16, draft: 10, height: 25, type: 'Covered', power: '50A', electricityMode: 'Flat Rate', status: 'Maintenance', occupant: '', compliance: 0, meterReadings: [] },
  { id: '7', number: 'B-03', dock: 'B', length: 45, beam: 14, draft: 9, height: 22, type: 'Open', power: '30A/50A', electricityMode: 'Metered', status: 'Vacant', occupant: '', compliance: 0, meterReadings: [] },
  { id: '8', number: 'C-01', dock: 'C', length: 30, beam: 10, draft: 6, height: 15, type: 'Open', power: '30A', electricityMode: 'Flat Rate', status: 'Occupied', occupant: 'Elena Windward', compliance: 91, occupantDetail: { name: 'Elena Windward', boat: 'Windward (28\' Sailboat)', contractStart: '2025-04-01', contractEnd: '2025-10-31' }, meterReadings: [] },
  { id: '9', number: 'C-02', dock: 'C', length: 30, beam: 10, draft: 6, height: 15, type: 'Open', power: '30A', electricityMode: 'Metered', status: 'Vacant', occupant: '', compliance: 0, meterReadings: [] },
  { id: '10', number: 'C-03', dock: 'C', length: 30, beam: 10, draft: 6, height: 15, type: 'Open', power: '30A', electricityMode: 'Metered', status: 'Vacant', occupant: '', compliance: 0, meterReadings: [] },
];

/* ── Styles ─────────────────────────────────────────────── */

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

function AddSlipModal({ onClose, onSave }: { onClose: () => void; onSave?: (data: Record<string, unknown>) => void }) {
  const [saved, setSaved] = useState(false);
  const handleSave = () => {
    if (onSave) onSave({});
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1500);
  };
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Add Slip</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        {saved && <div style={{ padding: '12px 32px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', textAlign: 'center' }}>Slip saved successfully!</div>}
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
              <label style={st.label}>Beam (ft)</label>
              <input style={st.input} type="number" placeholder="14" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Draft (ft)</label>
              <input style={st.input} type="number" placeholder="8" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Height (ft)</label>
              <input style={st.input} type="number" placeholder="20" />
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
          <button style={st.saveBtn} onClick={handleSave}>Save Slip</button>
        </div>
      </div>
    </div>
  );
}

/* ── Assign Slip Modal ──────────────────────────────────── */

interface Customer { id: string; firstName: string; lastName: string; company: string | null; email: string; }

function AssignSlipModal({ slip, onClose, onAssigned }: {
  slip: Slip;
  onClose: () => void;
  onAssigned: (slipId: string, occupantName: string) => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [contractType, setContractType] = useState<'Annual' | 'Monthly' | 'Transient'>('Annual');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    fetch('/api/customers?limit=200')
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((res) => { setCustomers(res.data || res || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = customers.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.firstName?.toLowerCase().includes(q) ||
      c.lastName?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  });

  const displayName = (c: Customer) =>
    c.company ? `${c.company} (${c.firstName} ${c.lastName})` : `${c.firstName} ${c.lastName}`;

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 6,
    fontSize: 13, color: '#0A2342', background: '#F8FAFC', boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 4, display: 'block' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
      onClick={onClose}>
      <div style={{ background: '#FFF', borderRadius: 12, padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0A2342' }}>Assign Slip {slip.number}</h3>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{slip.dock} · {slip.length}' L × {slip.beam}' Bm × {slip.draft}' Dr × {slip.height}' Ht</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        {/* Customer Search */}
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Select Customer *</label>
          {selected ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(0,212,255,0.08)', border: '1px solid #00D4FF', borderRadius: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0A2342' }}>{displayName(selected)}</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>{selected.email}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <>
              <input style={inp} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, company, or email…" autoFocus />
              {loading && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>Loading customers…</div>}
              {!loading && search && (
                <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, marginTop: 4, maxHeight: 180, overflowY: 'auto', background: '#FFF', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                  {filtered.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: 13, color: '#94A3B8' }}>No customers found</div>
                  ) : filtered.slice(0, 8).map((c) => (
                    <div key={c.id} onClick={() => { setSelected(c); setSearch(''); }} style={{
                      padding: '10px 14px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F1F5F9',
                      color: '#0A2342',
                    }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#F1F5F9'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#FFF'; }}>
                      <div style={{ fontWeight: 600 }}>{displayName(c)}</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>{c.email}</div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => navigate('/customers')} style={{ marginTop: 8, background: 'none', border: 'none', color: '#00D4FF', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                + Add a new customer first
              </button>
            </>
          )}
        </div>

        {/* Contract Type */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={lbl}>Contract Type</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={contractType} onChange={(e) => setContractType(e.target.value as typeof contractType)}>
              <option value="Annual">Annual</option>
              <option value="Monthly">Monthly</option>
              <option value="Transient">Transient / Daily</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Start Date</label>
            <input type="date" style={inp} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>{contractType === 'Transient' ? 'Daily Rate ($)' : 'Monthly Rate ($)'}</label>
          <input style={inp} type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 450.00" />
        </div>

        <div style={{ padding: '12px 14px', background: '#FFF8EE', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, marginBottom: 20, fontSize: 13, color: '#78350F', lineHeight: 1.5 }}>
          This will mark the slip as <strong>Occupied</strong> and create a draft contract in Contracts. You can complete all contract terms there.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', border: '1px solid #E2E8F0', borderRadius: 6, background: 'none', color: '#64748B', cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
          <button
            disabled={!selected || saving}
            onClick={async () => {
              if (!selected) return;
              setSaving(true);
              try {
                await fetch(`/api/slips/${slip.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'OCCUPIED' }),
                });
              } catch { /* best-effort */ }
              const name = displayName(selected);
              onAssigned(slip.id, name);
              onClose();
            }}
            style={{
              padding: '9px 20px', background: '#0A2342', border: 'none', borderRadius: 6,
              color: '#FFF', fontWeight: 600, cursor: selected && !saving ? 'pointer' : 'not-allowed',
              fontSize: 13, opacity: selected ? 1 : 0.5,
            }}
          >{saving ? 'Saving…' : 'Assign Slip'}</button>
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
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const showAction = (msg: string) => { setActionMsg(msg); setTimeout(() => setActionMsg(null), 2000); };
  const [showAssignModal, setShowAssignModal] = useState(false);

  const { data: apiSlips, loading, error } = useApi<Slip[]>('get', '/api/slips', { immediate: true });
  const createSlip = useApi<Slip>('post', '/api/slips');
  const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<Slip>>>({});

  const slips = (apiSlips || MOCK_SLIPS).map((s) => ({ ...s, ...localOverrides[s.id] }));

  const updateSlipLocally = (id: string, patch: Partial<Slip>) => {
    setLocalOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

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
      <h1 style={st.title}>Slips</h1>
      <hr style={st.divider} />

      {actionMsg && <div style={{ padding: '12px 24px', marginBottom: '16px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', borderRadius: '8px', textAlign: 'center' }}>{actionMsg}</div>}

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading slips...</div>}

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
                <th style={st.th}>Length</th>
                <th style={st.th}>Beam</th>
                <th style={st.th}>Draft</th>
                <th style={st.th}>Height</th>
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
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{sl.length}'</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{sl.beam}'</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{sl.draft}'</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{sl.height}'</td>
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
      {showAdd && <AddSlipModal onClose={() => setShowAdd(false)} onSave={(data) => createSlip.execute(data)} />}

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
          onEdit={() => {
            window.alert(`Edit slip ${selectedSlip.number} — full slip editing coming soon.`);
          }}
          onAssign={() => {
            if (selectedSlip.status !== 'Vacant' && selectedSlip.status !== 'Reserved') {
              window.alert(`Slip ${selectedSlip.number} is currently ${selectedSlip.status}. Set it to Vacant first to re-assign.`);
            } else {
              setShowAssignModal(true);
            }
          }}
          onMaintenance={() => {
            const ok = window.confirm(`Mark slip ${selectedSlip.number} as under maintenance?`);
            if (ok) {
              updateSlipLocally(selectedSlip.id, { status: 'Maintenance' });
              setSelectedSlip(null);
            }
          }}
        />
      )}

      {showAssignModal && selectedSlip && (
        <AssignSlipModal
          slip={selectedSlip}
          onClose={() => setShowAssignModal(false)}
          onAssigned={(slipId, occupantName) => {
            updateSlipLocally(slipId, { status: 'Occupied', occupant: occupantName });
            setShowAssignModal(false);
            setSelectedSlip(null);
          }}
        />
      )}
    </div>
  );
}
