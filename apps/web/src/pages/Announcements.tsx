import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
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
} from 'lucide-react';

/* ─── Types ─── */
type AnnouncementStatus = 'Draft' | 'Scheduled' | 'Sent' | 'Failed';
type DeliveryStatus = 'Delivered' | 'Opened' | 'Bounced' | 'Failed';
type Channel = 'Email' | 'SMS' | 'Push' | 'In-App';
type Audience = 'All Customers' | 'Active Only' | 'By Dock' | 'Waitlist' | 'Custom';
type TabName = 'all' | 'compose' | 'templates' | 'delivery';

interface Announcement {
  id: string;
  subject: string;
  channels: Channel[];
  audience: Audience;
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

/* ─── Mock Data ─── */
const mockAnnouncements: Announcement[] = [
  { id: '1', subject: 'Hurricane Season Preparation Notice', channels: ['Email', 'SMS', 'Push'], audience: 'All Customers', sentDate: '2026-03-20', delivered: 342, opened: 289, status: 'Sent' },
  { id: '2', subject: 'March Billing Statements Available', channels: ['Email', 'In-App'], audience: 'Active Only', sentDate: '2026-03-15', delivered: 298, opened: 245, status: 'Sent' },
  { id: '3', subject: 'Dock C Maintenance - March 28-30', channels: ['Email', 'SMS'], audience: 'By Dock', sentDate: '2026-03-18', delivered: 47, opened: 41, status: 'Sent' },
  { id: '4', subject: 'Spring Boat Show & Marina Open House', channels: ['Email', 'Push', 'In-App'], audience: 'All Customers', sentDate: '2026-04-01', delivered: 0, opened: 0, status: 'Scheduled' },
  { id: '5', subject: 'Updated Marina Rules & Regulations', channels: ['Email'], audience: 'All Customers', sentDate: '2026-03-10', delivered: 350, opened: 198, status: 'Sent' },
  { id: '6', subject: 'Weekend Weather Advisory - High Winds', channels: ['SMS', 'Push'], audience: 'Active Only', sentDate: '2026-03-22', delivered: 305, opened: 287, status: 'Sent' },
  { id: '7', subject: 'New Fuel Dock Hours Starting April', channels: ['Email', 'In-App'], audience: 'All Customers', sentDate: '', delivered: 0, opened: 0, status: 'Draft' },
  { id: '8', subject: 'Waitlist Update - Slips Available', channels: ['Email', 'SMS'], audience: 'Waitlist', sentDate: '2026-03-12', delivered: 24, opened: 22, status: 'Sent' },
  { id: '9', subject: 'Annual Rate Adjustment Notice', channels: ['Email'], audience: 'Active Only', sentDate: '2026-03-08', delivered: 0, opened: 0, status: 'Failed' },
  { id: '10', subject: 'Welcome Aboard - New Tenant Orientation', channels: ['Email', 'Push', 'In-App'], audience: 'Custom', sentDate: '2026-03-19', delivered: 12, opened: 10, status: 'Sent' },
];

const mockDeliveryLog: DeliveryRecord[] = [
  { id: '1', announcement: 'Hurricane Season Preparation Notice', customer: 'James Harborview', channel: 'Email', sentAt: '2026-03-20 09:00', status: 'Opened', openedAt: '2026-03-20 09:15' },
  { id: '2', announcement: 'Hurricane Season Preparation Notice', customer: 'Maria Seabreeze', channel: 'SMS', sentAt: '2026-03-20 09:00', status: 'Delivered', openedAt: null },
  { id: '3', announcement: 'Hurricane Season Preparation Notice', customer: 'Robert Dockside', channel: 'Push', sentAt: '2026-03-20 09:01', status: 'Opened', openedAt: '2026-03-20 10:22' },
  { id: '4', announcement: 'March Billing Statements Available', customer: 'Susan Baywatch', channel: 'Email', sentAt: '2026-03-15 08:00', status: 'Bounced', openedAt: null },
  { id: '5', announcement: 'March Billing Statements Available', customer: 'David Tidewater', channel: 'Email', sentAt: '2026-03-15 08:00', status: 'Opened', openedAt: '2026-03-15 08:45' },
  { id: '6', announcement: 'March Billing Statements Available', customer: 'Elena Windward', channel: 'In-App', sentAt: '2026-03-15 08:00', status: 'Opened', openedAt: '2026-03-15 12:30' },
  { id: '7', announcement: 'Dock C Maintenance - March 28-30', customer: 'James Harborview', channel: 'Email', sentAt: '2026-03-18 10:00', status: 'Opened', openedAt: '2026-03-18 10:05' },
  { id: '8', announcement: 'Dock C Maintenance - March 28-30', customer: 'Patricia Williams', channel: 'SMS', sentAt: '2026-03-18 10:00', status: 'Delivered', openedAt: null },
  { id: '9', announcement: 'Weekend Weather Advisory - High Winds', customer: 'Robert Dockside', channel: 'SMS', sentAt: '2026-03-22 06:30', status: 'Delivered', openedAt: null },
  { id: '10', announcement: 'Weekend Weather Advisory - High Winds', customer: 'Thomas Drake', channel: 'Push', sentAt: '2026-03-22 06:30', status: 'Failed', openedAt: null },
  { id: '11', announcement: 'Updated Marina Rules & Regulations', customer: 'Maria Seabreeze', channel: 'Email', sentAt: '2026-03-10 14:00', status: 'Opened', openedAt: '2026-03-11 09:20' },
  { id: '12', announcement: 'Updated Marina Rules & Regulations', customer: 'Blue Horizon Charters', channel: 'Email', sentAt: '2026-03-10 14:00', status: 'Delivered', openedAt: null },
  { id: '13', announcement: 'Waitlist Update - Slips Available', customer: 'Robert Dockside', channel: 'Email', sentAt: '2026-03-12 11:00', status: 'Opened', openedAt: '2026-03-12 11:08' },
  { id: '14', announcement: 'Annual Rate Adjustment Notice', customer: 'David Tidewater', channel: 'Email', sentAt: '2026-03-08 09:00', status: 'Failed', openedAt: null },
  { id: '15', announcement: 'Welcome Aboard - New Tenant Orientation', customer: 'Elena Windward', channel: 'Email', sentAt: '2026-03-19 15:00', status: 'Opened', openedAt: '2026-03-19 15:12' },
];

const mockTemplates: Template[] = [
  { id: '1', title: 'Weather Alert', description: 'Urgent weather notifications for approaching storms, high winds, or severe conditions affecting the marina.', icon: 'weather', subject: 'Weather Alert: [Condition] Expected', body: 'Dear Marina Tenants,\n\nThis is an urgent weather advisory. [Condition details] are expected in the area starting [date/time].\n\nPlease take the following precautions:\n- Secure all loose items on your vessel\n- Double-check mooring lines\n- Remove canvas and bimini tops if possible\n\nMarina staff will be monitoring conditions. Contact the dock office at (555) 000-0000 for assistance.\n\nStay safe,\nMarina Management' },
  { id: '2', title: 'Billing Reminder', description: 'Monthly billing notifications, payment reminders, and account balance updates for slip holders.', icon: 'billing', subject: 'Your [Month] Billing Statement is Ready', body: 'Dear [Customer Name],\n\nYour monthly billing statement for [Month] is now available. Your current balance is $[amount].\n\nPayment is due by [due date]. You can pay online through your tenant portal or contact the marina office.\n\nThank you for your prompt payment.\n\nBest regards,\nMarina Billing Department' },
  { id: '3', title: 'Maintenance Notice', description: 'Planned maintenance alerts for docks, utilities, facilities, and other marina infrastructure.', icon: 'maintenance', subject: 'Scheduled Maintenance: [Area] - [Dates]', body: 'Dear Tenants,\n\nPlease be advised that scheduled maintenance will take place in [area] from [start date] to [end date].\n\nWork details: [description]\n\nDuring this time, [impacts]. We apologize for any inconvenience and appreciate your patience.\n\nIf you have questions, please contact the dock office.\n\nThank you,\nMarina Operations' },
  { id: '4', title: 'Event Invitation', description: 'Marina community events, social gatherings, boat shows, and seasonal celebrations.', icon: 'event', subject: 'You\'re Invited: [Event Name] on [Date]', body: 'Dear Marina Community,\n\nYou are cordially invited to [Event Name]!\n\nDate: [Date]\nTime: [Time]\nLocation: [Location]\n\n[Event description]\n\nPlease RSVP by [deadline] to reserve your spot. We look forward to seeing you there!\n\nCheers,\nMarina Events Team' },
  { id: '5', title: 'Welcome Message', description: 'Onboarding message for new slip holders with essential marina information and contacts.', icon: 'welcome', subject: 'Welcome to [Marina Name]!', body: 'Dear [Customer Name],\n\nWelcome aboard! We\'re thrilled to have you as part of our marina community.\n\nHere are some essentials to get started:\n- Your slip assignment: [Slip #]\n- Gate code: [Code]\n- Office hours: Mon-Fri 8am-5pm, Sat 9am-1pm\n- Emergency contact: (555) 000-0000\n\nPlease review our Marina Rules & Regulations in your welcome packet.\n\nFair winds,\nMarina Management' },
  { id: '6', title: 'Policy Update', description: 'Updates to marina rules, regulations, policies, and operational procedures.', icon: 'policy', subject: 'Important: Updated Marina [Policy Name]', body: 'Dear Tenants,\n\nWe are writing to inform you of updates to our [Policy Name], effective [date].\n\nKey changes include:\n- [Change 1]\n- [Change 2]\n- [Change 3]\n\nThe full updated policy is available at the marina office and on your tenant portal.\n\nIf you have any questions, please don\'t hesitate to reach out.\n\nThank you,\nMarina Management' },
];

/* ─── Helpers ─── */
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

const totalSent = mockAnnouncements.filter(a => a.status === 'Sent').reduce((s, a) => s + a.delivered, 0);
const totalOpened = mockAnnouncements.filter(a => a.status === 'Sent').reduce((s, a) => s + a.opened, 0);
const deliveryRate = totalSent > 0 ? Math.round((totalSent / (totalSent + 12)) * 100) : 0;
const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
const thisMonth = mockAnnouncements.filter(a => a.sentDate.startsWith('2026-03')).length;

/* ─── Styles ─── */
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

