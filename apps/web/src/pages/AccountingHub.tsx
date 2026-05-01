import React, { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import {
  Link2, Link2Off, RefreshCw, CheckCircle2, AlertTriangle,
  BookOpen, Calendar, ScrollText, FileText, ChevronDown,
  ChevronRight, Save, Plus, Lock, Unlock, X, ArrowRight,
  Building2, Layers, CreditCard, Banknote, Tag, Package,
  Zap, Ship, ShoppingCart, Waves, Anchor, ConciergeBell,
  BarChart3, Settings2, Edit2, Clock,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────────── */

interface GlAccount {
  id: string;
  name: string;
  type: string;
  accountNumber?: string;
  qboAccountId?: string;
}

interface AccountMapping {
  sourceKey: string;
  glAccountId: string;
  glCogsAccountId?: string;
  glAccount?: GlAccount;
  glCogsAccount?: GlAccount;
}

interface DockageRate {
  id: string;
  slipType: string;
  monthlyRate?: number;
  glRevenueAccountId?: string;
  glRevenueAccount?: GlAccount;
}

interface ServiceFee {
  id: string;
  name: string;
  amount?: number;
  glAccountId?: string;
  glAccount?: GlAccount;
}

interface ProductCategory {
  id: string;
  name: string;
  glRevenueAccountId?: string;
  glCogsAccountId?: string;
  glRevenueAccount?: GlAccount;
  glCogsAccount?: GlAccount;
}

interface RentalProduct {
  id: string;
  name: string;
  glRevenueAccountId?: string;
  glRevenueAccount?: GlAccount;
}

interface LocationMappings {
  systemAccounts: AccountMapping[];
  revenueStreams: AccountMapping[];
  paymentMethods: AccountMapping[];
  dockageRates: DockageRate[];
  serviceFees: ServiceFee[];
  productCategories: ProductCategory[];
  rentalProducts: RentalProduct[];
  rentalGlMode: 'SINGLE' | 'PER_PRODUCT';
}

interface QboStatus {
  connected: boolean;
  companyName?: string;
  realmId?: string;
  lastSync?: string;
  tokenExpiresAt?: string;
}

interface FiscalPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  closedAt?: string;
  lockedAt?: string;
}

interface AuditEntry {
  id: string;
  createdAt: string;
  userName: string;
  mappingSection: string;
  mappingLabel: string;
  fieldChanged: string;
  oldAccountName?: string;
  newAccountName?: string;
}

interface JournalEntry {
  id: string;
  postDate: string;
  description?: string;
  lines: { glAccount?: GlAccount; debitCents: number; creditCents: number }[];
}

/* ─────────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────────── */

const LOCATIONS = [
  { id: 'loc-main', name: 'Main Dock', qboConnected: true },
  { id: 'loc-fuel', name: 'Fuel Dock', qboConnected: false },
  { id: 'loc-rental', name: 'Rental Center', qboConnected: true },
];

const SYSTEM_ACCOUNT_LABELS: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  ACCOUNTS_RECEIVABLE: { label: 'Accounts Receivable', icon: <ArrowRight size={14} />, description: 'Customer invoices and outstanding balances' },
  CASH: { label: 'Cash', icon: <Banknote size={14} />, description: 'Cash on hand and bank accounts' },
  CARD_CLEARING: { label: 'Card Clearing', icon: <CreditCard size={14} />, description: 'Credit/debit card settlement clearing' },
  ACH_CLEARING: { label: 'ACH Clearing', icon: <CreditCard size={14} />, description: 'ACH payment clearing account' },
  DEFERRED_REVENUE: { label: 'Deferred Revenue', icon: <Calendar size={14} />, description: 'Prepaid dockage and advance payments' },
  SECURITY_DEPOSITS_HELD: { label: 'Security Deposits', icon: <Lock size={14} />, description: 'Customer security deposits held' },
  SALES_TAX_PAYABLE: { label: 'Sales Tax Payable', icon: <FileText size={14} />, description: 'Sales tax collected, owed to state' },
  INVENTORY_ASSET: { label: 'Inventory Asset', icon: <Package size={14} />, description: 'On-hand inventory value (fuel, retail)' },
  ACCOUNTS_PAYABLE: { label: 'Accounts Payable', icon: <ArrowRight size={14} />, description: 'Vendor invoices and purchase orders' },
  LATE_FEE_REVENUE: { label: 'Late Fee Revenue', icon: <FileText size={14} />, description: 'Late payment fee income' },
  ACH_RETURN_FEE: { label: 'ACH Return Fee', icon: <FileText size={14} />, description: 'NSF / returned ACH fee income' },
  EARLY_TERMINATION_INCOME: { label: 'Early Termination', icon: <FileText size={14} />, description: 'Early contract termination income' },
};

const REVENUE_STREAM_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  DOCKAGE: { label: 'Dockage Revenue', icon: <Anchor size={14} /> },
  ELECTRICITY: { label: 'Electricity Revenue', icon: <Zap size={14} /> },
  RENTAL: { label: 'Rental Revenue', icon: <Ship size={14} /> },
  FUEL: { label: 'Fuel Revenue', icon: <Layers size={14} /> },
  RETAIL: { label: 'Retail / POS Revenue', icon: <ShoppingCart size={14} /> },
  TRANSIENT: { label: 'Transient Revenue', icon: <Anchor size={14} /> },
  RAMP: { label: 'Launch Ramp Revenue', icon: <Waves size={14} /> },
  CONCIERGE: { label: 'Concierge Revenue', icon: <ConciergeBell size={14} /> },
  DAMAGE_WAIVER: { label: 'Damage Waiver Revenue', icon: <FileText size={14} /> },
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CARD: 'Credit / Debit Card',
  ACH: 'ACH / Bank Transfer',
  CASH: 'Cash',
  CHECK: 'Check',
  WIRE: 'Wire Transfer',
  CHARGE_TO_SLIP: 'Charge to Slip',
};

