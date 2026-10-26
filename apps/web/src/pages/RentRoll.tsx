import React, { useState } from 'react';
import { useList } from '../hooks/useApi';
import { formatDate, humanizeEnum, todayKey } from '../lib/format';
import { downloadCsv } from '../lib/csv';
import { ComingSoonButton, EmptyState, ErrorState, LoadingState } from '../components/StateViews';
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

/* ── API mapping ───────────────────────────────────────── */

// GET /reports/rent-roll -> { asOfDate, summary, rows: [...] } (all money in cents)
interface RentRollRow {
  slipId: string;
  slipNumber: string;
  dock: string | null;
  tenant: string | null;
  boatName: string | null;
  boatLength: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  billingCycle: string | null;
  monthlyRateCents: number;
  annualRateCents: number;
  electricityMode: string | null;
  electricityChargeCents: number;
  securityDepositCents: number;
  contractStatus: string;
  autoRenew: boolean;
  daysUntilExpiration: number | null;
  lastPaymentDate: string | null;
  lastPaymentAmountCents: number;
  outstandingBalanceCents: number;
}

function toEntry(r: RentRollRow): RentRollEntry {
  const status: RentRollEntry['status'] =
    r.contractStatus === 'VACANT' ? 'Vacant' : r.contractStatus === 'EXPIRING' ? 'Expiring' : r.contractStatus === 'EXPIRED' ? 'Expired' : 'Active';
  return {
    id: r.slipId,
    slipNumber: r.slipNumber,
    dock: r.dock ?? '—',
    tenantName: r.tenant ?? '',
    boatName: r.boatName ?? '',
    boatLength: r.boatLength ?? 0,
    contractStart: r.contractStart ?? '',
    contractEnd: r.contractEnd ?? '',
    billingCycle: r.billingCycle ? humanizeEnum(r.billingCycle) : '',
    monthlyRate: r.monthlyRateCents / 100,
    annualRate: r.annualRateCents / 100,
    electricityMode: r.electricityMode ?? '—',
    electricityCharge: r.electricityChargeCents / 100,
    depositHeld: r.securityDepositCents / 100,
    balance: r.outstandingBalanceCents / 100,
    status,
    autoRenew: r.autoRenew,
    daysLeft: r.daysUntilExpiration ?? 0,
    lastPaymentDate: r.lastPaymentDate ?? '',
    lastPaymentAmount: r.lastPaymentAmountCents / 100,
  };
}

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
  const list = useList<RentRollEntry, RentRollRow>('/reports/rent-roll', { key: 'rows', map: toEntry });
  const entries = list.items;
  const docks = Array.from(new Set(entries.map((e) => e.dock))).sort();

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

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const exportCsv = () =>
    downloadCsv(
      `rent-roll-${todayKey()}.csv`,
      ['Slip', 'Dock', 'Tenant', 'Boat', 'Length', 'Start', 'End', 'Cycle', 'Monthly', 'Annual', 'Electric', 'Deposit', 'Balance', 'Status', 'Auto Renew', 'Days Left'],
      filtered.map((e) => [e.slipNumber, e.dock, e.tenantName, e.boatName, e.boatLength || '', e.contractStart.slice(0, 10), e.contractEnd.slice(0, 10), e.billingCycle, e.monthlyRate.toFixed(2), e.annualRate.toFixed(2), e.electricityCharge.toFixed(2), e.depositHeld.toFixed(2), e.balance.toFixed(2), e.status, e.autoRenew ? 'Yes' : 'No', e.status === 'Vacant' ? '' : e.daysLeft]),
    );

  if (list.loading || list.error || entries.length === 0) {
    return (
      <div style={st.page}>
        <h1 style={st.title} className="helm-page-title">Rent Roll</h1>
        <hr style={st.divider} />
        {list.loading ? <LoadingState label="Loading rent roll…" /> : list.error ? <ErrorState title="Could not load the rent roll" message={list.status === 403 ? 'The rent roll is limited to owner, manager and accounting roles.' : list.error} onRetry={list.refetch} /> : <EmptyState title="No slips set up yet" />}
      </div>
    );
  }

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Rent Roll</h1>
      <hr style={st.divider} />

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
          {docks.map((d) => <option key={d} value={d}>Dock {d}</option>)}
        </select>
        <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Expiring">Expiring</option>
          <option value="Expired">Expired</option>
          <option value="Vacant">Vacant</option>
        </select>
        <ComingSoonButton style={st.exportBtn} reason="PDF export is not available yet."><Download size={14} /> PDF</ComingSoonButton>
        <button style={st.exportBtn} onClick={exportCsv}><Download size={14} /> CSV</button>
        <ComingSoonButton style={st.exportBtn} reason="Excel export is not available yet; use CSV."><Download size={14} /> Excel</ComingSoonButton>
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
                    <td style={{ ...st.td, fontSize: '12px' }}>{e.contractStart ? `${formatDate(e.contractStart)} → ${e.contractEnd ? formatDate(e.contractEnd) : 'open'}` : '—'}</td>
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
                          <div><span style={{ color: '#64748B', fontWeight: 600 }}>Last Payment:</span> {e.lastPaymentDate ? `${formatDate(e.lastPaymentDate)} — ${fmt(e.lastPaymentAmount)}` : 'None recorded'}</div>
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
