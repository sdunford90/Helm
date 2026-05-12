import {
  TrendingUp, UserMinus, Filter, ListChecks, Smile, ShieldCheck, CreditCard,
} from 'lucide-react';
import InsightsShell from './InsightsShell';
import { ReportCard, ReportGrid } from './ReportCard';

export default function InsightsCustomers() {
  return (
    <InsightsShell
      title="Customers & CRM Insights"
      subtitle="The view from the customer side of the marina — who's growing, who's churning, where leads come from, and which compliance gaps need attention."
    >
      <ReportGrid>
        <ReportCard
          title="Customer LTV"
          description="Lifetime value by cohort, segment, and product mix."
          status="phase-5b"
          icon={TrendingUp}
        />
        <ReportCard
          title="Churn"
          description="Cancellations, contract non-renewal, and at-risk accounts."
          status="phase-5b"
          icon={UserMinus}
        />
        <ReportCard
          title="Pipeline & Lead Conversion"
          description="Lead source ROI, conversion velocity, and stage-by-stage funnel."
          status="phase-5b"
          icon={Filter}
        />
        <ReportCard
          title="Waitlist"
          description="Depth, age-in-queue, and conversion-to-contract rate."
          status="phase-5b"
          icon={ListChecks}
        />
        <ReportCard
          title="NPS"
          description="Survey results, drivers, and trend (backed by the existing NpsSurvey model)."
          status="phase-5b"
          icon={Smile}
        />
        <ReportCard
          title="Compliance"
          description="Insurance expiry, safety records, and COI gaps across the customer base."
          status="phase-5b"
          icon={ShieldCheck}
        />
        <ReportCard
          title="Card Expiry Forecast"
          description="Which saved cards expire over the next 3–24 months, with click-to-call / click-to-email contact lists for proactive outreach."
          status="live"
          icon={CreditCard}
          to="/insights/customers/card-expiry"
        />
      </ReportGrid>
    </InsightsShell>
  );
}
