import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  Building2, Palette, CreditCard, Link, ShieldCheck,
  Settings as SettingsIcon, Plus, X, Eye, EyeOff,
  Trash2, CheckCircle2, AlertTriangle, RefreshCw, Key,
  Download, Globe, Webhook, Package, Search, Edit2,
  MapPin, Save, XCircle, ChevronDown, ToggleRight,
  Lock, Shield, Users,
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

const MARINA_LOCATIONS = [
  { id: 'main', name: 'Main Dock' },
  { id: 'fuel', name: 'Fuel Dock' },
  { id: 'rental', name: 'Rental Center' },
];

const TEAM: TeamMember[] = [
  { id: '1', name: 'Sarah Dunford', email: 'sarah@bayshoremarina.com', role: 'Marina Owner', status: 'Active', lastLogin: '2026-03-25 9:14 AM', locations: ['Main Dock', 'Fuel Dock', 'Rental Center'] },
  { id: '2', name: 'Jake Martinez', email: 'jake@bayshoremarina.com', role: 'Marina Manager', status: 'Active', lastLogin: '2026-03-25 8:02 AM', locations: ['Main Dock', 'Fuel Dock'] },
  { id: '3', name: 'Maria Santos', email: 'maria@bayshoremarina.com', role: 'Dock Staff', status: 'Active', lastLogin: '2026-03-24 6:45 PM', locations: ['Main Dock'] },
  { id: '4', name: 'Tom Anderson', email: 'tom@bayshoremarina.com', role: 'POS Cashier', status: 'Active', lastLogin: '2026-03-24 5:30 PM', locations: ['Main Dock', 'Rental Center'] },
  { id: '5', name: 'Lisa Chen', email: 'lisa@bayshoremarina.com', role: 'Accounting', status: 'Active', lastLogin: '2026-03-23 3:15 PM', locations: ['Main Dock', 'Fuel Dock', 'Rental Center'] },
  { id: '6', name: 'Robert Dockside', email: 'robert@bayshoremarina.com', role: 'Dock Staff', status: 'Invited', lastLogin: '—', locations: ['Fuel Dock'] },
];

const DOCKAGE_RATES_DATA: DockageRate[] = [
  { id: 'd1', slipType: '25ft Open', monthlyRate: 450, quarterlyRate: 1250, annualRate: 4800, electricityMode: 'Metered', electricityRate: 0.14, glAccount: '4100', active: true },
  { id: 'd2', slipType: '30ft Open', monthlyRate: 575, quarterlyRate: 1600, annualRate: 6200, electricityMode: 'Metered', electricityRate: 0.14, glAccount: '4100', active: true },
  { id: 'd3', slipType: '30ft Covered', monthlyRate: 725, quarterlyRate: 2050, annualRate: 7900, electricityMode: 'Flat', electricityRate: 75, glAccount: '4100', active: true },
  { id: 'd4', slipType: '40ft Open', monthlyRate: 850, quarterlyRate: 2400, annualRate: 9200, electricityMode: 'Metered', electricityRate: 0.14, glAccount: '4100', active: true },
  { id: 'd5', slipType: '40ft Covered', monthlyRate: 1050, quarterlyRate: 2950, annualRate: 11400, electricityMode: 'Flat', electricityRate: 125, glAccount: '4100', active: true },
  { id: 'd6', slipType: '50ft Open', monthlyRate: 1200, quarterlyRate: 3400, annualRate: 13000, electricityMode: 'Metered', electricityRate: 0.14, glAccount: '4100', active: true },
  { id: 'd7', slipType: '50ft Covered', monthlyRate: 1450, quarterlyRate: 4100, annualRate: 15800, electricityMode: 'Flat', electricityRate: 175, glAccount: '4100', active: true },
  { id: 'd8', slipType: '60ft End-Tie', monthlyRate: 1800, quarterlyRate: 5100, annualRate: 19500, electricityMode: 'Metered', electricityRate: 0.14, glAccount: '4100', active: false },
];

