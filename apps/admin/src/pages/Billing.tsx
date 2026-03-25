import React, { useState } from 'react';

const STATS = [
  { label: 'Total MRR', value: '$14,850', change: '+12%', color: '#4CAF50' },
  { label: 'Invoices This Month', value: '15', change: '2 pending', color: '#2196F3' },
  { label: 'Collections Rate', value: '94.2%', change: '1 failed', color: '#FF9800' },
  { label: 'Avg Revenue / Tenant', value: '$825', change: '+8%', color: '#9C27B0' },
];

const INVOICES = [
  { tenant: 'Pacific Coast Marina', amount: 999, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-01' },
  { tenant: 'Coral Reef Marina', amount: 999, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-02' },
  { tenant: 'Fisherman\'s Wharf Marina', amount: 999, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-01' },
  { tenant: 'Sunset Cove Marina', amount: 499, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-01' },
  { tenant: 'Blue Horizon Marina', amount: 499, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-03' },
  { tenant: 'Windward Yacht Harbor', amount: 499, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-01' },
  { tenant: 'Seabreeze Marina', amount: 499, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-02' },
  { tenant: 'Old Port Marina', amount: 499, status: 'failed', dueDate: '2026-03-01', paidDate: '—' },
  { tenant: 'Lakeside Harbor', amount: 299, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-01' },
  { tenant: 'Anchor Point Marina', amount: 299, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-04' },
  { tenant: 'North Shore Docks', amount: 299, status: 'paid', dueDate: '2026-03-01', paidDate: '2026-03-01' },
  { tenant: 'Harbor Bay Marina', amount: 0, status: 'trial', dueDate: '—', paidDate: '—' },
  { tenant: 'Crystal Waters Yacht Club', amount: 0, status: 'trial', dueDate: '—', paidDate: '—' },
  { tenant: 'Tidewater Landing', amount: 0, status: 'trial', dueDate: '—', paidDate: '—' },
  { tenant: 'Bayview Docks', amount: 0, status: 'locked', dueDate: '—', paidDate: '—' },
];

const TIERS = [
  {
    name: 'Starter', price: '$299/mo', tenants: 4,
    features: ['Up to 100 slips', '1 GB storage', 'Basic reporting', 'Email support', 'Standard branding'],
    color: '#2196F3',
  },
  {
    name: 'Professional', price: '$499/mo', tenants: 5,
    features: ['Up to 250 slips', '10 GB storage', 'Advanced reporting', 'Priority support', 'Custom domain', 'API access'],
    color: '#FF9800',
  },
  {
    name: 'Enterprise', price: '$999/mo', tenants: 3,
    features: ['Unlimited slips', '50 GB storage', 'Custom reporting', 'Dedicated support', 'White label', 'Full API access', 'SSO'],
    color: '#9C27B0',
  },
];

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  paid: { bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  failed: { bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
  trial: { bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  locked: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' },
};

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? '#FF4444' : 'rgba(255,255,255,0.5)',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #FF4444' : '2px solid transparent',
  cursor: 'pointer',
});

const Billing: React.FC = () => {
  const [tab, setTab] = useState<'invoices' | 'tiers'>('invoices');

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {STATS.map((s) => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{s.change}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 20, display: 'flex' }}>
        <button onClick={() => setTab('invoices')} style={tabBtn(tab === 'invoices')}>Invoices</button>
        <button onClick={() => setTab('tiers')} style={tabBtn(tab === 'tiers')}>Tiers</button>
      </div>

      {/* Invoices Tab */}
      {tab === 'invoices' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 }}>March 2026 SaaS Invoices</div>
            <button style={{ background: '#FF4444', color: '#FFF', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Generate Monthly Invoices
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Tenant', 'Amount', 'Status', 'Due Date', 'Paid Date'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INVOICES.map((inv, i) => {
                const ss = STATUS_STYLE[inv.status];
                return (
                  <tr key={i}>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#FFF', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{inv.tenant}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: inv.amount > 0 ? '#FFF' : 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{inv.amount > 0 ? `$${inv.amount}` : '—'}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ background: ss.bg, color: ss.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{inv.status}</span>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{inv.dueDate}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{inv.paidDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tiers Tab */}
      {tab === 'tiers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {TIERS.map((tier) => (
            <div key={tier.name} style={{ ...card, borderTop: `3px solid ${tier.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#FFF' }}>{tier.name}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: tier.color, marginTop: 4 }}>{tier.price}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#FFF' }}>{tier.tenants}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>tenants</div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                {tier.features.map((f) => (
                  <div key={f} style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: tier.color }}>+</span> {f}
                  </div>
                ))}
              </div>
              <button style={{ width: '100%', marginTop: 16, background: 'transparent', border: `1px solid ${tier.color}`, color: tier.color, borderRadius: 6, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Edit Tier
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Billing;
