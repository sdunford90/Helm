import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import {
  DollarSign,
  Calendar,
  CreditCard,
  Upload,
  Bell,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { usePortalApi, formatCents, formatDate } from '../lib/api';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

interface DashboardData {
  outstandingBalanceCents: number;
  openInvoiceCount: number;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    issuedDate: string;
    dueDate: string;
    totalCents: number;
    balanceCents: number;
  }>;
  boatCount: number;
  nextDueInvoice: {
    id: string;
    invoiceNumber: string;
    dueDate: string;
    balanceCents: number;
  } | null;
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { data, loading, error } = usePortalApi<DashboardData>(
    'get',
    '/api/portal/dashboard',
    { immediate: true },
  );

  const statusBadge = (status: string): CSSProperties => ({
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background:
      status === 'PAID' ? '#E6FAF0' :
      status === 'PAST_DUE' || status === 'COLLECTIONS' ? '#FFE6E6' :
      status === 'ISSUED' ? '#FFF8E6' : '#F1F5F9',
    color:
      status === 'PAID' ? '#0D9F6E' :
      status === 'PAST_DUE' || status === 'COLLECTIONS' ? '#DC2626' :
      status === 'ISSUED' ? '#D97706' : '#64748B',
  });

  const firstName = user?.firstName ?? '';

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#64748B' }}>
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ ...card, borderLeft: `4px solid #DC2626` }}>
          <div style={{ fontWeight: 600, color: '#DC2626', marginBottom: 8 }}>
            We couldn't load your dashboard
          </div>
          <div style={{ color: '#64748B', fontSize: 13 }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
        Welcome back{firstName ? `, ${firstName}` : ''}
      </h1>
      <p style={{ color: '#64748B', fontSize: 14, marginBottom: 28 }}>
        Here's an overview of your account.
      </p>

      {/* Account Summary */}
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 28 }}
      >
        <div style={{ ...card, borderLeft: `4px solid ${CYAN}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <DollarSign size={20} color={CYAN} />
            <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>Current Balance</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: NAVY }}>
            {formatCents(data?.outstandingBalanceCents ?? 0)}
          </div>
          <div style={{ fontSize: 12, color: '#D97706', marginTop: 6 }}>
            {data?.openInvoiceCount ?? 0} open {data?.openInvoiceCount === 1 ? 'invoice' : 'invoices'}
          </div>
        </div>

        <div style={{ ...card, borderLeft: `4px solid #8B5CF6` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Calendar size={20} color="#8B5CF6" />
            <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>Next Payment Due</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: NAVY }}>
            {data?.nextDueInvoice ? formatDate(data.nextDueInvoice.dueDate) : '—'}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
            {data?.nextDueInvoice
              ? `${data.nextDueInvoice.invoiceNumber} · ${formatCents(data.nextDueInvoice.balanceCents)}`
              : 'No upcoming invoices'}
          </div>
        </div>

        <div style={{ ...card, borderLeft: `4px solid #0D9F6E` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <CreditCard size={20} color="#0D9F6E" />
            <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>Boats on Account</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: NAVY }}>{data?.boatCount ?? 0}</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
            <button
              onClick={() => navigate('/boats')}
              style={{
                background: 'none',
                border: 'none',
                color: CYAN,
                fontWeight: 500,
                cursor: 'pointer',
                padding: 0,
                fontSize: 12,
              }}
            >
              Manage boats
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ ...card, marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Quick Actions</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'Pay an Invoice', icon: DollarSign, color: CYAN, route: '/invoices' },
            { label: 'Upload Insurance', icon: Upload, color: '#8B5CF6', route: '/insurance' },
            { label: 'Concierge Request', icon: Bell, color: '#F59E0B', route: '/concierge' },
          ].map((action) => (
            <button
              key={action.label}
              onClick={() => navigate(action.route)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: NAVY,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <action.icon size={16} color={action.color} />
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Recent Invoices */}
      <div style={card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY }}>Recent Invoices</h2>
          <button
            onClick={() => navigate('/invoices')}
            style={{
              background: 'none',
              border: 'none',
              color: CYAN,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            View All <ArrowRight size={14} />
          </button>
        </div>
        {(data?.recentInvoices ?? []).length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            No invoices yet.
          </div>
        ) : (
          (data?.recentInvoices ?? []).map((inv) => (
            <div
              key={inv.id}
              onClick={() => navigate(`/invoices/${inv.id}`)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid #F1F5F9',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
                  {inv.invoiceNumber}
                </div>
                <div style={{ fontSize: 12, color: '#64748B' }}>
                  Issued {formatDate(inv.issuedDate)} · Due {formatDate(inv.dueDate)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
                  {formatCents(inv.totalCents)}
                </div>
                <span style={statusBadge(inv.status)}>{inv.status}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
