import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface VendorRow {
  vendor: string;
  orderCount: number;
  totalCents: number;
  avgLeadDays: number | null;
}
interface StatusRow { status: string; count: number; }
interface PurchasingData {
  period: { startDate: string; endDate: string };
  totalOrders: number;
  totalSpendCents: number;
  openOrders: number;
  openSpendCents: number;
  byStatus: StatusRow[];
  byVendor: VendorRow[];
  aging: { current: number; days30: number; days60: number; days60plus: number };
}

export default function PurchasingReport() {
  return (
    <ReportPage<PurchasingData>
      title="Purchasing"
      subtitle="PO activity, open spend, vendor lead-time, and aging on orders that haven't been received."
      apiPath="/api/reports/purchasing"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Orders" value={data.totalOrders} />
            <KpiTile label="Total spend" value={formatCents(data.totalSpendCents)} accent="#166534" />
            <KpiTile label="Open orders" value={data.openOrders} accent="#0EA5E9" />
            <KpiTile label="Open spend" value={formatCents(data.openSpendCents)} accent="#9A3412" />
          </div>

          <div style={styles.sectionTitle}>Open PO aging</div>
          <div style={styles.kpiRow}>
            <KpiTile label="≤ 30 days" value={data.aging.current} />
            <KpiTile label="31–60 days" value={data.aging.days30} accent={data.aging.days30 > 0 ? '#F59E0B' : undefined} />
            <KpiTile label="60+ days" value={data.aging.days60plus} accent={data.aging.days60plus > 0 ? '#B71C1C' : undefined} />
          </div>

          <div style={styles.sectionTitle}>By vendor</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Vendor</th>
                  <th style={styles.th}>Orders</th>
                  <th style={styles.th}>Spend</th>
                  <th style={styles.th}>Avg lead-time</th>
                </tr>
              </thead>
              <tbody>
                {data.byVendor.map((v) => (
                  <tr key={v.vendor}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{v.vendor}</td>
                    <td style={styles.td}>{v.orderCount}</td>
                    <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{formatCents(v.totalCents)}</td>
                    <td style={styles.td}>{v.avgLeadDays === null ? '—' : `${v.avgLeadDays} days`}</td>
                  </tr>
                ))}
                {data.byVendor.length === 0 && (
                  <tr><td colSpan={4} style={styles.empty}>No purchase orders in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
