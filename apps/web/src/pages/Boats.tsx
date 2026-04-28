import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Ship, Search } from 'lucide-react';
import { api } from '../lib/api';

interface ApiBoat {
  id: string;
  name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  lengthFt: number;
  registrationNumber: string | null;
  registrationState: string | null;
  registrationExpiry: string | null;
  fuelType: string | null;
  customer: { id: string; firstName: string; lastName: string };
  insuranceRecords: Array<{ id: string; expiryDate: string | null }>;
}

interface ApiResponse {
  data: ApiBoat[];
  pagination: { skip: number; take: number; total: number };
}

type ComplianceStatus = 'ALL_GOOD' | 'ATTENTION_REQUIRED' | 'NON_COMPLIANT';

function deriveCompliance(b: ApiBoat): ComplianceStatus {
  const now = Date.now();
  const insurance = b.insuranceRecords[0];
  if (!insurance || !insurance.expiryDate) return 'NON_COMPLIANT';
  if (!b.registrationNumber) return 'NON_COMPLIANT';
  const insExpired = new Date(insurance.expiryDate).getTime() < now;
  const regExpired = b.registrationExpiry
    ? new Date(b.registrationExpiry).getTime() < now
    : false;
  if (insExpired || regExpired) return 'ATTENTION_REQUIRED';
  return 'ALL_GOOD';
}

const COMPLIANCE_LABEL: Record<ComplianceStatus, string> = {
  ALL_GOOD: 'Compliant',
  ATTENTION_REQUIRED: 'Attention',
  NON_COMPLIANT: 'Non-Compliant',
};

const complianceBadgeColors: Record<ComplianceStatus, { bg: string; color: string }> = {
  ALL_GOOD: { bg: '#E8F5E9', color: '#1B5E20' },
  ATTENTION_REQUIRED: { bg: '#FFF3CD', color: '#856404' },
  NON_COMPLIANT: { bg: '#FDECEA', color: '#B71C1C' },
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
    minWidth: '160px',
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
  customerLink: {
    color: '#0A2342',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontWeight: 500,
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

const PAGE_SIZE = 100;
const SAFETY_LIMIT = 50; // refuse to fetch more than 5,000 boats client-side

export default function Boats() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [complianceFilter, setComplianceFilter] = useState<'All' | ComplianceStatus>('All');
  const [search, setSearch] = useState('');
  const [boats, setBoats] = useState<ApiBoat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The API caps `take` at 100, so paginate through every page until we
  // have all boats for the tenant.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const collected: ApiBoat[] = [];
        for (let page = 0; page < SAFETY_LIMIT; page++) {
          const skip = page * PAGE_SIZE;
          const res = await api.get<ApiResponse>(
            `/api/boats?take=${PAGE_SIZE}&skip=${skip}`,
            token,
          );
          collected.push(...res.data);
          if (collected.length >= res.pagination.total || res.data.length < PAGE_SIZE) {
            break;
          }
        }
        if (!cancelled) setBoats(collected);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load boats');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const enriched = boats.map((b) => ({ ...b, compliance: deriveCompliance(b) }));

  const filtered = enriched.filter((b) => {
    if (complianceFilter !== 'All' && b.compliance !== complianceFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const customerName = `${b.customer.firstName} ${b.customer.lastName}`.toLowerCase();
      const match =
        (b.name ?? '').toLowerCase().includes(q) ||
        (b.registrationNumber ?? '').toLowerCase().includes(q) ||
        customerName.includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">Boats</h1>
      <hr style={styles.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>Loading...</div>}
      {error && <div style={{ textAlign: 'center', padding: '20px', color: '#B71C1C' }}>{error}</div>}

      {/* Filter Bar */}
      <div style={styles.filterBar} className="helm-filter-bar">
        <select
          style={styles.select}
          value={complianceFilter}
          onChange={(e) => setComplianceFilter(e.target.value as typeof complianceFilter)}
        >
          <option value="All">All Compliance</option>
          <option value="ALL_GOOD">Compliant</option>
          <option value="ATTENTION_REQUIRED">Attention</option>
          <option value="NON_COMPLIANT">Non-Compliant</option>
        </select>

        <div style={styles.searchWrap}>
          <Search size={16} style={styles.searchIcon} />
          <input
            style={styles.searchInput}
            placeholder="Search by boat name, registration, or owner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Data Table */}
      {filtered.length > 0 ? (
        <div style={styles.tableWrap} className="helm-table-wrap">
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Boat</th>
                <th style={styles.th}>Owner</th>
                <th style={styles.th}>Type</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Length</th>
                <th style={styles.th}>Registration</th>
                <th style={styles.th}>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, idx) => {
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                const cb = complianceBadgeColors[b.compliance];
                const typeLabel = [b.year, b.make, b.model].filter(Boolean).join(' ') || '—';
                return (
                  <tr
                    key={b.id}
                    onClick={() => navigate(`/customers/${b.customer.id}?tab=boats`)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#B8D8EA';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = rowBg;
                    }}
                  >
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, fontWeight: 600 }}>
                      {b.name ?? '—'}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      <span
                        style={styles.customerLink}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/customers/${b.customer.id}`);
                        }}
                      >
                        {b.customer.firstName} {b.customer.lastName}
                      </span>
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>{typeLabel}</td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {b.lengthFt ? `${b.lengthFt}'` : '—'}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, color: '#64748B' }}>
                      {b.registrationNumber
                        ? `${b.registrationNumber}${b.registrationState ? ` (${b.registrationState})` : ''}`
                        : '—'}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      <span style={{ ...styles.badge, backgroundColor: cb.bg, color: cb.color }}>
                        {COMPLIANCE_LABEL[b.compliance]}
                      </span>
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
            <Ship size={36} style={{ color: '#94A3B8', marginBottom: '12px' }} />
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: '0 0 8px' }}>
              No boats found
            </h3>
            <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>
              {boats.length === 0
                ? 'No boats are recorded for this marina yet. Add a boat from a customer detail page.'
                : 'No boats match your search and filter criteria.'}
            </p>
          </div>
        )
      )}
    </div>
  );
}
