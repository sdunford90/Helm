import React, { useState } from 'react';
import {
  Mail, Search, Plus, X, Play, Pause, Eye, Copy,
  Clock, Check, Send, Edit2, Lock, ChevronRight,
  AlertTriangle, FileText, DollarSign, Ship, Shield,
  Users, Megaphone, Zap,
} from 'lucide-react';
import { useToast } from '../components/Toast';

/* ── Types ─────────────────────────────────────────────── */

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  triggerLabel: string;
  category: string;
  templateName: string;
  channels: ('email' | 'sms')[];
  delayLabel: string;
  enabled: boolean;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  category: string;
  isDefault: boolean;
  variables: string[];
}

interface SendLogEntry {
  id: string;
  date: string;
  recipient: string;
  email: string;
  template: string;
  trigger: string;
  channel: 'email' | 'sms';
  status: 'Delivered' | 'Opened' | 'Bounced' | 'Failed';
  openedAt: string | null;
}

/* ── Mock Data ─────────────────────────────────────────── */

const RULES: AutomationRule[] = [
  { id: '1', name: 'Invoice Notification', trigger: 'invoice_created', triggerLabel: 'Invoice Created', category: 'Billing', templateName: 'Invoice Generated', channels: ['email'], delayLabel: 'Immediate', enabled: true },
  { id: '2', name: 'Payment Receipt', trigger: 'payment_received', triggerLabel: 'Payment Received', category: 'Billing', templateName: 'Payment Receipt', channels: ['email'], delayLabel: 'Immediate', enabled: true },
  { id: '3', name: 'ACH Return Alert', trigger: 'ach_return', triggerLabel: 'ACH Return', category: 'Billing', templateName: 'ACH Return Notice', channels: ['email', 'sms'], delayLabel: 'Immediate', enabled: true },
  { id: '4', name: '7-Day Past Due Reminder', trigger: 'invoice_past_due_7', triggerLabel: '7 Days Past Due', category: 'Billing', templateName: 'Past Due Reminder', channels: ['email', 'sms'], delayLabel: 'Immediate', enabled: true },
  { id: '5', name: '14-Day Final Notice', trigger: 'invoice_past_due_14', triggerLabel: '14 Days Past Due', category: 'Billing', templateName: 'Final Notice', channels: ['email', 'sms'], delayLabel: 'Immediate', enabled: true },
  { id: '6', name: '30-Day Collections Warning', trigger: 'invoice_past_due_30', triggerLabel: '30 Days Past Due', category: 'Billing', templateName: 'Collections Warning', channels: ['email'], delayLabel: 'Immediate', enabled: true },
  { id: '7', name: 'Contract Renewal Notice', trigger: 'contract_expiring_30', triggerLabel: 'Contract Expiring (30d)', category: 'Compliance', templateName: 'Contract Renewal', channels: ['email'], delayLabel: 'Immediate', enabled: true },
  { id: '8', name: 'Insurance Expiry Alert', trigger: 'insurance_expiring_30', triggerLabel: 'Insurance Expiring (30d)', category: 'Compliance', templateName: 'Document Expiry', channels: ['email', 'sms'], delayLabel: 'Immediate', enabled: true },
  { id: '9', name: 'Booking Confirmation', trigger: 'rental_booking_confirmed', triggerLabel: 'Rental Booked', category: 'Rentals', templateName: 'Booking Confirmation', channels: ['email', 'sms'], delayLabel: 'Immediate', enabled: true },
  { id: '10', name: 'Pre-Arrival Reminder', trigger: 'rental_pre_arrival', triggerLabel: 'Pre-Arrival (48hr)', category: 'Rentals', templateName: 'Rental Reminder', channels: ['email', 'sms'], delayLabel: '48 hours', enabled: true },
  { id: '11', name: 'Rental Agreement Signature', trigger: 'rental_booking_confirmed', triggerLabel: 'Rental Booked', category: 'Rentals', templateName: 'Rental Agreement', channels: ['email'], delayLabel: '1 hour', enabled: true },
  { id: '12', name: 'Post-Rental Thank You', trigger: 'rental_post_return', triggerLabel: 'Rental Returned', category: 'Rentals', templateName: 'Post-Rental Thank You', channels: ['email'], delayLabel: '24 hours', enabled: true },
];

