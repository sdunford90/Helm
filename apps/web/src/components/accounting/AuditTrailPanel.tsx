import React, { useState, useEffect, useCallback } from 'react';
import { Download, AlertTriangle, Clock } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

interface AuditEntry {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  recordType: string;
  action: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  description: string | null;
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '0', overflow: 'hidden' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: '#F8FAFC' },
  td: { padding: '10px 16px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'top' as const },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 } as React.CSSProperties,
  exportBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', backgroundColor: '#F8FAFC', color: '#0A2342' } as React.CSSProperties,
};

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function actionColor(action: string): { bg: string; color: string } {
  switch (action.toLowerCase()) {
    case 'create': return { bg: '#DCFCE7', color: '#15803D' };
    case 'update': return { bg: '#EFF6FF', color: '#1D4ED8' };
    case 'delete': return { bg: '#FEE2E2', color: '#B91C1C' };
    case 'connect': return { bg: '#F0FDF4', color: '#166534' };
    case 'disconnect': return { bg: '#FFF7ED', color: '#C2410C' };
    default: return { bg: '#F1F5F9', color: '#475569' };
  }
}

function exportCsv(entries: AuditEntry[]) {
  const headers = ['Timestamp', 'User', 'Role', 'Record Type', 'Action', 'Field', 'From', 'To', 'Description'];
  const rows = entries.map((e) => [
    e.createdAt,
    e.userName ?? '',
    e.userRole ?? '',
    e.recordType,
    e.action,
    e.field ?? '',
    e.fromValue ?? '',
    e.toValue ?? '',
    e.description ?? '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `accounting-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditTrailPanel() {
  const { currentLocationId } = useModules();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const r = await api.get<{ data: AuditEntry[] }>(
        `/api/accounting/audit-log?locationId=${encodeURIComponent(currentLocationId)}&limit=50`,
      );
      setEntries(r.data ?? []);
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 501) {
        setUnavailable(true);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load audit log');
      }
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  if (!currentLocationId) {
    return (
      <div style={{ padding: '24px', color: '#64748B', fontSize: '14px' }}>
        Select a location to view the audit trail.
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><Clock size={16} /> Loading audit log…</div>;
  }

  if (unavailable) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
        <Clock size={32} style={{ margin: '0 auto 12px', display: 'block', color: '#CBD5E1' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>Audit log coming soon</div>
        <div style={{ fontSize: '13px', marginTop: '4px' }}>
          The accounting change log endpoint is not yet available. Check back after the next deployment.
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', color: '#64748B' }}>
          Showing last {entries.length} accounting configuration change{entries.length !== 1 ? 's' : ''}
        </div>
        {entries.length > 0 && (
          <button style={stl.exportBtn} onClick={() => exportCsv(entries)}>
            <Download size={14} /> Export CSV
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8', fontSize: '14px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          No accounting changes recorded yet for this location.
        </div>
      ) : (
        <div style={stl.card}>
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Timestamp</th>
                <th style={stl.th}>User</th>
                <th style={stl.th}>Change</th>
                <th style={stl.th}>Before / After</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const ac = actionColor(entry.action);
                return (
                  <tr key={entry.id}>
                    <td style={{ ...stl.td, whiteSpace: 'nowrap' as const, color: '#64748B', fontSize: '12px' }}>
                      {fmtDateTime(entry.createdAt)}
                    </td>
                    <td style={stl.td}>
                      <div style={{ fontWeight: 600, color: '#0A2342' }}>{entry.userName ?? 'System'}</div>
                      {entry.userRole && (
                        <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>{entry.userRole}</div>
                      )}
                    </td>
                    <td style={stl.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const }}>
                        <span style={{ ...stl.badge, background: ac.bg, color: ac.color }}>{entry.action}</span>
                        <span style={{ color: '#0A2342' }}>{entry.recordType}</span>
                        {entry.field && <span style={{ color: '#64748B', fontSize: '12px' }}>· {entry.field}</span>}
                      </div>
                      {entry.description && (
                        <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>{entry.description}</div>
                      )}
                    </td>
                    <td style={stl.td}>
                      {(entry.fromValue || entry.toValue) ? (
                        <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column' as const, gap: '2px' }}>
                          {entry.fromValue && (
                            <div style={{ color: '#B91C1C' }}>
                              <span style={{ fontWeight: 600 }}>From:</span> {entry.fromValue}
                            </div>
                          )}
                          {entry.toValue && (
                            <div style={{ color: '#15803D' }}>
                              <span style={{ fontWeight: 600 }}>To:</span> {entry.toValue}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#94A3B8', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
