import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { useBranding } from '../context/BrandingContext';
import {
  Building2, Palette, CreditCard, Link, ShieldCheck,
  Settings as SettingsIcon, Plus, X, Eye, EyeOff,
  Trash2, CheckCircle2, AlertTriangle, RefreshCw, Key,
  Download, Globe, Webhook, Package, Search, Edit2,
  MapPin, Save, XCircle, ChevronDown, ToggleRight,
  Lock, Shield, Users, Landmark, Percent,
} from 'lucide-react';
import { useModules } from '../context/ModulesContext';

/* ── OAuth Popup utility ────────────────────────────────── */

function openOAuthPopup(url: string, onComplete: () => void): void {
  const w = 660, h = 740;
  const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
  const popup = window.open(
    url, 'helm_oauth',
    `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes,toolbar=no,menubar=no`,
  );

  if (!popup) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  const handleMessage = (e: MessageEvent) => {
    if (e.data?.type === 'helm_oauth_complete') {
      cleanup();
      onComplete();
    }
  };

  const poll = setInterval(() => {
    if (popup.closed) { cleanup(); onComplete(); }
  }, 600);

  function cleanup() {
    clearInterval(poll);
    window.removeEventListener('message', handleMessage);
  }

  window.addEventListener('message', handleMessage);
}

/* ── Types ─────────────────────────────────────────────── */

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  roleEnum: string;
  status: 'Active' | 'Invited' | 'Disabled';
  lastLogin: string;
  locations: string[];
}

interface ApiUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  active: boolean;
  createdAt: string;
}

const ROLE_ENUM_TO_DISPLAY: Record<string, string> = {
  MARINA_OWNER: 'Marina Owner',
  MARINA_MANAGER: 'Marina Manager',
  DOCK_STAFF: 'Dock Staff',
  POS_CASHIER: 'POS Cashier',
  ACCOUNTING: 'Accounting',
};

const ROLE_DISPLAY_TO_ENUM: Record<string, string> = {
  'Marina Owner': 'MARINA_OWNER',
  'Marina Manager': 'MARINA_MANAGER',
  'Dock Staff': 'DOCK_STAFF',
  'POS Cashier': 'POS_CASHIER',
  'Accounting': 'ACCOUNTING',
};

function normalizeApiUser(u: ApiUser): TeamMember {
  return {
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
    email: u.email,
    role: ROLE_ENUM_TO_DISPLAY[u.role] ?? u.role,
    roleEnum: u.role,
    status: u.active ? 'Active' : 'Disabled',
    lastLogin: '—',
    locations: [],
  };
}

interface RolePermission {
  id: string;
  roleId: string;
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  color: string;
  isSystem: boolean;
  permissions: RolePermission[];
  _count?: { users: number };
}

const PERMISSION_MODULES = [
  { key: 'dashboard',     label: 'Dashboard',              group: 'Overview' },
  { key: 'slips',         label: 'Slip Management',        group: 'Operations' },
  { key: 'contracts',     label: 'Contracts',              group: 'Operations' },
  { key: 'transient',     label: 'Transient Bookings',     group: 'Operations' },
  { key: 'customers',     label: 'Customers',              group: 'Operations' },
  { key: 'work_orders',   label: 'Work Orders',            group: 'Operations' },
  { key: 'waitlist',      label: 'Waitlist',               group: 'Operations' },
  { key: 'concierge',     label: 'Concierge Requests',     group: 'Operations' },
  { key: 'invoices',      label: 'Invoices',               group: 'Finance' },
  { key: 'payments',      label: 'Payments',               group: 'Finance' },
  { key: 'reports',       label: 'Reports & Analytics',    group: 'Finance' },
  { key: 'billing',       label: 'Billing & Subscription', group: 'Finance' },
  { key: 'gl_accounts',   label: 'GL / Chart of Accounts', group: 'Finance' },
  { key: 'rentals',       label: 'Rentals',                group: 'Revenue' },
  { key: 'pos',           label: 'Point of Sale',          group: 'Revenue' },
  { key: 'inventory',     label: 'Inventory',              group: 'Revenue' },
  { key: 'announcements', label: 'Announcements',          group: 'Communication' },
  { key: 'team',          label: 'Team & Roles',           group: 'Admin' },
  { key: 'settings',      label: 'Settings',               group: 'Admin' },
  { key: 'integrations',  label: 'Integrations',           group: 'Admin' },
] as const;

const MODULE_GROUPS = [...new Set(PERMISSION_MODULES.map((m) => m.group))];

