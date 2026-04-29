import React, { useEffect, useState, useCallback, useRef } from 'react';

interface ImpersonationContext {
  token: string;
  tokenId: string;
  tenantId: string;
  tenantName: string;
  tenantSubdomain: string;
  asUserEmail: string;
  adminEmail: string;
  expiresAt: string;
}

const STORAGE_KEY = 'helm_impersonation_v2';

function loadFromSession(): ImpersonationContext | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationContext;
    if (!parsed?.token || !parsed?.tenantId || !parsed?.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveToSession(ctx: ImpersonationContext) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx)); } catch { /* noop */ }
}

function clearSession() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

function readTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get('imp_token');
}

function stripHash() {
  if (typeof window === 'undefined') return;
  const url = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', url);
}

function fmtRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

const ImpersonationBanner: React.FC = () => {
  const [ctx, setCtx] = useState<ImpersonationContext | null>(null);
  const [, forceTick] = useState(0);
  const verifyingRef = useRef(false);

  // On mount: check URL fragment for a fresh handoff token, otherwise reuse session.
  useEffect(() => {
    const fragmentToken = readTokenFromHash();
    if (fragmentToken && !verifyingRef.current) {
      verifyingRef.current = true;
      stripHash();
      (async () => {
        try {
          const res = await fetch('/api/impersonation/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: fragmentToken }),
          });
          if (!res.ok) {
            verifyingRef.current = false;
            return;
          }
          const data = await res.json();
          const next: ImpersonationContext = {
            token: fragmentToken,
            tokenId: data.tokenId,
            tenantId: data.tenantId,
            tenantName: data.tenantName,
            tenantSubdomain: data.tenantSubdomain,
            asUserEmail: data.asUser?.email ?? '',
            adminEmail: data.adminEmail ?? 'platform admin',
            expiresAt: data.expiresAt,
          };
          saveToSession(next);
          setCtx(next);
        } catch {
          /* ignore */
        } finally {
          verifyingRef.current = false;
        }
      })();
    } else {
      setCtx(loadFromSession());
    }
  }, []);

  // Tick every 30s to refresh remaining time and auto-clear when expired.
  useEffect(() => {
    if (!ctx) return;
    const id = window.setInterval(() => {
      if (new Date(ctx.expiresAt).getTime() <= Date.now()) {
        clearSession();
        setCtx(null);
      } else {
        forceTick((n) => n + 1);
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [ctx]);

  const handleExit = useCallback(async () => {
    if (!ctx) return;
    try {
      await fetch('/api/impersonation/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ctx.token }),
      });
    } catch { /* still clear locally */ }
    clearSession();
    setCtx(null);
    try { window.close(); } catch { /* ignored */ }
    setTimeout(() => { window.location.href = '/'; }, 100);
  }, [ctx]);

  if (!ctx) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: 'repeating-linear-gradient(135deg, #B91C1C 0 14px, #991B1B 14px 28px)',
        color: '#FFFFFF',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%',
            background: '#FFFFFF', color: '#B91C1C', fontWeight: 800, fontSize: 13,
          }}
        >!</span>
        <span>
          Platform admin <strong>{ctx.adminEmail}</strong> is currently impersonating{' '}
          <strong>{ctx.tenantName}</strong>{ctx.asUserEmail ? <> as <strong>{ctx.asUserEmail}</strong></> : null}.
          All actions are recorded in the audit trail.
        </span>
        <span style={{ opacity: 0.8, fontWeight: 500 }}>
          ({fmtRemaining(ctx.expiresAt)})
        </span>
      </div>
      <button
        onClick={handleExit}
        style={{
          flexShrink: 0,
          background: '#FFFFFF',
          color: '#B91C1C',
          border: 'none',
          borderRadius: 6,
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          letterSpacing: 0.3,
        }}
      >
        Exit Impersonation
      </button>
    </div>
  );
};

export default ImpersonationBanner;
