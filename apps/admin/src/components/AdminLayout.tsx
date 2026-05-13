import React from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useUser, useClerk, useAuth } from '@clerk/clerk-react';
import { useAdminMe, adminRoleLabel } from '../hooks/useAdminMe';
import GlobalSearch from './GlobalSearch';
import { AnnouncementBanner, NotificationBell } from '@helm/ui-kit';

const DEV_BYPASS = import.meta.env.VITE_ENABLE_AUTH_DEV_BYPASS === 'true';

type NavItem = { path: string; label: string; icon: string };
type NavSection = { label: string; items: NavItem[] };

// Sidebar grouped by intent: tenants, the money they generate, the systems
// that keep them running. Configuration sits pinned to the footer.
const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Home',
    items: [{ path: '/', label: 'Dashboard', icon: '▣' }],
  },
  {
    label: 'Tenants',
    items: [
      { path: '/tenants', label: 'Tenants', icon: '⛵' },
      { path: '/trials', label: 'Trials', icon: '◐' },
    ],
  },
  {
    label: 'Revenue',
    items: [
      { path: '/billing', label: 'Billing', icon: '$' },
      { path: '/insights', label: 'Insights', icon: '◈' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/health', label: 'Health', icon: '♥' },
      { path: '/webhooks', label: 'Webhooks', icon: '⚡' },
      { path: '/queues', label: 'Queues', icon: '↻' },
      { path: '/announcements', label: 'Announcements', icon: '📣' },
      { path: '/support', label: 'Support', icon: '✉' },
      { path: '/impersonation-log', label: 'Impersonation Log', icon: '◉' },
      { path: '/activity', label: 'Admin Activity', icon: '◷' },
    ],
  },
];

const FOOTER_SECTION: NavSection = {
  label: 'Configuration',
  items: [
    { path: '/settings', label: 'Platform Settings', icon: '⚙' },
    { path: '/me', label: 'My Profile', icon: '◉' },
  ],
};

// Flat list used by the top-bar page-title lookup and the active-link helper.
const NAV_ITEMS: NavItem[] = [
  ...NAV_SECTIONS.flatMap((s) => s.items),
  ...FOOTER_SECTION.items,
];

const sidebar: React.CSSProperties = {
  width: 240,
  minHeight: '100vh',
  background: 'linear-gradient(180deg, #0A2342 0%, #0D1B2A 100%)',
  display: 'flex',
  flexDirection: 'column',
  position: 'fixed',
  top: 0,
  left: 0,
  bottom: 0,
  zIndex: 100,
};

const logoArea: React.CSSProperties = {
  padding: '24px 20px 16px',
  borderBottom: '1px solid rgba(0,212,255,0.2)',
};

const logoText: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: '#00D4FF',
  letterSpacing: 3,
  margin: 0,
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const logoSub: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(255,255,255,0.5)',
  letterSpacing: 2,
  textTransform: 'uppercase',
  marginTop: 4,
};

const navList: React.CSSProperties = {
  listStyle: 'none',
  padding: '8px 0',
  margin: 0,
  flex: 1,
  overflowY: 'auto',
};

const sectionLabel: React.CSSProperties = {
  padding: '14px 20px 4px',
  fontSize: 10,
  fontWeight: 700,
  color: 'rgba(255,255,255,0.35)',
  letterSpacing: 1.5,
  textTransform: 'uppercase',
};

const footerArea: React.CSSProperties = {
  borderTop: '1px solid rgba(255,255,255,0.08)',
  padding: '8px 0',
};

const topBar: React.CSSProperties = {
  height: 56,
  background: '#0D1B2A',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 32px',
  marginLeft: 240,
};

const mainContent: React.CSSProperties = {
  marginLeft: 240,
  padding: '24px 32px',
  background: '#070E18',
  minHeight: 'calc(100vh - 56px)',
};

const signOutBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  padding: '6px 14px',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const avatarStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: '#0A2342',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#FFF',
  fontSize: 13,
  fontWeight: 700,
};

