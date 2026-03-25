import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  FileSpreadsheet, Search, Download, DollarSign,
  Anchor, Users, ShieldCheck, Clock, ChevronDown,
  ChevronUp, AlertTriangle, RefreshCw,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

interface RentRollEntry {
  id: string;
  slipNumber: string;
  dock: string;
  tenantName: string;
  boatName: string;
  boatLength: number;
  contractStart: string;
  contractEnd: string;
  billingCycle: string;
  monthlyRate: number;
  annualRate: number;
  electricityMode: string;
  electricityCharge: number;
  depositHeld: number;
  balance: number;
  status: 'Active' | 'Expiring' | 'Expired' | 'Vacant';
  autoRenew: boolean;
  daysLeft: number;
  lastPaymentDate: string;
  lastPaymentAmount: number;
}

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_RENT_ROLL: RentRollEntry[] = [
  { id: '1', slipNumber: 'A-01', dock: 'A', tenantName: 'James Harborview', boatName: 'Sea Spirit', boatLength: 38, contractStart: '2024-03-15', contractEnd: '2025-03-14', billingCycle: 'Monthly', monthlyRate: 2450, annualRate: 29400, electricityMode: 'Metered', electricityCharge: 148, depositHeld: 2450, balance: 0, status: 'Active', autoRenew: true, daysLeft: 354, lastPaymentDate: '2026-03-01', lastPaymentAmount: 2598 },
  { id: '2', slipNumber: 'A-02', dock: 'A', tenantName: 'Maria Seabreeze', boatName: 'Coastal Dream', boatLength: 32, contractStart: '2024-06-01', contractEnd: '2025-05-31', billingCycle: 'Monthly', monthlyRate: 1950, annualRate: 23400, electricityMode: 'Flat Rate', electricityCharge: 75, depositHeld: 1950, balance: 0, status: 'Active', autoRenew: true, daysLeft: 432, lastPaymentDate: '2026-03-01', lastPaymentAmount: 2025 },
  { id: '3', slipNumber: 'A-03', dock: 'A', tenantName: '', boatName: '', boatLength: 0, contractStart: '', contractEnd: '', billingCycle: '', monthlyRate: 0, annualRate: 0, electricityMode: '', electricityCharge: 0, depositHeld: 0, balance: 0, status: 'Vacant', autoRenew: false, daysLeft: 0, lastPaymentDate: '', lastPaymentAmount: 0 },
  { id: '4', slipNumber: 'A-04', dock: 'A', tenantName: 'Robert Dockside', boatName: 'Harbor Light', boatLength: 28, contractStart: '2025-11-01', contractEnd: '2026-04-30', billingCycle: 'Monthly', monthlyRate: 1650, annualRate: 19800, electricityMode: 'Metered', electricityCharge: 92, depositHeld: 1650, balance: 1742, status: 'Expiring', autoRenew: false, daysLeft: 36, lastPaymentDate: '2026-02-01', lastPaymentAmount: 1742 },
  { id: '5', slipNumber: 'A-05', dock: 'A', tenantName: 'Tom Seaside', boatName: 'Mariner II', boatLength: 35, contractStart: '2025-01-01', contractEnd: '2026-12-31', billingCycle: 'Quarterly', monthlyRate: 2200, annualRate: 26400, electricityMode: 'Metered', electricityCharge: 125, depositHeld: 2200, balance: 0, status: 'Active', autoRenew: true, daysLeft: 646, lastPaymentDate: '2026-01-01', lastPaymentAmount: 6975 },
  { id: '6', slipNumber: 'B-01', dock: 'B', tenantName: 'David Tidewater', boatName: 'Tidewater Express', boatLength: 48, contractStart: '2024-01-05', contractEnd: '2027-01-04', billingCycle: 'Annual', monthlyRate: 4200, annualRate: 50400, electricityMode: 'Metered', electricityCharge: 252, depositHeld: 4200, balance: 0, status: 'Active', autoRenew: true, daysLeft: 650, lastPaymentDate: '2026-01-05', lastPaymentAmount: 50400 },
  { id: '7', slipNumber: 'B-02', dock: 'B', tenantName: '', boatName: '', boatLength: 0, contractStart: '', contractEnd: '', billingCycle: '', monthlyRate: 0, annualRate: 0, electricityMode: '', electricityCharge: 0, depositHeld: 0, balance: 0, status: 'Vacant', autoRenew: false, daysLeft: 0, lastPaymentDate: '', lastPaymentAmount: 0 },
  { id: '8', slipNumber: 'B-03', dock: 'B', tenantName: 'Coastal Charters LLC', boatName: 'Charter One', boatLength: 45, contractStart: '2025-06-01', contractEnd: '2026-05-31', billingCycle: 'Monthly', monthlyRate: 3800, annualRate: 45600, electricityMode: 'Flat Rate', electricityCharge: 150, depositHeld: 3800, balance: 3950, status: 'Active', autoRenew: true, daysLeft: 432, lastPaymentDate: '2026-02-01', lastPaymentAmount: 3950 },
  { id: '9', slipNumber: 'B-04', dock: 'B', tenantName: 'Blue Water Excursions', boatName: 'Blue Wave', boatLength: 52, contractStart: '2025-03-01', contractEnd: '2026-02-28', billingCycle: 'Monthly', monthlyRate: 4500, annualRate: 54000, electricityMode: 'Metered', electricityCharge: 310, depositHeld: 4500, balance: 0, status: 'Expired', autoRenew: false, daysLeft: -25, lastPaymentDate: '2026-02-01', lastPaymentAmount: 4810 },
  { id: '10', slipNumber: 'C-01', dock: 'C', tenantName: 'Elena Windward', boatName: 'Windward', boatLength: 28, contractStart: '2025-04-01', contractEnd: '2025-10-31', billingCycle: 'Monthly', monthlyRate: 1200, annualRate: 14400, electricityMode: 'Flat Rate', electricityCharge: 50, depositHeld: 1200, balance: 0, status: 'Active', autoRenew: false, daysLeft: 220, lastPaymentDate: '2026-03-01', lastPaymentAmount: 1250 },
  { id: '11', slipNumber: 'C-02', dock: 'C', tenantName: 'Mike Anchorage', boatName: 'Bayrunner', boatLength: 26, contractStart: '2025-07-01', contractEnd: '2026-06-30', billingCycle: 'Monthly', monthlyRate: 1100, annualRate: 13200, electricityMode: 'Metered', electricityCharge: 68, depositHeld: 1100, balance: 0, status: 'Active', autoRenew: true, daysLeft: 462, lastPaymentDate: '2026-03-01', lastPaymentAmount: 1168 },
  { id: '12', slipNumber: 'C-03', dock: 'C', tenantName: '', boatName: '', boatLength: 0, contractStart: '', contractEnd: '', billingCycle: '', monthlyRate: 0, annualRate: 0, electricityMode: '', electricityCharge: 0, depositHeld: 0, balance: 0, status: 'Vacant', autoRenew: false, daysLeft: 0, lastPaymentDate: '', lastPaymentAmount: 0 },
  { id: '13', slipNumber: 'C-04', dock: 'C', tenantName: 'Lisa Bayfront', boatName: 'Sunset Chaser', boatLength: 30, contractStart: '2025-01-01', contractEnd: '2026-06-30', billingCycle: 'Quarterly', monthlyRate: 1350, annualRate: 16200, electricityMode: 'Metered', electricityCharge: 85, depositHeld: 1350, balance: 0, status: 'Active', autoRenew: true, daysLeft: 462, lastPaymentDate: '2026-01-01', lastPaymentAmount: 4305 },
  { id: '14', slipNumber: 'C-05', dock: 'C', tenantName: 'Amy Portview', boatName: 'Portside', boatLength: 24, contractStart: '2026-01-01', contractEnd: '2026-12-31', billingCycle: 'Monthly', monthlyRate: 950, annualRate: 11400, electricityMode: 'Flat Rate', electricityCharge: 40, depositHeld: 950, balance: 990, status: 'Active', autoRenew: false, daysLeft: 646, lastPaymentDate: '2026-02-01', lastPaymentAmount: 990 },
  { id: '15', slipNumber: 'C-06', dock: 'C', tenantName: 'Sarah Coastline', boatName: 'Tideline', boatLength: 22, contractStart: '2025-09-01', contractEnd: '2026-08-31', billingCycle: 'Monthly', monthlyRate: 850, annualRate: 10200, electricityMode: 'Metered', electricityCharge: 55, depositHeld: 850, balance: 0, status: 'Active', autoRenew: true, daysLeft: 524, lastPaymentDate: '2026-03-01', lastPaymentAmount: 905 },
];

