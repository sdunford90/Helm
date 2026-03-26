import React, { useState } from 'react';
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

const AUTO_RULES: AutomationRule[] = [
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

const AUTO_TEMPLATES: AutoEmailTemplate[] = [
  { id: '1', name: 'Invoice Generated', subject: 'Invoice {{invoiceNumber}} — {{amount}} Due', category: 'Billing', isDefault: true, variables: ['customerName', 'invoiceNumber', 'amount', 'dueDate', 'portalUrl'] },
  { id: '2', name: 'Payment Receipt', subject: 'Payment Received — {{amount}}', category: 'Billing', isDefault: true, variables: ['customerName', 'amount', 'method', 'invoiceNumber'] },
  { id: '3', name: 'ACH Return Notice', subject: 'ACH Payment Returned — Action Required', category: 'Billing', isDefault: true, variables: ['customerName', 'amount', 'reason'] },
  { id: '4', name: 'Past Due Reminder', subject: 'Payment Overdue — Invoice {{invoiceNumber}}', category: 'Billing', isDefault: true, variables: ['customerName', 'invoiceNumber', 'amount', 'daysOverdue', 'portalUrl'] },
  { id: '5', name: 'Document Expiry', subject: 'Your {{documentType}} Expires {{expiryDate}}', category: 'Compliance', isDefault: true, variables: ['customerName', 'documentType', 'expiryDate', 'portalUrl'] },
  { id: '6', name: 'Booking Confirmation', subject: 'Booking Confirmed — {{productName}} on {{date}}', category: 'Rentals', isDefault: true, variables: ['customerName', 'productName', 'date', 'timeSlot', 'duration', 'totalAmount'] },
  { id: '7', name: 'Contract Renewal', subject: 'Contract Renewal Notice — {{slipNumber}}', category: 'Compliance', isDefault: true, variables: ['customerName', 'slipNumber', 'currentEndDate', 'newRate', 'renewalDeadline'] },
  { id: '8', name: 'Rental Reminder', subject: 'Your Rental is Tomorrow — {{productName}}', category: 'Rentals', isDefault: true, variables: ['customerName', 'productName', 'date', 'timeSlot', 'checkInTime'] },
  { id: '9', name: 'Rental Agreement', subject: 'Rental Agreement — Signature Required', category: 'Rentals', isDefault: true, variables: ['customerName', 'productName', 'date', 'duration', 'signingUrl'] },
  { id: '10', name: 'Post-Rental Thank You', subject: 'Thanks for Renting with Us!', category: 'Rentals', isDefault: true, variables: ['customerName', 'productName', 'date', 'npsUrl'] },
  { id: '11', name: 'Announcement', subject: '{{subject}}', category: 'Marketing', isDefault: true, variables: ['subject', 'body', 'marinaName'] },
  { id: '12', name: 'Welcome', subject: 'Welcome to {{marinaName}}!', category: 'Marketing', isDefault: true, variables: ['customerName', 'marinaName', 'portalUrl'] },
  { id: '13', name: 'Violation Notice', subject: 'Dock Inspection — Action Required', category: 'Operations', isDefault: true, variables: ['customerName', 'slipNumber', 'violationType', 'description', 'severity'] },
  { id: '14', name: 'Custom Marketing', subject: '', category: 'Marketing', isDefault: false, variables: ['customerName', 'marinaName', 'portalUrl'] },
];

const AUTO_SEND_LOG: AutoSendLog[] = [
  { id: '1', date: '2026-03-25 11:42', recipient: 'James Harborview', email: 'james@email.com', template: 'Payment Receipt', trigger: 'Payment Received', channel: 'email', status: 'Opened', openedAt: '2026-03-25 12:10' },
  { id: '2', date: '2026-03-25 11:42', recipient: 'James Harborview', email: '(555) 234-5678', template: 'Payment Receipt', trigger: 'Payment Received', channel: 'sms', status: 'Delivered', openedAt: null },
  { id: '3', date: '2026-03-25 09:00', recipient: 'Maria Seabreeze', email: 'maria@email.com', template: 'Invoice Generated', trigger: 'Invoice Created', channel: 'email', status: 'Opened', openedAt: '2026-03-25 09:45' },
  { id: '4', date: '2026-03-24 16:30', recipient: 'Elena Windward', email: 'elena@email.com', template: 'Rental Reminder', trigger: 'Pre-Arrival', channel: 'email', status: 'Opened', openedAt: '2026-03-24 17:15' },
  { id: '5', date: '2026-03-24 14:00', recipient: 'David Tidewater', email: 'david@email.com', template: 'Document Expiry', trigger: 'Insurance Expiring', channel: 'email', status: 'Delivered', openedAt: null },
  { id: '6', date: '2026-03-24 10:15', recipient: 'Robert Chen', email: 'robert@email.com', template: 'Booking Confirmation', trigger: 'Rental Booked', channel: 'email', status: 'Opened', openedAt: '2026-03-24 10:22' },
  { id: '7', date: '2026-03-23 09:00', recipient: 'Coastal Charters LLC', email: 'billing@coastal.com', template: 'Invoice Generated', trigger: 'Invoice Created', channel: 'email', status: 'Bounced', openedAt: null },
  { id: '8', date: '2026-03-23 08:00', recipient: 'Tom Seaside', email: 'tom@email.com', template: 'Past Due Reminder', trigger: '7 Days Past Due', channel: 'email', status: 'Opened', openedAt: '2026-03-23 10:30' },
  { id: '9', date: '2026-03-22 15:00', recipient: 'Amy Portview', email: 'amy@email.com', template: 'Contract Renewal', trigger: 'Contract Expiring', channel: 'email', status: 'Opened', openedAt: '2026-03-22 16:45' },
  { id: '10', date: '2026-03-21 14:00', recipient: 'Carlos Rivera', email: 'carlos@email.com', template: 'ACH Return Notice', trigger: 'ACH Return', channel: 'email', status: 'Failed', openedAt: null },
];

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
  const filteredDelivery = mockDeliveryLog.filter(d => {
    const matchesStatus = deliveryStatusFilter === 'All' || d.status === deliveryStatusFilter;
    return matchesStatus;
  });

  // Automation state
  const [autoRules, setAutoRules] = useState<AutomationRule[]>(AUTO_RULES);
  const [autoTab, setAutoTab] = useState<'rules' | 'templates' | 'log'>('rules');
  const [editingAutoTemplate, setEditingAutoTemplate] = useState<AutoEmailTemplate | null>(null);
  const [logStatusFilter, setLogStatusFilter] = useState('All');
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleTrigger, setNewRuleTrigger] = useState(TRIGGER_OPTIONS[0].value);
  const [newRuleCategory, setNewRuleCategory] = useState('Billing');
  const [newRuleTemplate, setNewRuleTemplate] = useState(AUTO_TEMPLATES[0].name);
  const [newRuleEmail, setNewRuleEmail] = useState(true);
  const [newRuleSms, setNewRuleSms] = useState(false);
  const [newRuleDelay, setNewRuleDelay] = useState('Immediate');

  const toggleAutoRule = (id: string) => {
    setAutoRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
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
                {AUTO_TEMPLATES.map(t => {
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
                    {AUTO_SEND_LOG.filter(l => logStatusFilter === 'All' || l.status === logStatusFilter).map((l, idx) => {
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
                      {AUTO_TEMPLATES.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
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
