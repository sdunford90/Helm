import React, { useState } from 'react';
import { NotAvailable } from '../components/StateViews';
import {
  BillingSettingsSection,
  BrandingSection,
  IntegrationsSection,
  MarinaProfileSection,
  TeamSection,
} from '../components/SettingsSections';
import {
  Building2, Palette, CreditCard, Link, ShieldCheck,
  Settings as SettingsIcon, Plus, X, Eye, EyeOff,
  Trash2, CheckCircle2, AlertTriangle, RefreshCw, Key,
  Download, Globe, Webhook, Package, Search, Edit2,
  MapPin, Save, XCircle, ChevronDown, ToggleRight,
} from 'lucide-react';
import { useModules } from '../context/ModulesContext';

/* ── Types ─────────────────────────────────────────────── */

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'Active' | 'Invited' | 'Disabled';
  lastLogin: string;
  locations: string[];
}

interface DockageRate {
  id: string;
  slipType: string;
  monthlyRate: number;
  quarterlyRate: number;
  annualRate: number;
  electricityMode: 'Flat' | 'Metered';
  electricityRate: number;
  glAccount: string;
  active: boolean;
}

interface RentalProduct {
  id: string;
  name: string;
  type: string;
  hourlyRate: number;
  halfDayRate: number;
  dailyRate: number;
  damageWaiver: number;
  deposit: number;
  glAccount: string;
  active: boolean;
}

interface POSItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  cost: number;
  price: number;
  taxClass: string;
  glRevenueAccount: string;
  glCogsAccount: string;
  trackInventory: boolean;
  active: boolean;
}

interface ServiceFee {
  id: string;
  name: string;
  amount: number;
  glAccount: string;
  active: boolean;
}

interface ApiKeyEntry {
  id: string;
  name: string;
  key: string;
  created: string;
  lastUsed: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

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

export default function Settings() {
  const { modules, setModule } = useModules();
  const [tab, setTab] = useState<'profile' | 'branding' | 'billing' | 'catalog' | 'integrations' | 'team' | 'advanced' | 'modules'>('profile');

  const tabItems: { key: typeof tab; label: string; icon: typeof Building2 }[] = [
    { key: 'profile', label: 'Marina Profile', icon: Building2 },
    { key: 'branding', label: 'Branding', icon: Palette },
    { key: 'billing', label: 'Billing', icon: CreditCard },
    { key: 'catalog', label: 'Catalog', icon: Package },
    { key: 'integrations', label: 'Integrations', icon: Link },
    { key: 'team', label: 'Team & Roles', icon: ShieldCheck },
    { key: 'modules', label: 'Modules', icon: ToggleRight },
    { key: 'advanced', label: 'Advanced', icon: SettingsIcon },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Settings</h1>
      <hr style={st.divider} />

      <div style={st.tabs} className="helm-tabs">
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
      {tab === 'profile' && <MarinaProfileSection st={st} />}

      {/* Branding */}
      {tab === 'branding' && <BrandingSection st={st} />}

      {/* Billing */}
      {tab === 'billing' && <BillingSettingsSection st={st} />}

      {/* Catalog */}
      {tab === 'catalog' && (
        <NotAvailable
          title="Catalog & pricing is not connected yet"
          message="Dockage rate cards, rental products, service fees and catalog GL mapping are not stored by the server yet, so they cannot be edited here. POS products are managed on the POS page; rental products are part of the Rentals module, which is being rebuilt."
        />
      )}

      {/* Integrations */}
      {tab === 'integrations' && <IntegrationsSection st={st} />}

      {/* Team & Roles */}
      {tab === 'team' && <TeamSection st={st} />}

      {/* Modules */}
      {tab === 'modules' && (
        <div style={st.card}>
          <h3 style={st.sectionTitle}><ToggleRight size={20} /> Module Management</h3>
          <p style={{ color: '#64748B', fontSize: '14px', marginBottom: '24px', lineHeight: 1.6 }}>
            Show or hide optional modules in the navigation. This setting is stored in this browser only; it is not yet shared with other users of the marina.
          </p>
          {([
            {
              key: 'rentals' as const,
              label: 'Rentals',
              description: 'Boat, kayak, jet ski and equipment rentals. Being rebuilt in Phase 0: the page shows a notice until the new reservation API ships.',
            },
          ] as { key: keyof typeof modules; label: string; description: string }[]).map((mod) => (
            <div
              key={mod.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '24px',
                padding: '20px 0',
                borderBottom: '1px solid #F2F4F6',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '15px', color: '#0A2342', marginBottom: '4px' }}>{mod.label}</div>
                <div style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5 }}>{mod.description}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: modules[mod.key] ? '#03543F' : '#9CA3AF' }}>
                  {modules[mod.key] ? 'Enabled' : 'Disabled'}
                </span>
                <button
                  onClick={() => setModule(mod.key, !modules[mod.key])}
                  style={{
                    position: 'relative',
                    width: '44px',
                    height: '24px',
                    borderRadius: '12px',
                    border: 'none',
                    cursor: 'pointer',
                    background: modules[mod.key] ? '#00D4FF' : '#CBD5E1',
                    transition: 'background 0.2s',
                    padding: 0,
                    flexShrink: 0,
                  }}
                  title={modules[mod.key] ? 'Disable module' : 'Enable module'}
                >
                  <div style={{
                    position: 'absolute',
                    top: '3px',
                    left: modules[mod.key] ? '23px' : '3px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Advanced */}
      {tab === 'advanced' && (
        <NotAvailable
          title="Advanced settings are not available yet"
          message="Custom domains, API keys, full data export and marina deletion are not implemented in the API yet."
        />
      )}
    </div>
  );
}