interface DockageRate {
  id: string;
  locationId: string;
  slipType: string;
  monthlyRate: number;
  quarterlyRate: number;
  annualRate: number;
  electricityMode: 'FLAT_FEE' | 'METERED';
  electricityRate: number;
  glAccount: string;
  taxClass: string;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string;
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
  taxClass: string;
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
  locationId: string;
  name: string;
  feeType: 'FLAT' | 'PERCENT';
  amount: number;
  glAccount: string;
  taxClass: string;
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

interface MarinaLocation { id: string; name: string; active?: boolean; }

const TEAM: TeamMember[] = [
  { id: '1', name: 'Sarah Dunford', email: 'sarah@bayshoremarina.com', role: 'Marina Owner', roleEnum: 'MARINA_OWNER', status: 'Active', lastLogin: '2026-03-25 9:14 AM', locations: ['Main Dock', 'Fuel Dock', 'Rental Center'] },
  { id: '2', name: 'Jake Martinez', email: 'jake@bayshoremarina.com', role: 'Marina Manager', roleEnum: 'MARINA_MANAGER', status: 'Active', lastLogin: '2026-03-25 8:02 AM', locations: ['Main Dock', 'Fuel Dock'] },
  { id: '3', name: 'Maria Santos', email: 'maria@bayshoremarina.com', role: 'Dock Staff', roleEnum: 'DOCK_STAFF', status: 'Active', lastLogin: '2026-03-24 6:45 PM', locations: ['Main Dock'] },
  { id: '4', name: 'Tom Anderson', email: 'tom@bayshoremarina.com', role: 'POS Cashier', roleEnum: 'POS_CASHIER', status: 'Active', lastLogin: '2026-03-24 5:30 PM', locations: ['Main Dock', 'Rental Center'] },
  { id: '5', name: 'Lisa Chen', email: 'lisa@bayshoremarina.com', role: 'Accounting', roleEnum: 'ACCOUNTING', status: 'Active', lastLogin: '2026-03-23 3:15 PM', locations: ['Main Dock', 'Fuel Dock', 'Rental Center'] },
  { id: '6', name: 'Robert Dockside', email: 'robert@bayshoremarina.com', role: 'Dock Staff', roleEnum: 'DOCK_STAFF', status: 'Invited', lastLogin: '—', locations: ['Fuel Dock'] },
];

const DOCKAGE_RATES_DATA: DockageRate[] = [];

const RENTAL_PRODUCTS_DATA: RentalProduct[] = [
  { id: 'r1', name: '20ft Pontoon - Sun Tracker', type: 'Pontoon', hourlyRate: 75, halfDayRate: 225, dailyRate: 395, damageWaiver: 35, deposit: 500, glAccount: '4300', taxClass: 'Tax Exempt', active: true },
  { id: 'r2', name: '22ft Pontoon - Bennington', type: 'Pontoon', hourlyRate: 95, halfDayRate: 275, dailyRate: 475, damageWaiver: 40, deposit: 500, glAccount: '4300', taxClass: 'Tax Exempt', active: true },
  { id: 'r3', name: 'Yamaha WaveRunner EX', type: 'Jet Ski', hourlyRate: 85, halfDayRate: 250, dailyRate: 425, damageWaiver: 30, deposit: 300, glAccount: '4300', taxClass: 'Tax Exempt', active: true },
  { id: 'r4', name: 'Sea-Doo Spark Trixx', type: 'Jet Ski', hourlyRate: 75, halfDayRate: 220, dailyRate: 375, damageWaiver: 30, deposit: 300, glAccount: '4300', taxClass: 'Tax Exempt', active: true },
  { id: 'r5', name: '17ft Boston Whaler', type: 'Motorboat', hourlyRate: 110, halfDayRate: 325, dailyRate: 550, damageWaiver: 45, deposit: 750, glAccount: '4300', taxClass: 'Tax Exempt', active: true },
  { id: 'r6', name: 'Hobie Cat 16', type: 'Sailboat', hourlyRate: 55, halfDayRate: 160, dailyRate: 275, damageWaiver: 25, deposit: 400, glAccount: '4300', taxClass: 'Tax Exempt', active: false },
];

const POS_ITEMS_DATA: POSItem[] = [
  { id: 'p1', sku: 'FUEL-UNL87', name: 'Unleaded 87', category: 'Fuel', cost: 3.10, price: 4.29, taxClass: 'Fuel Tax', glRevenueAccount: '4400', glCogsAccount: '5100', trackInventory: true, active: true },
  { id: 'p2', sku: 'FUEL-DSL', name: 'Marine Diesel', category: 'Fuel', cost: 3.45, price: 4.79, taxClass: 'Fuel Tax', glRevenueAccount: '4400', glCogsAccount: '5100', trackInventory: true, active: true },
  { id: 'p3', sku: 'BAIT-SHRMP', name: 'Live Shrimp (dozen)', category: 'Bait', cost: 2.50, price: 5.99, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true },
  { id: 'p4', sku: 'BAIT-MNOW', name: 'Minnows (bucket)', category: 'Bait', cost: 1.75, price: 4.49, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true },
  { id: 'p5', sku: 'MRN-OIL2T', name: '2-Stroke Engine Oil (qt)', category: 'Marine', cost: 6.50, price: 12.99, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true },
  { id: 'p6', sku: 'MRN-ROPE50', name: 'Dock Rope 50ft', category: 'Marine', cost: 14.00, price: 28.99, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true },
  { id: 'p7', sku: 'PRV-WATER', name: 'Bottled Water', category: 'Provisions', cost: 0.35, price: 1.99, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true },
  { id: 'p8', sku: 'PRV-SNBRN', name: 'Sunscreen SPF 50', category: 'Provisions', cost: 4.00, price: 10.99, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true },
  { id: 'p9', sku: 'APP-CAP01', name: 'Bayshore Marina Cap', category: 'Apparel', cost: 5.50, price: 24.99, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true },
  { id: 'p10', sku: 'APP-TEE01', name: 'Bayshore Marina T-Shirt', category: 'Apparel', cost: 7.00, price: 29.99, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true },
];

const SERVICE_FEES_DATA: ServiceFee[] = [];

const GL_ACCOUNTS_FULL = [
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
  { code: '5100', name: 'Fuel COGS' },
  { code: '5200', name: 'Retail COGS' },
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

export default function Settings() {
  const { getToken } = useAuth();
  const { modules, setModule } = useModules();
  const { applyBranding } = useBranding();
  const [searchParams, setSearchParams] = useSearchParams();
  type SettingsTab = 'profile' | 'branding' | 'billing' | 'catalog' | 'integrations' | 'team' | 'roles' | 'advanced' | 'modules' | 'locations' | 'tax';
  const VALID_TABS: SettingsTab[] = ['profile', 'branding', 'billing', 'catalog', 'integrations', 'team', 'roles', 'advanced', 'modules', 'locations', 'tax'];
  const tabFromUrl = searchParams.get('tab') as SettingsTab | null;
  const initialTab: SettingsTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'profile';
  const [tab, setTabState] = useState<SettingsTab>(initialTab);
  const setTab = (next: SettingsTab) => {
    setTabState(next);
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', next);
    if (next !== 'locations') sp.delete('locationId');
    setSearchParams(sp, { replace: true });
  };

  // API calls
  const { execute: updateSettings, loading: savingSettings } = useApi<any>('put', '/api/settings');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const handleSave = async (section: string) => { await updateSettings({ tab: section }); setSavedMsg('Settings saved successfully!'); setTimeout(() => setSavedMsg(null), 2000); };

  // Branding logo upload
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const { data: brandingData } = useApi<{ logoUrl: string; primaryColor: string; secondaryColor: string; faviconUrl: string; companyDisplayName: string; tagline: string }>('get', '/api/settings/branding', { immediate: true });
  const { execute: saveBranding, loading: savingBranding } = useApi<any>('put', '/api/settings/branding');

  const [primaryColor, setPrimaryColor] = useState<string>('#0A2342');
  const [secondaryColor, setSecondaryColor] = useState<string>('#00D4FF');
  const [faviconUrl, setFaviconUrl] = useState<string>('');
  const [companyDisplayName, setCompanyDisplayName] = useState<string>('');
  const [tagline, setTagline] = useState<string>('');

  React.useEffect(() => {
    if (brandingData) {
      if (brandingData.logoUrl) setLogoUrl(brandingData.logoUrl);
      if (brandingData.primaryColor) setPrimaryColor(brandingData.primaryColor);
      if (brandingData.secondaryColor) setSecondaryColor(brandingData.secondaryColor);
      if (brandingData.faviconUrl !== undefined) setFaviconUrl(brandingData.faviconUrl);
      if (brandingData.companyDisplayName !== undefined) setCompanyDisplayName(brandingData.companyDisplayName);
      if (brandingData.tagline !== undefined) setTagline(brandingData.tagline);
    }
  }, [brandingData]);

  const [brandingError, setBrandingError] = useState<string | null>(null);

  const handleSaveBranding = async () => {
    setBrandingError(null);
    const result = await saveBranding({ logoUrl: logoUrl ?? '', primaryColor, secondaryColor, faviconUrl, companyDisplayName, tagline });
    if (result) {
      applyBranding(primaryColor, secondaryColor);
      setSavedMsg('Branding saved successfully!');
      setTimeout(() => setSavedMsg(null), 2000);
    } else {
      setBrandingError('Could not save branding. Please try again.');
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (!validTypes.includes(file.type)) { setLogoError('Please upload a PNG, JPG, SVG, or WebP image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setLogoError('Logo must be under 5 MB.'); return; }
    setLogoUploading(true);
    setLogoError(null);
    try {
      const token = await getToken();
      const presign = await api.post<{ url: string; key: string }>('/storage/presign-upload', { category: 'logo', filename: file.name, contentType: file.type }, token);
      await fetch(presign.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      const verify = await api.post<{ ok: boolean; publicUrl?: string }>('/storage/verify-upload', { key: presign.key, contentType: file.type }, token);
      if (verify.ok && verify.publicUrl) {
        setLogoUrl(verify.publicUrl);
        const saved = await saveBranding({ logoUrl: verify.publicUrl });
        if (saved) {
          setSavedMsg('Logo saved successfully!');
          setTimeout(() => setSavedMsg(null), 2000);
        } else {
          setLogoError('Logo uploaded but could not be saved. Please try again.');
        }
      }
    } catch (err) {
      setLogoError('Upload failed. Please try again.');
    } finally {
      setLogoUploading(false);
    }
  };

  // Team
  const { data: apiTeamRaw, execute: refetchTeam } = useApi<{ members: ApiUser[] }>('get', '/api/settings/team', { immediate: true });
  const { execute: inviteTeamMember, loading: inviting } = useApi<any>('post', '/api/settings/team/invite');
  const [teamMembers, setTeamMembers] = React.useState<TeamMember[]>(TEAM);

  React.useEffect(() => {
    if (apiTeamRaw?.members) {
      setTeamMembers(apiTeamRaw.members.map(normalizeApiUser));
    }
  }, [apiTeamRaw]);

  // Team edit modal
  const [editingMember, setEditingMember] = React.useState<TeamMember | null>(null);
  const [editingMemberRole, setEditingMemberRole] = React.useState('');

  const handleTeamEditSave = async () => {
    if (!editingMember) return;
    const enumRole = ROLE_DISPLAY_TO_ENUM[editingMemberRole] ?? editingMemberRole;
    const res = await fetch(`/api/settings/team/${editingMember.id}/role`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: enumRole }),
    });
    if (res.ok) {
      setTeamMembers((prev) => prev.map((m) => m.id === editingMember.id ? { ...m, role: editingMemberRole, roleEnum: enumRole } : m));
      setSavedMsg('Role updated');
      setTimeout(() => setSavedMsg(null), 2000);
    }
    setEditingMember(null);
  };

  const handleTeamRemove = async (member: TeamMember) => {
    if (!window.confirm(`Remove ${member.name} from the team?`)) return;
    const res = await fetch(`/api/settings/team/${member.id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      setTeamMembers((prev) => prev.filter((m) => m.id !== member.id));
      setSavedMsg('Team member removed');
      setTimeout(() => setSavedMsg(null), 2000);
    }
  };

  // QBO integration
  interface QboStatus { connected: boolean; realmId: string | null; lastSync: string | null; }
  const { data: qboStatus, loading: qboLoading, execute: fetchQboStatus } = useApi<QboStatus>('get', '/api/settings/qbo', { immediate: true });
  const { execute: qboConnect, loading: qboConnecting } = useApi<{ url: string }>('post', '/api/settings/qbo/connect');
  const { execute: qboSync, loading: qboSyncing } = useApi<{ syncing: boolean; startedAt: string }>('post', '/api/settings/qbo/sync');
  const { execute: qboDisconnect, loading: qboDisconnecting } = useApi<{ disconnected: boolean }>('post', '/api/settings/qbo/disconnect');

  const handleQboConnect = async () => {
    const res = await qboConnect({});
    if (res?.url) {
      openOAuthPopup(res.url, () => {
        setTimeout(() => fetchQboStatus(), 800);
        setSavedMsg('QuickBooks Online connected');
        setTimeout(() => setSavedMsg(null), 3000);
      });
    }
  };

  const handleQboSync = async () => {
    const res = await qboSync({});
    if (res?.syncing) { setSavedMsg('QuickBooks sync started'); setTimeout(() => setSavedMsg(null), 3000); fetchQboStatus(); }
  };

  const handleQboDisconnect = async () => {
    if (!window.confirm('Disconnect QuickBooks Online? Existing synced records will remain but future changes will not sync.')) return;
    const res = await qboDisconnect({ confirm: true });
    if (res?.disconnected) { setSavedMsg('QuickBooks disconnected'); setTimeout(() => setSavedMsg(null), 3000); fetchQboStatus(); }
  };

  // Stripe integration
  interface StripeStatus { connected: boolean; accountId: string | null; dashboardUrl: string | null; }
  const { data: stripeStatus, loading: stripeLoading, execute: fetchStripeStatus } = useApi<StripeStatus>('get', '/api/settings/stripe', { immediate: true });
  const { execute: stripeConnect, loading: stripeConnecting } = useApi<{ url: string }>('post', '/api/settings/stripe/connect');
  const { execute: stripeDisconnect, loading: stripeDisconnecting } = useApi<{ disconnected: boolean }>('post', '/api/settings/stripe/disconnect');

  const handleStripeConnect = async () => {
    const res = await stripeConnect({});
    if (res?.url) {
      openOAuthPopup(res.url, () => {
        setTimeout(() => fetchStripeStatus(), 800);
        setSavedMsg('Stripe connected successfully');
        setTimeout(() => setSavedMsg(null), 3000);
      });
    }
  };

  const handleStripeDisconnect = async () => {
    if (!window.confirm('Disconnect Stripe? Payment processing will stop working until you reconnect.')) return;
    const res = await stripeDisconnect({ confirm: true });
    if (res?.disconnected) { setSavedMsg('Stripe disconnected'); setTimeout(() => setSavedMsg(null), 3000); fetchStripeStatus(); }
  };

  // GL Account Mapping state
  const [revenueMapping, setRevenueMapping] = useState<Record<string, string>>(
    Object.fromEntries(REVENUE_MAPPING_DEFAULTS.map((r) => [r.label, r.defaultGL]))
  );
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeRow[]>(PAYMENT_TYPE_DEFAULTS);

  const updatePaymentType = (id: string, field: keyof PaymentTypeRow, value: any) => {
    setPaymentTypes((prev) => prev.map((pt) => pt.id === id ? { ...pt, [field]: value } : pt));
  };

  // Catalog state
  const [catalogSection, setCatalogSection] = useState<'dockage' | 'rentals' | 'pos' | 'fees'>('dockage');
  const [catalogSearch, setCatalogSearch] = useState('');

  // Locations from API
  const { data: apiLocations } = useApi<{ data: MarinaLocation[] }>('get', '/api/settings/locations', { immediate: true });
  const [marinaLocations, setMarinaLocations] = useState<MarinaLocation[]>([]);
  const [catalogLocation, setCatalogLocation] = useState('');

  React.useEffect(() => {
    if (apiLocations?.data && apiLocations.data.length > 0) {
      setMarinaLocations(apiLocations.data);
      setCatalogLocation((prev) => prev || apiLocations.data[0].id);
    }
  }, [apiLocations]);

  // Per-location settings state (after marinaLocations is declared)
  interface LocationDetail {
    id: string; name: string; address: string; city: string; state: string; zip: string; phone: string;
    timezone: string; active: boolean; transientEnabled: boolean; rentalsEnabled: boolean;
    autoExecuteRenewals: boolean; logoUrl: string;
    qboConnected: boolean; qboRealmId: string | null; qboConnectedAt: string | null;
    stripeConnected: boolean; stripeAccountId: string | null; stripeOnboardingComplete: boolean;
  }
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [locationDetail, setLocationDetail] = useState<LocationDetail | null>(null);
  const [locationForm, setLocationForm] = useState<Partial<LocationDetail>>({});
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationQboLoading, setLocationQboLoading] = useState(false);
  const [locationQboActing, setLocationQboActing] = useState(false);
  const [locationStripeActing, setLocationStripeActing] = useState(false);

  // ── Tax Jurisdictions ──────────────────────────────────────────────────────
  interface TaxJurisdiction {
    id: string; code: string; name: string; kind: string;
    rates: Array<{ id: string; category: string; ratePctBps: number; effectiveFrom: string; effectiveTo: string | null; }>;
  }
  const [jurisdictions, setJurisdictions] = useState<TaxJurisdiction[]>([]);
  const [jurisLoading, setJurisLoading] = useState(false);
  const [selectedJurisId, setSelectedJurisId] = useState<string | null>(null);
  const [jurisForm, setJurisForm] = useState<{ code: string; name: string; kind: string }>({ code: '', name: '', kind: 'STATE' });
  const [addingJuris, setAddingJuris] = useState(false);
  const [jurisSaving, setJurisSaving] = useState(false);
  const [rateForm, setRateForm] = useState<{ category: string; ratePct: string; effectiveFrom: string; effectiveTo: string }>({ category: 'Standard', ratePct: '', effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '' });
  const [addingRate, setAddingRate] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [locationJurisIds, setLocationJurisIds] = useState<string[]>([]);
  const [locationJurisSaving, setLocationJurisSaving] = useState(false);

  const kindColor = (kind: string): { backgroundColor: string; color: string } => {
    const map: Record<string, { backgroundColor: string; color: string }> = {
      STATE:   { backgroundColor: '#DBEAFE', color: '#1D4ED8' },
      COUNTY:  { backgroundColor: '#D1FAE5', color: '#065F46' },
      CITY:    { backgroundColor: '#FEF3C7', color: '#92400E' },
      SPECIAL: { backgroundColor: '#EDE9FE', color: '#5B21B6' },
    };
    return map[kind] ?? { backgroundColor: '#F1F5F9', color: '#64748B' };
  };

  const fetchJurisdictions = React.useCallback(async () => {
    setJurisLoading(true);
    try {
      const r = await fetch('/api/tax/jurisdictions', { credentials: 'include' });
      if (r.ok) { const body = await r.json(); setJurisdictions(body.data ?? []); }
    } finally { setJurisLoading(false); }
  }, []);

  React.useEffect(() => {
    if (tab === 'tax' || tab === 'locations') void fetchJurisdictions();
  }, [tab, fetchJurisdictions]);

  const fetchLocationJuris = React.useCallback(async (locationId: string) => {
    const r = await fetch(`/api/tax/locations/${locationId}/jurisdictions`, { credentials: 'include' });
    if (r.ok) { const body = await r.json(); setLocationJurisIds((body.data ?? []).map((d: any) => d.jurisdictionId)); }
  }, []);

  React.useEffect(() => {
    if (selectedLocationId) void fetchLocationJuris(selectedLocationId);
  }, [selectedLocationId, fetchLocationJuris]);

  const handleLocationJurisSave = async () => {
    setLocationJurisSaving(true);
    try {
      await fetch('/api/tax/locations/assign', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: selectedLocationId, jurisdictionIds: locationJurisIds }),
      });
      setSavedMsg('Tax assignments saved'); setTimeout(() => setSavedMsg(null), 2000);
    } finally { setLocationJurisSaving(false); }
  };

  const handleCreateJuris = async () => {
    setJurisSaving(true);
    try {
      const r = await fetch('/api/tax/jurisdictions', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jurisForm) });
      if (r.ok) { const body = await r.json(); setJurisdictions((prev) => [...prev, { ...body.data, rates: [] }]); setSelectedJurisId(body.data.id); setJurisForm({ code: body.data.code, name: body.data.name, kind: body.data.kind }); setAddingJuris(false); }
    } finally { setJurisSaving(false); }
  };

  const handleUpdateJuris = async () => {
    if (!selectedJurisId) return;
    setJurisSaving(true);
    try {
      const r = await fetch(`/api/tax/jurisdictions/${selectedJurisId}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jurisForm) });
      if (r.ok) { const body = await r.json(); setJurisdictions((prev) => prev.map((j) => j.id === selectedJurisId ? { ...j, ...body.data } : j)); setSavedMsg('Jurisdiction updated'); setTimeout(() => setSavedMsg(null), 2000); }
    } finally { setJurisSaving(false); }
  };

  const handleDeleteJuris = async (id: string) => {
    if (!confirm('Delete this jurisdiction and all its rates?')) return;
    await fetch(`/api/tax/jurisdictions/${id}`, { method: 'DELETE', credentials: 'include' });
    setJurisdictions((prev) => prev.filter((j) => j.id !== id));
    if (selectedJurisId === id) setSelectedJurisId(null);
  };

