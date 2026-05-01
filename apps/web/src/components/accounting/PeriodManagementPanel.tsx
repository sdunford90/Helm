import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Lock, Unlock, Calendar } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

interface AccountingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  closedAt: string | null;
  closedByName: string | null;
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '0', overflow: 'hidden' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: '#F8FAFC' },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'middle' as const },
  badge: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 } as React.CSSProperties,
  actionBtn: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, border: '1px solid #E2E8F0', borderRadius: '5px', cursor: 'pointer', backgroundColor: '#F8FAFC', color: '#0A2342' } as React.CSSProperties,
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadge(status: string): React.ReactNode {
  switch (status) {
    case 'OPEN':
      return <span style={{ ...stl.badge, background: '#DCFCE7', color: '#15803D' }}>Open</span>;
    case 'CLOSED':
      return <span style={{ ...stl.badge, background: '#FEF3C7', color: '#92400E' }}><Lock size={10} /> Closed</span>;
    case 'LOCKED':
      return <span style={{ ...stl.badge, background: '#F1F5F9', color: '#475569' }}><Lock size={10} /> Locked</span>;
    default:
      return <span style={{ ...stl.badge, background: '#F1F5F9', color: '#64748B' }}>{status}</span>;
  }
}

export default function PeriodManagementPanel() {
  const { currentLocationId } = useModules();
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const r = await api.get<{ data: AccountingPeriod[] }>(
        `/api/accounting/periods?locationId=${encodeURIComponent(currentLocationId)}`,
      );
      setPeriods(r.data ?? []);
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 501) {
        setUnavailable(true);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load periods');
      }
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const handleClose = async (periodId: string) => {
    if (!confirm('Close this accounting period? This will prevent further edits to transactions within it.')) return;
    setBusy(periodId);
    try {
      await api.post(`/api/accounting/periods/${periodId}/close`);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Close failed');
    } finally {
      setBusy(null);
    }
  };

  const handleReopen = async (periodId: string) => {
    if (!confirm('Reopen this accounting period?')) return;
    setBusy(periodId);
    try {
      await api.post(`/api/accounting/periods/${periodId}/reopen`);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Reopen failed');
    } finally {
      setBusy(null);
    }
  };

  if (!currentLocationId) {
    return <div style={{ padding: '24px', color: '#64748B', fontSize: '14px' }}>Select a location to manage accounting periods.</div>;
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><Calendar size={16} /> Loading periods…</div>;
  }

  if (unavailable) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
        <Calendar size={32} style={{ margin: '0 auto 12px', display: 'block', color: '#CBD5E1' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>Period Management coming soon</div>
        <div style={{ fontSize: '13px', marginTop: '4px' }}>
          Fiscal period management is not yet available. Check back after the next deployment.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
        <AlertTriangle size={16} /> {error}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '16px', fontSize: '13px', color: '#64748B' }}>
        {periods.length} fiscal period{periods.length !== 1 ? 's' : ''} · {periods.filter((p) => p.status === 'OPEN').length} open
      </div>

      {periods.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8', fontSize: '14px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          No accounting periods configured yet.
        </div>
      ) : (
        <div style={stl.card}>
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Period</th>
                <th style={stl.th}>Dates</th>
                <th style={stl.th}>Status</th>
                <th style={stl.th}>Closed By</th>
                <th style={stl.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...stl.td, fontWeight: 600 }}>{p.name}</td>
                  <td style={{ ...stl.td, fontSize: '12px', color: '#475569' }}>
                    {fmtDate(p.startDate)} — {fmtDate(p.endDate)}
                  </td>
                  <td style={stl.td}>{statusBadge(p.status)}</td>
                  <td style={{ ...stl.td, fontSize: '12px', color: '#64748B' }}>
                    {p.closedByName ?? '—'}
                    {p.closedAt && <div style={{ fontSize: '11px' }}>{fmtDate(p.closedAt)}</div>}
                  </td>
                  <td style={stl.td}>
                    {p.status === 'OPEN' && (
                      <button
                        style={{ ...stl.actionBtn, color: '#92400E', borderColor: '#FDE68A', background: '#FFFBEB' }}
                        onClick={() => void handleClose(p.id)}
                        disabled={busy === p.id}
                      >
                        <Lock size={12} /> {busy === p.id ? '…' : 'Close Period'}
                      </button>
                    )}
                    {p.status === 'CLOSED' && (
                      <button
                        style={stl.actionBtn}
                        onClick={() => void handleReopen(p.id)}
                        disabled={busy === p.id}
                      >
                        <Unlock size={12} /> {busy === p.id ? '…' : 'Reopen'}
                      </button>
                    )}
                    {p.status === 'LOCKED' && (
                      <span style={{ fontSize: '12px', color: '#94A3B8' }}>Locked — contact admin</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
