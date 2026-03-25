import { useNavigate } from 'react-router-dom';
import {
  DollarSign,
  Calendar,
  CreditCard,
  Upload,
  Bell,
  FileText,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Zap,
} from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const recentInvoices = [
  { id: 'INV-1042', date: '2026-03-01', description: 'Monthly Slip Rental - March', amount: 1250.0, status: 'Open' },
  { id: 'INV-1038', date: '2026-02-01', description: 'Monthly Slip Rental - February', amount: 1250.0, status: 'Paid' },
  { id: 'INV-1035', date: '2026-01-15', description: 'Pump-Out Service', amount: 75.0, status: 'Paid' },
];

const recentAnnouncements = [
  { id: 1, title: 'Spring Dock Maintenance Schedule', date: '2026-03-20', urgent: false },
  { id: 2, title: 'New Fuel Dock Hours Starting April 1', date: '2026-03-18', urgent: false },
  { id: 3, title: 'Severe Weather Advisory - Secure Your Vessels', date: '2026-03-15', urgent: true },
];

export default function Dashboard() {
  const navigate = useNavigate();

  const statusBadge = (status: string): CSSProperties => ({
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background:
      status === 'Paid' ? '#E6FAF0' : status === 'Open' ? '#FFF8E6' : '#FFE6E6',
    color:
      status === 'Paid' ? '#0D9F6E' : status === 'Open' ? '#D97706' : '#DC2626',
  });

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
        Welcome back, James
      </h1>
      <p style={{ color: '#64748B', fontSize: 14, marginBottom: 28 }}>
        Here's an overview of your account at Bayview Marina.
      </p>

      {/* Account Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 28 }}>
        <div style={{ ...card, borderLeft: `4px solid ${CYAN}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <DollarSign size={20} color={CYAN} />
            <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>Current Balance</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: NAVY }}>$1,250.00</div>
          <div style={{ fontSize: 12, color: '#D97706', marginTop: 6 }}>1 open invoice</div>
        </div>

        <div style={{ ...card, borderLeft: `4px solid #8B5CF6` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Calendar size={20} color="#8B5CF6" />
            <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>Next Payment Due</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: NAVY }}>Mar 31</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>Monthly slip rental</div>
        </div>

        <div style={{ ...card, borderLeft: `4px solid #0D9F6E` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <CreditCard size={20} color="#0D9F6E" />
            <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>Auto-Pay</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#0D9F6E' }}>Active</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>Visa ending 4242</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ ...card, marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Quick Actions</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'Pay Now', icon: DollarSign, color: CYAN, route: '/invoices' },
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        {/* Recent Invoices */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
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
          {recentInvoices.map((inv) => (
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
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{inv.id}</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>{inv.description}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>${inv.amount.toFixed(2)}</div>
                <span style={statusBadge(inv.status)}>{inv.status}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Announcements */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY }}>Recent Announcements</h2>
            <button
              onClick={() => navigate('/announcements')}
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
          {recentAnnouncements.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 0',
                borderBottom: '1px solid #F1F5F9',
              }}
            >
              {a.urgent ? (
                <AlertTriangle size={16} color="#DC2626" />
              ) : (
                <Megaphone size={16} color="#64748B" />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: a.urgent ? '#DC2626' : NAVY }}>
                  {a.title}
                </div>
                <div style={{ fontSize: 12, color: '#64748B' }}>{a.date}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Compliance Status */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Compliance Status</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#E6FAF0', borderRadius: 8 }}>
            <CheckCircle size={20} color="#0D9F6E" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0D9F6E' }}>Insurance</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Valid through Dec 2026</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#FFF8E6', borderRadius: 8 }}>
            <AlertTriangle size={20} color="#D97706" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#D97706' }}>Registration</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Expires May 2026</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#E6FAF0', borderRadius: 8 }}>
            <CheckCircle size={20} color="#0D9F6E" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0D9F6E' }}>Lease Agreement</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Active - Annual</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