const TABS = [
  { id: 'mappings', label: 'Account Mappings', icon: <BookOpen size={16} /> },
  { id: 'fiscal', label: 'Fiscal Periods', icon: <Calendar size={16} /> },
  { id: 'auditlog', label: 'Audit Log', icon: <ScrollText size={16} /> },
  { id: 'journal', label: 'Journal Entries', icon: <FileText size={16} /> },
];

/* ─────────────────────────────────────────────────────────────────
   Mock data (replaced by API calls in production)
───────────────────────────────────────────────────────────────── */

const MOCK_ACCOUNTS: GlAccount[] = [
  { id: 'a1', name: 'Accounts Receivable', type: 'ACCOUNTS_RECEIVABLE', accountNumber: '1200' },
  { id: 'a2', name: 'Cash - Operating', type: 'BANK', accountNumber: '1010' },
  { id: 'a3', name: 'Card Clearing', type: 'BANK', accountNumber: '1020' },
  { id: 'a4', name: 'ACH Clearing', type: 'BANK', accountNumber: '1030' },
  { id: 'a5', name: 'Deferred Revenue', type: 'OTHER_CURRENT_LIABILITY', accountNumber: '2300' },
  { id: 'a6', name: 'Security Deposits Held', type: 'OTHER_CURRENT_LIABILITY', accountNumber: '2310' },
  { id: 'a7', name: 'Sales Tax Payable', type: 'OTHER_CURRENT_LIABILITY', accountNumber: '2200' },
  { id: 'a8', name: 'Inventory Asset', type: 'OTHER_CURRENT_ASSET', accountNumber: '1400' },
  { id: 'a9', name: 'Accounts Payable', type: 'ACCOUNTS_PAYABLE', accountNumber: '2000' },
  { id: 'a10', name: 'Dockage Revenue', type: 'INCOME', accountNumber: '4100' },
  { id: 'a11', name: 'Electricity Revenue', type: 'INCOME', accountNumber: '4150' },
  { id: 'a12', name: 'Rental Revenue', type: 'INCOME', accountNumber: '4300' },
  { id: 'a13', name: 'Fuel Revenue', type: 'INCOME', accountNumber: '4400' },
  { id: 'a14', name: 'Retail Revenue', type: 'INCOME', accountNumber: '4500' },
  { id: 'a15', name: 'Transient Revenue', type: 'INCOME', accountNumber: '4600' },
  { id: 'a16', name: 'Ramp Revenue', type: 'INCOME', accountNumber: '4700' },
  { id: 'a17', name: 'Concierge Revenue', type: 'INCOME', accountNumber: '4800' },
  { id: 'a18', name: 'Fuel COGS', type: 'COST_OF_GOODS_SOLD', accountNumber: '5100' },
  { id: 'a19', name: 'Retail COGS', type: 'COST_OF_GOODS_SOLD', accountNumber: '5200' },
  { id: 'a20', name: 'Late Fee Income', type: 'INCOME', accountNumber: '4900' },
  { id: 'a21', name: 'Wet Slip Dockage', type: 'INCOME', accountNumber: '4110' },
  { id: 'a22', name: 'Dry Stack Dockage', type: 'INCOME', accountNumber: '4120' },
];

const MOCK_FISCAL_PERIODS: FiscalPeriod[] = [
  { id: 'fp1', name: 'April 2026', startDate: '2026-04-01', endDate: '2026-04-30', status: 'OPEN' },
  { id: 'fp2', name: 'March 2026', startDate: '2026-03-01', endDate: '2026-03-31', status: 'CLOSED', closedAt: '2026-04-05T10:00:00Z' },
  { id: 'fp3', name: 'February 2026', startDate: '2026-02-01', endDate: '2026-02-28', status: 'LOCKED', closedAt: '2026-03-04T09:00:00Z', lockedAt: '2026-04-01T08:00:00Z' },
  { id: 'fp4', name: 'January 2026', startDate: '2026-01-01', endDate: '2026-01-31', status: 'LOCKED', closedAt: '2026-02-04T09:00:00Z', lockedAt: '2026-03-01T08:00:00Z' },
];

const MOCK_AUDIT: AuditEntry[] = [
  { id: '1', createdAt: '2026-04-28T14:22:00Z', userName: 'Sandra Dunford', mappingSection: 'Revenue Streams', mappingLabel: 'Dockage Revenue', fieldChanged: 'glAccountId', oldAccountName: '4100 - Marina Revenue', newAccountName: '4100 - Dockage Revenue' },
  { id: '2', createdAt: '2026-04-15T09:10:00Z', userName: 'Jake Martinez', mappingSection: 'System Accounts', mappingLabel: 'Inventory Asset', fieldChanged: 'glAccountId', oldAccountName: undefined, newAccountName: '1400 - Inventory Asset' },
  { id: '3', createdAt: '2026-04-10T16:45:00Z', userName: 'Sandra Dunford', mappingSection: 'Dockage Rates', mappingLabel: '30ft Covered Slip', fieldChanged: 'glRevenueAccountId', oldAccountName: '4100 - Dockage Revenue', newAccountName: '4110 - Wet Slip Dockage' },
  { id: '4', createdAt: '2026-03-20T11:30:00Z', userName: 'Maria Santos', mappingSection: 'Product Categories', mappingLabel: 'Fuel - COGS', fieldChanged: 'glCogsAccountId', oldAccountName: undefined, newAccountName: '5100 - Fuel COGS' },
];

