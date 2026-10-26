import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch, errorMessage, formatCents, formatDate, useAdminResource } from '../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';

interface TenantRow {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  status: 'ACTIVE' | 'GRACE_PERIOD' | 'LOCKED';
  saasTier: { id: string; name: string } | null;
  mrrCents: number;
  userCount: number;
  createdAt: string;
}

interface TenantList {
  items: TenantRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface Tier {
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

const pagerBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 4,
  padding: '3px 10px',
  color: 'rgba(255,255,255,0.6)',
  fontSize: 12,
  cursor: 'pointer',
};

const td: React.CSSProperties = { padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' };

const Tenants: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', subdomain: '', email: '', tierId: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Debounce the search so we don't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debouncedSearch, statusFilter]);

  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (debouncedSearch) params.set('search', debouncedSearch);
  if (statusFilter !== 'all') params.set('status', statusFilter);
  const list = useAdminResource<TenantList>(`/tenants?${params.toString()}`);
  const tiers = useAdminResource<Tier[]>(showModal ? '/billing/tiers' : null);

  const rows = list.data?.items ?? [];
  const pagination = list.data?.pagination;

  const closeModal = () => {
    setShowModal(false);
    setCreateError(null);
    setNewTenant({ name: '', subdomain: '', email: '', tierId: '' });
  };

  const handleCreate = async () => {
    if (creating) return;
    if (!newTenant.name.trim() || !newTenant.subdomain.trim() || !newTenant.email.trim()) {
      setCreateError('Marina name, subdomain and admin email are required.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await adminFetch<{ id: string }>('/tenants', {
        method: 'POST',
        body: JSON.stringify({
          name: newTenant.name.trim(),
          subdomain: newTenant.subdomain.trim().toLowerCase(),
          adminEmail: newTenant.email.trim(),
          saasTierId: newTenant.tierId || undefined,
        }),
      });
      closeModal();
      navigate(`/tenants/${created.id}`);
    } catch (err) {
      setCreateError(errorMessage(err));
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
            <option value="ACTIVE">Active</option>
            <option value="GRACE_PERIOD">Grace Period</option>
            <option value="LOCKED">Locked</option>
          </select>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ background: '#0A2342', color: '#00D4FF', border: '1px solid #00D4FF', borderRadius: 6, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + Create Tenant
        </button>
      </div>

      {/* Table */}
      {list.loading && !list.data && <LoadingState label="Loading tenants…" />}
      {list.error && <ErrorState title="Could not load tenants" message={list.error} onRetry={list.refetch} />}
      {!list.error && list.data && rows.length === 0 && (
        <EmptyState message={debouncedSearch || statusFilter !== 'all' ? 'No tenants match these filters.' : 'No tenants yet.'} />
      )}
      {!list.error && rows.length > 0 && (
        <div style={card}>
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
              {rows.map((t) => {
                const sc = STATUS_CONFIG[t.status] ?? { label: t.status, bg: 'rgba(255,255,255,0.08)', color: '#FFF' };
                return (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/tenants/${t.id}`)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ ...td, fontSize: 13, fontWeight: 500, color: '#FFF' }}>{t.name}</td>
                    <td style={{ ...td, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{t.customDomain || `${t.subdomain}.helmhq.com`}</td>
                    <td style={td}>
                      <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{sc.label}</span>
                    </td>
                    <td style={{ ...td, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{t.saasTier?.name ?? 'No tier'}</td>
                    <td style={{ ...td, fontSize: 13, fontWeight: 600, color: t.mrrCents > 0 ? '#4CAF50' : 'rgba(255,255,255,0.3)' }}>
                      {t.mrrCents > 0 ? formatCents(t.mrrCents) : '—'}
                    </td>
                    <td style={{ ...td, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{t.userCount}</td>
                    <td style={{ ...td, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{formatDate(t.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Showing {rows.length} of {pagination?.total ?? rows.length} tenants</span>
            {pagination && pagination.totalPages > 1 && (
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={pagerBtn}>Prev</button>
                Page {pagination.page} of {pagination.totalPages}
                <button disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} style={pagerBtn}>Next</button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Create Tenant Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 32, width: 440 }}>
            <h3 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 700, color: '#FFF' }}>Create New Tenant</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {createError && (
                <div role="alert" style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#F44336' }}>
                  {createError}
                </div>
              )}
              {([
                { label: 'Marina Name', key: 'name', placeholder: 'e.g. Sunset Cove Marina' },
                { label: 'Subdomain', key: 'subdomain', placeholder: 'e.g. sunsetcove' },
                { label: 'Admin Email', key: 'email', placeholder: 'e.g. admin@marina.com' },
              ] as const).map((f) => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>{f.label}</label>
                  <input
                    value={newTenant[f.key]}
                    onChange={(e) => setNewTenant({ ...newTenant, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '9px 12px', color: '#FFF', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>SaaS Tier</label>
                <select
                  value={newTenant.tierId}
                  onChange={(e) => setNewTenant({ ...newTenant, tierId: e.target.value })}
                  style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '9px 12px', color: '#FFF', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                >
                  <option value="">{tiers.loading ? 'Loading tiers…' : 'No tier'}</option>
                  {(tiers.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name} — {formatCents(t.monthlyFeeCents)}/mo</option>
                  ))}
                </select>
                {tiers.error && <div style={{ fontSize: 12, color: '#F44336', marginTop: 6 }}>Could not load tiers: {tiers.error}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '9px 20px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleCreate}
                disabled={creating}
                style={{ background: '#0A2342', border: '1px solid #00D4FF', borderRadius: 6, padding: '9px 20px', color: '#00D4FF', fontSize: 13, fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.6 : 1 }}
              >
                {creating ? 'Creating…' : 'Create Tenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tenants;
