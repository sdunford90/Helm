import React, { useState } from 'react';
import { useApiClient, useList, useResource } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { customerName, type CustomerRef } from '../lib/dto';
import { formatDateTime, humanizeEnum, toDateKey } from '../lib/format';
import { ErrorState, InlineError, LoadingState, NotAvailable } from '../components/StateViews';
import { useToast } from '../components/Toast';
import {
  Megaphone,
  Search,
  Plus,
  Mail,
  Smartphone,
  Bell,
  MessageSquare,
  Send,
  Clock,
  CloudLightning,
  DollarSign,
  Wrench,
  CalendarDays,
  Heart,
  FileText,
  Eye,
  BarChart3,
  Calendar,
  Filter,
  Copy,
  Edit2,
  Lock,
  X,
  Zap,
} from 'lucide-react';

/* ─── Types ─── */
type AnnouncementStatus = 'Draft' | 'Scheduled' | 'Sent' | 'Failed';
type DeliveryStatus = 'Pending' | 'Sent' | 'Delivered' | 'Opened' | 'Bounced' | 'Failed';
type Channel = 'Email' | 'SMS' | 'Push' | 'In-App';
type Audience = 'All Customers' | 'Active Only' | 'Slip Holders' | 'Waitlist';
type TabName = 'all' | 'compose' | 'templates' | 'delivery' | 'automation';

interface Announcement {
  id: string;
  subject: string;
  channels: Channel[];
  audience: string;
  sentDate: string;
  delivered: number;
  opened: number;
  status: AnnouncementStatus;
}

interface DeliveryRecord {
  id: string;
  announcement: string;
  customer: string;
  channel: Channel;
  sentAt: string;
  status: DeliveryStatus;
  openedAt: string | null;
}

interface Template {
  id: string;
  title: string;
  description: string;
  icon: 'weather' | 'billing' | 'maintenance' | 'event' | 'welcome' | 'policy';
  subject: string;
  body: string;
}


/* ─── API mapping ─── */

interface AnnouncementDTO {
  id: string;
  subject: string;
  channels: 'EMAIL' | 'SMS' | 'BOTH';
  audienceFilter?: { audience?: string } | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  status: 'DRAFT' | 'SCHEDULED' | 'SENT';
  recipientCount: number;
  deliveryStats?: { sent: number; delivered: number; failed: number; opened: number; pending: number };
}

interface DeliveryDTO {
  id: string;
  channel: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'OPENED';
  openedAt?: string | null;
  customer?: CustomerRef | null;
}

const AUDIENCE_ENUM: Record<Audience, string> = {
  'All Customers': 'all', 'Active Only': 'active_customers', 'Slip Holders': 'slip_holders', Waitlist: 'waitlist',
};
const AUDIENCE_LABEL: Record<string, string> = Object.fromEntries(Object.entries(AUDIENCE_ENUM).map(([k, v]) => [v, k]));

function toAnnouncement(a: AnnouncementDTO): Announcement {
  const failed = a.deliveryStats?.failed ?? 0;
  return {
    id: a.id,
    subject: a.subject,
    channels: a.channels === 'BOTH' ? ['Email', 'SMS'] : a.channels === 'SMS' ? ['SMS'] : ['Email'],
    audience: AUDIENCE_LABEL[a.audienceFilter?.audience ?? ''] ?? humanizeEnum(a.audienceFilter?.audience ?? 'all'),
    sentDate: a.sentAt ?? a.scheduledAt ?? '',
    delivered: a.deliveryStats?.delivered ?? 0,
    opened: a.deliveryStats?.opened ?? 0,
    // Status is the server's: SENT only when the API recorded sentAt.
    status: a.status === 'SENT' ? (failed > 0 && failed === a.recipientCount ? 'Failed' : 'Sent') : a.status === 'SCHEDULED' ? 'Scheduled' : 'Draft',
  };
}

