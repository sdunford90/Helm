import React, { useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/api';
import { card, cardLabel, td, th, fmtMoney, fmtPct, subtle } from './styles';

interface BenchmarkBand {
  metric: string;
  unit: 'PCT' | 'DAYS' | 'CENTS' | 'COUNT';
  sampleSize: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}
interface Report { generatedAt: string; bands: BenchmarkBand[]; }

function fmtVal(val: number, unit: BenchmarkBand['unit']): string {
  if (unit === 'PCT') return fmtPct(val);
  if (unit === 'DAYS') return `${Math.round(val)}d`;
  if (unit === 'CENTS') return fmtMoney(val);
  return String(Math.round(val));
}

const InsightsBenchmarks: React.FC = () => {
  const api = useApiFetch();
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Report>('/api/admin/insights/tenant-benchmarks')
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [api]);

  if (error) return <div style={{ ...card, color: '#F44336' }}>{error}</div>;
  if (!data) return <div style={{ ...card, ...subtle }}>Loading…</div>;

  return (
    <div>
      <div style={card}>
        <div style={cardLabel}>Cross-tenant percentiles</div>
        <div style={{ ...subtle, marginBottom: 12 }}>
          Anonymized percentiles across every active tenant. Use these as a benchmark when working
          with a single account — never as targets for tenants below the median.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Metric</th>
              <th style={th}>Sample</th>
              <th style={th}>P25</th>
              <th style={th}>P50 (median)</th>
              <th style={th}>P75</th>
              <th style={th}>P90</th>
            </tr>
          </thead>
          <tbody>
            {data.bands.map((b) => (
              <tr key={b.metric}>
                <td style={{ ...td, color: '#FFF', fontWeight: 500 }}>{b.metric}</td>
                <td style={td}>{b.sampleSize}</td>
                <td style={td}>{fmtVal(b.p25, b.unit)}</td>
                <td style={{ ...td, color: '#00D4FF', fontWeight: 600 }}>{fmtVal(b.p50, b.unit)}</td>
                <td style={td}>{fmtVal(b.p75, b.unit)}</td>
                <td style={td}>{fmtVal(b.p90, b.unit)}</td>
              </tr>
            ))}
            {data.bands.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, ...subtle }}>No tenant data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ ...subtle, textAlign: 'right', marginTop: 12 }}>
        Generated {new Date(data.generatedAt).toLocaleString()}
      </div>
    </div>
  );
};

export default InsightsBenchmarks;
