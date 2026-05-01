import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Plus } from 'lucide-react';
import CustomerForm from '../components/CustomerForm';
import { useApi } from '../hooks/useApi';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import { useModules } from '../context/ModulesContext';

interface Boat {
  id: string;
  name: string;
  lengthFt: number | null;
}

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'WAITLIST' | 'COLLECTIONS_HOLD' | 'SEASONAL';
  boats: Boat[];
  _count: { invoices: number; slipContracts: number };
  openBalanceCents: number;
  taxExempt: boolean;
  achBlocked: boolean;
  createdAt: string;
}

interface ApiResponse {
  data: Customer[];
  pagination: { skip: number; take: number; total: number };
}

const STATUS_LABELS: Record<Customer['status'], string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  WAITLIST: 'Waitlist',
  COLLECTIONS_HOLD: 'Collections Hold',
  SEASONAL: 'Seasonal',
};

const statusBadgeColors: Record<Customer['status'], { bg: string; color: string }> = {
  ACTIVE: { bg: '#E8F5E9', color: '#1B5E20' },
  INACTIVE: { bg: '#F2F4F6', color: '#64748B' },
  WAITLIST: { bg: '#0A2342', color: '#FFFFFF' },
  COLLECTIONS_HOLD: { bg: '#FDECEA', color: '#B71C1C' },
  SEASONAL: { bg: '#FFF3CD', color: '#856404' },
};

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  divider: {
    height: '4px',
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: '12px',
    marginBottom: '32px',
    borderRadius: '2px',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    background: '#FFFFFF',
    cursor: 'pointer',
    minWidth: '140px',
  },
  searchWrap: {
    position: 'relative' as const,
    flex: 1,
    minWidth: '200px',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#64748B',
    pointerEvents: 'none' as const,
  },
  searchInput: {
    width: '100%',
    padding: '8px 12px 8px 36px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    boxSizing: 'border-box' as const,
  },
  toggleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#2E4A6B',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  checkbox: {
    accentColor: '#0A2342',
    cursor: 'pointer',
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  tableWrap: {
    background: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '14px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    borderBottom: '2px solid #00D4FF',
  },
  tdBase: {
    padding: '12px 16px',
    color: '#0A2342',
    borderBottom: '1px solid #E2E8F0',
    cursor: 'pointer',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '9999px',
  },
  emptyState: {
    maxWidth: '480px',
    margin: '0 auto',
    textAlign: 'center' as const,
    padding: '48px 32px',
    background: '#FFFFFF',
    borderRadius: '12px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
};

export default function Customers() {
  const navigate = useNavigate();
  const { currentLocationId } = useModules();
  const { getToken } = useAuth();
  const [statusFilter, setStatusFilter] = useState<'All' | Customer['status']>('All');
  const [search, setSearch] = useState('');
  const [taxExemptFilter, setTaxExemptFilter] = useState(false);
  const [achBlockedFilter, setAchBlockedFilter] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomers = React.useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const qs = new URLSearchParams();
      if (currentLocationId) qs.set('locationId', currentLocationId);
      const res = await api.get<ApiResponse>(`/api/customers?${qs}`, token);
      if (!cancelled) setCustomers(res?.data ?? []);
    } catch (e: any) {
      if (!cancelled) setError(e?.message ?? 'Failed to load customers');
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, [currentLocationId, getToken]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const createCustomerApi = useApi<Customer>('post', '/api/customers');

  const refetchCustomers = fetchCustomers;

  const filtered = customers.filter((c) => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false;
    if (taxExemptFilter && !c.taxExempt) return false;
    if (achBlockedFilter && !c.achBlocked) return false;
    if (search) {
      const q = search.toLowerCase();
      const match =
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">Customers</h1>
      <hr style={styles.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>Loading...</div>}
      {error && <div style={{ textAlign: 'center', padding: '20px', color: '#B71C1C' }}>{error}</div>}

      {/* Filter Bar */}
      <div style={styles.filterBar} className="helm-filter-bar">
        <select
          style={styles.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="All">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="WAITLIST">Waitlist</option>
          <option value="COLLECTIONS_HOLD">Collections Hold</option>
          <option value="SEASONAL">Seasonal</option>
        </select>

        <div style={styles.searchWrap}>
          <Search size={16} style={styles.searchIcon} />
          <input
            style={styles.searchInput}
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <label style={styles.toggleWrap}>
          <input
            type="checkbox"
            checked={taxExemptFilter}
            onChange={(e) => setTaxExemptFilter(e.target.checked)}
            style={styles.checkbox}
          />
          Tax Exempt
        </label>

        <label style={styles.toggleWrap}>
          <input
            type="checkbox"
            checked={achBlockedFilter}
            onChange={(e) => setAchBlockedFilter(e.target.checked)}
            style={styles.checkbox}
          />
          ACH Blocked
        </label>

        <button style={styles.addButton} onClick={() => setShowForm(true)}>
          <Plus size={16} />
          Add Customer
        </button>
      </div>

      {/* Data Table */}
      {filtered.length > 0 ? (
        <div style={styles.tableWrap} className="helm-table-wrap">
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Phone</th>
                <th style={styles.th}>Status</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>Boats</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Open Balance</th>
                <th style={styles.th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => {
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                const badgeStyle = statusBadgeColors[c.status];
                return (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/customers/${c.id}`)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#B8D8EA';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = rowBg;
                    }}
                  >
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, fontWeight: 600 }}>
                      {c.firstName} {c.lastName}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>{c.email ?? '—'}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>{c.phone ?? '—'}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      <span style={{ ...styles.badge, backgroundColor: badgeStyle.bg, color: badgeStyle.color }}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, textAlign: 'center' }}>
                      {c.boats.length}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {(c.openBalanceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, color: '#64748B' }}>
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && (
          <div style={styles.emptyState}>
            <Users size={32} style={{ marginBottom: '16px', color: '#2E4A6B' }} />
            <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#0A2342', margin: '0 0 8px 0' }}>
              No customers found
            </h3>
            <p style={{ fontSize: '15px', color: '#64748B', lineHeight: 1.6, margin: '0 0 24px 0' }}>
              {search || statusFilter !== 'All'
                ? 'Try adjusting your filters or search terms.'
                : 'Add your first customer or import from your previous system.'}
            </p>
            <button style={styles.addButton} onClick={() => setShowForm(true)}>
              <Plus size={16} />
              Add Customer
            </button>
          </div>
        )
      )}

      {showForm && (
        <CustomerForm
          onClose={() => setShowForm(false)}
          onSave={async (data) => {
            await createCustomerApi.execute(data);
            refetchCustomers();
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}