const DELIVERY_LABEL: Record<DeliveryDTO['status'], DeliveryStatus> = {
  PENDING: 'Pending', SENT: 'Sent', DELIVERED: 'Delivered', FAILED: 'Failed', OPENED: 'Opened',
};

/** Starter message text. These are built-in drafts, not customer data. */
const STARTER_TEMPLATES: Template[] = [
  { id: '1', title: 'Weather Alert', description: 'Urgent weather notifications for approaching storms, high winds, or severe conditions affecting the marina.', icon: 'weather', subject: 'Weather Alert: [Condition] Expected', body: 'Dear Marina Tenants,\n\nThis is an urgent weather advisory. [Condition details] are expected in the area starting [date/time].\n\nPlease take the following precautions:\n- Secure all loose items on your vessel\n- Double-check mooring lines\n- Remove canvas and bimini tops if possible\n\nMarina staff will be monitoring conditions. Contact the dock office at (555) 000-0000 for assistance.\n\nStay safe,\nMarina Management' },
  { id: '2', title: 'Billing Reminder', description: 'Monthly billing notifications, payment reminders, and account balance updates for slip holders.', icon: 'billing', subject: 'Your [Month] Billing Statement is Ready', body: 'Dear [Customer Name],\n\nYour monthly billing statement for [Month] is now available. Your current balance is $[amount].\n\nPayment is due by [due date]. You can pay online through your tenant portal or contact the marina office.\n\nThank you for your prompt payment.\n\nBest regards,\nMarina Billing Department' },
  { id: '3', title: 'Maintenance Notice', description: 'Planned maintenance alerts for docks, utilities, facilities, and other marina infrastructure.', icon: 'maintenance', subject: 'Scheduled Maintenance: [Area] - [Dates]', body: 'Dear Tenants,\n\nPlease be advised that scheduled maintenance will take place in [area] from [start date] to [end date].\n\nWork details: [description]\n\nDuring this time, [impacts]. We apologize for any inconvenience and appreciate your patience.\n\nIf you have questions, please contact the dock office.\n\nThank you,\nMarina Operations' },
  { id: '4', title: 'Event Invitation', description: 'Marina community events, social gatherings, boat shows, and seasonal celebrations.', icon: 'event', subject: 'You\'re Invited: [Event Name] on [Date]', body: 'Dear Marina Community,\n\nYou are cordially invited to [Event Name]!\n\nDate: [Date]\nTime: [Time]\nLocation: [Location]\n\n[Event description]\n\nPlease RSVP by [deadline] to reserve your spot. We look forward to seeing you there!\n\nCheers,\nMarina Events Team' },
  { id: '5', title: 'Welcome Message', description: 'Onboarding message for new slip holders with essential marina information and contacts.', icon: 'welcome', subject: 'Welcome to [Marina Name]!', body: 'Dear [Customer Name],\n\nWelcome aboard! We\'re thrilled to have you as part of our marina community.\n\nHere are some essentials to get started:\n- Your slip assignment: [Slip #]\n- Gate code: [Code]\n- Office hours: Mon-Fri 8am-5pm, Sat 9am-1pm\n- Emergency contact: (555) 000-0000\n\nPlease review our Marina Rules & Regulations in your welcome packet.\n\nFair winds,\nMarina Management' },
  { id: '6', title: 'Policy Update', description: 'Updates to marina rules, regulations, policies, and operational procedures.', icon: 'policy', subject: 'Important: Updated Marina [Policy Name]', body: 'Dear Tenants,\n\nWe are writing to inform you of updates to our [Policy Name], effective [date].\n\nKey changes include:\n- [Change 1]\n- [Change 2]\n- [Change 3]\n\nThe full updated policy is available at the marina office and on your tenant portal.\n\nIf you have any questions, please don\'t hesitate to reach out.\n\nThank you,\nMarina Management' },
];

/* ─── Automation Types & Data ─── */
const channelIcon = (ch: Channel, size = 16) => {
  switch (ch) {
    case 'Email': return <Mail size={size} />;
    case 'SMS': return <Smartphone size={size} />;
    case 'Push': return <Bell size={size} />;
    case 'In-App': return <MessageSquare size={size} />;
  }
};