/* ── Styles ─────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px', marginBottom: '28px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '22px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '12px', color: '#2E4A6B', marginTop: '2px' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, flex: 1, minWidth: '200px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  exportBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px', minWidth: '1400px' },
  th: { textAlign: 'left' as const, padding: '10px 12px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF', whiteSpace: 'nowrap' as const },
  td: { padding: '10px 12px', color: '#0A2342', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '13px' },
  badge: { display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px' },
  footerRow: { fontWeight: 700, backgroundColor: '#F1F5F9' },
  expandBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#00D4FF', padding: '2px' },
};

const statusColors: Record<string, { bg: string; color: string }> = {
  Active: { bg: '#DEF7EC', color: '#03543F' },
  Expiring: { bg: '#FFF3CD', color: '#856404' },
  Expired: { bg: '#FDE8E8', color: '#9B1C1C' },
  Vacant: { bg: '#F3F4F6', color: '#64748B' },
};

/* ── Component ─────────────────────────────────────────── */

export default function RentRoll() {
  const [search, setSearch] = useState('');
  const [dockFilter, setDockFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: apiData } = useApi<RentRollEntry[]>('get', '/api/reports/rent-roll', { immediate: true });
  const entries = apiData || MOCK_RENT_ROLL;

  const filtered = entries.filter((e) => {
    if (dockFilter !== 'All' && e.dock !== dockFilter) return false;
    if (statusFilter !== 'All' && e.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.slipNumber.toLowerCase().includes(q) || e.tenantName.toLowerCase().includes(q) || e.boatName.toLowerCase().includes(q);
    }
    return true;
  });

  const occupied = entries.filter((e) => e.status !== 'Vacant');
  const totalMonthly = occupied.reduce((s, e) => s + e.monthlyRate, 0);
  const totalAnnual = occupied.reduce((s, e) => s + e.annualRate, 0);
  const totalDeposits = occupied.reduce((s, e) => s + e.depositHeld, 0);
  const totalBalance = entries.reduce((s, e) => s + e.balance, 0);
  const expiring30 = entries.filter((e) => e.status === 'Expiring' || (e.daysLeft > 0 && e.daysLeft <= 30)).length;
  const vacantCount = entries.filter((e) => e.status === 'Vacant').length;

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });

  return (
    <div style={st.page}>
      <h1 style={st.title}>Rent Roll</h1>
      <hr style={st.divider} />

      <div style={st.statsRow}>
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Total Monthly Rent</div>
          <div style={st.statValue}>{fmt(totalMonthly)}</div>
          <div style={st.statSub}>{occupied.length} active contracts</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Annualized Revenue</div>
          <div style={st.statValue}>{fmt(totalAnnual)}</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Occupancy</div>
          <div style={st.statValue}>{entries.length > 0 ? Math.round((occupied.length / entries.length) * 100) : 0}%</div>
          <div style={st.statSub}>{occupied.length}/{entries.length} slips</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Deposits Held</div>
          <div style={st.statValue}>{fmt(totalDeposits)}</div>
        </div>
        <div style={{ ...st.statCard, borderTop: expiring30 > 0 ? '3px solid #F59E0B' : undefined }}>
          <div style={st.statLabel}>Expiring 30 Days</div>
          <div style={{ ...st.statValue, color: expiring30 > 0 ? '#856404' : '#0A2342' }}>{expiring30}</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Vacant Slips</div>
          <div style={st.statValue}>{vacantCount}</div>
        </div>
      </div>

      <div style={st.filterBar}>
        <div style={st.searchWrap}>
          <Search size={16} style={st.searchIcon} />
          <input style={st.searchInput} placeholder="Search tenant, slip, boat..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select style={st.select} value={dockFilter} onChange={(e) => setDockFilter(e.target.value)}>
          <option value="All">All Docks</option>
          <option value="A">Dock A</option>
          <option value="B">Dock B</option>
          <option value="C">Dock C</option>
        </select>
        <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Expiring">Expiring</option>
          <option value="Expired">Expired</option>
          <option value="Vacant">Vacant</option>
        </select>
        <button style={st.exportBtn}><Download size={14} /> PDF</button>
        <button style={st.exportBtn}><Download size={14} /> CSV</button>
        <button style={st.exportBtn}><Download size={14} /> Excel</button>
      </div>

      <div style={st.tableWrap}>
        <table style={st.table}>
          <thead>
            <tr>
              <th style={st.th}></th>
              <th style={st.th}>Slip</th>
              <th style={st.th}>Dock</th>
              <th style={st.th}>Tenant</th>
              <th style={st.th}>Boat</th>
              <th style={st.th}>Contract Period</th>
              <th style={st.th}>Cycle</th>
              <th style={st.th}>Monthly</th>
              <th style={st.th}>Annual</th>
              <th style={st.th}>Electric</th>
              <th style={st.th}>Deposit</th>
              <th style={st.th}>Balance</th>
              <th style={st.th}>Status</th>
              <th style={st.th}>Auto</th>
              <th style={st.th}>Days Left</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, idx) => {
              const rowBg = e.status === 'Vacant' ? '#F9FAFB' : e.status === 'Expiring' ? '#FFFBEB' : idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
              const sc = statusColors[e.status];
              const isExpanded = expandedId === e.id;
              return (
                <React.Fragment key={e.id}>
                  <tr style={{ backgroundColor: rowBg, borderLeft: e.status === 'Vacant' ? '3px dashed #CBD5E1' : e.status === 'Expiring' ? '3px solid #F59E0B' : 'none' }}>
                    <td style={st.td}>
                      {e.status !== 'Vacant' && (
                        <button style={st.expandBtn} onClick={() => setExpandedId(isExpanded ? null : e.id)}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                    </td>
                    <td style={{ ...st.td, fontWeight: 700 }}>{e.slipNumber}</td>
                    <td style={st.td}>{e.dock}</td>
                    <td style={{ ...st.td, fontWeight: 600, color: e.status === 'Vacant' ? '#94A3B8' : '#0A2342' }}>{e.tenantName || '— Vacant —'}</td>
                    <td style={{ ...st.td, color: e.status === 'Vacant' ? '#94A3B8' : '#0A2342' }}>{e.boatName ? `${e.boatName} (${e.boatLength}')` : '—'}</td>
                    <td style={{ ...st.td, fontSize: '12px' }}>{e.contractStart && e.contractEnd ? `${e.contractStart} → ${e.contractEnd}` : '—'}</td>
                    <td style={st.td}>{e.billingCycle || '—'}</td>
                    <td style={{ ...st.td, ...st.mono, fontWeight: 600 }}>{e.monthlyRate > 0 ? fmt(e.monthlyRate) : '—'}</td>
                    <td style={{ ...st.td, ...st.mono }}>{e.annualRate > 0 ? fmt(e.annualRate) : '—'}</td>
                    <td style={{ ...st.td, ...st.mono, fontSize: '12px' }}>{e.electricityCharge > 0 ? `${fmt(e.electricityCharge)} (${e.electricityMode})` : '—'}</td>
                    <td style={{ ...st.td, ...st.mono }}>{e.depositHeld > 0 ? fmt(e.depositHeld) : '—'}</td>
                    <td style={{ ...st.td, ...st.mono, color: e.balance > 0 ? '#DC2626' : '#03543F', fontWeight: e.balance > 0 ? 700 : 400 }}>{e.balance > 0 ? fmt(e.balance) : '$0'}</td>
                    <td style={st.td}><span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{e.status}</span></td>
                    <td style={{ ...st.td, textAlign: 'center' }}>{e.status !== 'Vacant' ? (e.autoRenew ? '✓' : '—') : ''}</td>
                    <td style={{ ...st.td, ...st.mono, color: e.daysLeft <= 30 && e.daysLeft > 0 ? '#856404' : e.daysLeft < 0 ? '#DC2626' : '#0A2342' }}>{e.status !== 'Vacant' ? e.daysLeft : ''}</td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ backgroundColor: '#F8FAFC' }}>
                      <td colSpan={15} style={{ padding: '16px 24px 16px 48px', borderBottom: '2px solid #E2E8F0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', fontSize: '13px' }}>
                          <div><span style={{ color: '#64748B', fontWeight: 600 }}>Last Payment:</span> {e.lastPaymentDate} — {fmt(e.lastPaymentAmount)}</div>
                          <div><span style={{ color: '#64748B', fontWeight: 600 }}>Electricity Mode:</span> {e.electricityMode}</div>
                          <div><span style={{ color: '#64748B', fontWeight: 600 }}>Security Deposit:</span> {fmt(e.depositHeld)}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={st.footerRow}>
              <td colSpan={7} style={{ ...st.td, textAlign: 'right', fontWeight: 700 }}>TOTALS:</td>
              <td style={{ ...st.td, ...st.mono, fontWeight: 700 }}>{fmt(filtered.filter((e) => e.status !== 'Vacant').reduce((s, e) => s + e.monthlyRate, 0))}</td>
              <td style={{ ...st.td, ...st.mono, fontWeight: 700 }}>{fmt(filtered.filter((e) => e.status !== 'Vacant').reduce((s, e) => s + e.annualRate, 0))}</td>
              <td style={{ ...st.td, ...st.mono }}>{fmt(filtered.reduce((s, e) => s + e.electricityCharge, 0))}</td>
              <td style={{ ...st.td, ...st.mono }}>{fmt(filtered.reduce((s, e) => s + e.depositHeld, 0))}</td>
              <td style={{ ...st.td, ...st.mono, color: '#DC2626', fontWeight: 700 }}>{fmt(filtered.reduce((s, e) => s + e.balance, 0))}</td>
              <td colSpan={3} style={st.td}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
