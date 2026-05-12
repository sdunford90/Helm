import React, { useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/api';
import { card, cardLabel, kpiTileStyle, fmtPct, subtle } from './styles';

interface ReliabilityReport {
  generatedAt: string;
  webhooks: {
    last24h: { total: number; success: number; failed: number; successRate: number };
    last7d: { total: number; success: number; failed: number; successRate: number };
    pendingRetry: number;
    disabledDestinations: number;
  };
  email: { tenantsWithRecentFailure: number; recentFailureWindowDays: number };
}

const InsightsReliability: React.FC = () => {
  const api = useApiFetch();
  const [data, setData] = useState<ReliabilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ReliabilityReport>('/api/admin/insights/reliability')
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [api]);

  if (error) return <div style={{ ...card, color: '#F44336' }}>{error}</div>;
  if (!data) return <div style={{ ...card, ...subtle }}>Loading…</div>;

  const accentForRate = (rate: number, total: number): string => {
    if (total === 0) return 'rgba(255,255,255,0.4)';
    if (rate >= 0.99) return '#4CAF50';
    if (rate >= 0.95) return '#FF9800';
    return '#F44336';
  };

  return (
    <div>
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={cardLabel}>Outbound webhook delivery</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <Kpi
            label="Success rate (24h)"
            value={data.webhooks.last24h.total === 0 ? '—' : fmtPct(data.webhooks.last24h.successRate)}
            accent={accentForRate(data.webhooks.last24h.successRate, data.webhooks.last24h.total)}
            sub={`${data.webhooks.last24h.success}/${data.webhooks.last24h.total}`}
          />
          <Kpi
            label="Success rate (7d)"
            value={data.webhooks.last7d.total === 0 ? '—' : fmtPct(data.webhooks.last7d.successRate)}
            accent={accentForRate(data.webhooks.last7d.successRate, data.webhooks.last7d.total)}
            sub={`${data.webhooks.last7d.success}/${data.webhooks.last7d.total}`}
          />
          <Kpi
            label="Pending retry"
            value={String(data.webhooks.pendingRetry)}
            accent={data.webhooks.pendingRetry > 0 ? '#FF9800' : 'rgba(255,255,255,0.6)'}
          />
          <Kpi
            label="Auto-disabled destinations"
            value={String(data.webhooks.disabledDestinations)}
            accent={data.webhooks.disabledDestinations > 0 ? '#F44336' : 'rgba(255,255,255,0.6)'}
          />
        </div>
      </div>

      <div style={card}>
        <div style={cardLabel}>Email send health</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Kpi
            label={`Tenants with failures (last ${data.email.recentFailureWindowDays}d)`}
            value={String(data.email.tenantsWithRecentFailure)}
            accent={data.email.tenantsWithRecentFailure > 0 ? '#F44336' : '#4CAF50'}
          />
          <div style={{ ...kpiTileStyle(), display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ ...subtle, marginBottom: 6 }}>Drill-down</div>
            <a href="/tenants" style={{ color: '#00D4FF', fontSize: 13, textDecoration: 'none' }}>
              Tenants &rarr; filter by Email Failure
            </a>
          </div>
        </div>
      </div>

      <div style={{ ...subtle, textAlign: 'right', marginTop: 12 }}>
        Generated {new Date(data.generatedAt).toLocaleString()}
      </div>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; accent?: string; sub?: string }> = ({ label, value, accent = '#FFF', sub }) => (
  <div style={kpiTileStyle()}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 4 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{sub}</div>}
  </div>
);

export default InsightsReliability;
