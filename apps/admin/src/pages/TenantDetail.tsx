import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface TenantData {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  status: string;
  timezone: string;
  fiscalYearEnd: string;
  createdAt: string;
  updatedAt: string;
  connectedServices: { stripe: boolean; quickbooks: boolean };
  subscription: {
    tierId: string;
    tierName: string;
    monthlyFeeCents: number;
    achFeeRate: number;
    cardFeeRate: number;
    storageLimitGb: number;
  } | null;
  usage: {
    slips: number;
    customers: number;
    invoices: number;
    completedPayments: number;
    totalPaymentVolumeCents: number;
  };
  users: Array<{ id: string; email: string; role: string; firstName: string; lastName: string; active: boolean }>;
}

interface Location {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  timezone: string;
  active: boolean;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  ACTIVE: { label: 'Active', bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  GRACE_PERIOD: { label: 'Grace Period', bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  LOCKED: { label: 'Locked', bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
};

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico',
];

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

const emptyLoc: Omit<Location, 'id' | 'tenantId' | 'createdAt' | 'active'> = {
  name: '', address: '', city: '', state: '', zip: '', phone: '', timezone: 'America/New_York',
};

const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'subscription' | 'usage' | 'locations' | 'users'>('overview');
  const [actionLoading, setActionLoading] = useState(false);

  const [showLocModal, setShowLocModal] = useState(false);
  const [editingLoc, setEditingLoc] = useState<Location | null>(null);
  const [locForm, setLocForm] = useState<typeof emptyLoc>({ ...emptyLoc });
  const [locSaving, setLocSaving] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const fetchTenant = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/tenants/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTenant(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load tenant');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchLocations = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/admin/tenants/${id}/locations`);
      if (!res.ok) return;
      setLocations(await res.json());
    } catch {
    }
  }, [id]);

  useEffect(() => {
    fetchTenant();
    fetchLocations();
  }, [fetchTenant, fetchLocations]);

  const handleLockUnlock = async (action: 'lock' | 'unlock') => {
    if (!id) return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/admin/tenants/${id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || 'Action failed');
        return;
      }
      fetchTenant();
    } finally {
      setActionLoading(false);
    }
  };

  const openAddLoc = () => {
    setEditingLoc(null);
    setLocForm({ ...emptyLoc });
    setLocError(null);
    setShowLocModal(true);
  };

  const openEditLoc = (loc: Location) => {
    setEditingLoc(loc);
    setLocForm({
      name: loc.name,
      address: loc.address ?? '',
      city: loc.city ?? '',
      state: loc.state ?? '',
      zip: loc.zip ?? '',
      phone: loc.phone ?? '',
      timezone: loc.timezone,
    });
    setLocError(null);
    setShowLocModal(true);
  };

  const saveLoc = async () => {
    if (!locForm.name.trim()) {
      setLocError('Location name is required.');
      return;
    }
    try {
      setLocSaving(true);
      setLocError(null);
      const url = editingLoc
        ? `/api/admin/tenants/${id}/locations/${editingLoc.id}`
        : `/api/admin/tenants/${id}/locations`;
      const method = editingLoc ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(locForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setShowLocModal(false);
      fetchLocations();
    } catch (e: any) {
      setLocError(e.message || 'Failed to save location');
    } finally {
      setLocSaving(false);
    }
  };

  const deactivateLoc = async (locId: string) => {
    if (!confirm('Deactivate this location?')) return;
    await fetch(`/api/admin/tenants/${id}/locations/${locId}`, { method: 'DELETE' });
    fetchLocations();
  };

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>Loading tenant...</div>;
  }

  if (error || !tenant) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ color: '#F44336', marginBottom: 16 }}>{error || 'Tenant not found'}</div>
        <button onClick={() => navigate('/tenants')} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '8px 16px', color: '#FFF', cursor: 'pointer' }}>← Back to Tenants</button>
      </div>
    );
  }

  const sc = STATUS_CONFIG[tenant.status] ?? STATUS_CONFIG.ACTIVE;
  const mrr = tenant.subscription ? `$${(tenant.subscription.monthlyFeeCents / 100).toLocaleString()}/mo` : 'No tier';
  const activeLocations = locations.filter((l) => l.active);

  return (
    <div>
      {/* Header */}
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => navigate('/tenants')} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 20, padding: 0 }}>←</button>
          <div style={{ width: 48, height: 48, borderRadius: 8, background: '#0A2342', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF4444', fontSize: 20, fontWeight: 700, border: '1px solid rgba(255,68,68,0.3)' }}>
            {tenant.name.charAt(0)}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#FFF' }}>{tenant.name}</h2>
              <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{sc.label}</span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
              {tenant.subdomain}.helmhq.com · {tenant.subscription?.tierName ?? 'No tier'} · {mrr}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {tenant.status === 'LOCKED' ? (
            <button
              onClick={() => handleLockUnlock('unlock')}
              disabled={actionLoading}
              style={{ background: 'rgba(76,175,80,0.15)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.3)', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Unlock Tenant
            </button>
          ) : (
            <button
              onClick={() => handleLockUnlock('lock')}
              disabled={actionLoading}
              style={{ background: 'rgba(244,67,54,0.15)', color: '#F44336', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Lock Tenant
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 20, display: 'flex' }}>
        {(['overview', 'subscription', 'usage', 'locations', 'users'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
            {t === 'locations' ? `Locations (${activeLocations.length})` : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Contact Info</div>
            {[
              ['Subdomain', `${tenant.subdomain}.helmhq.com`],
              ['Custom Domain', tenant.customDomain || 'Not configured'],
              ['Timezone', tenant.timezone],
              ['Fiscal Year End', tenant.fiscalYearEnd],
              ['Created', new Date(tenant.createdAt).toLocaleDateString()],
            ].map(([l, v]) => (
              <div key={l} style={fieldRow}>
                <span style={fieldLabel}>{l}</span>
                <span style={fieldValue}>{v}</span>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Integrations</div>
            {[
              ['Stripe Connect', tenant.connectedServices.stripe ? 'Connected' : 'Not connected'],
              ['QuickBooks Online', tenant.connectedServices.quickbooks ? 'Connected' : 'Not connected'],
            ].map(([l, v]) => (
              <div key={l} style={fieldRow}>
                <span style={fieldLabel}>{l}</span>
                <span style={{ ...fieldValue, color: v === 'Connected' ? '#4CAF50' : '#FF9800' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription */}
      {tab === 'subscription' && (
        tenant.subscription ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
            {[
              { label: 'Current Tier', value: tenant.subscription.tierName },
              { label: 'Monthly Fee', value: `$${(tenant.subscription.monthlyFeeCents / 100).toLocaleString()}` },
              { label: 'ACH Fee Rate', value: `${tenant.subscription.achFeeRate}%` },
              { label: 'Card Fee Rate', value: `${tenant.subscription.cardFeeRate}%` },
            ].map((s) => (
              <div key={s.label} style={card}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#FFF' }}>{s.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No SaaS tier assigned to this tenant.</div>
        )
      )}

      {/* Usage */}
      {tab === 'usage' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { label: 'Slips', value: tenant.usage.slips.toLocaleString(), color: '#2196F3' },
            { label: 'Customers', value: tenant.usage.customers.toLocaleString(), color: '#4CAF50' },
            { label: 'Invoices', value: tenant.usage.invoices.toLocaleString(), color: '#FF9800' },
            { label: 'Completed Payments', value: tenant.usage.completedPayments.toLocaleString(), color: '#9C27B0' },
            { label: 'Total Payment Volume', value: `$${(tenant.usage.totalPaymentVolumeCents / 100).toLocaleString()}`, color: '#00BCD4' },
            { label: 'Locations', value: activeLocations.length.toString(), color: '#FF4444' },
          ].map((s) => (
            <div key={s.label} style={card}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Locations */}
      {tab === 'locations' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button
              onClick={openAddLoc}
              style={{ background: '#FF4444', color: '#FFF', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + Add Location
            </button>
          </div>
          <div style={card}>
            {locations.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                No locations yet. Add the first marina location for this tenant.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Name', 'Address', 'City / State', 'Phone', 'Timezone', 'Status', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {locations.map((loc) => (
                    <tr key={loc.id}>
                      <td style={{ padding: '12px', fontSize: 13, fontWeight: 500, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{loc.name}</td>
                      <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{loc.address || '—'}</td>
                      <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {[loc.city, loc.state].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{loc.phone || '—'}</td>
                      <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{loc.timezone}</td>
                      <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ background: loc.active ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.12)', color: loc.active ? '#4CAF50' : '#F44336', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                          {loc.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'right' }}>
                        <button onClick={() => openEditLoc(loc)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, padding: '5px 12px', color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer', marginRight: 8 }}>Edit</button>
                        {loc.active && (
                          <button onClick={() => deactivateLoc(loc.id)} style={{ background: 'transparent', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 5, padding: '5px 12px', color: '#F44336', fontSize: 12, cursor: 'pointer' }}>Deactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Users */}
      {tab === 'users' && (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Role', 'Status'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenant.users.map((u) => (
                <tr key={u.id}>
                  <td style={{ padding: '12px', fontSize: 13, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{u.firstName} {u.lastName}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{u.email}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{u.role}</td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ background: u.active ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.12)', color: u.active ? '#4CAF50' : '#F44336', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {tenant.users.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No users</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Location Modal */}
      {showLocModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 32, width: 480 }}>
            <h3 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 700, color: '#FFF' }}>
              {editingLoc ? 'Edit Location' : 'Add Location'}
            </h3>
            {locError && (
              <div style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, padding: '10px 14px', color: '#F44336', fontSize: 13, marginBottom: 16 }}>{locError}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Location Name *</label>
                <input value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} placeholder="e.g. Main Marina" style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Street Address</label>
                <input value={locForm.address ?? ''} onChange={(e) => setLocForm({ ...locForm, address: e.target.value })} placeholder="e.g. 123 Harbor Dr" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>City</label>
                <input value={locForm.city ?? ''} onChange={(e) => setLocForm({ ...locForm, city: e.target.value })} placeholder="e.g. Miami" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>State</label>
                <input value={locForm.state ?? ''} onChange={(e) => setLocForm({ ...locForm, state: e.target.value })} placeholder="e.g. FL" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>ZIP Code</label>
                <input value={locForm.zip ?? ''} onChange={(e) => setLocForm({ ...locForm, zip: e.target.value })} placeholder="e.g. 33101" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Phone</label>
                <input value={locForm.phone ?? ''} onChange={(e) => setLocForm({ ...locForm, phone: e.target.value })} placeholder="e.g. (555) 123-4567" style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Timezone</label>
                <select value={locForm.timezone} onChange={(e) => setLocForm({ ...locForm, timezone: e.target.value })} style={{ ...inputStyle }}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowLocModal(false)}
                disabled={locSaving}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '9px 20px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={saveLoc}
                disabled={locSaving}
                style={{ background: locSaving ? 'rgba(255,68,68,0.5)' : '#FF4444', border: 'none', borderRadius: 6, padding: '9px 20px', color: '#FFF', fontSize: 13, fontWeight: 600, cursor: locSaving ? 'default' : 'pointer' }}
              >
                {locSaving ? 'Saving...' : editingLoc ? 'Save Changes' : 'Add Location'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantDetail;