const templateIcon = (icon: Template['icon']) => {
  switch (icon) {
    case 'weather': return <CloudLightning size={28} />;
    case 'billing': return <DollarSign size={28} />;
    case 'maintenance': return <Wrench size={28} />;
    case 'event': return <CalendarDays size={28} />;
    case 'welcome': return <Heart size={28} />;
    case 'policy': return <FileText size={28} />;
  }
};

function announcementStatusBadge(status: AnnouncementStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  };
  switch (status) {
    case 'Draft': return { ...base, backgroundColor: '#E2E8F0', color: '#64748B' };
    case 'Scheduled': return { ...base, backgroundColor: '#DBEAFE', color: '#1E40AF' };
    case 'Sent': return { ...base, backgroundColor: '#E8F5E9', color: '#1B5E20' };
    case 'Failed': return { ...base, backgroundColor: '#FDECEA', color: '#B71C1C' };
    default: return base;
  }
}

function deliveryStatusBadge(status: DeliveryStatus): React.CSSProperties {
  if (status === 'Pending' || status === 'Sent') {
    return { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600, backgroundColor: '#F2F4F6', color: '#334155' };
  }
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  };
  switch (status) {
    case 'Delivered': return { ...base, backgroundColor: '#E8F5E9', color: '#1B5E20' };
    case 'Opened': return { ...base, backgroundColor: '#E0F7FA', color: '#00838F' };
    case 'Bounced': return { ...base, backgroundColor: '#FFF3E0', color: '#E65100' };
    case 'Failed': return { ...base, backgroundColor: '#FDECEA', color: '#B71C1C' };
    default: return base;
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px', marginBottom: '32px' },
  summaryCard: { backgroundColor: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  summaryLabel: { fontSize: '13px', fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' },
  summaryValue: { fontSize: '28px', fontWeight: 700, color: '#0A2342', lineHeight: 1.2 },
  summaryIcon: { marginBottom: '8px', color: '#00D4FF' },
  tabBar: { display: 'flex', gap: '0px', marginBottom: '24px', borderBottom: '2px solid #E2E8F0' },
  tab: { padding: '12px 24px', fontSize: '14px', fontWeight: 600, color: '#64748B', cursor: 'pointer', border: 'none', background: 'none', borderBottom: '2px solid transparent', marginBottom: '-2px', transition: 'all 0.15s' },
  tabActive: { padding: '12px 24px', fontSize: '14px', fontWeight: 600, color: '#0A2342', cursor: 'pointer', border: 'none', background: 'none', borderBottom: '2px solid #00D4FF', marginBottom: '-2px' },
  filterBar: { display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' as const },
  select: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342', backgroundColor: '#FFFFFF', cursor: 'pointer', minWidth: '140px' },
  searchWrap: { position: 'relative' as const, flex: 1, minWidth: '200px' },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342', boxSizing: 'border-box' as const },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' as const },
  createBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', marginLeft: 'auto', whiteSpace: 'nowrap' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', whiteSpace: 'nowrap' as const },
  thRight: { textAlign: 'right' as const, padding: '12px 16px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  td: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342' },
  tdRight: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342', textAlign: 'right' as const, fontSize: '13px' },
  row: { transition: 'background-color 0.15s' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' },
  formSection: { display: 'flex', flexDirection: 'column' as const, gap: '20px' },
  formLabel: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '6px' },
  formInput: { width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342', boxSizing: 'border-box' as const },
  formTextarea: { width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342', boxSizing: 'border-box' as const, minHeight: '180px', resize: 'vertical' as const, fontFamily: 'inherit' },
  checkboxGroup: { display: 'flex', gap: '16px', flexWrap: 'wrap' as const },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: '#0A2342', cursor: 'pointer' },
  previewPanel: { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '24px' },
  previewHeader: { fontSize: '16px', fontWeight: 700, color: '#0A2342', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #E2E8F0' },
  previewSubject: { fontSize: '18px', fontWeight: 600, color: '#0A2342', marginBottom: '12px' },
  previewMeta: { fontSize: '12px', color: '#64748B', marginBottom: '16px' },
  previewBody: { fontSize: '14px', color: '#334155', lineHeight: '1.6', whiteSpace: 'pre-wrap' as const },
  sendBtn: { display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 28px', fontSize: '15px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', marginTop: '8px' },
  scheduleRow: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' },
  templateGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' },
  templateCard: { backgroundColor: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  templateIconWrap: { width: '48px', height: '48px', borderRadius: '12px', backgroundColor: '#E0F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00838F' },
  templateTitle: { fontSize: '16px', fontWeight: 700, color: '#0A2342', margin: 0 },
  templateDesc: { fontSize: '13px', color: '#64748B', lineHeight: '1.5', flex: 1 },
  templateBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #0A2342', borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start' },
};

/* ─── Component ─── */
export default function Announcements() {
  const [activeTab, setActiveTab] = useState<TabName>('all');
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('All');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>('All');

  const client = useApiClient();
  const toast = useToast();
  const list = useList<Announcement, AnnouncementDTO>('/announcements?take=100', { map: toAnnouncement });
  const announcements = list.items;
  const stats = useResource<{ totalSentThisMonth: number; deliveryRate: number; openRate: number; scheduledCount: number }>('/announcements/stats');

  // Compose form state
  const [composeSubject, setComposeSubject] = useState('');
  const [composeChannels, setComposeChannels] = useState<Channel[]>([]);
  const [composeAudience, setComposeAudience] = useState<Audience>('All Customers');
  const [composeBody, setComposeBody] = useState('');
  const [composeSchedule, setComposeSchedule] = useState(false);
  const [composeDate, setComposeDate] = useState('');
  const [composeTime, setComposeTime] = useState('');

  const toggleChannel = (ch: Channel) => {
    setComposeChannels(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
    );
  };

  const loadTemplate = (t: Template) => {
    setComposeSubject(t.subject);
    setComposeBody(t.body);
    setActiveTab('compose');
  };

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const composeProblem =
    !composeSubject.trim() ? 'Add a subject.'
      : !composeBody.trim() ? 'Add a message body.'
        : composeChannels.length === 0 ? 'Choose at least one channel.'
          : composeSchedule && !composeDate ? 'Choose a date to schedule for.'
            : null;

  const handleSend = async () => {
    if (composeProblem || sending) return;
    setSending(true);
    setSendError(null);
    setSendResult(null);
    const channel = composeChannels.includes('Email') && composeChannels.includes('SMS') ? 'BOTH' : composeChannels.includes('SMS') ? 'SMS' : 'EMAIL';
    let created: AnnouncementDTO | null = null;
    try {
      created = await client.post<AnnouncementDTO>('/announcements', {
        title: composeSubject.trim(),
        body: composeBody,
        channel,
        audience: AUDIENCE_ENUM[composeAudience],
        scheduledAt: composeSchedule ? new Date(`${composeDate}T${composeTime || '09:00'}`).toISOString() : null,
      });
      if (composeSchedule) {
        setSendResult(`Saved as scheduled for ${composeDate}${composeTime ? ' ' + composeTime : ''}.`);
      } else {
        const sent = await client.post<{ recipientCount: number }>(`/announcements/${created.id}/send`);
        setSendResult(`Sent to ${sent.recipientCount} recipient${sent.recipientCount === 1 ? '' : 's'}.`);
        toast.success('Announcement sent', `${sent.recipientCount} recipients`);
      }
      setComposeSubject(''); setComposeBody(''); setComposeChannels([]);
      list.refetch();
      stats.refetch();
    } catch (err) {
      setSendError(created ? `The announcement was saved as a draft, but sending failed: ${errorMessage(err)}` : errorMessage(err));
      if (created) list.refetch();
    } finally {
      setSending(false);
    }
  };

  // Filtered announcements
  const filteredAnnouncements = announcements.filter(a => {
    const matchesSearch = a.subject.toLowerCase().includes(search.toLowerCase());
    const matchesChannel = channelFilter === 'All' || a.channels.includes(channelFilter as Channel);
    return matchesSearch && matchesChannel;
  });

  // Delivery log: per announcement, from GET /announcements/:id/deliveries
  const sentAnnouncements = announcements.filter((a) => a.status === 'Sent' || a.status === 'Failed');
  const [deliveryAnnouncementId, setDeliveryAnnouncementId] = useState('');
  const deliveries = useList<DeliveryDTO>(
    activeTab === 'delivery' && deliveryAnnouncementId ? `/announcements/${deliveryAnnouncementId}/deliveries?take=100` : null,
  );
  const filteredDelivery = deliveries.items.filter((d) => deliveryStatusFilter === 'All' || DELIVERY_LABEL[d.status] === deliveryStatusFilter);

  const tabs: { key: TabName; label: string }[] = [
    { key: 'all', label: 'All Announcements' },
    { key: 'compose', label: 'Compose' },
    { key: 'templates', label: 'Templates' },
    { key: 'delivery', label: 'Delivery Log' },
    { key: 'automation', label: 'Automation' },
  ];

  return (
    <div style={styles.page}>
      {/* Header */}
      <h1 style={styles.title} className="helm-page-title">Announcements</h1>
      <hr style={styles.divider} />

      {/* Stats Row */}
      <div style={styles.summaryRow} className="helm-stats-grid">
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}><Send size={22} /></div>
          <div style={styles.summaryLabel}>Sent This Month</div>
          <div style={styles.summaryValue}>{stats.data ? stats.data.totalSentThisMonth.toLocaleString() : '—'}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}><BarChart3 size={22} /></div>
          <div style={styles.summaryLabel}>Delivery Rate</div>
          <div style={styles.summaryValue}>{stats.data ? `${stats.data.deliveryRate}%` : '—'}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}><Eye size={22} /></div>
          <div style={styles.summaryLabel}>Open Rate</div>
          <div style={styles.summaryValue}>{stats.data ? `${stats.data.openRate}%` : '—'}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}><Calendar size={22} /></div>
          <div style={styles.summaryLabel}>Scheduled</div>
          <div style={styles.summaryValue}>{stats.data ? stats.data.scheduledCount : '—'}</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={styles.tabBar}>
        {tabs.map(t => (
          <button
            key={t.key}
            style={activeTab === t.key ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── All Announcements Tab ─── */}
      {activeTab === 'all' && (
        <div>
          <div style={styles.filterBar} className="helm-filter-bar">
            <div style={styles.searchWrap}>
              <Search size={16} style={styles.searchIcon} />
              <input
                style={styles.searchInput}
                placeholder="Search announcements..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              style={styles.select}
              value={channelFilter}
              onChange={e => setChannelFilter(e.target.value)}
            >
              <option value="All">All Channels</option>
              <option value="Email">Email</option>
              <option value="SMS">SMS</option>
            </select>
            <button style={styles.createBtn} onClick={() => setActiveTab('compose')}>
              <Plus size={16} /> Compose New
            </button>
          </div>

          {list.loading ? <LoadingState label="Loading announcements…" /> : list.error ? <ErrorState title="Could not load announcements" message={list.error} onRetry={list.refetch} /> : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Subject</th>
                <th style={styles.th}>Channel(s)</th>
                <th style={styles.th}>Audience</th>
                <th style={styles.th}>Sent / Scheduled</th>
                <th style={styles.thRight}>Delivered</th>
                <th style={styles.thRight}>Opened</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredAnnouncements.map((a, i) => (
                <tr key={a.id} style={{ ...styles.row, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#D6E8F4' }}>
                  <td style={{ ...styles.td, fontWeight: 600, maxWidth: '300px' }}>{a.subject}</td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {a.channels.map(ch => (
                        <span key={ch} title={ch} style={{ display: 'inline-flex', color: '#0A2342' }}>
                          {channelIcon(ch)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={styles.td}>{a.audience}</td>
                  <td style={styles.td}>{a.sentDate ? formatDateTime(a.sentDate) : '\u2014'}</td>
                  <td style={styles.tdRight}>{a.delivered.toLocaleString()}</td>
                  <td style={styles.tdRight}>{a.opened.toLocaleString()}</td>
                  <td style={styles.td}>
                    <span style={announcementStatusBadge(a.status)}>{a.status}</span>
                  </td>
                </tr>
              ))}
              {filteredAnnouncements.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...styles.td, textAlign: 'center', padding: '32px', color: '#64748B' }}>
                    No announcements found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
        </div>
      )}

      {/* ─── Compose Tab ─── */}
      {activeTab === 'compose' && (
        <div style={styles.formGrid} className="helm-form-grid">
          {/* Left: Form */}
          <div style={styles.formSection}>
            {sendResult && <div role="status" style={{ padding: '12px 24px', marginBottom: '16px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', borderRadius: '8px', textAlign: 'center' }}>{sendResult}</div>}
            {sendError && <div style={{ marginBottom: 16 }}><InlineError message={sendError} /></div>}
            <div>
              <label style={styles.formLabel}>Subject Line</label>
              <input
                style={styles.formInput}
                placeholder="Enter announcement subject..."
                value={composeSubject}
                onChange={e => setComposeSubject(e.target.value)}
              />
            </div>

            <div>
              <label style={styles.formLabel}>Channels</label>
              <div style={styles.checkboxGroup}>
                {(['Email', 'SMS'] as Channel[]).map(ch => (
                  <label key={ch} style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={composeChannels.includes(ch)}
                      onChange={() => toggleChannel(ch)}
                    />
                    <span style={{ display: 'inline-flex', color: '#0A2342' }}>{channelIcon(ch, 14)}</span>
                    {ch}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label style={styles.formLabel}>Audience</label>
              <select
                style={styles.select}
                value={composeAudience}
                onChange={e => setComposeAudience(e.target.value as Audience)}
              >
                <option value="All Customers">All Customers</option>
                <option value="Active Only">Active Only</option>
                <option value="Slip Holders">Slip Holders</option>
                <option value="Waitlist">Waitlist</option>
              </select>
            </div>

            <div>
              <label style={styles.formLabel}>Message Body</label>
              <textarea
                style={styles.formTextarea}
                placeholder="Write your announcement message..."
                value={composeBody}
                onChange={e => setComposeBody(e.target.value)}
              />
            </div>

            <div>
              <label style={styles.formLabel}>Schedule</label>
              <div style={styles.scheduleRow}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="radio"
                    name="schedule"
                    checked={!composeSchedule}
                    onChange={() => setComposeSchedule(false)}
                  />
                  Send Now
                </label>
                <label style={styles.checkboxLabel}>
                  <input
                    type="radio"
                    name="schedule"
                    checked={composeSchedule}
                    onChange={() => setComposeSchedule(true)}
                  />
                  Schedule for Later
                </label>
              </div>
              {composeSchedule && (
                <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                  <input
                    type="date"
                    style={styles.formInput}
                    value={composeDate}
                    min={toDateKey(new Date())}
                    onChange={e => setComposeDate(e.target.value)}
                  />
                  <input
                    type="time"
                    style={styles.formInput}
                    value={composeTime}
                    onChange={e => setComposeTime(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div>
              <button style={{ ...styles.sendBtn, opacity: composeProblem || sending ? 0.6 : 1 }} onClick={handleSend} disabled={!!composeProblem || sending} title={composeProblem ?? undefined}>
                {composeSchedule ? <Clock size={18} /> : <Send size={18} />}
                {sending ? 'Sending...' : composeSchedule ? 'Schedule' : 'Send'}
              </button>
              {composeProblem && (composeSubject || composeBody) && <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>{composeProblem}</div>}
            </div>
          </div>

          {/* Right: Preview Panel */}
          <div style={styles.previewPanel}>
            <div style={styles.previewHeader}>Preview</div>
            {composeSubject || composeBody ? (
              <>
                <div style={styles.previewSubject}>{composeSubject || '(No subject)'}</div>
                <div style={styles.previewMeta}>
                  {composeChannels.length > 0
                    ? `Via: ${composeChannels.join(', ')}`
                    : 'No channels selected'}
                  {' \u00B7 '}
                  {composeAudience}
                  {composeSchedule && composeDate
                    ? ` \u00B7 Scheduled: ${composeDate}${composeTime ? ' ' + composeTime : ''}`
                    : ' \u00B7 Send immediately'}
                </div>
                <div style={styles.previewBody}>{composeBody || '(No message body)'}</div>
              </>
            ) : (
              <div style={{ color: '#94A3B8', fontSize: '14px', padding: '32px 0', textAlign: 'center' as const }}>
                Start composing to see a preview of your announcement.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Templates Tab ─── */}
      {activeTab === 'templates' && (
        <div style={styles.templateGrid}>
          {STARTER_TEMPLATES.map(t => (
            <div key={t.id} style={styles.templateCard}>
              <div style={styles.templateIconWrap}>{templateIcon(t.icon)}</div>
              <h3 style={styles.templateTitle}>{t.title}</h3>
              <p style={styles.templateDesc}>{t.description}</p>
              <button style={styles.templateBtn} onClick={() => loadTemplate(t)}>
                <Copy size={14} /> Use Template
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ─── Delivery Log Tab ─── */}
      {activeTab === 'delivery' && (
        <div>
          <div style={styles.filterBar} className="helm-filter-bar">
            <Filter size={16} style={{ color: '#64748B' }} />
            <select
              style={styles.select}
              value={deliveryAnnouncementId}
              onChange={e => setDeliveryAnnouncementId(e.target.value)}
            >
              <option value="">Select a sent announcement…</option>
              {sentAnnouncements.map((a) => <option key={a.id} value={a.id}>{a.subject}</option>)}
            </select>
            <select
              style={styles.select}
              value={deliveryStatusFilter}
              onChange={e => setDeliveryStatusFilter(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Sent">Sent</option>
              <option value="Delivered">Delivered</option>
              <option value="Opened">Opened</option>
              <option value="Failed">Failed</option>
            </select>
          </div>

          {!deliveryAnnouncementId ? (
            <div style={{ color: '#64748B', fontSize: 14, padding: '24px 0' }}>Choose an announcement to see its deliveries.</div>
          ) : deliveries.loading ? <LoadingState /> : deliveries.error ? <ErrorState message={deliveries.error} onRetry={deliveries.refetch} /> : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Contact</th>
                <th style={styles.th}>Channel</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Opened At</th>
              </tr>
            </thead>
            <tbody>
              {filteredDelivery.map((d, i) => (
                <tr key={d.id} style={{ ...styles.row, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#D6E8F4' }}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{customerName(d.customer)}</td>
                  <td style={styles.td}>{d.channel === 'SMS' ? d.customer?.phone ?? '—' : d.customer?.email ?? '—'}</td>
                  <td style={styles.td}>{humanizeEnum(d.channel)}</td>
                  <td style={styles.td}>
                    <span style={deliveryStatusBadge(DELIVERY_LABEL[d.status])}>{DELIVERY_LABEL[d.status]}</span>
                  </td>
                  <td style={styles.td}>{d.openedAt ? formatDateTime(d.openedAt) : '\u2014'}</td>
                </tr>
              ))}
              {filteredDelivery.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...styles.td, textAlign: 'center', padding: '32px', color: '#64748B' }}>
                    No delivery records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
        </div>
      )}

      {/* ─── Automation Tab ─── */}
      {activeTab === 'automation' && (
        <NotAvailable
          title="Email automation is not available yet"
          message="Automated rules, templates and the send log need the email-automation API, which is not mounted on the server yet. Nothing configured here would run, so the editor is withdrawn until it is."
        />
      )}
    </div>
  );
}
