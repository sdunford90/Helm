import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { formatCents, formatDate } from '../lib/format';
import { api } from '../lib/api';

/* ─── Types ─── */
type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'PAST_DUE' | 'VOID' | 'COLLECTIONS';

interface Invoice {
  id: string;
  invoiceNumber: string;
  customer?: { firstName: string; lastName: string; company?: string | null };
  customerId: string;
  issuedAt: string | null;
  dueDate: string | null;
  status: InvoiceStatus;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  balanceCents: number;
}

const STATUS_DISPLAY: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PAID: 'Paid',
  PAST_DUE: 'Past Due',
  VOID: 'Void',
  COLLECTIONS: 'Collections',
};

const STATUS_ALL = ['All', 'DRAFT', 'ISSUED', 'PAID', 'PAST_DUE', 'VOID', 'COLLECTIONS'] as const;

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
    case 'DRAFT': return { ...base, backgroundColor: '#E2E8F0', color: '#64748B' };
    case 'ISSUED': return { ...base, backgroundColor: '#0A2342', color: '#FFFFFF' };
    case 'PAID': return { ...base, backgroundColor: '#E8F5E9', color: '#1B5E20' };
    case 'PAST_DUE': return { ...base, backgroundColor: '#FDECEA', color: '#B71C1C' };
    case 'VOID': return { ...base, backgroundColor: '#E2E8F0', color: '#94A3B8', textDecoration: 'line-through' };
    case 'COLLECTIONS': return { ...base, backgroundColor: '#B71C1C', color: '#FFFFFF' };
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
  loading: { display: 'flex', justifyContent: 'center', padding: '64px', color: '#64748B' },
};

export default function Billing() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    api.get<{ invoices: Invoice[] }>('/invoices')
      .then((res) => setInvoices(res.invoices ?? []))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = invoices.filter((inv) => {
    if (statusFilter !== 'All' && inv.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = inv.customer ? `${inv.customer.firstName} ${inv.customer.lastName}` : '';
      if (!name.toLowerCase().includes(q) && !inv.invoiceNumber.toLowerCase().includes(q)) return false;
    }
    if (dateFrom && inv.issuedAt && inv.issuedAt < dateFrom) return false;
    if (dateTo && inv.issuedAt && inv.issuedAt > dateTo) return false;
    return true;
  });

  const totalOutstanding = invoices.reduce((s, i) => s + i.balanceCents, 0);
  const paidThisMonth = invoices.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.totalCents, 0);
  const pastDue = invoices.filter((i) => i.status === 'PAST_DUE' || i.status === 'COLLECTIONS').reduce((s, i) => s + i.balanceCents, 0);

  const summaryCards = [
    { label: 'Total Outstanding', value: totalOutstanding, icon: DollarSign, color: totalOutstanding > 0 ? '#B71C1C' : '#0A2342' },
    { label: 'Paid This Month', value: paidThisMonth, icon: CheckCircle, color: '#1B5E20' },
    { label: 'Past Due (30+ days)', value: pastDue, icon: AlertTriangle, color: pastDue > 0 ? '#B71C1C' : '#0A2342' },
    { label: 'Credits Available', value: 0, icon: CreditCard, color: '#0A2342' },
  ];

  if (loading) {
    return <div style={styles.loading}>Loading invoices...</div>;
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Billing</h1>
      <hr style={styles.divider} />

      {/* Summary Cards */}
      <div style={styles.summaryRow}>
        {summaryCards.map((c) => (
          <div key={c.label} style={styles.summaryCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <span style={styles.summaryLabel}>{c.label}</span>
              <c.icon size={20} style={{ color: '#2E4A6B' }} />
            </div>
            <div style={{ ...styles.summaryValue, color: c.color }}>{formatCents(c.value)}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div style={styles.filterBar}>
        <div style={{ position: 'relative' }}>
          <Filter size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }} />
          <select
            style={{ ...styles.select, paddingLeft: '30px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_ALL.map((s) => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : STATUS_DISPLAY[s as InvoiceStatus] ?? s}</option>)}
          </select>
        </div>
        <div style={styles.searchWrap}>
          <Search size={16} style={styles.searchIcon as React.CSSProperties} />
          <input
            style={styles.searchInput}
            placeholder="Search customers or invoices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <input type="date" style={styles.dateInput} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
        <input type="date" style={styles.dateInput} value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
        <button style={styles.createBtn} onClick={() => setShowForm(true)}>
          <Plus size={16} /> Create Invoice
        </button>
      </div>

      {/* Invoice Table */}
      <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #CCCCCC', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
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
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv, idx) => {
              const customerName = inv.customer ? `${inv.customer.firstName} ${inv.customer.lastName}` : '—';
              return (
                <tr
                  key={inv.id}
                  style={{ ...styles.row, backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}
                  onClick={() => navigate(`/billing/invoices/${inv.id}`)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#E0F0FF'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF'; }}
                >
                  <td style={{ ...styles.td, ...mono, fontWeight: 600, fontSize: '13px' }}>{inv.invoiceNumber}</td>
                  <td style={styles.td}>{customerName}</td>
                  <td style={styles.td}>{inv.issuedAt ? formatDate(inv.issuedAt) : '—'}</td>
                  <td style={styles.td}>{inv.dueDate ? formatDate(inv.dueDate) : '—'}</td>
                  <td style={styles.td}><span style={statusBadge(inv.status)}>{STATUS_DISPLAY[inv.status]}</span></td>
                  <td style={styles.tdRight}>{formatCents(inv.subtotalCents)}</td>
                  <td style={styles.tdRight}>{formatCents(inv.taxCents)}</td>
                  <td style={{ ...styles.tdRight, fontWeight: 600 }}>{formatCents(inv.totalCents)}</td>
                  <td style={{ ...styles.tdRight, fontWeight: 600, color: inv.balanceCents > 0 ? '#B71C1C' : '#1B5E20' }}>{formatCents(inv.balanceCents)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: '#94A3B8', padding: '48px 16px' }}>
                  No invoices match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Invoice Form Modal */}
      {showForm && <InvoiceForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
