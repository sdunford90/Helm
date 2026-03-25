import React from 'react';
import { tokens } from '../styles/tokens';

export interface NavItem {
  label: string;
  path: string;
  icon?: React.ReactNode;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export interface SidebarProps {
  sections: NavSection[];
  activePath: string;
  onNavigate: (path: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sections,
  activePath,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}) => {
  const sidebarStyle: React.CSSProperties = {
    backgroundColor: tokens.colors.navy,
    width: collapsed ? '64px' : '240px',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 0.2s ease',
    overflow: 'hidden',
    flexShrink: 0,
  };

  const logoStyle: React.CSSProperties = {
    padding: `${tokens.spacing.comfortable} ${tokens.spacing.default}`,
    fontFamily: tokens.typography.fontFamily.primary,
    fontWeight: tokens.typography.fontWeight.bold,
    fontSize: collapsed ? '18px' : '22px',
    color: tokens.colors.white,
    letterSpacing: '0.08em',
    borderBottom: `1px solid ${tokens.colors.slate}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'space-between',
    minHeight: '64px',
  };

  const toggleBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: tokens.colors.white,
    cursor: 'pointer',
    fontSize: '16px',
    padding: tokens.spacing.micro,
    opacity: 0.7,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: tokens.typography.fontSize.caption,
    fontWeight: tokens.typography.fontWeight.semibold,
    fontFamily: tokens.typography.fontFamily.primary,
    color: tokens.colors.skyBlue,
    textTransform: 'uppercase',
    letterSpacing: tokens.typography.letterSpacing.caps,
    padding: `${tokens.spacing.default} ${tokens.spacing.default} ${tokens.spacing.micro}`,
    opacity: collapsed ? 0 : 1,
    whiteSpace: 'nowrap',
  };

  const getItemStyle = (isActive: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: collapsed ? '0' : tokens.spacing.tight,
    padding: `${tokens.spacing.tight} ${tokens.spacing.default}`,
    color: tokens.colors.white,
    fontSize: tokens.typography.fontSize.body,
    fontFamily: tokens.typography.fontFamily.primary,
    fontWeight: isActive ? tokens.typography.fontWeight.semibold : tokens.typography.fontWeight.regular,
    cursor: 'pointer',
    borderLeft: isActive ? `3px solid ${tokens.colors.cyan}` : '3px solid transparent',
    backgroundColor: isActive ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
    transition: 'background-color 0.15s ease',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    justifyContent: collapsed ? 'center' : 'flex-start',
    textDecoration: 'none',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    borderRight: 'none',
    borderTop: 'none',
    borderBottom: 'none',
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: isActive ? tokens.colors.cyan : 'transparent',
    background: isActive ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
  });

  const iconStyle: React.CSSProperties = {
    flexShrink: 0,
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <nav style={sidebarStyle}>
      <div style={logoStyle}>
        <span>{collapsed ? 'H' : 'HELM'}</span>
        {onToggleCollapse && !collapsed && (
          <button style={toggleBtnStyle} onClick={onToggleCollapse} aria-label="Collapse sidebar">
            &#x2039;
          </button>
        )}
        {onToggleCollapse && collapsed && (
          <button
            style={{ ...toggleBtnStyle, position: 'absolute' as const, display: 'none' }}
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
          >
            &#x203A;
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: tokens.spacing.tight }}>
        {sections.map((section, sIdx) => (
          <div key={sIdx}>
            {section.title && !collapsed && (
              <div style={sectionTitleStyle}>{section.title}</div>
            )}
            {section.items.map((item) => {
              const isActive = activePath === item.path;
              return (
                <button
                  key={item.path}
                  style={getItemStyle(isActive)}
                  onClick={() => onNavigate(item.path)}
                  title={collapsed ? item.label : undefined}
                >
                  {item.icon && <span style={iconStyle}>{item.icon}</span>}
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
};

Sidebar.displayName = 'Sidebar';
