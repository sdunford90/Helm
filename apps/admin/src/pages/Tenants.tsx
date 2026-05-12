import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiFetch } from '../lib/api';

interface ApiTenant {
  id: string;
  name: string;
  subdomain: string;
  status: 'active' | 'trial' | 'grace_period' | 'locked';
  saasTier: { id: string; name: string } | null;
  mrrCents: number;
  userCount: number;
  createdAt: string;
}

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  status: 'active' | 'trial' | 'grace_period' | 'locked';
  tier: string;
  mrr: number;
  slips: number;
  created: string;
  adminEmail: string;
  userCount: number;
}

interface SaasTier {
  id: string;
  name: string;
  monthlyFeeCents: number;
}

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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: 'rgba(255,255,255,0.5)',
  marginBottom: 6,
};

function mapTenant(t: ApiTenant): Tenant {
  // The Prisma enum comes back uppercase (e.g. "TRIAL"); the local UI was
  // built around the lowercase variants, so normalize once on the boundary.
  const normalized = String(t.status ?? '').toLowerCase() as Tenant['status'];
  return {
    id: t.id,
    name: t.name,
    subdomain: t.subdomain,
    status: normalized,
    tier: t.saasTier?.name ?? 'Unknown',
    mrr: Math.round(t.mrrCents / 100),
    slips: 0,
    created: new Date(t.createdAt).toISOString().slice(0, 10),
    adminEmail: '—',
    userCount: t.userCount,
  };
}

interface NewTenantForm {
  name: string;
  subdomain: string;
  adminEmail: string;
  saasTierId: string;
  locationName: string;
  locationTimezone: string;
  locationCity: string;
  locationState: string;
}

const EMPTY_NEW_TENANT: NewTenantForm = {
  name: '',
  subdomain: '',
  adminEmail: '',
  saasTierId: '',
  locationName: '',
  locationTimezone: 'America/New_York',
  locationCity: '',
  locationState: '',
};

const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateNewTenant(form: NewTenantForm): string | null {
  if (!form.name.trim()) return 'Marina name is required.';
  if (!form.subdomain.trim()) return 'Subdomain is required.';
  if (!SUBDOMAIN_RE.test(form.subdomain.trim())) {
    return 'Subdomain must be lowercase letters, numbers, and hyphens (3+ chars).';
  }
  if (!form.adminEmail.trim()) return 'Admin email is required.';
  if (!EMAIL_RE.test(form.adminEmail.trim())) return 'Admin email is not a valid address.';
  if (!form.saasTierId) return 'Please select a SaaS tier.';
  if (!form.locationName.trim()) return 'An initial location name is required.';
  return null;
}

interface SaasTierOption { id: string; name: string; monthlyFeeCents: number }


