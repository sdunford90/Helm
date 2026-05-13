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
          status="live"
          icon={Mail}
          to="/insights/communications/email"
        />
        <ReportCard
          title="SMS"
          description="Volume, opt-out rate, and delivery failures by carrier (Twilio-backed)."
          status="live"
          icon={MessageSquare}
          to="/insights/communications/sms"
        />
        <ReportCard
          title="Automations"
          description="Rule-by-rule performance and error tracking for the Email Automation engine."
          status="live"
          icon={Workflow}
          to="/insights/communications/automations"
        />
        <ReportCard
          title="Announcements"
          description="Reach and read-rate per announcement (backed by PortalMessage delivery)."
          status="live"
          icon={Megaphone}
          to="/insights/communications/announcements"
        />
        <ReportCard
          title="Suppression"
          description="Suppression-list growth, top reasons, and reactivation candidates."
          status="live"
          icon={Ban}
          to="/insights/communications/suppression"
        />
      </ReportGrid>
    </InsightsShell>
  );
}
