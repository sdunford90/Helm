import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useList, useResource } from '../hooks/useApi';
import { customerName, type InvoiceDTO } from '../lib/dto';
import { DataState, EmptyState, Pager } from '../components/StateViews';
import { useToast } from '../components/Toast';
import {
  DollarSign,
  Search,
  Filter,
  Plus,
  CreditCard,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import InvoiceForm from '../components/InvoiceForm';
import { formatCents, formatDate, toDateKey } from '../lib/format';

/* ─── Types ─── */
type InvoiceStatus = 'Draft' | 'Issued' | 'Paid' | 'Past Due' | 'Void' | 'Collections';

interface Invoice {
  id: string;
  number: string;
  customer: string;
  issued: string;
  due: string;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  total: number;
  balance: number;
}

const STATUS_LABEL: Record<InvoiceDTO['status'], InvoiceStatus> = {
  DRAFT: 'Draft', ISSUED: 'Issued', PAID: 'Paid', PAST_DUE: 'Past Due', VOID: 'Void', COLLECTIONS: 'Collections',
};
const STATUS_ENUM: Record<string, InvoiceDTO['status']> = {
  Draft: 'DRAFT', Issued: 'ISSUED', Paid: 'PAID', 'Past Due': 'PAST_DUE', Void: 'VOID', Collections: 'COLLECTIONS',
};

function toInvoice(dto: InvoiceDTO): Invoice {
  return {
    id: dto.id,
    number: dto.invoiceNumber,
    customer: customerName(dto.customer),
    issued: dto.issuedDate,
    due: dto.dueDate,
    status: STATUS_LABEL[dto.status] ?? 'Draft',
    subtotal: dto.subtotalCents,
    tax: dto.taxCents,
    total: dto.totalCents,
    balance: dto.balanceCents,
  };
}

const PAGE_SIZE = 25;

const STATUS_ALL = ['All', 'Draft', 'Issued', 'Paid', 'Past Due', 'Void', 'Collections'] as const;

/* ─── Helpers ─── */
function statusBadge(status: InvoiceStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  };
  switch (status) {
    case 'Draft': return { ...base, backgroundColor: '#E2E8F0', color: '#64748B' };
    case 'Issued': return { ...base, backgroundColor: '#0A2342', color: '#FFFFFF' };
    case 'Paid': return { ...base, backgroundColor: '#E8F5E9', color: '#1B5E20' };
    case 'Past Due': return { ...base, backgroundColor: '#FDECEA', color: '#B71C1C' };
    case 'Void': return { ...base, backgroundColor: '#E2E8F0', color: '#94A3B8', textDecoration: 'line-through' };
    case 'Collections': return { ...base, backgroundColor: '#B71C1C', color: '#FFFFFF' };
    default: return base;
  }
}

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };
const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px', marginBottom: '32px' },
  summaryCard: { backgroundColor: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  summaryLabel: { fontSize: '13px', fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' },
  summaryValue: { fontSize: '28px', fontWeight: 700, color: '#0A2342', ...mono, lineHeight: 1.2 },
  filterBar: { display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' },
  select: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342', backgroundColor: '#FFFFFF', cursor: 'pointer', minWidth: '140px' },
  searchWrap: { position: 'relative', flex: 1, minWidth: '200px' },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342', boxSizing: 'border-box' },
  searchIcon: { position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' },
  dateInput: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342' },
  createBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', marginLeft: 'auto', whiteSpace: 'nowrap' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th: { textAlign: 'left', padding: '12px 16px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  thRight: { textAlign: 'right', padding: '12px 16px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' },
  td: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342' },
  tdRight: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342', textAlign: 'right', ...mono, fontSize: '13px' },
  row: { cursor: 'pointer', transition: 'background-color 0.15s' },
};

export default function Billing() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [skip, setSkip] = useState(0);
  const toast = useToast();

  // Server-side filters (status, issued date range) and paging.
  const params = new URLSearchParams({ skip: String(skip), take: String(PAGE_SIZE), sortBy: 'issuedDate', sortOrder: 'desc' });
  if (statusFilter !== 'All') params.set('status', STATUS_ENUM[statusFilter]);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', `${dateTo}T23:59:59`);
  const list = useList<Invoice, InvoiceDTO>(`/invoices?${params.toString()}`, { map: toInvoice });
  const invoices = list.items;

  // The API has no invoice text search; this filters the loaded page only.
  const filtered = invoices.filter((inv) => {
    if (search && !inv.customer.toLowerCase().includes(search.toLowerCase()) && !inv.number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Summary figures come from report endpoints, not from the 25 loaded rows.
  const now = new Date();
  const monthStart = toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const aging = useResource<{ totalOutstanding: number; buckets: Record<string, number> }>('/reports/ar-aging');
  const revenue = useResource<{ revenue: { totalCents: number } }>(`/reports/revenue?startDate=${monthStart}`);
  const pastDue = aging.data
    ? (aging.data.buckets.days30 ?? 0) + (aging.data.buckets.days60 ?? 0) + (aging.data.buckets.days90 ?? 0) + (aging.data.buckets.days120plus ?? 0)
    : null;

  const summaryCards = [
    { label: 'Total Outstanding', value: aging.data?.totalOutstanding ?? null, error: aging.error, icon: DollarSign, color: (aging.data?.totalOutstanding ?? 0) > 0 ? '#B71C1C' : '#0A2342' },
    { label: 'Collected This Month', value: revenue.data?.revenue.totalCents ?? null, error: revenue.error, icon: CheckCircle, color: '#1B5E20' },
    { label: 'Past Due', value: pastDue, error: aging.error, icon: AlertTriangle, color: (pastDue ?? 0) > 0 ? '#B71C1C' : '#0A2342' },
    { label: 'Credits Available', value: null, error: 'Customer credits are not reported by the API yet.', icon: CreditCard, color: '#0A2342' },
  ];

  const closeForm = () => {
    setShowForm(false);
    if (searchParams.get('new')) {
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">Billing</h1>
      <hr style={styles.divider} />

      {/* Summary Cards */}
      <div style={styles.summaryRow} className="helm-stats-grid">
        {summaryCards.map((c) => (
          <div key={c.label} style={styles.summaryCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <span style={styles.summaryLabel}>{c.label}</span>
              <c.icon size={20} style={{ color: '#2E4A6B' }} />
            </div>
            <div style={{ ...styles.summaryValue, color: c.value === null ? '#94A3B8' : c.color }} title={c.error ?? undefined}>
              {c.value === null ? '—' : formatCents(c.value)}
            </div>
            {c.value === null && c.error && <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{c.error}</div>}
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div style={styles.filterBar} className="helm-filter-bar">
        <div style={{ position: 'relative' }}>
          <Filter size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }} />
          <select
            style={{ ...styles.select, paddingLeft: '30px' }}
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }}
          >
            {STATUS_ALL.map((s) => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>)}
          </select>
        </div>
        <div style={styles.searchWrap}>
          <Search size={16} style={styles.searchIcon as React.CSSProperties} />
          <input
            style={styles.searchInput}
            placeholder="Filter this page by customer or invoice #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <input type="date" style={styles.dateInput} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setSkip(0); }} title="Issued from" />
        <input type="date" style={styles.dateInput} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setSkip(0); }} title="Issued to" />
        <button style={styles.createBtn} onClick={() => setShowForm(true)}>
          <Plus size={16} /> Create Invoice
        </button>
      </div>

      {/* Invoice Table */}
      <DataState
        loading={list.loading}
        error={list.error}
        onRetry={list.refetch}
        errorTitle="Could not load invoices"
        isEmpty={invoices.length === 0}
        empty={<EmptyState title="No invoices found" message={statusFilter !== 'All' || dateFrom || dateTo ? 'No invoices match these filters.' : 'Create your first invoice to get started.'} />}
      >
      <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #CCCCCC', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }} className="helm-table-wrap">
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Invoice #</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Issued</th>
              <th style={styles.th}>Due</th>
              <th style={styles.th}>Status</th>
              <th style={styles.thRight}>Subtotal</th>
              <th style={styles.thRight}>Tax</th>
              <th style={styles.thRight}>Total</th>
              <th style={styles.thRight}>Balance</th>
              <th style={{ ...styles.th, textAlign: 'center', width: '80px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv, idx) => (
              <tr
                key={inv.id}
                style={{ ...styles.row, backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}
                onClick={() => navigate(`/billing/invoices/${inv.id}`)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#E0F0FF'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF'; }}
              >
                <td style={{ ...styles.td, ...mono, fontWeight: 600, fontSize: '13px' }}><Link to={'/billing/invoices/' + inv.id} style={{ color: '#00D4FF', fontWeight: 600, textDecoration: 'none' }}>{inv.number}</Link></td>
                <td style={styles.td}>{inv.customer}</td>
                <td style={styles.td}>{formatDate(inv.issued)}</td>
                <td style={styles.td}>{formatDate(inv.due)}</td>
                <td style={styles.td}><span style={statusBadge(inv.status)}>{inv.status}</span></td>
                <td style={styles.tdRight}>{formatCents(inv.subtotal)}</td>
                <td style={styles.tdRight}>{formatCents(inv.tax)}</td>
                <td style={{ ...styles.tdRight, fontWeight: 600 }}>{formatCents(inv.total)}</td>
                <td style={{ ...styles.tdRight, fontWeight: 600, color: inv.balance > 0 ? '#B71C1C' : '#1B5E20' }}>{formatCents(inv.balance)}</td>
                <td style={{ ...styles.td, textAlign: 'center' }}>
                  {inv.balance > 0 && inv.status !== 'Void' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/billing/invoices/${inv.id}?action=pay`); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#1B5E20', border: 'none', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      <CreditCard size={12} /> Pay
                    </button>
                  ) : (
                    <span style={{ color: '#94A3B8', fontSize: '12px' }}>&mdash;</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ ...styles.td, textAlign: 'center', color: '#64748B', padding: '48px 16px' }}>
                  No invoices on this page match “{search}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager skip={skip} take={PAGE_SIZE} total={list.pagination?.total ?? invoices.length} onChange={setSkip} />
      </DataState>

      {/* Invoice Form Modal */}
      {showForm && (
        <InvoiceForm
          onClose={closeForm}
          onCreated={(inv, finalized) => {
            toast.success(`Invoice ${inv.invoiceNumber} ${finalized ? "created and finalized" : "saved as draft"}`);
            list.refetch();
            aging.refetch();
          }}
        />
      )}
    </div>
  );
}