const Tenants: React.FC = () => {
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [newTenant, setNewTenant] = useState<NewTenantForm>(EMPTY_NEW_TENANT);
  const [creating, setCreating] = useState(false);
  const [tiers, setTiers] = useState<SaasTier[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  // Bulk selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tierOptions, setTierOptions] = useState<SaasTierOption[]>([]);
  const [showTierModal, setShowTierModal] = useState(false);
  const [bulkTierId, setBulkTierId] = useState('');
  const [showAnnounceModal, setShowAnnounceModal] = useState(false);
  const [announceForm, setAnnounceForm] = useState({ subject: '', body: '', isEmergency: false });

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter.toUpperCase());
      const res = await apiFetch<{ items: ApiTenant[]; pagination: { total: number } }>(`/api/admin/tenants?${params}`);
      setTenants(res.items.map(mapTenant));
      setTotal(res.pagination.total);
    } catch {
      setTenants([]);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, statusFilter]);

  const fetchTiers = useCallback(async () => {
    try {
      const res = await apiFetch<{ tiers: SaasTier[] }>('/api/admin/billing/tiers');
      setTiers(res.tiers);
    } catch {
      setTiers([]);
    }
  }, []);

  const fetchTierOptions = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: SaasTierOption[] } | SaasTierOption[]>('/api/admin/saas-tiers');
      const items = Array.isArray(res) ? res : (res.items ?? []);
      setTierOptions(items);
    } catch {
      setTierOptions([]);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
    fetchTiers();
    fetchTierOptions();
  }, [fetchTenants, fetchTiers, fetchTierOptions]);

  const openModal = () => {
    setNewTenant({
      ...EMPTY_NEW_TENANT,
      saasTierId: tiers[0]?.id ?? '',
    });
    setCreateError(null);
    setShowModal(true);
  };

  const filtered = tenants.filter((t) => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.subdomain.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (filtered.every((t) => selected.has(t.id)) && filtered.length > 0) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((t) => next.delete(t.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((t) => next.add(t.id));
        return next;
      });
    }
  };

  const selectedIds = Array.from(selected);

  const runBulk = async (path: string, body: Record<string, unknown>, successLabel: string) => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await apiFetch<{ updated?: number; created?: number; skipped?: number }>(path, {
        method: 'POST',
        body: JSON.stringify({ tenantIds: selectedIds, ...body }),
      });
      const count = res.updated ?? res.created ?? 0;
      window.alert(`${successLabel}: ${count} tenant(s)${res.skipped ? `, ${res.skipped} skipped` : ''}.`);
      setSelected(new Set());
      await fetchTenants();
    } catch {
      window.alert(`${successLabel} failed.`);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkLock = async () => {
    if (!window.confirm(`Lock ${selectedIds.length} tenant(s)? They will lose access immediately.`)) return;
    await runBulk('/api/admin/bulk/tenants/lock', {}, 'Locked');
  };
  const handleBulkUnlock = async () => {
    if (!window.confirm(`Unlock ${selectedIds.length} tenant(s)?`)) return;
    await runBulk('/api/admin/bulk/tenants/unlock', {}, 'Unlocked');
  };
  const handleBulkTierApply = async () => {
    if (!bulkTierId) return;
    await runBulk('/api/admin/bulk/tenants/tier', { saasTierId: bulkTierId }, 'Tier changed');
    setShowTierModal(false);
    setBulkTierId('');
  };
  const handleBulkAnnounce = async () => {
    if (!announceForm.subject.trim() || !announceForm.body.trim()) {
      window.alert('Subject and body are required.');
      return;
    }
    await runBulk('/api/admin/bulk/tenants/announce', announceForm, 'Announcement sent');
    setShowAnnounceModal(false);
    setAnnounceForm({ subject: '', body: '', isEmergency: false });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));

  const handleCreateTenant = async () => {
    setCreateError(null);
    const validationError = validateNewTenant(newTenant);
    if (validationError) {
      setCreateError(validationError);
      return;
    }
    setCreating(true);
    try {
      await apiFetch('/api/admin/tenants', {
        method: 'POST',
        body: JSON.stringify({
          name: newTenant.name.trim(),
          subdomain: newTenant.subdomain.trim().toLowerCase(),
          adminEmail: newTenant.adminEmail.trim(),
          saasTierId: newTenant.saasTierId,
          initialLocation: {
            name: newTenant.locationName.trim(),
            timezone: newTenant.locationTimezone.trim() || 'America/New_York',
            city: newTenant.locationCity.trim() || undefined,
            state: newTenant.locationState.trim() || undefined,
          },
        }),
      });
      setShowModal(false);
      setNewTenant(EMPTY_NEW_TENANT);
      await fetchTenants();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create tenant');
    } finally {
      setCreating(false);
    }
  };

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
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate('/tenants/new')}
            style={{ background: '#00D4FF', color: '#070E18', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            + Onboard Tenant
          </button>
          <button
            onClick={openModal}
            style={{ background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '9px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            Quick create
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading tenants...</div>
      )}

      {/* Bulk actions toolbar */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.3)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 12,
        }}>
          <div style={{ fontSize: 13, color: '#FFF' }}>
            <strong>{selected.size}</strong> selected
            <button
              onClick={() => setSelected(new Set())}
              style={{
                marginLeft: 12, background: 'transparent', border: 'none',
                color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12,
              }}
            >Clear</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleBulkLock}
              disabled={bulkBusy}
              style={{
                padding: '7px 14px', background: 'transparent', border: '1px solid #F44336',
                borderRadius: 6, color: '#F44336', fontSize: 12, fontWeight: 600,
                cursor: bulkBusy ? 'wait' : 'pointer',
              }}
            >Lock</button>
            <button
              onClick={handleBulkUnlock}
              disabled={bulkBusy}
              style={{
                padding: '7px 14px', background: 'transparent', border: '1px solid #4CAF50',
                borderRadius: 6, color: '#4CAF50', fontSize: 12, fontWeight: 600,
                cursor: bulkBusy ? 'wait' : 'pointer',
              }}
            >Unlock</button>
            <button
              onClick={() => setShowTierModal(true)}
              disabled={bulkBusy}
              style={{
                padding: '7px 14px', background: 'transparent', border: '1px solid #00D4FF',
                borderRadius: 6, color: '#00D4FF', fontSize: 12, fontWeight: 600,
                cursor: bulkBusy ? 'wait' : 'pointer',
              }}
            >Change Tier</button>
            <button
              onClick={() => setShowAnnounceModal(true)}
              disabled={bulkBusy}
              style={{
                padding: '7px 14px', background: '#9C27B0', border: 'none',
                borderRadius: 6, color: '#FFF', fontSize: 12, fontWeight: 600,
                cursor: bulkBusy ? 'wait' : 'pointer',
              }}
            >Send Announcement</button>
          </div>
        </div>
      )}

      {!loading && (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ width: 36, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                {['Marina Name', 'Subdomain', 'Status', 'SaaS Tier', 'MRR', 'Users', 'Created'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 48, fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
                    No tenants found.
                  </td>
                </tr>
              )}
              {filtered.map((t) => {
                const sc = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.active;
                const isSelected = selected.has(t.id);
                return (
                  <tr
                    key={t.id}
                    style={{
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      background: isSelected ? 'rgba(0,212,255,0.06)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td
                      style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(t.id)}
                        aria-label={`Select ${t.name}`}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td onClick={() => navigate(`/tenants/${t.id}`)} style={{ padding: '12px', fontSize: 13, fontWeight: 500, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.name}</td>
                    <td onClick={() => navigate(`/tenants/${t.id}`)} style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.subdomain}.helmhq.com</td>
                    <td onClick={() => navigate(`/tenants/${t.id}`)} style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{sc.label}</span>
                    </td>
                    <td onClick={() => navigate(`/tenants/${t.id}`)} style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.tier}</td>
                    <td onClick={() => navigate(`/tenants/${t.id}`)} style={{ padding: '12px', fontSize: 13, fontWeight: 600, color: t.mrr > 0 ? '#4CAF50' : 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.mrr > 0 ? `$${t.mrr}/mo` : 'Free'}</td>
                    <td onClick={() => navigate(`/tenants/${t.id}`)} style={{ padding: '12px', fontSize: 13, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.userCount}</td>
                    <td onClick={() => navigate(`/tenants/${t.id}`)} style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.created}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
            Showing {filtered.length} of {total} tenants
          </div>
        </div>
      )}

      {/* Bulk Tier Change Modal */}
      {showTierModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 28, width: 420 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#FFF' }}>Change tier for {selected.size} tenant(s)</h3>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>
              Each tenant's billing tier will be switched. Their next SaaS invoice will reflect the new pricing.
            </div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Target Tier</label>
            <select
              value={bulkTierId}
              onChange={(e) => setBulkTierId(e.target.value)}
              style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '9px 12px', color: '#FFF', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            >
              <option value="">— Select a tier —</option>
              {tierOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name} — ${(t.monthlyFeeCents / 100).toFixed(0)}/mo</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowTierModal(false); setBulkTierId(''); }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '9px 20px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleBulkTierApply}
                disabled={!bulkTierId || bulkBusy}
                style={{ background: '#0A2342', border: '1px solid #00D4FF', borderRadius: 6, padding: '9px 20px', color: '#00D4FF', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: !bulkTierId || bulkBusy ? 0.5 : 1 }}
              >Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Announcement Modal */}
      {showAnnounceModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 28, width: 520 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#FFF' }}>Send announcement to {selected.size} tenant(s)</h3>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>
              Posts a platform announcement into each tenant's announcement inbox. Mark as emergency to flag urgent outages or required action.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Subject</label>
                <input
                  value={announceForm.subject}
                  onChange={(e) => setAnnounceForm((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="Scheduled maintenance window"
                  style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '9px 12px', color: '#FFF', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Message</label>
                <textarea
                  value={announceForm.body}
                  onChange={(e) => setAnnounceForm((f) => ({ ...f, body: e.target.value }))}
                  rows={5}
                  placeholder="We will be performing scheduled maintenance on…"
                  style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '9px 12px', color: '#FFF', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={announceForm.isEmergency}
                  onChange={(e) => setAnnounceForm((f) => ({ ...f, isEmergency: e.target.checked }))}
                />
                Mark as emergency
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAnnounceModal(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '9px 20px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleBulkAnnounce}
                disabled={bulkBusy}
                style={{ background: '#9C27B0', border: 'none', borderRadius: 6, padding: '9px 20px', color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: bulkBusy ? 0.5 : 1 }}
              >Send</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Tenant Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 32, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#FFF' }}>Create New Tenant</h3>
            <p style={{ margin: '0 0 24px', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              Each marina is its own billable location. Subscriptions are charged per location.
            </p>

            {createError && (
              <div
                role="alert"
                style={{
                  background: 'rgba(244,67,54,0.1)',
                  border: '1px solid rgba(244,67,54,0.4)',
                  color: '#FF8A80',
                  padding: '10px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  marginBottom: 16,
                }}
              >
                {createError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle}>Marina (Tenant) Name</label>
                <input
                  value={newTenant.name}
                  onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                  placeholder="e.g. Sunset Cove Marinas"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Subdomain</label>
                <input
                  value={newTenant.subdomain}
                  onChange={(e) => setNewTenant({ ...newTenant, subdomain: e.target.value.toLowerCase() })}
                  placeholder="e.g. sunsetcove"
                  style={inputStyle}
                />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                  Will be reachable at <code>{newTenant.subdomain || 'your-subdomain'}.helmhq.com</code>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Admin Email</label>
                <input
                  type="email"
                  value={newTenant.adminEmail}
                  onChange={(e) => setNewTenant({ ...newTenant, adminEmail: e.target.value })}
                  placeholder="e.g. owner@marina.com"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>SaaS Tier</label>
                <select
                  value={newTenant.saasTierId}
                  onChange={(e) => setNewTenant({ ...newTenant, saasTierId: e.target.value })}
                  style={inputStyle}
                >
                  <option value="">— Select a tier —</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — ${(t.monthlyFeeCents / 100).toFixed(0)}/mo
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                Initial Location
              </div>

              <div>
                <label style={labelStyle}>Location Name</label>
                <input
                  value={newTenant.locationName}
                  onChange={(e) => setNewTenant({ ...newTenant, locationName: e.target.value })}
                  placeholder="e.g. Sunset Cove – Main Harbor"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>City</label>
                  <input
                    value={newTenant.locationCity}
                    onChange={(e) => setNewTenant({ ...newTenant, locationCity: e.target.value })}
                    placeholder="e.g. Annapolis"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>State</label>
                  <input
                    value={newTenant.locationState}
                    onChange={(e) => setNewTenant({ ...newTenant, locationState: e.target.value })}
                    placeholder="MD"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Timezone</label>
                <input
                  value={newTenant.locationTimezone}
                  onChange={(e) => setNewTenant({ ...newTenant, locationTimezone: e.target.value })}
                  placeholder="America/New_York"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowModal(false)}
                disabled={creating}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '9px 20px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTenant}
                disabled={creating}
                style={{ background: '#0A2342', border: '1px solid #00D4FF', borderRadius: 6, padding: '9px 20px', color: '#00D4FF', fontSize: 13, fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}
              >
                {creating ? 'Creating...' : 'Create Tenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tenants;
