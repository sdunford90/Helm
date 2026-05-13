import { Link } from 'react-router-dom';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface Gap {
  kind: string;
  label: string;
  detail: string;
  locationId: string | null;
  locationName: string | null;
  severity: 'ERROR' | 'WARNING';
  fixHref: string;
}
interface CompletenessData {
  summary: {
    totalLocations: number;
    totalGaps: number;
    errors: number;
    warnings: number;
  };
  gaps: Gap[];
}

export default function AccountingCompletenessReport() {
  return (
    <ReportPage<CompletenessData>
      title="Accounting Completeness"
      subtitle="Every sellable thing or system slot that has no GL mapping. ERRORs block postings on QBO-connected locations; WARNINGs fall back to a default account."
      apiPath="/api/reports/accounting-completeness"
      enableDateRange={false}
      render={(data) => {
        const byLocation = new Map<string, Gap[]>();
        for (const g of data.gaps) {
          const key = g.locationName ?? 'Tenant-wide';
          if (!byLocation.has(key)) byLocation.set(key, []);
          byLocation.get(key)!.push(g);
        }

        return (
          <>
            <div style={styles.kpiRow}>
              <KpiTile label="Locations" value={data.summary.totalLocations} />
              <KpiTile
                label="Total gaps"
                value={data.summary.totalGaps}
                accent={data.summary.totalGaps === 0 ? '#166534' : '#9A3412'}
              />
              <KpiTile
                label="Errors"
                value={data.summary.errors}
                accent={data.summary.errors > 0 ? '#B71C1C' : '#94A3B8'}
              />
              <KpiTile
                label="Warnings"
                value={data.summary.warnings}
                accent={data.summary.warnings > 0 ? '#F59E0B' : '#94A3B8'}
              />
            </div>

            {data.summary.totalGaps === 0 ? (
              <div style={{ ...styles.card, ...styles.empty }}>
                Books look tight. Every sellable thing has a revenue path and every required
                system slot is pinned. 🎉
              </div>
            ) : (
              Array.from(byLocation.entries()).map(([loc, gaps]) => (
                <div key={loc} style={{ marginBottom: 16 }}>
                  <div style={styles.sectionTitle}>{loc}</div>
                  <div style={styles.card}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Severity</th>
                          <th style={styles.th}>Thing</th>
                          <th style={styles.th}>Detail</th>
                          <th style={styles.th}>Fix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gaps.map((g, idx) => (
                          <tr key={`${g.kind}-${idx}`}>
                            <td style={{
                              ...styles.td,
                              fontWeight: 700,
                              color: g.severity === 'ERROR' ? '#B71C1C' : '#F59E0B',
                            }}>
                              {g.severity}
                            </td>
                            <td style={{ ...styles.td, fontWeight: 600 }}>{g.label}</td>
                            <td style={{ ...styles.td, color: '#64748B' }}>{g.detail}</td>
                            <td style={styles.td}>
                              <Link to={g.fixHref} style={{ color: '#0EA5E9', textDecoration: 'none', fontWeight: 600 }}>
                                Open settings →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </>
        );
      }}
    />
  );
}
