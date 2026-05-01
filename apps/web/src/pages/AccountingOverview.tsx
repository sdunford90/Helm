import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModules } from '../context/ModulesContext';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import { AlertTriangle, CheckCircle, XCircle, Clock, ChevronRight, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';

// Color scheme: #0A2342 navy, #E2E8F0 border, #64748B muted, #F8FAFC bg
// #10B981 green, #F59E0B amber, #EF4444 red

interface LocationAccountingStatus {
  locationId: string;
  locationName: string;
  setupComplete: boolean;
  setupStep: number;
  gracePeriodEndsAt: string | null;
  qboConnected: boolean;
  qboCompanyName: string | null;
  failedSyncCount: number;
  openAlertCount: number;
  openPeriod: { periodStart: string; periodEnd: string } | null;
  mtdRevenueCents: number;
}

interface OverviewData {
  locations: LocationAccountingStatus[];
  totalMtdRevenueCents: number;
  totalFailedSyncs: number;
  totalOpenAlerts: number;
  locationsNeedingSetup: number;
}

const stl = {
  page: { padding: '0' } as React.CSSProperties,
  header: { marginBottom: '28px' } as React.CSSProperties,
  title: { fontSize: '26px', fontWeight: 700, color: '#0A2342', margin: '0 0 4px 0' } as React.CSSProperties,
  subtitle: { fontSize: '14px', color: '#64748B', margin: 0 } as React.CSSProperties,

  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' } as React.CSSProperties,
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px 24px' } as React.CSSProperties,
  cardLabel: { fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '8px' } as React.CSSProperties,
  cardValue: { fontSize: '28px', fontWeight: 700, color: '#0A2342', lineHeight: 1 } as React.CSSProperties,
  cardSub: { fontSize: '12px', color: '#64748B', marginTop: '4px' } as React.CSSProperties,

  section: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '24px' } as React.CSSProperties,
  sectionHeader: { padding: '16px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
  sectionTitle: { fontSize: '16px', fontWeight: 700, color: '#0A2342', margin: 0 } as React.CSSProperties,

  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' } as React.CSSProperties,
  th: { textAlign: 'left' as const, padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' } as React.CSSProperties,
  td: { padding: '14px 16px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'middle' as const } as React.CSSProperties,

  badge: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 } as React.CSSProperties,

  actionBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' } as React.CSSProperties,
  viewBtn: { background: '#F1F5F9', color: '#0A2342', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' } as React.CSSProperties,
  refreshBtn: { background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', color: '#64748B', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,

  emptyState: { padding: '48px 24px', textAlign: 'center' as const, color: '#64748B', fontSize: '14px' } as React.CSSProperties,
  errorBox: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px', color: '#DC2626', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' } as React.CSSProperties,
  accessDenied: { background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '24px', textAlign: 'center' as const, color: '#92400E' } as React.CSSProperties,
};

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SetupStatusBadge({ loc }: { loc: LocationAccountingStatus }) {
  if (loc.setupComplete) {
    return (
      <span style={{ ...stl.badge, background: '#D1FAE5', color: '#065F46' }}>
        <CheckCircle size={12} /> Complete
      </span>
    );
  }
  if (loc.setupStep > 0) {
    return (
      <span style={{ ...stl.badge, background: '#FEF3C7', color: '#92400E' }}>
        <Clock size={12} /> Step {loc.setupStep} of 5
      </span>
    );
  }
  return (
    <span style={{ ...stl.badge, background: '#FEE2E2', color: '#991B1B' }}>
      <XCircle size={12} /> Not started
    </span>
  );
}

function QboBadge({ loc }: { loc: LocationAccountingStatus }) {
  if (loc.qboConnected) {
    return (
      <span style={{ ...stl.badge, background: '#D1FAE5', color: '#065F46' }}>
        <CheckCircle size={12} /> {loc.qboCompanyName ?? 'Connected'}
      </span>
    );
  }
  return <span style={{ ...stl.badge, background: '#F1F5F9', color: '#64748B' }}>Not connected</span>;
}

function SyncHealthBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span style={{ ...stl.badge, background: '#D1FAE5', color: '#065F46' }}>
        <CheckCircle size={12} /> No errors
      </span>
    );
  }
  return (
    <span style={{ ...stl.badge, background: '#FEE2E2', color: '#991B1B' }}>
      <AlertTriangle size={12} /> {count} {count === 1 ? 'error' : 'errors'}
    </span>
  );
}

export default function AccountingOverview() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { locations } = useModules();
  const { user, loading: userLoading } = useCurrentUser();

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOverview = async () => {
    try {
      const token = await getToken();
      const result = await api.get<OverviewData>('/api/accounting/overview', token);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounting overview');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!userLoading) {
      void fetchOverview();
    }
  }, [userLoading]);

  const handleRefresh = () => {
    setRefreshing(true);
    void fetchOverview();
  };

  // Role guard — accounting personas only
  const ACCOUNTING_ROLES = ['TENANT_ADMIN', 'PLATFORM_ADMIN', 'MARINA_OWNER', 'ACCOUNTING'];
  if (!userLoading && user && !ACCOUNTING_ROLES.includes(user.role)) {
    return (
      <div style={stl.accessDenied}>
        <AlertTriangle size={32} style={{ marginBottom: '12px', color: '#F59E0B' }} />
        <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '6px' }}>Access Restricted</div>
        <div style={{ fontSize: '14px' }}>The Accounting Overview is available to marina owners, tenant administrators, and accounting staff.</div>
      </div>
    );
  }

  const totalLocations = data?.locations.length ?? 0;
  const setupComplete = data?.locations.filter((l) => l.setupComplete).length ?? 0;

  return (
    <div style={stl.page}>
      {/* Header */}
      <div style={stl.header}>
        <h1 style={stl.title}>Accounting Overview</h1>
        <p style={stl.subtitle}>Cross-location accounting health and setup status</p>
      </div>

      {/* Error */}
      {error && (
        <div style={stl.errorBox}>
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Summary cards */}
      {!loading && data && (
        <div style={stl.summaryRow}>
          <div style={stl.card}>
            <div style={stl.cardLabel}>Total MTD Revenue</div>
            <div style={stl.cardValue}>{formatCents(data.totalMtdRevenueCents)}</div>
            <div style={stl.cardSub}>All locations combined</div>
          </div>
          <div style={stl.card}>
            <div style={stl.cardLabel}>Locations Setup Complete</div>
            <div style={{ ...stl.cardValue, color: setupComplete === totalLocations && totalLocations > 0 ? '#10B981' : setupComplete === 0 ? '#EF4444' : '#F59E0B' }}>
              {setupComplete} / {totalLocations}
            </div>
            <div style={stl.cardSub}>{data.locationsNeedingSetup > 0 ? `${data.locationsNeedingSetup} need attention` : 'All configured'}</div>
          </div>
          <div style={stl.card}>
            <div style={stl.cardLabel}>Open Sync Failures</div>
            <div style={{ ...stl.cardValue, color: data.totalFailedSyncs > 0 ? '#EF4444' : '#10B981' }}>
              {data.totalFailedSyncs}
            </div>
            <div style={stl.cardSub}>Across all locations</div>
          </div>
          <div style={stl.card}>
            <div style={stl.cardLabel}>Open Reconciliation Alerts</div>
            <div style={{ ...stl.cardValue, color: data.totalOpenAlerts > 0 ? '#F59E0B' : '#10B981' }}>
              {data.totalOpenAlerts}
            </div>
            <div style={stl.cardSub}>Unresolved alerts</div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={stl.summaryRow}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ ...stl.card, height: '90px', background: '#F1F5F9', border: 'none' }} />
          ))}
        </div>
      )}

      {/* Location Setup Status Table */}
      <div style={stl.section}>
        <div style={stl.sectionHeader}>
          <h2 style={stl.sectionTitle}>Location Setup Status</h2>
          <button style={stl.refreshBtn} onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {loading ? (
          <div style={stl.emptyState}>Loading location data…</div>
        ) : !data?.locations.length ? (
          <div style={stl.emptyState}>No locations found for this tenant.</div>
        ) : (
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Location</th>
                <th style={stl.th}>Setup Status</th>
                <th style={stl.th}>QB Connection</th>
                <th style={stl.th}>Sync Health</th>
                <th style={stl.th}>Open Issues</th>
                <th style={stl.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.locations.map((loc) => (
                <tr key={loc.locationId}>
                  <td style={{ ...stl.td, fontWeight: 600 }}>
                    {loc.locationName}
                    {loc.gracePeriodEndsAt && !loc.setupComplete && (
                      <div style={{ fontSize: '11px', color: '#F59E0B', marginTop: '2px' }}>
                        Grace period ends {formatDate(loc.gracePeriodEndsAt)}
                      </div>
                    )}
                  </td>
                  <td style={stl.td}><SetupStatusBadge loc={loc} /></td>
                  <td style={stl.td}><QboBadge loc={loc} /></td>
                  <td style={stl.td}><SyncHealthBadge count={loc.failedSyncCount} /></td>
                  <td style={stl.td}>
                    {loc.openAlertCount > 0 ? (
                      <span style={{ ...stl.badge, background: '#FEF3C7', color: '#92400E' }}>
                        <AlertTriangle size={12} /> {loc.openAlertCount}
                      </span>
                    ) : (
                      <span style={{ color: '#64748B', fontSize: '13px' }}>—</span>
                    )}
                  </td>
                  <td style={stl.td}>
                    {!loc.setupComplete ? (
                      <button style={stl.actionBtn} onClick={() => navigate('/settings/accounting')}>
                        Complete Setup <ChevronRight size={13} />
                      </button>
                    ) : (
                      <button style={stl.viewBtn} onClick={() => navigate('/settings/accounting')}>
                        View Hub <ChevronRight size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Period Status Section */}
      {!loading && data && data.locations.some((l) => l.openPeriod) && (
        <div style={stl.section}>
          <div style={stl.sectionHeader}>
            <h2 style={stl.sectionTitle}>Current Accounting Periods</h2>
          </div>
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Location</th>
                <th style={stl.th}>Period Start</th>
                <th style={stl.th}>Period End</th>
                <th style={stl.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.locations.map((loc) => (
                <tr key={loc.locationId}>
                  <td style={{ ...stl.td, fontWeight: 600 }}>{loc.locationName}</td>
                  <td style={stl.td}>
                    {loc.openPeriod ? formatDate(loc.openPeriod.periodStart) : <span style={{ color: '#64748B' }}>—</span>}
                  </td>
                  <td style={stl.td}>
                    {loc.openPeriod ? formatDate(loc.openPeriod.periodEnd) : <span style={{ color: '#64748B' }}>—</span>}
                  </td>
                  <td style={stl.td}>
                    {loc.openPeriod ? (
                      <span style={{ ...stl.badge, background: '#DBEAFE', color: '#1E40AF' }}>
                        <Clock size={12} /> Open
                      </span>
                    ) : (
                      <span style={{ color: '#64748B', fontSize: '13px' }}>No open period</span>
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