  const handleAddRate = async () => {
    if (!selectedJurisId || !rateForm.ratePct) return;
    setRateSaving(true);
    try {
      const payload = {
        jurisdictionId: selectedJurisId,
        category: rateForm.category,
        ratePctBps: Math.round(parseFloat(rateForm.ratePct) * 100),
        effectiveFrom: new Date(rateForm.effectiveFrom).toISOString(),
        effectiveTo: rateForm.effectiveTo ? new Date(rateForm.effectiveTo).toISOString() : null,
      };
      const r = await fetch('/api/tax/rates', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (r.ok) {
        const res = await r.json();
        setJurisdictions((prev) => prev.map((j) => j.id === selectedJurisId ? { ...j, rates: [res.data, ...j.rates] } : j));
        setAddingRate(false);
        setRateForm({ category: 'Standard', ratePct: '', effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '' });
      }
    } finally { setRateSaving(false); }
  };

  const handleDeleteRate = async (rateId: string, jurisId: string) => {
    await fetch(`/api/tax/rates/${rateId}`, { method: 'DELETE', credentials: 'include' });
    setJurisdictions((prev) => prev.map((j) => j.id === jurisId ? { ...j, rates: j.rates.filter((r) => r.id !== rateId) } : j));
  };
  // ── End Tax Jurisdictions ──────────────────────────────────────────────────

  const fetchLocationDetail = React.useCallback(async (id: string) => {
    const r = await fetch(`/api/settings/locations/${id}`, { credentials: 'include' });
    if (r.ok) {
      const body = await r.json();
      setLocationDetail(body.location);
      setLocationForm(body.location);
    }
  }, []);

  React.useEffect(() => {
    if (tab !== 'locations' || marinaLocations.length === 0) return;
    const requested = searchParams.get('locationId');
    if (requested && marinaLocations.some((l) => l.id === requested) && selectedLocationId !== requested) {
      setSelectedLocationId(requested);
      return;
    }
    if (!selectedLocationId) {
      setSelectedLocationId(marinaLocations[0].id);
    }
  }, [tab, marinaLocations, selectedLocationId, searchParams]);

  React.useEffect(() => {
    if (selectedLocationId) fetchLocationDetail(selectedLocationId);
  }, [selectedLocationId, fetchLocationDetail]);

  const handleLocationFormChange = (field: keyof LocationDetail, value: any) => {
    setLocationForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLocationSave = async () => {
    if (!selectedLocationId) return;
    setLocationSaving(true);
    try {
      const res = await fetch(`/api/settings/locations/${selectedLocationId}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(locationForm),
      });
      if (res.ok) {
        const body = await res.json();
        setLocationDetail(body.location);
        setLocationForm(body.location);
        setSavedMsg('Location settings saved');
        setTimeout(() => setSavedMsg(null), 2500);
      }
    } finally {
      setLocationSaving(false);
    }
  };

  const handleLocationQboConnect = async () => {
    if (!selectedLocationId) return;
    setLocationQboActing(true);
    try {
      const res = await fetch('/api/settings/qbo/connect', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: selectedLocationId }),
      });
      const body = await res.json();
      if (body.url) {
        openOAuthPopup(body.url, () => {
          setTimeout(() => fetchQboStatus(), 800);
          setSavedMsg('QuickBooks Online connected for this location');
          setTimeout(() => setSavedMsg(null), 3000);
        });
      }
    } finally {
      setLocationQboActing(false);
    }
  };

  const handleLocationQboDisconnect = async () => {
    if (!selectedLocationId) return;
    if (!window.confirm('Disconnect QuickBooks for this location? Existing synced records will remain.')) return;
    setLocationQboActing(true);
    try {
      const res = await fetch('/api/settings/qbo/disconnect', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: selectedLocationId, confirm: true }),
      });
      if (res.ok) {
        setSavedMsg('QuickBooks disconnected for this location');
        setTimeout(() => setSavedMsg(null), 3000);
        fetchLocationDetail(selectedLocationId);
      }
    } finally {
      setLocationQboActing(false);
    }
  };

  const handleLocationQboSync = async () => {
    if (!selectedLocationId) return;
    setLocationQboLoading(true);
    try {
      const res = await fetch('/api/settings/qbo/sync', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: selectedLocationId }),
      });
      if (res.ok) {
        setSavedMsg('QuickBooks sync started');
        setTimeout(() => setSavedMsg(null), 3000);
      }
    } finally {
      setLocationQboLoading(false);
    }
  };

  const handleLocationStripeConnect = async () => {
    if (!selectedLocationId) return;
    setLocationStripeActing(true);
    try {
      const res = await fetch('/api/settings/stripe/connect', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: selectedLocationId }),
      });
      const body = await res.json();
      if (body.url) {
        openOAuthPopup(body.url, () => {
          setTimeout(() => fetchLocationDetail(selectedLocationId), 800);
          setSavedMsg('Stripe connected for this location');
          setTimeout(() => setSavedMsg(null), 3000);
        });
      }
    } finally {
      setLocationStripeActing(false);
    }
  };

  const handleLocationStripeDisconnect = async () => {
    if (!selectedLocationId) return;
    if (!window.confirm('Disconnect Stripe for this location? Payments at this location will stop working until reconnected.')) return;
    setLocationStripeActing(true);
    try {
      const res = await fetch('/api/settings/stripe/disconnect', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: selectedLocationId, confirm: true }),
      });
      if (res.ok) {
        setSavedMsg('Stripe disconnected for this location');
        setTimeout(() => setSavedMsg(null), 3000);
        fetchLocationDetail(selectedLocationId);
      }
    } finally {
      setLocationStripeActing(false);
    }
  };

  // Catalog: Dockage Rates — individual CRUD per row
  const [dockageRates, setDockageRates] = useState<DockageRate[]>(DOCKAGE_RATES_DATA);
  const [editingDockageId, setEditingDockageId] = useState<string | null>(null);
  const [editingDockage, setEditingDockage] = useState<DockageRate | null>(null);
  const [addingDockage, setAddingDockage] = useState(false);
  const blankDockage = (): DockageRate => ({
    id: '', locationId: catalogLocation, slipType: '', monthlyRate: 0,
    quarterlyRate: 0, annualRate: 0, electricityMode: 'METERED',
    electricityRate: 0, glAccount: '4100', taxClass: 'Standard', active: true, effectiveFrom: '', effectiveTo: '',
  });
  const [newDockage, setNewDockage] = useState<DockageRate>(blankDockage());

  // Fetch dockage rates whenever selected location changes
  React.useEffect(() => {
    if (!catalogLocation) return;
    fetch(`/api/settings/catalog/dockage-rates?locationId=${catalogLocation}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((body) => {
        if (body.data) {
          setDockageRates(body.data.map((r: any) => ({
            id: r.id,
            locationId: r.locationId,
            slipType: r.slipType,
            monthlyRate: r.monthlyRateCents / 100,
            quarterlyRate: r.quarterlyRateCents != null ? r.quarterlyRateCents / 100 : 0,
            annualRate: r.annualRateCents != null ? r.annualRateCents / 100 : 0,
            electricityMode: r.electricityMode,
            electricityRate: r.electricityRateCents != null ? r.electricityRateCents / 100 : 0,
            glAccount: r.glAccountId ?? '4100',
            taxClass: r.taxClass ?? 'Standard',
            active: r.active,
            effectiveFrom: r.effectiveFrom ? r.effectiveFrom.slice(0, 10) : '',
            effectiveTo: r.effectiveTo ? r.effectiveTo.slice(0, 10) : '',
          })));
        }
      })
      .catch(() => {});
  }, [catalogLocation]);

  const handleAddDockageRate = async (rate: DockageRate) => {
    try {
      const res = await fetch('/api/settings/catalog/dockage-rates', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: catalogLocation,
          slipType: rate.slipType,
          monthlyRateCents: Math.round(rate.monthlyRate * 100),
          quarterlyRateCents: rate.quarterlyRate ? Math.round(rate.quarterlyRate * 100) : null,
          annualRateCents: rate.annualRate ? Math.round(rate.annualRate * 100) : null,
          electricityMode: rate.electricityMode,
          electricityRateCents: rate.electricityRate ? Math.round(rate.electricityRate * 100) : null,
          glAccountId: rate.glAccount || null,
          taxClass: rate.taxClass || 'Standard',
          active: rate.active,
          effectiveFrom: rate.effectiveFrom || null,
          effectiveTo: rate.effectiveTo || null,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        const saved = body.data;
        setDockageRates((prev) => [...prev, {
          ...rate, id: saved.id, locationId: saved.locationId,
          effectiveFrom: saved.effectiveFrom ? saved.effectiveFrom.slice(0, 10) : '',
          effectiveTo: saved.effectiveTo ? saved.effectiveTo.slice(0, 10) : '',
        }]);
      }
    } catch { /* ignore */ }
    setAddingDockage(false);
    setNewDockage(blankDockage());
  };

  const handleEditDockageRate = async (rate: DockageRate) => {
    try {
      await fetch(`/api/settings/catalog/dockage-rates/${rate.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slipType: rate.slipType,
          monthlyRateCents: Math.round(rate.monthlyRate * 100),
          quarterlyRateCents: rate.quarterlyRate ? Math.round(rate.quarterlyRate * 100) : null,
          annualRateCents: rate.annualRate ? Math.round(rate.annualRate * 100) : null,
          electricityMode: rate.electricityMode,
          electricityRateCents: rate.electricityRate ? Math.round(rate.electricityRate * 100) : null,
          glAccountId: rate.glAccount || null,
          taxClass: rate.taxClass || 'Standard',
          active: rate.active,
          effectiveFrom: rate.effectiveFrom || null,
          effectiveTo: rate.effectiveTo || null,
        }),
      });
    } catch { /* ignore */ }
    setDockageRates((prev) => prev.map((r) => r.id === rate.id ? rate : r));
    setEditingDockageId(null);
  };

  const handleDeleteDockageRate = async (id: string) => {
    try {
      await fetch(`/api/settings/catalog/dockage-rates/${id}`, { method: 'DELETE', credentials: 'include' });
    } catch { /* ignore */ }
    setDockageRates((prev) => prev.filter((r) => r.id !== id));
  };

  // Catalog: Rental Products (from rentals API)
  const { data: apiRentalProducts } = useApi<{ data: any[] }>('get', '/api/rentals/products', { immediate: true });
  const [rentalProducts, setRentalProducts] = useState<RentalProduct[]>(RENTAL_PRODUCTS_DATA);
  const [editingRentalId, setEditingRentalId] = useState<string | null>(null);
  const [editingRental, setEditingRental] = useState<RentalProduct | null>(null);
  const [addingRental, setAddingRental] = useState(false);
  const [newRental, setNewRental] = useState<RentalProduct>({ id: '', name: '', type: 'Pontoon', hourlyRate: 0, halfDayRate: 0, dailyRate: 0, damageWaiver: 0, deposit: 0, glAccount: '4300', taxClass: 'Tax Exempt', active: true });

  React.useEffect(() => {
    if (apiRentalProducts?.data && apiRentalProducts.data.length > 0) {
      setRentalProducts(apiRentalProducts.data.map((p: any) => ({
        id: p.id,
        name: p.name,
        type: p.category ?? 'Watercraft',
        hourlyRate: p.hourlyRateCents != null ? p.hourlyRateCents / 100 : 0,
        halfDayRate: p.weeklyRateCents != null ? Math.round(p.weeklyRateCents / 100 * 0.4) : 0,
        dailyRate: p.dailyRateCents != null ? p.dailyRateCents / 100 : 0,
        damageWaiver: p.damageWaiverCents != null ? p.damageWaiverCents / 100 : 0,
        deposit: p.depositCents != null ? p.depositCents / 100 : 0,
        glAccount: '4300',
        taxClass: p.taxClass ?? 'Tax Exempt',
        active: p.active ?? true,
      })));
    }
  }, [apiRentalProducts]);

  const handleSaveNewRental = async (rental: RentalProduct) => {
    try {
      const res = await fetch('/api/rentals/products', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: rental.name,
          category: 'WATERCRAFT',
          hourlyRateCents: Math.round(rental.hourlyRate * 100),
          dailyRateCents: Math.round(rental.dailyRate * 100),
          damageWaiverCents: Math.round(rental.damageWaiver * 100),
          depositCents: Math.round(rental.deposit * 100),
          basePriceCents: Math.round(rental.dailyRate * 100),
          taxClass: rental.taxClass || 'Tax Exempt',
          isActive: rental.active,
          totalQuantity: 1,
        }),
      });
      if (res.ok) {
        const body = await res.json();
        setRentalProducts((prev) => [...prev, { ...rental, id: body.id ?? rental.id }]);
        setAddingRental(false);
      } else {
        setRentalProducts((prev) => [...prev, { ...rental, id: 'r' + Date.now() }]);
        setAddingRental(false);
      }
    } catch {
      setRentalProducts((prev) => [...prev, { ...rental, id: 'r' + Date.now() }]);
      setAddingRental(false);
    }
  };

  const handleEditRental = async (rental: RentalProduct) => {
    try {
      await fetch(`/api/rentals/products/${rental.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: rental.name,
          hourlyRateCents: Math.round(rental.hourlyRate * 100),
          dailyRateCents: Math.round(rental.dailyRate * 100),
          damageWaiverCents: Math.round(rental.damageWaiver * 100),
          depositCents: Math.round(rental.deposit * 100),
          taxClass: rental.taxClass || 'Tax Exempt',
          isActive: rental.active,
        }),
      });
    } catch { /* ignore */ }
    setRentalProducts((prev) => prev.map((p) => p.id === rental.id ? rental : p));
    setEditingRentalId(null);
  };

  const handleDeleteRental = async (id: string) => {
    try {
      await fetch(`/api/rentals/products/${id}`, { method: 'DELETE', credentials: 'include' });
    } catch { /* ignore */ }
    setRentalProducts((prev) => prev.filter((p) => p.id !== id));
  };

  // Catalog: POS Items (from pos/products API)
  const { data: apiPosProducts } = useApi<{ data: any[] }>('get', '/api/pos/products', { immediate: true });
  const [posItems, setPosItems] = useState<POSItem[]>(POS_ITEMS_DATA);
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editingPos, setEditingPos] = useState<POSItem | null>(null);
  const [addingPos, setAddingPos] = useState(false);
  const [newPos, setNewPos] = useState<POSItem>({ id: '', sku: '', name: '', category: 'Marine', cost: 0, price: 0, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true });

  React.useEffect(() => {
    if (apiPosProducts?.data && apiPosProducts.data.length > 0) {
      setPosItems(apiPosProducts.data.map((p: any) => ({
        id: p.id,
        sku: p.sku ?? '',
        name: p.name,
        category: p.departmentId ?? 'Marine',
        cost: p.costCents != null ? p.costCents / 100 : 0,
        price: p.priceCents / 100,
        taxClass: p.taxClass ?? 'Standard',
        glRevenueAccount: '4500',
        glCogsAccount: '5200',
        trackInventory: p.trackInventory ?? false,
        active: true,
      })));
    }
  }, [apiPosProducts]);

