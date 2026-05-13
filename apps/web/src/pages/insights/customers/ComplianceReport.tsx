import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface ComplianceData {
  insurance: { total: number; compliant: number; expiringSoon: number; expired: number };
  registration: { total: number; expired: number; current: number };
}

export default function ComplianceReport() {
  return (
    <ReportPage<ComplianceData>
      title="Customer Compliance"
      subtitle="Insurance and registration health across the customer base. Expiring-soon means the next 30 days."
      apiPath="/api/reports/compliance"
      enableDateRange={false}
      render={(data) => {
        const insurancePct = data.insurance.total > 0 ? (data.insurance.compliant / data.insurance.total) * 100 : 0;
        const regPct = data.registration.total > 0 ? (data.registration.current / data.registration.total) * 100 : 0;
        return (
          <>
            <div style={styles.sectionTitle}>Insurance</div>
            <div style={styles.kpiRow}>
              <KpiTile label="Records" value={data.insurance.total} />
              <KpiTile
                label="Compliant"
                value={data.insurance.compliant}
                sub={`${insurancePct.toFixed(1)}%`}
                accent="#166534"
              />
              <KpiTile
                label="Expiring soon (30d)"
                value={data.insurance.expiringSoon}
                accent={data.insurance.expiringSoon > 0 ? '#F59E0B' : '#94A3B8'}
              />
              <KpiTile
                label="Expired"
                value={data.insurance.expired}
                accent={data.insurance.expired > 0 ? '#B71C1C' : '#94A3B8'}
              />
            </div>

            <div style={styles.sectionTitle}>Vessel registration</div>
            <div style={styles.kpiRow}>
              <KpiTile label="Boats tracked" value={data.registration.total} />
              <KpiTile
                label="Current"
                value={data.registration.current}
                sub={`${regPct.toFixed(1)}%`}
                accent="#166534"
              />
              <KpiTile
                label="Expired"
                value={data.registration.expired}
                accent={data.registration.expired > 0 ? '#B71C1C' : '#94A3B8'}
              />
            </div>

            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 12 }}>
              Drill-down into the COI list and registration cards lives on each Customer's profile.
            </div>
          </>
        );
      }}
    />
  );
}
