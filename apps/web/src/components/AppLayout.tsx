import { useState } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import HelpCenter from './HelpCenter';
import { useModules } from '../context/ModulesContext';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  ClipboardList,
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
  ScrollText,
  Fuel,
  MapPin,
  ChevronDown,
  Package,
  FileSpreadsheet,
} from 'lucide-react';

const LOCATIONS = [
  { id: 'main', name: 'Bayshore Marina - Main Dock' },
  { id: 'fuel', name: 'Bayshore Marina - Fuel Dock' },
  { id: 'rental', name: 'Bayshore Marina - Rental Center' },
];

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Marina Operations',
    items: [
      { path: '/slips', label: 'Slips', icon: Anchor },
      { path: '/contracts', label: 'Contracts', icon: FileText },
      { path: '/dock-walks', label: 'Dock Walks', icon: ClipboardCheck },
      { path: '/transient', label: 'Transient', icon: Bed },
      { path: '/ramp', label: 'Launch Ramp', icon: Waves },
      { path: '/concierge', label: 'Concierge', icon: ConciergeBell },
    ],
  },
  {
    label: 'Revenue',
    items: [
      { path: '/billing', label: 'Billing', icon: DollarSign },
      { path: '/rentals', label: 'Rentals', icon: Ship },
      { path: '/pos', label: 'POS', icon: ShoppingCart },
      { path: '/fuel', label: 'Fuel', icon: Fuel },
      { path: '/inventory', label: 'Inventory', icon: Package },
    ],
  },
  {
    label: 'CRM',
    items: [
      { path: '/leads', label: 'Leads', icon: UserPlus },
      { path: '/waitlist', label: 'Waitlist', icon: List },
      { path: '/customers', label: 'Customers', icon: Users },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/reports', label: 'Reports', icon: BarChart3 },
      { path: '/announcements', label: 'Announcements', icon: Megaphone },
      { path: '/audit-log', label: 'Audit Log', icon: ScrollText },
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
  } as React.CSSProperties,
  sidebar: {
    width: 260,
    backgroundColor: '#0A2342',
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
    borderLeftColor: '#00D4FF',
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
    backgroundColor: '#00D4FF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 600,
    color: '#0A2342',
  } as React.CSSProperties,
  content: {
    flex: 1,
    padding: '32px',
    backgroundColor: '#F7F9FB',
  } as React.CSSProperties,
};

function getPageTitle(pathname: string): string {
  const map: Record<string, string> = {
    '/': 'Dashboard',
    '/leads': 'Leads',
    '/waitlist': 'Waitlist',
    '/customers': 'Customers',
    '/slips': 'Slips',
    '/contracts': 'Contracts',
    '/billing': 'Billing',
    '/rentals': 'Rentals',
    '/pos': 'POS',
    '/dock-walks': 'Dock Walks',
    '/reports': 'Reports',
    '/announcements': 'Announcements',
    '/settings': 'Settings',
  };
  return map[pathname] || 'Helm';
}

export default function AppLayout() {
  const location = useLocation();
  const { user } = useUser();
  const { modules } = useModules();
  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`
    : 'H';
  const [currentLocation, setCurrentLocation] = useState(LOCATIONS[0].id);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const selectedLocation = LOCATIONS.find((l) => l.id === currentLocation) || LOCATIONS[0];

  return (
    <div style={styles.container}>
      <nav style={styles.sidebar}>
        <div style={styles.logo}>HELM</div>
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) => {
            if (item.path === '/rentals' && !modules.rentals) return false;
            return true;
          });
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label}>
              <div style={styles.sectionLabel}>{section.label}</div>
              {visibleItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
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
      </nav>

      <div style={styles.main}>
        <header style={styles.topBar}>
          <div style={styles.breadcrumb}>
            {getPageTitle(location.pathname)}
          </div>
          <div style={styles.topRight}>
            <div style={{ position: 'relative' }}>
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
                <MapPin size={14} style={{ color: '#00D4FF' }} />
                {selectedLocation.name}
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
                  {LOCATIONS.map((loc) => (
                    <button
                      key={loc.id}
                      onClick={() => { setCurrentLocation(loc.id); setLocationDropdownOpen(false); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%',
                        padding: '10px 12px',
                        fontSize: '14px',
                        color: '#0A2342',
                        background: loc.id === currentLocation ? '#F0FAFF' : '#FFFFFF',
                        border: 'none',
                        borderBottom: '1px solid #F2F4F6',
                        cursor: 'pointer',
                        textAlign: 'left' as const,
                        fontWeight: loc.id === currentLocation ? 600 : 400,
                      }}
                    >
                      <MapPin size={14} style={{ color: loc.id === currentLocation ? '#00D4FF' : '#94A3B8' }} />
                      {loc.name}
                      {loc.id === currentLocation && <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#00D4FF', fontWeight: 600 }}>Current</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button style={styles.helpBtn} title="Help">
              <HelpCircle size={16} />
            </button>
            <div style={styles.avatar}>{initials}</div>
          </div>
        </header>
        <main style={styles.content}>
          <Outlet />
        </main>
      </div>
      <HelpCenter />
    </div>
  );
}
