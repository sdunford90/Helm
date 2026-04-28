import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Ship, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../lib/api';

type ComplianceStatus = 'ALL_GOOD' | 'ATTENTION_REQUIRED' | 'NON_COMPLIANT';
type InsuranceStatus = 'VALID' | 'EXPIRED' | 'MISSING';
type RegistrationStatus = 'VALID' | 'EXPIRED' | 'MISSING';

interface ApiInsuranceRecord {
  id: string;
  expiryDate: string | null;
  insurer: string | null;
  policyNumber: string | null;
}

interface ApiSlipContract {
  id: string;
  status: string;
  slip: { id: string; slipNumber: string } | null;
}

interface ApiBoatCompliance {
  overallScore: ComplianceStatus;
  insurance: {
    status: InsuranceStatus;
    expiryDate: string | null;
    insurer: string | null;
    policyNumber: string | null;
  };
  registration: {
    status: RegistrationStatus;
    expiryDate: string | null;
    registrationNumber: string | null;
  };
}

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
  createdAt: string | null;
  customer: { id: string; firstName: string; lastName: string };
  insuranceRecords: ApiInsuranceRecord[];
  slipContracts: ApiSlipContract[];
  compliance: ApiBoatCompliance;
}

interface ApiResponse {
  data: ApiBoat[];
  pagination: { skip: number; take: number; total: number };
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

const insuranceBadgeColors: Record<InsuranceStatus, { bg: string; color: string }> = {
  VALID: { bg: '#E8F5E9', color: '#1B5E20' },
  EXPIRED: { bg: '#FFF3CD', color: '#856404' },
  MISSING: { bg: '#FDECEA', color: '#B71C1C' },
};

const registrationBadgeColors: Record<RegistrationStatus, { bg: string; color: string }> = {
  VALID: { bg: '#E8F5E9', color: '#1B5E20' },
  EXPIRED: { bg: '#FFF3CD', color: '#856404' },
  MISSING: { bg: '#FDECEA', color: '#B71C1C' },
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
    overflowX: 'auto' as const,
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
    whiteSpace: 'nowrap' as const,
  },
  thButton: {
    background: 'transparent',
    border: 'none',
    color: '#FFFFFF',
    fontWeight: 600,
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    cursor: 'pointer',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },
  tdBase: {
    padding: '12px 16px',
    color: '#0A2342',
    borderBottom: '1px solid #E2E8F0',
    cursor: 'pointer',
    verticalAlign: 'top' as const,
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
  muted: {
    color: '#64748B',
  },
  subtle: {
    fontSize: '12px',
    color: '#64748B',
    marginTop: '2px',
  },
};

const PAGE_SIZE = 100;
const SAFETY_LIMIT = 50; // refuse to fetch more than 5,000 boats client-side

type SortField = 'name' | 'insuranceExpiry' | 'registrationExpiry';
type SortOrder = 'asc' | 'desc';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function compareNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls always last
  if (b === null) return -1;
  return (a - b) * dir;
}

