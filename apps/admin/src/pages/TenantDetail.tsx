import React, { useState } from 'react';
import { useParams } from 'react-router-dom';

const TENANTS: Record<string, any> = {
  '1': {
    name: 'Sunset Cove Marina', subdomain: 'sunsetcove', customDomain: 'marina.sunsetcove.com', status: 'active',
    tier: 'Professional', mrr: 499, adminEmail: 'admin@sunsetcove.com', phone: '(555) 234-5678',
    created: '2025-06-15', stripeStatus: 'Connected', qboStatus: 'Connected',
    achRate: 0.8, cardRate: 2.9, slips: 185, customers: 142, invoices: 1847, gmv: 128500, storageUsed: 2.4, storageQuota: 10,
    features: { customDomain: true, advancedReporting: true, apiAccess: false, whiteLabel: false },
    billingHistory: [
      { date: '2026-03-01', amount: 499, status: 'paid' },
      { date: '2026-02-01', amount: 499, status: 'paid' },
      { date: '2026-01-01', amount: 499, status: 'paid' },
      { date: '2025-12-01', amount: 299, status: 'paid' },
      { date: '2025-11-01', amount: 299, status: 'paid' },
    ],
    tickets: [
      { id: 'T-1042', subject: 'Custom domain SSL issue', status: 'open', priority: 'high', created: '2026-03-22' },
      { id: 'T-1038', subject: 'Invoice template question', status: 'resolved', priority: 'low', created: '2026-03-15' },
    ],
    notes: [
      { date: '2026-03-20', author: 'Sarah A.', text: 'Tenant upgraded from Starter to Professional. Very engaged, considering Enterprise.' },
      { date: '2026-02-10', author: 'Mike D.', text: 'Onboarding complete. Connected Stripe and QBO successfully.' },
    ],
    brandColors: { primary: '#1B5E8C', accent: '#FF9800' },
    dnsStatus: 'verified',
  },
};

