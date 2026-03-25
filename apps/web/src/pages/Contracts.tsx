import React, { useState } from 'react';
import { FileText, Search, Plus, X, Calendar, ToggleLeft, ToggleRight } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type ContractStatus = 'Draft' | 'Active' | 'Expiring' | 'Expired' | 'Terminated' | 'Renewed';

interface Contract {
  id: string;
  number: string;
  customer: string;
  slip: string;
  rate: number;
  billingCycle: string;
  start: string;
  end: string;
  status: ContractStatus;
  boat: string;
  securityDeposit: number;
  autoRenew: boolean;
}

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_CONTRACTS: Contract[] = [
  { id: '1', number: 'CTR-001', customer: 'James Harborview', slip: 'A-01', rate: 850, billingCycle: 'Monthly', start: '2024-03-15', end: '2025-03-14', status: 'Active', boat: 'Sea Spirit', securityDeposit: 1700, autoRenew: true },
  { id: '2', number: 'CTR-002', customer: 'Maria Seabreeze', slip: 'A-02', rate: 750, billingCycle: 'Monthly', start: '2024-06-01', end: '2025-05-31', status: 'Active', boat: 'Coastal Dream', securityDeposit: 1500, autoRenew: true },
  { id: '3', number: 'CTR-003', customer: 'David Tidewater', slip: 'B-01', rate: 1200, billingCycle: 'Monthly', start: '2024-01-05', end: '2025-01-04', status: 'Expired', boat: 'Tidewater Express', securityDeposit: 2400, autoRenew: false },
  { id: '4', number: 'CTR-004', customer: 'Elena Windward', slip: 'C-01', rate: 3000, billingCycle: 'Seasonal', start: '2025-04-01', end: '2025-10-31', status: 'Active', boat: 'Windward', securityDeposit: 1500, autoRenew: false },
  { id: '5', number: 'CTR-005', customer: 'Robert Dockside', slip: 'A-04', rate: 700, billingCycle: 'Monthly', start: '2025-05-01', end: '2026-04-30', status: 'Draft', boat: 'Dock Runner', securityDeposit: 1400, autoRenew: true },
  { id: '6', number: 'CTR-006', customer: 'James Harborview', slip: 'A-01', rate: 900, billingCycle: 'Monthly', start: '2025-03-15', end: '2026-03-14', status: 'Renewed', boat: 'Sea Spirit', securityDeposit: 1700, autoRenew: true },
  { id: '7', number: 'CTR-007', customer: 'Susan Baywatch', slip: 'B-03', rate: 950, billingCycle: 'Monthly', start: '2023-11-10', end: '2024-11-09', status: 'Terminated', boat: 'Bay Cruiser', securityDeposit: 1900, autoRenew: false },
];

/* ── Styles ─────────────────────────────────────────────── */

