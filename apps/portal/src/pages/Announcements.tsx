import { Megaphone, AlertTriangle, Calendar, Circle } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const mockAnnouncements = [
  {
    id: 1,
    title: 'Spring Dock Maintenance Schedule',
    body: 'Annual spring maintenance will begin April 5th and run through April 12th. C-Dock and D-Dock power will be intermittently unavailable. Please plan accordingly and secure any sensitive electronics.',
    date: '2026-03-20',
    category: 'Maintenance',
    urgent: false,
    unread: true,
  },
  {
    id: 2,
    title: 'New Fuel Dock Hours Starting April 1',
    body: 'The fuel dock will transition to summer hours beginning April 1st. New hours: 6:00 AM - 8:00 PM daily. Credit card payments accepted at the pump 24/7.',
    date: '2026-03-18',
    category: 'Operations',
    urgent: false,
    unread: true,
  },
  {
    id: 3,
    title: 'Severe Weather Advisory - Secure Your Vessels',
    body: 'The National Weather Service has issued a severe thunderstorm warning for our area through Friday evening. Sustained winds of 45-55 mph expected. Please double-check all dock lines, fenders, and canvas covers. Marina staff will be conducting checks Thursday morning.',
    date: '2026-03-15',
    category: 'Emergency',
    urgent: true,
    unread: false,
  },
  {
    id: 4,
    title: 'Boat Show Weekend - March 8-9',
    body: 'Join us this weekend for the annual Bayview Marina Boat Show! Local dealers will be showcasing new models, and there will be food trucks, live music, and family activities. Parking available in Lot B.',
    date: '2026-03-06',
    category: 'Events',
    urgent: false,
    unread: false,
  },
  {
    id: 5,
    title: 'Updated Marina Rules & Regulations',
    body: 'The board of directors has approved updated Rules & Regulations effective March 1, 2026. Key changes include updated quiet hours (10 PM - 7 AM) and new pet policy. Full document available at the office.',
    date: '2026-03-01',
    category: 'Policy',
    urgent: false,
    unread: false,
  },
  {
    id: 6,
    title: 'New Pump-Out Station Installed on B-Dock',
    body: 'We are pleased to announce a new complimentary pump-out station is now operational at the end of B-Dock. This brings our total to three stations marina-wide.',
    date: '2026-02-22',
    category: 'Improvements',
    urgent: false,
    unread: false,
  },
  {
    id: 7,
    title: 'Annual Insurance Certificate Reminder',
    body: 'Please ensure your current insurance certificate is on file by March 15th. Certificates can be uploaded through the portal or delivered to the office. Failure to provide current proof of insurance may affect your slip status.',
    date: '2026-02-15',
    category: 'Compliance',
    urgent: false,
    unread: false,
  },
  {
    id: 8,
    title: 'Holiday Decorating Contest Winners',
    body: 'Congratulations to our holiday boat decorating contest winners! 1st Place: "Sea Breeze" (Slip C-12), 2nd Place: "Reel Fun" (Slip A-08), 3rd Place: "Nauti Girl" (Slip B-15). Thank you to everyone who participated!',
    date: '2026-01-05',
    category: 'Events',
    urgent: false,
    unread: false,
  },
];

const categoryColors: Record<string, string> = {
  Maintenance: '#8B5CF6',
  Operations: '#3B82F6',
  Emergency: '#DC2626',
  Events: '#F59E0B',
  Policy: '#64748B',
  Improvements: '#0D9F6E',
  Compliance: '#D97706',
};

export default function Announcements() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Announcements</h1>
        <p style={{ color: '#64748B', fontSize: 14 }}>Stay up to date with marina news and updates.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mockAnnouncements.map((a) => (
          <div
            key={a.id}
            style={{
              ...card,
              borderLeft: a.urgent ? '4px solid #DC2626' : a.unread ? `4px solid ${CYAN}` : '4px solid transparent',
              background: a.urgent ? '#FFF5F5' : '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {a.urgent ? (
                  <AlertTriangle size={18} color="#DC2626" />
                ) : (
                  <Megaphone size={18} color={categoryColors[a.category] || '#64748B'} />
                )}
                <h3 style={{ fontSize: 16, fontWeight: 600, color: a.urgent ? '#DC2626' : NAVY, margin: 0 }}>
                  {a.title}
                </h3>
                {a.unread && (
                  <Circle
                    size={8}
                    fill={CYAN}
                    color={CYAN}
                    style={{ flexShrink: 0 }}
                  />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    background: `${categoryColors[a.category] || '#64748B'}18`,
                    color: categoryColors[a.category] || '#64748B',
                  }}
                >
                  {a.category}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 12px 0' }}>
              {a.body}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94A3B8' }}>
              <Calendar size={12} />
              {a.date}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
