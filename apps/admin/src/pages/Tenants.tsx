import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  status: 'active' | 'trial' | 'grace_period' | 'locked';
  tier: 'Starter' | 'Professional' | 'Enterprise';
  mrr: number;
  slips: number;
  created: string;
  lastLogin: string;
  adminEmail: string;
}

const MOCK_TENANTS: Tenant[] = [
  { id: '1', name: 'Sunset Cove Marina', subdomain: 'sunsetcove', status: 'active', tier: 'Professional', mrr: 499, slips: 185, created: '2025-06-15', lastLogin: '2026-03-25', adminEmail: 'admin@sunsetcove.com' },
  { id: '2', name: 'Harbor Bay Marina', subdomain: 'harborbay', status: 'trial', tier: 'Professional', mrr: 0, slips: 120, created: '2026-03-23', lastLogin: '2026-03-25', adminEmail: 'mgr@harborbay.com' },
  { id: '3', name: 'Pacific Coast Marina', subdomain: 'pacificcoast', status: 'active', tier: 'Enterprise', mrr: 999, slips: 420, created: '2025-03-10', lastLogin: '2026-03-24', adminEmail: 'ops@pacificcoast.com' },
  { id: '4', name: 'Old Port Marina', subdomain: 'oldport', status: 'grace_period', tier: 'Professional', mrr: 499, slips: 95, created: '2025-09-01', lastLogin: '2026-03-20', adminEmail: 'info@oldport.com' },
  { id: '5', name: 'Lakeside Harbor', subdomain: 'lakeside', status: 'active', tier: 'Starter', mrr: 299, slips: 48, created: '2025-11-20', lastLogin: '2026-03-22', adminEmail: 'marina@lakeside.com' },
  { id: '6', name: 'Crystal Waters Yacht Club', subdomain: 'crystalwaters', status: 'trial', tier: 'Enterprise', mrr: 0, slips: 310, created: '2026-03-20', lastLogin: '2026-03-25', adminEmail: 'admin@crystalwaters.com' },
  { id: '7', name: 'Bayview Docks', subdomain: 'bayview', status: 'locked', tier: 'Starter', mrr: 0, slips: 32, created: '2025-07-05', lastLogin: '2026-02-28', adminEmail: 'dock@bayview.com' },
  { id: '8', name: 'Fisherman\'s Wharf Marina', subdomain: 'fishermanswharf', status: 'active', tier: 'Enterprise', mrr: 999, slips: 380, created: '2025-01-15', lastLogin: '2026-03-25', adminEmail: 'ops@fwharf.com' },
  { id: '9', name: 'Blue Horizon Marina', subdomain: 'bluehorizon', status: 'active', tier: 'Professional', mrr: 499, slips: 210, created: '2025-05-22', lastLogin: '2026-03-24', adminEmail: 'admin@bluehorizon.com' },
  { id: '10', name: 'Anchor Point Marina', subdomain: 'anchorpoint', status: 'active', tier: 'Starter', mrr: 299, slips: 65, created: '2025-08-14', lastLogin: '2026-03-23', adminEmail: 'hello@anchorpoint.com' },
  { id: '11', name: 'Windward Yacht Harbor', subdomain: 'windward', status: 'active', tier: 'Professional', mrr: 499, slips: 175, created: '2025-04-30', lastLogin: '2026-03-25', adminEmail: 'mgr@windward.com' },
  { id: '12', name: 'Coral Reef Marina', subdomain: 'coralreef', status: 'active', tier: 'Enterprise', mrr: 999, slips: 450, created: '2025-02-10', lastLogin: '2026-03-25', adminEmail: 'admin@coralreef.com' },
  { id: '13', name: 'Tidewater Landing', subdomain: 'tidewater', status: 'trial', tier: 'Starter', mrr: 0, slips: 40, created: '2026-03-18', lastLogin: '2026-03-24', adminEmail: 'info@tidewater.com' },
  { id: '14', name: 'Seabreeze Marina', subdomain: 'seabreeze', status: 'active', tier: 'Professional', mrr: 499, slips: 155, created: '2025-10-05', lastLogin: '2026-03-25', adminEmail: 'ops@seabreeze.com' },
  { id: '15', name: 'North Shore Docks', subdomain: 'northshore', status: 'active', tier: 'Starter', mrr: 299, slips: 72, created: '2025-12-01', lastLogin: '2026-03-21', adminEmail: 'dock@northshore.com' },
];

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

const Tenants: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', subdomain: '', email: '', tier: 'Professional' });

  const filtered = MOCK_TENANTS.filter((t) => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.subdomain.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 14px', color: '#FFF', fontSize: 13, width: 260, outline: 'none' }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 14px', color: '#FFF', fontSize: 13, outline: 'none' }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="grace_period">Grace Period</option>
            <option value="locked">Locked</option>
          </select>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ background: '#FF4444', color: '#FFF', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + Create Tenant
        </button>
      </div>

      {/* Table */}
      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Marina Name', 'Subdomain', 'Status', 'SaaS Tier', 'MRR', 'Slips', 'Created', 'Last Login'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const sc = STATUS_CONFIG[t.status];
              return (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/tenants/${t.id}`)}
                  style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '12px', fontSize: 13, fontWeight: 500, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.name}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.subdomain}.helmhq.com</td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{sc.label}</span>
                  </td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.tier}</td>
                  <td style={{ padding: '12px', fontSize: 13, fontWeight: 600, color: t.mrr > 0 ? '#4CAF50' : 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.mrr > 0 ? `$${t.mrr}` : 'Free'}</td>
                  <td style={{ padding: '12px', fontSize: 13, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.slips}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.created}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.lastLogin}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Showing {filtered.length} of {MOCK_TENANTS.length} tenants</div>
      </div>

      {/* Create Tenant Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 32, width: 440 }}>
            <h3 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 700, color: '#FFF' }}>Create New Tenant</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { label: 'Marina Name', key: 'name', placeholder: 'e.g. Sunset Cove Marina' },
                { label: 'Subdomain', key: 'subdomain', placeholder: 'e.g. sunsetcove' },
                { label: 'Admin Email', key: 'email', placeholder: 'e.g. admin@marina.com' },
              ].map((f) => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>{f.label}</label>
                  <input
                    value={(newTenant as any)[f.key]}
                    onChange={(e) => setNewTenant({ ...newTenant, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '9px 12px', color: '#FFF', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>SaaS Tier</label>
                <select
                  value={newTenant.tier}
                  onChange={(e) => setNewTenant({ ...newTenant, tier: e.target.value })}
                  style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '9px 12px', color: '#FFF', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                >
                  <option value="Starter">Starter — $299/mo</option>
                  <option value="Professional">Professional — $499/mo</option>
                  <option value="Enterprise">Enterprise — $999/mo</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '9px 20px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => setShowModal(false)} style={{ background: '#FF4444', border: 'none', borderRadius: 6, padding: '9px 20px', color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Create Tenant</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tenants;
