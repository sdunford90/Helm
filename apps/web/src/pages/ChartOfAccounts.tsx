import { useState, Fragment } from 'react';
import { Plus, Check, X, Pencil, ChevronDown, ChevronRight } from 'lucide-react';

/* ─── Types ─── */
type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

interface GLAccount {
  id: string;
  number: string;
  name: string;
  type: AccountType;
  subType: string;
  qboLinked: boolean;
}

/* ─── Mock data ─── */
const mockAccounts: GLAccount[] = [
  // Assets
  { id: '1', number: '1000', name: 'Operating Account', type: 'Asset', subType: 'Bank', qboLinked: true },
  { id: '2', number: '1050', name: 'Stripe Clearing', type: 'Asset', subType: 'Bank', qboLinked: true },
  { id: '3', number: '1200', name: 'Accounts Receivable', type: 'Asset', subType: 'Accounts Receivable', qboLinked: true },
  { id: '4', number: '1300', name: 'Prepaid Expenses', type: 'Asset', subType: 'Other Current Asset', qboLinked: false },
  { id: '5', number: '1500', name: 'Marina Infrastructure', type: 'Asset', subType: 'Fixed Asset', qboLinked: true },
  { id: '6', number: '1510', name: 'Dock Equipment', type: 'Asset', subType: 'Fixed Asset', qboLinked: true },
  { id: '7', number: '1600', name: 'Accumulated Depreciation', type: 'Asset', subType: 'Fixed Asset', qboLinked: true },
  // Liabilities
  { id: '8', number: '2000', name: 'Accounts Payable', type: 'Liability', subType: 'Accounts Payable', qboLinked: true },
  { id: '9', number: '2100', name: 'Sales Tax Payable', type: 'Liability', subType: 'Other Current Liability', qboLinked: true },
  { id: '10', number: '2200', name: 'Deferred Revenue', type: 'Liability', subType: 'Other Current Liability', qboLinked: true },
  { id: '11', number: '2300', name: 'Customer Deposits', type: 'Liability', subType: 'Other Current Liability', qboLinked: false },
  { id: '12', number: '2500', name: 'Long-Term Debt', type: 'Liability', subType: 'Long-Term Liability', qboLinked: true },
  // Equity
  { id: '13', number: '3000', name: 'Owner\'s Equity', type: 'Equity', subType: 'Equity', qboLinked: true },
  { id: '14', number: '3100', name: 'Retained Earnings', type: 'Equity', subType: 'Equity', qboLinked: true },
  // Revenue
  { id: '15', number: '4000', name: 'Slip Revenue', type: 'Revenue', subType: 'Income', qboLinked: true },
  { id: '16', number: '4100', name: 'Fuel Sales', type: 'Revenue', subType: 'Income', qboLinked: true },
  { id: '17', number: '4200', name: 'Service Revenue', type: 'Revenue', subType: 'Income', qboLinked: true },
  { id: '18', number: '4300', name: 'Boat Rental Revenue', type: 'Revenue', subType: 'Income', qboLinked: true },
  { id: '19', number: '4400', name: 'Merchandise Sales', type: 'Revenue', subType: 'Income', qboLinked: false },
  { id: '20', number: '4500', name: 'Late Fees', type: 'Revenue', subType: 'Other Income', qboLinked: true },
  // Expenses
  { id: '21', number: '5000', name: 'Cost of Fuel', type: 'Expense', subType: 'Cost of Goods Sold', qboLinked: true },
  { id: '22', number: '6000', name: 'Payroll', type: 'Expense', subType: 'Expense', qboLinked: true },
  { id: '23', number: '6100', name: 'Utilities', type: 'Expense', subType: 'Expense', qboLinked: true },
  { id: '24', number: '6200', name: 'Insurance', type: 'Expense', subType: 'Expense', qboLinked: true },
  { id: '25', number: '6300', name: 'Repairs & Maintenance', type: 'Expense', subType: 'Expense', qboLinked: true },
  { id: '26', number: '6400', name: 'Office & Admin', type: 'Expense', subType: 'Expense', qboLinked: false },
  { id: '27', number: '6500', name: 'Depreciation Expense', type: 'Expense', subType: 'Expense', qboLinked: true },
  { id: '28', number: '6600', name: 'Payment Processing Fees', type: 'Expense', subType: 'Expense', qboLinked: true },
];

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
  const [accounts, setAccounts] = useState<GLAccount[]>(mockAccounts);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<AccountType>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const toggleSection = (type: AccountType) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const startEdit = (acct: GLAccount) => {
    setEditingId(acct.id);
    setEditName(acct.name);
  };

  const saveEdit = () => {
    if (editingId) {
      setAccounts((prev) =>
        prev.map((a) => (a.id === editingId ? { ...a, name: editName } : a))
      );
      setEditingId(null);
    }
  };

  const cancelEdit = () => setEditingId(null);

  const grouped = accountTypes.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  }));

  return (
    <div style={s.page}>
      <h1 style={s.title}>Chart of Accounts</h1>
      <hr style={s.divider} />

      <div style={s.toolbar}>
        <button style={s.addBtn}><Plus size={16} /> Add Account</button>
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Account #</th>
              <th style={{ ...s.th, width: '35%' }}>Name</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Sub Type</th>
              <th style={{ ...s.th, textAlign: 'center' }}>QBO Linked</th>
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
                      <td style={s.td}>
                        {editingId === acct.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              style={s.inlineInput}
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              autoFocus
                            />
                            <button style={s.inlineSaveBtn} onClick={saveEdit} title="Save"><Check size={16} /></button>
                            <button style={s.inlineCancelBtn} onClick={cancelEdit} title="Cancel"><X size={16} /></button>
                          </div>
                        ) : (
                          acct.name
                        )}
                      </td>
                      <td style={s.td}>
                        <span style={{
                          display: 'inline-block', padding: '2px 10px', borderRadius: '9999px',
                          fontSize: '11px', fontWeight: 600,
                          backgroundColor: colors.bg, color: colors.text,
                        }}>
                          {acct.type}
                        </span>
                      </td>
                      <td style={s.td}>
                        <span style={s.subTypeBadge}>{acct.subType}</span>
                      </td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        {acct.qboLinked ? (
                          <span style={{ ...s.checkmark, backgroundColor: '#E8F5E9', color: '#1B5E20' }}>
                            <Check size={14} />
                          </span>
                        ) : (
                          <span style={{ ...s.checkmark, backgroundColor: '#F2F4F6', color: '#94A3B8' }}>
                            <X size={14} />
                          </span>
                        )}
                      </td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        <button
                          style={s.editBtn}
                          onClick={() => startEdit(acct)}
                          title="Edit account name"
                        >
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
