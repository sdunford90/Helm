import { useState } from 'react';
import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom';
import { useUser, useAuth, RedirectToSignIn } from '@clerk/clerk-react';
import HelpCenter from './HelpCenter';
import ImpersonationBanner from './ImpersonationBanner';
import { useModules } from '../context/ModulesContext';
import { useCurrentUser } from '../hooks/useCurrentUser';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Anchor,
  FileText,
  DollarSign,
  Ship,
  ShoppingCart,
  ClipboardCheck,
  BarChart3,
  Megaphone,
  Settings,
  HelpCircle,
  List,
  Bed,
  Waves,
  Bell as ConciergeBell,
  Fuel,
  MapPin,
  ChevronDown,
  Package,
  ClipboardList,
  X,
  User,
  LogOut,
  Landmark,
  Mail,
  Activity,
  ShieldCheck,
  Calendar,
  Wrench,
} from 'lucide-react';

/* ── User Preferences ──────────────────────────────────── */

const USER_PREFS_KEY = 'helm_user_prefs';

interface UserPrefs {
  landingPage: string;
  dateFormat: string;
  timeFormat: string;
  compactSidebar: boolean;
}

function getUserPrefs(): UserPrefs {
  try { return { landingPage: '/', dateFormat: 'MM/DD/YYYY', timeFormat: '12h', compactSidebar: false, ...JSON.parse(localStorage.getItem(USER_PREFS_KEY) || '{}') }; }
  catch { return { landingPage: '/', dateFormat: 'MM/DD/YYYY', timeFormat: '12h', compactSidebar: false }; }
}

function UserPrefsPanel({ onClose, userEmail, userName }: { onClose: () => void; userEmail: string; userName: string }) {
  const [prefs, setPrefs] = useState<UserPrefs>(getUserPrefs);
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();

  const handleSave = () => {
    localStorage.setItem(USER_PREFS_KEY, JSON.stringify(prefs));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const ps: Record<string, React.CSSProperties> = {
    overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 1100 },
    panel: { position: 'fixed', top: 0, right: 0, width: '360px', height: '100vh', background: '#FFFFFF', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)', zIndex: 1101, display: 'flex', flexDirection: 'column' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #E2E8F0', background: '#0A2342', color: '#FFFFFF' },
    body: { flex: 1, overflowY: 'auto', padding: '20px 24px' },
    section: { marginBottom: '24px' },
    sectionTitle: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#94A3B8', marginBottom: '12px' },
    field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '14px' },
    label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
    select: { padding: '9px 12px', fontSize: '14px', border: '1px solid #E2E8F0', borderRadius: '8px', background: '#FFFFFF', color: '#0A2342', outline: 'none', width: '100%' },
    toggle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9' },
    toggleLabel: { fontSize: '14px', color: '#0A2342', fontWeight: 500 },
    saveBtn: { width: '100%', padding: '11px', background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 },
    footer: { padding: '16px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column' as const, gap: '8px' },
    userCard: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 0', borderBottom: '1px solid #E2E8F0', marginBottom: '16px' },
    avatar: { width: 42, height: 42, borderRadius: '50%', background: '#00D4FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700, color: '#0A2342', flexShrink: 0 },
  };

  return (
    <>
      <div style={ps.overlay} onClick={onClose} />
      <div style={ps.panel}>
        <div style={ps.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '16px' }}>
            <User size={18} /> My Preferences
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={ps.body}>
          {/* User info */}
          <div style={ps.userCard}>
            <div style={ps.avatar}>{userName.slice(0, 2).toUpperCase()}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#0A2342' }}>{userName}</div>
              <div style={{ fontSize: '12px', color: '#64748B' }}>{userEmail}</div>
            </div>
          </div>

          {/* Navigation prefs */}
          <div style={ps.section}>
            <div style={ps.sectionTitle}>Navigation</div>
            <div style={ps.field}>
              <label style={ps.label}>Default landing page</label>
              <select style={ps.select} value={prefs.landingPage} onChange={(e) => setPrefs((p) => ({ ...p, landingPage: e.target.value }))}>
                <option value="/">Dashboard</option>
                <option value="/slips">Slips</option>
                <option value="/billing">Billing</option>
                <option value="/pos">POS</option>
                <option value="/customers">Customers</option>
                <option value="/transient">Transient</option>
                <option value="/rentals">Rentals</option>
              </select>
            </div>
          </div>

          {/* Display prefs */}
          <div style={ps.section}>
            <div style={ps.sectionTitle}>Display</div>
            <div style={ps.field}>
              <label style={ps.label}>Date format</label>
              <select style={ps.select} value={prefs.dateFormat} onChange={(e) => setPrefs((p) => ({ ...p, dateFormat: e.target.value }))}>
                <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (International)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
              </select>
            </div>
            <div style={ps.field}>
              <label style={ps.label}>Time format</label>
              <select style={ps.select} value={prefs.timeFormat} onChange={(e) => setPrefs((p) => ({ ...p, timeFormat: e.target.value }))}>
                <option value="12h">12-hour (1:30 PM)</option>
                <option value="24h">24-hour (13:30)</option>
              </select>
            </div>
          </div>
        </div>

        <div style={ps.footer}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button style={ps.saveBtn} onClick={handleSave}>Save Preferences</button>
            {saved && <span style={{ fontSize: '13px', color: '#22C55E', fontWeight: 600, whiteSpace: 'nowrap' }}>✓ Saved</span>}
          </div>
          <button
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', background: 'none', border: '1px solid #FCA5A5', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#DC2626', fontWeight: 600 }}
            onClick={() => { void navigate('/sign-out'); onClose(); }}
          >
            <LogOut size={15} /> Sign Out
          </button>
        </div>
      </div>
    </>
  );
}