const TEMPLATES: EmailTemplate[] = [
  { id: '1', name: 'Invoice Generated', subject: 'Invoice {{invoiceNumber}} — {{amount}} Due', category: 'Billing', isDefault: true, variables: ['customerName', 'invoiceNumber', 'amount', 'dueDate', 'portalUrl'] },
  { id: '2', name: 'Payment Receipt', subject: 'Payment Received — {{amount}}', category: 'Billing', isDefault: true, variables: ['customerName', 'amount', 'method', 'invoiceNumber'] },
  { id: '3', name: 'ACH Return Notice', subject: 'ACH Payment Returned — Action Required', category: 'Billing', isDefault: true, variables: ['customerName', 'amount', 'reason'] },
  { id: '4', name: 'Past Due Reminder', subject: 'Payment Overdue — Invoice {{invoiceNumber}}', category: 'Billing', isDefault: true, variables: ['customerName', 'invoiceNumber', 'amount', 'daysOverdue', 'portalUrl'] },
  { id: '5', name: 'Document Expiry', subject: 'Your {{documentType}} Expires {{expiryDate}}', category: 'Compliance', isDefault: true, variables: ['customerName', 'documentType', 'expiryDate', 'portalUrl'] },
  { id: '6', name: 'Booking Confirmation', subject: 'Booking Confirmed — {{productName}} on {{date}}', category: 'Rentals', isDefault: true, variables: ['customerName', 'productName', 'date', 'timeSlot', 'duration', 'totalAmount', 'confirmationNumber', 'portalUrl'] },
  { id: '7', name: 'Contract Signature Required', subject: 'Contract Ready for Signature — {{slipNumber}}', category: 'Compliance', isDefault: true, variables: ['customerName', 'contractType', 'slipNumber', 'startDate', 'endDate', 'monthlyRate', 'signingUrl'] },
  { id: '8', name: 'Rental Reminder', subject: 'Your Rental is Tomorrow — {{productName}}', category: 'Rentals', isDefault: true, variables: ['customerName', 'productName', 'date', 'timeSlot', 'checkInTime', 'confirmationNumber', 'marinaAddress'] },
  { id: '9', name: 'Rental Agreement', subject: 'Rental Agreement — Signature Required', category: 'Rentals', isDefault: true, variables: ['customerName', 'productName', 'date', 'duration', 'waiverType', 'depositAmount', 'signingUrl'] },
  { id: '10', name: 'Post-Rental Thank You', subject: 'Thanks for Renting with Us!', category: 'Rentals', isDefault: true, variables: ['customerName', 'productName', 'date', 'npsUrl', 'reviewUrl'] },
  { id: '11', name: 'Contract Renewal', subject: 'Contract Renewal Notice — {{slipNumber}}', category: 'Compliance', isDefault: true, variables: ['customerName', 'slipNumber', 'currentEndDate', 'newRate', 'rateChange', 'renewalDeadline', 'portalUrl'] },
  { id: '12', name: 'Announcement', subject: '{{subject}}', category: 'Marketing', isDefault: true, variables: ['subject', 'body', 'marinaName'] },
  { id: '13', name: 'Welcome', subject: 'Welcome to {{marinaName}}!', category: 'Marketing', isDefault: true, variables: ['customerName', 'marinaName', 'portalUrl'] },
  { id: '14', name: 'Violation Notice', subject: 'Dock Inspection — Action Required', category: 'Operations', isDefault: true, variables: ['customerName', 'slipNumber', 'violationType', 'description', 'severity'] },
  { id: '15', name: 'Custom Marketing', subject: '', category: 'Marketing', isDefault: false, variables: ['customerName', 'marinaName', 'portalUrl'] },
];