const MOCK_JOURNAL: JournalEntry[] = [
  {
    id: 'je1', postDate: '2026-04-28', description: 'PO-0048 inventory receipt — Gulf Coast Petroleum',
    lines: [
      { glAccount: { id: 'a8', name: 'Inventory Asset', type: 'OTHER_CURRENT_ASSET', accountNumber: '1400' }, debitCents: 219500, creditCents: 0 },
      { glAccount: { id: 'a9', name: 'Accounts Payable', type: 'ACCOUNTS_PAYABLE', accountNumber: '2000' }, debitCents: 0, creditCents: 219500 },
    ],
  },
  {
    id: 'je2', postDate: '2026-04-27', description: 'Fuel sale — slip 12A, James Harrison',
    lines: [
      { glAccount: { id: 'a1', name: 'Accounts Receivable', type: 'ACCOUNTS_RECEIVABLE', accountNumber: '1200' }, debitCents: 34500, creditCents: 0 },
      { glAccount: { id: 'a13', name: 'Fuel Revenue', type: 'INCOME', accountNumber: '4400' }, debitCents: 0, creditCents: 34500 },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────────────────────────── */

function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder = 'Select account…',
  filter,
}: {
  value: string;
  onChange: (id: string) => void;
  accounts: GlAccount[];
  placeholder?: string;
  filter?: (a: GlAccount) => boolean;
}) {
  const visible = filter ? accounts.filter(filter) : accounts;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '7px 10px',
        fontSize: '13px',
        border: '1px solid #E2E8F0',
        borderRadius: '6px',
        background: '#FFFFFF',
        color: value ? '#0A2342' : '#94A3B8',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      <option value="">{placeholder}</option>
      {visible.map((a) => (
        <option key={a.id} value={a.id}>
          {a.accountNumber ? `${a.accountNumber} — ` : ''}{a.name}
        </option>
      ))}
    </select>
  );
}

function SectionCard({
  title,
  icon,
  description,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', marginBottom: '16px', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
          padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: open ? '1px solid #F1F5F9' : 'none',
        }}
      >
        <span style={{ color: '#0A2342', display: 'flex', alignItems: 'center' }}>{icon}</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>{title}</div>
          {description && <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>{description}</div>}
        </div>
        {open ? <ChevronDown size={16} color="#64748B" /> : <ChevronRight size={16} color="#64748B" />}
      </button>
      {open && <div style={{ padding: '20px' }}>{children}</div>}
    </div>
  );
}

