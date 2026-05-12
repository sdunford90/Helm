import React from 'react';
import { SubNav, INSIGHTS_SUBNAV } from '@helm/ui-kit';

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px', maxWidth: '1400px', margin: '0 auto' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '24px', borderRadius: '2px' },
  subtitle: { fontSize: '14px', color: '#64748B', margin: '0 0 24px', lineHeight: 1.55, maxWidth: '780px' },
};

export interface InsightsShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function InsightsShell({ title, subtitle, children }: InsightsShellProps) {
  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">{title}</h1>
      <hr style={styles.divider} />
      <SubNav items={INSIGHTS_SUBNAV} />
      {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
      {children}
    </div>
  );
}
