import { Outlet, useLocation, Link } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import HelpCenter from './HelpCenter';
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
  Concierge as ConciergeBell,
  ScrollText,
  Fuel,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard },
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
  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`
    : 'H';

  return (
    <div style={styles.container}>
      <nav style={styles.sidebar}>
        <div style={styles.logo}>HELM</div>
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <div style={styles.sectionLabel}>{section.label}</div>
            {section.items.map((item) => {
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
        ))}
      </nav>

      <div style={styles.main}>
        <header style={styles.topBar}>
          <div style={styles.breadcrumb}>
            {getPageTitle(location.pathname)}
          </div>
          <div style={styles.topRight}>
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