const NAV_SECTIONS = [
  {
    label: 'Home',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Marina',
    items: [
      { path: '/slips', label: 'Slips', icon: Anchor },
      { path: '/boats', label: 'Boats', icon: Ship },
      { path: '/customers', label: 'Customers', icon: Users },
      { path: '/contracts', label: 'Contracts', icon: FileText },
      { path: '/billing', label: 'Billing', icon: DollarSign },
    ],
  },
  {
    label: 'Daily Ops',
    items: [
      { path: '/dock-walks', label: 'Dock Walks', icon: ClipboardCheck },
      { path: '/transient', label: 'Transient', icon: Bed },
      { path: '/ramp', label: 'Launch Ramp', icon: Waves },
      { path: '/rentals', label: 'Rentals', icon: Ship },
      { path: '/concierge', label: 'Concierge', icon: ConciergeBell },
    ],
  },
  {
    label: 'Point of Sale',
    items: [
      { path: '/pos', label: 'POS', icon: ShoppingCart },
      { path: '/fuel', label: 'Fuel', icon: Fuel },
    ],
  },
  {
    label: 'Back Office',
    items: [
      { path: '/accounting', label: 'Accounting', icon: Landmark, requireRoles: ['TENANT_ADMIN', 'MARINA_OWNER', 'ACCOUNTING', 'PLATFORM_ADMIN'] },
      { path: '/purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
      { path: '/inventory', label: 'Inventory', icon: Package },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { path: '/leads', label: 'Leads', icon: UserPlus },
      { path: '/waitlist', label: 'Waitlist', icon: List },
    ],
  },
  {
    label: 'Communications',
    items: [
      { path: '/announcements', label: 'Announcements', icon: Megaphone },
      { path: '/email-automation', label: 'Email Automation', icon: Mail },
    ],
  },
  {
    label: 'Insights',
    items: [
      { path: '/insights', label: 'Overview', icon: BarChart3, exact: true },
      { path: '/insights/operations', label: 'Operations', icon: Activity },
      { path: '/insights/financial', label: 'Financial', icon: DollarSign },
      { path: '/insights/customers', label: 'Customers & CRM', icon: Users },
      { path: '/insights/communications', label: 'Communications', icon: Megaphone },
      { path: '/insights/compliance', label: 'Compliance & Audit', icon: ShieldCheck },
      { path: '/insights/scheduled', label: 'Scheduled & Saved', icon: Calendar },
      { path: '/insights/custom-builder', label: 'Custom Builder', icon: Wrench },
    ],
  },
];

const FOOTER_NAV_ITEM = { path: '/settings', label: 'Settings', icon: Settings };

const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
  } as React.CSSProperties,
  sidebar: {
    width: 260,
    backgroundColor: 'var(--brand-primary)',
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    overflowY: 'auto',
    zIndex: 200,
  } as React.CSSProperties,
  logo: {
    padding: '24px 24px 16px',
    fontSize: '22px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  } as React.CSSProperties,
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: 'rgba(255,255,255,0.5)',
    padding: '16px 24px 8px',
  } as React.CSSProperties,
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 24px',
    fontSize: '15px',
    color: 'rgba(255,255,255,0.7)',
    textDecoration: 'none',
    transition: 'all 0.15s ease',
    borderLeft: '3px solid transparent',
  } as React.CSSProperties,
  navItemActive: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderLeftColor: 'var(--brand-secondary)',
  } as React.CSSProperties,
  main: {
    marginLeft: 260,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  } as React.CSSProperties,
  topBar: {
    height: 64,
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F2F4F6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 32px',
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: 100,
  } as React.CSSProperties,
  breadcrumb: {
    fontSize: '13px',
    color: '#2E4A6B',
  } as React.CSSProperties,
  topRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  } as React.CSSProperties,
  helpBtn: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '1px solid #CCCCCC',
    backgroundColor: '#FFFFFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#2E4A6B',
  } as React.CSSProperties,
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    backgroundColor: 'var(--brand-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--brand-primary)',
  } as React.CSSProperties,
  content: {
    flex: 1,
    padding: '32px',
    backgroundColor: '#F7F9FB',
  } as React.CSSProperties,
};

