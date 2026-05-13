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
          status="live"
          icon={TrendingUp}
          to="/insights/customers/ltv"
        />
        <ReportCard
          title="Churn"
          description="Cancellations, contract non-renewal, and at-risk accounts."
          status="live"
          icon={UserMinus}
          to="/insights/customers/churn"
        />
        <ReportCard
          title="Pipeline & Lead Conversion"
          description="Lead source ROI, conversion velocity, and stage-by-stage funnel."
          status="live"
          icon={Filter}
          to="/insights/customers/pipeline"
        />
        <ReportCard
          title="Waitlist"
          description="Depth, age-in-queue, and conversion-to-contract rate."
          status="live"
          icon={ListChecks}
          to="/insights/customers/waitlist"
        />
        <ReportCard
          title="NPS"
          description="Survey results, drivers, and trend (backed by the existing NpsSurvey model)."
          status="live"
          icon={Smile}
          to="/insights/customers/nps"
        />
        <ReportCard
          title="Compliance"
          description="Insurance expiry, safety records, and COI gaps across the customer base."
          status="live"
          icon={ShieldCheck}
          to="/insights/customers/compliance"
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
