import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LucideIcon } from 'lucide-react';

export type ReportStatus = 'live' | 'phase-5a' | 'phase-5b' | 'phase-5c' | 'future';

const STATUS_LABEL: Record<ReportStatus, string> = {
  live: 'Live',
  'phase-5a': 'Phase 5a',
  'phase-5b': 'Phase 5b',
  'phase-5c': 'Phase 5c',
  future: 'Future',
};

const STATUS_STYLE: Record<ReportStatus, React.CSSProperties> = {
  live: { background: '#DCFCE7', color: '#166534' },
  'phase-5a': { background: '#DBEAFE', color: '#1E40AF' },
  'phase-5b': { background: '#F1F5F9', color: '#475569' },
  'phase-5c': { background: '#FEF3C7', color: '#92400E' },
  future: { background: '#F8FAFC', color: '#94A3B8' },
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '10px',
    padding: '18px 20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    textDecoration: 'none',
    color: 'inherit',
    minHeight: 120,
  },
  cardLive: {
    borderColor: '#A7F3D0',
  },
  header: { display: 'flex', alignItems: 'center', gap: 10 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'rgba(0,212,255,0.10)',
    color: '#0A2342',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flex: 1 },
  title: { fontSize: 15, fontWeight: 700, color: '#0A2342', margin: 0 },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  body: { fontSize: 13, color: '#64748B', lineHeight: 1.5, margin: 0, flex: 1 },
  linkRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#0A2342', marginTop: 4 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 },
};

export interface ReportCardProps {
  title: string;
  description: string;
  status: ReportStatus;
  to?: string;
  icon?: LucideIcon;
}

export function ReportCard({ title, description, status, to, icon: Icon }: ReportCardProps) {
  const body = (
    <>
      <div style={styles.header}>
        {Icon && (
          <div style={styles.icon}>
            <Icon size={18} />
          </div>
        )}
        <div style={styles.titleRow}>
          <h3 style={styles.title}>{title}</h3>
          <span style={{ ...styles.badge, ...STATUS_STYLE[status] }}>{STATUS_LABEL[status]}</span>
        </div>
      </div>
      <p style={styles.body}>{description}</p>
      {to && (
        <div style={styles.linkRow}>
          Open report <ArrowRight size={14} />
        </div>
      )}
    </>
  );

  const cardStyle: React.CSSProperties = {
    ...styles.card,
    ...(status === 'live' ? styles.cardLive : {}),
    cursor: to ? 'pointer' : 'default',
  };

  if (to) {
    return <Link to={to} style={cardStyle}>{body}</Link>;
  }
  return <div style={cardStyle}>{body}</div>;
}

export function ReportGrid({ children }: { children: React.ReactNode }) {
  return <div style={styles.grid}>{children}</div>;
}
