import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit, GitMerge, Mail, Phone, Building, MapPin,
  Calendar, CreditCard, Shield, Ship, FileText, DollarSign,
  Activity, Clock, User, AlertCircle,
} from 'lucide-react';
import CustomerForm from '../components/CustomerForm';
import CustomerMerge from '../components/CustomerMerge';

/* ── Types ─────────────────────────────────────────── */

interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  address: string;
  status: 'Active' | 'Inactive' | 'Waitlist' | 'Collections Hold' | 'Seasonal';
  dob: string;
  dlNumber: string;
  dlState: string;
  dlExpiry: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencyEmail: string;
  taxExempt: boolean;
  achBlocked: boolean;
  created: string;
  openInvoices: number;
  credits: number;
  deposits: number;
  totalBoats: number;
  activeContracts: number;
  lifetimeValue: number;
}

const STATUS_MAP: Record<string, CustomerDetail['status']> = {
  ACTIVE: 'Active', INACTIVE: 'Inactive', WAITLIST: 'Waitlist',
  COLLECTIONS_HOLD: 'Collections Hold', SEASONAL: 'Seasonal',
};

/* ── Styles ────────────────────────────────────────────── */

const statusBadgeColors: Record<string, { bg: string; color: string }> = {
  Active: { bg: '#E8F5E9', color: '#1B5E20' },
  Inactive: { bg: '#F2F4F6', color: '#64748B' },
  Waitlist: { bg: '#0A2342', color: '#FFFFFF' },
  'Collections Hold': { bg: '#FDECEA', color: '#B71C1C' },
  Seasonal: { bg: '#FFF3CD', color: '#856404' },
};

const invoiceStatusColors: Record<string, { bg: string; color: string }> = {
  Paid: { bg: '#E8F5E9', color: '#1B5E20' },
  Open: { bg: '#FFF3CD', color: '#856404' },
  Overdue: { bg: '#FDECEA', color: '#B71C1C' },
};

const complianceBadge = (score: number): { bg: string; color: string } => {
  if (score >= 90) return { bg: '#E8F5E9', color: '#1B5E20' };
  if (score >= 70) return { bg: '#FFF3CD', color: '#856404' };
  return { bg: '#FDECEA', color: '#B71C1C' };
};

const activityIcons: Record<string, React.ElementType> = {
  service: Activity,
  billing: FileText,
  payment: DollarSign,
  meter: Activity,
  contract: FileText,
  document: FileText,
  inspection: Shield,
};

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  backRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '24px',
    cursor: 'pointer',
    color: '#2E4A6B',
    fontSize: '14px',
    fontWeight: 600,
    border: 'none',
    background: 'none',
    padding: 0,
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  name: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  btnGroup: {
    display: 'flex',
    gap: '8px',
  },
  secondaryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2E4A6B',
    background: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  divider: {
    height: '4px',
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: '12px',
    marginBottom: '32px',
    borderRadius: '2px',
  },
  tabs: {
    display: 'flex',
    gap: '0',
    borderBottom: '2px solid #E2E8F0',
    marginBottom: '32px',
  },
  tab: {
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    color: '#64748B',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: '#0A2342',
    borderBottomColor: '#00D4FF',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
  },
  grid3: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: '16px',
    marginBottom: '24px',
  },
  card: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  cardTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 0',
    fontSize: '14px',
    color: '#0A2342',
    borderBottom: '1px solid #F2F4F6',
  },
  infoLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    minWidth: '90px',
  },
  statCard: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    textAlign: 'center' as const,
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#0A2342',
    fontFamily: '"JetBrains Mono", monospace',
  },
  statLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginTop: '4px',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '9999px',
  },
  mono: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '14px',
  },
  tableWrap: {
    background: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '14px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    borderBottom: '2px solid #00D4FF',
  },
  td: {
    padding: '12px 16px',
    color: '#0A2342',
    borderBottom: '1px solid #E2E8F0',
  },
  timeline: {
    position: 'relative' as const,
    paddingLeft: '32px',
  },
  timelineLine: {
    position: 'absolute' as const,
    left: '11px',
    top: '8px',
    bottom: '8px',
    width: '2px',
    backgroundColor: '#E2E8F0',
  },
  timelineItem: {
    position: 'relative' as const,
    paddingBottom: '24px',
  },
  timelineDot: {
    position: 'absolute' as const,
    left: '-27px',
    top: '4px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: '#D6E8F4',
    border: '2px solid #00D4FF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDate: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    marginBottom: '4px',
  },
  timelineAction: {
    fontSize: '14px',
    color: '#0A2342',
  },
};

