import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { useBranding } from '../context/BrandingContext';
import {
  Building2, Palette, CreditCard, ShieldCheck,
  Settings as SettingsIcon, Plus, X, Eye, EyeOff,
  Trash2, CheckCircle2, AlertTriangle, RefreshCw, Key,
  Download, Globe, Webhook, Edit2,
  MapPin, Save, XCircle, ChevronDown, ToggleRight,
  Lock, Shield, Users, Landmark, Percent, Copy, Info, Tag, Wifi, Package, Mail,
} from 'lucide-react';
import { useModules } from '../context/ModulesContext';
import CategoriesSettings from '../components/CategoriesSettings';

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
  locationIds: string[];
}

interface ApiUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  active: boolean;
  createdAt: string;
  locationIds?: string[];
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
    locationIds: u.locationIds ?? [],
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

interface ApiKeyEntry {
  id: string;
  name: string;
  key: string;
  created: string;
  lastUsed: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

interface MarinaLocation { id: string; name: string; active?: boolean; stripeConnected?: boolean; qboConnected?: boolean; }

const TEAM: TeamMember[] = [
  { id: '1', name: 'Sarah Dunford', email: 'sarah@bayshoremarina.com', role: 'Marina Owner', roleEnum: 'MARINA_OWNER', status: 'Active', lastLogin: '2026-03-25 9:14 AM', locations: ['Main Dock', 'Fuel Dock', 'Rental Center'], locationIds: [] },
  { id: '2', name: 'Jake Martinez', email: 'jake@bayshoremarina.com', role: 'Marina Manager', roleEnum: 'MARINA_MANAGER', status: 'Active', lastLogin: '2026-03-25 8:02 AM', locations: ['Main Dock', 'Fuel Dock'], locationIds: [] },
  { id: '3', name: 'Maria Santos', email: 'maria@bayshoremarina.com', role: 'Dock Staff', roleEnum: 'DOCK_STAFF', status: 'Active', lastLogin: '2026-03-24 6:45 PM', locations: ['Main Dock'], locationIds: [] },
  { id: '4', name: 'Tom Anderson', email: 'tom@bayshoremarina.com', role: 'POS Cashier', roleEnum: 'POS_CASHIER', status: 'Active', lastLogin: '2026-03-24 5:30 PM', locations: ['Main Dock', 'Rental Center'], locationIds: [] },
  { id: '5', name: 'Lisa Chen', email: 'lisa@bayshoremarina.com', role: 'Accounting', roleEnum: 'ACCOUNTING', status: 'Active', lastLogin: '2026-03-23 3:15 PM', locations: ['Main Dock', 'Fuel Dock', 'Rental Center'], locationIds: [] },
  { id: '6', name: 'Robert Dockside', email: 'robert@bayshoremarina.com', role: 'Dock Staff', roleEnum: 'DOCK_STAFF', status: 'Invited', lastLogin: '—', locations: ['Fuel Dock'], locationIds: [] },
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
  const navigate = useNavigate();
  type SettingsTab = 'profile' | 'branding' | 'billing' | 'team' | 'roles' | 'advanced' | 'modules' | 'locations' | 'tax' | 'categories' | 'terminal' | 'email';
  const VALID_TABS: SettingsTab[] = ['profile', 'branding', 'billing', 'team', 'roles', 'advanced', 'modules', 'locations', 'tax', 'categories', 'terminal', 'email'];
  const tabFromUrl = searchParams.get('tab');
  // Integrations is now managed per-Location, and the Catalog editor lives at
  // /settings/products. Old deep-links are normalized by the effect below.
  const initialTab: SettingsTab =
    tabFromUrl === 'integrations'
      ? 'locations'
      : tabFromUrl && (VALID_TABS as string[]).includes(tabFromUrl)
        ? (tabFromUrl as SettingsTab)
        : 'profile';
  const [tab, setTabState] = useState<SettingsTab>(initialTab);
  const setTab = (next: SettingsTab) => {
    setTabState(next);
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', next);
    if (next !== 'locations') sp.delete('locationId');
    setSearchParams(sp, { replace: true });
  };

  React.useEffect(() => {
    if (tabFromUrl === 'catalog') {
      navigate('/settings/products', { replace: true });
    } else if (tabFromUrl === 'integrations') {
      const sp = new URLSearchParams(searchParams);
      sp.set('tab', 'locations');
      setSearchParams(sp, { replace: true });
    }
  }, [tabFromUrl, navigate, searchParams, setSearchParams]);

  // API calls
  const { execute: updateSettings, loading: savingSettings } = useApi<any>('put', '/api/settings');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const handleSave = async (section: string) => { await updateSettings({ tab: section }); setSavedMsg('Settings saved successfully!'); setTimeout(() => setSavedMsg(null), 2000); };

  // ── Marina Profile (real data from /api/settings/marina) ──────────────
  // The form below was previously a hardcoded mock that always showed
  // "Bayshore Marina". We now fetch the actual tenant profile, bind every
  // field to controlled state, and PUT real changes on save.
  type MarinaProfile = {
    name: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    timezone: string;
    fiscalYearEnd: string;
  };
  const { data: marinaProfileData } = useApi<MarinaProfile>('get', '/api/settings/marina', { immediate: true });
  const { execute: saveMarinaProfile, loading: savingMarinaProfile } = useApi<MarinaProfile>('put', '/api/settings/marina');
  const [marinaName, setMarinaName] = useState('');
  const [marinaPhone, setMarinaPhone] = useState('');
  const [marinaAddress, setMarinaAddress] = useState('');
  const [marinaEmail, setMarinaEmail] = useState('');
  const [marinaWebsite, setMarinaWebsite] = useState('');
  const [marinaTimezone, setMarinaTimezone] = useState('America/New_York');
  React.useEffect(() => {
    if (marinaProfileData) {
      setMarinaName(marinaProfileData.name ?? '');
      setMarinaPhone(marinaProfileData.phone ?? '');
      setMarinaAddress(marinaProfileData.address ?? '');
      setMarinaEmail(marinaProfileData.email ?? '');
      setMarinaWebsite(marinaProfileData.website ?? '');
      if (marinaProfileData.timezone) setMarinaTimezone(marinaProfileData.timezone);
    }
  }, [marinaProfileData]);
  const handleSaveMarinaProfile = async () => {
    const result = await saveMarinaProfile({
      name: marinaName,
      address: marinaAddress,
      phone: marinaPhone,
      email: marinaEmail,
      website: marinaWebsite,
      timezone: marinaTimezone,
      fiscalYearEnd: marinaProfileData?.fiscalYearEnd ?? '12-31',
    });
    if (result) {
      setSavedMsg('Marina profile saved successfully!');
      setTimeout(() => setSavedMsg(null), 2000);
    }
  };

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
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) { setLogoError('Please upload a PNG, JPG, or WebP image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setLogoError('Logo must be under 5 MB.'); return; }
    setLogoUploading(true);
    setLogoError(null);
    try {
      const token = await getToken();
      const presign = await api.post<{ url: string; key: string }>('/storage/presign-upload', { category: 'logo', filename: file.name, contentType: file.type }, token);
      // PUT the file directly to R2 using the presigned URL.
      // A `TypeError`/"Failed to fetch" here means the request was blocked
      // before any HTTP response arrived — almost always the bucket's CORS
      // policy not allowing PUT (or the Content-Type request header) from
      // this origin. See apps/api/r2-cors.json + apps/api/scripts/README.md.
      let put: Response;
      try {
        put = await fetch(presign.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      } catch (netErr) {
        let r2Host = 'unknown';
        try {
          r2Host = new URL(presign.url).host;
        } catch {
          /* presign URL was malformed; the host helps diagnose anyway */
        }
        console.error('[logo upload network error]', {
          stage: 'r2-put',
          r2Host,
          storageKey: presign.key,
          filename: file.name,
          sizeBytes: file.size,
          contentType: file.type,
          error: netErr,
        });
        throw new Error("Couldn't reach file storage. This is usually a network or CORS issue — please contact support.");
      }
      if (!put.ok) {
        throw new Error(`Upload to storage failed (status ${put.status})`);
      }
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
      setLogoError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
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
  const [editingMemberLocationIds, setEditingMemberLocationIds] = React.useState<string[]>([]);

  const handleTeamEditSave = async () => {
    if (!editingMember) return;
    const enumRole = ROLE_DISPLAY_TO_ENUM[editingMemberRole] ?? editingMemberRole;
    const res = await fetch(`/api/settings/team/${editingMember.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: enumRole, locationIds: editingMemberLocationIds }),
    });
    if (res.ok) {
      setTeamMembers((prev) => prev.map((m) => m.id === editingMember.id ? { ...m, role: editingMemberRole, roleEnum: enumRole, locationIds: editingMemberLocationIds } : m));
      setSavedMsg('Member updated');
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

  // Tenant-level Stripe/QBO status. The Integrations tab was retired; these
  // are only kept so the Locations tab can show a one-time migration banner
  // when a legacy tenant-wide connection still exists. Marina owners need to
  // re-link Stripe/QBO under each Location to opt into per-property routing.
  interface QboStatus { connected: boolean; realmId: string | null; lastSync: string | null; }
  const { data: qboStatus } = useApi<QboStatus>('get', '/api/settings/qbo', { immediate: true });

  // Tenant-wide inventory sync status (aggregated across all per-location QBO companies).
  // Surfaced inside the Locations tab when a location has QBO connected.
  const { data: qboInventoryStatus, loading: qboInventoryLoading, execute: fetchQboInventoryStatus } = useApi<{
    itemsSynced: number; itemsWithErrors: number; itemsAwaitingSync: number;
    billsSynced: number; billsWithErrors: number;
    adjustmentsSynced: number; adjustmentsWithErrors: number;
    // Partial-refund pushes to QBO (RefundReceipt). Optional for backwards
    // compat with older API responses that pre-date the refund-receipt sync.
    refundReceiptsSynced?: number; refundReceiptsWithErrors?: number;
    lastItemSyncAt: string | null; lastBillSyncAt: string | null; lastAdjustmentSyncAt: string | null;
    lastRefundReceiptSyncAt?: string | null;
    recentErrors: Array<{ sourceType: string; sourceId: string; qboType: string; error: string; at: string; retryCount: number; nextRetryAt: string | null }>;
    nextAutomaticRetryAt: string | null;
    earliestPendingRetryAt: string | null;
  }>('get', '/api/settings/qbo/inventory-status', { immediate: true });
  // Job-based bulk QBO inventory retry. The POST endpoint kicks off a
  // background job and returns a jobId; we poll the GET endpoint for live
  // progress so the UI can show "Retrying X of Y — A succeeded, B still
  // failing" instead of blocking on a single multi-minute HTTP request.
  interface QboResyncJob {
    jobId: string;
    status: 'running' | 'succeeded' | 'failed';
    total: number;
    processed: number;
    attempted: number;
    succeeded: number;
    failed: number;
    skipped: number;
    error: string | null;
  }
  const [qboResyncJob, setQboResyncJob] = useState<QboResyncJob | null>(null);
  const [qboInventoryRetrying, setQboInventoryRetrying] = useState(false);
  const [qboRetryMsg, setQboRetryMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const qboPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (qboPollRef.current) clearTimeout(qboPollRef.current);
    };
  }, []);

  const handleRetryFailedQboInventory = async () => {
    setQboRetryMsg(null);
    setQboResyncJob(null);
    setQboInventoryRetrying(true);
    let started: QboResyncJob | null = null;
    try {
      const token = await getToken();
      started = await api.post<QboResyncJob>('/api/settings/qbo/inventory-resync', {}, token);
    } catch {
      setQboInventoryRetrying(false);
      setQboRetryMsg({ kind: 'error', text: 'Failed to start re-sync. Please try again.' });
      return;
    }
    if (!started?.jobId) {
      setQboInventoryRetrying(false);
      setQboRetryMsg({ kind: 'error', text: 'Failed to start re-sync. Please try again.' });
      return;
    }
    setQboResyncJob(started);

    const poll = async () => {
      let snap: QboResyncJob | null = null;
      try {
        const token = await getToken();
        snap = await api.get<QboResyncJob>(`/api/settings/qbo/inventory-resync/${started!.jobId}`, token);
      } catch {
        // Network blip — keep polling.
      }
      if (snap) {
        setQboResyncJob(snap);
        if (snap.status !== 'running') {
          setQboInventoryRetrying(false);
          if (snap.status === 'failed') {
            setQboRetryMsg({ kind: 'error', text: snap.error ? `Re-sync failed — ${snap.error}` : 'Re-sync failed. Please try again.' });
          } else if (snap.attempted === 0 && snap.skipped === 0) {
            setQboRetryMsg({ kind: 'info', text: 'No failed sync records to retry.' });
          } else {
            const parts: string[] = [`${snap.succeeded} succeeded`];
            if (snap.failed > 0) parts.push(`${snap.failed} still failing`);
            if (snap.skipped > 0) parts.push(`${snap.skipped} skipped`);
            setQboRetryMsg({
              kind: snap.failed > 0 ? 'error' : 'success',
              text: `Retry complete — ${parts.join(', ')}.`,
            });
          }
          await fetchQboInventoryStatus();
          return;
        }
      }
      qboPollRef.current = setTimeout(poll, 1000);
    };
    qboPollRef.current = setTimeout(poll, 500);
  };

  // Stripe integration
  interface StripeStatus { connected: boolean; accountId: string | null; dashboardUrl: string | null; }
  const { data: stripeStatus } = useApi<StripeStatus>('get', '/api/settings/stripe', { immediate: true });

  // GL Account Mapping state
  const [revenueMapping, setRevenueMapping] = useState<Record<string, string>>(
    Object.fromEntries(REVENUE_MAPPING_DEFAULTS.map((r) => [r.label, r.defaultGL]))
  );
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeRow[]>(PAYMENT_TYPE_DEFAULTS);

  const updatePaymentType = (id: string, field: keyof PaymentTypeRow, value: any) => {
    setPaymentTypes((prev) => prev.map((pt) => pt.id === id ? { ...pt, [field]: value } : pt));
  };

  // Locations from API
  const { data: apiLocations } = useApi<{ data: MarinaLocation[] }>('get', '/api/settings/locations', { immediate: true });
  const [marinaLocations, setMarinaLocations] = useState<MarinaLocation[]>([]);

  React.useEffect(() => {
    if (apiLocations?.data && apiLocations.data.length > 0) {
      setMarinaLocations(apiLocations.data);
    }
  }, [apiLocations]);

  // Per-location settings state (after marinaLocations is declared)
  interface LocationDetail {
    id: string; name: string; address: string; city: string; state: string; zip: string; phone: string;
    timezone: string; active: boolean; transientEnabled: boolean; rentalsEnabled: boolean;
    autoExecuteRenewals: boolean; posAchEnabled: boolean; logoUrl: string;
    qboConnected: boolean; qboRealmId: string | null; qboConnectedAt: string | null;
    stripeConnected: boolean; stripeAccountId: string | null; stripeOnboardingComplete: boolean;
    // Per-location email sender override (Task #273). When any of these
    // are set, sendEmail({ locationId }) uses them in preference to the
    // tenant-level emailFrom* values configured under the Email tab.
    emailFromDomain: string | null; emailFromAddress: string | null;
    emailFromName: string | null; emailReplyTo: string | null;
  }
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [locationDetail, setLocationDetail] = useState<LocationDetail | null>(null);
  const [locationForm, setLocationForm] = useState<Partial<LocationDetail>>({});
  const [locationSaving, setLocationSaving] = useState(false);

  // Tenant-level email sender (Task #273) plus surfaced last-failure
  // health row. Fetched lazily when the Email tab is opened.
  type EmailSender = {
    emailFromDomain: string | null;
    emailFromAddress: string | null;
    emailFromName: string | null;
    emailReplyTo: string | null;
    lastEmailFailureAt: string | null;
    lastEmailFailureRecipient: string | null;
    lastEmailFailureReason: string | null;
  };
  const [emailSender, setEmailSender] = useState<EmailSender | null>(null);
  const [emailSenderForm, setEmailSenderForm] = useState<Partial<EmailSender>>({});
  const [emailSenderSaving, setEmailSenderSaving] = useState(false);
  const [emailSenderError, setEmailSenderError] = useState<string | null>(null);
  const [locationQboLoading, setLocationQboLoading] = useState(false);
  const [locationQboActing, setLocationQboActing] = useState(false);
  const [locationStripeActing, setLocationStripeActing] = useState(false);

  // Live Stripe Connect status pulled from /stripe/refresh-status for
  // the currently-selected location. Separate from
  // `locationDetail.stripeOnboardingComplete` because the DB flag is
  // webhook-driven and can lag, while this reflects what Stripe
  // currently says — including the precise list of requirements they
  // are still waiting on. Also distinct from the tenant-level
  // `stripeStatus` declared above.
  interface LocationStripeRefreshStatus {
    // Stamp the response with the locationId it was fetched for so a
    // late-arriving response from a previously-selected location can be
    // ignored at render time (prevents wrong "Stripe still needs…" data
    // bleeding across fast location switches).
    locationId: string;
    connected: boolean;
    onboardingComplete: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirements?: {
      currentlyDue: string[];
      pastDue: string[];
      eventuallyDue: string[];
      pendingVerification: string[];
      disabledReason: string | null;
    };
    accountId: string | null;
    dashboardUrl: string | null;
  }
  const [locationStripeStatus, setLocationStripeStatus] = useState<LocationStripeRefreshStatus | null>(null);

  // ── Per-location reader pairing health (POS Settings → Terminal) ───────────
  // Each entry tracks the reader discovery result for one location so the
  // Terminal tab can render an at-a-glance "is at least one reader paired
  // and online?" status. We pull from the same `/api/pos/terminal/readers`
  // endpoint the POS modal already uses (per-location Stripe wiring), so
  // this view stays in sync with what cashiers actually see at checkout.
  interface ReaderHealthEntry {
    id: string;
    label: string;
    status: 'online' | 'offline' | 'unknown';
    lastSeenAt: number | null;
    deviceType: string;
  }
  type ReaderHealthState =
    | { state: 'idle' }
    | { state: 'loading' }
    | { state: 'ok'; readers: ReaderHealthEntry[]; fetchedAt: number }
    | { state: 'stripe_not_configured' }
    | { state: 'forbidden' }
    | { state: 'error'; message: string };
  const [readerHealth, setReaderHealth] = useState<Record<string, ReaderHealthState>>({});

  const fetchLocationReaderHealth = React.useCallback(async (locationId: string) => {
    setReaderHealth((prev) => ({ ...prev, [locationId]: { state: 'loading' } }));
    try {
      const token = await getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(
        `/api/pos/terminal/readers?locationId=${encodeURIComponent(locationId)}`,
        { method: 'GET', headers },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = (body as any)?.error;
        if (res.status === 400 && code === 'STRIPE_NOT_CONFIGURED') {
          setReaderHealth((prev) => ({ ...prev, [locationId]: { state: 'stripe_not_configured' } }));
          return;
        }
        if (res.status === 403) {
          setReaderHealth((prev) => ({ ...prev, [locationId]: { state: 'forbidden' } }));
          return;
        }
        setReaderHealth((prev) => ({
          ...prev,
          [locationId]: { state: 'error', message: typeof code === 'string' ? code : `HTTP ${res.status}` },
        }));
        return;
      }
      interface RawReader {
        id: string;
        label?: string | null;
        serial_number?: string | null;
        status?: string | null;
        // Stripe documents `last_seen_at` on Terminal.Reader as milliseconds
        // since epoch — explicitly called out as an exception to Stripe's
        // usual seconds-based timestamps. We pass it straight to `new Date()`
        // (which expects ms), so do NOT multiply by 1000 here.
        last_seen_at?: number | null;
        device_type?: string | null;
      }
      const json = await res.json() as { data?: RawReader[] };
      const readers: ReaderHealthEntry[] = (json.data ?? []).map((r) => ({
        id: String(r.id),
        label: r.label || r.serial_number || 'Reader',
        status: r.status === 'online' ? 'online' : r.status === 'offline' ? 'offline' : 'unknown',
        lastSeenAt: typeof r.last_seen_at === 'number' ? r.last_seen_at : null,
        deviceType: typeof r.device_type === 'string' ? r.device_type : '',
      }));
      setReaderHealth((prev) => ({
        ...prev,
        [locationId]: { state: 'ok', readers, fetchedAt: Date.now() },
      }));
    } catch (err) {
      setReaderHealth((prev) => ({
        ...prev,
        [locationId]: { state: 'error', message: (err as Error).message ?? 'Request failed' },
      }));
    }
  }, [getToken]);

  // Auto-refresh reader health for every location when the Terminal tab is
  // first opened (or the location list changes). Per-location refresh is
  // also exposed on each row so operators can re-check after fixing a reader
  // without leaving the page.
  React.useEffect(() => {
    if (tab !== 'terminal' || marinaLocations.length === 0) return;
    marinaLocations.forEach((loc) => {
      if (!readerHealth[loc.id]) void fetchLocationReaderHealth(loc.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, marinaLocations]);

  const refreshAllReaderHealth = React.useCallback(() => {
    marinaLocations.forEach((loc) => { void fetchLocationReaderHealth(loc.id); });
  }, [marinaLocations, fetchLocationReaderHealth]);

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

  // Pull live Stripe status (capabilities + outstanding requirements)
  // for a location. Safe to call repeatedly; non-fatal if it fails since
  // the cached `locationDetail.stripeOnboardingComplete` flag is the
  // ultimate fallback for the basic Connected/Incomplete badge.
  const refreshLocationStripeStatus = React.useCallback(async (id: string) => {
    try {
      const r = await fetch('/api/settings/stripe/refresh-status', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: id }),
      });
      if (!r.ok) return;
      const body = (await r.json()) as Omit<LocationStripeRefreshStatus, 'locationId'>;
      // Stamp the response with the locationId we asked about so the
      // render guard can reject late responses from a previously-viewed
      // location.
      setLocationStripeStatus({ ...body, locationId: id });
      // If Stripe now reports the account as connected (charges enabled),
      // update the cached locationDetail immediately so the badge flips
      // without waiting for another fetch.
      if (body.connected) {
        setLocationDetail((prev) =>
          prev && prev.id === id
            ? { ...prev, stripeConnected: true, stripeOnboardingComplete: true }
            : prev,
        );
      }
    } catch {
      /* non-fatal background refresh */
    }
  }, []);

  const [locationLoadError, setLocationLoadError] = useState<string | null>(null);
  const fetchLocationDetail = React.useCallback(async (id: string) => {
    setLocationLoadError(null);
    setLocationStripeStatus(null);
    try {
      const r = await fetch(`/api/settings/locations/${id}`, { credentials: 'include' });
      if (r.ok) {
        const body = await r.json();
        setLocationDetail(body.location);
        setLocationForm(body.location);
        // If a Stripe account exists for this location, fetch live status
        // from Stripe so we can show what (if anything) is still pending.
        if (body.location?.stripeAccountId) {
          void refreshLocationStripeStatus(id);
        }
        return;
      }
      // Surface the failure so the user understands why the form stays empty,
      // instead of silently leaving the "Select a location to edit" placeholder
      // up forever. The most common cause is a 403 because the signed-in user
      // does not have a tenant-staff role on this tenant (e.g. a platform
      // admin without a MARINA_OWNER role row).
      let detail = '';
      try {
        const body = await r.json();
        detail = body?.error || body?.code || '';
      } catch {
        /* not JSON */
      }
      const msg =
        r.status === 403
          ? `You don't have permission to view this location's settings (${detail || 'forbidden'}).`
          : r.status === 404
            ? 'Location not found.'
            : `Couldn't load location settings (HTTP ${r.status}${detail ? ` — ${detail}` : ''}).`;
      setLocationLoadError(msg);
      setLocationDetail(null);
      console.error('[settings] failed to load location', id, r.status, detail);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setLocationLoadError(`Couldn't reach the server: ${msg}`);
      setLocationDetail(null);
      console.error('[settings] network error loading location', id, err);
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

  // Lazy-load tenant email sender config when the Email tab is opened
  // (Task #273). Re-fetches every time the tab is shown so the health
  // row reflects the latest failure recorded by recordEmailFailure().
  React.useEffect(() => {
    if (tab !== 'email') return;
    let aborted = false;
    (async () => {
      try {
        const r = await fetch('/api/settings/email-sender', { credentials: 'include' });
        if (!r.ok) {
          if (!aborted) setEmailSenderError(`Couldn't load email settings (${r.status})`);
          return;
        }
        const body = await r.json();
        if (aborted) return;
        setEmailSender(body);
        setEmailSenderForm({
          emailFromDomain: body.emailFromDomain ?? '',
          emailFromAddress: body.emailFromAddress ?? '',
          emailFromName: body.emailFromName ?? '',
          emailReplyTo: body.emailReplyTo ?? '',
        });
        setEmailSenderError(null);
      } catch (e) {
        if (!aborted) setEmailSenderError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { aborted = true; };
  }, [tab]);

  const handleEmailSenderSave = async () => {
    setEmailSenderSaving(true);
    setEmailSenderError(null);
    try {
      const res = await fetch('/api/settings/email-sender', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailFromDomain: emailSenderForm.emailFromDomain || null,
          emailFromAddress: emailSenderForm.emailFromAddress || null,
          emailFromName: emailSenderForm.emailFromName || null,
          emailReplyTo: emailSenderForm.emailReplyTo || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const body = await res.json();
      setEmailSender((prev) => prev ? { ...prev, ...body } : prev);
      setSavedMsg('Email sender saved');
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setEmailSenderError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmailSenderSaving(false);
    }
  };

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
          setTimeout(() => fetchLocationDetail(selectedLocationId), 800);
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
    // Snapshot the location at click time so the popup-completion flow
    // refreshes the location the user actually onboarded, even if they
    // change selection while the OAuth popup is open.
    const targetLocationId = selectedLocationId;
    setLocationStripeActing(true);
    try {
      const res = await fetch('/api/settings/stripe/connect', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: targetLocationId }),
      });
      const body = await res.json();
      if (body.url) {
        openOAuthPopup(body.url, () => {
          // Stripe Connect's `account.updated` webhook is the source of
          // truth for `stripeOnboardingComplete`, but it can be delayed
          // or unreachable. Pull the live account state from Stripe so
          // the UI reflects "connected" as soon as the popup closes.
          (async () => {
            await refreshLocationStripeStatus(targetLocationId);
            await fetchLocationDetail(targetLocationId);
            setSavedMsg('Stripe connected for this location');
            setTimeout(() => setSavedMsg(null), 3000);
          })();
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
    const res = await inviteTeamMember({ email: inviteEmail, firstName, lastName, role: roleEnum, locationIds: inviteLocations });
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

  type TabItem =
    | { key: SettingsTab; label: string; icon: typeof Building2 }
    | { key: string; label: string; icon: typeof Building2; to: string };
  const tabItems: TabItem[] = [
    { key: 'profile', label: 'Marina Profile', icon: Building2 },
    { key: 'locations', label: 'Locations', icon: MapPin },
    { key: 'branding', label: 'Branding', icon: Palette },
    { key: 'billing', label: 'Billing', icon: CreditCard },
    { key: 'team', label: 'Team', icon: Users },
    { key: 'roles', label: 'Roles', icon: Shield },
    { key: 'tax', label: 'Tax', icon: Landmark },
    { key: 'categories', label: 'Categories', icon: Tag },
    { key: 'catalog', label: 'Catalog', icon: Package, to: '/settings/products' },
    { key: 'terminal', label: 'Terminal', icon: Wifi },
    { key: 'modules', label: 'Modules', icon: ToggleRight },
    { key: 'email', label: 'Email', icon: Mail },
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
          const isExternal = 'to' in t;
          const isActive = !isExternal && tab === t.key;
          return (
            <button
              key={t.key}
              style={{ ...st.tab, ...(isActive ? st.tabActive : {}), display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => ('to' in t ? navigate(t.to) : setTab(t.key))}
            >
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
              <input
                style={st.input}
                value={marinaName}
                placeholder="Your marina's name"
                onChange={(e) => setMarinaName(e.target.value)}
              />
            </div>
            <div style={st.field}>
              <label style={st.label}>Phone</label>
              <input
                style={st.input}
                value={marinaPhone}
                placeholder="(555) 555-5555"
                onChange={(e) => setMarinaPhone(e.target.value)}
              />
            </div>
            <div style={st.fieldFull}>
              <label style={st.label}>Address</label>
              <input
                style={st.input}
                value={marinaAddress}
                placeholder="Street, City, State ZIP"
                onChange={(e) => setMarinaAddress(e.target.value)}
              />
            </div>
            <div style={st.field}>
              <label style={st.label}>Email</label>
              <input
                style={st.input}
                value={marinaEmail}
                placeholder="info@yourmarina.com"
                onChange={(e) => setMarinaEmail(e.target.value)}
              />
            </div>
            <div style={st.field}>
              <label style={st.label}>Website</label>
              <input
                style={st.input}
                value={marinaWebsite}
                placeholder="https://yourmarina.com"
                onChange={(e) => setMarinaWebsite(e.target.value)}
              />
            </div>
            <div style={st.field}>
              <label style={st.label}>Timezone</label>
              <select
                style={st.select}
                value={marinaTimezone}
                onChange={(e) => setMarinaTimezone(e.target.value)}
              >
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
          <button style={st.saveBtn} onClick={handleSaveMarinaProfile} disabled={savingMarinaProfile}>
            {savingMarinaProfile ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Locations */}
      {tab === 'locations' && (
        <>
          {/* Migration intro — orient existing customers who used to manage
              integrations under a separate Settings tab. */}
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '12px' }}>
            <MapPin size={20} style={{ color: '#1D4ED8', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' }}>Stripe and QuickBooks now live here</div>
              <div style={{ fontSize: '13px', color: '#1E3A8A', lineHeight: 1.5 }}>
                Each location has its own Stripe Connect account and QuickBooks company file so payments and books stay separated by property. Pick a location below to connect or manage its integrations.
              </div>
            </div>
          </div>

          {/* Legacy migration banner — only shown while a tenant-wide
              Stripe or QuickBooks connection from the old single-account
              model still exists AND at least one location has not yet been
              re-linked. Once every location is connected, the banner
              disappears even if the legacy tenant-level fields remain
              (kept in the database for fallback behavior in
              payments/billing/QBO sync). */}
          {(() => {
            const stripeNeedsMigration = !!stripeStatus?.connected
              && marinaLocations.some((l) => !l.stripeConnected);
            const qboNeedsMigration = !!qboStatus?.connected
              && marinaLocations.some((l) => !l.qboConnected);
            if (!stripeNeedsMigration && !qboNeedsMigration) return null;
            return (
              <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '8px', padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '12px' }}>
                <AlertTriangle size={20} style={{ color: '#B45309', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#7C2D12', marginBottom: '4px' }}>Action needed: migrate to per-location integrations</div>
                  <div style={{ fontSize: '13px', color: '#7C2D12', lineHeight: 1.5 }}>
                    This account still has a marina-wide
                    {stripeNeedsMigration && qboNeedsMigration
                      ? ' Stripe and QuickBooks '
                      : stripeNeedsMigration
                        ? ' Stripe '
                        : ' QuickBooks '}
                    connection from the old setup, and one or more locations have not been re-linked yet. Connect each location individually below — once every location is linked, its sales and books route through the location&apos;s own account.
                  </div>
                </div>
              </div>
            );
          })()}

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
              <div style={{ ...st.card, color: locationLoadError ? '#B91C1C' : '#94A3B8', textAlign: 'center', padding: '48px' }}>
                {locationLoadError || 'Select a location to edit its settings'}
              </div>
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
                    <label style={st.checkbox} title="Show the ACH (bank transfer) button in the POS counter for this location. Off by default — most marinas don't want ACH at the front desk.">
                      <input type="checkbox" checked={!!locationForm.posAchEnabled} onChange={(e) => handleLocationFormChange('posAchEnabled', e.target.checked)} />
                      Show ACH on POS
                    </label>
                  </div>

                  {/* ── Per-location email sender override (Task #273) ── */}
                  <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px dashed #E2E8F0' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#0A2342', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Mail size={16} /> Email sender override
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '12px', lineHeight: 1.5 }}>
                      Optional. Customer emails for guests of this location will be sent from these values; leave any field blank to fall back to the marina-wide setting under <button style={{ background: 'none', border: 'none', color: '#1D4ED8', cursor: 'pointer', padding: 0, fontSize: '12px', fontWeight: 600 }} onClick={() => setTab('email')}>Settings → Email</button>.
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div style={st.field}>
                        <label style={st.label}>From mailbox</label>
                        <input style={st.input} placeholder="billing" value={locationForm.emailFromAddress ?? ''} onChange={(e) => handleLocationFormChange('emailFromAddress', e.target.value)} />
                      </div>
                      <div style={st.field}>
                        <label style={st.label}>Sending domain</label>
                        <input style={st.input} placeholder="app.tracktheturn.com" value={locationForm.emailFromDomain ?? ''} onChange={(e) => handleLocationFormChange('emailFromDomain', e.target.value)} />
                      </div>
                      <div style={st.field}>
                        <label style={st.label}>Display name</label>
                        <input style={st.input} placeholder={locationForm.name ?? 'Marina'} value={locationForm.emailFromName ?? ''} onChange={(e) => handleLocationFormChange('emailFromName', e.target.value)} />
                      </div>
                      <div style={st.field}>
                        <label style={st.label}>Reply-To</label>
                        <input style={st.input} placeholder="dockmaster@yourmarina.com" value={locationForm.emailReplyTo ?? ''} onChange={(e) => handleLocationFormChange('emailReplyTo', e.target.value)} />
                      </div>
                    </div>
                  </div>

                  <button style={{ ...st.saveBtn, marginTop: '20px' }} onClick={handleLocationSave} disabled={locationSaving}>
                    {locationSaving ? 'Saving…' : 'Save Location Settings'}
                  </button>
                </div>

                {/* QuickBooks Online + Stripe Payments connections moved to
                    Accounting Settings (/settings/accounting) so they live
                    next to the GL mappings, posting accounts, and tax
                    jurisdictions they configure. The original per-location
                    cards used to render here. */}
                <div style={{ ...st.integrationCard, marginTop: '20px', borderColor: '#BAE6FD', background: '#F0F9FF' }}>
                  <div style={st.integrationInfo}>
                    <div style={{ ...st.integrationIcon, background: '#E0F2FE' }}>
                      <Building2 size={24} style={{ color: '#0369A1' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>QuickBooks &amp; Stripe</div>
                      <div style={{ fontSize: '13px', color: '#475569', marginTop: '2px', maxWidth: '560px', lineHeight: 1.5 }}>
                        Connect this location's QuickBooks Online company file and Stripe Connect account from <strong>Accounting Settings</strong>, alongside posting-account mappings, sales tax, and rates &amp; fees.
                      </div>
                    </div>
                  </div>
                  <a
                    href="/settings/accounting"
                    style={{
                      ...st.addBtn,
                      background: '#0369A1',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    Open Accounting Settings →
                  </a>
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
        </>
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
              accept="image/png,image/jpeg,image/webp"
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
                          checked={inviteLocations.includes(loc.id)}
                          onChange={(e) => {
                            if (e.target.checked) setInviteLocations([...inviteLocations, loc.id]);
                            else setInviteLocations(inviteLocations.filter((l) => l !== loc.id));
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
                <div style={st.field}>
                  <label style={st.label}>Location(s)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    {marinaLocations.map((loc) => (
                      <label key={loc.id} style={{ ...st.checkbox, fontSize: '14px' }}>
                        <input
                          type="checkbox"
                          checked={editingMemberLocationIds.includes(loc.id)}
                          onChange={(e) => {
                            if (e.target.checked) setEditingMemberLocationIds([...editingMemberLocationIds, loc.id]);
                            else setEditingMemberLocationIds(editingMemberLocationIds.filter((l) => l !== loc.id));
                          }}
                        />
                        {loc.name}
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '6px' }}>
                    Leave all unchecked for tenant-wide roles (Owner/Admin). Bypass roles ignore this restriction.
                  </div>
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
                          {(['MARINA_OWNER', 'TENANT_ADMIN', 'PLATFORM_ADMIN'].includes(m.roleEnum)) ? (
                            <span style={{ ...st.badge, backgroundColor: '#E0F7FF', color: '#0A2342', fontSize: '11px' }}>All locations</span>
                          ) : m.locationIds.length === 0 ? (
                            <span style={{ ...st.badge, backgroundColor: '#FEF3C7', color: '#92400E', fontSize: '11px' }}>No locations</span>
                          ) : (
                            m.locationIds.map((lid) => {
                              const loc = marinaLocations.find((l) => l.id === lid);
                              return (
                                <span key={lid} style={{ ...st.badge, backgroundColor: '#F1F5F9', color: '#0A2342', fontSize: '11px' }}>
                                  {loc?.name ?? lid}
                                </span>
                              );
                            })
                          )}
                        </div>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{m.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px', color: m.lastLogin === '—' ? '#94A3B8' : '#0A2342' }}>{m.lastLogin}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '12px' }} onClick={() => { setEditingMember(m); setEditingMemberRole(m.role); setEditingMemberLocationIds(m.locationIds ?? []); }}>Edit</button>
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
            {
              key: 'ramp' as const,
              label: 'Launch Ramp',
              description: 'Launch ramp pass sales, daily/seasonal permit tracking, and the Launch Ramp section in the sidebar. Disable for marinas without a public boat ramp.',
            },
            {
              key: 'concierge' as const,
              label: 'Concierge',
              description: 'White-glove concierge service requests, task assignment, and the Concierge section in the sidebar. Disable at locations that do not offer concierge service to their slip holders.',
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
      {/* ── Email sender (Task #273) ─────────────────────────────────────── */}
      {tab === 'email' && (
        <>
          <div style={st.card}>
            <h3 style={st.sectionTitle}><Mail size={20} /> Customer email sender</h3>
            <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.6, marginBottom: '20px' }}>
              Customer-facing emails (invoices, contract signature requests, dock walk reports, automation sequences) will be sent from this address. Add the sending domain to your Resend account and verify SPF / DKIM before enabling — otherwise messages will bounce.
            </p>
            {emailSenderError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
                {emailSenderError}
              </div>
            )}
            <div style={st.formGrid} className="helm-form-grid">
              <div style={st.field}>
                <label style={st.label}>From mailbox</label>
                <input
                  style={st.input}
                  placeholder="billing"
                  value={emailSenderForm.emailFromAddress ?? ''}
                  onChange={(e) => setEmailSenderForm((p) => ({ ...p, emailFromAddress: e.target.value }))}
                />
                <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>The local part before <code style={st.mono}>@</code>. Defaults to <code style={st.mono}>noreply</code>.</div>
              </div>
              <div style={st.field}>
                <label style={st.label}>Sending domain</label>
                <input
                  style={st.input}
                  placeholder="app.tracktheturn.com"
                  value={emailSenderForm.emailFromDomain ?? ''}
                  onChange={(e) => setEmailSenderForm((p) => ({ ...p, emailFromDomain: e.target.value }))}
                />
                <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>Must already be verified in your Resend account.</div>
              </div>
              <div style={st.field}>
                <label style={st.label}>Display name</label>
                <input
                  style={st.input}
                  placeholder="Bayshore Marina Billing"
                  value={emailSenderForm.emailFromName ?? ''}
                  onChange={(e) => setEmailSenderForm((p) => ({ ...p, emailFromName: e.target.value }))}
                />
              </div>
              <div style={st.field}>
                <label style={st.label}>Reply-To (optional)</label>
                <input
                  style={st.input}
                  placeholder="dockmaster@yourmarina.com"
                  value={emailSenderForm.emailReplyTo ?? ''}
                  onChange={(e) => setEmailSenderForm((p) => ({ ...p, emailReplyTo: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ marginTop: '16px', padding: '12px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '13px', color: '#334155' }}>
              <strong>Preview:</strong>{' '}
              <code style={st.mono}>
                {emailSenderForm.emailFromName ? `${emailSenderForm.emailFromName} <` : ''}
                {(emailSenderForm.emailFromAddress || 'noreply')}@{emailSenderForm.emailFromDomain || 'gethelm.com'}
                {emailSenderForm.emailFromName ? '>' : ''}
              </code>
              {!emailSenderForm.emailFromDomain && (
                <div style={{ marginTop: '6px', color: '#94A3B8', fontSize: '12px' }}>
                  Leave the domain blank to keep using the system default (<code style={st.mono}>noreply@gethelm.com</code>).
                </div>
              )}
            </div>
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button style={st.addBtn} onClick={handleEmailSenderSave} disabled={emailSenderSaving}>
                <Save size={14} /> {emailSenderSaving ? 'Saving…' : 'Save email sender'}
              </button>
            </div>
          </div>

          {/* Email sending health row — surfaces the most recent failure
              recorded by recordEmailFailure() so operators can spot
              bouncing domains / unverified senders without grepping logs. */}
          <div style={st.card}>
            <h3 style={st.sectionTitle}>
              {emailSender?.lastEmailFailureAt
                ? <><AlertTriangle size={20} style={{ color: '#B45309' }} /> Email sending — issue detected</>
                : <><CheckCircle2 size={20} style={{ color: '#059669' }} /> Email sending — healthy</>}
            </h3>
            {emailSender?.lastEmailFailureAt ? (
              <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '6px', padding: '12px 16px', fontSize: '13px', color: '#7C2D12' }}>
                <div><strong>When:</strong> {new Date(emailSender.lastEmailFailureAt).toLocaleString()}</div>
                <div><strong>Recipient:</strong> {emailSender.lastEmailFailureRecipient ?? '(unknown)'}</div>
                <div style={{ marginTop: '6px' }}><strong>Reason:</strong> {emailSender.lastEmailFailureReason ?? '(no detail)'}</div>
                <div style={{ marginTop: '8px', color: '#92400E', fontSize: '12px' }}>
                  Most common causes: the sending domain isn&apos;t verified in Resend, the recipient is on the suppression list, or the API key is missing. Verify your domain above and re-trigger the email.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#64748B' }}>
                No recent customer-email failures recorded for this marina.
              </div>
            )}
          </div>

          {/* Per-location overrides quick reference */}
          <div style={st.card}>
            <h3 style={st.sectionTitle}><MapPin size={20} /> Per-location overrides</h3>
            <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.6 }}>
              Each location can override the marina-wide sender (useful when properties have their own brand). Open <button style={{ background: 'none', border: 'none', color: '#1D4ED8', cursor: 'pointer', padding: 0, fontSize: '13px', fontWeight: 600 }} onClick={() => setTab('locations')}>Locations</button> and edit the location to set its own From address.
            </p>
          </div>
        </>
      )}

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

      {tab === 'categories' && <CategoriesSettings />}

      {tab === 'terminal' && (
        <>
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '12px' }}>
            <Wifi size={20} style={{ color: '#1D4ED8', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' }}>Card reader pairing health</div>
              <div style={{ fontSize: '13px', color: '#1E3A8A', lineHeight: 1.5 }}>
                Each location uses its own Stripe account, so card readers must be paired separately at every property. If a location has no online reader, card sales there fall back to manual keyed entry — which costs more in interchange and is slower for customers. Use this view to spot and fix unpaired locations before it shows up on your statement.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#64748B' }}>
              Status comes from Stripe&apos;s reader heartbeat. Use <strong>Refresh</strong> to re-run discovery without leaving the page.
            </div>
            <button
              type="button"
              style={st.outlineBtn}
              onClick={refreshAllReaderHealth}
              disabled={marinaLocations.length === 0}
            >
              <RefreshCw size={14} /> Refresh all
            </button>
          </div>

          {marinaLocations.length === 0 ? (
            <div style={{ ...st.card, textAlign: 'center', color: '#94A3B8', padding: '48px' }}>
              No locations configured yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {marinaLocations.map((loc) => {
                const entry = readerHealth[loc.id] ?? { state: 'idle' as const };
                const onlineReaders = entry.state === 'ok' ? entry.readers.filter((r) => r.status === 'online') : [];

                let pillBg = '#F3F4F6';
                let pillFg = '#64748B';
                let pillIcon: React.ReactNode = <Info size={12} />;
                let pillText = 'Checking…';
                if (entry.state === 'loading' || entry.state === 'idle') {
                  pillBg = '#F3F4F6'; pillFg = '#64748B';
                  pillIcon = <RefreshCw size={12} />;
                  pillText = entry.state === 'loading' ? 'Checking reader…' : 'Not checked yet';
                } else if (entry.state === 'stripe_not_configured') {
                  pillBg = '#F3F4F6'; pillFg = '#64748B';
                  pillIcon = <Info size={12} />;
                  pillText = 'Stripe not connected';
                } else if (entry.state === 'forbidden') {
                  pillBg = '#FEF3C7'; pillFg = '#92400E';
                  pillIcon = <Lock size={12} />;
                  pillText = 'No access';
                } else if (entry.state === 'error') {
                  pillBg = '#FEE2E2'; pillFg = '#991B1B';
                  pillIcon = <AlertTriangle size={12} />;
                  pillText = 'Could not check';
                } else if (entry.state === 'ok') {
                  if (entry.readers.length === 0) {
                    pillBg = '#FEE2E2'; pillFg = '#991B1B';
                    pillIcon = <AlertTriangle size={12} />;
                    pillText = 'No reader paired';
                  } else if (onlineReaders.length > 0) {
                    pillBg = '#DEF7EC'; pillFg = '#03543F';
                    pillIcon = <CheckCircle2 size={12} />;
                    pillText = entry.readers.length > 1
                      ? `${onlineReaders.length} of ${entry.readers.length} online`
                      : 'Reader online';
                  } else {
                    pillBg = '#FEF3C7'; pillFg = '#92400E';
                    pillIcon = <AlertTriangle size={12} />;
                    pillText = entry.readers.length > 1 ? 'All readers offline' : 'Reader offline';
                  }
                }

                return (
                  <div key={loc.id} style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                        <MapPin size={18} style={{ color: '#0A2342', flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>{loc.name}</div>
                          <div style={{ marginTop: '6px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '999px', backgroundColor: pillBg, color: pillFg, fontSize: '12px', fontWeight: 600 }}>
                            {pillIcon} {pillText}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        style={{ ...st.outlineBtn, padding: '6px 10px', fontSize: '12px' }}
                        onClick={() => { void fetchLocationReaderHealth(loc.id); }}
                        disabled={entry.state === 'loading'}
                      >
                        <RefreshCw size={12} />{entry.state === 'loading' ? ' Checking…' : ' Refresh'}
                      </button>
                    </div>

                    {entry.state === 'stripe_not_configured' && (
                      <div style={{ marginTop: '10px', fontSize: '12px', color: '#475569' }}>
                        Connect Stripe for this location in <a href={`/settings?tab=locations&locationId=${encodeURIComponent(loc.id)}`} style={{ color: '#1D4ED8', textDecoration: 'underline' }}>Settings → Locations</a> before pairing a reader.
                      </div>
                    )}

                    {entry.state === 'forbidden' && (
                      <div style={{ marginTop: '10px', fontSize: '12px', color: '#92400E' }}>
                        Your role doesn&apos;t have access to this location&apos;s payment settings.
                      </div>
                    )}

                    {entry.state === 'error' && (
                      <div style={{ marginTop: '10px', fontSize: '12px', color: '#991B1B' }}>
                        {entry.message}
                      </div>
                    )}

                    {entry.state === 'ok' && entry.readers.length === 0 && (
                      <div style={{ marginTop: '10px', fontSize: '12px', color: '#475569' }}>
                        No card reader is registered to this location&apos;s Stripe account. Card sales here will fall back to manually keyed entry.
                      </div>
                    )}

                    {entry.state === 'ok' && entry.readers.length > 0 && (
                      <div style={{ marginTop: '12px', borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', marginBottom: '8px' }}>
                          Registered readers
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {entry.readers.map((r) => {
                            const isOnline = r.status === 'online';
                            const dotColor = isOnline ? '#10B981' : r.status === 'offline' ? '#94A3B8' : '#CBD5E1';
                            const lastSeen = r.lastSeenAt ? new Date(r.lastSeenAt) : null;
                            return (
                              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 12px', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {r.label}
                                    </div>
                                    {r.deviceType && (
                                      <div style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'monospace' }}>{r.deviceType}</div>
                                    )}
                                  </div>
                                </div>
                                <div style={{ fontSize: '12px', color: '#64748B', textAlign: 'right', flexShrink: 0 }}>
                                  <div style={{ fontWeight: 600, color: isOnline ? '#03543F' : '#475569' }}>
                                    {isOnline ? 'Online' : r.status === 'offline' ? 'Offline' : 'Unknown'}
                                  </div>
                                  <div style={{ marginTop: '2px' }}>
                                    {lastSeen ? `Last seen ${lastSeen.toLocaleString()}` : 'Last seen —'}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {entry.state === 'ok' && (
                      <div style={{ marginTop: '10px', fontSize: '11px', color: '#94A3B8' }}>
                        Checked {new Date(entry.fetchedAt).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
