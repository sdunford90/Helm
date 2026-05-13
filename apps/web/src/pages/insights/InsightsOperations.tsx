import {
  Anchor, ClipboardCheck, Bed, Ship, Fuel, ShoppingCart, Package, ClipboardList,
} from 'lucide-react';
import InsightsShell from './InsightsShell';
import { ReportCard, ReportGrid } from './ReportCard';

export default function InsightsOperations() {
  return (
    <InsightsShell
      title="Operations Insights"
      subtitle="How the marina runs day-to-day — slips, dock walks, transient turn, rentals, fuel, POS, inventory, purchasing."
    >
      <ReportGrid>
        <ReportCard
          title="Slip Occupancy"
          description="Occupancy now, trended over time, broken down by dock or location with drill-down to slip detail."
          status="live"
          icon={Anchor}
          to="/insights/operations/occupancy"
        />
        <ReportCard
          title="Dock Walks"
          description="Findings by dock, repeat-issue tracking, and completion rate by staff member."
          status="live"
          icon={ClipboardCheck}
          to="/insights/operations/dock-walks"
        />
        <ReportCard
          title="Transient Activity"
          description="Arrivals, no-shows, average length-of-stay, and the overstay queue."
          status="live"
          icon={Bed}
          to="/insights/operations/transient"
        />
        <ReportCard
          title="Rentals Utilization"
          description="Hours-utilized vs. hours-available, surge effectiveness, and pricing-suggestion hit rate."
          status="live"
          icon={Ship}
          to="/insights/operations/rentals"
        />
        <ReportCard
          title="Fuel"
          description="Sales vs. deliveries, margin, pump uptime, and tank-level history."
          status="live"
          icon={Fuel}
          to="/insights/operations/fuel"
        />
        <ReportCard
          title="POS Sales"
          description="Sales by terminal, category, and shift. Voids, refunds, and discount mix."
          status="live"
          icon={ShoppingCart}
          to="/insights/operations/pos-sales"
        />
        <ReportCard
          title="Inventory"
          description="Turnover, stock-outs, shrinkage, slow movers, and reorder suggestions."
          status="live"
          icon={Package}
          to="/insights/operations/inventory"
        />
        <ReportCard
          title="Purchasing"
          description="PO aging, vendor lead-time, GR accruals, and spend-by-vendor."
          status="live"
          icon={ClipboardList}
          to="/insights/operations/purchasing"
        />
      </ReportGrid>
    </InsightsShell>
  );
}
