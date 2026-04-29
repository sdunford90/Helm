import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API = '/api/admin';

interface ActivityItem {
  id: string;
  createdAt: string;
  action: string;
  actorEmail: string | null;
  actorName: string | null;
  actorUserId: string | null;
  actorAdminRole: string | null;
  targetType: string | null;
  targetId: string | null;
  targetTenantId: string | null;
  targetTenant: { id: string; name: string; subdomain: string } | null;
  detailsJson: unknown;
  ipAddress: string | null;
}

interface ActivityResponse {
  items: ActivityItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const filterInput: React.CSSProperties = {
  background: '#070E18',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#FFF',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const filterLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'rgba(255,255,255,0.4)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const ACTION_COLORS: Record<string, string> = {
  TENANT_LOCK: '#F44336',
  TENANT_UNLOCK: '#4CAF50',
  TENANT_IMPERSONATE: '#FF9800',
  TENANT_DELETE_REQUEST: '#F44336',
  TENANT_DELETE_CANCEL: '#4CAF50',
  TENANT_DELETE_EXECUTE: '#F44336',
  TENANT_EXPORT_REQUEST: '#00D4FF',
  TENANT_EXPORT_DOWNLOAD: '#00D4FF',
  ADMIN_ROLE_CHANGE: '#9C27B0',
  ADMIN_INVITE: '#9C27B0',
  ADMIN_DEACTIVATE: '#F44336',
};

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
};

const AdminActivity: React.FC = () => {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [filters, setFilters] = useState({
    actor: '',
    action: '',
    tenantId: '',
    startDate: '',
    endDate: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
      });
      if (appliedFilters.actor) params.set('actor', appliedFilters.actor);
      if (appliedFilters.action) params.set('action', appliedFilters.action);
      if (appliedFilters.tenantId) params.set('tenantId', appliedFilters.tenantId);
      if (appliedFilters.startDate) params.set('startDate', appliedFilters.startDate);
      if (appliedFilters.endDate) params.set('endDate', appliedFilters.endDate);

      const res = await fetch(`${API}/activity?${params}`);
      if (!res.ok) throw new Error(`Failed to load activity (${res.status})`);
      const data: ActivityResponse = await res.json();
      setItems(data.items);
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.totalPages);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, appliedFilters]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  useEffect(() => {
    fetch(`${API}/activity/actions`)
      .then((r) => r.json())
      .then((d: { actions: string[] }) => setActions(d.actions))
      .catch(() => undefined);
  }, []);

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters(filters);
  };

  const clearFilters = () => {
    const empty = { actor: '', action: '', tenantId: '', startDate: '', endDate: '' };
    setFilters(empty);
    setPage(1);
    setAppliedFilters(empty);
  };

  const hasActiveFilters = useMemo(
    () => Object.values(appliedFilters).some(Boolean),
    [appliedFilters],
  );

  return (
    <div>
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)',
          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16,
        }}>Filters</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
          marginBottom: 16,
        }}>
          <div>
            <label style={filterLabel}>Actor (email or user ID)</label>
            <input
              style={filterInput}
              placeholder="admin@helmhq.com"
              value={filters.actor}
              onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </div>
          <div>
            <label style={filterLabel}>Action</label>
            <select
              style={filterInput}
              value={filters.action}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={filterLabel}>Target tenant ID</label>
            <input
              style={filterInput}
              placeholder="tenant uuid"
              value={filters.tenantId}
              onChange={(e) => setFilters((f) => ({ ...f, tenantId: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </div>
          <div>
            <label style={filterLabel}>From</label>
            <input
              style={filterInput}
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label style={filterLabel}>To</label>
            <input
              style={filterInput}
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {hasActiveFilters && (
            <button onClick={clearFilters} style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6, padding: '8px 16px', color: 'rgba(255,255,255,0.6)',
              fontSize: 13, cursor: 'pointer',
            }}>Clear</button>
          )}
          <button onClick={applyFilters} style={{
            background: '#00D4FF', border: 'none', borderRadius: 6,
            padding: '8px 18px', color: '#0A2342', fontSize: 13,
            fontWeight: 700, cursor: 'pointer',
          }}>Apply Filters</button>
        </div>
      </div>

      <div style={card}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
        }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase', letterSpacing: 1,
          }}>
            {total.toLocaleString()} {total === 1 ? 'event' : 'events'}
            {hasActiveFilters ? ' (filtered)' : ''}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            Page {page} of {Math.max(1, totalPages)}
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.3)',
            borderRadius: 6, padding: 12, color: '#F44336', fontSize: 13, marginBottom: 16,
          }}>{error}</div>
        )}

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            Loading activity…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
            No admin activity matching the current filters.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Time', 'Actor', 'Action', 'Target', 'Details'].map((h) => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 12px', fontSize: 11,
                    fontWeight: 600, color: 'rgba(255,255,255,0.4)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const open = !!expanded[item.id];
                const color = ACTION_COLORS[item.action] ?? '#94A3B8';
                return (
                  <React.Fragment key={item.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() =>
                      setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}>
                      <td style={{
                        padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.7)',
                        borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap',
                      }}>{fmtDateTime(item.createdAt)}</td>
                      <td style={{
                        padding: '12px', fontSize: 13, color: '#FFF', fontWeight: 500,
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                      }}>
                        <div>{item.actorEmail ?? item.actorName ?? '—'}</div>
                        {item.actorAdminRole && (
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                            {item.actorAdminRole}
                          </div>
                        )}
                      </td>
                      <td style={{
                        padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                      }}>
                        <span style={{
                          background: `${color}22`, color, padding: '3px 10px',
                          borderRadius: 10, fontSize: 11, fontWeight: 600,
                        }}>{item.action}</span>
                      </td>
                      <td style={{
                        padding: '12px', fontSize: 13, color: 'rgba(255,255,255,0.7)',
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                      }}>
                        {item.targetTenant ? (
                          <Link
                            to={`/tenants/${item.targetTenant.id}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: '#00D4FF', textDecoration: 'none' }}
                          >
                            {item.targetTenant.name}
                            <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 6, fontSize: 11 }}>
                              ({item.targetTenant.subdomain})
                            </span>
                          </Link>
                        ) : item.targetType ? (
                          <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                            {item.targetType}{item.targetId ? ` · ${item.targetId.slice(0, 8)}…` : ''}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{
                        padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.4)',
                        borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'right',
                      }}>
                        {item.detailsJson ? (open ? '▴ hide' : '▾ show') : '—'}
                      </td>
                    </tr>
                    {open && Boolean(item.detailsJson) && (
                      <tr>
                        <td colSpan={5} style={{
                          padding: '0 12px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                        }}>
                          <pre style={{
                            background: '#070E18',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 6,
                            padding: 12,
                            fontSize: 11,
                            color: 'rgba(255,255,255,0.7)',
                            margin: 0,
                            overflow: 'auto',
                            maxHeight: 240,
                          }}>{JSON.stringify(item.detailsJson, null, 2)}</pre>
                          {item.ipAddress && (
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>
                              IP: {item.ipAddress}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            gap: 8, marginTop: 20,
          }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6, padding: '6px 14px', color: page === 1 ? 'rgba(255,255,255,0.2)' : '#FFF',
                cursor: page === 1 ? 'not-allowed' : 'pointer', fontSize: 13,
              }}
            >← Prev</button>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', padding: '0 12px' }}>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6, padding: '6px 14px',
                color: page === totalPages ? 'rgba(255,255,255,0.2)' : '#FFF',
                cursor: page === totalPages ? 'not-allowed' : 'pointer', fontSize: 13,
              }}
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminActivity;
