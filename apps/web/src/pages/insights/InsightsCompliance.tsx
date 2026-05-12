import { ScrollText, ShieldCheck, CalendarCheck, RefreshCw, Webhook } from 'lucide-react';
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
          status="phase-5b"
          icon={ShieldCheck}
        />
        <ReportCard
          title="Period Close"
          description="Open/closed periods, lock attestations, and unposted-entry reports for close."
          status="phase-5b"
          icon={CalendarCheck}
        />
        <ReportCard
          title="QBO Sync Health"
          description="Sync deltas, error history, and reconciliation status per location."
          status="phase-5b"
          icon={RefreshCw}
        />
        <ReportCard
          title="Webhooks"
          description="Stripe and QBO delivery success, retry queue, and dead-letter inspection."
          status="phase-5b"
          icon={Webhook}
        />
      </ReportGrid>
    </InsightsShell>
  );
}
