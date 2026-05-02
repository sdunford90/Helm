import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Check, Clock, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';
import { useToast } from '../Toast';

interface FailedSync {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  error: string;
  attemptedAt: string;
  retryCount: number;
}

interface SuccessfulSync {
  id: string;
  entityType: string;
  entityName: string | null;
  syncedAt: string;
}

interface SyncHealth {
  connected: boolean;
  queueDepth: number;
  failedSyncs: FailedSync[];
  recentSuccesses: SuccessfulSync[];
  lastSyncAt: string | null;
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px', marginBottom: '16px' } as React.CSSProperties,
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342', marginBottom: '12px' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: '#F8FAFC' },
  td: { padding: '8px 12px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'top' as const },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 } as React.CSSProperties,
  retryBtn: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '12px', fontWeight: 600, border: '1px solid #E2E8F0', borderRadius: '5px', cursor: 'pointer', backgroundColor: '#F8FAFC', color: '#0A2342' } as React.CSSProperties,
  statBox: { background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '16px' } as React.CSSProperties,
  statLabel: { fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '6px' },
  statValue: { fontSize: '22px', fontWeight: 700, color: '#0A2342' },
};

function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function SyncHealthPanel() {
  const { currentLocationId } = useModules();
  const toast = useToast();
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const r = await api.get<SyncHealth>(
        `/api/accounting/sync-health?locationId=${encodeURIComponent(currentLocationId)}`,
      );
      setHealth(r);
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 501) {
        setUnavailable(true);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load sync health');
      }
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const handleRetry = async (syncId: string) => {
    setRetrying(syncId);
    try {
      await api.post(`/api/accounting/sync-health/retry/${syncId}`);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRetrying(null);
    }
  };

  const handleSyncAllUnsynced = async () => {
    setSyncingAll(true);
    try {
      const r = await api.post<{
        enqueued: number;
        skippedNoConnection: number;
        enqueueFailed: number;
        skipped: number;
        total: number;
      }>('/api/accounting/sync-health/sync-all-unsynced');

      const detailParts: string[] = [];
      if (r.skippedNoConnection > 0) {
        detailParts.push(`${r.skippedNoConnection} skipped (no QuickBooks connection)`);
      }
      if (r.enqueueFailed > 0) {
        detailParts.push(`${r.enqueueFailed} could not be queued`);
      }

      if (r.enqueued > 0) {
        toast.success(
          `Queued ${r.enqueued} invoice${r.enqueued === 1 ? '' : 's'} for sync`,
          detailParts.length > 0 ? detailParts.join(' · ') : undefined,
        );
      } else if (r.total === 0) {
        toast.info('Nothing to sync', 'No unsynced invoices found.');
      } else {
        toast.warning(
          'No invoices were queued',
          detailParts.length > 0 ? detailParts.join(' · ') : undefined,
        );
      }

      await load();
    } catch (e: unknown) {
      toast.error('Sync failed', e instanceof Error ? e.message : 'Unable to queue invoice syncs.');
    } finally {
      setSyncingAll(false);
    }
  };

  if (!currentLocationId) {
    return <div style={{ padding: '24px', color: '#64748B', fontSize: '14px' }}>Select a location to view sync health.</div>;
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><RefreshCw size={16} /> Loading sync health…</div>;
  }

  if (unavailable) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
        <Zap size={32} style={{ margin: '0 auto 12px', display: 'block', color: '#CBD5E1' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>Sync Health coming soon</div>
        <div style={{ fontSize: '13px', marginTop: '4px' }}>
          QB sync health monitoring is not yet available. Check back after the next deployment.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
        <AlertTriangle size={16} /> {error}
        <button style={{ ...stl.retryBtn, marginLeft: '8px' }} onClick={() => void load()}>Retry</button>
      </div>
    );
  }

  if (!health) return null;

  const failed = health.failedSyncs ?? [];
  const successes = health.recentSuccesses ?? [];

  return (
    <div>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div style={stl.statBox}>
          <div style={stl.statLabel}>Connection</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
            {health.connected ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#DCFCE7', color: '#15803D', padding: '4px 10px', borderRadius: '999px', fontSize: '13px', fontWeight: 600 }}>
                <Check size={12} /> Connected
              </span>
            ) : (
              <span style={{ background: '#F1F5F9', color: '#64748B', padding: '4px 10px', borderRadius: '999px', fontSize: '13px', fontWeight: 600 }}>
                Disconnected
              </span>
            )}
          </div>
        </div>
        <div style={stl.statBox}>
          <div style={stl.statLabel}>Queue Depth</div>
          <div style={{ ...stl.statValue, color: health.queueDepth > 10 ? '#F59E0B' : '#0A2342' }}>
            {health.queueDepth}
          </div>
        </div>
        <div style={stl.statBox}>
          <div style={stl.statLabel}>Failed Syncs</div>
          <div style={{ ...stl.statValue, color: failed.length > 0 ? '#EF4444' : '#10B981' }}>
            {failed.length}
          </div>
        </div>
        <div style={stl.statBox}>
          <div style={stl.statLabel}>Last Sync</div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', marginTop: '6px' }}>
            <Clock size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            {fmtDateTime(health.lastSyncAt)}
          </div>
        </div>
      </div>

      {/* Failed syncs */}
      {failed.length > 0 && (
        <div style={{ ...stl.card, border: '1px solid #FECACA' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ ...stl.sectionTitle, color: '#B91C1C', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}>
              <AlertTriangle size={16} /> Failed Syncs ({failed.length})
            </div>
            <button
              style={{
                ...stl.retryBtn,
                opacity: syncingAll || failed.length === 0 ? 0.6 : 1,
                cursor: syncingAll || failed.length === 0 ? 'not-allowed' : 'pointer',
              }}
              disabled={syncingAll || failed.length === 0}
              onClick={() => void handleSyncAllUnsynced()}
            >
              <RefreshCw size={12} /> {syncingAll ? 'Queuing…' : 'Sync all unsynced'}
            </button>
          </div>
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Entity</th>
                <th style={stl.th}>Error</th>
                <th style={stl.th}>Attempted</th>
                <th style={stl.th}>Retries</th>
                <th style={stl.th}></th>
              </tr>
            </thead>
            <tbody>
              {failed.map((f) => (
                <tr key={f.id}>
                  <td style={stl.td}>
                    <div style={{ fontWeight: 600 }}>{f.entityName ?? f.entityId}</div>
                    <div style={{ fontSize: '11px', color: '#64748B' }}>{f.entityType}</div>
                  </td>
                  <td style={{ ...stl.td, color: '#B91C1C', fontSize: '12px' }}>{f.error}</td>
                  <td style={{ ...stl.td, fontSize: '12px', color: '#64748B', whiteSpace: 'nowrap' as const }}>{fmtDateTime(f.attemptedAt)}</td>
                  <td style={stl.td}>
                    <span style={{ ...stl.badge, background: '#FEF3C7', color: '#92400E' }}>{f.retryCount}</span>
                  </td>
                  <td style={{ ...stl.td, textAlign: 'right' as const }}>
                    <button
                      style={stl.retryBtn}
                      disabled={retrying === f.id}
                      onClick={() => void handleRetry(f.id)}
                    >
                      <RefreshCw size={12} /> {retrying === f.id ? 'Retrying…' : 'Retry'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent successes */}
      {successes.length > 0 && (
        <div style={stl.card}>
          <div style={stl.sectionTitle}>Recent Successful Syncs</div>
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Entity</th>
                <th style={stl.th}>Type</th>
                <th style={stl.th}>Synced At</th>
              </tr>
            </thead>
            <tbody>
              {successes.slice(0, 20).map((s) => (
                <tr key={s.id}>
                  <td style={{ ...stl.td, fontWeight: 600 }}>{s.entityName ?? s.id}</td>
                  <td style={stl.td}>{s.entityType}</td>
                  <td style={{ ...stl.td, fontSize: '12px', color: '#64748B' }}>{fmtDateTime(s.syncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {failed.length === 0 && successes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px', color: '#94A3B8', fontSize: '14px' }}>
          No sync activity recorded yet.
        </div>
      )}
    </div>
  );
}