const SEND_LOG: SendLogEntry[] = [
  { id: '1', date: '2026-03-25 11:42', recipient: 'James Harborview', email: 'james@email.com', template: 'Payment Receipt', trigger: 'Payment Received', channel: 'email', status: 'Opened', openedAt: '2026-03-25 12:10' },
  { id: '2', date: '2026-03-25 11:42', recipient: 'James Harborview', email: '(555) 234-5678', template: 'Payment Receipt', trigger: 'Payment Received', channel: 'sms', status: 'Delivered', openedAt: null },
  { id: '3', date: '2026-03-25 09:00', recipient: 'Maria Seabreeze', email: 'maria@email.com', template: 'Invoice Generated', trigger: 'Invoice Created', channel: 'email', status: 'Opened', openedAt: '2026-03-25 09:45' },
  { id: '4', date: '2026-03-24 16:30', recipient: 'Elena Windward', email: 'elena@email.com', template: 'Rental Reminder', trigger: 'Pre-Arrival', channel: 'email', status: 'Opened', openedAt: '2026-03-24 17:15' },
  { id: '5', date: '2026-03-24 16:30', recipient: 'Elena Windward', email: '(555) 345-6789', template: 'Rental Reminder', trigger: 'Pre-Arrival', channel: 'sms', status: 'Delivered', openedAt: null },
  { id: '6', date: '2026-03-24 14:00', recipient: 'David Tidewater', email: 'david@email.com', template: 'Document Expiry', trigger: 'Insurance Expiring', channel: 'email', status: 'Delivered', openedAt: null },
  { id: '7', date: '2026-03-24 10:15', recipient: 'Robert Chen', email: 'robert@email.com', template: 'Booking Confirmation', trigger: 'Rental Booked', channel: 'email', status: 'Opened', openedAt: '2026-03-24 10:22' },
  { id: '8', date: '2026-03-24 10:15', recipient: 'Robert Chen', email: '(555) 456-7890', template: 'Booking Confirmation', trigger: 'Rental Booked', channel: 'sms', status: 'Delivered', openedAt: null },
  { id: '9', date: '2026-03-23 09:00', recipient: 'Coastal Charters LLC', email: 'billing@coastal.com', template: 'Invoice Generated', trigger: 'Invoice Created', channel: 'email', status: 'Bounced', openedAt: null },
  { id: '10', date: '2026-03-23 08:00', recipient: 'Tom Seaside', email: 'tom@email.com', template: 'Past Due Reminder', trigger: '7 Days Past Due', channel: 'email', status: 'Opened', openedAt: '2026-03-23 10:30' },
  { id: '11', date: '2026-03-22 15:00', recipient: 'Amy Portview', email: 'amy@email.com', template: 'Contract Renewal', trigger: 'Contract Expiring', channel: 'email', status: 'Opened', openedAt: '2026-03-22 16:45' },
  { id: '12', date: '2026-03-22 12:00', recipient: 'Mike Anchorage', email: 'mike@email.com', template: 'Post-Rental Thank You', trigger: 'Rental Returned', channel: 'email', status: 'Delivered', openedAt: null },
  { id: '13', date: '2026-03-22 09:30', recipient: 'Lisa Bayfront', email: 'lisa@email.com', template: 'Rental Agreement', trigger: 'Rental Booked', channel: 'email', status: 'Opened', openedAt: '2026-03-22 09:48' },
  { id: '14', date: '2026-03-21 14:00', recipient: 'Carlos Rivera', email: 'carlos@email.com', template: 'ACH Return Notice', trigger: 'ACH Return', channel: 'email', status: 'Failed', openedAt: null },
  { id: '15', date: '2026-03-21 14:00', recipient: 'Carlos Rivera', email: '(555) 567-8901', template: 'ACH Return Notice', trigger: 'ACH Return', channel: 'sms', status: 'Delivered', openedAt: null },
];

/* ── Styles ─────────────────────────────────────────────── */

const catColors: Record<string, { bg: string; color: string }> = {
  Billing: { bg: '#DEF7EC', color: '#03543F' },
  Rentals: { bg: '#E0F7FF', color: '#0A2342' },
  Compliance: { bg: '#FFF3CD', color: '#856404' },
  Operations: { bg: '#F3E8FF', color: '#6B21A8' },
  Marketing: { bg: '#D6E8F4', color: '#0A2342' },
};

const statusColors: Record<string, { bg: string; color: string }> = {
  Delivered: { bg: '#DEF7EC', color: '#03543F' },
  Opened: { bg: '#E0F7FF', color: '#0A2342' },
  Bounced: { bg: '#FFF3CD', color: '#856404' },
  Failed: { bg: '#FDE8E8', color: '#9B1C1C' },
};

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '22px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '12px', color: '#2E4A6B', marginTop: '2px' },
  tabs: { display: 'flex', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' as const },
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 14px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '10px 14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px' },
  toggle: { width: '36px', height: '20px', borderRadius: '10px', cursor: 'pointer', position: 'relative' as const, border: 'none', padding: 0 },
  toggleThumb: { width: '16px', height: '16px', borderRadius: '50%', background: '#FFFFFF', position: 'absolute' as const, top: '2px', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' },
  templateGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' },
  templateCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
};

/* ── Component ─────────────────────────────────────────── */

type Tab = 'rules' | 'templates' | 'log';

