import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Plus, ChevronDown } from 'lucide-react';
import CustomerForm from '../components/CustomerForm';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: 'Active' | 'Inactive' | 'Waitlist' | 'Collections Hold' | 'Seasonal';
  boats: number;
  balance: number;
  taxExempt: boolean;
  achBlocked: boolean;
  created: string;
}

const MOCK_CUSTOMERS: Customer[] = [
  { id: '1', firstName: 'James', lastName: 'Harborview', email: 'james@harbor.com', phone: '(555) 123-4567', status: 'Active', boats: 2, balance: 1250.00, taxExempt: false, achBlocked: false, created: '2024-03-15' },
  { id: '2', firstName: 'Maria', lastName: 'Seabreeze', email: 'maria@ocean.net', phone: '(555) 234-5678', status: 'Active', boats: 1, balance: 0, taxExempt: true, achBlocked: false, created: '2024-06-01' },
  { id: '3', firstName: 'Robert', lastName: 'Dockside', email: 'rob@docks.com', phone: '(555) 345-6789', status: 'Waitlist', boats: 1, balance: 500.00, taxExempt: false, achBlocked: false, created: '2024-09-20' },
  { id: '4', firstName: 'Susan', lastName: 'Baywatch', email: 'susan@bay.org', phone: '(555) 456-7890', status: 'Inactive', boats: 0, balance: 0, taxExempt: false, achBlocked: true, created: '2023-11-10' },
  { id: '5', firstName: 'David', lastName: 'Tidewater', email: 'david@tide.com', phone: '(555) 567-8901', status: 'Collections Hold', boats: 1, balance: 4500.00, taxExempt: false, achBlocked: true, created: '2024-01-05' },
  { id: '6', firstName: 'Elena', lastName: 'Windward', email: 'elena@wind.com', phone: '(555) 678-9012', status: 'Seasonal', boats: 1, balance: 750.00, taxExempt: false, achBlocked: false, created: '2025-04-01' },
];

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

  const filtered = MOCK_CUSTOMERS.filter((c) => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false;
    if (taxExemptFilter && !c.taxExempt) return false;
    if (achBlockedFilter && !c.achBlocked) return false;
    if (search) {
      const q = search.toLowerCase();
      const match =
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Customers</h1>
      <hr style={styles.divider} />

      {/* Filter Bar */}
      <div style={styles.filterBar}>
        <select
          style={styles.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
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
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Phone</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Boats</th>
                <th style={styles.th}>Balance</th>
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
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>{c.email}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>{c.phone}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      <span style={{ ...styles.badge, backgroundColor: badgeStyle.bg, color: badgeStyle.color }}>
                        {c.status}
                      </span>
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, textAlign: 'center' }}>{c.boats}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, ...styles.mono }}>
                      ${c.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, color: '#64748B' }}>{c.created}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
          onSave={(data) => {
            console.log('Save customer:', data);
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}
