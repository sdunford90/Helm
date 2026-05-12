import React, { useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/api';
import { card, cardLabel, td, th, kpiTileStyle, subtle } from './styles';

interface SupportSla {
  generatedAt: string;
  windowDays: number;
  tickets: {
    total: number;
    resolved: number;
    avgFirstResponseHours: number | null;
    avgResolutionHours: number | null;
    p90FirstResponseHours: number | null;
    p90ResolutionHours: number | null;
  };
  backlog: { priority: string; open: number; inProgress: number; waiting: number }[];
}

const InsightsSupport: React.FC = () => {
  const api = useApiFetch();
  const [data, setData] = useState<SupportSla | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<SupportSla>('/api/admin/insights/support-sla')
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [api]);

  if (error) return <div style={{ ...card, color: '#F44336' }}>{error}</div>;
  if (!data) return <div style={{ ...card, ...subtle }}>Loading…</div>;

  const fmtHrs = (v: number | null) => v === null ? '—' : v < 24 ? `${v.toFixed(1)}h` : `${(v / 24).toFixed(1)}d`;

  return (
    <div>
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={cardLabel}>SLA — last {data.windowDays} days</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Kpi label="Tickets created" value={String(data.tickets.total)} accent="#00D4FF" />
          <Kpi label="Resolved" value={String(data.tickets.resolved)} accent="#4CAF50" />
          <Kpi label="Avg first response" value={fmtHrs(data.tickets.avgFirstResponseHours)} accent="#FF9800" />
          <Kpi label="Avg resolution" value={fmtHrs(data.tickets.avgResolutionHours)} accent="#FF9800" />
          <Kpi label="P90 first response" value={fmtHrs(data.tickets.p90FirstResponseHours)} accent="#9C27B0" />
          <Kpi label="P90 resolution" value={fmtHrs(data.tickets.p90ResolutionHours)} accent="#9C27B0" />
        </div>
      </div>

      <div style={card}>
        <div style={cardLabel}>Current backlog by priority</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Priority</th>
              <th style={th}>Open</th>
              <th style={th}>In progress</th>
              <th style={th}>Waiting on customer</th>
              <th style={th}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.backlog.map((row) => {
              const total = row.open + row.inProgress + row.waiting;
              return (
                <tr key={row.priority}>
                  <td style={{ ...td, color: '#FFF', fontWeight: 500, textTransform: 'capitalize' }}>{row.priority}</td>
                  <td style={{ ...td, color: row.open > 0 ? '#F44336' : 'rgba(255,255,255,0.4)' }}>{row.open}</td>
                  <td style={{ ...td, color: row.inProgress > 0 ? '#FF9800' : 'rgba(255,255,255,0.4)' }}>{row.inProgress}</td>
                  <td style={td}>{row.waiting}</td>
                  <td style={{ ...td, color: '#FFF', fontWeight: 600 }}>{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ ...subtle, textAlign: 'right', marginTop: 12 }}>
        Generated {new Date(data.generatedAt).toLocaleString()}
      </div>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent = '#FFF' }) => (
  <div style={kpiTileStyle()}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: accent, marginTop: 4 }}>{value}</div>
  </div>
);

export default InsightsSupport;