/* ── Component ─────────────────────────────────────────── */

type Tab = 'overview' | 'boats' | 'billing' | 'documents' | 'activity';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [c, setCustomer] = useState<CustomerDetail | null>(null);
  const [BOATS, setBoats] = useState<{ id: string; name: string; type: string; length: number; registration: string; compliance: number }[]>([]);
  const [INVOICES, setInvoices] = useState<{ id: string; description: string; amount: number; status: string; date: string }[]>([]);
  const [ACTIVITY, setActivity] = useState<{ date: string; action: string; type: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.allSettled([
      api.get<Record<string, unknown>>(`/customers/${id}`),
      api.get<{ timeline: Array<Record<string, unknown>> }>(`/customers/${id}/timeline`),
      api.get<Record<string, unknown>>(`/customers/${id}/balance`),
    ]).then(([custRes, timeRes, balRes]) => {
      if (custRes.status === 'fulfilled') {
        const d = custRes.value;
        const customer = (d.customer ?? d) as Record<string, unknown>;
        const boats = ((customer.boats ?? d.boats) as Array<Record<string, unknown>>) ?? [];
        const invoices = ((customer.invoices ?? d.invoices) as Array<Record<string, unknown>>) ?? [];
        const bal = balRes.status === 'fulfilled' ? balRes.value : {};

        setCustomer({
          id: customer.id as string,
          firstName: (customer.firstName as string) ?? '',
          lastName: (customer.lastName as string) ?? '',
          email: (customer.email as string) ?? '',
          phone: (customer.phone as string) ?? '',
          company: (customer.company as string) ?? '',
          address: (customer.address as string) ?? '',
          status: STATUS_MAP[(customer.status as string)] ?? 'Active',
          dob: (customer.dob as string) ?? '',
          dlNumber: (customer.dlNumber as string) ?? '',
          dlState: (customer.dlState as string) ?? '',
          dlExpiry: (customer.dlExpiry as string) ?? '',
          emergencyName: (customer.emergencyName as string) ?? '',
          emergencyRelationship: (customer.emergencyRelationship as string) ?? '',
          emergencyPhone: (customer.emergencyPhone as string) ?? '',
          emergencyEmail: (customer.emergencyEmail as string) ?? '',
          taxExempt: (customer.taxExempt as boolean) ?? false,
          achBlocked: (customer.achBlocked as boolean) ?? false,
          created: ((customer.createdAt as string) ?? '').slice(0, 10),
          openInvoices: ((bal as Record<string, unknown>).openBalanceCents as number ?? 0) / 100,
          credits: ((bal as Record<string, unknown>).creditsCents as number ?? 0) / 100,
          deposits: ((bal as Record<string, unknown>).depositsCents as number ?? 0) / 100,
          totalBoats: boats.length,
          activeContracts: ((customer.contracts as unknown[]) ?? []).length,
          lifetimeValue: ((bal as Record<string, unknown>).lifetimeValueCents as number ?? 0) / 100,
        });

        setBoats(boats.map((b) => ({
          id: b.id as string,
          name: b.name as string ?? '',
          type: b.type as string ?? '',
          length: b.lengthFeet as number ?? 0,
          registration: b.registrationNumber as string ?? '',
          compliance: 100,
        })));

        setInvoices(invoices.map((inv) => ({
          id: inv.invoiceNumber as string ?? inv.id as string,
          description: '',
          amount: ((inv.totalCents as number) ?? 0) / 100,
          status: (inv.status as string) === 'PAID' ? 'Paid' : (inv.status as string) === 'PAST_DUE' ? 'Overdue' : 'Open',
          date: ((inv.issuedAt as string) ?? '').slice(0, 10),
        })));
      }

      if (timeRes.status === 'fulfilled') {
        setActivity((timeRes.value.timeline ?? []).map((t) => ({
          date: ((t.createdAt as string) ?? '').slice(0, 10),
          action: (t.action as string) ?? (t.description as string) ?? '',
          type: (t.type as string) ?? 'service',
        })));
      }
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '64px', color: '#64748B' }}>Loading customer...</div>;
  if (!c) return <div style={{ display: 'flex', justifyContent: 'center', padding: '64px', color: '#64748B' }}>Customer not found.</div>;

  const badgeStyle = statusBadgeColors[c.status];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'boats', label: 'Boats' },
    { key: 'billing', label: 'Billing' },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });

  /* ── Overview Tab ─── */
  const renderOverview = () => (
    <>
      {/* Quick Stats */}
      <div style={s.grid3}>
        <div style={s.statCard}>
          <div style={s.statValue}>{c.totalBoats}</div>
          <div style={s.statLabel}>Total Boats</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statValue}>{c.activeContracts}</div>
          <div style={s.statLabel}>Active Contracts</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statValue}>{fmt(c.lifetimeValue)}</div>
          <div style={s.statLabel}>Lifetime Value</div>
        </div>
        <div style={{ ...s.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={{ ...s.statValue, color: c.openInvoices > 0 ? '#B71C1C' : '#1B5E20' }}>
            {fmt(c.openInvoices)}
          </div>
          <div style={s.statLabel}>Open Balance</div>
        </div>
      </div>

      <div style={s.grid2}>
        {/* Contact Card */}
        <div style={s.card}>
          <div style={s.cardTitle}><User size={16} /> Contact Information</div>
          <div style={s.infoRow}><Mail size={14} color="#64748B" /><span>{c.email}</span></div>
          <div style={s.infoRow}><Phone size={14} color="#64748B" /><span>{c.phone}</span></div>
          <div style={s.infoRow}><Building size={14} color="#64748B" /><span>{c.company || '—'}</span></div>
          <div style={{ ...s.infoRow, borderBottom: 'none' }}><MapPin size={14} color="#64748B" /><span style={{ whiteSpace: 'pre-line' }}>{c.address || '—'}</span></div>
        </div>

        {/* Identity Card */}
        <div style={s.card}>
          <div style={s.cardTitle}><Shield size={16} /> Identity</div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DOB</span>
            <span>{c.dob || '—'}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DL #</span>
            <span>{c.dlNumber || '—'}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DL State</span>
            <span>{c.dlState || '—'}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DL Expiry</span>
            <span>{c.dlExpiry || '—'}</span>
          </div>
          <div style={{ ...s.infoRow, borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
            <span style={{ ...s.infoLabel, minWidth: 'auto' }}>Emergency Contact</span>
            <span>{c.emergencyName} ({c.emergencyRelationship})</span>
            <span style={{ fontSize: '13px', color: '#64748B' }}>{c.emergencyPhone} | {c.emergencyEmail}</span>
          </div>
        </div>

        {/* Balance Summary */}
        <div style={{ ...s.card, gridColumn: '1 / -1' }}>
          <div style={s.cardTitle}><DollarSign size={16} /> Balance Summary</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open Invoices</div>
              <div style={{ ...s.mono, fontSize: '20px', fontWeight: 700, color: '#B71C1C', marginTop: '4px' }}>{fmt(c.openInvoices)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Credits</div>
              <div style={{ ...s.mono, fontSize: '20px', fontWeight: 700, color: '#1B5E20', marginTop: '4px' }}>{fmt(c.credits)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Security Deposits</div>
              <div style={{ ...s.mono, fontSize: '20px', fontWeight: 700, color: '#0A2342', marginTop: '4px' }}>{fmt(c.deposits)}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  /* ── Boats Tab ─── */
  const renderBoats = () => (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Name</th>
            <th style={s.th}>Type</th>
            <th style={s.th}>Length</th>
            <th style={s.th}>Registration</th>
            <th style={s.th}>Compliance</th>
          </tr>
        </thead>
        <tbody>
          {BOATS.map((b, idx) => {
            const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
            const cb = complianceBadge(b.compliance);
            return (
              <tr key={b.id}>
                <td style={{ ...s.td, backgroundColor: rowBg, fontWeight: 600 }}>{b.name}</td>
                <td style={{ ...s.td, backgroundColor: rowBg }}>{b.type}</td>
                <td style={{ ...s.td, backgroundColor: rowBg }}>{b.length}'</td>
                <td style={{ ...s.td, backgroundColor: rowBg, ...s.mono }}>{b.registration}</td>
                <td style={{ ...s.td, backgroundColor: rowBg }}>
                  <span style={{ ...s.badge, backgroundColor: cb.bg, color: cb.color }}>
                    {b.compliance}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  /* ── Billing Tab ─── */
  const renderBilling = () => (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Invoice</th>
            <th style={s.th}>Description</th>
            <th style={s.th}>Amount</th>
            <th style={s.th}>Status</th>
            <th style={s.th}>Date</th>
          </tr>
        </thead>
        <tbody>
          {INVOICES.map((inv, idx) => {
            const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
            const ib = invoiceStatusColors[inv.status];
            return (
              <tr key={inv.id}>
                <td style={{ ...s.td, backgroundColor: rowBg, fontWeight: 600, ...s.mono }}>{inv.id}</td>
                <td style={{ ...s.td, backgroundColor: rowBg }}>{inv.description}</td>
                <td style={{ ...s.td, backgroundColor: rowBg, ...s.mono }}>{fmt(inv.amount)}</td>
                <td style={{ ...s.td, backgroundColor: rowBg }}>
                  <span style={{ ...s.badge, backgroundColor: ib.bg, color: ib.color }}>{inv.status}</span>
                </td>
                <td style={{ ...s.td, backgroundColor: rowBg, color: '#64748B' }}>{inv.date}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  /* ── Documents Tab ─── */
  const renderDocuments = () => (
    <div style={{ ...s.card, textAlign: 'center', padding: '48px 32px' }}>
      <FileText size={32} style={{ color: '#2E4A6B', marginBottom: '16px' }} />
      <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#0A2342', margin: '0 0 8px' }}>
        No documents uploaded
      </h3>
      <p style={{ fontSize: '15px', color: '#64748B', margin: '0 0 24px' }}>
        Upload insurance certificates, registration papers, or other documents.
      </p>
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
        Upload Document
      </button>
    </div>
  );

  /* ── Activity Tab ─── */
  const renderActivity = () => (
    <div style={s.timeline}>
      <div style={s.timelineLine} />
      {ACTIVITY.map((a, i) => {
        const Icon = activityIcons[a.type] || Activity;
        return (
          <div key={i} style={s.timelineItem}>
            <div style={s.timelineDot} />
            <div style={s.timelineDate}>{a.date}</div>
            <div style={s.timelineAction}>{a.action}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={s.page}>
      <button style={s.backRow} onClick={() => navigate('/customers')}>
        <ArrowLeft size={16} /> Back to Customers
      </button>

      <div style={s.headerRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={s.name}>{c.firstName} {c.lastName}</h1>
          <span style={{ ...s.badge, backgroundColor: badgeStyle.bg, color: badgeStyle.color, fontSize: '13px', padding: '4px 14px' }}>
            {c.status}
          </span>
        </div>
        <div style={s.btnGroup}>
          <button style={s.secondaryBtn} onClick={() => setShowEdit(true)}>
            <Edit size={14} /> Edit
          </button>
          <button style={s.secondaryBtn} onClick={() => setShowMerge(true)}>
            <GitMerge size={14} /> Merge
          </button>
        </div>
      </div>
      <hr style={s.divider} />

      {/* Tab Navigation */}
      <div style={s.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            style={{ ...s.tab, ...(tab === t.key ? s.tabActive : {}) }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && renderOverview()}
      {tab === 'boats' && renderBoats()}
      {tab === 'billing' && renderBilling()}
      {tab === 'documents' && renderDocuments()}
      {tab === 'activity' && renderActivity()}

      {showEdit && (
        <CustomerForm
          initial={{
            firstName: c.firstName,
            lastName: c.lastName,
            company: c.company,
            email: c.email,
            phone: c.phone,
            address: c.address,
            dob: c.dob,
            dlNumber: c.dlNumber,
            dlState: c.dlState,
            dlExpiry: c.dlExpiry,
            emergencyName: c.emergencyName,
            emergencyRelationship: c.emergencyRelationship,
            emergencyPhone: c.emergencyPhone,
            emergencyEmail: c.emergencyEmail,
            taxExempt: c.taxExempt,
            status: c.status,
          }}
          onClose={() => setShowEdit(false)}
          onSave={(data) => {
            console.log('Update customer:', data);
            setShowEdit(false);
          }}
        />
      )}

      {showMerge && (
        <CustomerMerge
          source={{
            id: c.id,
            name: `${c.firstName} ${c.lastName}`,
            email: c.email,
            phone: c.phone,
            company: c.company,
            address: c.address,
            status: c.status,
            boats: c.totalBoats,
            invoices: 5,
            payments: 12,
          }}
          onClose={() => setShowMerge(false)}
          onMerge={(targetId, selections) => {
            console.log('Merge into:', targetId, selections);
            setShowMerge(false);
          }}
        />
      )}
    </div>
  );
}
