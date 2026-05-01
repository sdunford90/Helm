import { useState, useEffect, Fragment, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Check, X, Pencil, ChevronDown, ChevronRight,
  Trash2, AlertTriangle, RefreshCw, ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api';
import { useModules } from '../context/ModulesContext';

/* ─── Types ─── */
type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
type AccountTypeDisplay = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

interface GLAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: AccountType;
  subType: string | null;
  description: string | null;
  qboAccountId: string | null;
  isDeferredRevenue: boolean;
  active: boolean;
  isActive?: boolean;
  source?: 'QBO' | 'MANUAL';
  locationId: string | null;
  location?: { id: string; name: string } | null;
}

const TYPE_MAP: Record<AccountType, AccountTypeDisplay> = {
  ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity',
  REVENUE: 'Revenue', EXPENSE: 'Expense',
};

const accountTypes: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const typeColors: Record<AccountType, { bg: string; text: string; border: string }> = {
  ASSET: { bg: '#E3F2FD', text: '#0D47A1', border: '#0D47A1' },
  LIABILITY: { bg: '#FFF3E0', text: '#E65100', border: '#E65100' },
  EQUITY: { bg: '#E8F5E9', text: '#1B5E20', border: '#1B5E20' },
  REVENUE: { bg: '#E0F7FA', text: '#006064', border: '#006064' },
  EXPENSE: { bg: '#FCE4EC', text: '#880E4F', border: '#880E4F' },
};

const subTypeOptions: Record<AccountType, string[]> = {
  ASSET: ['Cash', 'Accounts Receivable', 'Prepaid', 'Fixed Asset', 'Other Asset'],
  LIABILITY: ['Accounts Payable', 'Deferred Revenue', 'Tax Payable', 'Security Deposits', 'Other Liability'],
  EQUITY: ['Retained Earnings', 'Common Stock', 'Other Equity'],
  REVENUE: ['Operating Revenue', 'Service Revenue', 'Other Revenue'],
  EXPENSE: ['Operating Expense', 'Cost of Goods Sold', 'Other Expense'],
};

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  subtitle: { fontSize: '14px', color: '#64748B', marginTop: '4px' },
  divider: {
    height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px',
  },
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '16px',
  },
  toolbarRight: { display: 'flex', gap: '8px', alignItems: 'center' },
  addBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px',
    fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  refreshBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px',
    fontSize: '13px', fontWeight: 500, color: '#475569', backgroundColor: '#F1F5F9',
    border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer',
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
  td: { padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342', verticalAlign: 'middle' },
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
  deleteBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626',
    padding: '4px', display: 'inline-flex', alignItems: 'center',
  },
  inlineInput: {
    padding: '4px 8px', borderRadius: '4px', border: '1px solid #00D4FF',
    fontSize: '13px', color: '#0A2342', boxSizing: 'border-box', width: '100%',
    outline: 'none',
  },
  inlineSelect: {
    padding: '4px 6px', borderRadius: '4px', border: '1px solid #00D4FF',
    fontSize: '13px', color: '#0A2342', outline: 'none',
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
  // Modal
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#FFFFFF', borderRadius: '12px', padding: '28px',
    width: '520px', maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  modalTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', marginBottom: '20px' },
  formRow: { marginBottom: '16px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' },
  input: {
    width: '100%', padding: '8px 12px', borderRadius: '6px',
    border: '1px solid #CBD5E1', fontSize: '14px', color: '#0A2342',
    outline: 'none', boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '8px 12px', borderRadius: '6px',
    border: '1px solid #CBD5E1', fontSize: '14px', color: '#0A2342',
    outline: 'none', backgroundColor: '#FFFFFF',
  },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' },
  cancelModalBtn: {
    padding: '8px 20px', borderRadius: '6px', border: '1px solid #CBD5E1',
    fontSize: '14px', fontWeight: 600, color: '#475569', cursor: 'pointer',
    backgroundColor: '#FFFFFF',
  },
  saveModalBtn: {
    padding: '8px 20px', borderRadius: '6px', border: 'none',
    fontSize: '14px', fontWeight: 600, color: '#FFFFFF',
    cursor: 'pointer', backgroundColor: '#0A2342',
  },
  warningBanner: {
    display: 'flex', alignItems: 'flex-start', gap: '12px',
    padding: '12px 16px', borderRadius: '8px',
    backgroundColor: '#FFF8E1', border: '1px solid #F59E0B',
    marginBottom: '20px', fontSize: '13px', color: '#92400E',
  },
};