function MappingRow({
  label,
  description,
  icon,
  value,
  cogsValue,
  onChange,
  onCogsChange,
  accounts,
  showCogs,
  revenueFilter,
  cogsFilter,
}: {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  value: string;
  cogsValue?: string;
  onChange: (v: string) => void;
  onCogsChange?: (v: string) => void;
  accounts: GlAccount[];
  showCogs?: boolean;
  revenueFilter?: (a: GlAccount) => boolean;
  cogsFilter?: (a: GlAccount) => boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: showCogs ? '220px 1fr 1fr' : '220px 1fr',
      gap: '12px',
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '1px solid #F8FAFC',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {icon && <span style={{ color: '#64748B', display: 'flex', flexShrink: 0 }}>{icon}</span>}
        <div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#0A2342' }}>{label}</div>
          {description && <div style={{ fontSize: '11px', color: '#94A3B8' }}>{description}</div>}
        </div>
      </div>
      <AccountSelect
        value={value}
        onChange={onChange}
        accounts={accounts}
        placeholder="Revenue account…"
        filter={revenueFilter}
      />
      {showCogs && onCogsChange && (
        <AccountSelect
          value={cogsValue || ''}
          onChange={onCogsChange}
          accounts={accounts}
          placeholder="COGS account…"
          filter={cogsFilter}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'OPEN' | 'CLOSED' | 'LOCKED' }) {
  const config = {
    OPEN: { bg: '#F0FDF4', color: '#16A34A', text: 'Open' },
    CLOSED: { bg: '#FFF7ED', color: '#EA580C', text: 'Closed' },
    LOCKED: { bg: '#F1F5F9', color: '#475569', text: 'Locked' },
  }[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
      background: config.bg, color: config.color,
    }}>
      {status === 'OPEN' && <CheckCircle2 size={11} />}
      {status === 'CLOSED' && <Lock size={11} />}
      {status === 'LOCKED' && <Lock size={11} />}
      {config.text}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Main Page
───────────────────────────────────────────────────────────────── */

export default function AccountingHub() {
  const { getToken } = useAuth();
  const [locationId, setLocationId] = useState(LOCATIONS[0].id);
  const [activeTab, setActiveTab] = useState('mappings');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const [qboStatus, setQboStatus] = useState<QboStatus | null>(null);
  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  const [systemMaps, setSystemMaps] = useState<Record<string, string>>({});
  const [revenueMaps, setRevenueMaps] = useState<Record<string, string>>({});
  const [paymentMaps, setPaymentMaps] = useState<Record<string, string>>({});
  const [dockageRates, setDockageRates] = useState<DockageRate[]>([]);
  const [dockGlMaps, setDockGlMaps] = useState<Record<string, string>>({});
  const [rentalMode, setRentalMode] = useState<'SINGLE' | 'PER_PRODUCT'>('SINGLE');
  const [singleRentalAccount, setSingleRentalAccount] = useState('');
  const [rentalProducts, setRentalProducts] = useState<RentalProduct[]>([]);
  const [rentalGlMaps, setRentalGlMaps] = useState<Record<string, string>>({});
  const [serviceFees, setServiceFees] = useState<ServiceFee[]>([]);
  const [feeGlMaps, setFeeGlMaps] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [catRevMaps, setCatRevMaps] = useState<Record<string, string>>({});
  const [catCogsMaps, setCatCogsMaps] = useState<Record<string, string>>({});
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatCosting, setNewCatCosting] = useState<'WAC' | 'FIFO'>('WAC');

  // Fiscal periods
  const [fiscalPeriods, setFiscalPeriods] = useState<FiscalPeriod[]>([]);
  // Audit + journal
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [newPeriodName, setNewPeriodName] = useState('');
  const [newPeriodStart, setNewPeriodStart] = useState('');
  const [newPeriodEnd, setNewPeriodEnd] = useState('');

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Load all location-scoped data whenever locationId changes
  useEffect(() => {
    if (!locationId) return;
    setAccountsLoading(true);

    getToken().then(async (token) => {
      const q = `locationId=${locationId}`;

      await Promise.allSettled([
        // GL accounts (from QBO cache or seed)
        api.get<GlAccount[]>(`/accounting/chart-of-accounts?${q}`, token)
          .then(setAccounts).catch(() => setAccounts(MOCK_ACCOUNTS)),

        // QBO connection status
        api.get<QboStatus>(`/accounting/qbo/status?${q}`, token)
          .then(setQboStatus).catch(() => {}),

        // Account mappings (system / revenue / payment / dockage / fees / rentals / categories)
        api.get<{
          systemAccounts: { sourceKey: string; glAccountId: string }[];
          revenueStreams: { sourceKey: string; glAccountId: string }[];
          paymentMethods: { sourceKey: string; glAccountId: string }[];
          dockageRates: DockageRate[];
          serviceFees: ServiceFee[];
          rentalProducts: RentalProduct[];
          rentalGlMode: 'SINGLE' | 'PER_PRODUCT';
        }>(`/accounting/mappings?${q}`, token).then((d) => {
          setSystemMaps(Object.fromEntries(d.systemAccounts.map((m) => [m.sourceKey, m.glAccountId])));
          setRevenueMaps(Object.fromEntries(d.revenueStreams.map((m) => [m.sourceKey, m.glAccountId])));
          setPaymentMaps(Object.fromEntries(d.paymentMethods.map((m) => [m.sourceKey, m.glAccountId])));
          setDockageRates(d.dockageRates);
          setDockGlMaps(Object.fromEntries(d.dockageRates.map((r) => [r.id, (r as any).glRevenueAccountId || ''])));
          setServiceFees(d.serviceFees);
          setFeeGlMaps(Object.fromEntries(d.serviceFees.map((f) => [f.id, (f as any).glAccountId || ''])));
          setRentalProducts(d.rentalProducts);
          setRentalGlMaps(Object.fromEntries(d.rentalProducts.map((p) => [p.id, (p as any).glRevenueAccountId || ''])));
          setRentalMode(d.rentalGlMode);
        }).catch(() => {}),

        // Product categories
        api.get<ProductCategory[]>(`/accounting/categories?${q}`, token).then((cats) => {
          setCategories(cats);
          setCatRevMaps(Object.fromEntries(cats.map((c) => [c.id, c.glRevenueAccountId || ''])));
          setCatCogsMaps(Object.fromEntries(cats.map((c) => [c.id, c.glCogsAccountId || ''])));
        }).catch(() => {}),

        // Fiscal periods
        api.get<FiscalPeriod[]>(`/accounting/fiscal-periods?${q}`, token)
          .then(setFiscalPeriods).catch(() => {}),

        // Audit log
        api.get<AuditEntry[]>(`/accounting/audit-log?${q}`, token)
          .then(setAuditEntries).catch(() => {}),

        // Journal entries
        api.get<JournalEntry[]>(`/accounting/journal-entries?${q}`, token)
          .then(setJournalEntries).catch(() => {}),
      ]);

      setAccountsLoading(false);
    });
  }, [locationId, getToken]);

  async function handleCreateCategory() {
    if (!newCatName.trim()) return;
    try {
      const token = await getToken();
      const cat = await api.post<ProductCategory>(
        `/accounting/categories`,
        { locationId, name: newCatName.trim(), costingMethod: newCatCosting },
        token,
      );
      setCategories((prev) => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)));
      setCatRevMaps((p) => ({ ...p, [cat.id]: '' }));
      setCatCogsMaps((p) => ({ ...p, [cat.id]: '' }));
      setNewCatName('');
      setNewCatCosting('WAC');
      setAddingCat(false);
      showToast(`Category "${cat.name}" created`);
    } catch {
      showToast('Failed to create category', 'error');
    }
  }

  async function handleDeleteCategory(id: string, name: string) {
    try {
      const token = await getToken();
      await api.delete(`/accounting/categories/${id}`, token);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      showToast(`Category "${name}" removed`);
    } catch {
      showToast('Failed to remove category', 'error');
    }
  }

  async function handleSaveMappings() {
    setSaving(true);
    try {
      const token = await getToken();
      await api.put(
        `/accounting/mappings/bulk?locationId=${locationId}`,
        {
          systemAccounts: systemMaps,
          revenueStreams: revenueMaps,
          paymentMethods: paymentMaps,
          rentalMode,
          singleRentalAccountId: singleRentalAccount,
        },
        token,
      );
      showToast('Account mappings saved');
    } catch {
      showToast('Failed to save mappings', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleQboSync() {
    setSyncing(true);
    try {
      const token = await getToken();
      await api.post(`/accounting/qbo/sync?locationId=${locationId}`, {}, token);
      showToast('QBO sync complete');
    } catch {
      showToast('QBO sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function handlePeriodAction(id: string, action: 'close' | 'lock' | 'reopen') {
    try {
      const token = await getToken();
      await api.put(`/accounting/fiscal-periods/${id}/${action}?locationId=${locationId}`, {}, token);
      setFiscalPeriods((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          if (action === 'close') return { ...p, status: 'CLOSED' as const, closedAt: new Date().toISOString() };
          if (action === 'lock') return { ...p, status: 'LOCKED' as const, lockedAt: new Date().toISOString() };
          if (action === 'reopen') return { ...p, status: 'OPEN' as const, closedAt: undefined };
          return p;
        })
      );
      showToast(`Period ${action === 'reopen' ? 're-opened' : action + 'd'}`);
    } catch {
      showToast('Action failed', 'error');
    }
  }

  const selectedLocation = LOCATIONS.find((l) => l.id === locationId)!;

  const incomeFilter = (a: GlAccount) =>
    ['INCOME', 'OTHER_INCOME'].includes(a.type);
  const cogsFilter = (a: GlAccount) =>
    ['COST_OF_GOODS_SOLD', 'EXPENSE'].includes(a.type);
  const assetFilter = (a: GlAccount) =>
    ['BANK', 'OTHER_CURRENT_ASSET', 'ACCOUNTS_RECEIVABLE'].includes(a.type);
  const liabilityFilter = (a: GlAccount) =>
    ['OTHER_CURRENT_LIABILITY', 'ACCOUNTS_PAYABLE'].includes(a.type);

  /* ── render ── */
  return (
    <div style={{ fontFamily: 'inherit', maxWidth: '1200px' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
          padding: '12px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 500,
          background: toast.type === 'success' ? '#0A2342' : '#DC2626', color: '#FFFFFF',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0A2342', margin: 0 }}>
          Accounting Hub
        </h1>
        <p style={{ fontSize: '14px', color: '#64748B', marginTop: '4px' }}>
          QuickBooks Online integration, GL account mappings, fiscal periods, and audit trail.
        </p>
      </div>

      {/* Location + QBO status bar */}
      <div style={{
        background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px',
        padding: '16px 20px', marginBottom: '24px',
        display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '0 0 auto' }}>
          <Building2 size={18} color="#0A2342" />
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            style={{
              padding: '7px 12px', fontSize: '14px', fontWeight: 600,
              border: '1px solid #E2E8F0', borderRadius: '6px',
              color: '#0A2342', background: '#F8FAFC', cursor: 'pointer', outline: 'none',
            }}
          >
            {LOCATIONS.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        <div style={{ width: '1px', height: '32px', background: '#E2E8F0', flex: '0 0 auto' }} />

        {selectedLocation.qboConnected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={16} color="#16A34A" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#16A34A' }}>
                Connected to QBO
              </span>
            </div>
            {qboStatus.companyName && (
              <span style={{ fontSize: '13px', color: '#64748B' }}>
                {qboStatus.companyName}
              </span>
            )}
            {qboStatus.lastSync && (
              <span style={{ fontSize: '12px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={12} />
                Last sync: {new Date(qboStatus.lastSync).toLocaleString()}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <button
                onClick={handleQboSync}
                disabled={syncing}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 14px', fontSize: '13px', fontWeight: 500,
                  background: '#F1F5F9', border: '1px solid #E2E8F0',
                  borderRadius: '6px', cursor: 'pointer', color: '#0A2342',
                }}
              >
                <RefreshCw size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
                {syncing ? 'Syncing…' : 'Sync Now'}
              </button>
              <button
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 14px', fontSize: '13px', fontWeight: 500,
                  background: '#FFF1F0', border: '1px solid #FECACA',
                  borderRadius: '6px', cursor: 'pointer', color: '#DC2626',
                }}
              >
                <Link2Off size={13} />
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <AlertTriangle size={16} color="#EA580C" />
            <span style={{ fontSize: '13px', color: '#EA580C', fontWeight: 500 }}>
              Not connected to QuickBooks Online — transactions are blocked until connected.
            </span>
            <button
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', fontSize: '13px', fontWeight: 600,
                background: '#0A2342', border: 'none', borderRadius: '6px',
                cursor: 'pointer', color: '#FFFFFF',
              }}
            >
              <Link2 size={13} />
              Connect QuickBooks
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '2px solid #E2E8F0' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '10px 18px', fontSize: '14px', fontWeight: activeTab === t.id ? 600 : 400,
              color: activeTab === t.id ? '#0A2342' : '#64748B',
              background: 'none', border: 'none', borderBottom: activeTab === t.id ? '2px solid #0A2342' : '2px solid transparent',
              marginBottom: '-2px', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── MAPPINGS TAB ───────────────────────────────────────── */}
      {activeTab === 'mappings' && (
        <div>
          {accountsLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: '#F0F9FF', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: '#0369A1' }}>
              <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading accounts and mappings…
            </div>
          )}
          {!accountsLoading && accounts.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: '#C2410C' }}>
              <AlertTriangle size={14} /> No GL accounts found for this location. Connect QuickBooks or run the database seed to populate accounts.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
              Map every accounting event to a QuickBooks account for this location. Accounts are pulled from your connected QBO chart of accounts or the local GL account seed.
            </p>
            <button
              onClick={handleSaveMappings}
              disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0,
                padding: '9px 20px', fontSize: '14px', fontWeight: 600,
                background: '#0A2342', border: 'none', borderRadius: '7px',
                cursor: 'pointer', color: '#FFFFFF', marginLeft: '16px',
              }}
            >
              <Save size={15} />
              {saving ? 'Saving…' : 'Save All Mappings'}
            </button>
          </div>

          {/* Column headers for sections that have COGS */}
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr', gap: '12px', padding: '0 20px 8px', marginBottom: '4px' }}>
            <div />
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8' }}>
              Revenue / Asset Account
            </div>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8' }}>
              COGS Account
            </div>
          </div>

          {/* ── System Accounts ── */}
          <SectionCard
            title="System Accounts"
            icon={<Settings2 size={18} />}
            description="Core balance sheet accounts used across all transaction types"
          >
            {Object.entries(SYSTEM_ACCOUNT_LABELS).map(([key, meta]) => (
              <MappingRow
                key={key}
                label={meta.label}
                description={meta.description}
                icon={meta.icon}
                value={systemMaps[key] || ''}
                onChange={(v) => setSystemMaps((p) => ({ ...p, [key]: v }))}
                accounts={accounts}
                revenueFilter={
                  ['ACCOUNTS_RECEIVABLE', 'CASH', 'CARD_CLEARING', 'ACH_CLEARING', 'INVENTORY_ASSET'].includes(key)
                    ? assetFilter
                    : liabilityFilter
                }
              />
            ))}
          </SectionCard>

          {/* ── Revenue Streams ── */}
          <SectionCard
            title="Revenue Streams"
            icon={<BarChart3 size={18} />}
            description="Default GL account for each revenue type"
          >
            {Object.entries(REVENUE_STREAM_LABELS).map(([key, meta]) => (
              <MappingRow
                key={key}
                label={meta.label}
                icon={meta.icon}
                value={revenueMaps[key] || ''}
                onChange={(v) => setRevenueMaps((p) => ({ ...p, [key]: v }))}
                accounts={accounts}
                revenueFilter={incomeFilter}
              />
            ))}
          </SectionCard>

          {/* ── Payment Methods ── */}
          <SectionCard
            title="Payment Methods"
            icon={<CreditCard size={18} />}
            description="Clearing / cash accounts for each payment method"
          >
            {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => (
              <MappingRow
                key={key}
                label={label}
                value={paymentMaps[key] || ''}
                onChange={(v) => setPaymentMaps((p) => ({ ...p, [key]: v }))}
                accounts={accounts}
                revenueFilter={assetFilter}
              />
            ))}
          </SectionCard>

          {/* ── Dockage Rates ── */}
          <SectionCard
            title="Dockage Rates"
            icon={<Anchor size={18} />}
            description="Override GL account per slip type — falls back to Dockage Revenue stream if unset"
            defaultOpen={true}
          >
            <div style={{ marginBottom: '10px', padding: '10px 14px', background: '#F8FAFC', borderRadius: '6px', fontSize: '12px', color: '#64748B', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <AlertTriangle size={13} color="#94A3B8" />
              Unset slip types fall back to the Dockage Revenue stream mapping above.
            </div>
            {dockageRates.map((rate) => (
              <MappingRow
                key={rate.id}
                label={rate.slipType}
                description={rate.monthlyRate ? `$${(rate.monthlyRate / 100).toFixed(0)}/mo` : undefined}
                icon={<Anchor size={14} />}
                value={dockGlMaps[rate.id] || ''}
                onChange={(v) => setDockGlMaps((p) => ({ ...p, [rate.id]: v }))}
                accounts={accounts}
                revenueFilter={incomeFilter}
              />
            ))}
          </SectionCard>

          {/* ── Rentals ── */}
          <SectionCard
            title="Rental Revenue"
            icon={<Ship size={18} />}
            description="Single account for all rentals, or map per product"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', padding: '12px 16px', background: '#F8FAFC', borderRadius: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 500, color: '#0A2342' }}>Mapping mode:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: rentalMode === 'SINGLE' ? '#0A2342' : '#64748B', fontWeight: rentalMode === 'SINGLE' ? 600 : 400 }}>
                <input
                  type="radio" value="SINGLE" checked={rentalMode === 'SINGLE'}
                  onChange={() => setRentalMode('SINGLE')}
                  style={{ accentColor: '#0A2342' }}
                />
                Single account (all rentals)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: rentalMode === 'PER_PRODUCT' ? '#0A2342' : '#64748B', fontWeight: rentalMode === 'PER_PRODUCT' ? 600 : 400 }}>
                <input
                  type="radio" value="PER_PRODUCT" checked={rentalMode === 'PER_PRODUCT'}
                  onChange={() => setRentalMode('PER_PRODUCT')}
                  style={{ accentColor: '#0A2342' }}
                />
                Per product
              </label>
            </div>

            {rentalMode === 'SINGLE' ? (
              <MappingRow
                label="All Rental Products"
                icon={<Ship size={14} />}
                value={singleRentalAccount}
                onChange={setSingleRentalAccount}
                accounts={accounts}
                revenueFilter={incomeFilter}
              />
            ) : (
              rentalProducts.map((p) => (
                <MappingRow
                  key={p.id}
                  label={p.name}
                  icon={<Ship size={14} />}
                  value={rentalGlMaps[p.id] || ''}
                  onChange={(v) => setRentalGlMaps((prev) => ({ ...prev, [p.id]: v }))}
                  accounts={accounts}
                  revenueFilter={incomeFilter}
                />
              ))
            )}
          </SectionCard>

          {/* ── Service Fees ── */}
          <SectionCard
            title="Service Fees"
            icon={<Tag size={18} />}
            description="GL account for each configured service fee"
          >
            {serviceFees.map((fee) => (
              <MappingRow
                key={fee.id}
                label={fee.name}
                description={fee.amount ? `$${(fee.amount / 100).toFixed(2)} flat fee` : undefined}
                icon={<Tag size={14} />}
                value={feeGlMaps[fee.id] || ''}
                onChange={(v) => setFeeGlMaps((p) => ({ ...p, [fee.id]: v }))}
                accounts={accounts}
                revenueFilter={incomeFilter}
              />
            ))}
          </SectionCard>

          {/* ── Product Categories ── */}
          <SectionCard
            title="Product Categories"
            icon={<Package size={18} />}
            description="Revenue and COGS accounts per inventory category — drives all POS and inventory GL posts"
          >
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr', gap: '12px', padding: '0 0 8px', marginBottom: '8px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>Category</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>Revenue Account</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>COGS Account</div>
            </div>
            {categories.length === 0 && (
              <div style={{ fontSize: '13px', color: '#94A3B8', padding: '12px 0' }}>No categories yet — add one below.</div>
            )}
            {categories.map((cat) => (
              <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ flex: 1 }}>
                  <MappingRow
                    label={cat.name}
                    icon={<Package size={14} />}
                    value={catRevMaps[cat.id] || ''}
                    cogsValue={catCogsMaps[cat.id] || ''}
                    onChange={(v) => setCatRevMaps((p) => ({ ...p, [cat.id]: v }))}
                    onCogsChange={(v) => setCatCogsMaps((p) => ({ ...p, [cat.id]: v }))}
                    accounts={accounts}
                    showCogs
                    revenueFilter={incomeFilter}
                    cogsFilter={cogsFilter}
                  />
                </div>
                <button
                  onClick={() => handleDeleteCategory(cat.id, cat.name)}
                  title="Remove category"
                  style={{ background: 'none', border: 'none', color: '#CBD5E1', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                  onMouseOver={(e) => (e.currentTarget.style.color = '#EF4444')}
                  onMouseOut={(e) => (e.currentTarget.style.color = '#CBD5E1')}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {/* Inline create form */}
            {addingCat ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', padding: '12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCategory(); if (e.key === 'Escape') setAddingCat(false); }}
                  placeholder="Category name (e.g. Safety Equipment)"
                  style={{ flex: 1, padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', outline: 'none' }}
                />
                <select
                  value={newCatCosting}
                  onChange={(e) => setNewCatCosting(e.target.value as 'WAC' | 'FIFO')}
                  style={{ padding: '6px 8px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px' }}
                >
                  <option value="WAC">WAC</option>
                  <option value="FIFO">FIFO</option>
                </select>
                <button onClick={handleCreateCategory} style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 600, background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                  Add
                </button>
                <button onClick={() => { setAddingCat(false); setNewCatName(''); }} style={{ padding: '6px 10px', fontSize: '13px', color: '#64748B', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingCat(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: '#0A2342', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer' }}
              >
                <Plus size={14} /> Add Category
              </button>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── FISCAL PERIODS TAB ────────────────────────────────── */}
      {activeTab === 'fiscal' && (
        <div>
          {/* Create period form */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342', margin: '0 0 16px' }}>
              Open New Period
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 180px auto', gap: '12px', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: '4px' }}>Period Name</label>
                <input
                  type="text"
                  placeholder="e.g. May 2026"
                  value={newPeriodName}
                  onChange={(e) => setNewPeriodName(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: '4px' }}>Start Date</label>
                <input
                  type="date"
                  value={newPeriodStart}
                  onChange={(e) => setNewPeriodStart(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: '4px' }}>End Date</label>
                <input
                  type="date"
                  value={newPeriodEnd}
                  onChange={(e) => setNewPeriodEnd(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <button
                onClick={() => {
                  if (!newPeriodName || !newPeriodStart || !newPeriodEnd) return;
                  setFiscalPeriods((p) => [
                    { id: `fp-${Date.now()}`, name: newPeriodName, startDate: newPeriodStart, endDate: newPeriodEnd, status: 'OPEN' },
                    ...p,
                  ]);
                  setNewPeriodName(''); setNewPeriodStart(''); setNewPeriodEnd('');
                  showToast('Period created');
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', fontSize: '13px', fontWeight: 600,
                  background: '#0A2342', border: 'none', borderRadius: '6px',
                  cursor: 'pointer', color: '#FFFFFF', whiteSpace: 'nowrap',
                }}
              >
                <Plus size={14} />
                Create
              </button>
            </div>
          </div>

          {/* Period list */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  {['Period', 'Start', 'End', 'Status', 'Closed', 'Locked', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: '12px', fontWeight: 600, color: '#64748B', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fiscalPeriods.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>{p.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#64748B' }}>{new Date(p.startDate).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#64748B' }}>{new Date(p.endDate).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px' }}><StatusBadge status={p.status} /></td>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: '#94A3B8' }}>{p.closedAt ? new Date(p.closedAt).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: '#94A3B8' }}>{p.lockedAt ? new Date(p.lockedAt).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {p.status === 'OPEN' && (
                          <button
                            onClick={() => handlePeriodAction(p.id, 'close')}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '12px', fontWeight: 500, background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '5px', cursor: 'pointer', color: '#EA580C' }}
                          >
                            <Lock size={11} /> Close
                          </button>
                        )}
                        {p.status === 'CLOSED' && (
                          <>
                            <button
                              onClick={() => handlePeriodAction(p.id, 'lock')}
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '12px', fontWeight: 500, background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '5px', cursor: 'pointer', color: '#475569' }}
                            >
                              <Lock size={11} /> Lock
                            </button>
                            <button
                              onClick={() => handlePeriodAction(p.id, 'reopen')}
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '12px', fontWeight: 500, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '5px', cursor: 'pointer', color: '#16A34A' }}
                            >
                              <Unlock size={11} /> Re-open
                            </button>
                          </>
                        )}
                        {p.status === 'LOCKED' && (
                          <span style={{ fontSize: '12px', color: '#94A3B8', padding: '5px 0' }}>Locked — contact admin</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── AUDIT LOG TAB ─────────────────────────────────────── */}
      {activeTab === 'auditlog' && (
        <div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>
                GL Mapping Change History
              </h3>
              <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                Every account mapping change is recorded here with before/after values.
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  {['Date', 'User', 'Section', 'Mapping', 'Changed From', 'Changed To'].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: '12px', fontWeight: 600, color: '#64748B', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditEntries.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>No mapping changes recorded yet.</td></tr>
                )}
                {auditEntries.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: '#64748B', whiteSpace: 'nowrap' }}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 500, color: '#0A2342' }}>{entry.userName}</td>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: '#64748B' }}>{entry.mappingSection}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 500, color: '#0A2342' }}>{entry.mappingLabel}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#DC2626' }}>
                      {entry.oldAccountName ? (
                        <span style={{ padding: '2px 8px', background: '#FFF1F0', borderRadius: '4px' }}>{entry.oldAccountName}</span>
                      ) : <span style={{ color: '#94A3B8' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#16A34A' }}>
                      {entry.newAccountName ? (
                        <span style={{ padding: '2px 8px', background: '#F0FDF4', borderRadius: '4px' }}>{entry.newAccountName}</span>
                      ) : <span style={{ color: '#94A3B8' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── JOURNAL ENTRIES TAB ───────────────────────────────── */}
      {activeTab === 'journal' && (
        <div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>GL Journal</h3>
              <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                Auto-posted entries from invoices, payments, PO receipts, and COGS recognition.
              </span>
            </div>
            {journalEntries.length === 0 && (
              <div style={{ padding: '32px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>No journal entries yet. They appear automatically as invoices, payments, and inventory receipts are posted.</div>
            )}
            {journalEntries.map((je) => (
              <div key={je.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ padding: '12px 20px', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#64748B', minWidth: '80px' }}>
                    {new Date(je.postDate).toLocaleDateString()}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#0A2342' }}>{je.description}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#94A3B8' }}>#{je.id}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 20px', fontSize: '11px', fontWeight: 600, color: '#94A3B8', textAlign: 'left', textTransform: 'uppercase' }}>Account</th>
                      <th style={{ padding: '6px 20px', fontSize: '11px', fontWeight: 600, color: '#94A3B8', textAlign: 'right', textTransform: 'uppercase' }}>Debit</th>
                      <th style={{ padding: '6px 20px', fontSize: '11px', fontWeight: 600, color: '#94A3B8', textAlign: 'right', textTransform: 'uppercase' }}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {je.lines.map((line, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '8px 20px', fontSize: '13px', color: '#0A2342' }}>
                          {line.glAccount?.accountNumber && (
                            <span style={{ fontSize: '12px', color: '#94A3B8', marginRight: '8px' }}>{line.glAccount.accountNumber}</span>
                          )}
                          {line.glAccount?.name}
                        </td>
                        <td style={{ padding: '8px 20px', fontSize: '13px', textAlign: 'right', color: '#0A2342', fontFamily: 'monospace' }}>
                          {line.debitCents > 0 ? `$${(line.debitCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}
                        </td>
                        <td style={{ padding: '8px 20px', fontSize: '13px', textAlign: 'right', color: '#0A2342', fontFamily: 'monospace' }}>
                          {line.creditCents > 0 ? `$${(line.creditCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