function getPageTitle(pathname: string): string {
  // Prefix routes — keep context consistent across all sub-pages of a section.
  if (pathname.startsWith('/insights')) return 'Insights';
  if (pathname.startsWith('/accounting')) return 'Accounting';
  if (pathname.startsWith('/billing')) return 'Billing';
  if (pathname.startsWith('/settings')) return 'Settings';
  const map: Record<string, string> = {
    '/': 'Dashboard',
    '/leads': 'Leads',
    '/waitlist': 'Waitlist',
    '/customers': 'Customers',
    '/slips': 'Slips',
    '/contracts': 'Contracts',
    '/billing': 'Billing',
    '/billing/ar-aging': 'Billing',
    '/billing/disputes': 'Billing',
    '/billing/chart-of-accounts': 'Billing',
    '/billing/deferred-revenue': 'Billing',
    '/billing/rent-roll': 'Billing',
    '/rentals': 'Rentals',
    '/pos': 'POS',
    '/pos/z-reports': 'Z-Reports',
    '/dock-walks': 'Dock Walks',
    '/reports': 'Insights',
    '/insights': 'Insights',
    '/announcements': 'Announcements',
    '/accounting': 'Accounting',
    '/accounting/setup': 'Accounting',
    '/accounting/periods': 'Accounting',
    '/accounting/sync-health': 'Accounting',
    '/accounting/reconciliation': 'Accounting',
    '/accounting/change-log': 'Accounting',
    '/settings': 'Settings',
  };
  return map[pathname] || 'Helm';
}

