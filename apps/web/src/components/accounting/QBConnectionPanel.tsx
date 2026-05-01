import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plug, Unplug, Check, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

interface QboLocationStatus {
  locationId: string;
  locationName: string;
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  lastChartOfAccountsSyncAt: string | null;
  glAccountCount: number;
  missingMappings: number;
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px' } as React.CSSProperties,
  pill: (connected: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '4px 10px', borderRadius: '999px',
    fontSize: '12px', fontWeight: 600,
    backgroundColor: connected ? '#DCFCE7' : '#F1F5F9',
    color: connected ? '#16A34A' : '#64748B',
  }),
  btn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', backgroundColor: '#F8FAFC', color: '#0A2342' } as React.CSSProperties,
  primary: { backgroundColor: '#0A2342', color: '#FFFFFF', borderColor: '#0A2342' } as React.CSSProperties,
  danger: { backgroundColor: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA' } as React.CSSProperties,
  meta: { fontSize: '13px', color: '#64748B', marginTop: '4px' } as React.CSSProperties,
  actions: { display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' as const },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '10px', width: '440px', maxWidth: '90vw', boxShadow: '0 25px 60px rgba(0,0,0,0.18)', padding: '24px' } as React.CSSProperties,
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '16px' } as React.CSSProperties,
  statBox: { background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '12px' } as React.CSSProperties,
  statLabel: { fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  statValue: { fontSize: '16px', fontWeight: 700, color: '#0A2342', marginTop: '4px' },
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

export default function QBConnectionPanel() {
  const { currentLocationId } = useModules();
  const [status, setStatus] = useState<QboLocationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ data: QboLocationStatus[] }>('/api/qbo/locations/status');
      const found = r.data.find((l) => l.locationId === currentLocationId) ?? null;
      setStatus(found);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load QB status';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const handleConnect = async () => {
    if (!currentLocationId) return;
    setBusy(true);
    try {
      const r = await api.post<{ url: string }>('/api/settings/qbo/connect', { locationId: currentLocationId });
      if (r?.url) window.location.href = r.url;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Connect failed';
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async () => {
    if (!currentLocationId) return;
    setBusy(true);
    try {
      await api.post(`/api/qbo/locations/${currentLocationId}/sync-chart-of-accounts`);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!currentLocationId) return;
    setBusy(true);
    setConfirmDisconnect(false);
    try {
      await api.post('/api/settings/qbo/disconnect', { locationId: currentLocationId, confirm: true });
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Disconnect failed';
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  if (!currentLocationId) {
    return (
      <div style={stl.card}>
        <div style={{ color: '#64748B', fontSize: '14px' }}>Select a location to manage QuickBooks connection.</div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px' }}>Loading QuickBooks status…</div>;
  }

  if (error) {
    return (
      <div style={{ ...stl.card, border: '1px solid #FECACA', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
          <AlertTriangle size={16} /> {error}
        </div>
      </div>
    );
  }

  const connected = status?.connected ?? false;

  return (
    <>
      <div style={stl.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342' }}>
              QuickBooks Online Connection
            </div>
            <div style={stl.meta}>
              {connected ? (
                <>
                  <span style={stl.pill(true)}><Check size={12} /> Connected</span>
                  {status?.companyName && <span style={{ marginLeft: '8px' }}>to <strong>{status.companyName}</strong></span>}
                  {status?.realmId && <span style={{ marginLeft: '8px', color: '#94A3B8' }}>Realm: {status.realmId}</span>}
                </>
              ) : (
                <span style={stl.pill(false)}>Not connected</span>
              )}
            </div>
          </div>
          <div style={stl.actions}>
            {connected ? (
              <>
                <button
                  style={{ ...stl.btn, ...stl.primary }}
                  onClick={handleSync}
                  disabled={busy}
                >
                  <RefreshCw size={14} /> {busy ? 'Syncing…' : 'Sync Chart of Accounts'}
                </button>
                <button
                  style={{ ...stl.btn, ...stl.danger }}
                  onClick={() => setConfirmDisconnect(true)}
                  disabled={busy}
                >
                  <Unplug size={14} /> Disconnect
                </button>
              </>
            ) : (
              <button
                style={{ ...stl.btn, ...stl.primary }}
                onClick={handleConnect}
                disabled={busy}
              >
                <Plug size={14} /> {busy ? 'Connecting…' : 'Connect QuickBooks'}
              </button>
            )}
          </div>
        </div>

        {connected && status && (
          <div style={stl.statGrid}>
            <div style={stl.statBox}>
              <div style={stl.statLabel}>GL Accounts</div>
              <div style={stl.statValue}>{status.glAccountCount}</div>
            </div>
            <div style={stl.statBox}>
              <div style={stl.statLabel}>Missing Mappings</div>
              <div style={{ ...stl.statValue, color: status.missingMappings > 0 ? '#F59E0B' : '#10B981' }}>
                {status.missingMappings}
              </div>
            </div>
            <div style={stl.statBox}>
              <div style={stl.statLabel}>Last Chart Sync</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', marginTop: '4px' }}>
                {fmtDate(status.lastChartOfAccountsSyncAt)}
              </div>
            </div>
            <div style={stl.statBox}>
              <div style={stl.statLabel}>Token Expires</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', marginTop: '4px' }}>
                {fmtDate(status.tokenExpiresAt)}
              </div>
            </div>
            <div style={stl.statBox}>
              <div style={stl.statLabel}>Connected At</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', marginTop: '4px' }}>
                {fmtDate(status.connectedAt)}
              </div>
            </div>
          </div>
        )}

        {!connected && (
          <div style={{ marginTop: '16px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '6px', padding: '12px 16px', fontSize: '13px', color: '#075985', lineHeight: '1.5' }}>
            Connect this location to its QuickBooks Online company to enable GL account mapping, automatic invoice posting, and financial sync.
          </div>
        )}
      </div>

      {confirmDisconnect && (
        <div style={stl.overlay} onClick={() => setConfirmDisconnect(false)}>
          <div style={stl.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '12px' }}>
              Disconnect QuickBooks?
            </div>
            <div style={{ fontSize: '14px', color: '#64748B', marginBottom: '20px', lineHeight: '1.5' }}>
              This will remove the QuickBooks connection for this location. Existing GL account mappings will be preserved but future syncing will stop.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                style={{ background: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </button>
              <button
                style={{ background: '#B91C1C', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                onClick={handleDisconnect}
                disabled={busy}
              >
                {busy ? 'Disconnecting…' : 'Yes, Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