// Fallback for any ID
const getDefaultTenant = (id: string) => ({
  name: `Marina #${id}`, subdomain: `marina${id}`, customDomain: '', status: 'active',
  tier: 'Starter', mrr: 299, adminEmail: `admin@marina${id}.com`, phone: '(555) 000-0000',
  created: '2025-01-01', stripeStatus: 'Pending', qboStatus: 'Not Connected',
  achRate: 0.8, cardRate: 2.9, slips: 50, customers: 30, invoices: 200, gmv: 25000, storageUsed: 0.5, storageQuota: 5,
  features: { customDomain: false, advancedReporting: false, apiAccess: false, whiteLabel: false },
  billingHistory: [], tickets: [], notes: [], brandColors: { primary: '#0A2342', accent: '#00BCD4' }, dnsStatus: 'none',
});

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  active: { label: 'Active', bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  trial: { label: 'Trial', bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  grace_period: { label: 'Grace Period', bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  locked: { label: 'Locked', bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
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

const fieldRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const fieldLabel: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.4)' };
const fieldValue: React.CSSProperties = { fontSize: 13, color: '#FFF', fontWeight: 500 };

const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const tenant = TENANTS[id || ''] || getDefaultTenant(id || '0');
  const [tab, setTab] = useState<'overview' | 'subscription' | 'usage' | 'config' | 'support'>('overview');
  const sc = STATUS_CONFIG[tenant.status] || STATUS_CONFIG.active;

  return (
    <div>
      {/* Header */}
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 8, background: tenant.brandColors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: 18, fontWeight: 700 }}>
            {tenant.name.charAt(0)}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#FFF' }}>{tenant.name}</h2>
              <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{sc.label}</span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{tenant.subdomain}.helmhq.com | {tenant.tier} | ${tenant.mrr}/mo</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ background: 'rgba(33,150,243,0.15)', color: '#2196F3', border: '1px solid rgba(33,150,243,0.3)', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Impersonate
          </button>
          {tenant.status === 'locked' ? (
            <button style={{ background: 'rgba(76,175,80,0.15)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.3)', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Unlock</button>
          ) : (
            <button style={{ background: 'rgba(244,67,54,0.15)', color: '#F44336', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Lock</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 20, display: 'flex' }}>
        {(['overview', 'subscription', 'usage', 'config', 'support'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Contact Info</div>
            {[
              ['Admin Email', tenant.adminEmail],
              ['Phone', tenant.phone],
              ['Subdomain', `${tenant.subdomain}.helmhq.com`],
              ['Custom Domain', tenant.customDomain || 'Not configured'],
              ['Created', tenant.created],
            ].map(([l, v]) => (
              <div key={l as string} style={fieldRow}>
                <span style={fieldLabel}>{l}</span>
                <span style={fieldValue}>{v}</span>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Integrations</div>
            {[
              ['Stripe Connect', tenant.stripeStatus],
              ['QuickBooks Online', tenant.qboStatus],
            ].map(([l, v]) => (
              <div key={l as string} style={fieldRow}>
                <span style={fieldLabel}>{l}</span>
                <span style={{ ...fieldValue, color: v === 'Connected' ? '#4CAF50' : '#FF9800' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription */}
      {tab === 'subscription' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Current Tier', value: tenant.tier },
              { label: 'Monthly Fee', value: `$${tenant.mrr}` },
              { label: 'ACH Fee Rate', value: `${tenant.achRate}%` },
              { label: 'Card Fee Rate', value: `${tenant.cardRate}%` },
            ].map((s) => (
              <div key={s.label} style={card}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#FFF' }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Billing History</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Date', 'Amount', 'Status'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenant.billingHistory.map((b: any, i: number) => (
                  <tr key={i}>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{b.date}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>${b.amount}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ background: 'rgba(76,175,80,0.15)', color: '#4CAF50', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{b.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Usage */}
      {tab === 'usage' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { label: 'Slips', value: tenant.slips.toLocaleString(), color: '#2196F3' },
            { label: 'Customers', value: tenant.customers.toLocaleString(), color: '#4CAF50' },
            { label: 'Invoices', value: tenant.invoices.toLocaleString(), color: '#FF9800' },
            { label: 'Monthly GMV', value: `$${tenant.gmv.toLocaleString()}`, color: '#9C27B0' },
            { label: 'Storage Used', value: `${tenant.storageUsed} GB`, color: '#00BCD4' },
            { label: 'Storage Quota', value: `${tenant.storageQuota} GB`, color: 'rgba(255,255,255,0.4)' },
          ].map((s) => (
            <div key={s.label} style={card}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
          {/* Storage bar */}
          <div style={{ ...card, gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>Storage Usage — {tenant.storageUsed} GB of {tenant.storageQuota} GB</div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(tenant.storageUsed / tenant.storageQuota) * 100}%`, background: '#FF4444', borderRadius: 4 }} />
            </div>
          </div>
        </div>
      )}

      {/* Configuration */}
      {tab === 'config' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Branding Preview</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 8, background: tenant.brandColors.primary }} />
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Primary: {tenant.brandColors.primary}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Accent: {tenant.brandColors.accent}</div>
              </div>
            </div>
            <div style={fieldRow}>
              <span style={fieldLabel}>Custom Domain</span>
              <span style={fieldValue}>{tenant.customDomain || 'Not configured'}</span>
            </div>
            <div style={fieldRow}>
              <span style={fieldLabel}>DNS Status</span>
              <span style={{ ...fieldValue, color: tenant.dnsStatus === 'verified' ? '#4CAF50' : '#FF9800' }}>{tenant.dnsStatus === 'verified' ? 'Verified' : 'Pending'}</span>
            </div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Feature Flags</div>
            {Object.entries(tenant.features).map(([key, val]) => (
              <div key={key} style={{ ...fieldRow, alignItems: 'center' }}>
                <span style={fieldLabel}>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (s: string) => s.toUpperCase())}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: val ? '#4CAF50' : 'rgba(255,255,255,0.3)' }}>{val ? 'Enabled' : 'Disabled'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Support */}
      {tab === 'support' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Support Tickets</div>
            {tenant.tickets.length === 0 ? (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', padding: 20, textAlign: 'center' }}>No tickets</div>
            ) : (
              tenant.tickets.map((t: any) => (
                <div key={t.id} style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#FFF' }}>{t.id}: {t.subject}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: t.status === 'open' ? '#FF9800' : '#4CAF50', background: t.status === 'open' ? 'rgba(255,152,0,0.15)' : 'rgba(76,175,80,0.15)', padding: '2px 8px', borderRadius: 10 }}>{t.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Priority: {t.priority} | Created: {t.created}</div>
                </div>
              ))
            )}
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Internal Notes</div>
            {tenant.notes.length === 0 ? (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', padding: 20, textAlign: 'center' }}>No notes</div>
            ) : (
              tenant.notes.map((n: any, i: number) => (
                <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#FF4444' }}>{n.author}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{n.date}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{n.text}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantDetail;
