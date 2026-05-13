import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface FuelData {
  period: { startDate: string; endDate: string };
  fuelLineItems: number;
  totalRevenueCents: number;
}

export default function FuelReport() {
  return (
    <ReportPage<FuelData>
      title="Fuel"
      subtitle="Fuel sales captured through POS — line-item count and revenue for the window. Margin & pump-uptime land here in Phase 5b once the SCADA feed is wired."
      apiPath="/api/reports/fuel"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Fuel sales" value={data.fuelLineItems} />
            <KpiTile label="Revenue" value={formatCents(data.totalRevenueCents)} accent="#166534" />
            <KpiTile
              label="Avg ticket"
              value={data.fuelLineItems > 0 ? formatCents(Math.round(data.totalRevenueCents / data.fuelLineItems)) : '—'}
            />
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>
            Coming next: gallons vs. deliveries, per-pump uptime, and tank-level history.
          </div>
        </>
      )}
    />
  );
}
