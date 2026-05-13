import { ScrollText, ShieldCheck, CalendarCheck, RefreshCw, Webhook, BookCheck } from 'lucide-react';
import InsightsShell from './InsightsShell';
import { ReportCard, ReportGrid } from './ReportCard';

export default function InsightsCompliance() {
  return (
    <InsightsShell
      title="Compliance & Audit"
      subtitle="Evidence for auditors, period-close reviewers, and platform on-call — the integrity surfaces."
    >
      <ReportGrid>
        <ReportCard
          title="Audit Log"
          description="Full searchable history of changes to tenant data with user and timestamp attribution."
          status="live"
          icon={ScrollText}
          to="/settings/audit"
        />
        <ReportCard
          title="Admin Actions"
          description="Platform-side audit events — who impersonated, who toggled flags, who exported data."
          status="live"
          icon={ShieldCheck}
          to="/insights/compliance/admin-actions"
        />
        <ReportCard
          title="Period Close"
          description="Open/closed periods, lock attestations, and unposted-entry reports for close."
          status="live"
          icon={CalendarCheck}
          to="/insights/compliance/period-close"
        />
        <ReportCard
          title="QBO Sync Health"
          description="Sync deltas, error history, and reconciliation status per location."
          status="live"
          icon={RefreshCw}
          to="/insights/compliance/qbo-sync"
        />
        <ReportCard
          title="Webhooks"
          description="Stripe and QBO delivery success, retry queue, and dead-letter inspection."
          status="live"
          icon={Webhook}
          to="/insights/compliance/webhooks"
        />
        <ReportCard
          title="Accounting Completeness"
          description="Every sellable thing and required system slot that has no GL mapping. ERRORs block postings on QBO-connected locations; WARNINGs fall back to default."
          status="live"
          icon={BookCheck}
          to="/insights/compliance/accounting-completeness"
        />
      </ReportGrid>
    </InsightsShell>
  );
}
