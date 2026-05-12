import { Mail, MessageSquare, Workflow, Megaphone, Ban } from 'lucide-react';
import InsightsShell from './InsightsShell';
import { ReportCard, ReportGrid } from './ReportCard';

export default function InsightsCommunications() {
  return (
    <InsightsShell
      title="Communications Insights"
      subtitle="Outbound performance — what we're sending, what's landing, and what's getting clicked."
    >
      <ReportGrid>
        <ReportCard
          title="Email"
          description="Volume, deliverability, opens, clicks, bounces, and complaint rate (via the Resend feed)."
          status="phase-5b"
          icon={Mail}
        />
        <ReportCard
          title="SMS"
          description="Volume, opt-out rate, and delivery failures by carrier (Twilio-backed)."
          status="phase-5b"
          icon={MessageSquare}
        />
        <ReportCard
          title="Automations"
          description="Rule-by-rule performance and error tracking for the Email Automation engine."
          status="phase-5b"
          icon={Workflow}
        />
        <ReportCard
          title="Announcements"
          description="Reach and read-rate per announcement (backed by PortalMessage delivery)."
          status="phase-5b"
          icon={Megaphone}
        />
        <ReportCard
          title="Suppression"
          description="Suppression-list growth, top reasons, and reactivation candidates."
          status="phase-5b"
          icon={Ban}
        />
      </ReportGrid>
    </InsightsShell>
  );
}
