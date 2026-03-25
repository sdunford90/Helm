import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  CreditCard,
  Ship,
  Shield,
  Bell,
  Clock,
  Megaphone,
  LogOut,
  Anchor,
  User,
  Menu,
  X,
} from 'lucide-react';
import { useState, type CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';
const DARK_NAVY = '#061A33';
const LIGHT_BG = '#F5F7FA';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/payments', label: 'Payment Methods', icon: CreditCard },
  { to: '/boats', label: 'My Boats', icon: Ship },
  { to: '/insurance', label: 'Insurance', icon: Shield },
  { to: '/concierge', label: 'Concierge', icon: Bell },
  { to: '/waitlist', label: 'Waitlist', icon: Clock },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
];

export default function PortalLayout() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 60,
    background: NAVY,
    color: '#fff',
    padding: '0 24px',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  };

  const sidebarStyle: CSSProperties = {
    width: 240,
    background: DARK_NAVY,
    position: 'fixed',
    top: 60,
    left: 0,
    bottom: 0,
    overflowY: 'auto',
    padding: '16px 0',
    transition: 'transform 0.2s ease',
    zIndex: 90,
  };

  const contentStyle: CSSProperties = {
    marginLeft: sidebarOpen ? 240 : 0,
    marginTop: 60,
    padding: 32,
    minHeight: 'calc(100vh - 60px)',
    background: LIGHT_BG,
    transition: 'margin-left 0.2s ease',
  };

  const navLinkBase: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 24px',
    color: '#A0AEC0',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
    borderLeft: '3px solid transparent',
    transition: 'all 0.15s ease',
  };

  const navLinkActive: CSSProperties = {
    ...navLinkBase,
    color: '#fff',
    background: 'rgba(0, 212, 255, 0.08)',
    borderLeftColor: CYAN,
  };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Header */}
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Anchor size={24} color={CYAN} />
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Helm</span>
            <span style={{ fontSize: 14, color: '#A0AEC0', marginLeft: 4 }}>| Bayview Marina</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: CYAN,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: NAVY,
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              JD
            </div>
            <span style={{ fontSize: 14, fontWeight: 500 }}>James Donnelly</span>
          </div>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#A0AEC0',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Sidebar */}
      {sidebarOpen && (
        <nav style={sidebarStyle}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => (isActive ? navLinkActive : navLinkBase)}
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}

      {/* Content */}
      <main style={contentStyle}>
        <Outlet />
      </main>
    </div>
  );
}
