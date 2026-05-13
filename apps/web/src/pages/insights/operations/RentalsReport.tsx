import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface ProductRow {
  productId: string;
  name: string;
  bookings: number;
  revenueCents: number;
}
interface RentalsData {
  period: { startDate: string; endDate: string };
  totalBookings: number;
  totalRevenueCents: number;
  byProduct: ProductRow[];
}

export default function RentalsReport() {
  return (
    <ReportPage<RentalsData>
      title="Rentals Utilization"
      subtitle="Bookings, revenue, and per-product utilization across kayaks, paddleboards, slip rentals, and anything else on the rental shelf."
      apiPath="/api/reports/rental-utilization"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Bookings" value={data.totalBookings} />
            <KpiTile label="Revenue" value={formatCents(data.totalRevenueCents)} accent="#166534" />
            <KpiTile
              label="Avg ticket"
              value={data.totalBookings > 0 ? formatCents(Math.round(data.totalRevenueCents / data.totalBookings)) : '—'}
            />
            <KpiTile label="Active SKUs" value={data.byProduct.filter((p) => p.bookings > 0).length} sub={`of ${data.byProduct.length}`} />
          </div>

          <div style={styles.sectionTitle}>By product</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Product</th>
                  <th style={styles.th}>Bookings</th>
                  <th style={styles.th}>Revenue</th>
                  <th style={styles.th}>Avg ticket</th>
                </tr>
              </thead>
              <tbody>
                {data.byProduct
                  .slice()
                  .sort((a, b) => b.revenueCents - a.revenueCents)
                  .map((p) => (
                    <tr key={p.productId}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{p.name}</td>
                      <td style={styles.td}>{p.bookings}</td>
                      <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{formatCents(p.revenueCents)}</td>
                      <td style={styles.td}>
                        {p.bookings > 0 ? formatCents(Math.round(p.revenueCents / p.bookings)) : '—'}
                      </td>
                    </tr>
                  ))}
                {data.byProduct.length === 0 && (
                  <tr><td colSpan={4} style={styles.empty}>No rental products configured.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