const UserChip: React.FC<{ initials: string; name: string; email: string; role?: string | null }> = ({ initials, name, email, role }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <div style={avatarStyle}>{initials}</div>
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#FFF' }}>{name}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
        {email || '—'}{role ? ` · ${role}` : ''}
      </div>
    </div>
  </div>
);

// Real Clerk-backed user controls (rendered only when not in dev bypass).
const ClerkUserControls: React.FC = () => {
  const { user, isLoaded } = useUser();
  const clerk = useClerk();
  const { me } = useAdminMe();

  const handleSignOut = async () => {
    await clerk.signOut({ redirectUrl: '/' });
  };

  if (!isLoaded || !user) {
    return <UserChip initials="··" name="Loading…" email="" />;
  }

  const first = user.firstName ?? '';
  const last = user.lastName ?? '';
  const initials = (`${first[0] ?? ''}${last[0] ?? ''}`).trim() ||
    (user.primaryEmailAddress?.emailAddress?.[0] ?? '?').toUpperCase();
  const fullName = `${first} ${last}`.trim() || user.username || 'Platform Admin';
  const email = user.primaryEmailAddress?.emailAddress ?? '';
  const roleLabel = me?.adminRole ? adminRoleLabel(me.adminRole) : null;

  return (
    <>
      <UserChip initials={initials} name={fullName} email={email} role={roleLabel} />
      <button
        onClick={handleSignOut}
        style={signOutBtn}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(0,212,255,0.4)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
      >
        Sign out
      </button>
    </>
  );
};

// Dev-bypass user chip — no Clerk hooks, no sign-out.
const DevBypassUserControls: React.FC = () => {
  const { me } = useAdminMe();
  const roleLabel = me?.adminRole ? adminRoleLabel(me.adminRole) : null;
  return <UserChip initials="DV" name="Dev Bypass" email="auth bypass enabled" role={roleLabel} />;
};

const AdminLayout: React.FC = () => {
  const location = useLocation();
  const { getToken } = useAuth();

  const getNavStyle = (path: string): React.CSSProperties => {
    const isActive = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 20px',
      color: isActive ? '#00D4FF' : 'rgba(255,255,255,0.6)',
      textDecoration: 'none',
      fontSize: 13,
      fontWeight: isActive ? 600 : 400,
      background: isActive ? 'rgba(0,212,255,0.08)' : 'transparent',
      borderLeft: isActive ? '3px solid #00D4FF' : '3px solid transparent',
      transition: 'all 0.15s ease',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    };
  };

  const pageTitle = NAV_ITEMS.find((item) =>
    item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
  )?.label || 'Admin';

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', background: '#070E18', minHeight: '100vh', color: '#E0E0E0' }}>
      <div style={{ marginLeft: 240 }}>
        <AnnouncementBanner getToken={getToken} />
      </div>
      <aside style={sidebar}>
        <div style={logoArea}>
          <div style={logoText}>HELM</div>
          <div style={logoSub}>Admin Console</div>
        </div>
        <nav style={navList}>
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div style={sectionLabel}>{section.label}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {section.items.map((item) => (
                  <li key={item.path}>
                    <NavLink to={item.path} style={getNavStyle(item.path)}>
                      <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div style={footerArea}>
          <div style={sectionLabel}>{FOOTER_SECTION.label}</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {FOOTER_SECTION.items.map((item) => (
              <li key={item.path}>
                <NavLink to={item.path} style={getNavStyle(item.path)}>
                  <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div style={{ padding: '12px 20px', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
            Helm Platform v0.1.0
          </div>
        </div>
      </aside>

      <header style={topBar}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#FFFFFF' }}>{pageTitle}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <GlobalSearch />
          <NotificationBell endpointBase="/api/notifications" getToken={getToken} theme="dark" />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>ENV: Production</span>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />
          {DEV_BYPASS ? <DevBypassUserControls /> : <ClerkUserControls />}
        </div>
      </header>

      <main style={mainContent}>
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;