/* ─── Add/Edit Modal ─── */

interface AccountFormState {
  accountNumber: string;
  name: string;
  type: AccountType;
  subType: string;
  description: string;
  qboAccountId: string;
  isDeferredRevenue: boolean;
}

const emptyForm = (): AccountFormState => ({
  accountNumber: '', name: '', type: 'REVENUE', subType: '',
  description: '', qboAccountId: '', isDeferredRevenue: false,
});

function AccountModal({
  initial,
  onClose,
  onSave,
  qboLocked,
}: {
  initial: AccountFormState;
  onClose: () => void;
  onSave: (form: AccountFormState) => Promise<void>;
  qboLocked: boolean;
}) {
  const [form, setForm] = useState<AccountFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof AccountFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.accountNumber || !form.name) {
      setErr('Account number and name are required.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave(form);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalTitle}>
          {initial.accountNumber ? 'Edit GL Account' : 'Add GL Account'}
        </div>

        {err && (
          <div style={{ ...s.warningBanner, marginBottom: '16px' }}>
            <AlertTriangle size={15} color="#F59E0B" />
            {err}
          </div>
        )}

        {qboLocked && (
          <div style={{ background: '#E0F2FE', color: '#075985', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '12px' }}>
            This account is owned by QuickBooks. Account number, name, type, sub-type, and the QuickBooks ID are read-only here — edit them in QuickBooks and re-import. You can still update the description and the deferred-revenue flag.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
          <div style={s.formRow}>
            <label style={s.label}>Account #</label>
            <input
              style={{ ...s.input, ...mono, ...(qboLocked ? { background: '#F1F5F9', color: '#64748B' } : {}) }}
              value={form.accountNumber}
              onChange={(e) => set('accountNumber', e.target.value)}
              placeholder="e.g. 4100"
              autoFocus={!qboLocked}
              readOnly={qboLocked}
              disabled={qboLocked}
            />
          </div>
          <div style={s.formRow}>
            <label style={s.label}>Account Name</label>
            <input
              style={{ ...s.input, ...(qboLocked ? { background: '#F1F5F9', color: '#64748B' } : {}) }}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Slip Rental Revenue"
              readOnly={qboLocked}
              disabled={qboLocked}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={s.formRow}>
            <label style={s.label}>Account Type</label>
            <select
              style={{ ...s.select, ...(qboLocked ? { background: '#F1F5F9', color: '#64748B' } : {}) }}
              value={form.type}
              onChange={(e) => set('type', e.target.value as AccountType)}
              disabled={qboLocked}
            >
              {accountTypes.map((t) => (
                <option key={t} value={t}>{TYPE_MAP[t]}</option>
              ))}
            </select>
          </div>
          <div style={s.formRow}>
            <label style={s.label}>Sub Type</label>
            <select
              style={{ ...s.select, ...(qboLocked ? { background: '#F1F5F9', color: '#64748B' } : {}) }}
              value={form.subType}
              onChange={(e) => set('subType', e.target.value)}
              disabled={qboLocked}
            >
              <option value="">— None —</option>
              {subTypeOptions[form.type].map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={s.formRow}>
          <label style={s.label}>Description (optional)</label>
          <input
            style={s.input}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Brief description of this account"
          />
        </div>

        <div style={s.formRow}>
          <label style={s.label}>
            QuickBooks Account ID{' '}
            <span style={{ fontWeight: 400, color: '#94A3B8' }}>(optional — links this account to QBO)</span>
          </label>
          <input
            style={{ ...s.input, ...mono, ...(qboLocked ? { background: '#F1F5F9', color: '#64748B' } : {}) }}
            value={form.qboAccountId}
            onChange={(e) => set('qboAccountId', e.target.value)}
            placeholder="QBO account ID or number"
            readOnly={qboLocked}
            disabled={qboLocked}
          />
        </div>

        <div style={s.formRow}>
          <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.isDeferredRevenue}
              onChange={(e) => set('isDeferredRevenue', e.target.checked)}
            />
            Mark as deferred revenue liability account
          </label>
        </div>

        <div style={s.modalFooter}>
          <button style={s.cancelModalBtn} onClick={onClose}>Cancel</button>
          <button style={s.saveModalBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Account'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main component ─── */

export default function ChartOfAccounts() {
  const { currentLocationId } = useModules();
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<AccountType>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<GLAccount | null>(null);
  const [editingInline, setEditingInline] = useState<{ id: string; field: string; value: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (currentLocationId) qs.set('locationId', currentLocationId);
      const res = await api.get<{ data: GLAccount[] }>(`/api/settings/gl-accounts?${qs}`);
      setAccounts(res.data ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load GL accounts');
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { load(); }, [load]);

  const notify = (type: 'success' | 'error', msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 3500);
  };

  const toggleSection = (type: AccountType) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const openAdd = () => { setEditTarget(null); setShowModal(true); };
  const openEdit = (acct: GLAccount) => { setEditTarget(acct); setShowModal(true); };

  const handleSave = async (form: AccountFormState) => {
    const payload = {
      accountNumber: form.accountNumber,
      name: form.name,
      type: form.type,
      subType: form.subType || null,
      description: form.description || null,
      qboAccountId: form.qboAccountId || null,
      isDeferredRevenue: form.isDeferredRevenue,
    };

    if (editTarget) {
      await api.put(`/api/settings/gl-accounts/${editTarget.id}`, payload);
      notify('success', 'Account updated.');
    } else {
      await api.post('/api/settings/gl-accounts', payload);
      notify('success', 'Account created.');
    }
    setShowModal(false);
    load();
  };

  const handleDelete = async (acct: GLAccount) => {
    if (!confirm(`Archive or delete account "${acct.accountNumber} — ${acct.name}"? Accounts with posted entries will be archived instead of deleted.`)) return;
    setDeletingId(acct.id);
    try {
      const res = await api.delete<{ success: boolean; archived?: boolean }>(`/api/settings/gl-accounts/${acct.id}`);
      if (res?.archived) {
        notify('success', `Account archived (has posted entries).`);
      } else {
        notify('success', 'Account deleted.');
      }
      load();
    } catch (e: any) {
      notify('error', e?.response?.data?.error ?? 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  // Group first by location, then by account type within each location.
  const locationOrder: { id: string | null; name: string }[] = [];
  const seenLocs = new Set<string>();
  accounts.forEach((a) => {
    const key = a.locationId ?? '__tenant__';
    if (!seenLocs.has(key)) {
      seenLocs.add(key);
      locationOrder.push({
        id: a.locationId,
        name: a.location?.name ?? 'Tenant-wide (legacy)',
      });
    }
  });
  if (locationOrder.length === 0) {
    locationOrder.push({ id: null, name: 'Tenant-wide (legacy)' });
  }
  const groupedByLocation = locationOrder.map((loc) => ({
    loc,
    typed: accountTypes.map((type) => ({
      type,
      accounts: accounts.filter(
        (a) => a.type === type && (a.locationId ?? null) === loc.id,
      ),
    })),
  }));

  const initialForModal = editTarget
    ? {
        accountNumber: editTarget.accountNumber,
        name: editTarget.name,
        type: editTarget.type,
        subType: editTarget.subType ?? '',
        description: editTarget.description ?? '',
        qboAccountId: editTarget.qboAccountId ?? '',
        isDeferredRevenue: editTarget.isDeferredRevenue,
      }
    : emptyForm();

  return (
    <div style={s.page}>
      <h1 style={s.title} className="helm-page-title">Chart of Accounts</h1>
      <p style={s.subtitle}>
        Define your GL accounts and link each one to a QuickBooks account.
        Then assign revenue accounts to products in{' '}
        <Link to="/settings/products" style={{ color: '#0A2342', fontWeight: 600 }}>
          Settings → Products &amp; Revenue <ExternalLink size={11} style={{ verticalAlign: 'middle' }} />
        </Link>
      </p>
      <hr style={s.divider} />

      {notification && (
        <div style={{
          padding: '12px 16px', borderRadius: '6px', marginBottom: '16px',
          backgroundColor: notification.type === 'success' ? '#DCFCE7' : '#FEE2E2',
          color: notification.type === 'success' ? '#166534' : '#991B1B',
          fontSize: '14px', fontWeight: 500,
        }}>
          {notification.msg}
        </div>
      )}

      {error && (
        <div style={s.warningBanner}>
          <AlertTriangle size={16} color="#F59E0B" />
          {error}
        </div>
      )}

      <div style={s.toolbar}>
        <span style={{ fontSize: '14px', color: '#64748B' }}>
          {accounts.length} account{accounts.length !== 1 ? 's' : ''} across{' '}
          {locationOrder.length} scope
          {locationOrder.length === 1 ? '' : 's'}
        </span>
        <div style={s.toolbarRight}>
          <Link
            to="/settings/quickbooks"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', fontSize: '13px', fontWeight: 600,
              color: '#FFFFFF', backgroundColor: '#0A2342',
              border: 'none', borderRadius: '6px', textDecoration: 'none',
            }}
          >
            <RefreshCw size={14} /> Import from QuickBooks
          </Link>
          <button style={s.refreshBtn} onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
          <button
            style={{ ...s.refreshBtn, color: '#475569' }}
            onClick={openAdd}
            title="Manually create a GL account (prefer importing from QuickBooks)"
          >
            <Plus size={14} /> Add manually
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>
          Loading accounts…
        </div>
      )}

      {!loading && groupedByLocation.map(({ loc, typed }) => (
        <div key={loc.id ?? '__tenant__'} style={{ marginBottom: '24px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', backgroundColor: '#F1F5F9',
            border: '1px solid #E2E8F0', borderBottom: 'none',
            borderTopLeftRadius: '8px', borderTopRightRadius: '8px',
          }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0A2342' }}>
              {loc.id ? `Location: ${loc.name}` : loc.name}
            </div>
            {loc.id && (
              <Link
                to="/settings/quickbooks"
                style={{ fontSize: '12px', color: '#0A2342', fontWeight: 600, textDecoration: 'none' }}
              >
                Import from QuickBooks <ExternalLink size={11} style={{ verticalAlign: 'middle' }} />
              </Link>
            )}
          </div>
        <div style={{ ...s.tableWrap, marginBottom: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }} className="helm-table-wrap">
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Account #</th>
                <th style={{ ...s.th, width: '25%' }}>Name</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Sub Type</th>
                <th style={s.th}>QBO Account ID</th>
                <th style={{ ...s.th, textAlign: 'center' }}>Source</th>
                <th style={{ ...s.th, textAlign: 'center', width: '80px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {typed.map(({ type, accounts: typeAccounts }) => {
                const colors = typeColors[type];
                const collapsed = collapsedTypes.has(type);
                return (
                  <Fragment key={type}>
                    <tr>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <div
                          style={{
                            ...s.sectionHeader,
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                          onClick={() => toggleSection(type)}
                        >
                          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          {TYPE_MAP[type]}
                          <span style={{ fontWeight: 400, fontSize: '12px', opacity: 0.7, marginLeft: '4px' }}>
                            ({typeAccounts.length} account{typeAccounts.length !== 1 ? 's' : ''})
                          </span>
                        </div>
                      </td>
                    </tr>
                    {!collapsed && typeAccounts.map((acct, idx) => (
                      <tr key={acct.id} style={{ backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF', opacity: (acct.isActive ?? acct.active) ? 1 : 0.5 }}>
                        <td style={s.tdMono}>{acct.accountNumber}</td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {acct.name}
                            {acct.isDeferredRevenue && (
                              <span style={{
                                padding: '1px 6px', borderRadius: '4px', fontSize: '10px',
                                fontWeight: 600, backgroundColor: '#FEF3C7', color: '#92400E',
                              }}>
                                Deferred
                              </span>
                            )}
                            {!(acct.isActive ?? acct.active) && (
                              <span style={{
                                padding: '1px 6px', borderRadius: '4px', fontSize: '10px',
                                fontWeight: 600, backgroundColor: '#F1F5F9', color: '#94A3B8',
                              }}>
                                Archived
                              </span>
                            )}
                          </div>
                          {acct.description && (
                            <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
                              {acct.description}
                            </div>
                          )}
                        </td>
                        <td style={s.td}>
                          <span style={{
                            display: 'inline-block', padding: '2px 10px', borderRadius: '9999px',
                            fontSize: '11px', fontWeight: 600,
                            backgroundColor: colors.bg, color: colors.text,
                          }}>
                            {TYPE_MAP[type]}
                          </span>
                        </td>
                        <td style={s.td}>
                          {acct.subType ? (
                            <span style={s.subTypeBadge}>{acct.subType}</span>
                          ) : (
                            <span style={{ color: '#CBD5E1' }}>—</span>
                          )}
                        </td>
                        <td style={{ ...s.td, ...mono, fontSize: '12px' }}>
                          {acct.qboAccountId ?? <span style={{ color: '#CBD5E1' }}>—</span>}
                        </td>
                        <td style={{ ...s.td, textAlign: 'center' }}>
                          {acct.source === 'QBO' ? (
                            <span style={{
                              display: 'inline-block', padding: '2px 8px',
                              borderRadius: '9999px', fontSize: '11px', fontWeight: 600,
                              backgroundColor: '#E0F2FE', color: '#0369A1',
                            }}>
                              QuickBooks
                            </span>
                          ) : acct.qboAccountId ? (
                            <span style={{
                              display: 'inline-block', padding: '2px 8px',
                              borderRadius: '9999px', fontSize: '11px', fontWeight: 600,
                              backgroundColor: '#E8F5E9', color: '#1B5E20',
                            }}>
                              Linked
                            </span>
                          ) : (
                            <span style={{
                              display: 'inline-block', padding: '2px 8px',
                              borderRadius: '9999px', fontSize: '11px', fontWeight: 600,
                              backgroundColor: '#F2F4F6', color: '#94A3B8',
                            }}>
                              Manual
                            </span>
                          )}
                        </td>
                        <td style={{ ...s.td, textAlign: 'center' }}>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                            <button
                              style={s.editBtn}
                              onClick={() => openEdit(acct)}
                              title={acct.source === 'QBO'
                                ? 'Toggle deferred-revenue / archive (number, name, type are managed by QuickBooks)'
                                : 'Edit account'}
                            >
                              <Pencil size={14} />
                            </button>
                            {acct.source !== 'QBO' && (
                              <button
                                style={s.deleteBtn}
                                onClick={() => handleDelete(acct)}
                                disabled={deletingId === acct.id}
                                title="Delete or archive account"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
              {typed.every((g) => g.accounts.length === 0) && (
                <tr>
                  <td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#94A3B8', padding: '24px 16px' }}>
                    No accounts in this scope yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      ))}

      {showModal && (
        <AccountModal
          initial={initialForModal}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
          qboLocked={editTarget?.source === 'QBO'}
        />
      )}
    </div>
  );
}