export default function Boats() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [complianceFilter, setComplianceFilter] = useState<'All' | ComplianceStatus>('All');
  const [search, setSearch] = useState('');
  const [boats, setBoats] = useState<ApiBoat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

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

  const filtered = boats.filter((b) => {
    if (
      complianceFilter !== 'All' &&
      b.compliance.overallScore !== complianceFilter
    ) {
      return false;
    }
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

  const sorted = [...filtered].sort((a, b) => {
    const dir: 1 | -1 = sortOrder === 'asc' ? 1 : -1;
    if (sortField === 'name') {
      const an = (a.name ?? '').toLowerCase();
      const bn = (b.name ?? '').toLowerCase();
      if (an < bn) return -1 * dir;
      if (an > bn) return 1 * dir;
      return 0;
    }
    if (sortField === 'insuranceExpiry') {
      const ax = a.insuranceRecords[0]?.expiryDate
        ? new Date(a.insuranceRecords[0].expiryDate).getTime()
        : null;
      const bx = b.insuranceRecords[0]?.expiryDate
        ? new Date(b.insuranceRecords[0].expiryDate).getTime()
        : null;
      return compareNullable(ax, bx, dir);
    }
    // registrationExpiry
    const ax = a.registrationExpiry ? new Date(a.registrationExpiry).getTime() : null;
    const bx = b.registrationExpiry ? new Date(b.registrationExpiry).getTime() : null;
    return compareNullable(ax, bx, dir);
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

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
      {sorted.length > 0 ? (
        <div style={styles.tableWrap} className="helm-table-wrap">
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>
                  <button
                    type="button"
                    style={styles.thButton}
                    onClick={() => toggleSort('name')}
                    aria-label="Sort by boat name"
                  >
                    Boat {sortIndicator('name')}
                  </button>
                </th>
                <th style={styles.th}>Owner</th>
                <th style={styles.th}>Type</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Length</th>
                <th style={styles.th}>
                  <button
                    type="button"
                    style={styles.thButton}
                    onClick={() => toggleSort('registrationExpiry')}
                    aria-label="Sort by registration expiry"
                  >
                    Registration {sortIndicator('registrationExpiry')}
                  </button>
                </th>
                <th style={styles.th}>
                  <button
                    type="button"
                    style={styles.thButton}
                    onClick={() => toggleSort('insuranceExpiry')}
                    aria-label="Sort by insurance expiry"
                  >
                    Insurance {sortIndicator('insuranceExpiry')}
                  </button>
                </th>
                <th style={styles.th}>Slip Contract</th>
                <th style={styles.th}>Added On</th>
                <th style={styles.th}>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b, idx) => {
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                const cb = complianceBadgeColors[b.compliance.overallScore];
                const typeLabel = [b.year, b.make, b.model].filter(Boolean).join(' ') || '—';
                const insStatus = b.compliance.insurance.status;
                const insColors = insuranceBadgeColors[insStatus];
                const insurer = b.compliance.insurance.insurer;
                const insExpiry = b.compliance.insurance.expiryDate;
                const regStatus = b.compliance.registration.status;
                const regColors = registrationBadgeColors[regStatus];
                const activeContract = b.slipContracts[0] ?? null;
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
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      {regStatus === 'MISSING' ? (
                        <span style={{ ...styles.badge, backgroundColor: regColors.bg, color: regColors.color }}>
                          No registration
                        </span>
                      ) : (
                        <>
                          <div style={{ color: '#0A2342' }}>
                            {b.registrationNumber}
                            {b.registrationState ? ` (${b.registrationState})` : ''}
                          </div>
                          <div style={styles.subtle}>
                            {regStatus === 'EXPIRED' ? 'Expired' : 'Expires'} {formatDate(b.registrationExpiry)}
                          </div>
                        </>
                      )}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      {insStatus === 'MISSING' ? (
                        <span style={{ ...styles.badge, backgroundColor: insColors.bg, color: insColors.color }}>
                          No insurance
                        </span>
                      ) : (
                        <>
                          <div style={{ color: '#0A2342' }}>{insurer ?? 'Unknown insurer'}</div>
                          <div style={styles.subtle}>
                            {insStatus === 'EXPIRED' ? 'Expired' : 'Expires'} {formatDate(insExpiry)}
                          </div>
                        </>
                      )}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      {activeContract && activeContract.slip ? (
                        <span style={{ color: '#0A2342' }}>
                          Slip {activeContract.slip.slipNumber}
                        </span>
                      ) : (
                        <span style={styles.muted}>None</span>
                      )}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg, color: '#64748B' }}>
                      {b.createdAt
                        ? new Date(b.createdAt).toLocaleDateString()
                        : '—'}
                    </td>
                    <td style={{ ...styles.tdBase, backgroundColor: rowBg }}>
                      <span style={{ ...styles.badge, backgroundColor: cb.bg, color: cb.color }}>
                        {COMPLIANCE_LABEL[b.compliance.overallScore]}
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