const statusColors: Record<ContractStatus, { bg: string; color: string; border?: string }> = {
  Draft: { bg: '#F2F4F6', color: '#64748B' },
  Active: { bg: '#E8F5E9', color: '#1B5E20' },
  Expiring: { bg: '#FFF3CD', color: '#856404' },
  Expired: { bg: '#FDECEA', color: '#B71C1C' },
  Terminated: { bg: '#FFFFFF', color: '#B71C1C', border: '#B71C1C' },
  Renewed: { bg: '#0A2342', color: '#FFFFFF' },
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
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    background: '#FFFFFF',
    cursor: 'pointer',
    minWidth: '140px',
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
  emptyState: {
    maxWidth: '480px',
    margin: '0 auto',
    textAlign: 'center' as const,
    padding: '48px 32px',
    background: '#FFFFFF',
    borderRadius: '12px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
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
    width: '640px',
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
  formSelect: {
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
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    userSelect: 'none' as const,
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

/* ── Contract Form Modal ─────────────────────────────────── */

function ContractFormModal({ onClose }: { onClose: () => void }) {
  const [autoRenew, setAutoRenew] = useState(false);

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>New Contract</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.twoCol}>
            <div style={st.field}>
              <label style={st.label}>Customer *</label>
              <select style={st.formSelect}>
                <option value="">Select customer...</option>
                <option value="1">James Harborview</option>
                <option value="2">Maria Seabreeze</option>
                <option value="3">Robert Dockside</option>
                <option value="4">Susan Baywatch</option>
                <option value="5">David Tidewater</option>
                <option value="6">Elena Windward</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Slip *</label>
              <select style={st.formSelect}>
                <option value="">Select slip...</option>
                <option value="A-01">A-01</option>
                <option value="A-02">A-02</option>
                <option value="A-03">A-03 (Vacant)</option>
                <option value="A-04">A-04 (Reserved)</option>
                <option value="B-01">B-01</option>
                <option value="B-02">B-02 (Maintenance)</option>
                <option value="B-03">B-03 (Vacant)</option>
                <option value="C-01">C-01</option>
                <option value="C-02">C-02 (Vacant)</option>
                <option value="C-03">C-03 (Vacant)</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Boat *</label>
              <select style={st.formSelect}>
                <option value="">Select boat...</option>
                <option value="1">Sea Spirit (38' Sailboat)</option>
                <option value="2">Wave Runner III (28' Powerboat)</option>
                <option value="3">Coastal Dream (32' Powerboat)</option>
                <option value="4">Dock Runner (25' Runabout)</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Billing Cycle *</label>
              <select style={st.formSelect}>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Semi-Annual">Semi-Annual</option>
                <option value="Annual">Annual</option>
                <option value="Seasonal">Seasonal</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Start Date *</label>
              <input style={st.input} type="date" />
            </div>
            <div style={st.field}>
              <label style={st.label}>End Date *</label>
              <input style={st.input} type="date" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Rate *</label>
              <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" placeholder="0.00" step="0.01" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Security Deposit</label>
              <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" placeholder="0.00" step="0.01" />
            </div>
          </div>
          <div style={{ marginTop: '8px' }}>
            <div
              style={st.toggleRow}
              onClick={() => setAutoRenew(!autoRenew)}
            >
              {autoRenew ? (
                <ToggleRight size={24} style={{ color: '#00D4FF' }} />
              ) : (
                <ToggleLeft size={24} style={{ color: '#CCC' }} />
              )}
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Auto-Renew</span>
            </div>
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={onClose}>Create Contract</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────── */

export default function Contracts() {
  const [statusFilter, setStatusFilter] = useState('All');
  const [cycleFilter, setCycleFilter] = useState('All');
  const [expiringFilter, setExpiringFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const now = new Date();
  const filtered = MOCK_CONTRACTS.filter((c) => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false;
    if (cycleFilter !== 'All' && c.billingCycle !== cycleFilter) return false;
    if (expiringFilter !== 'All') {
      const days = parseInt(expiringFilter);
      const end = new Date(c.end);
      const diff = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (diff < 0 || diff > days) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const match =
        c.number.toLowerCase().includes(q) ||
        c.customer.toLowerCase().includes(q) ||
        c.slip.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });

  return (
    <div style={st.page}>
      <h1 style={st.title}>Contracts</h1>
      <hr style={st.divider} />

      {/* Filter Bar */}
      <div style={st.filterBar}>
        <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          <option value="Draft">Draft</option>
          <option value="Active">Active</option>
          <option value="Expiring">Expiring</option>
          <option value="Expired">Expired</option>
          <option value="Terminated">Terminated</option>
          <option value="Renewed">Renewed</option>
        </select>

        <select style={st.select} value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)}>
          <option value="All">All Cycles</option>
          <option value="Monthly">Monthly</option>
          <option value="Quarterly">Quarterly</option>
          <option value="Semi-Annual">Semi-Annual</option>
          <option value="Annual">Annual</option>
          <option value="Seasonal">Seasonal</option>
        </select>

        <select style={st.select} value={expiringFilter} onChange={(e) => setExpiringFilter(e.target.value)}>
          <option value="All">Expiring Within</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>

        <div style={st.searchWrap}>
          <Search size={16} style={st.searchIcon} />
          <input
            style={st.searchInput}
            placeholder="Search contract #, customer, or slip..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button style={st.addButton} onClick={() => setShowForm(true)}>
          <Plus size={16} /> New Contract
        </button>
      </div>

      {/* Data Table */}
      {filtered.length > 0 ? (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Contract #</th>
                <th style={st.th}>Customer</th>
                <th style={st.th}>Slip</th>
                <th style={st.th}>Rate</th>
                <th style={st.th}>Billing</th>
                <th style={st.th}>Start</th>
                <th style={st.th}>End</th>
                <th style={st.th}>Status</th>
                <th style={st.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => {
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                const sc = statusColors[c.status];
                return (
                  <tr key={c.id}>
                    <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600, ...st.mono }}>{c.number}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{c.customer}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{c.slip}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{fmt(c.rate)}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>{c.billingCycle}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, color: '#64748B' }}>{c.start}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, color: '#64748B' }}>{c.end}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>
                      <span
                        style={{
                          ...st.badge,
                          backgroundColor: sc.bg,
                          color: sc.color,
                          border: sc.border ? `1px solid ${sc.border}` : 'none',
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>
                      <button
                        style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={st.emptyState}>
          <FileText size={32} style={{ marginBottom: '16px', color: '#2E4A6B' }} />
          <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#0A2342', margin: '0 0 8px 0' }}>
            No contracts found
          </h3>
          <p style={{ fontSize: '15px', color: '#64748B', lineHeight: 1.6, margin: '0 0 24px 0' }}>
            {search || statusFilter !== 'All'
              ? 'Try adjusting your filters or search terms.'
              : 'Create a slip contract to start billing a customer.'}
          </p>
          <button style={st.addButton} onClick={() => setShowForm(true)}>
            <Plus size={16} /> New Contract
          </button>
        </div>
      )}

      {showForm && <ContractFormModal onClose={() => setShowForm(false)} />}
    </div>
  );
}