  // API calls
  const { data: apiAnnouncements, loading: announcementsLoading } = useApi<Announcement[]>('get', '/api/announcements', { immediate: true });
  const { execute: createAnnouncement, loading: createLoading } = useApi<Announcement>('post', '/api/announcements');

  // Use API data when available, fall back to mock
  const announcements = apiAnnouncements ?? mockAnnouncements;

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

  const handleSend = async () => {
    const payload = {
      subject: composeSubject,
      channels: composeChannels,
      audience: composeAudience,
      body: composeBody,
      scheduled: composeSchedule,
      scheduledDate: composeSchedule ? `${composeDate} ${composeTime}` : null,
    };
    await createAnnouncement(payload);
    setActiveTab('all');
  };

  // Filtered announcements
  const filteredAnnouncements = announcements.filter(a => {
    const matchesSearch = a.subject.toLowerCase().includes(search.toLowerCase());
    const matchesChannel = channelFilter === 'All' || a.channels.includes(channelFilter as Channel);
    return matchesSearch && matchesChannel;
  });

  // Filtered delivery log
  const filteredDelivery = mockDeliveryLog.filter(d => {
    const matchesStatus = deliveryStatusFilter === 'All' || d.status === deliveryStatusFilter;
    return matchesStatus;
  });

  const tabs: { key: TabName; label: string }[] = [
    { key: 'all', label: 'All Announcements' },
    { key: 'compose', label: 'Compose' },
    { key: 'templates', label: 'Templates' },
    { key: 'delivery', label: 'Delivery Log' },
  ];

