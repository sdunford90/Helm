import React, { useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/api';
import { card, cardLabel, td, th, kpiTileStyle, fmtMoney, fmtPct, subtle } from './styles';

interface AdoptionReport {
  generatedAt: string;
  totals: { activeTenants: number };
  integrations: {
    stripeConnected: number;
    quickbooksConnected: number;
    customEmailDomain: number;
    customBranding: number;
  };
  tierMix: { tierId: string | null; tierName: string; tenantCount: number; monthlyFeeCents: number }[];
  featureFlagOverrides: { flag: string; on: number; off: number }[];
  recentlyActive30d: number;
}

const InsightsAdoption: React.FC = () => {
  const api = useApiFetch();
  const [data, setData] = useState<AdoptionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<AdoptionReport>('/api/admin/insights/adoption')
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [api]);

  if (error) return <div style={{ ...card, color: '#F44336' }}>{error}</div>;
  if (!data) return <div style={{ ...card, ...subtle }}>Loading…</div>;

  const totalActive = data.totals.activeTenants;
  const pctOf = (n: number) => totalActive > 0 ? n / totalActive : 0;

  return (
    <div>
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={cardLabel}>Integration coverage (active tenants)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Kpi
            label="Stripe connected"
            value={`${data.integrations.stripeConnected}`}
            sub={fmtPct(pctOf(data.integrations.stripeConnected))}
            accent="#00D4FF"
          />
          <Kpi
            label="QuickBooks connected"
            value={`${data.integrations.quickbooksConnected}`}
            sub={fmtPct(pctOf(data.integrations.quickbooksConnected))}
            accent="#4CAF50"
          />
          <Kpi
            label="Custom email domain"
            value={`${data.integrations.customEmailDomain}`}
            sub={fmtPct(pctOf(data.integrations.customEmailDomain))}
            accent="#FF9800"
          />
          <Kpi
            label="Custom branding"
            value={`${data.integrations.customBranding}`}
            sub={fmtPct(pctOf(data.integrations.customBranding))}
            accent="#9C27B0"
          />
        </div>
        <div style={{ ...subtle, marginTop: 12 }}>
          Recently active (updated within 30d): <span style={{ color: '#FFF', fontWeight: 600 }}>{data.recentlyActive30d}</span>
          {' '} of {totalActive}.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={card}>
          <div style={cardLabel}>Tier mix</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Tier</th>
                <th style={th}>Tenants</th>
                <th style={th}>Share</th>
                <th style={th}>Monthly</th>
              </tr>
            </thead>
            <tbody>
              {data.tierMix.map((row) => (
                <tr key={row.tierId ?? 'none'}>
                  <td style={{ ...td, color: '#FFF' }}>{row.tierName}</td>
                  <td style={td}>{row.tenantCount}</td>
                  <td style={{ ...td, color: '#00D4FF' }}>{fmtPct(pctOf(row.tenantCount))}</td>
                  <td style={{ ...td, color: row.monthlyFeeCents > 0 ? '#4CAF50' : 'rgba(255,255,255,0.4)' }}>
                    {row.monthlyFeeCents > 0 ? fmtMoney(row.monthlyFeeCents) : '—'}
                  </td>
                </tr>
              ))}
              {data.tierMix.length === 0 && (
                <tr><td colSpan={4} style={{ ...td, ...subtle }}>No tenants yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={card}>
          <div style={cardLabel}>Feature-flag overrides</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Flag</th>
                <th style={th}>Forced ON</th>
                <th style={th}>Forced OFF</th>
              </tr>
            </thead>
            <tbody>
              {data.featureFlagOverrides.map((row) => (
                <tr key={row.flag}>
                  <td style={{ ...td, color: '#FFF', fontFamily: 'monospace', fontSize: 11 }}>{row.flag}</td>
                  <td style={{ ...td, color: row.on > 0 ? '#4CAF50' : 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{row.on}</td>
                  <td style={{ ...td, color: row.off > 0 ? '#F44336' : 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{row.off}</td>
                </tr>
              ))}
              {data.featureFlagOverrides.length === 0 && (
                <tr><td colSpan={3} style={{ ...td, ...subtle }}>No overrides — every tenant is on defaults.</td></tr>
              )}
            </tbody>
          </table>
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

export default InsightsAdoption;
