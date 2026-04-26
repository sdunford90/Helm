import { useState, useEffect, CSSProperties } from 'react';
import { useApi } from '../hooks/useApi';
import { Loader, AlertCircle } from 'lucide-react';

interface PropertyData {
  id: string;
  name: string;
  totalSlips: number;
  occupiedSlips: number;
  occupancyPct: number;
  monthlyRevenue: number;
  totalAR: number;
  activeLeads: number;
  compliancePct: number;
  revenueHistory: number[];
}

interface Alert {
  id: string;
  property: string;
  type: 'contract' | 'compliance' | 'ach' | 'maintenance';
  message: string;
  severity: 'critical' | 'warning';
}

interface DashboardResponse {
  properties: PropertyData[];
  alerts: Alert[];
  months: string[];
}

const propertyColors = ['#0ea5e9', '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444'];

function fmt(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

function fmtFull(n: number): string {
  return '$' + n.toLocaleString();
}

export default function PortfolioDashboard() {
  const [selectedProperty, setSelectedProperty] = useState<string>('all');

  const { data, loading, error } = useApi<DashboardResponse>(
    'get',
    '/api/portfolio/dashboard',
    { immediate: true },
  );

  const properties = data?.properties ?? [];
  const alerts = data?.alerts ?? [];
  const months = data?.months ?? [];

  useEffect(() => {
    setSelectedProperty('all');
  }, [data]);

  const filtered = selectedProperty === 'all'
    ? properties
    : properties.filter((p) => p.id === selectedProperty);

  const totals = {
    slips: filtered.reduce((s, p) => s + p.totalSlips, 0),
    occupied: filtered.reduce((s, p) => s + p.occupiedSlips, 0),
    revenue: filtered.reduce((s, p) => s + p.monthlyRevenue, 0),
    ar: filtered.reduce((s, p) => s + p.totalAR, 0),
  };
  const totalOccupancy = totals.slips > 0 ? Math.round((totals.occupied / totals.slips) * 100) : 0;

  const monthTotals = months.map((_, i) =>
    properties.reduce((s, p) => s + (p.revenueHistory[i] ?? 0), 0)
  );
  const chartMax = Math.max(...monthTotals, 1) * 1.1;

  const filteredAlerts = selectedProperty === 'all'
    ? alerts
    : alerts.filter((a) => {
        const prop = properties.find((p) => p.id === selectedProperty);
        return prop && a.property === prop.name;
      });

  const s = {
    page: {
      padding: 32,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: 1280,
      margin: '0 auto',
    },
    headerRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    title: { fontSize: 28, fontWeight: 800, color: '#0a2540', margin: 0 },
    select: {
      padding: '8px 16px',
      fontSize: 14,
      borderRadius: 8,
      border: '1px solid #e2e8f0',
      color: '#0a2540',
      fontWeight: 600,
      outline: 'none',
      cursor: 'pointer',
    },
    divider: {
      height: 3,
      background: 'linear-gradient(90deg, #0ea5e9, #06b6d4, #8b5cf6)',
      border: 'none',
      borderRadius: 2,
      marginBottom: 28,
    },
    kpiGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 20,
      marginBottom: 32,
    },
    kpiCard: {
      background: '#ffffff',
      borderRadius: 12,
      border: '1px solid #e2e8f0',
      padding: 20,
    },
    kpiLabel: {
      fontSize: 12,
      fontWeight: 600,
      color: '#64748b',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      marginBottom: 6,
    },
    kpiValue: { fontSize: 28, fontWeight: 800, color: '#0a2540', margin: 0 },
    kpiSub: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
    section: { marginBottom: 32 },
    sectionTitle: { fontSize: 18, fontWeight: 700, color: '#0a2540', marginBottom: 16 },
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
      background: '#ffffff',
      borderRadius: 12,
      overflow: 'hidden',
      border: '1px solid #e2e8f0',
    },
    th: {
      textAlign: 'left' as const,
      padding: '12px 16px',
      fontSize: 11,
      fontWeight: 700,
      color: '#64748b',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      background: '#f8fafc',
      borderBottom: '1px solid #e2e8f0',
    },
    td: {
      padding: '14px 16px',
      fontSize: 14,
      color: '#0a2540',
      borderBottom: '1px solid #f1f5f9',
    },
    tdBold: {
      padding: '14px 16px',
      fontSize: 14,
      color: '#0a2540',
      fontWeight: 700,
      borderBottom: '1px solid #f1f5f9',
    },
    chartContainer: {
      background: '#ffffff',
      borderRadius: 12,
      border: '1px solid #e2e8f0',
      padding: 24,
    },
    chartArea: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 16,
      height: 220,
      paddingTop: 16,
    },
    chartCol: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      height: '100%',
      justifyContent: 'flex-end',
    },
    chartLabel: { fontSize: 11, color: '#94a3b8', marginTop: 8, fontWeight: 600 },
    legend: {
      display: 'flex',
      gap: 20,
      marginTop: 16,
      justifyContent: 'center',
      flexWrap: 'wrap' as const,
    },
    legendItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' },
    legendDot: (color: string): CSSProperties => ({
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: color,
    }),
    alertCard: (severity: string): CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      borderRadius: 10,
      background: severity === 'critical' ? '#fef2f2' : '#fffbeb',
      border: `1px solid ${severity === 'critical' ? '#fecaca' : '#fde68a'}`,
      marginBottom: 8,
    }),
    alertDot: (severity: string): CSSProperties => ({
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: severity === 'critical' ? '#ef4444' : '#f59e0b',
      flexShrink: 0,
    }),
    alertProperty: {
      fontSize: 12,
      fontWeight: 700,
      color: '#64748b',
      minWidth: 160,
    },
    alertMsg: { fontSize: 13, color: '#0a2540', flex: 1 },
    alertBadge: (severity: string): CSSProperties => ({
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 8px',
      borderRadius: 20,
      color: severity === 'critical' ? '#dc2626' : '#d97706',
      background: severity === 'critical' ? '#fee2e2' : '#fef3c7',
      textTransform: 'uppercase' as const,
    }),
    occupancyBar: (): CSSProperties => ({
      width: 80,
      height: 6,
      borderRadius: 3,
      background: '#e2e8f0',
      position: 'relative' as const,
      display: 'inline-block',
      overflow: 'hidden',
    }),
    occupancyFill: (pct: number): CSSProperties => ({
      position: 'absolute' as const,
      left: 0,
      top: 0,
      bottom: 0,
      width: `${pct}%`,
      borderRadius: 3,
      background: pct >= 90 ? '#22c55e' : pct >= 75 ? '#f59e0b' : '#ef4444',
    }),
  };

  if (loading) {
    return (
      <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 12, color: '#64748b' }}>
        <Loader size={22} className="animate-spin" />
        <span style={{ fontSize: 15 }}>Loading portfolio data…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...s.page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 12, color: '#dc2626' }}>
        <AlertCircle size={28} />
        <span style={{ fontSize: 15 }}>Could not load portfolio data. Please refresh.</span>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div style={s.page}>
        <div style={s.headerRow}>
          <h1 style={s.title} className="helm-page-title">Portfolio Overview</h1>
        </div>
        <hr style={s.divider} />
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 64, fontSize: 15 }}>
          No active tenants found. Add your first marina to see portfolio data here.
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.headerRow}>
        <h1 style={s.title} className="helm-page-title">Portfolio Overview</h1>
        <select
          style={s.select}
          value={selectedProperty}
          onChange={(e) => setSelectedProperty(e.target.value)}
        >
          <option value="all">All Properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <hr style={s.divider} />

      {/* Aggregate KPIs */}
      <div style={s.kpiGrid} className="helm-stats-grid">
        <div style={s.kpiCard}>
          <div style={s.kpiLabel}>Total Slips</div>
          <div style={s.kpiValue}>{totals.slips}</div>
          <div style={s.kpiSub}>{totals.occupied} occupied</div>
        </div>
        <div style={s.kpiCard}>
          <div style={s.kpiLabel}>Total Occupancy</div>
          <div style={s.kpiValue}>{totalOccupancy}%</div>
          <div style={s.kpiSub}>{totals.slips - totals.occupied} available</div>
        </div>
        <div style={s.kpiCard}>
          <div style={s.kpiLabel}>Total Revenue</div>
          <div style={s.kpiValue}>{fmt(totals.revenue)}</div>
          <div style={s.kpiSub}>This month</div>
        </div>
        <div style={s.kpiCard}>
          <div style={s.kpiLabel}>Total A/R</div>
          <div style={s.kpiValue}>{fmt(totals.ar)}</div>
          <div style={s.kpiSub}>Outstanding</div>
        </div>
      </div>

      {/* Property Comparison Table */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>Property Comparison</h2>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Property</th>
              <th style={s.th}>Slips</th>
              <th style={s.th}>Occupancy</th>
              <th style={s.th}>Revenue</th>
              <th style={s.th}>A/R</th>
              <th style={s.th}>Leads</th>
              <th style={s.th}>Compliance</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td style={s.tdBold}>{p.name}</td>
                <td style={s.td}>{p.occupiedSlips} / {p.totalSlips}</td>
                <td style={s.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={s.occupancyBar()}>
                      <div style={s.occupancyFill(p.occupancyPct)} />
                    </div>
                    <span>{p.occupancyPct}%</span>
                  </div>
                </td>
                <td style={s.td}>{fmtFull(p.monthlyRevenue)}</td>
                <td style={s.td}>{fmtFull(p.totalAR)}</td>
                <td style={s.td}>{p.activeLeads}</td>
                <td style={s.td}>
                  <span style={{
                    color: p.compliancePct >= 95 ? '#22c55e' : p.compliancePct >= 90 ? '#f59e0b' : '#ef4444',
                    fontWeight: 700,
                  }}>
                    {p.compliancePct}%
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length > 1 && (
              <tr style={{ background: '#f8fafc' }}>
                <td style={{ ...s.tdBold, fontWeight: 800 }}>Total</td>
                <td style={s.tdBold}>{totals.occupied} / {totals.slips}</td>
                <td style={s.tdBold}>{totalOccupancy}%</td>
                <td style={s.tdBold}>{fmtFull(totals.revenue)}</td>
                <td style={s.tdBold}>{fmtFull(totals.ar)}</td>
                <td style={s.tdBold}>{filtered.reduce((sum, p) => sum + p.activeLeads, 0)}</td>
                <td style={s.tdBold}>--</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Revenue Chart - Stacked Bar */}
      {months.length > 0 && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>Revenue Trend (Stacked)</h2>
          <div style={s.chartContainer}>
            <div style={s.chartArea}>
              {months.map((month, mi) => {
                const total = properties.reduce((sum, p) => sum + (p.revenueHistory[mi] ?? 0), 0);
                const barHeight = chartMax > 0 ? (total / chartMax) * 200 : 0;
                let cumulativeHeight = 0;

                return (
                  <div key={month} style={s.chartCol}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, fontWeight: 600 }}>
                      {fmt(total)}
                    </div>
                    <div style={{ position: 'relative', width: '80%', height: barHeight, borderRadius: 6, overflow: 'hidden' }}>
                      {properties.map((p, pi) => {
                        const segHeight = total > 0 ? ((p.revenueHistory[mi] ?? 0) / total) * barHeight : 0;
                        const color = propertyColors[pi % propertyColors.length];
                        const segment = (
                          <div
                            key={p.id}
                            style={{
                              position: 'absolute',
                              bottom: cumulativeHeight,
                              left: 0,
                              right: 0,
                              height: segHeight,
                              background: color,
                              opacity: selectedProperty === 'all' || selectedProperty === p.id ? 1 : 0.2,
                            }}
                          />
                        );
                        cumulativeHeight += segHeight;
                        return segment;
                      })}
                    </div>
                    <div style={s.chartLabel}>{month}</div>
                  </div>
                );
              })}
            </div>
            <div style={s.legend}>
              {properties.map((p, i) => (
                <div key={p.id} style={s.legendItem}>
                  <div style={s.legendDot(propertyColors[i % propertyColors.length])} />
                  {p.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Alerts */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>
          Alerts
          {filteredAlerts.filter((a) => a.severity === 'critical').length > 0 && (
            <span style={{
              marginLeft: 12,
              fontSize: 12,
              fontWeight: 700,
              color: '#ef4444',
              background: '#fef2f2',
              padding: '2px 10px',
              borderRadius: 20,
            }}>
              {filteredAlerts.filter((a) => a.severity === 'critical').length} Critical
            </span>
          )}
        </h2>
        {filteredAlerts.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: 32, fontSize: 14 }}>
            No alerts for the selected property.
          </div>
        ) : (
          filteredAlerts.map((alert) => (
            <div key={alert.id} style={s.alertCard(alert.severity)}>
              <div style={s.alertDot(alert.severity)} />
              <div style={s.alertProperty}>{alert.property}</div>
              <div style={s.alertMsg}>{alert.message}</div>
              <span style={s.alertBadge(alert.severity)}>{alert.severity}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
