import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApiFetch } from '../lib/api';

const API = '/api/admin';

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
  subscription?: {
    tier: { id: string; name: string; monthlyFeeCents: number } | null;
    status: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    gracePeriodStartedAt: string | null;
  };
}

interface TenantUser {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  active: boolean;
  createdAt: string;
}

interface TenantData {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  status: string;
  timezone: string;
  fiscalYearEnd: string;
  createdAt: string;
  connectedServices: { stripe: boolean; quickbooks: boolean };
  subscription: {
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
  users: TenantUser[];
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  ACTIVE: { label: 'Active', bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  TRIAL: { label: 'Trial', bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  GRACE_PERIOD: { label: 'Grace Period', bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  LOCKED: { label: 'Locked', bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
};

const ROLE_COLORS: Record<string, string> = {
  PLATFORM_ADMIN: '#F44336',
  MARINA_OWNER: '#00D4FF',
  MARINA_MANAGER: '#4CAF50',
  DOCK_STAFF: '#FF9800',
  POS_CASHIER: '#FF9800',
  ACCOUNTING: '#9C27B0',
  PORTAL_USER: '#64748B',
};

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  MARINA_OWNER: 'Marina Owner',
  MARINA_MANAGER: 'Manager',
  DOCK_STAFF: 'Dock Staff',
  POS_CASHIER: 'POS Cashier',
  ACCOUNTING: 'Accounting',
  PORTAL_USER: 'Portal User',
};

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu',
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
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
  color: active ? '#00D4FF' : 'rgba(255,255,255,0.5)',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #00D4FF' : '2px solid transparent',
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

const fmtCents = (c: number) =>
  (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

type Tab = 'overview' | 'subscription' | 'usage' | 'locations' | 'users';

interface AdminTier {
  id: string;
  name: string;
  monthlyFeeCents: number;
}

const BLANK_LOC = {
  name: '', address: '', city: '', state: '', zip: '', phone: '',
  timezone: 'America/New_York', active: true,
};

const LocationModal: React.FC<{
  initial?: Partial<Location>;
  onSave: (data: typeof BLANK_LOC) => Promise<void>;
  onClose: () => void;
}> = ({ initial, onSave, onClose }) => {
  const [form, setForm] = useState({
    ...BLANK_LOC,
    ...(initial ? {
      name: initial.name ?? '',
      address: initial.address ?? '',
      city: initial.city ?? '',
      state: initial.state ?? '',
      zip: initial.zip ?? '',
      phone: initial.phone ?? '',
      timezone: initial.timezone ?? 'America/New_York',
      active: initial.active !== undefined ? initial.active : true,
    } : {}),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = <K extends keyof typeof BLANK_LOC>(k: K, v: typeof BLANK_LOC[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const inp: React.CSSProperties = {
    width: '100%', background: '#0A1929', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6, padding: '8px 12px', color: '#FFF', fontSize: 13, boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#0D1B2A', borderRadius: 12, padding: 28, width: 520,
        border: '1px solid rgba(255,255,255,0.08)',
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', color: '#FFF', fontSize: 16 }}>
          {initial?.id ? 'Edit Location' : 'Add Location'}
        </h3>
        {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Location Name *</label>
            <input style={inp} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Main Dock" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Street Address</label>
            <input style={inp} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Marina Drive" />
          </div>
          <div>
            <label style={lbl}>City</label>
            <input style={inp} value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>State</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={form.state} onChange={(e) => set('state', e.target.value)}>
              <option value="">— Select —</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>ZIP Code</label>
            <input style={inp} value={form.zip} onChange={(e) => set('zip', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Phone</label>
            <input style={inp} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(555) 000-0000" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Timezone</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="loc-active" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            <label htmlFor="loc-active" style={{ ...lbl, margin: 0, cursor: 'pointer' }}>Active</label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{
            padding: '8px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button
            onClick={async () => {
              if (!form.name.trim()) { setErr('Location name is required'); return; }
              setSaving(true);
              try {
                await onSave(form);
                onClose();
              } catch (e: unknown) {
                setErr((e as Error).message || 'Save failed');
                setSaving(false);
              }
            }}
            disabled={saving}
            style={{
              padding: '8px 20px', background: '#00D4FF', border: 'none', borderRadius: 6,
              color: '#0A2342', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 13, opacity: saving ? 0.7 : 1,
            }}
          >{saving ? 'Saving…' : 'Save Location'}</button>
        </div>
      </div>
    </div>
  );
};

const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [locLoading, setLocLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [showLocModal, setShowLocModal] = useState(false);
  const [editingLoc, setEditingLoc] = useState<Location | undefined>();
  const [tiers, setTiers] = useState<AdminTier[]>([]);
  const [pickedTierByLoc, setPickedTierByLoc] = useState<Record<string, string>>({});
  const [billingBusyLocId, setBillingBusyLocId] = useState<string | null>(null);
  const [billingMsg, setBillingMsg] = useState<{ locId: string; kind: 'ok' | 'err'; text: string } | null>(null);

  const fetchTenant = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<TenantData>(`${API}/tenants/${id}`);
      setTenant(data);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load tenant');
    } finally {
      setLoading(false);
    }
  }, [id, apiFetch]);

  const fetchLocations = useCallback(async () => {
    if (!id) return;
    setLocLoading(true);
    try {
      const data = await apiFetch<Location[]>(`${API}/tenants/${id}/locations`);
      setLocations(Array.isArray(data) ? data : []);
    } finally {
      setLocLoading(false);
    }
  }, [id, apiFetch]);

  const fetchTiers = useCallback(async () => {
    try {
      const data = await apiFetch<{ tiers?: AdminTier[] } | AdminTier[]>(
        `${API}/billing/tiers`,
      );
      // Endpoint returns { tiers: [...] }; defend against future drift.
      const list = Array.isArray(data) ? data : data?.tiers ?? [];
      setTiers(list);
    } catch {
      setTiers([]);
    }
  }, [apiFetch]);

  useEffect(() => { fetchTenant(); }, [fetchTenant]);
  useEffect(() => {
    if (tab === 'locations') {
      fetchLocations();
      fetchTiers();
    }
  }, [tab, fetchLocations, fetchTiers]);

  const handleStartCheckout = async (loc: Location) => {
    const tierId = pickedTierByLoc[loc.id];
    if (!tierId) {
      setBillingMsg({ locId: loc.id, kind: 'err', text: 'Pick a plan first.' });
      return;
    }
    setBillingBusyLocId(loc.id);
    setBillingMsg(null);
    try {
      const data = await apiFetch<{ url: string | null }>(
        `${API}/locations/${loc.id}/billing/checkout`,
        {
          method: 'POST',
          body: JSON.stringify({ tierId }),
        },
      );
      if (data?.url) {
        await navigator.clipboard.writeText(data.url).catch(() => {});
        window.open(data.url, '_blank', 'noopener,noreferrer');
        setBillingMsg({
          locId: loc.id, kind: 'ok',
          text: 'Checkout opened in a new tab. Link copied to clipboard so you can send it to the marina owner.',
        });
      } else {
        setBillingMsg({ locId: loc.id, kind: 'err', text: 'Stripe did not return a URL.' });
      }
    } catch (e: unknown) {
      setBillingMsg({ locId: loc.id, kind: 'err', text: (e as Error).message || 'Checkout failed.' });
    } finally {
      setBillingBusyLocId(null);
    }
  };

  const handleOpenPortal = async (loc: Location) => {
    setBillingBusyLocId(loc.id);
    setBillingMsg(null);
    try {
      const data = await apiFetch<{ url: string }>(
        `${API}/locations/${loc.id}/billing/portal`,
        { method: 'POST' },
      );
      if (data?.url) {
        await navigator.clipboard.writeText(data.url).catch(() => {});
        window.open(data.url, '_blank', 'noopener,noreferrer');
        setBillingMsg({
          locId: loc.id, kind: 'ok',
          text: 'Portal opened in a new tab. Link copied to clipboard.',
        });
      } else {
        setBillingMsg({ locId: loc.id, kind: 'err', text: 'Stripe did not return a URL.' });
      }
    } catch (e: unknown) {
      setBillingMsg({ locId: loc.id, kind: 'err', text: (e as Error).message || 'Portal failed.' });
    } finally {
      setBillingBusyLocId(null);
    }
  };

  const handleSaveLocation = async (form: typeof BLANK_LOC) => {
    if (editingLoc) {
      await apiFetch(`${API}/tenants/${id}/locations/${editingLoc.id}`, {
        method: 'PUT', body: JSON.stringify(form),
      });
    } else {
      await apiFetch(`${API}/tenants/${id}/locations`, {
        method: 'POST', body: JSON.stringify(form),
      });
    }
    await fetchLocations();
  };

  const handleDeleteLocation = async (locId: string) => {
    if (!window.confirm('Delete this location? This cannot be undone.')) return;
    await apiFetch(`${API}/tenants/${id}/locations/${locId}`, { method: 'DELETE' });
    setLocations((prev) => prev.filter((l) => l.id !== locId));
  };

  if (loading) return (
    <div style={{ padding: 32, color: 'rgba(255,255,255,0.4)', textAlign: 'center', fontSize: 14 }}>
      Loading tenant…
    </div>
  );
  if (error) return (
    <div style={{ padding: 32, color: '#F44336', fontSize: 14 }}>{error}</div>
  );
  if (!tenant) return null;

  const statusCfg = STATUS_CONFIG[tenant.status] ?? {
    label: tenant.status, bg: 'rgba(255,255,255,0.1)', color: '#FFF',
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'subscription', label: 'Subscription' },
    { key: 'usage', label: 'Usage' },
    { key: 'locations', label: `Locations${locations.length > 0 ? ` (${locations.length})` : ''}` },
    { key: 'users', label: `Users (${tenant.users.length})` },
  ];

  return (
    <div style={{
      padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#FFF', minHeight: '100vh', background: '#060D18',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <button onClick={() => navigate('/tenants')} style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer', fontSize: 13, marginBottom: 8, padding: 0,
          }}>← Back to Tenants</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{tenant.name}</h1>
            <span style={{
              padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
              background: statusCfg.bg, color: statusCfg.color,
            }}>{statusCfg.label}</span>
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            {tenant.subdomain}.gethelm.com
            {tenant.customDomain ? ` · ${tenant.customDomain}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tenant.status === 'ACTIVE' ? (
            <button onClick={async () => {
              if (!window.confirm('Lock this tenant? They will lose access.')) return;
              try {
                await apiFetch(`${API}/tenants/${id}/lock`, { method: 'POST' });
                fetchTenant();
              } catch { window.alert('Failed to lock tenant'); }
            }} style={{
              padding: '8px 16px', background: 'transparent', border: '1px solid #F44336',
              borderRadius: 6, color: '#F44336', cursor: 'pointer', fontSize: 13,
            }}>Lock Tenant</button>
          ) : (
            <button onClick={async () => {
              try {
                await apiFetch(`${API}/tenants/${id}/unlock`, { method: 'POST' });
                fetchTenant();
              } catch { window.alert('Failed to unlock tenant'); }
            }} style={{
              padding: '8px 16px', background: '#4CAF50', border: 'none',
              borderRadius: 6, color: '#FFF', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>Unlock Tenant</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 24 }}>
        {TABS.map((t) => (
          <button key={t.key} style={tabBtn(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
              Account Details
            </div>
            {([
              ['Subdomain', tenant.subdomain],
              ['Custom Domain', tenant.customDomain || '—'],
              ['Timezone', tenant.timezone],
              ['Fiscal Year End', tenant.fiscalYearEnd],
              ['Created', fmtDate(tenant.createdAt)],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l} style={fieldRow}>
                <span style={fieldLabel}>{l}</span>
                <span style={fieldValue}>{v}</span>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
              Connected Integrations
            </div>
            {([
              ['Stripe Connect', tenant.connectedServices.stripe ? '✓ Connected' : '— Not connected', tenant.connectedServices.stripe ? '#4CAF50' : '#FF9800'],
              ['QuickBooks Online', tenant.connectedServices.quickbooks ? '✓ Connected' : '— Not connected', tenant.connectedServices.quickbooks ? '#4CAF50' : '#FF9800'],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={fieldRow}>
                <span style={fieldLabel}>{l}</span>
                <span style={{ ...fieldValue, color: c }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Subscription ── */}
      {tab === 'subscription' && (
        <div>
          {tenant.subscription ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
                {[
                  { label: 'Tier', value: tenant.subscription.tierName },
                  { label: 'Monthly Fee', value: fmtCents(tenant.subscription.monthlyFeeCents) },
                  { label: 'ACH Fee Rate', value: `${tenant.subscription.achFeeRate}%` },
                  { label: 'Card Fee Rate', value: `${tenant.subscription.cardFeeRate}%` },
                ].map((s) => (
                  <div key={s.label} style={card}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#FFF' }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={card}>
                <div style={fieldRow}>
                  <span style={fieldLabel}>Storage Limit</span>
                  <span style={fieldValue}>{tenant.subscription.storageLimitGb} GB</span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ ...card, textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: 40 }}>
              No subscription tier assigned to this tenant.
            </div>
          )}
        </div>
      )}

      {/* ── Usage ── */}
      {tab === 'usage' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { label: 'Slips', value: tenant.usage.slips.toLocaleString() },
            { label: 'Customers', value: tenant.usage.customers.toLocaleString() },
            { label: 'Invoices', value: tenant.usage.invoices.toLocaleString() },
            { label: 'Completed Payments', value: tenant.usage.completedPayments.toLocaleString() },
            { label: 'Total Payment Volume', value: fmtCents(tenant.usage.totalPaymentVolumeCents) },
          ].map((s) => (
            <div key={s.label} style={card}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#00D4FF' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Locations ── */}
      {tab === 'locations' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', maxWidth: 560, lineHeight: 1.5 }}>
              A location can be an entirely separate marina property, or a different physical terminal / area within the same marina (e.g. Main Dock office, Fuel Dock kiosk, Rental Center). Each gets its own point-of-sale and reporting context.
            </div>
            <button onClick={() => { setEditingLoc(undefined); setShowLocModal(true); }} style={{
              padding: '8px 18px', background: '#00D4FF', border: 'none', borderRadius: 6,
              color: '#0A2342', fontWeight: 700, cursor: 'pointer', fontSize: 13,
            }}>+ Add Location</button>
          </div>

          {locLoading ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', padding: 20, textAlign: 'center' }}>Loading locations…</div>
          ) : locations.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📍</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#FFF', marginBottom: 8 }}>No locations yet</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>
                Add locations like Main Dock, Fuel Dock, or Rental Center for this marina.
              </div>
              <button onClick={() => { setEditingLoc(undefined); setShowLocModal(true); }} style={{
                padding: '9px 20px', background: '#00D4FF', border: 'none', borderRadius: 6,
                color: '#0A2342', fontWeight: 700, cursor: 'pointer', fontSize: 13,
              }}>Add First Location</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {locations.map((loc) => (
                <div key={loc.id} style={{
                  ...card,
                  borderColor: loc.active ? 'rgba(0,212,255,0.2)' : 'rgba(255,255,255,0.06)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#FFF', marginBottom: 4 }}>{loc.name}</div>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: loc.active ? '#4CAF50' : '#94A3B8',
                        background: loc.active ? 'rgba(76,175,80,0.15)' : 'rgba(148,163,184,0.1)',
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                      }}>{loc.active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { setEditingLoc(loc); setShowLocModal(true); }} style={{
                        background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6, color: '#00D4FF', cursor: 'pointer',
                        padding: '4px 10px', fontSize: 12,
                      }}>Edit</button>
                      <button onClick={() => handleDeleteLocation(loc.id)} style={{
                        background: 'transparent', border: '1px solid rgba(244,67,54,0.3)',
                        borderRadius: 6, color: '#F44336', cursor: 'pointer',
                        padding: '4px 10px', fontSize: 12,
                      }}>Delete</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
                    {[
                      loc.address,
                      [loc.city, loc.state, loc.zip].filter(Boolean).join(', '),
                      loc.phone,
                    ].filter(Boolean).map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>{loc.timezone}</div>

                  {/* Per-location SaaS subscription summary + admin actions */}
                  <div style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                      Subscription
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                      <span>Tier</span>
                      <span style={{ fontWeight: 600, color: '#FFF' }}>
                        {loc.subscription?.tier
                          ? `${loc.subscription.tier.name} · ${fmtCents(loc.subscription.tier.monthlyFeeCents)}/mo`
                          : '— No tier —'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                      <span>Status</span>
                      <span style={{
                        fontWeight: 600,
                        color: loc.subscription?.status === 'active' ? '#4CAF50'
                          : loc.subscription?.status === 'past_due' ? '#FF9800'
                          : loc.subscription?.status === 'canceled' ? '#F44336'
                          : 'rgba(255,255,255,0.5)',
                      }}>
                        {loc.subscription?.status ?? 'Not subscribed'}
                      </span>
                    </div>
                    {loc.subscription?.gracePeriodStartedAt && (
                      <div style={{ fontSize: 11, color: '#FF9800', marginTop: 6 }}>
                        ⚠ In grace period since {new Date(loc.subscription.gracePeriodStartedAt).toLocaleDateString()}
                      </div>
                    )}

                    {/* Admin actions: start checkout when no sub, open portal when one exists. */}
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {loc.subscription?.stripeSubscriptionId ? (
                        <button
                          onClick={() => handleOpenPortal(loc)}
                          disabled={billingBusyLocId === loc.id}
                          style={{
                            background: 'transparent', border: '1px solid rgba(0,212,255,0.3)',
                            borderRadius: 6, color: '#00D4FF',
                            cursor: billingBusyLocId === loc.id ? 'wait' : 'pointer',
                            padding: '4px 10px', fontSize: 12,
                            opacity: billingBusyLocId === loc.id ? 0.6 : 1,
                          }}
                        >
                          {billingBusyLocId === loc.id ? 'Opening…' : 'Open Stripe Portal'}
                        </button>
                      ) : (
                        <>
                          <select
                            value={pickedTierByLoc[loc.id] ?? ''}
                            onChange={(e) =>
                              setPickedTierByLoc((p) => ({ ...p, [loc.id]: e.target.value }))
                            }
                            style={{
                              background: '#0A2342', color: '#FFF',
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: 6, padding: '4px 8px', fontSize: 12,
                            }}
                          >
                            <option value="">Pick plan…</option>
                            {tiers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} · {fmtCents(t.monthlyFeeCents)}/mo
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleStartCheckout(loc)}
                            disabled={billingBusyLocId === loc.id || !pickedTierByLoc[loc.id]}
                            style={{
                              background: '#00D4FF', border: 'none', borderRadius: 6,
                              color: '#0A2342', fontWeight: 700,
                              cursor: billingBusyLocId === loc.id ? 'wait' : 'pointer',
                              padding: '4px 10px', fontSize: 12,
                              opacity: (billingBusyLocId === loc.id || !pickedTierByLoc[loc.id]) ? 0.5 : 1,
                            }}
                          >
                            {billingBusyLocId === loc.id ? 'Starting…' : 'Start Checkout'}
                          </button>
                        </>
                      )}
                    </div>
                    {billingMsg && billingMsg.locId === loc.id && (
                      <div style={{
                        marginTop: 6, fontSize: 11,
                        color: billingMsg.kind === 'ok' ? '#4CAF50' : '#F44336',
                      }}>
                        {billingMsg.text}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Users ── */}
      {tab === 'users' && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
            Tenant Users ({tenant.users.length})
          </div>
          {tenant.users.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', padding: '20px 0', textAlign: 'center', fontSize: 13 }}>
              No users found for this tenant.
            </div>
          ) : (
            tenant.users.map((u) => (
              <div key={u.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#FFF' }}>
                    {u.firstName} {u.lastName}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{u.email}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 10,
                    background: ROLE_COLORS[u.role] ? `${ROLE_COLORS[u.role]}22` : 'rgba(255,255,255,0.1)',
                    color: ROLE_COLORS[u.role] ?? '#FFF',
                  }}>{ROLE_LABELS[u.role] ?? u.role}</span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: u.active ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.15)',
                    color: u.active ? '#4CAF50' : '#F44336',
                  }}>{u.active ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Location Modal */}
      {showLocModal && (
        <LocationModal
          initial={editingLoc}
          onSave={handleSaveLocation}
          onClose={() => { setShowLocModal(false); setEditingLoc(undefined); }}
        />
      )}
    </div>
  );
};

export default TenantDetail;
