import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download, Filter } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const mockInvoices = [
  { id: 'INV-1042', date: '2026-03-01', description: 'Monthly Slip Rental - March', amount: 1250.0, status: 'Open' },
  { id: 'INV-1040', date: '2026-02-20', description: 'Pump-Out Service', amount: 75.0, status: 'Paid' },
  { id: 'INV-1038', date: '2026-02-01', description: 'Monthly Slip Rental - February', amount: 1250.0, status: 'Paid' },
  { id: 'INV-1035', date: '2026-01-15', description: 'Fuel Purchase - 120 gal Diesel', amount: 624.0, status: 'Paid' },
  { id: 'INV-1030', date: '2026-01-01', description: 'Monthly Slip Rental - January', amount: 1250.0, status: 'Paid' },
  { id: 'INV-1025', date: '2025-12-15', description: 'Bottom Cleaning Service', amount: 350.0, status: 'Paid' },
  { id: 'INV-1020', date: '2025-12-01', description: 'Monthly Slip Rental - December', amount: 1250.0, status: 'Paid' },
  { id: 'INV-1015', date: '2025-11-20', description: 'Annual Haul-Out & Inspection', amount: 1800.0, status: 'Past Due' },
  { id: 'INV-1010', date: '2025-11-01', description: 'Monthly Slip Rental - November', amount: 1250.0, status: 'Paid' },
  { id: 'INV-1005', date: '2025-10-01', description: 'Monthly Slip Rental - October', amount: 1250.0, status: 'Paid' },
];

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

export default function Invoices() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>('All');

  const filtered = filter === 'All' ? mockInvoices : mockInvoices.filter((i) => i.status === filter);

  const statusBadge = (status: string): CSSProperties => ({
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background: status === 'Paid' ? '#E6FAF0' : status === 'Open' ? '#FFF8E6' : '#FFE6E6',
    color: status === 'Paid' ? '#0D9F6E' : status === 'Open' ? '#D97706' : '#DC2626',
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Invoices</h1>
          <p style={{ color: '#64748B', fontSize: 14 }}>View and manage your billing history.</p>
        </div>
      </div>

      <div style={card}>
        {/* Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Filter size={16} color="#64748B" />
          {['All', 'Open', 'Paid', 'Past Due'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: filter === s ? NAVY : '#F1F5F9',
                color: filter === s ? '#fff' : '#64748B',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #F1F5F9' }}>
              {['Invoice #', 'Date', 'Description', 'Amount', 'Status', ''].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#64748B',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
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
                style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '12px', fontSize: 14, fontWeight: 600, color: NAVY }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={16} color={CYAN} />
                    {inv.id}
                  </div>
                </td>
                <td style={{ padding: '12px', fontSize: 13, color: '#64748B' }}>{inv.date}</td>
                <td style={{ padding: '12px', fontSize: 13, color: '#334155' }}>{inv.description}</td>
                <td style={{ padding: '12px', fontSize: 14, fontWeight: 600, color: NAVY }}>
                  ${inv.amount.toFixed(2)}
                </td>
                <td style={{ padding: '12px' }}>
                  <span style={statusBadge(inv.status)}>{inv.status}</span>
                </td>
                <td style={{ padding: '12px' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748B',
                      cursor: 'pointer',
                      padding: 4,
                    }}
                    title="Download PDF"
                  >
                    <Download size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8' }}>
            No invoices match the selected filter.
          </div>
        )}
      </div>
    </div>
  );
}
