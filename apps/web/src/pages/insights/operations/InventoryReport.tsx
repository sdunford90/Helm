import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface InventoryItem {
  productId: string;
  name: string;
  sku: string | null;
  costCents: number;
  priceCents: number;
  qtyOnHand: number;
  qtyOnOrder: number;
  reorderQty: number;
  valueCents: number;
  needsReorder: boolean;
}
interface InventoryData {
  productCount: number;
  totalValueCents: number;
  reorderAlerts: number;
  items: InventoryItem[];
}

export default function InventoryReport() {
  return (
    <ReportPage<InventoryData>
      title="Inventory"
      subtitle="On-hand value, items below reorder point, and the line-item drilldown for every tracked SKU."
      apiPath="/api/reports/inventory"
      enableDateRange={false}
      render={(data) => {
        const sorted = data.items
          .slice()
          .sort((a, b) => (Number(b.needsReorder) - Number(a.needsReorder)) || (b.valueCents - a.valueCents));
        return (
          <>
            <div style={styles.kpiRow}>
              <KpiTile label="SKUs tracked" value={data.productCount} />
              <KpiTile label="Inventory value" value={formatCents(data.totalValueCents)} accent="#166534" />
              <KpiTile
                label="Reorder alerts"
                value={data.reorderAlerts}
                accent={data.reorderAlerts > 0 ? '#B71C1C' : '#94A3B8'}
              />
            </div>

            <div style={styles.card}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Product</th>
                    <th style={styles.th}>SKU</th>
                    <th style={styles.th}>On hand</th>
                    <th style={styles.th}>On order</th>
                    <th style={styles.th}>Reorder pt</th>
                    <th style={styles.th}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((i) => (
                    <tr key={i.productId} style={i.needsReorder ? { background: '#FFF7ED' } : undefined}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>
                        {i.name}
                        {i.needsReorder && <span style={{ marginLeft: 8, fontSize: 10, color: '#9A3412', fontWeight: 700 }}>REORDER</span>}
                      </td>
                      <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#64748B' }}>{i.sku ?? '—'}</td>
                      <td style={{ ...styles.td, color: i.needsReorder ? '#B71C1C' : undefined, fontWeight: 600 }}>{i.qtyOnHand}</td>
                      <td style={styles.td}>{i.qtyOnOrder}</td>
                      <td style={styles.td}>{i.reorderQty}</td>
                      <td style={styles.td}>{formatCents(i.valueCents)}</td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr><td colSpan={6} style={styles.empty}>No tracked products yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    />
  );
}
