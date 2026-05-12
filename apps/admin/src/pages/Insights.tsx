import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

// A7 — Cross-Tenant Insights shell. Sub-pages are routed under
// /insights/* and each owns its own data-fetch. This file only renders
// the section heading + sub-nav and lets <Outlet /> handle the rest.

interface SubLink { to: string; label: string; description: string; }

const SUB_LINKS: SubLink[] = [
  { to: '/insights', label: 'Overview', description: 'Platform-wide MRR, GMV, churn and trial conversion.' },
  { to: '/insights/benchmarks', label: 'Tenant Benchmarks', description: 'Anonymized percentiles for the operational metrics that matter.' },
  { to: '/insights/support', label: 'Support SLA', description: 'First-response, resolution time and live backlog by priority.' },
  { to: '/insights/reliability', label: 'Reliability', description: 'Webhook delivery, retry backlog, and email-send failures.' },
  { to: '/insights/adoption', label: 'Adoption', description: 'Integration coverage, tier mix and feature-flag rollout.' },
  { to: '/insights/cohorts', label: 'Cohorts & Funnel', description: 'Retention cohorts, trial→paid funnel, per-tier feature usage.' },
];

const subNav: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  margin: '12px 0 24px',
};

const subLink = (active: boolean): React.CSSProperties => ({
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: active ? 700 : 500,
  color: active ? '#00D4FF' : 'rgba(255,255,255,0.55)',
  textDecoration: 'none',
  borderBottom: active ? '2px solid #00D4FF' : '2px solid transparent',
  marginBottom: -1,
  transition: 'color 0.1s ease, border-color 0.1s ease',
});

const Insights: React.FC = () => {
  const location = useLocation();
  const currentMeta = SUB_LINKS.find((l) =>
    l.to === '/insights'
      ? location.pathname === '/insights'
      : location.pathname.startsWith(l.to),
  ) ?? SUB_LINKS[0];

  return (
    <div>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#FFF', margin: 0 }}>Insights</h1>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
          {currentMeta.description}
        </div>
      </div>

      <nav style={subNav}>
        {SUB_LINKS.map((link) => {
          const active = link.to === '/insights'
            ? location.pathname === '/insights'
            : location.pathname.startsWith(link.to);
          return (
            <NavLink key={link.to} to={link.to} end={link.to === '/insights'} style={subLink(active)}>
              {link.label}
            </NavLink>
          );
        })}
      </nav>

      <Outlet />
    </div>
  );
};

export default Insights;
