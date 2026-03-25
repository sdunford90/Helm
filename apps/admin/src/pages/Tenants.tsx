import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  status: string;
  saasTier: { id: string; name: string } | null;
  mrrCents: number;
  userCount: number;
  createdAt: string;
}

interface SaasTier {
  id: string;
  name: string;
  monthlyFeeCents: number;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  ACTIVE: { label: 'Active', bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  GRACE_PERIOD: { label: 'Grace Period', bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  LOCKED: { label: 'Locked', bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
};

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#070E18',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '9px 12px',
  color: '#FFF',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const Tenants: React.FC = () => {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tiers, setTiers] = useState<SaasTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newTenant, setNewTenant] = useState({ name: '', subdomain: '', email: '', saasTierId: '' });

  const fetchTenants = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: '100' });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/admin/tenants?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTenants(data.items);
    } catch (e: any) {
      setError(e.message || 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  };

  const fetchTiers = async () => {
    try {
      const res = await fetch('/api/admin/billing/tiers');
      if (!res.ok) return;
      const data = await res.json();
      setTiers(data);
      if (data.length > 0) setNewTenant((p) => ({ ...p, saasTierId: data[0].id }));
    } catch {
    }
  };

  useEffect(() => {
    fetchTiers();
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchTenants, 300);
    return () => clearTimeout(timer);
  }, [search, statusFilter]);

  const handleCreate = async () => {
    if (!newTenant.name || !newTenant.subdomain || !newTenant.email) {
      setSaveError('Name, subdomain, and admin email are required.');
      return;
    }
    try {
      setSaving(true);
      setSaveError(null);
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTenant.name,
          subdomain: newTenant.subdomain.toLowerCase(),
          adminEmail: newTenant.email,
          saasTierId: newTenant.saasTierId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setShowModal(false);
      setNewTenant({ name: '', subdomain: '', email: '', saasTierId: tiers[0]?.id ?? '' });
      fetchTenants();
    } catch (e: any) {
      setSaveError(e.message || 'Failed to create tenant');
    } finally {
      setSaving(false);
    }
  };

  const fmtMrr = (cents: number) => cents > 0 ? `$${(cents / 100).toLocaleString()}` : '—';

  return (
    <div>
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
            <option value="ACTIVE">Active</option>
            <option value="GRACE_PERIOD">Grace Period</option>
            <option value="LOCKED">Locked</option>
          </select>
        </div>
        <button
          onClick={() => { setShowModal(true); setSaveError(null); }}
          style={{ background: '#FF4444', color: '#FFF', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + Create Tenant
        </button>
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Loading tenants...</div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#F44336', fontSize: 14 }}>{error}</div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Marina Name', 'Subdomain', 'Status', 'SaaS Tier', 'MRR', 'Users', 'Created'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const sc = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.ACTIVE;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => navigate(`/tenants/${t.id}`)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '12px', fontSize: 13, fontWeight: 500, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.name}</td>
                      <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.subdomain}.helmhq.com</td>
                      <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{sc.label}</span>
                      </td>
                      <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.saasTier?.name ?? '—'}</td>
                      <td style={{ padding: '12px', fontSize: 13, fontWeight: 600, color: t.mrrCents > 0 ? '#4CAF50' : 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtMrr(t.mrrCents)}</td>
                      <td style={{ padding: '12px', fontSize: 13, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.userCount}</td>
                      <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No tenants found</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
              {tenants.length} tenant{tenants.length !== 1 ? 's' : ''} shown
            </div>
          </>
        )}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 32, width: 440 }}>
            <h3 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 700, color: '#FFF' }}>Create New Tenant</h3>
            {saveError && (
              <div style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, padding: '10px 14px', color: '#F44336', fontSize: 13, marginBottom: 16 }}>{saveError}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { label: 'Marina Name', key: 'name', placeholder: 'e.g. Sunset Cove Marina' },
                { label: 'Subdomain', key: 'subdomain', placeholder: 'e.g. sunsetcove (lowercase, no spaces)' },
                { label: 'Admin Email', key: 'email', placeholder: 'e.g. admin@marina.com' },
              ].map((f) => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>{f.label}</label>
                  <input
                    value={(newTenant as any)[f.key]}
                    onChange={(e) => setNewTenant({ ...newTenant, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    style={inputStyle}
                  />
                </div>
              ))}
              {tiers.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>SaaS Tier</label>
                  <select
                    value={newTenant.saasTierId}
                    onChange={(e) => setNewTenant({ ...newTenant, saasTierId: e.target.value })}
                    style={{ ...inputStyle }}
                  >
                    {tiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} — ${(tier.monthlyFeeCents / 100).toLocaleString()}/mo
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowModal(false); setSaveError(null); }}
                disabled={saving}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '9px 20px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                style={{ background: saving ? 'rgba(255,68,68,0.5)' : '#FF4444', border: 'none', borderRadius: 6, padding: '9px 20px', color: '#FFF', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}
              >
                {saving ? 'Creating...' : 'Create Tenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tenants;