export default function EmailAutomation() {
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState(RULES);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [logStatusFilter, setLogStatusFilter] = useState('All');
  const toast = useToast();

  const activeRules = rules.filter((r) => r.enabled).length;
  const delivered = SEND_LOG.filter((l) => l.status === 'Delivered' || l.status === 'Opened').length;
  const opened = SEND_LOG.filter((l) => l.status === 'Opened').length;
  const openRate = delivered > 0 ? Math.round((opened / delivered) * 100) : 0;

  const toggleRule = (id: string) => {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r));
    const rule = rules.find((r) => r.id === id);
    toast.success(rule?.enabled ? 'Rule Disabled' : 'Rule Enabled', rule?.name);
  };

  const tabItems: { key: Tab; label: string }[] = [
    { key: 'rules', label: 'Automation Rules' },
    { key: 'templates', label: 'Email Templates' },
    { key: 'log', label: 'Send Log' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Email Automation</h1>
      <hr style={st.divider} />

      <div style={st.statsRow} className="helm-stats-grid">
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Active Rules</div>
          <div style={st.statValue}>{activeRules}</div>
          <div style={st.statSub}>{rules.length} total configured</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Emails Sent (30d)</div>
          <div style={st.statValue}>{SEND_LOG.length}</div>
          <div style={st.statSub}>{SEND_LOG.filter((l) => l.channel === 'sms').length} SMS</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Open Rate</div>
          <div style={st.statValue}>{openRate}%</div>
          <div style={st.statSub}>{opened} opened of {delivered} delivered</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Templates</div>
          <div style={st.statValue}>{TEMPLATES.length}</div>
          <div style={st.statSub}>{TEMPLATES.filter((t) => t.isDefault).length} system + {TEMPLATES.filter((t) => !t.isDefault).length} custom</div>
        </div>
      </div>

      <div style={st.tabs} className="helm-tabs">
        {tabItems.map((t) => <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {/* Rules */}
      {tab === 'rules' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar"><div style={{ flex: 1 }} /><button style={st.addBtn} onClick={() => toast.info('Create Rule', 'Rule creation form opening...')}><Plus size={16} /> Create Rule</button></div>
          <div style={st.tableWrap} className="helm-table-wrap"><table style={st.table}><thead><tr>
            <th style={st.th}>Name</th><th style={st.th}>Trigger</th><th style={st.th}>Category</th><th style={st.th}>Template</th><th style={st.th}>Channels</th><th style={st.th}>Delay</th><th style={st.th}>Status</th><th style={st.th}>Actions</th>
          </tr></thead><tbody>
            {rules.map((r, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const cc = catColors[r.category] || catColors.Billing; return (
              <tr key={r.id}>
                <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{r.name}</td>
                <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px' }}>{r.triggerLabel}</td>
                <td style={{ ...st.td, backgroundColor: rowBg }}><span style={{ ...st.badge, backgroundColor: cc.bg, color: cc.color }}>{r.category}</span></td>
                <td style={{ ...st.td, backgroundColor: rowBg }}>{r.templateName}</td>
                <td style={{ ...st.td, backgroundColor: rowBg }}>
                  {r.channels.includes('email') && <Mail size={14} style={{ color: '#0A2342', marginRight: '6px' }} />}
                  {r.channels.includes('sms') && <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748B' }}>SMS</span>}
                </td>
                <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px' }}><Clock size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />{r.delayLabel}</td>
                <td style={{ ...st.td, backgroundColor: rowBg }}>
                  <button style={{ ...st.toggle, background: r.enabled ? '#00D4FF' : '#CBD5E1' }} onClick={() => toggleRule(r.id)}>
                    <div style={{ ...st.toggleThumb, left: r.enabled ? '18px' : '2px' }} />
                  </button>
                </td>
                <td style={{ ...st.td, backgroundColor: rowBg }}>
                  <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer' }}><Edit2 size={14} /></button>
                </td>
              </tr>
            ); })}
          </tbody></table></div>
        </>
      )}

      {/* Templates */}
      {tab === 'templates' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar"><div style={{ flex: 1 }} /><button style={st.addBtn} onClick={() => toast.info('Create Template', 'Template editor opening...')}><Plus size={16} /> Create Template</button></div>
          <div style={st.templateGrid}>
            {TEMPLATES.map((t) => { const cc = catColors[t.category] || catColors.Billing; return (
              <div key={t.id} style={st.templateCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#0A2342', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {t.isDefault && <Lock size={12} style={{ color: '#94A3B8' }} />}
                      {t.name}
                    </div>
                    <span style={{ ...st.badge, backgroundColor: cc.bg, color: cc.color, marginTop: '6px' }}>{t.category}</span>
                  </div>
                  <Mail size={18} style={{ color: '#00D4FF' }} />
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px', fontStyle: 'italic' }}>{t.subject || '(no subject set)'}</div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '12px' }}>Variables: {t.variables.slice(0, 3).map((v) => `{{${v}}}`).join(', ')}{t.variables.length > 3 ? ` +${t.variables.length - 3} more` : ''}</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#0A2342', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer' }} onClick={() => setEditingTemplate(t)}><Edit2 size={12} /> Edit</button>
                  <button style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#0A2342', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer' }} onClick={() => toast.info('Preview', `Previewing "${t.name}" template`)}><Eye size={12} /> Preview</button>
                  <button style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#0A2342', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer' }} onClick={() => toast.success('Duplicated', `"${t.name}" copied`)}><Copy size={12} /> Duplicate</button>
                </div>
              </div>
            ); })}
          </div>
        </>
      )}

      {/* Send Log */}
      {tab === 'log' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <select style={st.select} value={logStatusFilter} onChange={(e) => setLogStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option><option>Delivered</option><option>Opened</option><option>Bounced</option><option>Failed</option>
            </select>
          </div>
          <div style={st.tableWrap} className="helm-table-wrap"><table style={st.table}><thead><tr>
            <th style={st.th}>Date</th><th style={st.th}>Recipient</th><th style={st.th}>Email / Phone</th><th style={st.th}>Template</th><th style={st.th}>Trigger</th><th style={st.th}>Channel</th><th style={st.th}>Status</th><th style={st.th}>Opened</th>
          </tr></thead><tbody>
            {SEND_LOG.filter((l) => logStatusFilter === 'All' || l.status === logStatusFilter).map((l, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const sc = statusColors[l.status]; return (
              <tr key={l.id}>
                <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>{l.date}</td>
                <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{l.recipient}</td>
                <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px' }}>{l.email}</td>
                <td style={{ ...st.td, backgroundColor: rowBg }}>{l.template}</td>
                <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px' }}>{l.trigger}</td>
                <td style={{ ...st.td, backgroundColor: rowBg }}>{l.channel === 'email' ? <Mail size={14} /> : <span style={{ fontSize: '11px', fontWeight: 600 }}>SMS</span>}</td>
                <td style={{ ...st.td, backgroundColor: rowBg }}><span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{l.status}</span></td>
                <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px', color: l.openedAt ? '#0A2342' : '#94A3B8' }}>{l.openedAt || '—'}</td>
              </tr>
            ); })}
          </tbody></table></div>
        </>
      )}

      {/* Template Editor Modal */}
      {editingTemplate && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#FFFFFF', borderRadius: '12px', width: '900px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px', borderBottom: '1px solid #E2E8F0' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Edit Template: {editingTemplate.name}</h2>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setEditingTemplate(null)}><X size={20} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '24px', padding: '24px 32px' }}>
              <div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '4px' }}>Subject Line</label>
                  <input style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '6px', color: '#0A2342', boxSizing: 'border-box' }} defaultValue={editingTemplate.subject} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '4px' }}>HTML Body</label>
                  <textarea style={{ width: '100%', minHeight: '300px', padding: '12px', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace', border: '1px solid #CCC', borderRadius: '6px', color: '#0A2342', boxSizing: 'border-box', resize: 'vertical' }} defaultValue={`<h2>{{subject}}</h2>\n<p>Hi {{customerName}},</p>\n<p>Your template content here...</p>`} />
                </div>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: '8px', padding: '16px', border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0A2342', marginBottom: '12px' }}>Available Variables</div>
                <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '8px' }}>Click to insert at cursor</div>
                {editingTemplate.variables.map((v) => (
                  <button key={v} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace', color: '#0A2342', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', marginBottom: '4px' }} onClick={() => toast.info('Inserted', `{{${v}}} added`)}>{`{{${v}}}`}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 32px', borderTop: '1px solid #E2E8F0' }}>
              <button style={{ padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#64748B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' }} onClick={() => setEditingTemplate(null)}>Cancel</button>
              <button style={st.addBtn} onClick={() => { toast.success('Template Saved', editingTemplate.name); setEditingTemplate(null); }}>Save Template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
