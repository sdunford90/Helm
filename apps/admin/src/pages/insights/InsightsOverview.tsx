import React, { useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/api';
import { card, cardLabel, kpiTileStyle, fmtMoney, fmtPct, fmtBps, subtle } from './styles';

interface PlatformHealth {
  generatedAt: string;
  tenants: { total: number; active: number; trial: number; gracePeriod: number; locked: number };
  revenue: { mrrCents: number; arrCents: number; gmvCents: number; takeRateBps: number };
  trial: { last30Signups: number; last30Converted: number; conversionRate: number };
  churn: { cancelledLast30: number; rate30d: number };
}

const InsightsOverview: React.FC = () => {
  const api = useApiFetch();
  const [data, setData] = useState<PlatformHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<PlatformHealth>('/api/admin/insights/platform-health')
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [api]);

  if (error) return <div style={{ ...card, color: '#F44336' }}>{error}</div>;
  if (!data) return <div style={{ ...card, ...subtle }}>Loading…</div>;

  return (
    <div>
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={cardLabel}>Revenue (live)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Kpi label="MRR" value={fmtMoney(data.revenue.mrrCents)} accent="#4CAF50" />
          <Kpi label="ARR" value={fmtMoney(data.revenue.arrCents)} accent="#4CAF50" />
          <Kpi label="Lifetime GMV" value={fmtMoney(data.revenue.gmvCents)} accent="#00D4FF" />
          <Kpi label="Avg take rate" value={fmtBps(data.revenue.takeRateBps)} accent="#FF9800" />
        </div>
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={cardLabel}>Tenants</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <Kpi label="Active" value={String(data.tenants.active)} accent="#4CAF50" />
          <Kpi label="Trial" value={String(data.tenants.trial)} accent="#00D4FF" />
          <Kpi label="Grace" value={String(data.tenants.gracePeriod)} accent="#FF9800" />
          <Kpi label="Locked" value={String(data.tenants.locked)} accent="#F44336" />
          <Kpi label="Total" value={String(data.tenants.total)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={card}>
          <div style={cardLabel}>Trial → Paid (last 30d)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Kpi label="Signups" value={String(data.trial.last30Signups)} accent="#00D4FF" />
            <Kpi label="Converted" value={String(data.trial.last30Converted)} accent="#4CAF50" />
            <Kpi label="Conversion" value={fmtPct(data.trial.conversionRate)} accent="#4CAF50" />
          </div>
        </div>

        <div style={card}>
          <div style={cardLabel}>Churn (last 30d)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <Kpi label="Tenants locked" value={String(data.churn.cancelledLast30)} accent="#F44336" />
            <Kpi label="Rate" value={fmtPct(data.churn.rate30d)} accent="#F44336" />
          </div>
        </div>
      </div>

      <div style={{ ...subtle, textAlign: 'right', marginTop: 16 }}>
        Generated {new Date(data.generatedAt).toLocaleString()}
      </div>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent = '#FFF' }) => (
  <div style={kpiTileStyle()}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 4 }}>{value}</div>
  </div>
);

export default InsightsOverview;
