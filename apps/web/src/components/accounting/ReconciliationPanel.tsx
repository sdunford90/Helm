import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, BarChart2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

interface ReconciliationAlert {
  id: string;
  categoryId: string;
  categoryName: string;
  helmValueCents: number;
  qbBalanceCents: number | null;
  varianceCents: number;
  variancePct: number | null;
  lastCheckedAt: string;
  status: 'OK' | 'WARNING' | 'ERROR';
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '0', overflow: 'hidden' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: '#F8FAFC' },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'middle' as const },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 } as React.CSSProperties,
};

function fmtCents(c: number) {
  const abs = Math.abs(c);
  const sign = c < 0 ? '-' : '';
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status: string, variance: number): React.ReactNode {
  if (status === 'OK' || variance === 0) {
    return <span style={{ ...stl.badge, background: '#DCFCE7', color: '#15803D' }}>Balanced</span>;
  }
  if (status === 'WARNING') {
    return <span style={{ ...stl.badge, background: '#FEF3C7', color: '#92400E' }}>Warning</span>;
  }
  return <span style={{ ...stl.badge, background: '#FEE2E2', color: '#B91C1C' }}>Out of balance</span>;
}

export default function ReconciliationPanel() {
  const { currentLocationId } = useModules();
  const [alerts, setAlerts] = useState<ReconciliationAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const r = await api.get<{ data: ReconciliationAlert[] }>(
        `/api/accounting/reconciliation-alerts?locationId=${encodeURIComponent(currentLocationId)}`,
      );
      setAlerts(r.data ?? []);
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 501) {
        setUnavailable(true);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load reconciliation alerts');
      }
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  if (!currentLocationId) {
    return <div style={{ padding: '24px', color: '#64748B', fontSize: '14px' }}>Select a location to view reconciliation status.</div>;
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><BarChart2 size={16} /> Loading reconciliation data…</div>;
  }

  if (unavailable) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
        <BarChart2 size={32} style={{ margin: '0 auto 12px', display: 'block', color: '#CBD5E1' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>Reconciliation coming soon</div>
        <div style={{ fontSize: '13px', marginTop: '4px' }}>
          Inventory reconciliation alerts are not yet available. Check back after the next deployment.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
        <AlertTriangle size={16} /> {error}
        <button
          style={{ marginLeft: '8px', padding: '5px 10px', fontSize: '12px', fontWeight: 600, border: '1px solid #E2E8F0', borderRadius: '5px', cursor: 'pointer', backgroundColor: '#F8FAFC', color: '#0A2342' }}
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  const outOfBalance = alerts.filter((a) => a.status !== 'OK' && a.varianceCents !== 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' as const }}>
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '14px 20px', minWidth: '140px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Categories</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#0A2342', marginTop: '4px' }}>{alerts.length}</div>
        </div>
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '14px 20px', minWidth: '140px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Out of Balance</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: outOfBalance.length > 0 ? '#EF4444' : '#10B981', marginTop: '4px' }}>{outOfBalance.length}</div>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8', fontSize: '14px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          No reconciliation data yet. Run a sync first.
        </div>
      ) : (
        <div style={stl.card}>
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Category</th>
                <th style={stl.th}>Helm Value</th>
                <th style={stl.th}>QB Balance</th>
                <th style={stl.th}>Variance</th>
                <th style={stl.th}>Status</th>
                <th style={stl.th}>Last Checked</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...stl.td, fontWeight: 600 }}>{a.categoryName}</td>
                  <td style={stl.td}>{fmtCents(a.helmValueCents)}</td>
                  <td style={stl.td}>
                    {a.qbBalanceCents != null ? fmtCents(a.qbBalanceCents) : <span style={{ color: '#94A3B8' }}>Not linked</span>}
                  </td>
                  <td style={{ ...stl.td, fontWeight: 600, color: a.varianceCents === 0 ? '#10B981' : a.varianceCents > 0 ? '#F59E0B' : '#EF4444' }}>
                    {a.varianceCents === 0 ? '—' : fmtCents(a.varianceCents)}
                    {a.variancePct != null && a.varianceCents !== 0 && (
                      <span style={{ fontSize: '11px', marginLeft: '4px', color: '#94A3B8' }}>
                        ({a.variancePct > 0 ? '+' : ''}{a.variancePct.toFixed(1)}%)
                      </span>
                    )}
                  </td>
                  <td style={stl.td}>{statusBadge(a.status, a.varianceCents)}</td>
                  <td style={{ ...stl.td, fontSize: '12px', color: '#64748B' }}>{fmtDateTime(a.lastCheckedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
