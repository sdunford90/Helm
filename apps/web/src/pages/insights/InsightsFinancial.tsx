import {
  TrendingUp, FileWarning, CreditCard, RotateCcw, Clock4, Receipt,
  BarChart3, Scale, ArrowLeftRight, BookOpen, FileText,
} from 'lucide-react';
import InsightsShell from './InsightsShell';
import { ReportCard, ReportGrid } from './ReportCard';

export default function InsightsFinancial() {
  return (
    <InsightsShell
      title="Financial Insights"
      subtitle="Books-grade reporting — revenue, A/R, cash-rail mix, refunds, deferred revenue, tax, and the GL reports an accountant needs at close."
    >
      <ReportGrid>
        <ReportCard
          title="Revenue"
          description="By location, product, and period. Recurring (MRR) vs. transient mix, with prior-period comparison."
          status="live"
          icon={TrendingUp}
          to="/insights/financial/revenue"
        />
        <ReportCard
          title="A/R Aging"
          description="Current / 30 / 60 / 90+ buckets with customer drilldown. Already live as a billing tool — Insights view adds trend & cohort lenses."
          status="live"
          icon={FileWarning}
          to="/insights/financial/ar-aging"
        />
        <ReportCard
          title="Card Rail Mix"
          description="Card vs. ACH vs. cash vs. check. Surcharge capture, average ticket per rail."
          status="live"
          icon={CreditCard}
          to="/insights/financial/card-rail-mix"
        />
        <ReportCard
          title="Refunds & Chargebacks"
          description="Volume, reasons, dispute outcomes, and chargeback rate by location."
          status="live"
          icon={RotateCcw}
          to="/insights/financial/refunds"
        />
        <ReportCard
          title="Deferred Revenue"
          description="Schedules, recognition by period, ASC 606 alignment."
          status="live"
          icon={Clock4}
          to="/billing/deferred-revenue"
        />
        <ReportCard
          title="Sales Tax"
          description="Liability by jurisdiction, period filing detail, with audit-trail export."
          status="live"
          icon={Receipt}
          to="/insights/financial/sales-tax"
        />
        <ReportCard
          title="P&L / Income Statement"
          description="Per-period, per-location income statement straight from the GL."
          status="live"
          icon={BarChart3}
          to="/insights/financial/pnl"
        />
        <ReportCard
          title="Balance Sheet"
          description="As-of-date balance sheet from the GL."
          status="live"
          icon={Scale}
          to="/insights/financial/balance-sheet"
        />
        <ReportCard
          title="Cash Flow"
          description="Direct-method cash flow built from payments and transfers."
          status="live"
          icon={ArrowLeftRight}
          to="/insights/financial/cash-flow"
        />
        <ReportCard
          title="Reconciliation"
          description="Three-way state: Stripe ⇄ Helm ⇄ QBO. Surfaces variance and breaks."
          status="live"
          icon={BookOpen}
          to="/insights/financial/reconciliation"
        />
        <ReportCard
          title="Trial Balance"
          description="Period debits, credits, and net per GL account, grouped by Asset/Liability/Equity/Revenue/Expense. Surfaces the trial-balance check so an accountant knows the books tie."
          status="live"
          icon={FileText}
          to="/insights/financial/trial-balance"
        />
      </ReportGrid>
    </InsightsShell>
  );
}
