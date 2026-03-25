import { useState, useEffect, Fragment } from 'react';
import { Plus, Check, X, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';

/* ─── Types ─── */
type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
const DISPLAY_TYPE: Record<AccountType, string> = {
  ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', REVENUE: 'Revenue', EXPENSE: 'Expense',
};

interface GLAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: AccountType;
  subType: string | null;
  qboAccountId: string | null;
  isDeferredRevenue: boolean;
}

const accountTypes: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const typeColors: Record<AccountType, { bg: string; text: string; border: string }> = {
  ASSET: { bg: '#E3F2FD', text: '#0D47A1', border: '#0D47A1' },
  LIABILITY: { bg: '#FFF3E0', text: '#E65100', border: '#E65100' },
  EQUITY: { bg: '#E8F5E9', text: '#1B5E20', border: '#1B5E20' },
  REVENUE: { bg: '#E0F7FA', text: '#006064', border: '#006064' },
  EXPENSE: { bg: '#FCE4EC', text: '#880E4F', border: '#880E4F' },
};

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  toolbar: { display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' },
  addBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  tableWrap: { borderRadius: '8px', overflow: 'hidden', border: '1px solid #CCCCCC', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '32px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th: { textAlign: 'left', padding: '10px 16px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', borderBottom: '1px solid #E2E8F0', userSelect: 'none' },
  td: { padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342' },
  tdMono: { padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342', ...mono, fontSize: '13px', fontWeight: 600 },
  checkmark: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '50%' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px', display: 'inline-flex', alignItems: 'center' },
  inlineInput: { padding: '4px 8px', borderRadius: '4px', border: '1px solid #00D4FF', fontSize: '13px', color: '#0A2342', boxSizing: 'border-box', width: '100%', outline: 'none' },
  inlineSaveBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#1B5E20', padding: '2px' },
  inlineCancelBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#B71C1C', padding: '2px' },
  subTypeBadge: { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, backgroundColor: '#F2F4F6', color: '#2E4A6B' },
  loading: { display: 'flex', justifyContent: 'center', padding: '64px', color: '#64748B' },
};

export default function ChartOfAccounts() {
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<AccountType>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    api.get<{ accounts: GLAccount[] }>('/gl-accounts')
      .then((res) => setAccounts(res.accounts ?? []))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  }, []);

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

  const saveEdit = async () => {
    if (editingId) {
      try {
        await api.put(`/gl-accounts/${editingId}`, { name: editName });
        setAccounts((prev) =>
          prev.map((a) => (a.id === editingId ? { ...a, name: editName } : a))
        );
      } catch { /* ignore */ }
      setEditingId(null);
    }
  };

  const cancelEdit = () => setEditingId(null);

  const grouped = accountTypes.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  }));

  if (loading) return <div style={s.loading}>Loading chart of accounts...</div>;

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
                        style={{ ...s.sectionHeader, backgroundColor: colors.bg, color: colors.text }}
                        onClick={() => toggleSection(type)}
                      >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        {DISPLAY_TYPE[type]}
                        <span style={{ fontWeight: 400, fontSize: '12px', color: colors.text, opacity: 0.7, marginLeft: '4px' }}>
                          ({typeAccounts.length} accounts)
                        </span>
                      </div>
                    </td>
                  </tr>
                  {!collapsed && typeAccounts.map((acct, idx) => (
                    <tr key={acct.id} style={{ backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}>
                      <td style={s.tdMono}>{acct.accountNumber}</td>
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
                        ) : acct.name}
                      </td>
                      <td style={s.td}>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, backgroundColor: colors.bg, color: colors.text }}>
                          {DISPLAY_TYPE[type]}
                        </span>
                      </td>
                      <td style={s.td}>
                        <span style={s.subTypeBadge}>{acct.subType || '—'}</span>
                      </td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        {acct.qboAccountId ? (
                          <span style={{ ...s.checkmark, backgroundColor: '#E8F5E9', color: '#1B5E20' }}><Check size={14} /></span>
                        ) : (
                          <span style={{ ...s.checkmark, backgroundColor: '#F2F4F6', color: '#94A3B8' }}><X size={14} /></span>
                        )}
                      </td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        <button style={s.editBtn} onClick={() => startEdit(acct)} title="Edit account name"><Pencil size={14} /></button>
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
