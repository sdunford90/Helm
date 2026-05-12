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
          status="phase-5a"
          icon={Anchor}
        />
        <ReportCard
          title="Dock Walks"
          description="Findings by dock, repeat-issue tracking, and completion rate by staff member."
          status="phase-5a"
          icon={ClipboardCheck}
        />
        <ReportCard
          title="Transient Activity"
          description="Arrivals, no-shows, average length-of-stay, and the overstay queue."
          status="phase-5a"
          icon={Bed}
        />
        <ReportCard
          title="Rentals Utilization"
          description="Hours-utilized vs. hours-available, surge effectiveness, and pricing-suggestion hit rate."
          status="phase-5a"
          icon={Ship}
        />
        <ReportCard
          title="Fuel"
          description="Sales vs. deliveries, margin, pump uptime, and tank-level history."
          status="phase-5a"
          icon={Fuel}
        />
        <ReportCard
          title="POS Sales"
          description="Sales by terminal, category, and shift. Voids, refunds, and discount mix."
          status="phase-5a"
          icon={ShoppingCart}
        />
        <ReportCard
          title="Inventory"
          description="Turnover, stock-outs, shrinkage, slow movers, and reorder suggestions."
          status="phase-5a"
          icon={Package}
        />
        <ReportCard
          title="Purchasing"
          description="PO aging, vendor lead-time, GR accruals, and spend-by-vendor."
          status="phase-5a"
          icon={ClipboardList}
        />
      </ReportGrid>
    </InsightsShell>
  );
}
