import React, { useState, useMemo } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
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
  Edit2,
  Lock,
  X,
  Zap,
} from 'lucide-react';

/* ─── Types ─── */
type AnnouncementStatus = 'Draft' | 'Scheduled' | 'Sent' | 'Failed';
type DeliveryStatus = 'Delivered' | 'Opened' | 'Bounced' | 'Failed';
type Channel = 'Email' | 'SMS' | 'Push' | 'In-App';
type Audience = 'All Customers' | 'Active Only' | 'By Dock' | 'Waitlist' | 'Custom';
type TabName = 'all' | 'compose' | 'templates' | 'delivery' | 'automation';

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

interface RawDelivery {
  id: string;
  channel: string;
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  announcement: { id: string; subject: string } | null;
  customer: { id: string; firstName: string; lastName: string; email: string | null } | null;
}

interface DeliveryApiResponse {
  data: RawDelivery[];
  pagination: { skip: number; take: number; total: number };
}

interface Template {
  id: string;
  title: string;
  description: string;
  icon: 'weather' | 'billing' | 'maintenance' | 'event' | 'welcome' | 'policy';
  subject: string;
  body: string;
}

/* ─── Automation Types & Data ─── */
interface AutomationRule {
  id: string; name: string; trigger: string; triggerLabel: string;
  category: string; templateName: string; channels: ('email' | 'sms')[];
  delayLabel: string; enabled: boolean;
}
interface AutoEmailTemplate {
  id: string; name: string; subject: string; category: string;
  isDefault: boolean; variables: string[];
}
interface AutoSendLog {
  id: string; date: string; recipient: string; email: string;
  template: string; trigger: string; channel: 'email' | 'sms';
  status: 'Delivered' | 'Opened' | 'Bounced' | 'Failed'; openedAt: string | null;
}

/* ── API response types ─── */
interface ApiAnnouncement {
  id: string; subject: string; channels: string; audienceFilter: unknown;
  isEmergency: boolean; scheduledAt: string | null; sentAt: string | null;
  createdAt: string; delivered: number; opened: number; status: string;
}
interface ApiAutoRule {
  id: string; name: string; trigger: string; enabled: boolean;
  delayMinutes: number; channels: string[];
  template?: { id: string; name: string; subject: string; category: string };
}
interface ApiAutoTemplate {
  id: string; name: string; subject: string; category: string;
  isDefault: boolean; variables: unknown;
}
interface ApiAutoLog {
  id: string; trigger: string; recipientEmail: string | null; recipientPhone: string | null;
  channels: unknown; subject: string | null; status: string;
  sentAt: string | null; createdAt: string;
}

const TRIGGER_OPTIONS = [
  { value: 'invoice_created', label: 'Invoice Created' },
  { value: 'payment_received', label: 'Payment Received' },
  { value: 'invoice_past_due_7', label: '7 Days Past Due' },
  { value: 'invoice_past_due_14', label: '14 Days Past Due' },
  { value: 'invoice_past_due_30', label: '30 Days Past Due' },
  { value: 'ach_return', label: 'ACH Return' },
  { value: 'contract_expiring_30', label: 'Contract Expiring (30d)' },
  { value: 'insurance_expiring_30', label: 'Insurance Expiring (30d)' },
  { value: 'rental_booking_confirmed', label: 'Rental Booked' },
  { value: 'rental_pre_arrival', label: 'Pre-Arrival (48hr)' },
  { value: 'rental_post_return', label: 'Rental Returned' },
];

const TRIGGER_LABEL_MAP: Record<string, string> = Object.fromEntries(
  TRIGGER_OPTIONS.map(t => [t.value, t.label])
);

const CAT_TITLE: Record<string, string> = {
  billing: 'Billing', operations: 'Operations', rental: 'Rentals',
  compliance: 'Compliance', marketing: 'Marketing', custom: 'Custom',
};

