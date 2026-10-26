import { useState, Fragment } from 'react';
import { Plus, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { useList } from '../hooks/useApi';
import { formatCents } from '../lib/format';
import { ComingSoonButton, EmptyState, ErrorState, LoadingState } from '../components/StateViews';

/* ─── Types ─── */
type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

interface GLAccount {
  id: string;
  number: string;
  name: string;
  type: AccountType;
  debits: number; // cents, current month
  credits: number;
  net: number;
}

// GET /reports/gl-summary -> { period, accounts: [{accountNumber, name, type, debitsCents, creditsCents, netCents}] }
interface GlSummaryRow {
  accountNumber: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  debitsCents: number;
  creditsCents: number;
  netCents: number;
}

const TYPE_LABEL: Record<GlSummaryRow['type'], AccountType> = {
  ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', REVENUE: 'Revenue', EXPENSE: 'Expense',
};

function toAccount(r: GlSummaryRow): GLAccount {
  return {
    id: r.accountNumber,
    number: r.accountNumber,
    name: r.name,
    type: TYPE_LABEL[r.type] ?? 'Asset',
    debits: r.debitsCents,
    credits: r.creditsCents,
    net: r.netCents,
  };
}


const accountTypes: AccountType[] = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

const typeColors: Record<AccountType, { bg: string; text: string; border: string }> = {
  Asset: { bg: '#E3F2FD', text: '#0D47A1', border: '#0D47A1' },
  Liability: { bg: '#FFF3E0', text: '#E65100', border: '#E65100' },
  Equity: { bg: '#E8F5E9', text: '#1B5E20', border: '#1B5E20' },
  Revenue: { bg: '#E0F7FA', text: '#006064', border: '#006064' },
  Expense: { bg: '#FCE4EC', text: '#880E4F', border: '#880E4F' },
};

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: {
    height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px',
  },
  toolbar: {
    display: 'flex', justifyContent: 'flex-end', marginBottom: '16px',
  },
  addBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px',
    fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  tableWrap: {
    borderRadius: '8px', overflow: 'hidden', border: '1px solid #CCCCCC',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '32px',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th: {
    textAlign: 'left', padding: '10px 16px', backgroundColor: '#0A2342', color: '#FFFFFF',
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px',
    fontWeight: 700, fontSize: '14px', cursor: 'pointer', borderBottom: '1px solid #E2E8F0',
    userSelect: 'none',
  },
  td: { padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342' },
  tdMono: {
    padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342',
    ...mono, fontSize: '13px', fontWeight: 600,
  },
  checkmark: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '22px', height: '22px', borderRadius: '50%',
  },
  editBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B',
    padding: '4px', display: 'inline-flex', alignItems: 'center',
  },
  inlineInput: {
    padding: '4px 8px', borderRadius: '4px', border: '1px solid #00D4FF',
    fontSize: '13px', color: '#0A2342', boxSizing: 'border-box', width: '100%',
    outline: 'none',
  },
  inlineSaveBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#1B5E20', padding: '2px',
  },
  inlineCancelBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#B71C1C', padding: '2px',
  },
  subTypeBadge: {
    display: 'inline-block', padding: '2px 10px', borderRadius: '9999px',
    fontSize: '11px', fontWeight: 600, backgroundColor: '#F2F4F6', color: '#2E4A6B',
  },
};

export default function ChartOfAccounts() {
  const list = useList<GLAccount, GlSummaryRow>('/reports/gl-summary', { key: 'accounts', map: toAccount });
  const accounts = list.items;
  const [collapsedTypes, setCollapsedTypes] = useState<Set<AccountType>>(new Set());

  const toggleSection = (type: AccountType) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const grouped = accountTypes.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  }));

  return (
    <div style={s.page}>
      <h1 style={s.title} className="helm-page-title">Chart of Accounts</h1>
      <hr style={s.divider} />

      <div style={s.toolbar}>
        <ComingSoonButton style={s.addBtn} reason="Coming soon: the API has no endpoint to create GL accounts yet."><Plus size={16} /> Add Account</ComingSoonButton>
      </div>

      {list.loading ? <LoadingState label="Loading accounts…" /> : list.error ? <ErrorState title="Could not load the chart of accounts" message={list.status === 403 ? 'The chart of accounts is limited to owner, manager and accounting roles.' : list.error} onRetry={list.refetch} /> : accounts.length === 0 ? <EmptyState title="No GL accounts set up" message="Accounts are created during onboarding (chart of accounts step)." /> : (
      <div style={s.tableWrap} className="helm-table-wrap">
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Account #</th>
              <th style={{ ...s.th, width: '35%' }}>Name</th>
              <th style={s.th}>Type</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Debits (this month)</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Credits (this month)</th>
              <th style={{ ...s.th, textAlign: 'center', width: '50px' }}></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ type, accounts: typeAccounts }) => {
              const colors = typeColors[type];
              const collapsed = collapsedTypes.has(type);
              return (
                <Fragment key={type}>
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <div
                        style={{
                          ...s.sectionHeader,
                          backgroundColor: colors.bg,
                          color: colors.text,
                        }}
                        onClick={() => toggleSection(type)}
                      >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        {type}
                        <span style={{ fontWeight: 400, fontSize: '12px', color: colors.text, opacity: 0.7, marginLeft: '4px' }}>
                          ({typeAccounts.length} accounts)
                        </span>
                      </div>
                    </td>
                  </tr>
                  {!collapsed && typeAccounts.map((acct, idx) => (
                    <tr key={acct.id} style={{ backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}>
                      <td style={s.tdMono}>{acct.number}</td>
                      <td style={s.td}>{acct.name}</td>
                      <td style={s.td}>
                        <span style={{
                          display: 'inline-block', padding: '2px 10px', borderRadius: '9999px',
                          fontSize: '11px', fontWeight: 600,
                          backgroundColor: colors.bg, color: colors.text,
                        }}>
                          {acct.type}
                        </span>
                      </td>
                      <td style={{ ...s.tdMono, textAlign: 'right' }}>{formatCents(acct.debits)}</td>
                      <td style={{ ...s.tdMono, textAlign: 'right' }}>{formatCents(acct.credits)}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        <ComingSoonButton style={s.editBtn} reason="Coming soon: renaming accounts is not connected to the server yet.">
                          <Pencil size={14} />
                        </ComingSoonButton>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
