import React from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useUser, useClerk } from '@clerk/clerk-react';

const DEV_BYPASS = import.meta.env.VITE_ENABLE_AUTH_DEV_BYPASS === 'true';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '▣' },
  { path: '/tenants', label: 'Tenants', icon: '⛵' },
  { path: '/billing', label: 'Billing', icon: '$' },
  { path: '/analytics', label: 'Analytics', icon: '◈' },
  { path: '/health', label: 'Health', icon: '♥' },
  { path: '/support', label: 'Support', icon: '✉' },
  { path: '/settings', label: 'Platform Settings', icon: '⚙' },
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
  padding: '16px 0',
  margin: 0,
  flex: 1,
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

const UserChip: React.FC<{ initials: string; name: string; email: string }> = ({ initials, name, email }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <div style={avatarStyle}>{initials}</div>
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#FFF' }}>{name}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{email || '—'}</div>
    </div>
  </div>
);

// Real Clerk-backed user controls (rendered only when not in dev bypass).
const ClerkUserControls: React.FC = () => {
  const { user, isLoaded } = useUser();
  const clerk = useClerk();

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

  return (
    <>
      <UserChip initials={initials} name={fullName} email={email} />
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
const DevBypassUserControls: React.FC = () => (
  <UserChip initials="DV" name="Dev Bypass" email="auth bypass enabled" />
);

const AdminLayout: React.FC = () => {
  const location = useLocation();

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
      <aside style={sidebar}>
        <div style={logoArea}>
          <div style={logoText}>HELM</div>
          <div style={logoSub}>Admin Console</div>
        </div>
        <nav>
          <ul style={navList}>
            {NAV_ITEMS.map((item) => (
              <li key={item.path}>
                <NavLink to={item.path} style={getNavStyle(item.path)}>
                  <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          Helm Platform v0.1.0
        </div>
      </aside>

      <header style={topBar}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#FFFFFF' }}>{pageTitle}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
