import React from 'react';
import { AlertTriangle, Inbox, Loader2, Wrench } from 'lucide-react';

/*
 * Shared loading / empty / error / not-available states. Pages render these
 * instead of falling back to sample data: the app must show the truth.
 */

const box: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: 8,
  padding: '40px 24px',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  color: '#2E4A6B',
};

const titleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: '#0A2342' };
const msgStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.5, maxWidth: 520, color: '#475569' };
const btn: React.CSSProperties = {
  marginTop: 8,
  padding: '8px 18px',
  background: '#0A2342',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 6,
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

export function LoadingState({ label = 'Loading…', compact }: { label?: string; compact?: boolean }) {
  return (
    <div role="status" aria-live="polite" style={{ ...box, ...(compact ? { padding: 16, border: 'none', background: 'transparent' } : {}) }}>
      <Loader2 size={20} style={{ animation: 'helm-spin 1s linear infinite' }} />
      <div style={msgStyle}>{label}</div>
      <style>{'@keyframes helm-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this data',
  message,
  onRetry,
  compact,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div role="alert" style={{ ...box, borderColor: '#F5C2C0', background: '#FFF8F7', ...(compact ? { padding: 16 } : {}) }}>
      <AlertTriangle size={22} color="#B71C1C" />
      <div style={titleStyle}>{title}</div>
      {message && <div style={msgStyle}>{message}</div>}
      {onRetry && (
        <button type="button" style={btn} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
  compact,
}: {
  title: string;
  message?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div style={{ ...box, ...(compact ? { padding: 16 } : {}) }}>
      <Inbox size={22} color="#64748B" />
      <div style={titleStyle}>{title}</div>
      {message && <div style={msgStyle}>{message}</div>}
      {action}
    </div>
  );
}

/** For features whose backend does not exist yet. Says so plainly. */
export function NotAvailable({
  title = 'Not available yet',
  message,
  compact,
}: {
  title?: string;
  message: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div style={{ ...box, borderStyle: 'dashed', background: '#F8FAFC', ...(compact ? { padding: 16 } : {}) }}>
      <Wrench size={22} color="#64748B" />
      <div style={titleStyle}>{title}</div>
      <div style={msgStyle}>{message}</div>
    </div>
  );
}

/**
 * Standard handling for a read: loading, then error (with Retry), then empty,
 * then the content. Pass `isEmpty` for lists.
 */
export function DataState({
  loading,
  error,
  onRetry,
  isEmpty,
  empty,
  children,
  loadingLabel,
  errorTitle,
}: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  children: React.ReactNode;
  loadingLabel?: string;
  errorTitle?: string;
}) {
  if (loading) return <LoadingState label={loadingLabel} />;
  if (error) return <ErrorState title={errorTitle} message={error} onRetry={onRetry} />;
  if (isEmpty) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children}</>;
}

/**
 * A button for an action whose backend does not exist yet. It is disabled
 * and explains why, instead of pretending to work.
 */
export function ComingSoonButton({
  children,
  reason = 'Coming soon: this action is not connected to the server yet.',
  style,
}: {
  children: React.ReactNode;
  reason?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span title={reason} style={{ display: 'inline-flex' }}>
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-label={typeof children === 'string' ? `${children} (coming soon)` : undefined}
        style={{ ...style, opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' }}
      >
        {children}
      </button>
    </span>
  );
}

/** Inline banner for a failed mutation. */
export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        background: '#FDECEA',
        color: '#B71C1C',
        border: '1px solid #F5C2C0',
        borderRadius: 6,
        padding: '10px 12px',
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      {message}
    </div>
  );
}

/** Simple server-side pager for list endpoints that use skip/take. */
export function Pager({
  skip,
  take,
  total,
  onChange,
}: {
  skip: number;
  take: number;
  total: number;
  onChange: (skip: number) => void;
}) {
  if (total <= take && skip === 0) {
    return <div style={{ fontSize: 13, color: '#64748B', padding: '12px 4px' }}>{total} total</div>;
  }
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + take, total);
  const pagerBtn: React.CSSProperties = {
    padding: '6px 12px', border: '1px solid #CBD5E1', background: '#FFFFFF', borderRadius: 6,
    fontSize: 13, color: '#0A2342', cursor: 'pointer',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', fontSize: 13, color: '#475569' }}>
      <span>
        {from}–{to} of {total}
      </span>
      <button type="button" style={{ ...pagerBtn, opacity: skip === 0 ? 0.5 : 1 }} disabled={skip === 0} onClick={() => onChange(Math.max(0, skip - take))}>
        Previous
      </button>
      <button type="button" style={{ ...pagerBtn, opacity: to >= total ? 0.5 : 1 }} disabled={to >= total} onClick={() => onChange(skip + take)}>
        Next
      </button>
    </div>
  );
}