export default function AppLayout() {
  const location = useLocation();
  const { user, isLoaded } = useUser();
  const { isSignedIn } = useAuth();
  const { modules, locations, currentLocationId, setCurrentLocationId } = useModules();
  const { user: currentUser } = useCurrentUser();
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`
    : '';
  const selectedLocation = locations.find((l) => l.id === currentLocationId) ?? locations[0];

  if (!isLoaded) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#F7F9FB' }}>
        <div style={{ width: 260, backgroundColor: 'var(--brand-primary)', flexShrink: 0, position: 'fixed', top: 0, left: 0, bottom: 0 }} />
        <div style={{ marginLeft: 260, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 64, backgroundColor: '#FFFFFF', borderBottom: '1px solid #F2F4F6' }} />
        </div>
      </div>
    );
  }

  const devBypass = import.meta.env.VITE_ENABLE_AUTH_DEV_BYPASS === 'true';

  if (!isSignedIn && !devBypass) {
    return <RedirectToSignIn />;
  }

  // Close sidebar on route change (mobile)
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <>
      <ImpersonationBanner />
    <div style={styles.container}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={closeSidebar}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.5)', zIndex: 199, display: 'none' } as React.CSSProperties}
          className="helm-sidebar-overlay"
        />
      )}
      <style>{`
        @media (max-width: 768px) {
          .helm-sidebar-overlay { display: block !important; }
          .helm-sidebar { transform: translateX(${sidebarOpen ? '0' : '-100%'}) !important; transition: transform 0.25s ease; }
          .helm-main { margin-left: 0 !important; width: 100% !important; }
          .helm-hamburger { display: flex !important; }
          .helm-topbar { padding-left: 16px !important; padding-right: 16px !important; }
          .helm-content { padding: 16px !important; }
          .helm-location-picker { display: none !important; }
        }
      `}</style>
      <nav style={styles.sidebar} className="helm-sidebar">
        <div style={styles.logo}>HELM</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter((item) => {
              if (item.path === '/rentals' && !modules.rentals) return false;
              if (item.path === '/transient' && !modules.transient) return false;
              if (item.path === '/ramp' && !modules.ramp) return false;
              if (item.path === '/concierge' && !modules.concierge) return false;
              // Role-gated items: check against current user's role
              const reqRoles = (item as { requireRoles?: string[] }).requireRoles;
              if (reqRoles && currentUser?.role && !reqRoles.includes(currentUser.role)) return false;
              return true;
            });
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label}>
                <div style={styles.sectionLabel}>{section.label}</div>
                {visibleItems.map((item) => {
                  // Highlight when the current pathname is the item itself or a
                  // descendant route (e.g. /billing/ar-aging keeps Billing lit).
                  // Items marked `exact` only light on an exact match — used for
                  // Insights Overview so it doesn't stay lit on subsections.
                  const exact = (item as { exact?: boolean }).exact === true;
                  const isActive = exact
                    ? location.pathname === item.path
                    : location.pathname === item.path ||
                      (item.path !== '/' && location.pathname.startsWith(item.path + '/'));
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={closeSidebar}
                      style={{
                        ...styles.navItem,
                        ...(isActive ? styles.navItemActive : {}),
                      }}
                    >
                      <item.icon size={20} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
          {(() => {
            const item = FOOTER_NAV_ITEM;
            const isActive =
              location.pathname === item.path ||
              location.pathname.startsWith(item.path + '/');
            return (
              <Link
                to={item.path}
                onClick={closeSidebar}
                style={{
                  ...styles.navItem,
                  paddingTop: '14px',
                  ...(isActive ? styles.navItemActive : {}),
                }}
              >
                <item.icon size={20} />
                {item.label}
              </Link>
            );
          })()}
        </div>
      </nav>

      <div style={styles.main} className="helm-main">
        <header style={styles.topBar} className="helm-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="helm-hamburger"
              style={{ display: 'none', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '6px', border: '1px solid #E2E8F0', background: '#FFFFFF', cursor: 'pointer', color: '#0A2342', flexShrink: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
            <div style={styles.breadcrumb}>
              {getPageTitle(location.pathname)}
            </div>
          </div>
          <div style={styles.topRight}>
            <div style={{ position: 'relative' }} className="helm-location-picker">
              <button
                onClick={() => setLocationDropdownOpen(!locationDropdownOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#0A2342',
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap' as const,
                }}
              >
                <MapPin size={14} style={{ color: 'var(--brand-secondary)' }} />
                {currentLocationId === null
                  ? 'All locations'
                  : (selectedLocation?.name ?? 'Select location')}
                <ChevronDown size={14} style={{ color: '#64748B' }} />
              </button>
              {locationDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '4px',
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 999,
                    minWidth: '260px',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ padding: '8px 12px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>
                    Switch Location
                  </div>
                  <button
                    key="__all__"
                    onClick={() => { setCurrentLocationId(null); setLocationDropdownOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: '14px',
                      color: '#0A2342',
                      background: currentLocationId === null ? '#F0FAFF' : '#FFFFFF',
                      border: 'none',
                      borderBottom: '1px solid #F2F4F6',
                      cursor: 'pointer',
                      textAlign: 'left' as const,
                      fontWeight: currentLocationId === null ? 600 : 400,
                    }}
                  >
                    <MapPin size={14} style={{ color: currentLocationId === null ? 'var(--brand-secondary)' : '#94A3B8' }} />
                    All locations
                    {currentLocationId === null && <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--brand-secondary)', fontWeight: 600 }}>Current</span>}
                  </button>
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      onClick={() => { setCurrentLocationId(loc.id); setLocationDropdownOpen(false); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%',
                        padding: '10px 12px',
                        fontSize: '14px',
                        color: '#0A2342',
                        background: loc.id === currentLocationId ? '#F0FAFF' : '#FFFFFF',
                        border: 'none',
                        borderBottom: '1px solid #F2F4F6',
                        cursor: 'pointer',
                        textAlign: 'left' as const,
                        fontWeight: loc.id === currentLocationId ? 600 : 400,
                      }}
                    >
                      <MapPin size={14} style={{ color: loc.id === currentLocationId ? 'var(--brand-secondary)' : '#94A3B8' }} />
                      {loc.name}
                      {loc.id === currentLocationId && <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--brand-secondary)', fontWeight: 600 }}>Current</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button style={styles.helpBtn} title="Help Center" onClick={() => setHelpOpen(true)}>
              <HelpCircle size={16} />
            </button>
            <button
              title="My Preferences"
              onClick={() => setPrefsOpen(true)}
              style={{ ...styles.avatar, border: 'none', cursor: 'pointer' }}
            >{initials || <User size={16} />}</button>
          </div>
        </header>
        <main style={styles.content} className="helm-content">
          <Outlet />
        </main>
      </div>
      <HelpCenter openFromOutside={helpOpen} onOutsideClosed={() => setHelpOpen(false)} />
      {prefsOpen && (
        <UserPrefsPanel
          onClose={() => setPrefsOpen(false)}
          userName={user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.username || 'User' : 'User'}
          userEmail={user?.primaryEmailAddress?.emailAddress ?? ''}
        />
      )}
    </div>
    </>
  );
}
