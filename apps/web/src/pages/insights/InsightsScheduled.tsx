import InsightsShell from './InsightsShell';
import Reports from '../Reports';

export default function InsightsScheduled() {
  // The existing Reports page already provides scheduled-report management
  // (cron, recipients, last-run history). We mount it inside the Insights
  // shell so the URL and chrome stay consistent across the section.
  return (
    <InsightsShell
      title="Scheduled & Saved Reports"
      subtitle="Cron schedules, recipients, run history, and saved report definitions."
    >
      <Reports />
    </InsightsShell>
  );
}
