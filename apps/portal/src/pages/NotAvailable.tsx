import { Wrench } from 'lucide-react';

/**
 * The boater portal has no API yet: there are no customer-scoped endpoints
 * (invoices, payments, boats, insurance, concierge, waitlist, announcements,
 * messages for the signed-in boater), and no link from a Clerk user to a
 * Customer record. Every portal screen used hardcoded sample data, so they
 * were withdrawn (they remain in git history) in favour of this notice.
 */
export default function NotAvailable({ section }: { section: string }) {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0A2342', margin: '0 0 20px' }}>{section}</h1>
      <div
        role="status"
        style={{
          display: 'flex', gap: 18, alignItems: 'flex-start', background: '#FFFFFF',
          border: '1px dashed #CBD5E1', borderRadius: 12, padding: '24px 28px',
        }}
      >
        <div style={{ background: '#F1F5F9', borderRadius: 10, padding: 12, flexShrink: 0 }}>
          <Wrench size={22} color="#0A2342" />
        </div>
        <div>
          <h2 style={{ fontSize: 18, color: '#0A2342', margin: '0 0 8px' }}>The boater portal is not available yet</h2>
          <p style={{ color: '#2E4A6B', lineHeight: 1.6, margin: 0 }}>
            We are still connecting the portal to your marina's records, so your invoices, payments, boats and
            requests can't be shown here yet. Please contact your marina office for account questions in the meantime.
          </p>
        </div>
      </div>
    </div>
  );
}
