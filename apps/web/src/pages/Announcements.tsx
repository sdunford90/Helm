import { useState } from 'react';
import {
  Megaphone,
  Plus,
  Search,
  Send,
  Mail,
  MessageSquare,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Copy,
  X,
  Users,
  Eye,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type Channel = 'EMAIL' | 'SMS' | 'BOTH';
type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'OPENED';

interface Announcement {
  id: string;
  title: string;
  body: string;
  channel: Channel;
  isEmergency: boolean;
  sentAt: string | null;
  scheduledFor: string | null;
  recipientCount: number;
  deliveredCount: number;
  openedCount: number;
  failedCount: number;
  createdBy: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: '1', title: 'Marina Maintenance — Dock B', body: 'Dock B will be closed for maintenance March 28-30. Please relocate your vessel temporarily.',
    channel: 'BOTH', isEmergency: false, sentAt: '2026-03-25 09:00', scheduledFor: null,
    recipientCount: 45, deliveredCount: 42, openedCount: 28, failedCount: 3, createdBy: 'Sarah Chen',
  },
  {
    id: '2', title: 'Storm Warning — Secure Your Vessel', body: 'A severe storm warning has been issued for tonight. Please secure all lines, remove canvas, and take necessary precautions.',
    channel: 'BOTH', isEmergency: true, sentAt: '2026-03-24 14:30', scheduledFor: null,
    recipientCount: 120, deliveredCount: 118, openedCount: 95, failedCount: 2, createdBy: 'Mike Torres',
  },
  {
    id: '3', title: 'Spring Social — April 5th', body: 'Join us for our annual Spring Social! Food, music, and fun for the whole family. RSVP by April 1st.',
    channel: 'EMAIL', isEmergency: false, sentAt: '2026-03-20 10:00', scheduledFor: null,
    recipientCount: 120, deliveredCount: 115, openedCount: 67, failedCount: 5, createdBy: 'Sarah Chen',
  },
  {
    id: '4', title: 'New Fuel Dock Hours', body: 'Starting April 1st, the fuel dock will be open 7am-7pm daily (extended from 8am-5pm).',
    channel: 'EMAIL', isEmergency: false, sentAt: null, scheduledFor: '2026-03-28 08:00',
    recipientCount: 120, deliveredCount: 0, openedCount: 0, failedCount: 0, createdBy: 'Sarah Chen',
  },
];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute' as const, left: '10px', color: '#2E4A6B', pointerEvents: 'none' as const },
  searchInput: { padding: '8px 12px 8px 34px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', width: '220px', outline: 'none' },
  select: { padding: '8px 32px 8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', appearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', cursor: 'pointer', minWidth: '140px' },
  spacer: { flex: 1 },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' },
  metricCard: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  metricLabel: { fontSize: '13px', color: '#64748B', margin: '0 0 4px 0' },
  metricValue: { fontSize: '28px', fontWeight: 700, color: '#0A2342', margin: 0 },
  card: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '16px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' },
  cardTitle: { fontSize: '17px', fontWeight: 600, color: '#0A2342', margin: '0 0 4px 0' },
  cardBody: { fontSize: '14px', color: '#64748B', lineHeight: 1.6, margin: '0 0 16px 0' },
  cardMeta: { fontSize: '13px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px', margin: '4px 0' },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, lineHeight: '18px' },
  deliveryBar: { display: 'flex', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #E2E8F0' },
  deliveryStat: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' },
  modal: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { background: '#FFF', borderRadius: '12px', padding: '32px', width: '600px', maxHeight: '80vh', overflow: 'auto' },
  modalTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: '0 0 24px 0' },
  formGroup: { marginBottom: '16px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '4px' },
  input: { width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '6px', boxSizing: 'border-box' as const },
  textarea: { width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '6px', boxSizing: 'border-box' as const, minHeight: '120px', resize: 'vertical' as const, fontFamily: 'inherit' },
  channelBtn: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', border: '1px solid #CCC', borderRadius: '6px', background: '#FFF', cursor: 'pointer', fontSize: '14px', fontWeight: 600 },
  channelBtnActive: { borderColor: '#0A2342', backgroundColor: '#D6E8F4', color: '#0A2342' },
};

const CHANNEL_ICONS: Record<Channel, typeof Mail> = { EMAIL: Mail, SMS: MessageSquare, BOTH: Megaphone };

/* ── Component ─────────────────────────────────────────── */