  return (
    <div style={styles.page}>
      {/* Header */}
      <h1 style={styles.title}>Announcements</h1>
      <hr style={styles.divider} />

      {/* Stats Row */}
      <div style={styles.summaryRow}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}><Send size={22} /></div>
          <div style={styles.summaryLabel}>Total Sent</div>
          <div style={styles.summaryValue}>{totalSent.toLocaleString()}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}><BarChart3 size={22} /></div>
          <div style={styles.summaryLabel}>Delivery Rate</div>
          <div style={styles.summaryValue}>{deliveryRate}%</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}><Eye size={22} /></div>
          <div style={styles.summaryLabel}>Open Rate</div>
          <div style={styles.summaryValue}>{openRate}%</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}><Calendar size={22} /></div>
          <div style={styles.summaryLabel}>This Month</div>
          <div style={styles.summaryValue}>{thisMonth}</div>
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
          <div style={styles.filterBar}>
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
              <option value="Push">Push</option>
              <option value="In-App">In-App</option>
            </select>
            <button style={styles.createBtn} onClick={() => setActiveTab('compose')}>
              <Plus size={16} /> Compose New
            </button>
          </div>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Subject</th>
                <th style={styles.th}>Channel(s)</th>
                <th style={styles.th}>Audience</th>
                <th style={styles.th}>Sent Date</th>
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
                  <td style={styles.td}>{a.sentDate || '\u2014'}</td>
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
        </div>
      )}

      {/* ─── Compose Tab ─── */}
      {activeTab === 'compose' && (
        <div style={styles.formGrid}>
          {/* Left: Form */}
          <div style={styles.formSection}>
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
                {(['Email', 'SMS', 'Push', 'In-App'] as Channel[]).map(ch => (
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
                <option value="By Dock">By Dock</option>
                <option value="Waitlist">Waitlist</option>
                <option value="Custom">Custom</option>
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
              <button style={styles.sendBtn} onClick={handleSend} disabled={createLoading}>
                {composeSchedule ? <Clock size={18} /> : <Send size={18} />}
                {createLoading ? 'Sending...' : composeSchedule ? 'Schedule' : 'Send'}
              </button>
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
          {mockTemplates.map(t => (
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
          <div style={styles.filterBar}>
            <Filter size={16} style={{ color: '#64748B' }} />
            <select
              style={styles.select}
              value={deliveryStatusFilter}
              onChange={e => setDeliveryStatusFilter(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="Delivered">Delivered</option>
              <option value="Opened">Opened</option>
              <option value="Bounced">Bounced</option>
              <option value="Failed">Failed</option>
            </select>
          </div>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Announcement</th>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Channel</th>
                <th style={styles.th}>Sent At</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Opened At</th>
              </tr>
            </thead>
            <tbody>
              {filteredDelivery.map((d, i) => (
                <tr key={d.id} style={{ ...styles.row, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#D6E8F4' }}>
                  <td style={{ ...styles.td, fontWeight: 600, maxWidth: '260px' }}>{d.announcement}</td>
                  <td style={styles.td}>{d.customer}</td>
                  <td style={styles.td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#0A2342' }}>
                      {channelIcon(d.channel)} {d.channel}
                    </span>
                  </td>
                  <td style={styles.td}>{d.sentAt}</td>
                  <td style={styles.td}>
                    <span style={deliveryStatusBadge(d.status)}>{d.status}</span>
                  </td>
                  <td style={styles.td}>{d.openedAt || '\u2014'}</td>
                </tr>
              ))}
              {filteredDelivery.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...styles.td, textAlign: 'center', padding: '32px', color: '#64748B' }}>
                    No delivery records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
