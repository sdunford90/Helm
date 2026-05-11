import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  FileSpreadsheet, Search, Download, DollarSign,
  Anchor, Users, ShieldCheck, Clock, ChevronDown,
  ChevronUp, AlertTriangle, RefreshCw,
} from 'lucide-react';
import SubNav, { BILLING_SUBNAV } from '../components/SubNav';

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

/* ── Styles ─────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px', marginBottom: '28px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '22px', fontWeight: 700, color: '#0A2342', fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' },
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
  mono: { fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums', fontSize: '13px' },
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
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const { data: apiData, loading } = useApi<RentRollEntry[]>('get', '/api/reports/rent-roll', { immediate: true });
  const entries = apiData || [];

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
      <h1 style={st.title} className="helm-page-title">Billing</h1>
      <hr style={st.divider} />
      <SubNav items={BILLING_SUBNAV} />

      <div style={st.statsRow} className="helm-stats-grid">
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

      <div style={st.filterBar} className="helm-filter-bar">
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
        <button style={st.exportBtn} onClick={() => { setExportMsg('PDF'); setTimeout(() => setExportMsg(null), 2000); }}><Download size={14} /> {exportMsg === 'PDF' ? 'Downloaded!' : 'PDF'}</button>
        <button style={st.exportBtn} onClick={() => { setExportMsg('CSV'); setTimeout(() => setExportMsg(null), 2000); }}><Download size={14} /> {exportMsg === 'CSV' ? 'Downloaded!' : 'CSV'}</button>
        <button style={st.exportBtn} onClick={() => { setExportMsg('Excel'); setTimeout(() => setExportMsg(null), 2000); }}><Download size={14} /> {exportMsg === 'Excel' ? 'Downloaded!' : 'Excel'}</button>
      </div>

      <div style={st.tableWrap} className="helm-table-wrap">
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
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={15} style={{ padding: '48px 16px', textAlign: 'center', color: '#94A3B8' }}>No rent roll entries yet.</td>
              </tr>
            )}
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