export default function Announcements() {
  const [search, setSearch] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [channel, setChannel] = useState<Channel>('BOTH');
  const [isEmergency, setIsEmergency] = useState(false);

  const totalSent = MOCK_ANNOUNCEMENTS.filter((a) => a.sentAt).length;
  const totalRecipients = MOCK_ANNOUNCEMENTS.reduce((s, a) => s + a.recipientCount, 0);
  const totalDelivered = MOCK_ANNOUNCEMENTS.reduce((s, a) => s + a.deliveredCount, 0);
  const avgOpenRate = totalDelivered > 0
    ? Math.round((MOCK_ANNOUNCEMENTS.reduce((s, a) => s + a.openedCount, 0) / totalDelivered) * 10000) / 100
    : 0;

  const filtered = MOCK_ANNOUNCEMENTS.filter((a) =>
    !search || a.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={s.page}>
      <h1 style={s.title}>Announcements</h1>
      <hr style={s.divider} />

      {/* Metrics */}
      <div style={s.metricGrid}>
        <div style={s.metricCard}><p style={s.metricLabel}>Sent</p><p style={s.metricValue}>{totalSent}</p></div>
        <div style={s.metricCard}><p style={s.metricLabel}>Total Recipients</p><p style={s.metricValue}>{totalRecipients}</p></div>
        <div style={s.metricCard}><p style={s.metricLabel}>Delivered</p><p style={s.metricValue}>{totalDelivered}</p></div>
        <div style={s.metricCard}><p style={s.metricLabel}>Open Rate</p><p style={s.metricValue}>{avgOpenRate}%</p></div>
      </div>

      {/* Actions */}
      <div style={s.filterBar}>
        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input style={s.searchInput} placeholder="Search announcements..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={s.spacer} />
        <button style={s.primaryBtn} onClick={() => setShowCompose(true)}>
          <Plus size={16} /> Compose Announcement
        </button>
      </div>

      {/* Announcement List */}
      {filtered.map((ann) => {
        const ChannelIcon = CHANNEL_ICONS[ann.channel];
        return (
          <div key={ann.id} style={{ ...s.card, borderLeft: ann.isEmergency ? '4px solid #DC2626' : '4px solid transparent' }}>
            <div style={s.cardHeader}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={s.cardTitle}>{ann.title}</h3>
                  {ann.isEmergency && <span style={{ ...s.badge, backgroundColor: '#FDECEA', color: '#B71C1C' }}>EMERGENCY</span>}
                </div>
                <p style={s.cardBody}>{ann.body}</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ ...s.badge, backgroundColor: '#D6E8F4', color: '#0A2342' }}>
                  <ChannelIcon size={11} /> {ann.channel}
                </span>
                {ann.sentAt && <span style={{ ...s.badge, backgroundColor: '#E8F5E9', color: '#1B5E20' }}>Sent</span>}
                {!ann.sentAt && ann.scheduledFor && <span style={{ ...s.badge, backgroundColor: '#FFF3CD', color: '#856404' }}>Scheduled</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
              <span style={s.cardMeta}>
                <Clock size={14} />
                {ann.sentAt ? `Sent ${ann.sentAt}` : `Scheduled ${ann.scheduledFor}`}
              </span>
              <span style={s.cardMeta}><Users size={14} /> {ann.recipientCount} recipients</span>
              <span style={s.cardMeta}>by {ann.createdBy}</span>
            </div>

            {ann.sentAt && (
              <div style={s.deliveryBar}>
                <span style={{ ...s.deliveryStat, color: '#1B5E20' }}><CheckCircle size={14} /> {ann.deliveredCount} delivered</span>
                <span style={{ ...s.deliveryStat, color: '#0369A1' }}><Eye size={14} /> {ann.openedCount} opened</span>
                <span style={{ ...s.deliveryStat, color: '#B71C1C' }}><XCircle size={14} /> {ann.failedCount} failed</span>
                <span style={{ ...s.deliveryStat, color: '#64748B' }}>
                  {ann.deliveredCount > 0 ? Math.round((ann.openedCount / ann.deliveredCount) * 100) : 0}% open rate
                </span>
              </div>
            )}
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>
          No announcements match your search.
        </div>
      )}

      {/* Compose Modal */}
      {showCompose && (
        <div style={s.modal} onClick={() => setShowCompose(false)}>
          <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={s.modalTitle}>Compose Announcement</h2>
              <button onClick={() => setShowCompose(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            <div style={s.formGroup}>
              <label style={s.label}>Title</label>
              <input style={s.input} placeholder="Announcement title..." />
            </div>

            <div style={s.formGroup}>
              <label style={s.label}>Message</label>
              <textarea style={s.textarea} placeholder="Write your announcement..." />
            </div>

            <div style={s.formGroup}>
              <label style={s.label}>Delivery Channel</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['EMAIL', 'SMS', 'BOTH'] as Channel[]).map((ch) => (
                  <button key={ch} style={{ ...s.channelBtn, ...(channel === ch ? s.channelBtnActive : {}) }} onClick={() => setChannel(ch)}>
                    {ch === 'EMAIL' ? <Mail size={16} /> : ch === 'SMS' ? <MessageSquare size={16} /> : <Megaphone size={16} />}
                    {ch === 'BOTH' ? 'Email + SMS' : ch}
                  </button>
                ))}
              </div>
            </div>

            <div style={s.formGroup}>
              <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} />
                <AlertTriangle size={14} color="#DC2626" />
                Mark as Emergency
              </label>
            </div>

            <div style={s.formGroup}>
              <label style={s.label}>Audience</label>
              <select style={{ ...s.input, ...s.select }}>
                <option>All Customers</option>
                <option>Active Slip Holders</option>
                <option>Liveaboards</option>
                <option>Transient Guests</option>
                <option>Waitlist</option>
              </select>
            </div>

            <div style={s.formGroup}>
              <label style={s.label}>Schedule (optional)</label>
              <input style={s.input} type="datetime-local" />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button style={s.primaryBtn} onClick={() => setShowCompose(false)}>
                <Send size={16} /> Send Now
              </button>
              <button style={{ ...s.primaryBtn, backgroundColor: '#FFF', color: '#0A2342', border: '1px solid #0A2342' }} onClick={() => setShowCompose(false)}>
                <Clock size={16} /> Schedule
              </button>
              <button style={{ ...s.primaryBtn, backgroundColor: '#FFF', color: '#64748B', border: '1px solid #CCC' }} onClick={() => setShowCompose(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
