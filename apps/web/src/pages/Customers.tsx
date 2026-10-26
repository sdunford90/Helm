import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Plus, ChevronDown } from 'lucide-react';
import CustomerForm, { customerFormToPayload, STATUS_FROM_ENUM } from '../components/CustomerForm';
import { useApiClient, useList } from '../hooks/useApi';
import { formatDate, formatPhone } from '../lib/format';
import { ErrorState, LoadingState, Pager } from '../components/StateViews';
import { useToast } from '../components/Toast';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: 'Active' | 'Inactive' | 'Waitlist' | 'Collections Hold' | 'Seasonal';
  boats: number;
  taxExempt: boolean;
  achBlocked: boolean;
  created: string;
}

interface CustomerDTO {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  taxExempt: boolean;
  achBlocked: boolean;
  createdAt: string;
  boats?: { id: string }[];
}

function toCustomer(c: CustomerDTO): Customer {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email ?? '',
    phone: c.phone ?? '',
    status: (STATUS_FROM_ENUM[c.status] ?? 'Active') as Customer['status'],
    boats: c.boats?.length ?? 0,
    taxExempt: c.taxExempt,
    achBlocked: c.achBlocked,
    created: c.createdAt,
  };
}

const STATUS_ENUM: Record<string, string> = {
  Active: 'ACTIVE', Inactive: 'INACTIVE', Waitlist: 'WAITLIST', 'Collections Hold': 'COLLECTIONS_HOLD', Seasonal: 'SEASONAL',
};
const PAGE_SIZE = 25;

const statusBadgeColors: Record<string, { bg: string; color: string; border?: string }> = {
  Active: { bg: '#E8F5E9', color: '#1B5E20' },
  Inactive: { bg: '#F2F4F6', color: '#64748B' },
  Waitlist: { bg: '#0A2342', color: '#FFFFFF' },
  'Collections Hold': { bg: '#FDECEA', color: '#B71C1C' },
  Seasonal: { bg: '#FFF3CD', color: '#856404' },
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
  mono: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '14px',
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
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [taxExemptFilter, setTaxExemptFilter] = useState(false);
  const [achBlockedFilter, setAchBlockedFilter] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [skip, setSkip] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search.trim()); setSkip(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const client = useApiClient();
  const toast = useToast();

  // Filtering, search and paging all happen on the server.
  const params = new URLSearchParams({ skip: String(skip), take: String(PAGE_SIZE) });
  if (statusFilter !== 'All') params.set('status', STATUS_ENUM[statusFilter]);
  if (debouncedSearch) params.set('search', debouncedSearch);
  if (taxExemptFilter) params.set('taxExempt', 'true');
  if (achBlockedFilter) params.set('achBlocked', 'true');
  const list = useList<Customer, CustomerDTO>(`/customers?${params.toString()}`, { map: toCustomer });
  const filtered = list.items;

  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">Customers</h1>
      <hr style={styles.divider} />


      {/* Filter Bar */}
      <div style={styles.filterBar} className="helm-filter-bar">
        <select
          style={styles.select}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }}
        >
          <option value="All">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="Waitlist">Waitlist</option>
          <option value="Collections Hold">Collections Hold</option>
          <option value="Seasonal">Seasonal</option>
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
            onChange={(e) => { setTaxExemptFilter(e.target.checked); setSkip(0); }}
            style={styles.checkbox}
          />
          Tax Exempt
        </label>

        <label style={styles.toggleWrap}>
          <input
            type="checkbox"
            checked={achBlockedFilter}
            onChange={(e) => { setAchBlockedFilter(e.target.checked); setSkip(0); }}
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
      {list.loading ? (
        <LoadingState label="Loading customers…" />
      ) : list.error ? (
        <ErrorState title="Could not load customers" message={list.error} onRetry={list.refetch} />
      ) : filtered.length > 0 ? (
        <>
        <div style={styles.tableWrap} className="helm-table-wrap">
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Phone</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Boats</th>
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
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>{c.email || '—'}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>{c.phone ? formatPhone(c.phone) : '—'}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      <span style={{ ...styles.badge, backgroundColor: badgeStyle.bg, color: badgeStyle.color }}>
                        {c.status}
                      </span>
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, textAlign: 'center' }}>{c.boats}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, color: '#64748B' }}>{formatDate(c.created)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager skip={skip} take={PAGE_SIZE} total={list.pagination?.total ?? filtered.length} onChange={setSkip} />
        </>
      ) : (
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
      )}

      {showForm && (
        <CustomerForm
          onClose={() => setShowForm(false)}
          onSave={async (data) => {
            await client.post('/customers', customerFormToPayload(data));
            toast.success(`Customer ${data.firstName} ${data.lastName} added`);
            list.refetch();
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}