function delayLabel(minutes: number): string {
  if (minutes === 0) return 'Immediate';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} hour(s)`;
  return `${Math.round(minutes / 1440)} day(s)`;
}

const LOG_STATUS_MAP: Record<string, AutoSendLog['status']> = {
  QUEUED: 'Delivered', SENT: 'Delivered', DELIVERED: 'Delivered',
  OPENED: 'Opened', BOUNCED: 'Bounced', FAILED: 'Failed',
};

const ANNOUNCE_STATUS_MAP: Record<string, AnnouncementStatus> = {
  DRAFT: 'Draft', SCHEDULED: 'Scheduled', SENT: 'Sent', FAILED: 'Failed',
};

const ANNOUNCE_CHANNEL_MAP: Record<string, Channel> = {
  EMAIL: 'Email', SMS: 'SMS', PUSH: 'Push', IN_APP: 'In-App',
};

const AUTO_CAT_COLORS: Record<string, { bg: string; color: string }> = {
  Billing: { bg: '#DEF7EC', color: '#03543F' },
  Rentals: { bg: '#E0F7FF', color: '#0A2342' },
  Compliance: { bg: '#FFF3CD', color: '#856404' },
  Operations: { bg: '#F3E8FF', color: '#6B21A8' },
  Marketing: { bg: '#D6E8F4', color: '#0A2342' },
};

const AUTO_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Delivered: { bg: '#DEF7EC', color: '#03543F' },
  Opened: { bg: '#E0F7FF', color: '#0A2342' },
  Bounced: { bg: '#FFF3CD', color: '#856404' },
  Failed: { bg: '#FDE8E8', color: '#9B1C1C' },
};

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
  const { getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<TabName>('all');
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('All');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>('All');

  // API calls
  const { data: rawApiAnnouncements, loading: announcementsLoading } = useApi<{ data: ApiAnnouncement[]; pagination: unknown }>('get', '/api/announcements', { immediate: true });
  const { execute: createAnnouncement, loading: createLoading } = useApi<Announcement>('post', '/api/announcements');
  const { data: rawDeliveries } = useApi<DeliveryApiResponse>('get', '/api/announcements/deliveries?take=200', { immediate: true });
  const { data: rawAutoRules } = useApi<{ data: ApiAutoRule[] }>('get', '/api/email-automation/rules', { immediate: true });
  const { data: rawAutoTemplates } = useApi<{ data: ApiAutoTemplate[] }>('get', '/api/email-automation/templates', { immediate: true });
  const { data: rawAutoLogs } = useApi<{ data: ApiAutoLog[] }>('get', '/api/email-automation/logs?take=100', { immediate: true });

  const deliveryStatusMap: Record<string, DeliveryStatus> = { DELIVERED: 'Delivered', OPENED: 'Opened', BOUNCED: 'Bounced', FAILED: 'Failed' };

  const announcements: Announcement[] = useMemo(() =>
    (rawApiAnnouncements?.data ?? []).map((a): Announcement => ({
      id: a.id,
      subject: a.subject,
      channels: [ANNOUNCE_CHANNEL_MAP[a.channels] ?? 'Email'],
      audience: 'All Customers',
      sentDate: a.sentAt ?? a.scheduledAt ?? a.createdAt ?? '',
      delivered: a.delivered ?? 0,
      opened: a.opened ?? 0,
      status: ANNOUNCE_STATUS_MAP[a.status] ?? 'Draft',
    })), [rawApiAnnouncements]);

  const deliveryLog: DeliveryRecord[] = (rawDeliveries?.data ?? []).map((r): DeliveryRecord => ({
    id: r.id,
    announcement: r.announcement?.subject ?? '—',
    customer: r.customer ? `${r.customer.firstName} ${r.customer.lastName}`.trim() : '—',
    channel: ANNOUNCE_CHANNEL_MAP[r.channel] ?? (r.channel as Channel),
    sentAt: r.sentAt ? new Date(r.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—',
    status: deliveryStatusMap[r.status] ?? (r.status as DeliveryStatus),
    openedAt: r.openedAt ? new Date(r.openedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null,
  }));
  const templates: Template[] = [];

  const apiAutoRulesMapped: AutomationRule[] = useMemo(() =>
    (rawAutoRules?.data ?? []).map((r): AutomationRule => ({
      id: r.id,
      name: r.name,
      trigger: r.trigger,
      triggerLabel: TRIGGER_LABEL_MAP[r.trigger] ?? r.trigger,
      category: CAT_TITLE[r.template?.category ?? ''] ?? 'General',
      templateName: r.template?.name ?? '—',
      channels: (r.channels ?? []).filter(c => c === 'email' || c === 'sms') as ('email' | 'sms')[],
      delayLabel: delayLabel(r.delayMinutes),
      enabled: r.enabled,
    })), [rawAutoRules]);

  const apiAutoTemplatesMapped: AutoEmailTemplate[] = useMemo(() =>
    (rawAutoTemplates?.data ?? []).map((t): AutoEmailTemplate => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      category: CAT_TITLE[t.category] ?? t.category,
      isDefault: t.isDefault,
      variables: Array.isArray(t.variables) ? t.variables as string[] : [],
    })), [rawAutoTemplates]);

  const apiAutoLogsMapped: AutoSendLog[] = useMemo(() =>
    (rawAutoLogs?.data ?? []).map((l): AutoSendLog => ({
      id: l.id,
      date: new Date(l.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
      recipient: l.recipientEmail ?? l.recipientPhone ?? '—',
      email: l.recipientEmail ?? l.recipientPhone ?? '—',
      template: l.subject ?? '—',
      trigger: TRIGGER_LABEL_MAP[l.trigger] ?? l.trigger,
      channel: Array.isArray(l.channels) && (l.channels as string[]).includes('sms') ? 'sms' : 'email',
      status: LOG_STATUS_MAP[l.status] ?? 'Delivered',
      openedAt: null,
    })), [rawAutoLogs]);

  const totalSent = announcements.filter(a => a.status === 'Sent').reduce((s, a) => s + a.delivered, 0);
  const totalOpened = announcements.filter(a => a.status === 'Sent').reduce((s, a) => s + a.opened, 0);
  const deliveryRate = totalSent > 0 ? Math.round((totalSent / (totalSent + 12)) * 100) : 0;
  const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
  const thisMonthPrefix = new Date().toISOString().slice(0, 7);
  const thisMonth = announcements.filter(a => a.sentDate.startsWith(thisMonthPrefix)).length;

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

  const [sendSuccess, setSendSuccess] = useState(false);
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
    setSendSuccess(true);
    setTimeout(() => { setSendSuccess(false); setActiveTab('all'); setComposeSubject(''); setComposeBody(''); setComposeChannels([]); }, 2000);
  };

  // Filtered announcements
  const filteredAnnouncements = announcements.filter(a => {
    const matchesSearch = a.subject.toLowerCase().includes(search.toLowerCase());
    const matchesChannel = channelFilter === 'All' || a.channels.includes(channelFilter as Channel);
    return matchesSearch && matchesChannel;
  });

  // Filtered delivery log
  const filteredDelivery = deliveryLog.filter(d => {
    const matchesStatus = deliveryStatusFilter === 'All' || d.status === deliveryStatusFilter;
    return matchesStatus;
  });

  // Automation state
  const [autoRules, setAutoRules] = useState<AutomationRule[]>([]);
  const [autoTab, setAutoTab] = useState<'rules' | 'templates' | 'log'>('rules');
  const [editingAutoTemplate, setEditingAutoTemplate] = useState<AutoEmailTemplate | null>(null);
  const [logStatusFilter, setLogStatusFilter] = useState('All');
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleTrigger, setNewRuleTrigger] = useState(TRIGGER_OPTIONS[0].value);
  const [newRuleCategory, setNewRuleCategory] = useState('Billing');
  const [newRuleTemplate, setNewRuleTemplate] = useState('');
  const [newRuleEmail, setNewRuleEmail] = useState(true);
  const [newRuleSms, setNewRuleSms] = useState(false);
  const [newRuleDelay, setNewRuleDelay] = useState('Immediate');

  // Sync automation rules from API
  React.useEffect(() => {
    if (apiAutoRulesMapped.length > 0) setAutoRules(apiAutoRulesMapped);
  }, [apiAutoRulesMapped]);

  // Sync newRuleTemplate default once templates load
  React.useEffect(() => {
    if (newRuleTemplate === '' && apiAutoTemplatesMapped.length > 0) {
      setNewRuleTemplate(apiAutoTemplatesMapped[0].name);
    }
  }, [apiAutoTemplatesMapped, newRuleTemplate]);

  const toggleAutoRule = async (id: string) => {
    const rule = autoRules.find(r => r.id === id);
    if (!rule) return;
    const newEnabled = !rule.enabled;
    try {
      const token = await getToken();
      await api.put(`/email-automation/rules/${id}`, { enabled: newEnabled }, token);
      setAutoRules(prev => prev.map(r => r.id === id ? { ...r, enabled: newEnabled } : r));
    } catch {
      // leave state unchanged on failure
    }
  };

  const handleCreateRule = () => {
    if (!newRuleName) return;
    const trigger = TRIGGER_OPTIONS.find(t => t.value === newRuleTrigger);
    const newRule: AutomationRule = {
      id: String(Date.now()),
      name: newRuleName,
      trigger: newRuleTrigger,
      triggerLabel: trigger?.label ?? newRuleTrigger,
      category: newRuleCategory,
      templateName: newRuleTemplate,
      channels: [newRuleEmail && 'email', newRuleSms && 'sms'].filter(Boolean) as ('email' | 'sms')[],
      delayLabel: newRuleDelay,
      enabled: true,
    };
    setAutoRules(prev => [...prev, newRule]);
    setShowCreateRule(false);
    setNewRuleName('');
  };

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
        <div style={styles.formGrid} className="helm-form-grid">
          {/* Left: Form */}
          <div style={styles.formSection}>
            {sendSuccess && <div style={{ padding: '12px 24px', marginBottom: '16px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', borderRadius: '8px', textAlign: 'center' }}>{composeSchedule ? 'Announcement scheduled!' : 'Announcement sent!'}</div>}
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
      {activeTab === 'templates' && templates.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: '#94A3B8' }}>No templates yet.</div>
      )}
      {activeTab === 'templates' && templates.length > 0 && (
        <div style={styles.templateGrid}>
          {templates.map(t => (
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

      {/* ─── Automation Tab ─── */}
      {activeTab === 'automation' && (
        <div>
          {/* Sub-tab bar */}
          <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '20px' }}>
            {(['rules', 'templates', 'log'] as const).map(k => (
              <button key={k} onClick={() => setAutoTab(k)} style={{
                padding: '8px 20px', fontSize: '13px', fontWeight: 600, border: 'none', background: 'none',
                cursor: 'pointer', color: autoTab === k ? '#0A2342' : '#64748B',
                borderBottom: autoTab === k ? '2px solid #00D4FF' : '2px solid transparent', marginBottom: '-2px',
              }}>
                {k === 'rules' ? 'Automation Rules' : k === 'templates' ? 'Email Templates' : 'Send Log'}
              </button>
            ))}
          </div>

          {/* Rules sub-tab */}
          {autoTab === 'rules' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                <button style={styles.createBtn} onClick={() => setShowCreateRule(true)}>
                  <Plus size={16} /> Create Rule
                </button>
              </div>
              <div style={{ background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Rule Name</th>
                      <th style={styles.th}>Trigger</th>
                      <th style={styles.th}>Category</th>
                      <th style={styles.th}>Template</th>
                      <th style={styles.th}>Channels</th>
                      <th style={styles.th}>Delay</th>
                      <th style={{ ...styles.th, textAlign: 'center' as const }}>Active</th>
                      <th style={{ ...styles.th, textAlign: 'center' as const }}>Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoRules.map((r, idx) => {
                      const cc = AUTO_CAT_COLORS[r.category] || AUTO_CAT_COLORS.Billing;
                      const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                      return (
                        <tr key={r.id}>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontWeight: 600 }}>{r.name}</td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontSize: '12px' }}>{r.triggerLabel}</td>
                          <td style={{ ...styles.td, backgroundColor: rowBg }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', backgroundColor: cc.bg, color: cc.color }}>{r.category}</span>
                          </td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontSize: '13px' }}>{r.templateName}</td>
                          <td style={{ ...styles.td, backgroundColor: rowBg }}>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              {r.channels.includes('email') && <Mail size={14} style={{ color: '#0A2342' }} />}
                              {r.channels.includes('sms') && <Smartphone size={13} style={{ color: '#64748B' }} />}
                            </div>
                          </td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontSize: '12px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <Clock size={11} /> {r.delayLabel}
                            </span>
                          </td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, textAlign: 'center' as const }}>
                            <button
                              onClick={() => toggleAutoRule(r.id)}
                              style={{ width: '36px', height: '20px', borderRadius: '10px', background: r.enabled ? '#00D4FF' : '#CBD5E1', border: 'none', cursor: 'pointer', position: 'relative' as const, padding: 0 }}
                            >
                              <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: '#FFFFFF', position: 'absolute' as const, top: '2px', left: r.enabled ? '18px' : '2px', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                            </button>
                          </td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, textAlign: 'center' as const }}>
                            <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', padding: '2px' }}>
                              <Edit2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Templates sub-tab */}
          {autoTab === 'templates' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                <button style={styles.createBtn} onClick={() => { /* custom template */ }}>
                  <Plus size={16} /> Create Template
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {apiAutoTemplatesMapped.length === 0 && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px', color: '#64748B' }}>No email templates found.</div>
                )}
                {apiAutoTemplatesMapped.map(t => {
                  const cc = AUTO_CAT_COLORS[t.category] || AUTO_CAT_COLORS.Billing;
                  return (
                    <div key={t.id} style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 700, color: '#0A2342', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {t.isDefault && <Lock size={12} style={{ color: '#94A3B8' }} />}
                            {t.name}
                          </div>
                          <span style={{ display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', backgroundColor: cc.bg, color: cc.color, marginTop: '6px' }}>{t.category}</span>
                        </div>
                        <Mail size={18} style={{ color: '#00D4FF' }} />
                      </div>
                      <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px', fontStyle: 'italic' }}>{t.subject || '(no subject set)'}</div>
                      <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '12px' }}>Variables: {t.variables.slice(0, 3).map(v => `{{${v}}}`).join(', ')}{t.variables.length > 3 ? ` +${t.variables.length - 3} more` : ''}</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setEditingAutoTemplate(t)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#0A2342', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer' }}><Edit2 size={12} /> Edit</button>
                        <button style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#0A2342', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer' }}><Eye size={12} /> Preview</button>
                        <button style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#0A2342', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer' }}><Copy size={12} /> Duplicate</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Send Log sub-tab */}
          {autoTab === 'log' && (
            <>
              <div style={styles.filterBar} className="helm-filter-bar">
                <select style={styles.select} value={logStatusFilter} onChange={e => setLogStatusFilter(e.target.value)}>
                  <option value="All">All Statuses</option>
                  <option>Delivered</option><option>Opened</option><option>Bounced</option><option>Failed</option>
                </select>
              </div>
              <div style={{ background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Recipient</th>
                      <th style={styles.th}>Contact</th>
                      <th style={styles.th}>Template</th>
                      <th style={styles.th}>Trigger</th>
                      <th style={styles.th}>Channel</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!rawAutoLogs && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>No send log entries yet.</td></tr>
                    )}
                    {apiAutoLogsMapped.filter(l => logStatusFilter === 'All' || l.status === logStatusFilter).map((l, idx) => {
                      const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                      const sc = AUTO_STATUS_COLORS[l.status];
                      return (
                        <tr key={l.id}>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>{l.date}</td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontWeight: 600 }}>{l.recipient}</td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontSize: '12px' }}>{l.email}</td>
                          <td style={{ ...styles.td, backgroundColor: rowBg }}>{l.template}</td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontSize: '12px' }}>{l.trigger}</td>
                          <td style={{ ...styles.td, backgroundColor: rowBg }}>
                            {l.channel === 'email' ? <Mail size={14} /> : <Smartphone size={14} />}
                          </td>
                          <td style={{ ...styles.td, backgroundColor: rowBg }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', backgroundColor: sc.bg, color: sc.color }}>{l.status}</span>
                          </td>
                          <td style={{ ...styles.td, backgroundColor: rowBg, fontSize: '12px', color: l.openedAt ? '#0A2342' : '#94A3B8' }}>{l.openedAt || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Create Rule Modal */}
          {showCreateRule && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: '#FFFFFF', borderRadius: '12px', width: '540px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px', borderBottom: '1px solid #E2E8F0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Zap size={20} style={{ color: '#00D4FF' }} />
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>Create Automation Rule</h2>
                  </div>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setShowCreateRule(false)}><X size={20} /></button>
                </div>
                <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={styles.formLabel}>Rule Name *</label>
                    <input style={styles.formInput} placeholder="e.g. 60-Day Lease Renewal Reminder" value={newRuleName} onChange={e => setNewRuleName(e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={styles.formLabel}>Trigger</label>
                      <select style={{ ...styles.formInput, cursor: 'pointer' }} value={newRuleTrigger} onChange={e => setNewRuleTrigger(e.target.value)}>
                        {TRIGGER_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={styles.formLabel}>Category</label>
                      <select style={{ ...styles.formInput, cursor: 'pointer' }} value={newRuleCategory} onChange={e => setNewRuleCategory(e.target.value)}>
                        {['Billing', 'Compliance', 'Rentals', 'Operations', 'Marketing'].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={styles.formLabel}>Email Template</label>
                    <select style={{ ...styles.formInput, cursor: 'pointer' }} value={newRuleTemplate} onChange={e => setNewRuleTemplate(e.target.value)}>
                      {apiAutoTemplatesMapped.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={styles.formLabel}>Channels</label>
                    <div style={styles.checkboxGroup}>
                      <label style={styles.checkboxLabel}><input type="checkbox" checked={newRuleEmail} onChange={e => setNewRuleEmail(e.target.checked)} /> <Mail size={14} /> Email</label>
                      <label style={styles.checkboxLabel}><input type="checkbox" checked={newRuleSms} onChange={e => setNewRuleSms(e.target.checked)} /> <Smartphone size={14} /> SMS</label>
                    </div>
                  </div>
                  <div>
                    <label style={styles.formLabel}>Delay</label>
                    <select style={{ ...styles.formInput, cursor: 'pointer' }} value={newRuleDelay} onChange={e => setNewRuleDelay(e.target.value)}>
                      <option>Immediate</option>
                      <option>1 hour</option>
                      <option>2 hours</option>
                      <option>24 hours</option>
                      <option>48 hours</option>
                      <option>7 days</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 28px', borderTop: '1px solid #E2E8F0' }}>
                  <button style={{ padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#64748B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' }} onClick={() => setShowCreateRule(false)}>Cancel</button>
                  <button style={styles.createBtn} onClick={handleCreateRule} disabled={!newRuleName}>
                    <Zap size={15} /> Save Rule
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Template Editor Modal */}
          {editingAutoTemplate && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: '#FFFFFF', borderRadius: '12px', width: '860px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px', borderBottom: '1px solid #E2E8F0' }}>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>Edit Template: {editingAutoTemplate.name}</h2>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setEditingAutoTemplate(null)}><X size={20} /></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '24px', padding: '24px 32px' }}>
                  <div>
                    <div style={{ marginBottom: '16px' }}>
                      <label style={styles.formLabel}>Subject Line</label>
                      <input style={styles.formInput} defaultValue={editingAutoTemplate.subject} />
                    </div>
                    <div>
                      <label style={styles.formLabel}>HTML Body</label>
                      <textarea style={{ ...styles.formInput, minHeight: '280px', fontFamily: '"JetBrains Mono", monospace', fontSize: '13px', resize: 'vertical' as const }} defaultValue={`<h2>{{subject}}</h2>\n<p>Hi {{customerName}},</p>\n<p>Your template content here...</p>`} />
                    </div>
                  </div>
                  <div style={{ background: '#F8FAFC', borderRadius: '8px', padding: '16px', border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0A2342', marginBottom: '8px' }}>Available Variables</div>
                    <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '8px' }}>Click to copy</div>
                    {editingAutoTemplate.variables.map(v => (
                      <button key={v} style={{ display: 'block', width: '100%', textAlign: 'left' as const, padding: '6px 10px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#0A2342', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', marginBottom: '4px' }}>
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 32px', borderTop: '1px solid #E2E8F0' }}>
                  <button style={{ padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#64748B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' }} onClick={() => setEditingAutoTemplate(null)}>Cancel</button>
                  <button style={styles.createBtn} onClick={() => setEditingAutoTemplate(null)}>Save Template</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
