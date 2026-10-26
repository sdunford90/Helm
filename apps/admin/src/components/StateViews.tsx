import React from 'react';

/** Loading / error / empty / not-available views in the admin dark theme. */

const box: React.CSSProperties = {
  background: '#0D1B2A',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '28px 32px',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 14,
  lineHeight: 1.6,
};

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" style={{ ...box, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
      {label}
    </div>
  );
}

export function ErrorState({ title = 'Could not load data', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ ...box, borderColor: 'rgba(244,67,54,0.4)' }}>
      <div style={{ color: '#F44336', fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ marginBottom: onRetry ? 14 : 0 }}>{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{ background: 'transparent', color: '#00D4FF', border: '1px solid #00D4FF', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 600 }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div style={{ ...box, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>{message}</div>;
}

export function NotAvailable({ title, message }: { title: string; message: string }) {
  return (
    <div role="status" style={{ ...box, borderStyle: 'dashed' }}>
      <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{title}</div>
      <div>{message}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#fff', margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function StatCard({ label, value, hint, color = '#FFF' }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div style={{ background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 20 }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginBottom: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{hint}</div>}
    </div>
  );
}
