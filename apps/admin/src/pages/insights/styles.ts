import type { CSSProperties } from 'react';

// Shared styles for the Insights sub-pages (A7).
export const card: CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

export const cardLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 12,
};

export const sectionTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#FFF',
  margin: 0,
};

export const subtle: CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,255,255,0.45)',
};

export const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.45)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  whiteSpace: 'nowrap',
};

export const td: CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  color: 'rgba(255,255,255,0.7)',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

export function fmtMoney(cents: number): string {
  if (cents >= 100_000_000) return `$${(cents / 100_000_000).toFixed(2)}M`;
  if (cents >= 100_000) return `$${(cents / 100_000).toFixed(1)}k`;
  return `$${(cents / 100).toFixed(2)}`;
}

export function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

interface KpiTileProps { label: string; value: string; accent?: string; sub?: string; }
export function kpiTileStyle(): CSSProperties {
  return {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 6,
    padding: 14,
  };
}
export type { KpiTileProps };
