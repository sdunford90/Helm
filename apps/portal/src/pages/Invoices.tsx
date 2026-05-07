import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Filter, Loader2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { usePortalApi, formatCents, formatDate } from '../lib/api';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedDate: string;
  dueDate: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  balanceCents: number;
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const STATUS_FILTERS = ['All', 'ISSUED', 'PAID', 'PAST_DUE', 'VOID'] as const;

export default function Invoices() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const { data, loading, error } = usePortalApi<Invoice[]>(
    'get',
    '/api/portal/invoices',
    { immediate: true },
  );

  const invoices = data ?? [];
  const filtered = useMemo(
    () => (statusFilter === 'All' ? invoices : invoices.filter((i) => i.status === statusFilter)),
    [invoices, statusFilter],
  );

  const statusBadge = (status: string): CSSProperties => ({
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background:
      status === 'PAID' ? '#E6FAF0' :
      status === 'PAST_DUE' || status === 'COLLECTIONS' ? '#FFE6E6' :
      status === 'ISSUED' ? '#FFF8E6' :
      status === 'VOID' ? '#F1F5F9' : '#F1F5F9',
    color:
      status === 'PAID' ? '#0D9F6E' :
      status === 'PAST_DUE' || status === 'COLLECTIONS' ? '#DC2626' :
      status === 'ISSUED' ? '#D97706' :
      status === 'VOID' ? '#64748B' : '#64748B',
  });

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Invoices</h1>
      <p style={{ color: '#64748B', fontSize: 14, marginBottom: 28 }}>
        All invoices on your account.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Filter size={16} color="#64748B" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            fontSize: 14,
            border: '1px solid #CBD5E1',
            borderRadius: 8,
            color: NAVY,
            background: '#fff',
            cursor: 'pointer',
            minWidth: 180,
          }}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'All' ? 'All statuses' : s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div style={card}>
        {loading && (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748B' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}

        {error && (
          <div
            style={{
              padding: 16,
              background: '#FEF2F2',
              borderRadius: 8,
              color: '#DC2626',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
            <FileText size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
            <div>No invoices to display.</div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Invoice #', 'Issued', 'Due', 'Status', 'Total', 'Balance'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i >= 4 ? 'right' : 'left',
                      padding: '10px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748B',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E2E8F0',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8FAFC')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <td style={{ padding: '12px 8px', fontSize: 13, fontWeight: 600, color: CYAN, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
                    {inv.invoiceNumber}
                  </td>
                  <td style={{ padding: '12px 8px', fontSize: 13, color: NAVY }}>
                    {formatDate(inv.issuedDate)}
                  </td>
                  <td style={{ padding: '12px 8px', fontSize: 13, color: NAVY }}>
                    {formatDate(inv.dueDate)}
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <span style={statusBadge(inv.status)}>{inv.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right', fontSize: 13, color: NAVY, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
                    {formatCents(inv.totalCents)}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: inv.balanceCents > 0 ? '#DC2626' : '#0D9F6E', fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
                    {formatCents(inv.balanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