  const handleSaveNewPos = async (item: POSItem) => {
    try {
      const res = await fetch('/api/pos/products', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.name,
          sku: item.sku || null,
          priceCents: Math.round(item.price * 100),
          costCents: Math.round(item.cost * 100),
          taxClass: item.taxClass,
          trackInventory: item.trackInventory,
        }),
      });
      if (res.ok) {
        const body = await res.json();
        setPosItems((prev) => [...prev, { ...item, id: body.id ?? item.id }]);
        setAddingPos(false);
      } else {
        setPosItems((prev) => [...prev, { ...item, id: 'p' + Date.now() }]);
        setAddingPos(false);
      }
    } catch {
      setPosItems((prev) => [...prev, { ...item, id: 'p' + Date.now() }]);
      setAddingPos(false);
    }
  };

  const handleEditPos = async (item: POSItem) => {
    try {
      await fetch(`/api/pos/products/${item.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.name,
          sku: item.sku || null,
          priceCents: Math.round(item.price * 100),
          costCents: Math.round(item.cost * 100),
          taxClass: item.taxClass,
          trackInventory: item.trackInventory,
        }),
      });
    } catch { /* ignore */ }
    setPosItems((prev) => prev.map((p) => p.id === item.id ? item : p));
    setEditingPosId(null);
  };

  const handleDeletePos = async (id: string) => {
    try {
      await fetch(`/api/pos/products/${id}`, { method: 'DELETE', credentials: 'include' });
    } catch { /* ignore */ }
    setPosItems((prev) => prev.filter((p) => p.id !== id));
  };

  // Catalog: Service Fees — individual CRUD per row
  const [serviceFees, setServiceFees] = useState<ServiceFee[]>(SERVICE_FEES_DATA);
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null);
  const [editingFee, setEditingFee] = useState<ServiceFee | null>(null);
  const [addingFee, setAddingFee] = useState(false);
  const blankFee = (): ServiceFee => ({ id: '', locationId: catalogLocation, name: '', feeType: 'FLAT', amount: 0, glAccount: '4800', taxClass: 'Tax Exempt', active: true });
  const [newFee, setNewFee] = useState<ServiceFee>(blankFee());

  // Fetch service fees whenever selected location changes
  React.useEffect(() => {
    if (!catalogLocation) return;
    fetch(`/api/settings/catalog/service-fees?locationId=${catalogLocation}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((body) => {
        if (body.data) {
          setServiceFees(body.data.map((f: any) => ({
            id: f.id,
            locationId: f.locationId,
            name: f.name,
            feeType: f.feeType,
            amount: f.feeType === 'PERCENT' ? (f.pct ?? 0) : (f.amountCents != null ? f.amountCents / 100 : 0),
            glAccount: f.glAccountId ?? '4800',
            taxClass: f.taxClass ?? 'Tax Exempt',
            active: f.active,
          })));
        }
      })
      .catch(() => {});
  }, [catalogLocation]);

  const handleAddFee = async (fee: ServiceFee) => {
    try {
      const res = await fetch('/api/settings/catalog/service-fees', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: catalogLocation,
          name: fee.name,
          feeType: fee.feeType,
          amountCents: fee.feeType === 'FLAT' ? Math.round(fee.amount * 100) : null,
          pct: fee.feeType === 'PERCENT' ? fee.amount : null,
          glAccountId: fee.glAccount || null,
          taxClass: fee.taxClass || 'Tax Exempt',
          active: fee.active,
        }),
      });
      const body = await res.json();
      if (res.ok) setServiceFees((prev) => [...prev, { ...fee, id: body.data.id, locationId: body.data.locationId }]);
    } catch { /* ignore */ }
    setAddingFee(false);
    setNewFee(blankFee());
  };

  const handleEditFee = async (fee: ServiceFee) => {
    try {
      await fetch(`/api/settings/catalog/service-fees/${fee.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fee.name,
          feeType: fee.feeType,
          amountCents: fee.feeType === 'FLAT' ? Math.round(fee.amount * 100) : null,
          pct: fee.feeType === 'PERCENT' ? fee.amount : null,
          glAccountId: fee.glAccount || null,
          taxClass: fee.taxClass || 'Tax Exempt',
          active: fee.active,
        }),
      });
    } catch { /* ignore */ }
    setServiceFees((prev) => prev.map((f) => f.id === fee.id ? fee : f));
    setEditingFeeId(null);
  };

  const handleDeleteFee = async (id: string) => {
    try {
      await fetch(`/api/settings/catalog/service-fees/${id}`, { method: 'DELETE', credentials: 'include' });
    } catch { /* ignore */ }
    setServiceFees((prev) => prev.filter((f) => f.id !== id));
  };

  // Team invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Dock Staff');
  const [inviteLocations, setInviteLocations] = useState<string[]>([]);

  const handleSendInvite = async () => {
    if (!inviteEmail || !inviteName) { setSavedMsg('Please fill in name and email'); setTimeout(() => setSavedMsg(null), 2000); return; }
    const nameParts = inviteName.trim().split(' ');
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ') || '—';
    const roleEnum = ROLE_DISPLAY_TO_ENUM[inviteRole] ?? 'DOCK_STAFF';
    const res = await inviteTeamMember({ email: inviteEmail, firstName, lastName, role: roleEnum });
    if (res) {
      setShowInviteModal(false);
      setSavedMsg(`Invitation sent to ${inviteEmail}`);
      setTimeout(() => setSavedMsg(null), 3000);
      refetchTeam();
    }
  };

  // Roles state
  const { data: rolesData, loading: rolesLoading } = useApi<{ data: CustomRole[] }>('get', '/api/roles', { immediate: true });
  const { execute: seedRoles, loading: seeding } = useApi<any>('post', '/api/roles/seed');
  const { execute: createRole, loading: creatingRole } = useApi<CustomRole>('post', '/api/roles');
  const [roles, setRoles] = React.useState<CustomRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = React.useState<string | null>(null);
  const [showNewRoleForm, setShowNewRoleForm] = React.useState(false);
  const [newRoleName, setNewRoleName] = React.useState('');
  const [newRoleDesc, setNewRoleDesc] = React.useState('');
  const [newRoleColor, setNewRoleColor] = React.useState('#3B82F6');
  const [permSaving, setPermSaving] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (rolesData?.data) setRoles(rolesData.data);
  }, [rolesData]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  const getPerm = (role: CustomRole | null, module: string) =>
    role?.permissions.find((p) => p.module === module);

  const handleTogglePerm = async (
    roleId: string,
    module: string,
    field: 'canView' | 'canCreate' | 'canEdit' | 'canDelete',
    value: boolean,
  ) => {
    const key = `${roleId}-${module}-${field}`;
    setPermSaving(key);
    setRoles((prev) =>
      prev.map((r) =>
        r.id !== roleId ? r : {
          ...r,
          permissions: r.permissions.map((p) =>
            p.module !== module ? p : { ...p, [field]: value }
          ),
        }
      )
    );
    try {
      await fetch(`/api/roles/${roleId}/permissions/${module}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
    } catch {
      setRoles((prev) =>
        prev.map((r) =>
          r.id !== roleId ? r : {
            ...r,
            permissions: r.permissions.map((p) =>
              p.module !== module ? p : { ...p, [field]: !value }
            ),
          }
        )
      );
    } finally {
      setPermSaving(null);
    }
  };

  const handleSeedRoles = async () => {
    await seedRoles({});
    const fresh = await fetch('/api/roles', { credentials: 'include' }).then((r) => r.json());
    if (fresh?.data) { setRoles(fresh.data); setSelectedRoleId(fresh.data[0]?.id ?? null); }
  };

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return;
    const result = await createRole({ name: newRoleName, description: newRoleDesc, color: newRoleColor });
    if (result) {
      setRoles((prev) => [...prev, result]);
      setSelectedRoleId(result.id);
      setShowNewRoleForm(false);
      setNewRoleName(''); setNewRoleDesc(''); setNewRoleColor('#3B82F6');
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    await fetch(`/api/roles/${roleId}`, { method: 'DELETE', credentials: 'include' });
    setRoles((prev) => prev.filter((r) => r.id !== roleId));
    if (selectedRoleId === roleId) setSelectedRoleId(roles.find((r) => r.id !== roleId)?.id ?? null);
  };

  const tabItems: { key: typeof tab; label: string; icon: typeof Building2 }[] = [
    { key: 'profile', label: 'Marina Profile', icon: Building2 },
    { key: 'locations', label: 'Locations', icon: MapPin },
    { key: 'branding', label: 'Branding', icon: Palette },
    { key: 'billing', label: 'Billing', icon: CreditCard },
    { key: 'catalog', label: 'Catalog', icon: Package },
    { key: 'integrations', label: 'Integrations', icon: Link },
    { key: 'team', label: 'Team', icon: Users },
    { key: 'roles', label: 'Roles', icon: Shield },
    { key: 'tax', label: 'Tax', icon: Landmark },
    { key: 'modules', label: 'Modules', icon: ToggleRight },
    { key: 'advanced', label: 'Advanced', icon: SettingsIcon },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Settings</h1>
      <hr style={st.divider} />

      {savedMsg && <div style={{ padding: '12px 24px', marginBottom: '16px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', borderRadius: '8px', textAlign: 'center' }}>{savedMsg}</div>}

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
      {tab === 'profile' && (
        <div style={st.card}>
          <h3 style={st.sectionTitle}><Building2 size={20} /> Marina Profile</h3>
          <div style={st.formGrid} className="helm-form-grid">
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
          <button style={st.saveBtn} onClick={() => handleSave('profile')} disabled={savingSettings}>
            {savingSettings ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Locations */}
      {tab === 'locations' && (
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
          {/* Sidebar — location list */}
          <div style={{ width: '220px', flexShrink: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', marginBottom: '10px' }}>Properties</div>
            {marinaLocations.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#94A3B8', padding: '12px 0' }}>No locations found</div>
            ) : marinaLocations.map((loc) => (
              <button
                key={loc.id}
                onClick={() => setSelectedLocationId(loc.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: '8px', border: 'none',
                  cursor: 'pointer', fontSize: '14px', fontWeight: selectedLocationId === loc.id ? 600 : 400,
                  backgroundColor: selectedLocationId === loc.id ? '#EFF6FF' : 'transparent',
                  color: selectedLocationId === loc.id ? '#1D4ED8' : '#374151',
                  marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px',
                }}
              >
                <MapPin size={14} style={{ flexShrink: 0 }} /> {loc.name}
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!locationDetail ? (
              <div style={{ ...st.card, color: '#94A3B8', textAlign: 'center', padding: '48px' }}>Select a location to edit its settings</div>
            ) : (
              <>
                {/* Basic Info */}
                <div style={st.card}>
                  <h3 style={st.sectionTitle}><MapPin size={20} /> {locationDetail.name}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div style={st.field}>
                      <label style={st.label}>Location Name</label>
                      <input style={st.input} value={locationForm.name ?? ''} onChange={(e) => handleLocationFormChange('name', e.target.value)} />
                    </div>
                    <div style={st.field}>
                      <label style={st.label}>Phone</label>
                      <input style={st.input} value={locationForm.phone ?? ''} onChange={(e) => handleLocationFormChange('phone', e.target.value)} />
                    </div>
                    <div style={{ ...st.field, gridColumn: '1 / -1' }}>
                      <label style={st.label}>Address</label>
                      <input style={st.input} value={locationForm.address ?? ''} onChange={(e) => handleLocationFormChange('address', e.target.value)} />
                    </div>
                    <div style={st.field}>
                      <label style={st.label}>City</label>
                      <input style={st.input} value={locationForm.city ?? ''} onChange={(e) => handleLocationFormChange('city', e.target.value)} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div style={st.field}>
                        <label style={st.label}>State</label>
                        <input style={st.input} value={locationForm.state ?? ''} onChange={(e) => handleLocationFormChange('state', e.target.value)} placeholder="FL" maxLength={2} />
                      </div>
                      <div style={st.field}>
                        <label style={st.label}>ZIP</label>
                        <input style={st.input} value={locationForm.zip ?? ''} onChange={(e) => handleLocationFormChange('zip', e.target.value)} />
                      </div>
                    </div>
                    <div style={st.field}>
                      <label style={st.label}>Timezone</label>
                      <select style={st.select} value={locationForm.timezone ?? 'America/New_York'} onChange={(e) => handleLocationFormChange('timezone', e.target.value)}>
                        {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Halifax', 'America/St_Johns'].map((tz) => (
                          <option key={tz} value={tz}>{tz.replace('America/', '').replace('Pacific/', '').replace('_', ' ')}</option>
                        ))}
                      </select>
                    </div>
                    <div style={st.field}>
                      <label style={st.label}>Logo URL</label>
                      <input style={st.input} value={locationForm.logoUrl ?? ''} onChange={(e) => handleLocationFormChange('logoUrl', e.target.value)} placeholder="https://..." />
                    </div>
                  </div>

                  <div style={{ marginTop: '16px', display: 'flex', gap: '24px' }}>
                    <label style={st.checkbox}>
                      <input type="checkbox" checked={!!locationForm.autoExecuteRenewals} onChange={(e) => handleLocationFormChange('autoExecuteRenewals', e.target.checked)} />
                      Auto-execute renewals at this location
                    </label>
                    <label style={st.checkbox}>
                      <input type="checkbox" checked={!!locationForm.transientEnabled} onChange={(e) => handleLocationFormChange('transientEnabled', e.target.checked)} />
                      Transient dockage enabled
                    </label>
                    <label style={st.checkbox}>
                      <input type="checkbox" checked={!!locationForm.rentalsEnabled} onChange={(e) => handleLocationFormChange('rentalsEnabled', e.target.checked)} />
                      Rentals enabled
                    </label>
                  </div>

                  <button style={{ ...st.saveBtn, marginTop: '20px' }} onClick={handleLocationSave} disabled={locationSaving}>
                    {locationSaving ? 'Saving…' : 'Save Location Settings'}
                  </button>
                </div>

                {/* QuickBooks per-location */}
                <div style={{ ...st.integrationCard, marginTop: '20px' }}>
                  <div style={st.integrationInfo}>
                    <div style={st.integrationIcon}><Building2 size={24} style={{ color: '#2CA01C' }} /></div>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>QuickBooks Online</div>
                      <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>Each location connects its own QuickBooks company file</div>
                      <div style={{ marginTop: '8px' }}>
                        {locationDetail.qboConnected ? (
                          <>
                            <span style={{ ...st.badge, backgroundColor: '#DEF7EC', color: '#03543F' }}>Connected</span>
                            {locationDetail.qboRealmId && (
                              <span style={{ fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>Realm: {locationDetail.qboRealmId}</span>
                            )}
                            {locationDetail.qboConnectedAt && (
                              <span style={{ fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>
                                Since {new Date(locationDetail.qboConnectedAt).toLocaleDateString()}
                              </span>
                            )}
                          </>
                        ) : (
                          <span style={{ ...st.badge, backgroundColor: '#F3F4F6', color: '#64748B' }}>Not connected</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {locationDetail.qboConnected ? (
                      <>
                        <button style={st.outlineBtn} onClick={handleLocationQboSync} disabled={locationQboLoading}>
                          <RefreshCw size={14} />{locationQboLoading ? ' Syncing…' : ' Sync Now'}
                        </button>
                        <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }} onClick={handleLocationQboDisconnect} disabled={locationQboActing}>
                          {locationQboActing ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      </>
                    ) : (
                      <button style={st.addBtn} onClick={handleLocationQboConnect} disabled={locationQboActing}>
                        {locationQboActing ? 'Connecting…' : 'Connect QuickBooks'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Stripe per-location */}
                <div style={{ ...st.integrationCard, marginTop: '12px' }}>
                  <div style={st.integrationInfo}>
                    <div style={st.integrationIcon}><CreditCard size={24} style={{ color: '#635BFF' }} /></div>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>Stripe Payments</div>
                      <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>Each location collects payments into its own Stripe account</div>
                      <div style={{ marginTop: '8px' }}>
                        {locationDetail.stripeConnected ? (
                          <>
                            <span style={{ ...st.badge, backgroundColor: '#EDE9FE', color: '#5B21B6' }}>Connected</span>
                            {locationDetail.stripeAccountId && (
                              <span style={{ fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>
                                ****{locationDetail.stripeAccountId.slice(-4)}
                              </span>
                            )}
                          </>
                        ) : locationDetail.stripeAccountId ? (
                          <span style={{ ...st.badge, backgroundColor: '#FEF3C7', color: '#92400E' }}>Onboarding incomplete</span>
                        ) : (
                          <span style={{ ...st.badge, backgroundColor: '#F3F4F6', color: '#64748B' }}>Not connected</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {locationDetail.stripeConnected ? (
                      <>
                        <a
                          href={`https://dashboard.stripe.com/${locationDetail.stripeAccountId}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ ...st.outlineBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                        >
                          Dashboard
                        </a>
                        <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }} onClick={handleLocationStripeDisconnect} disabled={locationStripeActing}>
                          {locationStripeActing ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      </>
                    ) : (
                      <button style={st.addBtn} onClick={handleLocationStripeConnect} disabled={locationStripeActing}>
                        {locationStripeActing ? 'Connecting…' : locationDetail.stripeAccountId ? 'Resume Onboarding' : 'Connect Stripe'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Tax Jurisdiction Assignments */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px 24px', marginTop: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Landmark size={20} style={{ color: '#7C3AED' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>Tax Jurisdictions</div>
                      <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>Select which tax jurisdictions apply at this location. Rates are configured in the Tax tab.</div>
                    </div>
                  </div>
                  {jurisdictions.length === 0 ? (
                    <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                      No jurisdictions configured yet.{' '}
                      <button style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: '13px', padding: 0, textDecoration: 'underline' }} onClick={() => setTab('tax')}>
                        Configure tax jurisdictions →
                      </button>
                    </div>
                  ) : (
                    <>
                      {jurisdictions.map((j) => {
                        const checked = locationJurisIds.includes(j.id);
                        const now = new Date();
                        const active = j.rates.filter((r) => new Date(r.effectiveFrom) <= now && (!r.effectiveTo || new Date(r.effectiveTo) >= now));
                        const totalBps = active.reduce((s, r) => s + r.ratePctBps, 0);
                        return (
                          <label key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}>
                            <input type="checkbox" checked={checked} onChange={(e) => setLocationJurisIds((prev) => e.target.checked ? [...prev, j.id] : prev.filter((id) => id !== j.id))} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#0A2342' }} />
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', flexShrink: 0, ...kindColor(j.kind) }}>{j.kind}</span>
                            <span style={{ flex: 1, fontSize: '14px', color: '#0A2342', fontWeight: checked ? 600 : 400 }}>{j.name}</span>
                            {totalBps > 0 && <span style={{ fontSize: '12px', color: '#64748B', fontFamily: 'monospace' }}>{(totalBps / 100).toFixed(2)}%</span>}
                          </label>
                        );
                      })}
                      <button style={{ ...st.saveBtn, marginTop: '16px' }} onClick={() => void handleLocationJurisSave()} disabled={locationJurisSaving}>
                        {locationJurisSaving ? 'Saving…' : 'Save Tax Assignments'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
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
                <label style={{ display: 'block', marginTop: '8px', cursor: 'pointer', position: 'relative' }}>
                  <div style={{ ...st.colorSwatch, backgroundColor: primaryColor, cursor: 'pointer', border: '2px solid #E2E8F0', borderRadius: '6px' }} />
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer' }}
                  />
                </label>
                <div style={{ ...st.mono, fontSize: '12px', marginTop: '4px', color: '#64748B' }}>{primaryColor.toUpperCase()}</div>
              </div>
              <div>
                <div style={st.label}>Secondary</div>
                <label style={{ display: 'block', marginTop: '8px', cursor: 'pointer', position: 'relative' }}>
                  <div style={{ ...st.colorSwatch, backgroundColor: secondaryColor, cursor: 'pointer', border: '2px solid #E2E8F0', borderRadius: '6px' }} />
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer' }}
                  />
                </label>
                <div style={{ ...st.mono, fontSize: '12px', marginTop: '4px', color: '#64748B' }}>{secondaryColor.toUpperCase()}</div>
              </div>
            </div>
          </div>
          <div style={st.card}>
            <h3 style={st.sectionTitle}>Logo</h3>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }}
            />
            <div
              style={{ width: '200px', height: '120px', borderRadius: '8px', background: '#F8FAFC', border: `2px dashed ${logoError ? '#DC2626' : '#CBD5E1'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: logoUploading ? 'wait' : 'pointer', marginBottom: '8px', position: 'relative', overflow: 'hidden' }}
              onClick={() => !logoUploading && logoInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleLogoUpload(f); }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <>
                  <Building2 size={32} style={{ color: '#94A3B8', marginBottom: '8px' }} />
                  <span style={{ fontSize: '13px', color: '#64748B', textAlign: 'center', padding: '0 12px' }}>
                    {logoUploading ? 'Uploading...' : 'Drop logo here or click to upload'}
                  </span>
                </>
              )}
            </div>
            {logoError && <div style={{ fontSize: '12px', color: '#DC2626', marginBottom: '8px' }}>{logoError}</div>}
            {logoUrl && (
              <button style={{ fontSize: '12px', padding: '4px 10px', marginBottom: '8px', background: 'none', border: '1px solid #CBD5E1', borderRadius: '4px', cursor: 'pointer', color: '#64748B' }} onClick={async () => { setLogoUrl(null); if (logoInputRef.current) logoInputRef.current.value = ''; const removed = await saveBranding({ logoUrl: '' }); if (!removed) { setLogoError('Could not remove logo. Please try again.'); } }}>Remove</button>
            )}
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>PNG, JPG, SVG or WebP · Max 5 MB</div>
          </div>
          <div style={st.card}>
            <h3 style={st.sectionTitle}>Invoice Header</h3>
            <div style={st.formGrid} className="helm-form-grid">
              <div style={st.field}>
                <label style={st.label}>Company Display Name</label>
                <input
                  style={st.input}
                  value={companyDisplayName}
                  onChange={(e) => setCompanyDisplayName(e.target.value)}
                  placeholder="e.g. Bayshore Marina LLC"
                />
              </div>
              <div style={st.field}>
                <label style={st.label}>Tagline</label>
                <input
                  style={st.input}
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="e.g. Your home on the water"
                />
              </div>
            </div>
            <button style={st.saveBtn} onClick={handleSaveBranding} disabled={savingBranding}>
              {savingBranding ? 'Saving...' : 'Save Branding'}
            </button>
            {brandingError && <div style={{ fontSize: '13px', color: '#DC2626', marginTop: '8px' }}>{brandingError}</div>}
          </div>
        </>
      )}

      {/* Billing */}
      {tab === 'billing' && (
        <>
          <div style={st.card}>
            <h3 style={st.sectionTitle}><CreditCard size={20} /> Payment Terms</h3>
            <div style={st.formGrid} className="helm-form-grid">
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
            <div style={st.formGrid} className="helm-form-grid">
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

            {/* Payment Type Configuration */}
            <div style={st.card}>
              <h3 style={st.sectionTitle}>Payment Type Configuration</h3>
              <div style={st.tableWrap} className="helm-table-wrap">
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

          <button style={st.saveBtn} onClick={() => handleSave('billing')} disabled={savingSettings}>
            {savingSettings ? 'Saving...' : 'Save Billing Settings'}
          </button>
        </>
      )}

      {/* Catalog */}
      {tab === 'catalog' && (
        <>
          {/* GL Account Mapping link */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderRadius: '8px',
            backgroundColor: '#EEF2FF', border: '1px solid #C7D2FE',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Landmark size={16} style={{ color: '#4338CA' }} />
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#3730A3' }}>
                GL Account Mapping
              </span>
              <span style={{ fontSize: '13px', color: '#4338CA' }}>
                — Assign revenue GL accounts to each product type for proper accounting
              </span>
            </div>
            <a
              href="/settings/products"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '6px 14px', borderRadius: '6px', textDecoration: 'none',
                fontSize: '13px', fontWeight: 600, color: '#FFFFFF',
                backgroundColor: '#4338CA',
              }}
            >
              Products &amp; Revenue →
            </a>
          </div>

          {/* Location Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MapPin size={16} style={{ color: '#00D4FF' }} />
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Location:</span>
              <select style={{ ...st.select, width: '240px' }} value={catalogLocation} onChange={(e) => setCatalogLocation(e.target.value)}>
                {marinaLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
                {marinaLocations.length === 0 && <option value="">No locations</option>}
              </select>
            </div>
          </div>

          {/* Category tabs */}
          <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' }}>
            {([
              { key: 'dockage' as const, label: 'Dockage Rates' },
              { key: 'rentals' as const, label: 'Rental Products' },
              { key: 'pos' as const, label: 'POS Items' },
              { key: 'fees' as const, label: 'Service Fees' },
            ]).map((s) => (
              <button key={s.key} style={{ ...st.tab, ...(catalogSection === s.key ? st.tabActive : {}) }} onClick={() => { setCatalogSection(s.key); setCatalogSearch(''); }}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Search + Add */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ position: 'relative', width: '300px' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
              <input style={{ ...st.input, paddingLeft: '32px' }} placeholder="Search..." value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} />
            </div>
            <button
              style={st.addBtn}
              onClick={() => {
                if (catalogSection === 'dockage') { setAddingDockage(true); setNewDockage(blankDockage()); }
                if (catalogSection === 'rentals') { setAddingRental(true); setNewRental({ id: '', name: '', type: 'Pontoon', hourlyRate: 0, halfDayRate: 0, dailyRate: 0, damageWaiver: 0, deposit: 0, glAccount: '4300', taxClass: 'Tax Exempt', active: true }); }
                if (catalogSection === 'pos') { setAddingPos(true); setNewPos({ id: '', sku: '', name: '', category: 'Marine', cost: 0, price: 0, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true }); }
                if (catalogSection === 'fees') { setAddingFee(true); setNewFee(blankFee()); }
              }}
            >
              <Plus size={16} /> Add {catalogSection === 'dockage' ? 'Rate' : catalogSection === 'rentals' ? 'Product' : catalogSection === 'pos' ? 'Item' : 'Fee'}
            </button>
          </div>

          {/* ── Dockage Rates ── */}
          {catalogSection === 'dockage' && (
            <div style={st.tableWrap} className="helm-table-wrap">
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>Slip Type</th>
                    <th style={st.th}>Monthly</th>
                    <th style={st.th}>Quarterly</th>
                    <th style={st.th}>Annual</th>
                    <th style={st.th}>Elec. Mode</th>
                    <th style={st.th}>Elec. Rate</th>
                    <th style={st.th}>GL Account</th>
                    <th style={st.th}>Tax Class</th>
                    <th style={{ ...st.th, textAlign: 'center' }}>Active</th>
                    <th style={st.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addingDockage && (
                    <tr>
                      <td style={st.td}><input style={{ ...st.input, width: '120px' }} value={newDockage.slipType} onChange={(e) => setNewDockage({ ...newDockage, slipType: e.target.value })} placeholder="e.g. 35ft Open" /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '80px' }} type="number" value={newDockage.monthlyRate || ''} onChange={(e) => setNewDockage({ ...newDockage, monthlyRate: +e.target.value })} /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '80px' }} type="number" value={newDockage.quarterlyRate || ''} onChange={(e) => setNewDockage({ ...newDockage, quarterlyRate: +e.target.value })} /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '80px' }} type="number" value={newDockage.annualRate || ''} onChange={(e) => setNewDockage({ ...newDockage, annualRate: +e.target.value })} /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '100px' }} value={newDockage.electricityMode} onChange={(e) => setNewDockage({ ...newDockage, electricityMode: e.target.value as 'FLAT_FEE' | 'METERED' })}>
                          <option value="METERED">Metered</option><option value="FLAT_FEE">Flat Fee</option>
                        </select>
                      </td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" step="0.01" value={newDockage.electricityRate || ''} onChange={(e) => setNewDockage({ ...newDockage, electricityRate: +e.target.value })} /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '160px' }} value={newDockage.glAccount} onChange={(e) => setNewDockage({ ...newDockage, glAccount: e.target.value })}>
                          {GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}
                        </select>
                      </td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '120px' }} value={newDockage.taxClass} onChange={(e) => setNewDockage({ ...newDockage, taxClass: e.target.value })}>
                          <option value="Standard">Standard</option>
                          <option value="Tax Exempt">Tax Exempt</option>
                          <option value="Fuel Tax">Fuel Tax</option>
                        </select>
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={newDockage.active} onChange={(e) => setNewDockage({ ...newDockage, active: e.target.checked })} /></td>
                      <td style={st.td}>
                        <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => handleAddDockageRate(newDockage)}>Save</button>
                        <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setAddingDockage(false)}>Cancel</button>
                      </td>
                    </tr>
                  )}
                  {dockageRates.filter((d) => d.slipType.toLowerCase().includes(catalogSearch.toLowerCase())).map((d, idx) => {
                    const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                    const isEditing = editingDockageId === d.id;
                    const ed = isEditing ? editingDockage! : d;
                    return (
                      <tr key={d.id}>
                        <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{isEditing ? <input style={{ ...st.input, width: '120px' }} value={ed.slipType} onChange={(e) => setEditingDockage({ ...ed, slipType: e.target.value })} /> : d.slipType}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '80px' }} type="number" value={ed.monthlyRate} onChange={(e) => setEditingDockage({ ...ed, monthlyRate: +e.target.value })} /> : `$${d.monthlyRate.toLocaleString()}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '80px' }} type="number" value={ed.quarterlyRate} onChange={(e) => setEditingDockage({ ...ed, quarterlyRate: +e.target.value })} /> : `$${d.quarterlyRate.toLocaleString()}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '80px' }} type="number" value={ed.annualRate} onChange={(e) => setEditingDockage({ ...ed, annualRate: +e.target.value })} /> : `$${d.annualRate.toLocaleString()}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '100px' }} value={ed.electricityMode} onChange={(e) => setEditingDockage({ ...ed, electricityMode: e.target.value as 'FLAT_FEE' | 'METERED' })}><option value="METERED">Metered</option><option value="FLAT_FEE">Flat Fee</option></select> : (d.electricityMode === 'FLAT_FEE' ? 'Flat Fee' : 'Metered')}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" step="0.01" value={ed.electricityRate} onChange={(e) => setEditingDockage({ ...ed, electricityRate: +e.target.value })} /> : (d.electricityMode === 'FLAT_FEE' ? `$${d.electricityRate}/mo` : `$${d.electricityRate}/kWh`)}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '160px' }} value={ed.glAccount} onChange={(e) => setEditingDockage({ ...ed, glAccount: e.target.value })}>{GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}</select> : `${d.glAccount} - ${GL_ACCOUNTS_FULL.find((gl) => gl.code === d.glAccount)?.name || ''}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '120px' }} value={ed.taxClass} onChange={(e) => setEditingDockage({ ...ed, taxClass: e.target.value })}><option value="Standard">Standard</option><option value="Tax Exempt">Tax Exempt</option><option value="Fuel Tax">Fuel Tax</option></select> : <span style={{ ...st.badge, backgroundColor: '#EFF6FF', color: '#1E40AF' }}>{d.taxClass || 'Standard'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{isEditing ? <input type="checkbox" checked={ed.active} onChange={(e) => setEditingDockage({ ...ed, active: e.target.checked })} /> : <span style={{ ...st.badge, backgroundColor: d.active ? '#DEF7EC' : '#F3F4F6', color: d.active ? '#03543F' : '#64748B' }}>{d.active ? 'Yes' : 'No'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>
                          {isEditing ? (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => handleEditDockageRate(editingDockage!)}>Save</button>
                              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setEditingDockageId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setEditingDockageId(d.id); setEditingDockage({ ...d }); }}>Edit</button>
                              <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => handleDeleteDockageRate(d.id)}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Rental Products ── */}
          {catalogSection === 'rentals' && (
            <div style={st.tableWrap} className="helm-table-wrap">
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>Product Name</th>
                    <th style={st.th}>Type</th>
                    <th style={st.th}>Hourly</th>
                    <th style={st.th}>Half-Day</th>
                    <th style={st.th}>Daily</th>
                    <th style={st.th}>Damage Waiver</th>
                    <th style={st.th}>Deposit</th>
                    <th style={st.th}>GL Account</th>
                    <th style={st.th}>Tax Class</th>
                    <th style={{ ...st.th, textAlign: 'center' }}>Active</th>
                    <th style={st.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addingRental && (
                    <tr>
                      <td style={st.td}><input style={{ ...st.input, width: '160px' }} value={newRental.name} onChange={(e) => setNewRental({ ...newRental, name: e.target.value })} placeholder="Product name" /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '110px' }} value={newRental.type} onChange={(e) => setNewRental({ ...newRental, type: e.target.value })}>
                          <option>Pontoon</option><option>Jet Ski</option><option>Motorboat</option><option>Sailboat</option><option>Kayak</option><option>Paddleboard</option>
                        </select>
                      </td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" value={newRental.hourlyRate || ''} onChange={(e) => setNewRental({ ...newRental, hourlyRate: +e.target.value })} /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" value={newRental.halfDayRate || ''} onChange={(e) => setNewRental({ ...newRental, halfDayRate: +e.target.value })} /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" value={newRental.dailyRate || ''} onChange={(e) => setNewRental({ ...newRental, dailyRate: +e.target.value })} /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" value={newRental.damageWaiver || ''} onChange={(e) => setNewRental({ ...newRental, damageWaiver: +e.target.value })} /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" value={newRental.deposit || ''} onChange={(e) => setNewRental({ ...newRental, deposit: +e.target.value })} /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '160px' }} value={newRental.glAccount} onChange={(e) => setNewRental({ ...newRental, glAccount: e.target.value })}>
                          {GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}
                        </select>
                      </td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '120px' }} value={newRental.taxClass} onChange={(e) => setNewRental({ ...newRental, taxClass: e.target.value })}>
                          <option value="Standard">Standard</option>
                          <option value="Tax Exempt">Tax Exempt</option>
                          <option value="Fuel Tax">Fuel Tax</option>
                        </select>
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={newRental.active} onChange={(e) => setNewRental({ ...newRental, active: e.target.checked })} /></td>
                      <td style={st.td}>
                        <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => handleSaveNewRental({ ...newRental, id: 'r' + Date.now() })}>Save</button>
                        <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setAddingRental(false)}>Cancel</button>
                      </td>
                    </tr>
                  )}
                  {rentalProducts.filter((r) => r.name.toLowerCase().includes(catalogSearch.toLowerCase()) || r.type.toLowerCase().includes(catalogSearch.toLowerCase())).map((r, idx) => {
                    const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                    const isEditing = editingRentalId === r.id;
                    const ed = isEditing ? editingRental! : r;
                    return (
                      <tr key={r.id}>
                        <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{isEditing ? <input style={{ ...st.input, width: '160px' }} value={ed.name} onChange={(e) => setEditingRental({ ...ed, name: e.target.value })} /> : r.name}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '110px' }} value={ed.type} onChange={(e) => setEditingRental({ ...ed, type: e.target.value })}><option>Pontoon</option><option>Jet Ski</option><option>Motorboat</option><option>Sailboat</option><option>Kayak</option><option>Paddleboard</option></select> : <span style={{ ...st.badge, backgroundColor: '#E0F7FF', color: '#0A2342' }}>{r.type}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" value={ed.hourlyRate} onChange={(e) => setEditingRental({ ...ed, hourlyRate: +e.target.value })} /> : `$${r.hourlyRate}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" value={ed.halfDayRate} onChange={(e) => setEditingRental({ ...ed, halfDayRate: +e.target.value })} /> : `$${r.halfDayRate}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" value={ed.dailyRate} onChange={(e) => setEditingRental({ ...ed, dailyRate: +e.target.value })} /> : `$${r.dailyRate}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" value={ed.damageWaiver} onChange={(e) => setEditingRental({ ...ed, damageWaiver: +e.target.value })} /> : `$${r.damageWaiver}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" value={ed.deposit} onChange={(e) => setEditingRental({ ...ed, deposit: +e.target.value })} /> : `$${r.deposit}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '160px' }} value={ed.glAccount} onChange={(e) => setEditingRental({ ...ed, glAccount: e.target.value })}>{GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}</select> : `${r.glAccount} - ${GL_ACCOUNTS_FULL.find((gl) => gl.code === r.glAccount)?.name || ''}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '120px' }} value={ed.taxClass} onChange={(e) => setEditingRental({ ...ed, taxClass: e.target.value })}><option value="Standard">Standard</option><option value="Tax Exempt">Tax Exempt</option><option value="Fuel Tax">Fuel Tax</option></select> : <span style={{ ...st.badge, backgroundColor: '#EFF6FF', color: '#1E40AF' }}>{r.taxClass || 'Tax Exempt'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{isEditing ? <input type="checkbox" checked={ed.active} onChange={(e) => setEditingRental({ ...ed, active: e.target.checked })} /> : <span style={{ ...st.badge, backgroundColor: r.active ? '#DEF7EC' : '#F3F4F6', color: r.active ? '#03543F' : '#64748B' }}>{r.active ? 'Yes' : 'No'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>
                          {isEditing ? (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => handleEditRental(editingRental!)}>Save</button>
                              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setEditingRentalId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setEditingRentalId(r.id); setEditingRental({ ...r }); }}>Edit</button>
                              <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => handleDeleteRental(r.id)}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── POS Items ── */}
          {catalogSection === 'pos' && (
            <div style={st.tableWrap} className="helm-table-wrap">
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>SKU</th>
                    <th style={st.th}>Name</th>
                    <th style={st.th}>Category</th>
                    <th style={st.th}>Cost</th>
                    <th style={st.th}>Price</th>
                    <th style={st.th}>Tax Class</th>
                    <th style={st.th}>GL Revenue</th>
                    <th style={st.th}>GL COGS</th>
                    <th style={{ ...st.th, textAlign: 'center' }}>Inventory</th>
                    <th style={{ ...st.th, textAlign: 'center' }}>Active</th>
                    <th style={st.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addingPos && (
                    <tr>
                      <td style={st.td}><input style={{ ...st.input, width: '100px' }} value={newPos.sku} onChange={(e) => setNewPos({ ...newPos, sku: e.target.value })} placeholder="SKU" /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '140px' }} value={newPos.name} onChange={(e) => setNewPos({ ...newPos, name: e.target.value })} placeholder="Name" /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '110px' }} value={newPos.category} onChange={(e) => setNewPos({ ...newPos, category: e.target.value })}>
                          <option>Fuel</option><option>Bait</option><option>Marine</option><option>Provisions</option><option>Apparel</option>
                        </select>
                      </td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" step="0.01" value={newPos.cost || ''} onChange={(e) => setNewPos({ ...newPos, cost: +e.target.value })} /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" step="0.01" value={newPos.price || ''} onChange={(e) => setNewPos({ ...newPos, price: +e.target.value })} /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '100px' }} value={newPos.taxClass} onChange={(e) => setNewPos({ ...newPos, taxClass: e.target.value })}>
                          <option>Standard</option><option>Fuel Tax</option><option>Tax Exempt</option>
                        </select>
                      </td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '140px' }} value={newPos.glRevenueAccount} onChange={(e) => setNewPos({ ...newPos, glRevenueAccount: e.target.value })}>
                          {GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}
                        </select>
                      </td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '140px' }} value={newPos.glCogsAccount} onChange={(e) => setNewPos({ ...newPos, glCogsAccount: e.target.value })}>
                          {GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('5')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}
                        </select>
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={newPos.trackInventory} onChange={(e) => setNewPos({ ...newPos, trackInventory: e.target.checked })} /></td>
                      <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={newPos.active} onChange={(e) => setNewPos({ ...newPos, active: e.target.checked })} /></td>
                      <td style={st.td}>
                        <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => handleSaveNewPos({ ...newPos, id: 'p' + Date.now() })}>Save</button>
                        <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setAddingPos(false)}>Cancel</button>
                      </td>
                    </tr>
                  )}
                  {posItems.filter((p) => p.name.toLowerCase().includes(catalogSearch.toLowerCase()) || p.sku.toLowerCase().includes(catalogSearch.toLowerCase()) || p.category.toLowerCase().includes(catalogSearch.toLowerCase())).map((p, idx) => {
                    const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                    const isEditing = editingPosId === p.id;
                    const ed = isEditing ? editingPos! : p;
                    return (
                      <tr key={p.id}>
                        <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontSize: '12px' }}>{isEditing ? <input style={{ ...st.input, width: '100px' }} value={ed.sku} onChange={(e) => setEditingPos({ ...ed, sku: e.target.value })} /> : p.sku}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{isEditing ? <input style={{ ...st.input, width: '140px' }} value={ed.name} onChange={(e) => setEditingPos({ ...ed, name: e.target.value })} /> : p.name}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '110px' }} value={ed.category} onChange={(e) => setEditingPos({ ...ed, category: e.target.value })}><option>Fuel</option><option>Bait</option><option>Marine</option><option>Provisions</option><option>Apparel</option></select> : <span style={{ ...st.badge, backgroundColor: '#E0F7FF', color: '#0A2342' }}>{p.category}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" step="0.01" value={ed.cost} onChange={(e) => setEditingPos({ ...ed, cost: +e.target.value })} /> : `$${p.cost.toFixed(2)}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" step="0.01" value={ed.price} onChange={(e) => setEditingPos({ ...ed, price: +e.target.value })} /> : `$${p.price.toFixed(2)}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '100px' }} value={ed.taxClass} onChange={(e) => setEditingPos({ ...ed, taxClass: e.target.value })}><option>Standard</option><option>Fuel Tax</option><option>Tax Exempt</option></select> : p.taxClass}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px' }}>{isEditing ? <select style={{ ...st.select, width: '140px' }} value={ed.glRevenueAccount} onChange={(e) => setEditingPos({ ...ed, glRevenueAccount: e.target.value })}>{GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}</select> : `${p.glRevenueAccount}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px' }}>{isEditing ? <select style={{ ...st.select, width: '140px' }} value={ed.glCogsAccount} onChange={(e) => setEditingPos({ ...ed, glCogsAccount: e.target.value })}>{GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('5')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}</select> : `${p.glCogsAccount}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{isEditing ? <input type="checkbox" checked={ed.trackInventory} onChange={(e) => setEditingPos({ ...ed, trackInventory: e.target.checked })} /> : (p.trackInventory ? 'Yes' : 'No')}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{isEditing ? <input type="checkbox" checked={ed.active} onChange={(e) => setEditingPos({ ...ed, active: e.target.checked })} /> : <span style={{ ...st.badge, backgroundColor: p.active ? '#DEF7EC' : '#F3F4F6', color: p.active ? '#03543F' : '#64748B' }}>{p.active ? 'Yes' : 'No'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>
                          {isEditing ? (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => handleEditPos(editingPos!)}>Save</button>
                              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setEditingPosId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setEditingPosId(p.id); setEditingPos({ ...p }); }}>Edit</button>
                              <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => handleDeletePos(p.id)}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Service Fees ── */}
          {catalogSection === 'fees' && (
            <div style={st.tableWrap} className="helm-table-wrap">
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>Fee Name</th>
                    <th style={st.th}>Type</th>
                    <th style={st.th}>Amount</th>
                    <th style={st.th}>GL Account</th>
                    <th style={st.th}>Tax Class</th>
                    <th style={{ ...st.th, textAlign: 'center' }}>Active</th>
                    <th style={st.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addingFee && (
                    <tr>
                      <td style={st.td}><input style={{ ...st.input, width: '180px' }} value={newFee.name} onChange={(e) => setNewFee({ ...newFee, name: e.target.value })} placeholder="Fee name" /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '100px' }} value={newFee.feeType} onChange={(e) => setNewFee({ ...newFee, feeType: e.target.value as 'FLAT' | 'PERCENT' })}>
                          <option value="FLAT">Flat $</option><option value="PERCENT">Percent %</option>
                        </select>
                      </td>
                      <td style={st.td}><input style={{ ...st.input, width: '80px' }} type="number" step="0.01" value={newFee.amount || ''} onChange={(e) => setNewFee({ ...newFee, amount: +e.target.value })} /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '180px' }} value={newFee.glAccount} onChange={(e) => setNewFee({ ...newFee, glAccount: e.target.value })}>
                          {GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}
                        </select>
                      </td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '120px' }} value={newFee.taxClass} onChange={(e) => setNewFee({ ...newFee, taxClass: e.target.value })}>
                          <option value="Standard">Standard</option>
                          <option value="Tax Exempt">Tax Exempt</option>
                          <option value="Fuel Tax">Fuel Tax</option>
                        </select>
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={newFee.active} onChange={(e) => setNewFee({ ...newFee, active: e.target.checked })} /></td>
                      <td style={st.td}>
                        <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => handleAddFee(newFee)}>Save</button>
                        <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setAddingFee(false)}>Cancel</button>
                      </td>
                    </tr>
                  )}
                  {serviceFees.filter((f) => f.name.toLowerCase().includes(catalogSearch.toLowerCase())).map((f, idx) => {
                    const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                    const isEditing = editingFeeId === f.id;
                    const ed = isEditing ? editingFee! : f;
                    return (
                      <tr key={f.id}>
                        <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{isEditing ? <input style={{ ...st.input, width: '180px' }} value={ed.name} onChange={(e) => setEditingFee({ ...ed, name: e.target.value })} /> : f.name}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '100px' }} value={ed.feeType} onChange={(e) => setEditingFee({ ...ed, feeType: e.target.value as 'FLAT' | 'PERCENT' })}><option value="FLAT">Flat $</option><option value="PERCENT">Percent %</option></select> : (f.feeType === 'PERCENT' ? 'Percent %' : 'Flat $')}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '80px' }} type="number" step="0.01" value={ed.amount} onChange={(e) => setEditingFee({ ...ed, amount: +e.target.value })} /> : (f.feeType === 'PERCENT' ? `${f.amount}%` : `$${f.amount.toFixed(2)}`)}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '180px' }} value={ed.glAccount} onChange={(e) => setEditingFee({ ...ed, glAccount: e.target.value })}>{GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}</select> : `${f.glAccount} - ${GL_ACCOUNTS_FULL.find((gl) => gl.code === f.glAccount)?.name || ''}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '120px' }} value={ed.taxClass} onChange={(e) => setEditingFee({ ...ed, taxClass: e.target.value })}><option value="Standard">Standard</option><option value="Tax Exempt">Tax Exempt</option><option value="Fuel Tax">Fuel Tax</option></select> : <span style={{ ...st.badge, backgroundColor: '#EFF6FF', color: '#1E40AF' }}>{f.taxClass || 'Tax Exempt'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{isEditing ? <input type="checkbox" checked={ed.active} onChange={(e) => setEditingFee({ ...ed, active: e.target.checked })} /> : <span style={{ ...st.badge, backgroundColor: f.active ? '#DEF7EC' : '#F3F4F6', color: f.active ? '#03543F' : '#64748B' }}>{f.active ? 'Yes' : 'No'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>
                          {isEditing ? (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => handleEditFee(editingFee!)}>Save</button>
                              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setEditingFeeId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setEditingFeeId(f.id); setEditingFee({ ...f }); }}>Edit</button>
                              <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => handleDeleteFee(f.id)}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
                  {stripeLoading ? (
                    <span style={{ fontSize: '12px', color: '#94A3B8' }}>Checking connection…</span>
                  ) : stripeStatus?.connected ? (
                    <>
                      <span style={{ ...st.badge, backgroundColor: '#DEF7EC', color: '#03543F' }}>Connected</span>
                      {stripeStatus.accountId && (
                        <span style={{ ...st.mono, fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>{stripeStatus.accountId}</span>
                      )}
                    </>
                  ) : (
                    <span style={{ ...st.badge, backgroundColor: '#F3F4F6', color: '#64748B' }}>Not connected</span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {stripeStatus?.connected ? (
                <>
                  {stripeStatus.dashboardUrl && (
                    <a href={stripeStatus.dashboardUrl} target="_blank" rel="noopener noreferrer" style={{ ...st.outlineBtn, textDecoration: 'none' }}>Dashboard</a>
                  )}
                  <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }} onClick={handleStripeDisconnect} disabled={stripeDisconnecting}>
                    {stripeDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <button style={st.addBtn} onClick={handleStripeConnect} disabled={stripeConnecting}>
                  {stripeConnecting ? 'Connecting…' : 'Connect Stripe'}
                </button>
              )}
            </div>
          </div>

          <div style={st.integrationCard}>
            <div style={st.integrationInfo}>
              <div style={st.integrationIcon}><Building2 size={24} style={{ color: '#2CA01C' }} /></div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>QuickBooks Online</div>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>Sync invoices, payments, and customers</div>
                <div style={{ marginTop: '8px' }}>
                  {qboLoading ? (
                    <span style={{ fontSize: '12px', color: '#94A3B8' }}>Checking connection…</span>
                  ) : qboStatus?.connected ? (
                    <>
                      <span style={{ ...st.badge, backgroundColor: '#DEF7EC', color: '#03543F' }}>Connected</span>
                      {qboStatus.realmId && (
                        <span style={{ fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>
                          Realm: {qboStatus.realmId}
                          {qboStatus.lastSync && ` | Last sync: ${new Date(qboStatus.lastSync).toLocaleString()}`}
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ ...st.badge, backgroundColor: '#F3F4F6', color: '#64748B' }}>Not connected</span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {qboStatus?.connected ? (
                <>
                  <button style={st.outlineBtn} onClick={handleQboSync} disabled={qboSyncing}>
                    <RefreshCw size={14} />{qboSyncing ? ' Syncing…' : ' Sync Now'}
                  </button>
                  <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }} onClick={handleQboDisconnect} disabled={qboDisconnecting}>
                    {qboDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <button style={st.addBtn} onClick={handleQboConnect} disabled={qboConnecting}>
                  {qboConnecting ? 'Connecting…' : 'Connect QuickBooks'}
                </button>
              )}
            </div>
          </div>

          <div style={{ ...st.card, marginTop: '24px' }}>
            <h3 style={st.sectionTitle}><Webhook size={20} /> Webhook Endpoints</h3>
            <div style={{ padding: '24px', textAlign: 'center', color: '#94A3B8', fontSize: '14px', background: '#F8FAFC', borderRadius: '6px', border: '1px dashed #CBD5E1' }}>
              <Webhook size={28} style={{ color: '#CBD5E1', marginBottom: '8px' }} />
              <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#64748B' }}>No webhook endpoints configured</p>
              <p style={{ margin: 0, fontSize: '13px' }}>Webhook management is coming soon. You will be able to subscribe to events like invoice.created, payment.received, and more.</p>
            </div>
          </div>
        </>
      )}

      {/* Team & Roles */}
      {tab === 'team' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ ...st.sectionTitle, marginBottom: 0 }}><ShieldCheck size={20} /> Team Members</h3>
            <button style={st.addBtn} onClick={() => { setShowInviteModal(true); setInviteName(''); setInviteEmail(''); setInviteRole('Dock Staff'); setInviteLocations([]); }}><Plus size={16} /> Invite Team Member</button>
          </div>

          {/* Invite Modal */}
          {showInviteModal && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', width: '480px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Invite Team Member</h3>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setShowInviteModal(false)}><X size={20} /></button>
                </div>
                <div style={st.field}>
                  <label style={st.label}>Full Name</label>
                  <input style={st.input} value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="e.g. John Smith" />
                </div>
                <div style={st.field}>
                  <label style={st.label}>Email</label>
                  <input style={st.input} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="e.g. john@bayshoremarina.com" />
                </div>
                <div style={st.field}>
                  <label style={st.label}>Role</label>
                  <select style={st.select} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    {Object.keys(ROLE_PERMISSIONS).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={st.field}>
                  <label style={st.label}>Location(s)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    {marinaLocations.map((loc) => (
                      <label key={loc.id} style={{ ...st.checkbox, fontSize: '14px' }}>
                        <input
                          type="checkbox"
                          checked={inviteLocations.includes(loc.name)}
                          onChange={(e) => {
                            if (e.target.checked) setInviteLocations([...inviteLocations, loc.name]);
                            else setInviteLocations(inviteLocations.filter((l) => l !== loc.name));
                          }}
                        />
                        {loc.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                  <button style={st.outlineBtn} onClick={() => setShowInviteModal(false)}>Cancel</button>
                  <button style={st.addBtn} onClick={handleSendInvite} disabled={inviting}>{inviting ? 'Sending…' : 'Send Invite'}</button>
                </div>
              </div>
            </div>
          )}

          {/* Team Edit Modal */}
          {editingMember && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', width: '420px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Edit Team Member</h3>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setEditingMember(null)}><X size={20} /></button>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>{editingMember.name}</div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>{editingMember.email}</div>
                </div>
                <div style={st.field}>
                  <label style={st.label}>Role</label>
                  <select style={st.select} value={editingMemberRole} onChange={(e) => setEditingMemberRole(e.target.value)}>
                    {Object.keys(ROLE_DISPLAY_TO_ENUM).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                  <button style={st.outlineBtn} onClick={() => setEditingMember(null)}>Cancel</button>
                  <button style={st.addBtn} onClick={handleTeamEditSave}>Save Changes</button>
                </div>
              </div>
            </div>
          )}

          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Name</th>
                  <th style={st.th}>Email</th>
                  <th style={st.th}>Role</th>
                  <th style={st.th}>Location(s)</th>
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
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {m.locations.map((loc) => (
                            <span key={loc} style={{ ...st.badge, backgroundColor: '#F1F5F9', color: '#0A2342', fontSize: '11px' }}>{loc}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{m.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px', color: m.lastLogin === '—' ? '#94A3B8' : '#0A2342' }}>{m.lastLogin}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '12px' }} onClick={() => { setEditingMember(m); setEditingMemberRole(m.role); }}>Edit</button>
                        <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => handleTeamRemove(m)}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '24px', padding: '14px 16px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '8px', fontSize: '13px', color: '#0369A1' }}>
            Role permissions are now managed in the <button onClick={() => setTab('roles')} style={{ background: 'none', border: 'none', color: '#0369A1', fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Roles tab</button>. You can create custom roles and configure exactly what each one can access.
          </div>
        </>
      )}

      {/* Roles */}
      {tab === 'roles' && (
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
          {/* Left: role list */}
          <div style={{ width: '260px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ ...st.sectionTitle, marginBottom: 0, fontSize: '15px' }}><Shield size={16} /> Roles</h3>
              <button
                style={{ ...st.addBtn, padding: '6px 10px', fontSize: '12px' }}
                onClick={() => setShowNewRoleForm(true)}
              >
                <Plus size={14} /> New
              </button>
            </div>

            {/* Seed prompt */}
            {!rolesLoading && roles.length === 0 && (
              <div style={{ padding: '16px', background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: '8px', textAlign: 'center' }}>
                <Shield size={24} style={{ color: '#94A3B8', marginBottom: '8px' }} />
                <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px', lineHeight: 1.5 }}>No roles yet. Load the standard built-in roles to get started.</p>
                <button
                  style={{ ...st.addBtn, width: '100%', justifyContent: 'center', fontSize: '13px' }}
                  onClick={handleSeedRoles}
                  disabled={seeding}
                >
                  {seeding ? 'Loading…' : 'Load Built-in Roles'}
                </button>
              </div>
            )}

            {/* New role form */}
            {showNewRoleForm && (
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '14px', marginBottom: '10px' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#0A2342', marginBottom: '10px' }}>New Custom Role</div>
                <input
                  style={{ ...st.input, marginBottom: '8px', fontSize: '13px' }}
                  placeholder="Role name *"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                />
                <input
                  style={{ ...st.input, marginBottom: '8px', fontSize: '13px' }}
                  placeholder="Description (optional)"
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <label style={{ fontSize: '12px', color: '#64748B' }}>Color:</label>
                  <input type="color" value={newRoleColor} onChange={(e) => setNewRoleColor(e.target.value)} style={{ width: '32px', height: '24px', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: 0 }} />
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button style={{ ...st.addBtn, flex: 1, justifyContent: 'center', fontSize: '12px' }} onClick={handleCreateRole} disabled={creatingRole || !newRoleName.trim()}>
                    {creatingRole ? 'Creating…' : 'Create'}
                  </button>
                  <button style={{ ...st.outlineBtn, fontSize: '12px' }} onClick={() => setShowNewRoleForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Role list */}
            {rolesLoading ? (
              <div style={{ color: '#94A3B8', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Loading roles…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {roles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: selectedRoleId === role.id ? role.color : '#E2E8F0',
                      background: selectedRoleId === role.id ? `${role.color}14` : '#FFFFFF',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: role.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{role.name}</div>
                      <div style={{ fontSize: '11px', color: '#94A3B8' }}>{role._count?.users ?? 0} user{role._count?.users !== 1 ? 's' : ''}{role.isSystem ? ' · built-in' : ''}</div>
                    </div>
                    {role.isSystem && <Lock size={12} style={{ color: '#94A3B8', flexShrink: 0 }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: permission matrix */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selectedRole ? (
              <div style={{ ...st.card, textAlign: 'center', color: '#94A3B8', padding: '48px' }}>
                <Shield size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
                <p style={{ fontSize: '14px' }}>Select a role to view and edit its permissions</p>
              </div>
            ) : (
              <div style={st.card}>
                {/* Role header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: selectedRole.color }} />
                  <div>
                    <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#0A2342', margin: 0 }}>{selectedRole.name}</h3>
                    {selectedRole.description && <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>{selectedRole.description}</div>}
                  </div>
                  {selectedRole.isSystem && (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748B', background: '#F1F5F9', padding: '4px 10px', borderRadius: '20px' }}>
                      <Lock size={11} /> Built-in
                    </span>
                  )}
                  {!selectedRole.isSystem && (
                    <button
                      style={{ marginLeft: 'auto', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      onClick={() => { if (window.confirm(`Delete role "${selectedRole.name}"?`)) handleDeleteRole(selectedRole.id); }}
                    >
                      <Trash2 size={12} /> Delete Role
                    </button>
                  )}
                </div>

                {selectedRole.isSystem && (
                  <div style={{ fontSize: '13px', color: '#0369A1', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '6px', padding: '8px 12px', marginBottom: '16px' }}>
                    Built-in roles can't be edited. Clone or create a custom role to customise permissions.
                  </div>
                )}

                {/* Permission matrix */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        <th style={{ ...st.th, textAlign: 'left', width: '40%' }}>Module</th>
                        <th style={{ ...st.th, textAlign: 'center', width: '15%' }}>View</th>
                        <th style={{ ...st.th, textAlign: 'center', width: '15%' }}>Create</th>
                        <th style={{ ...st.th, textAlign: 'center', width: '15%' }}>Edit</th>
                        <th style={{ ...st.th, textAlign: 'center', width: '15%' }}>Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MODULE_GROUPS.map((group) => {
                        const groupModules = PERMISSION_MODULES.filter((m) => m.group === group);
                        return (
                          <React.Fragment key={group}>
                            <tr>
                              <td colSpan={5} style={{ padding: '10px 12px 4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94A3B8', background: '#FAFBFC', borderTop: '1px solid #F2F4F6' }}>
                                {group}
                              </td>
                            </tr>
                            {groupModules.map((mod, idx) => {
                              const perm = getPerm(selectedRole, mod.key);
                              const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
                              const disabled = selectedRole.isSystem;
                              return (
                                <tr key={mod.key} style={{ background: rowBg }}>
                                  <td style={{ ...st.td, fontSize: '13px', color: '#0A2342', fontWeight: 500 }}>{mod.label}</td>
                                  {(['canView', 'canCreate', 'canEdit', 'canDelete'] as const).map((field) => {
                                    const checked = perm?.[field] ?? false;
                                    const saving = permSaving === `${selectedRole.id}-${mod.key}-${field}`;
                                    return (
                                      <td key={field} style={{ ...st.td, textAlign: 'center' }}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={disabled || saving}
                                          onChange={(e) => handleTogglePerm(selectedRole.id, mod.key, field, e.target.checked)}
                                          style={{ width: '16px', height: '16px', cursor: disabled ? 'default' : 'pointer', accentColor: selectedRole.color, opacity: saving ? 0.5 : 1 }}
                                        />
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modules */}
      {tab === 'modules' && (
        <div style={st.card}>
          <h3 style={st.sectionTitle}><ToggleRight size={20} /> Module Management</h3>
          <p style={{ color: '#64748B', fontSize: '14px', marginBottom: '12px', lineHeight: 1.6 }}>
            Enable or disable features for the currently selected location. Each marina in your portfolio can have a different configuration — a transient-only stop, a rental-only center, or a full-service facility.
          </p>
          <div style={{ fontSize: '13px', color: '#0369A1', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '6px', padding: '10px 14px', marginBottom: '24px' }}>
            These settings apply to <strong>the location shown in the top bar</strong>. Switch locations there to configure a different marina.
          </div>
          {([
            {
              key: 'transient' as const,
              label: 'Transient Slip Booking',
              description: 'Allow walk-in and online guests to reserve available slips by date. Enables the transient management section, the public-facing booking widget, and nightly rate pricing.',
            },
            {
              key: 'rentals' as const,
              label: 'Rentals',
              description: 'Boat, kayak, jet ski and equipment rentals — includes availability calendar, reservation management, pricing rules, promo codes, and the Rentals dashboard. Also controls the public rental booking widget.',
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
        <>
          <div style={st.card}>
            <h3 style={st.sectionTitle}><Globe size={20} /> Custom Domain</h3>
            <div style={st.formGrid} className="helm-form-grid">
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
            <div style={st.tableWrap} className="helm-table-wrap">
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

      {/* ── Tax Jurisdictions ────────────────────────────────────────────────── */}
      {tab === 'tax' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' }}>Tax Jurisdictions</div>
              <div style={{ fontSize: '13px', color: '#64748B' }}>Define state, county, city, and special district tax rates by product category. Assign jurisdictions to locations in the Locations tab.</div>
            </div>
            <button style={st.addBtn} onClick={() => { setAddingJuris(true); setSelectedJurisId(null); setJurisForm({ code: '', name: '', kind: 'STATE' }); }}>
              <Plus size={14} /> Add Jurisdiction
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '24px', alignItems: 'flex-start' }}>
            {/* Left: list */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #E2E8F0', fontWeight: 700, fontSize: '14px', color: '#0A2342' }}>All Jurisdictions</div>
              {jurisLoading ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>Loading…</div>
              ) : jurisdictions.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>No jurisdictions yet.<br />Click "Add Jurisdiction" to get started.</div>
              ) : (
                <div style={{ padding: '8px' }}>
                  {jurisdictions.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => { setSelectedJurisId(j.id); setJurisForm({ code: j.code, name: j.name, kind: j.kind }); setAddingJuris(false); setAddingRate(false); }}
                      style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: selectedJurisId === j.id ? '#EFF6FF' : 'transparent', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: selectedJurisId === j.id ? '#1D4ED8' : '#374151' }}
                    >
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', flexShrink: 0, ...kindColor(j.kind) }}>{j.kind}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: selectedJurisId === j.id ? 600 : 400 }}>{j.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: detail */}
            <div>
              {addingJuris ? (
                <div style={st.card}>
                  <h3 style={st.sectionTitle}><Plus size={18} /> New Jurisdiction</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px', gap: '16px', marginBottom: '20px' }}>
                    <div style={st.field}>
                      <label style={st.label}>Name</label>
                      <input style={st.input} value={jurisForm.name} onChange={(e) => setJurisForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Florida State" />
                    </div>
                    <div style={st.field}>
                      <label style={st.label}>Code</label>
                      <input style={st.input} value={jurisForm.code} onChange={(e) => setJurisForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="e.g. FL-STATE" />
                    </div>
                    <div style={st.field}>
                      <label style={st.label}>Kind</label>
                      <select style={st.select} value={jurisForm.kind} onChange={(e) => setJurisForm((p) => ({ ...p, kind: e.target.value }))}>
                        <option value="STATE">State</option>
                        <option value="COUNTY">County</option>
                        <option value="CITY">City</option>
                        <option value="SPECIAL">Special District</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button style={st.saveBtn} onClick={() => void handleCreateJuris()} disabled={jurisSaving || !jurisForm.name || !jurisForm.code}>{jurisSaving ? 'Saving…' : 'Create Jurisdiction'}</button>
                    <button style={st.outlineBtn} onClick={() => setAddingJuris(false)}>Cancel</button>
                  </div>
                </div>
              ) : selectedJurisId ? (() => {
                const juris = jurisdictions.find((j) => j.id === selectedJurisId);
                if (!juris) return null;
                const now = new Date();
                const activeRates = juris.rates.filter((r) => new Date(r.effectiveFrom) <= now && (!r.effectiveTo || new Date(r.effectiveTo) >= now));
                return (
                  <>
                    <div style={st.card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ ...st.sectionTitle, marginBottom: 0 }}><Landmark size={18} /> Edit Jurisdiction</h3>
                        <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5', padding: '5px 12px', fontSize: '12px' }} onClick={() => void handleDeleteJuris(juris.id)}><Trash2 size={12} /> Delete</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px', gap: '16px', marginBottom: '16px' }}>
                        <div style={st.field}>
                          <label style={st.label}>Name</label>
                          <input style={st.input} value={jurisForm.name} onChange={(e) => setJurisForm((p) => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div style={st.field}>
                          <label style={st.label}>Code</label>
                          <input style={st.input} value={jurisForm.code} onChange={(e) => setJurisForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} />
                        </div>
                        <div style={st.field}>
                          <label style={st.label}>Kind</label>
                          <select style={st.select} value={jurisForm.kind} onChange={(e) => setJurisForm((p) => ({ ...p, kind: e.target.value }))}>
                            <option value="STATE">State</option>
                            <option value="COUNTY">County</option>
                            <option value="CITY">City</option>
                            <option value="SPECIAL">Special District</option>
                          </select>
                        </div>
                      </div>
                      <button style={st.saveBtn} onClick={() => void handleUpdateJuris()} disabled={jurisSaving}>{jurisSaving ? 'Saving…' : 'Save Changes'}</button>
                    </div>

                    <div style={st.card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ ...st.sectionTitle, marginBottom: 0 }}><Percent size={18} /> Tax Rates</h3>
                        {!addingRate && (
                          <button style={{ ...st.addBtn, padding: '6px 14px', fontSize: '13px' }} onClick={() => setAddingRate(true)}><Plus size={13} /> Add Rate</button>
                        )}
                      </div>

                      {addingRate && (
                        <div style={{ padding: '16px', background: '#F8FAFC', borderRadius: '8px', marginBottom: '16px', border: '1px solid #E2E8F0' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px 160px', gap: '12px', marginBottom: '12px' }}>
                            <div style={st.field}>
                              <label style={st.label}>Category</label>
                              <select style={st.select} value={rateForm.category} onChange={(e) => setRateForm((p) => ({ ...p, category: e.target.value }))}>
                                <option>Standard</option>
                                <option>Fuel Tax</option>
                                <option>Dockage</option>
                                <option>Electric</option>
                                <option>Exempt</option>
                              </select>
                            </div>
                            <div style={st.field}>
                              <label style={st.label}>Rate %</label>
                              <input style={st.input} type="number" step="0.01" min="0" max="100" value={rateForm.ratePct} onChange={(e) => setRateForm((p) => ({ ...p, ratePct: e.target.value }))} placeholder="6.00" />
                            </div>
                            <div style={st.field}>
                              <label style={st.label}>Effective From</label>
                              <input style={st.input} type="date" value={rateForm.effectiveFrom} onChange={(e) => setRateForm((p) => ({ ...p, effectiveFrom: e.target.value }))} />
                            </div>
                            <div style={st.field}>
                              <label style={st.label}>Effective To (opt.)</label>
                              <input style={st.input} type="date" value={rateForm.effectiveTo} onChange={(e) => setRateForm((p) => ({ ...p, effectiveTo: e.target.value }))} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button style={st.saveBtn} onClick={() => void handleAddRate()} disabled={rateSaving || !rateForm.ratePct}>{rateSaving ? 'Adding…' : 'Add Rate'}</button>
                            <button style={st.outlineBtn} onClick={() => setAddingRate(false)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {juris.rates.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>No rates yet. Add a rate to start calculating tax for this jurisdiction.</div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: '#F8FAFC' }}>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Category</th>
                              <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Rate</th>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Effective From</th>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Effective To</th>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Status</th>
                              <th style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }} />
                            </tr>
                          </thead>
                          <tbody>
                            {juris.rates.map((rate) => {
                              const isActive = activeRates.some((r) => r.id === rate.id);
                              return (
                                <tr key={rate.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                  <td style={{ padding: '10px 12px', color: '#0A2342', fontWeight: 500 }}>{rate.category}</td>
                                  <td style={{ padding: '10px 12px', color: '#0A2342', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{(rate.ratePctBps / 100).toFixed(2)}%</td>
                                  <td style={{ padding: '10px 12px', color: '#64748B' }}>{new Date(rate.effectiveFrom).toLocaleDateString()}</td>
                                  <td style={{ padding: '10px 12px', color: '#64748B' }}>{rate.effectiveTo ? new Date(rate.effectiveTo).toLocaleDateString() : '—'}</td>
                                  <td style={{ padding: '10px 12px' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '9999px', background: isActive ? '#DEF7EC' : '#F3F4F6', color: isActive ? '#03543F' : '#6B7280' }}>{isActive ? 'Active' : 'Inactive'}</span>
                                  </td>
                                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: '2px' }} onClick={() => void handleDeleteRate(rate.id, juris.id)}><Trash2 size={14} /></button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}

                      {activeRates.length > 0 && (
                        <div style={{ marginTop: '16px', padding: '12px 16px', background: '#F0FDF4', borderRadius: '6px', border: '1px solid #BBF7D0', display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#065F46' }}>Active rates:</span>
                          {Object.entries(activeRates.reduce((acc, r) => ({ ...acc, [r.category]: (acc[r.category] ?? 0) + r.ratePctBps }), {} as Record<string, number>)).map(([cat, bps]) => (
                            <div key={cat} style={{ fontSize: '13px', color: '#065F46' }}>
                              <span style={{ fontWeight: 500 }}>{cat}: </span>
                              <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{(bps / 100).toFixed(2)}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })() : (
                <div style={{ ...st.card, color: '#94A3B8', textAlign: 'center', padding: '48px' }}>
                  <Landmark size={36} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
                  <div style={{ fontWeight: 600, marginBottom: '6px' }}>No jurisdiction selected</div>
                  <div style={{ fontSize: '13px' }}>Select a jurisdiction from the list, or add a new one to get started.</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
