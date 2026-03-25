import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  Building2, Palette, CreditCard, Link, ShieldCheck,
  Settings as SettingsIcon, Plus, X, Eye, EyeOff,
  Trash2, CheckCircle2, AlertTriangle, RefreshCw, Key,
  Download, Globe, Webhook,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'Active' | 'Invited' | 'Disabled';
  lastLogin: string;
}

interface ApiKeyEntry {
  id: string;
  name: string;
  key: string;
  created: string;
  lastUsed: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

const TEAM: TeamMember[] = [
  { id: '1', name: 'Sarah Dunford', email: 'sarah@bayshoremarina.com', role: 'Marina Owner', status: 'Active', lastLogin: '2026-03-25 9:14 AM' },
  { id: '2', name: 'Jake Martinez', email: 'jake@bayshoremarina.com', role: 'Marina Manager', status: 'Active', lastLogin: '2026-03-25 8:02 AM' },
  { id: '3', name: 'Maria Santos', email: 'maria@bayshoremarina.com', role: 'Dock Staff', status: 'Active', lastLogin: '2026-03-24 6:45 PM' },
  { id: '4', name: 'Tom Anderson', email: 'tom@bayshoremarina.com', role: 'POS Cashier', status: 'Active', lastLogin: '2026-03-24 5:30 PM' },
  { id: '5', name: 'Lisa Chen', email: 'lisa@bayshoremarina.com', role: 'Accounting', status: 'Active', lastLogin: '2026-03-23 3:15 PM' },
  { id: '6', name: 'Robert Dockside', email: 'robert@bayshoremarina.com', role: 'Dock Staff', status: 'Invited', lastLogin: '—' },
];

const API_KEYS: ApiKeyEntry[] = [
  { id: '1', name: 'Production API', key: 'helm_live_sk_****************************a3f2', created: '2026-01-15', lastUsed: '2026-03-25' },
  { id: '2', name: 'Test API', key: 'helm_test_sk_****************************8b1c', created: '2026-02-20', lastUsed: '2026-03-20' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  'Marina Owner': ['Full access to all features', 'Manage team & roles', 'Billing & subscription', 'Delete marina'],
  'Marina Manager': ['Slips, contracts, billing', 'Customers & leads', 'Dock walks & operations', 'Reports & analytics'],
  'Dock Staff': ['Dock walks & inspections', 'Pump-outs', 'View slip status', 'Log violations'],
  'POS Cashier': ['POS transactions', 'Shift management', 'Product catalog (view)', 'Customer lookup'],
  'Accounting': ['Invoices & payments', 'GL & chart of accounts', 'Reports', 'Deferred revenue'],
  'Portal User': ['View own account', 'Pay invoices', 'Submit service requests', 'View announcements'],
};

/* ── Styles ─────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  tabs: { display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '32px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px', transition: 'all 0.15s' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  section: { marginBottom: '32px' },
  sectionTitle: { fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '20px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  fieldFull: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px', gridColumn: '1 / -1' },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const, width: '100%' },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer', width: '100%', boxSizing: 'border-box' as const },
  saveBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  addBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  outlineBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  dangerBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#DC2626', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '14px' },
  colorSwatch: { width: '40px', height: '40px', borderRadius: '8px', border: '2px solid #E2E8F0', cursor: 'pointer' },
  integrationCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', marginBottom: '16px' },
  integrationInfo: { display: 'flex', alignItems: 'center', gap: '16px' },
  integrationIcon: { width: '48px', height: '48px', borderRadius: '8px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  checkbox: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#0A2342', cursor: 'pointer', padding: '4px 0' },
  hoursGrid: { display: 'grid', gridTemplateColumns: '100px 1fr 1fr', gap: '8px', alignItems: 'center' },
  roleCard: { background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px', marginBottom: '12px' },
  roleTitle: { fontSize: '15px', fontWeight: 600, color: '#0A2342', marginBottom: '8px' },
  rolePerms: { fontSize: '13px', color: '#64748B', lineHeight: 1.8 },
  dangerZone: { border: '2px solid #FCA5A5', borderRadius: '8px', padding: '24px', background: '#FEF2F2' },
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ── Main Component ─────────────────────────────────────── */

/* ── GL Account Mapping Data ────────────────────────────── */

const GL_ACCOUNTS = [
  { code: '1010', name: 'Cash on Hand' },
  { code: '1020', name: 'Stripe Clearing' },
  { code: '1030', name: 'ACH Clearing' },
  { code: '4100', name: 'Slip Revenue' },
  { code: '4200', name: 'Electricity Revenue' },
  { code: '4300', name: 'Rental Revenue' },
  { code: '4400', name: 'Fuel Revenue' },
  { code: '4500', name: 'Retail Revenue' },
  { code: '4600', name: 'Transient Revenue' },
  { code: '4700', name: 'Ramp Revenue' },
  { code: '4800', name: 'Concierge Revenue' },
];

const REVENUE_MAPPING_DEFAULTS: { label: string; defaultGL: string }[] = [
  { label: 'Dockage Revenue', defaultGL: '4100' },
  { label: 'Electricity Revenue', defaultGL: '4200' },
  { label: 'Rental Revenue', defaultGL: '4300' },
  { label: 'Fuel Revenue', defaultGL: '4400' },
  { label: 'Retail / POS Revenue', defaultGL: '4500' },
  { label: 'Transient Revenue', defaultGL: '4600' },
  { label: 'Ramp Revenue', defaultGL: '4700' },
  { label: 'Concierge Revenue', defaultGL: '4800' },
];

interface PaymentTypeRow {
  id: string;
  name: string;
  defaultGL: string;
  availPOS: boolean;
  availBilling: boolean;
  active: boolean;
}

const PAYMENT_TYPE_DEFAULTS: PaymentTypeRow[] = [
  { id: 'card', name: 'Card', defaultGL: '1020', availPOS: true, availBilling: true, active: true },
  { id: 'ach', name: 'ACH', defaultGL: '1030', availPOS: true, availBilling: true, active: true },
  { id: 'cash', name: 'Cash', defaultGL: '1010', availPOS: true, availBilling: false, active: true },
  { id: 'check', name: 'Check', defaultGL: '1010', availPOS: false, availBilling: true, active: true },
  { id: 'wire', name: 'Wire', defaultGL: '1030', availPOS: false, availBilling: true, active: false },
  { id: 'charge', name: 'Charge to Slip', defaultGL: '1020', availPOS: true, availBilling: true, active: true },
];

const HELM_PAYMENT_TYPES_KEY = 'helm_payment_types';

function loadPaymentTypes(): PaymentTypeRow[] {
  try {
    const raw = localStorage.getItem(HELM_PAYMENT_TYPES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return PAYMENT_TYPE_DEFAULTS;
}

interface ProductGLRow {
  id: string;
  label: string;
  category: string;
  glAccount: string;
}

const PRODUCT_GL_DEFAULTS: ProductGLRow[] = [
  { id: 'wet-annual', label: 'Wet Slip — Annual', category: 'Dockage', glAccount: '4100' },
  { id: 'wet-monthly', label: 'Wet Slip — Monthly', category: 'Dockage', glAccount: '4100' },
  { id: 'dry-annual', label: 'Dry Storage — Annual', category: 'Dockage', glAccount: '4100' },
  { id: 'dry-monthly', label: 'Dry Storage — Monthly', category: 'Dockage', glAccount: '4100' },
  { id: 'transient-daily', label: 'Transient — Daily', category: 'Transient', glAccount: '4600' },
  { id: 'transient-weekly', label: 'Transient — Weekly', category: 'Transient', glAccount: '4600' },
  { id: 'electricity-metered', label: 'Electricity — Metered', category: 'Electricity', glAccount: '4200' },
  { id: 'electricity-flat', label: 'Electricity — Flat Rate', category: 'Electricity', glAccount: '4200' },
  { id: 'fuel-regular', label: 'Fuel — Regular Gasoline', category: 'Fuel', glAccount: '4400' },
  { id: 'fuel-diesel', label: 'Fuel — Diesel', category: 'Fuel', glAccount: '4400' },
  { id: 'fuel-premium', label: 'Fuel — Premium', category: 'Fuel', glAccount: '4400' },
  { id: 'ramp-daily', label: 'Launch Ramp — Daily', category: 'Ramp', glAccount: '4700' },
  { id: 'ramp-season', label: 'Launch Ramp — Season Pass', category: 'Ramp', glAccount: '4700' },
  { id: 'rental-pontoon', label: 'Rental — Pontoon Boat', category: 'Rental', glAccount: '4300' },
  { id: 'rental-jetski', label: 'Rental — Jet Ski', category: 'Rental', glAccount: '4300' },
  { id: 'rental-kayak', label: 'Rental — Kayak / Paddle', category: 'Rental', glAccount: '4300' },
  { id: 'concierge-svc', label: 'Concierge Services', category: 'Concierge', glAccount: '4800' },
  { id: 'pos-retail', label: 'POS — Retail / Provisions', category: 'Retail', glAccount: '4500' },
  { id: 'pos-bait', label: 'POS — Bait & Tackle', category: 'Retail', glAccount: '4500' },
  { id: 'pos-apparel', label: 'POS — Apparel', category: 'Retail', glAccount: '4500' },
];

export default function Settings() {
  const [tab, setTab] = useState<'profile' | 'branding' | 'billing' | 'integrations' | 'team' | 'advanced'>('profile');

  // API calls
  const { data: apiSettings, loading: settingsLoading } = useApi<any>('get', '/api/settings', { immediate: true });
  const { execute: updateSettings, loading: savingSettings } = useApi<any>('put', '/api/settings');
  const { data: apiTeam, loading: teamLoading } = useApi<TeamMember[]>('get', '/api/settings/team', { immediate: true });

  // Use API data when available, fall back to mock
  const teamMembers = apiTeam ?? TEAM;

  // GL Account Mapping state
  const [revenueMapping, setRevenueMapping] = useState<Record<string, string>>(
    Object.fromEntries(REVENUE_MAPPING_DEFAULTS.map((r) => [r.label, r.defaultGL]))
  );
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeRow[]>(loadPaymentTypes);
  const [productGLRows, setProductGLRows] = useState<ProductGLRow[]>(PRODUCT_GL_DEFAULTS);

  const updatePaymentType = (id: string, field: keyof PaymentTypeRow, value: any) => {
    setPaymentTypes((prev) => prev.map((pt) => pt.id === id ? { ...pt, [field]: value } : pt));
  };

  const updateProductGL = (id: string, glAccount: string) => {
    setProductGLRows((prev) => prev.map((p) => p.id === id ? { ...p, glAccount } : p));
  };

  const saveBillingSettings = () => {
    localStorage.setItem(HELM_PAYMENT_TYPES_KEY, JSON.stringify(paymentTypes));
    updateSettings({ tab: 'billing', paymentTypes, productGLRows });
  };

  const tabItems: { key: typeof tab; label: string; icon: typeof Building2 }[] = [
    { key: 'profile', label: 'Marina Profile', icon: Building2 },
    { key: 'branding', label: 'Branding', icon: Palette },
    { key: 'billing', label: 'Billing', icon: CreditCard },
    { key: 'integrations', label: 'Integrations', icon: Link },
    { key: 'team', label: 'Team & Roles', icon: ShieldCheck },
    { key: 'advanced', label: 'Advanced', icon: SettingsIcon },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title}>Settings</h1>
      <hr style={st.divider} />

      <div style={st.tabs}>
        {tabItems.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}), display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setTab(t.key)}>
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Marina Profile */}
      {tab === 'profile' && (
        <div style={st.card}>
          <h3 style={st.sectionTitle}><Building2 size={20} /> Marina Profile</h3>
          <div style={st.formGrid}>
            <div style={st.field}>
              <label style={st.label}>Marina Name</label>
              <input style={st.input} defaultValue="Bayshore Marina" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Phone</label>
              <input style={st.input} defaultValue="(555) 234-5678" />
            </div>
            <div style={st.fieldFull}>
              <label style={st.label}>Street Address</label>
              <input style={st.input} defaultValue="1200 Harbor Drive" />
            </div>
            <div style={st.field}>
              <label style={st.label}>City</label>
              <input style={st.input} defaultValue="Bayshore" />
            </div>
            <div style={st.field}>
              <label style={st.label}>State</label>
              <input style={st.input} defaultValue="FL" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Zip Code</label>
              <input style={st.input} defaultValue="33541" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Email</label>
              <input style={st.input} defaultValue="info@bayshoremarina.com" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Website</label>
              <input style={st.input} defaultValue="https://bayshoremarina.com" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Timezone</label>
              <select style={st.select} defaultValue="America/New_York">
                <option value="America/New_York">Eastern (ET)</option>
                <option value="America/Chicago">Central (CT)</option>
                <option value="America/Denver">Mountain (MT)</option>
                <option value="America/Los_Angeles">Pacific (PT)</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Fiscal Year Start</label>
              <select style={st.select} defaultValue="1">
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={st.section}>
            <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342', marginBottom: '12px' }}>Operating Hours</h4>
            <div style={st.hoursGrid}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748B' }}>Day</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748B' }}>Open</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748B' }}>Close</div>
              {DAYS.map((day) => (
                <React.Fragment key={day}>
                  <div style={{ fontSize: '14px', color: '#0A2342' }}>{day}</div>
                  <input style={st.input} type="time" defaultValue={day === 'Sunday' ? '08:00' : '06:00'} />
                  <input style={st.input} type="time" defaultValue={day === 'Sunday' ? '18:00' : '20:00'} />
                </React.Fragment>
              ))}
            </div>
          </div>
          <button style={st.saveBtn} onClick={() => updateSettings({ tab: 'profile' })} disabled={savingSettings}>
            {savingSettings ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Branding */}
      {tab === 'branding' && (
        <>
          <div style={st.card}>
            <h3 style={st.sectionTitle}><Palette size={20} /> Brand Colors</h3>
            <div style={{ display: 'flex', gap: '32px', marginBottom: '24px' }}>
              <div>
                <div style={st.label}>Primary</div>
                <div style={{ ...st.colorSwatch, backgroundColor: '#0A2342', marginTop: '8px' }} />
                <div style={{ ...st.mono, fontSize: '12px', marginTop: '4px', color: '#64748B' }}>#0A2342</div>
              </div>
              <div>
                <div style={st.label}>Secondary</div>
                <div style={{ ...st.colorSwatch, backgroundColor: '#2E4A6B', marginTop: '8px' }} />
                <div style={{ ...st.mono, fontSize: '12px', marginTop: '4px', color: '#64748B' }}>#2E4A6B</div>
              </div>
              <div>
                <div style={st.label}>Accent</div>
                <div style={{ ...st.colorSwatch, backgroundColor: '#00D4FF', marginTop: '8px' }} />
                <div style={{ ...st.mono, fontSize: '12px', marginTop: '4px', color: '#64748B' }}>#00D4FF</div>
              </div>
            </div>
          </div>
          <div style={st.card}>
            <h3 style={st.sectionTitle}>Logo</h3>
            <div style={{ width: '200px', height: '120px', borderRadius: '8px', background: '#F8FAFC', border: '2px dashed #CBD5E1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: '16px' }}>
              <Building2 size={32} style={{ color: '#94A3B8', marginBottom: '8px' }} />
              <span style={{ fontSize: '13px', color: '#64748B' }}>Drop logo here or click to upload</span>
            </div>
          </div>
          <div style={st.card}>
            <h3 style={st.sectionTitle}>Invoice Header</h3>
            <div style={st.formGrid}>
              <div style={st.field}>
                <label style={st.label}>Company Display Name</label>
                <input style={st.input} defaultValue="Bayshore Marina LLC" />
              </div>
              <div style={st.field}>
                <label style={st.label}>Tagline</label>
                <input style={st.input} defaultValue="Your home on the water" />
              </div>
            </div>
            <button style={st.saveBtn} onClick={() => updateSettings({ tab: 'branding' })} disabled={savingSettings}>
              {savingSettings ? 'Saving...' : 'Save Branding'}
            </button>
          </div>
        </>
      )}

      {/* Billing */}
      {tab === 'billing' && (
        <>
          <div style={st.card}>
            <h3 style={st.sectionTitle}><CreditCard size={20} /> Payment Terms</h3>
            <div style={st.formGrid}>
              <div style={st.field}>
                <label style={st.label}>Default Payment Terms</label>
                <select style={st.select} defaultValue="30">
                  <option value="15">Net 15</option>
                  <option value="30">Net 30</option>
                  <option value="45">Net 45</option>
                  <option value="60">Net 60</option>
                </select>
              </div>
              <div style={st.field}>
                <label style={st.label}>Late Fee (%)</label>
                <input style={st.input} type="number" defaultValue="1.5" step="0.1" />
              </div>
              <div style={st.field}>
                <label style={st.label}>Grace Period (days)</label>
                <input style={st.input} type="number" defaultValue="5" />
              </div>
              <div style={st.field}>
                <label style={st.label}>Default Tax Rate (%)</label>
                <input style={st.input} type="number" defaultValue="7.0" step="0.1" />
              </div>
              <div style={st.field}>
                <label style={st.label}>Tax ID / EIN</label>
                <input style={st.input} defaultValue="XX-XXXXXXX" />
              </div>
            </div>
          </div>
          <div style={st.card}>
            <h3 style={st.sectionTitle}>Invoice Numbering</h3>
            <div style={st.formGrid}>
              <div style={st.field}>
                <label style={st.label}>Prefix</label>
                <input style={st.input} defaultValue="INV-" />
              </div>
              <div style={st.field}>
                <label style={st.label}>Next Number</label>
                <input style={st.input} type="number" defaultValue="1048" />
              </div>
            </div>
          </div>
          <div style={st.card}>
            <h3 style={st.sectionTitle}>Auto-Charge</h3>
            <label style={st.checkbox}>
              <input type="checkbox" defaultChecked /> Auto-charge customers on invoice generation (requires payment method on file)
            </label>
          </div>
          <div style={st.card}>
            <h3 style={st.sectionTitle}>Accepted Payment Methods</h3>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              {['Credit/Debit Card', 'ACH / Bank Transfer', 'Cash', 'Check', 'Wire Transfer'].map((m) => (
                <label key={m} style={st.checkbox}>
                  <input type="checkbox" defaultChecked={m !== 'Wire Transfer'} /> {m}
                </label>
              ))}
            </div>
          </div>

          {/* ── GL Account Mapping ────────────────────────── */}
          <div style={{ marginTop: '8px', marginBottom: '32px' }}>
            <h3 style={{ ...st.sectionTitle, fontSize: '20px', marginBottom: '20px' }}>GL Account Mapping</h3>

            {/* Revenue Account Mapping */}
            <div style={st.card}>
              <h3 style={st.sectionTitle}>Revenue Account Mapping</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {REVENUE_MAPPING_DEFAULTS.map((rev) => (
                  <div key={rev.label} style={st.field}>
                    <label style={st.label}>{rev.label}</label>
                    <select
                      style={st.select}
                      value={revenueMapping[rev.label] || rev.defaultGL}
                      onChange={(e) => setRevenueMapping((prev) => ({ ...prev, [rev.label]: e.target.value }))}
                    >
                      {GL_ACCOUNTS.filter((gl) => gl.code.startsWith('4')).map((gl) => (
                        <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Product GL Mapping */}
            <div style={st.card}>
              <h3 style={st.sectionTitle}>Product GL Mapping</h3>
              <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '16px', lineHeight: 1.6 }}>
                Map individual product types to specific GL accounts. Use this when different products in the same category (e.g., wet vs. dry dockage) need to post to different accounts.
              </p>
              {(() => {
                const categories = [...new Set(productGLRows.map((p) => p.category))];
                const revenueGLs = GL_ACCOUNTS.filter((gl) => gl.code.startsWith('4'));
                return categories.map((cat) => (
                  <div key={cat} style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#2E4A6B', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid #E2E8F0' }}>
                      {cat}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      {productGLRows.filter((p) => p.category === cat).map((row) => (
                        <div key={row.id} style={st.field}>
                          <label style={st.label}>{row.label}</label>
                          <select
                            style={st.select}
                            value={row.glAccount}
                            onChange={(e) => updateProductGL(row.id, e.target.value)}
                          >
                            {revenueGLs.map((gl) => (
                              <option key={gl.code} value={gl.code}>{gl.code} — {gl.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Payment Type Configuration */}
            <div style={st.card}>
              <h3 style={st.sectionTitle}>Payment Type Configuration</h3>
              <div style={st.tableWrap}>
                <table style={st.table}>
                  <thead>
                    <tr>
                      <th style={st.th}>Payment Type</th>
                      <th style={st.th}>GL Account</th>
                      <th style={{ ...st.th, textAlign: 'center' }}>Available for POS</th>
                      <th style={{ ...st.th, textAlign: 'center' }}>Available for Billing</th>
                      <th style={{ ...st.th, textAlign: 'center' }}>Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentTypes.map((pt, idx) => {
                      const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                      return (
                        <tr key={pt.id}>
                          <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{pt.name}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>
                            <select
                              style={{ ...st.select, width: '220px' }}
                              value={pt.defaultGL}
                              onChange={(e) => updatePaymentType(pt.id, 'defaultGL', e.target.value)}
                            >
                              {GL_ACCOUNTS.filter((gl) => gl.code.startsWith('1')).map((gl) => (
                                <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>
                            <input type="checkbox" checked={pt.availPOS} onChange={(e) => updatePaymentType(pt.id, 'availPOS', e.target.checked)} />
                          </td>
                          <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>
                            <input type="checkbox" checked={pt.availBilling} onChange={(e) => updatePaymentType(pt.id, 'availBilling', e.target.checked)} />
                          </td>
                          <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>
                            <input type="checkbox" checked={pt.active} onChange={(e) => updatePaymentType(pt.id, 'active', e.target.checked)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <button style={st.saveBtn} onClick={saveBillingSettings} disabled={savingSettings}>
            {savingSettings ? 'Saving...' : 'Save Billing Settings'}
          </button>
        </>
      )}

      {/* Integrations */}
      {tab === 'integrations' && (
        <>
          <div style={st.integrationCard}>
            <div style={st.integrationInfo}>
              <div style={st.integrationIcon}><CreditCard size={24} style={{ color: '#635BFF' }} /></div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>Stripe Connect</div>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>Accept payments and process payouts</div>
                <div style={{ marginTop: '8px' }}>
                  <span style={{ ...st.badge, backgroundColor: '#DEF7EC', color: '#03543F' }}>Connected</span>
                  <span style={{ ...st.mono, fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>acct_1Nq****Yz8x</span>
                </div>
              </div>
            </div>
            <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }}>Disconnect</button>
          </div>

          <div style={st.integrationCard}>
            <div style={st.integrationInfo}>
              <div style={st.integrationIcon}><Building2 size={24} style={{ color: '#2CA01C' }} /></div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>QuickBooks Online</div>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>Sync invoices, payments, and customers</div>
                <div style={{ marginTop: '8px' }}>
                  <span style={{ ...st.badge, backgroundColor: '#DEF7EC', color: '#03543F' }}>Connected</span>
                  <span style={{ fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>Realm: 12345678 | Last sync: Mar 25, 2026 8:00 AM</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={st.outlineBtn}><RefreshCw size={14} /> Sync Now</button>
              <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }}>Disconnect</button>
            </div>
          </div>

          <div style={{ ...st.card, marginTop: '24px' }}>
            <h3 style={st.sectionTitle}><Webhook size={20} /> Webhook Endpoints</h3>
            <div style={st.tableWrap}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>URL</th>
                    <th style={st.th}>Events</th>
                    <th style={st.th}>Status</th>
                    <th style={st.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ ...st.td, ...st.mono, fontSize: '13px' }}>https://hooks.example.com/helm</td>
                    <td style={st.td}>invoice.created, payment.received</td>
                    <td style={st.td}><span style={{ ...st.badge, backgroundColor: '#DEF7EC', color: '#03543F' }}>Active</span></td>
                    <td style={st.td}><button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>Edit</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button style={{ ...st.outlineBtn, marginTop: '16px' }}><Plus size={14} /> Add Endpoint</button>
          </div>
        </>
      )}

      {/* Team & Roles */}
      {tab === 'team' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ ...st.sectionTitle, marginBottom: 0 }}><ShieldCheck size={20} /> Team Members</h3>
            <button style={st.addBtn}><Plus size={16} /> Invite Team Member</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Name</th>
                  <th style={st.th}>Email</th>
                  <th style={st.th}>Role</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Last Login</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map((m, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const statusColors: Record<string, { bg: string; color: string }> = {
                    Active: { bg: '#DEF7EC', color: '#03543F' },
                    Invited: { bg: '#E0F7FF', color: '#0A2342' },
                    Disabled: { bg: '#F3F4F6', color: '#64748B' },
                  };
                  const sc = statusColors[m.status];
                  return (
                    <tr key={m.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{m.name}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px' }}>{m.email}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: '#E0F7FF', color: '#0A2342' }}>{m.role}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{m.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px', color: m.lastLogin === '—' ? '#94A3B8' : '#0A2342' }}>{m.lastLogin}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '32px' }}>
            <h3 style={st.sectionTitle}>Role Permissions</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => (
                <div key={role} style={st.roleCard}>
                  <div style={st.roleTitle}>{role}</div>
                  <div style={st.rolePerms}>
                    {perms.map((p) => (
                      <div key={p}>• {p}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Advanced */}
      {tab === 'advanced' && (
        <>
          <div style={st.card}>
            <h3 style={st.sectionTitle}><Globe size={20} /> Custom Domain</h3>
            <div style={st.formGrid}>
              <div style={st.field}>
                <label style={st.label}>Custom Domain</label>
                <input style={st.input} placeholder="marina.yourdomain.com" defaultValue="app.bayshoremarina.com" />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '16px' }}>
                <button style={st.outlineBtn}>Verify DNS</button>
              </div>
            </div>
            <div style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.6, background: '#F8FAFC', padding: '12px 16px', borderRadius: '6px' }}>
              Add a CNAME record pointing <code style={st.mono}>app.bayshoremarina.com</code> to <code style={st.mono}>custom.helmapp.io</code>
            </div>
          </div>

          <div style={st.card}>
            <h3 style={st.sectionTitle}><Key size={20} /> API Keys</h3>
            <div style={st.tableWrap}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>Name</th>
                    <th style={st.th}>Key</th>
                    <th style={st.th}>Created</th>
                    <th style={st.th}>Last Used</th>
                    <th style={st.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {API_KEYS.map((k, idx) => {
                    const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                    return (
                      <tr key={k.id}>
                        <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{k.name}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontSize: '12px' }}>{k.key}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{k.created}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{k.lastUsed}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>
                          <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>Revoke</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button style={{ ...st.outlineBtn, marginTop: '16px' }}><Plus size={14} /> Generate New Key</button>
          </div>

          <div style={st.card}>
            <h3 style={st.sectionTitle}><Download size={20} /> Data Export</h3>
            <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '16px' }}>Export all marina data including customers, contracts, invoices, and transactions as a ZIP archive.</p>
            <button style={st.outlineBtn}><Download size={14} /> Export All Data</button>
          </div>

          <div style={st.dangerZone}>
            <h3 style={{ ...st.sectionTitle, color: '#DC2626' }}><AlertTriangle size={20} /> Danger Zone</h3>
            <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '16px' }}>Permanently delete this marina and all associated data. This action cannot be undone.</p>
            <button style={st.dangerBtn}><Trash2 size={14} /> Delete Marina</button>
          </div>
        </>
      )}
    </div>
  );
}
