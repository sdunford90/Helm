import React, { CSSProperties } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { SETTINGS_SECTIONS, type SettingsSection } from '@helm/ui-kit';

// Two-level Settings navigation. Top strip = section (Marina / Team /
// Pricing & Payments / Catalog / Integrations). Sub-strip = leaves of the
// active section. Both update the URL. The layout is mounted on every
// /settings/* route via a react-router layout-route in App.tsx, so each
// leaf component only needs to render its own content.

const NAVY = '#0A2342';

const styles: Record<string, CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: NAVY, letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '20px', borderRadius: '2px' },

  sectionStrip: {
    display: 'flex', gap: 0, marginBottom: 0,
    borderBottom: '2px solid #E2E8F0',
  },
  sectionLink: {
    padding: '10px 18px',
    fontSize: 15,
    fontWeight: 600,
    color: '#64748B',
    textDecoration: 'none',
    borderBottom: '3px solid transparent',
    marginBottom: -2,
    transition: 'color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap',
  },
  sectionLinkActive: {
    color: NAVY,
    borderBottomColor: '#00D4FF',
  },

  leafStrip: {
    display: 'flex',
    gap: 0,
    flexWrap: 'wrap',
    padding: '4px 0',
    borderBottom: '1px solid #E2E8F0',
    marginBottom: '24px',
    background: '#F8FAFC',
    paddingLeft: 4,
  },
  leafLink: {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#64748B',
    textDecoration: 'none',
    borderRadius: 4,
    marginRight: 4,
    transition: 'color 0.15s, background 0.15s',
    whiteSpace: 'nowrap',
  },
  leafLinkActive: {
    color: '#FFFFFF',
    background: NAVY,
    fontWeight: 600,
  },
};

function activeSection(pathname: string): SettingsSection {
  for (const s of SETTINGS_SECTIONS) {
    if (pathname === `/settings/${s.key}` || pathname.startsWith(`/settings/${s.key}/`)) {
      return s;
    }
  }
  return SETTINGS_SECTIONS[0];
}

export default function SettingsLayout() {
  const { pathname } = useLocation();
  const section = activeSection(pathname);

  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">Settings</h1>
      <hr style={styles.divider} />

      <div style={styles.sectionStrip}>
        {SETTINGS_SECTIONS.map((s) => {
          const isActive = s.key === section.key;
          return (
            <Link
              key={s.key}
              to={s.path}
              style={{ ...styles.sectionLink, ...(isActive ? styles.sectionLinkActive : {}) }}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <div style={styles.leafStrip}>
        {section.leaves.map((leaf) => {
          const isActive = pathname === leaf.path || pathname.startsWith(leaf.path + '/');
          return (
            <Link
              key={leaf.path}
              to={leaf.path}
              style={{ ...styles.leafLink, ...(isActive ? styles.leafLinkActive : {}) }}
            >
              {leaf.label}
            </Link>
          );
        })}
      </div>

      <Outlet />
    </div>
  );
}