const RENTAL_PRODUCTS_DATA: RentalProduct[] = [
  { id: 'r1', name: '20ft Pontoon - Sun Tracker', type: 'Pontoon', hourlyRate: 75, halfDayRate: 225, dailyRate: 395, damageWaiver: 35, deposit: 500, glAccount: '4300', active: true },
  { id: 'r2', name: '22ft Pontoon - Bennington', type: 'Pontoon', hourlyRate: 95, halfDayRate: 275, dailyRate: 475, damageWaiver: 40, deposit: 500, glAccount: '4300', active: true },
  { id: 'r3', name: 'Yamaha WaveRunner EX', type: 'Jet Ski', hourlyRate: 85, halfDayRate: 250, dailyRate: 425, damageWaiver: 30, deposit: 300, glAccount: '4300', active: true },
  { id: 'r4', name: 'Sea-Doo Spark Trixx', type: 'Jet Ski', hourlyRate: 75, halfDayRate: 220, dailyRate: 375, damageWaiver: 30, deposit: 300, glAccount: '4300', active: true },
  { id: 'r5', name: '17ft Boston Whaler', type: 'Motorboat', hourlyRate: 110, halfDayRate: 325, dailyRate: 550, damageWaiver: 45, deposit: 750, glAccount: '4300', active: true },
  { id: 'r6', name: 'Hobie Cat 16', type: 'Sailboat', hourlyRate: 55, halfDayRate: 160, dailyRate: 275, damageWaiver: 25, deposit: 400, glAccount: '4300', active: false },
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

const SERVICE_FEES_DATA: ServiceFee[] = [
  { id: 'sf1', name: 'Pump-Out Fee', amount: 25, glAccount: '4800', active: true },
  { id: 'sf2', name: 'Launch Ramp - Single Use', amount: 20, glAccount: '4700', active: true },
  { id: 'sf3', name: 'Launch Ramp - Annual Pass', amount: 350, glAccount: '4700', active: true },
  { id: 'sf4', name: 'Transient Nightly (per ft)', amount: 3.50, glAccount: '4600', active: true },
  { id: 'sf5', name: 'Live-Aboard Surcharge', amount: 200, glAccount: '4100', active: true },
  { id: 'sf6', name: 'Winter Storage (per ft/mo)', amount: 8, glAccount: '4100', active: true },
  { id: 'sf7', name: 'Jet Ski Lift Fee', amount: 15, glAccount: '4800', active: true },
  { id: 'sf8', name: 'Package Receiving', amount: 5, glAccount: '4800', active: false },
];

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
  const { modules, setModule } = useModules();
  const [tab, setTab] = useState<'profile' | 'branding' | 'billing' | 'catalog' | 'integrations' | 'team' | 'roles' | 'advanced' | 'modules'>('profile');

  // API calls
  const { data: apiSettings, loading: settingsLoading } = useApi<any>('get', '/api/settings', { immediate: true });
  const { execute: updateSettings, loading: savingSettings } = useApi<any>('put', '/api/settings');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const handleSave = async (section: string) => { await updateSettings({ tab: section }); setSavedMsg('Settings saved successfully!'); setTimeout(() => setSavedMsg(null), 2000); };
  const { data: apiTeam, loading: teamLoading } = useApi<TeamMember[]>('get', '/api/settings/team', { immediate: true });

  // Use API data when available, fall back to mock
  const teamMembers = apiTeam ?? TEAM;

  // GL Account Mapping state
  const [revenueMapping, setRevenueMapping] = useState<Record<string, string>>(
    Object.fromEntries(REVENUE_MAPPING_DEFAULTS.map((r) => [r.label, r.defaultGL]))
  );
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeRow[]>(PAYMENT_TYPE_DEFAULTS);

  const updatePaymentType = (id: string, field: keyof PaymentTypeRow, value: any) => {
    setPaymentTypes((prev) => prev.map((pt) => pt.id === id ? { ...pt, [field]: value } : pt));
  };

  // Catalog state
  const [catalogLocation, setCatalogLocation] = useState('main');
  const [catalogSection, setCatalogSection] = useState<'dockage' | 'rentals' | 'pos' | 'fees'>('dockage');
  const [catalogSearch, setCatalogSearch] = useState('');

  const [dockageRates, setDockageRates] = useState<DockageRate[]>(DOCKAGE_RATES_DATA);
  const [editingDockageId, setEditingDockageId] = useState<string | null>(null);
  const [editingDockage, setEditingDockage] = useState<DockageRate | null>(null);
  const [addingDockage, setAddingDockage] = useState(false);
  const [newDockage, setNewDockage] = useState<DockageRate>({ id: '', slipType: '', monthlyRate: 0, quarterlyRate: 0, annualRate: 0, electricityMode: 'Metered', electricityRate: 0.14, glAccount: '4100', active: true });

  const [rentalProducts, setRentalProducts] = useState<RentalProduct[]>(RENTAL_PRODUCTS_DATA);
  const [editingRentalId, setEditingRentalId] = useState<string | null>(null);
  const [editingRental, setEditingRental] = useState<RentalProduct | null>(null);
  const [addingRental, setAddingRental] = useState(false);
  const [newRental, setNewRental] = useState<RentalProduct>({ id: '', name: '', type: 'Pontoon', hourlyRate: 0, halfDayRate: 0, dailyRate: 0, damageWaiver: 0, deposit: 0, glAccount: '4300', active: true });

  const [posItems, setPosItems] = useState<POSItem[]>(POS_ITEMS_DATA);
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editingPos, setEditingPos] = useState<POSItem | null>(null);
  const [addingPos, setAddingPos] = useState(false);
  const [newPos, setNewPos] = useState<POSItem>({ id: '', sku: '', name: '', category: 'Marine', cost: 0, price: 0, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true });

  const [serviceFees, setServiceFees] = useState<ServiceFee[]>(SERVICE_FEES_DATA);
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null);
  const [editingFee, setEditingFee] = useState<ServiceFee | null>(null);
  const [addingFee, setAddingFee] = useState(false);
  const [newFee, setNewFee] = useState<ServiceFee>({ id: '', name: '', amount: 0, glAccount: '4800', active: true });

  // Team invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Dock Staff');
  const [inviteLocations, setInviteLocations] = useState<string[]>([]);

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
    { key: 'branding', label: 'Branding', icon: Palette },
    { key: 'billing', label: 'Billing', icon: CreditCard },
    { key: 'catalog', label: 'Catalog', icon: Package },
    { key: 'integrations', label: 'Integrations', icon: Link },
    { key: 'team', label: 'Team', icon: Users },
    { key: 'roles', label: 'Roles', icon: Shield },
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
            <div style={st.formGrid} className="helm-form-grid">
              <div style={st.field}>
                <label style={st.label}>Company Display Name</label>
                <input style={st.input} defaultValue="Bayshore Marina LLC" />
              </div>
              <div style={st.field}>
                <label style={st.label}>Tagline</label>
                <input style={st.input} defaultValue="Your home on the water" />
              </div>
            </div>
            <button style={st.saveBtn} onClick={() => handleSave('branding')} disabled={savingSettings}>
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
          {/* Location Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MapPin size={16} style={{ color: '#00D4FF' }} />
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Location:</span>
              <select style={{ ...st.select, width: '240px' }} value={catalogLocation} onChange={(e) => setCatalogLocation(e.target.value)}>
                {MARINA_LOCATIONS.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
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
                if (catalogSection === 'dockage') { setAddingDockage(true); setNewDockage({ id: '', slipType: '', monthlyRate: 0, quarterlyRate: 0, annualRate: 0, electricityMode: 'Metered', electricityRate: 0.14, glAccount: '4100', active: true }); }
                if (catalogSection === 'rentals') { setAddingRental(true); setNewRental({ id: '', name: '', type: 'Pontoon', hourlyRate: 0, halfDayRate: 0, dailyRate: 0, damageWaiver: 0, deposit: 0, glAccount: '4300', active: true }); }
                if (catalogSection === 'pos') { setAddingPos(true); setNewPos({ id: '', sku: '', name: '', category: 'Marine', cost: 0, price: 0, taxClass: 'Standard', glRevenueAccount: '4500', glCogsAccount: '5200', trackInventory: true, active: true }); }
                if (catalogSection === 'fees') { setAddingFee(true); setNewFee({ id: '', name: '', amount: 0, glAccount: '4800', active: true }); }
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
                        <select style={{ ...st.select, width: '100px' }} value={newDockage.electricityMode} onChange={(e) => setNewDockage({ ...newDockage, electricityMode: e.target.value as 'Flat' | 'Metered' })}>
                          <option>Metered</option><option>Flat</option>
                        </select>
                      </td>
                      <td style={st.td}><input style={{ ...st.input, width: '70px' }} type="number" step="0.01" value={newDockage.electricityRate || ''} onChange={(e) => setNewDockage({ ...newDockage, electricityRate: +e.target.value })} /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '160px' }} value={newDockage.glAccount} onChange={(e) => setNewDockage({ ...newDockage, glAccount: e.target.value })}>
                          {GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}
                        </select>
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={newDockage.active} onChange={(e) => setNewDockage({ ...newDockage, active: e.target.checked })} /></td>
                      <td style={st.td}>
                        <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setDockageRates([...dockageRates, { ...newDockage, id: 'd' + Date.now() }]); setAddingDockage(false); }}>Save</button>
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
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '100px' }} value={ed.electricityMode} onChange={(e) => setEditingDockage({ ...ed, electricityMode: e.target.value as 'Flat' | 'Metered' })}><option>Metered</option><option>Flat</option></select> : d.electricityMode}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '70px' }} type="number" step="0.01" value={ed.electricityRate} onChange={(e) => setEditingDockage({ ...ed, electricityRate: +e.target.value })} /> : (d.electricityMode === 'Flat' ? `$${d.electricityRate}/mo` : `$${d.electricityRate}/kWh`)}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '160px' }} value={ed.glAccount} onChange={(e) => setEditingDockage({ ...ed, glAccount: e.target.value })}>{GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}</select> : `${d.glAccount} - ${GL_ACCOUNTS_FULL.find((gl) => gl.code === d.glAccount)?.name || ''}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{isEditing ? <input type="checkbox" checked={ed.active} onChange={(e) => setEditingDockage({ ...ed, active: e.target.checked })} /> : <span style={{ ...st.badge, backgroundColor: d.active ? '#DEF7EC' : '#F3F4F6', color: d.active ? '#03543F' : '#64748B' }}>{d.active ? 'Yes' : 'No'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>
                          {isEditing ? (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setDockageRates(dockageRates.map((r) => r.id === d.id ? editingDockage! : r)); setEditingDockageId(null); }}>Save</button>
                              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setEditingDockageId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setEditingDockageId(d.id); setEditingDockage({ ...d }); }}>Edit</button>
                              <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setDockageRates(dockageRates.filter((r) => r.id !== d.id))}>Delete</button>
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
                      <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={newRental.active} onChange={(e) => setNewRental({ ...newRental, active: e.target.checked })} /></td>
                      <td style={st.td}>
                        <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setRentalProducts([...rentalProducts, { ...newRental, id: 'r' + Date.now() }]); setAddingRental(false); }}>Save</button>
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
                        <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{isEditing ? <input type="checkbox" checked={ed.active} onChange={(e) => setEditingRental({ ...ed, active: e.target.checked })} /> : <span style={{ ...st.badge, backgroundColor: r.active ? '#DEF7EC' : '#F3F4F6', color: r.active ? '#03543F' : '#64748B' }}>{r.active ? 'Yes' : 'No'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>
                          {isEditing ? (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setRentalProducts(rentalProducts.map((p) => p.id === r.id ? editingRental! : p)); setEditingRentalId(null); }}>Save</button>
                              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setEditingRentalId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setEditingRentalId(r.id); setEditingRental({ ...r }); }}>Edit</button>
                              <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setRentalProducts(rentalProducts.filter((p) => p.id !== r.id))}>Delete</button>
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
                        <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setPosItems([...posItems, { ...newPos, id: 'p' + Date.now() }]); setAddingPos(false); }}>Save</button>
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
                              <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setPosItems(posItems.map((i) => i.id === p.id ? editingPos! : i)); setEditingPosId(null); }}>Save</button>
                              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setEditingPosId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setEditingPosId(p.id); setEditingPos({ ...p }); }}>Edit</button>
                              <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setPosItems(posItems.filter((i) => i.id !== p.id))}>Delete</button>
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
                    <th style={st.th}>Amount</th>
                    <th style={st.th}>GL Account</th>
                    <th style={{ ...st.th, textAlign: 'center' }}>Active</th>
                    <th style={st.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addingFee && (
                    <tr>
                      <td style={st.td}><input style={{ ...st.input, width: '200px' }} value={newFee.name} onChange={(e) => setNewFee({ ...newFee, name: e.target.value })} placeholder="Fee name" /></td>
                      <td style={st.td}><input style={{ ...st.input, width: '90px' }} type="number" step="0.01" value={newFee.amount || ''} onChange={(e) => setNewFee({ ...newFee, amount: +e.target.value })} /></td>
                      <td style={st.td}>
                        <select style={{ ...st.select, width: '200px' }} value={newFee.glAccount} onChange={(e) => setNewFee({ ...newFee, glAccount: e.target.value })}>
                          {GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}
                        </select>
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={newFee.active} onChange={(e) => setNewFee({ ...newFee, active: e.target.checked })} /></td>
                      <td style={st.td}>
                        <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setServiceFees([...serviceFees, { ...newFee, id: 'sf' + Date.now() }]); setAddingFee(false); }}>Save</button>
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
                        <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{isEditing ? <input style={{ ...st.input, width: '200px' }} value={ed.name} onChange={(e) => setEditingFee({ ...ed, name: e.target.value })} /> : f.name}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <input style={{ ...st.input, width: '90px' }} type="number" step="0.01" value={ed.amount} onChange={(e) => setEditingFee({ ...ed, amount: +e.target.value })} /> : `$${f.amount.toFixed(2)}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>{isEditing ? <select style={{ ...st.select, width: '200px' }} value={ed.glAccount} onChange={(e) => setEditingFee({ ...ed, glAccount: e.target.value })}>{GL_ACCOUNTS_FULL.filter((gl) => gl.code.startsWith('4')).map((gl) => <option key={gl.code} value={gl.code}>{gl.code} - {gl.name}</option>)}</select> : `${f.glAccount} - ${GL_ACCOUNTS_FULL.find((gl) => gl.code === f.glAccount)?.name || ''}`}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{isEditing ? <input type="checkbox" checked={ed.active} onChange={(e) => setEditingFee({ ...ed, active: e.target.checked })} /> : <span style={{ ...st.badge, backgroundColor: f.active ? '#DEF7EC' : '#F3F4F6', color: f.active ? '#03543F' : '#64748B' }}>{f.active ? 'Yes' : 'No'}</span>}</td>
                        <td style={{ ...st.td, backgroundColor: rowBg }}>
                          {isEditing ? (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setServiceFees(serviceFees.map((s) => s.id === f.id ? editingFee! : s)); setEditingFeeId(null); }}>Save</button>
                              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setEditingFeeId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginRight: '8px' }} onClick={() => { setEditingFeeId(f.id); setEditingFee({ ...f }); }}>Edit</button>
                              <button style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setServiceFees(serviceFees.filter((s) => s.id !== f.id))}>Delete</button>
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
                  <span style={{ ...st.badge, backgroundColor: '#DEF7EC', color: '#03543F' }}>Connected</span>
                  <span style={{ ...st.mono, fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>acct_1Nq****Yz8x</span>
                </div>
              </div>
            </div>
            <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }} onClick={() => { setSavedMsg('Stripe disconnected'); setTimeout(() => setSavedMsg(null), 2000); }}>Disconnect</button>
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
              <button style={st.outlineBtn} onClick={() => { setSavedMsg('QuickBooks sync started...'); setTimeout(() => setSavedMsg(null), 2000); }}><RefreshCw size={14} /> Sync Now</button>
              <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }} onClick={() => { setSavedMsg('QuickBooks disconnected'); setTimeout(() => setSavedMsg(null), 2000); }}>Disconnect</button>
            </div>
          </div>

          <div style={{ ...st.card, marginTop: '24px' }}>
            <h3 style={st.sectionTitle}><Webhook size={20} /> Webhook Endpoints</h3>
            <div style={st.tableWrap} className="helm-table-wrap">
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
                    <td style={st.td}><button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => { setSavedMsg('Editing webhook endpoint...'); setTimeout(() => setSavedMsg(null), 2000); }}>Edit</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button style={{ ...st.outlineBtn, marginTop: '16px' }} onClick={() => { setSavedMsg('Add endpoint form would open here'); setTimeout(() => setSavedMsg(null), 2000); }}><Plus size={14} /> Add Endpoint</button>
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
                    {MARINA_LOCATIONS.map((loc) => (
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
                  <button style={st.addBtn} onClick={() => { setShowInviteModal(false); setSavedMsg(`Invitation sent to ${inviteEmail || 'team member'}`); setTimeout(() => setSavedMsg(null), 2000); }}>Send Invite</button>
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
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => { setSavedMsg(`Editing ${m.name}...`); setTimeout(() => setSavedMsg(null), 2000); }}>Edit</button>
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
    </div>
  );
}
