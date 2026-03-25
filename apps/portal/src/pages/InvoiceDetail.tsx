import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const invoiceData: Record<string, {
  id: string;
  date: string;
  dueDate: string;
  status: string;
  lineItems: { description: string; qty: number; rate: number; amount: number }[];
  subtotal: number;
  tax: number;
  total: number;
  payments: { date: string; method: string; amount: number }[];
}> = {
  'INV-1042': {
    id: 'INV-1042',
    date: '2026-03-01',
    dueDate: '2026-03-31',
    status: 'Open',
    lineItems: [
      { description: 'Slip Rental - 40ft Covered (Slip C-12)', qty: 1, rate: 1100.0, amount: 1100.0 },
      { description: 'Electric & Water Utility Fee', qty: 1, rate: 85.0, amount: 85.0 },
      { description: 'WiFi Access - Premium', qty: 1, rate: 25.0, amount: 25.0 },
    ],
    subtotal: 1210.0,
    tax: 40.0,
    total: 1250.0,
    payments: [],
  },
  'INV-1038': {
    id: 'INV-1038',
    date: '2026-02-01',
    dueDate: '2026-02-28',
    status: 'Paid',
    lineItems: [
      { description: 'Slip Rental - 40ft Covered (Slip C-12)', qty: 1, rate: 1100.0, amount: 1100.0 },
      { description: 'Electric & Water Utility Fee', qty: 1, rate: 85.0, amount: 85.0 },
      { description: 'WiFi Access - Premium', qty: 1, rate: 25.0, amount: 25.0 },
    ],
    subtotal: 1210.0,
    tax: 40.0,
    total: 1250.0,
    payments: [
      { date: '2026-02-15', method: 'Visa ending 4242 (Auto-Pay)', amount: 1250.0 },
    ],
  },
};

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const invoice = invoiceData[id || ''] || invoiceData['INV-1042'];
  const balance = invoice.total - invoice.payments.reduce((sum, p) => sum + p.amount, 0);

  const statusBadge = (status: string): CSSProperties => ({
    display: 'inline-block',
    padding: '4px 14px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    background: status === 'Paid' ? '#E6FAF0' : status === 'Open' ? '#FFF8E6' : '#FFE6E6',
    color: status === 'Paid' ? '#0D9F6E' : status === 'Open' ? '#D97706' : '#DC2626',
  });

  return (
    <div>
      <button
        onClick={() => navigate('/invoices')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          color: CYAN,
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          marginBottom: 20,
          padding: 0,
        }}
      >
        <ArrowLeft size={16} /> Back to Invoices
      </button>

      {/* Invoice Header */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
              Invoice {invoice.id}
            </h1>
            <p style={{ color: '#64748B', fontSize: 14 }}>Bayview Marina</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={statusBadge(invoice.status)}>{invoice.status}</span>
            <div style={{ marginTop: 8 }}>
              <button
                style={{
                  background: 'none',
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 13,
                  color: '#64748B',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Download size={14} /> Download PDF
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 20 }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500, marginBottom: 4 }}>Invoice Date</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{invoice.date}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500, marginBottom: 4 }}>Due Date</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{invoice.dueDate}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500, marginBottom: 4 }}>Balance Due</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: balance > 0 ? '#D97706' : '#0D9F6E' }}>
              ${balance.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div style={{ ...card, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Line Items</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #F1F5F9' }}>
              {['Description', 'Qty', 'Rate', 'Amount'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === 'Description' ? 'left' : 'right',
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
            {invoice.lineItems.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '12px', fontSize: 14, color: '#334155' }}>{item.description}</td>
                <td style={{ padding: '12px', fontSize: 14, color: '#64748B', textAlign: 'right' }}>{item.qty}</td>
                <td style={{ padding: '12px', fontSize: 14, color: '#64748B', textAlign: 'right' }}>
                  ${item.rate.toFixed(2)}
                </td>
                <td style={{ padding: '12px', fontSize: 14, fontWeight: 600, color: NAVY, textAlign: 'right' }}>
                  ${item.amount.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ borderTop: '2px solid #F1F5F9', marginTop: 8, paddingTop: 12 }}>
          {[
            { label: 'Subtotal', value: invoice.subtotal },
            { label: 'Tax', value: invoice.tax },
            { label: 'Total', value: invoice.total },
          ].map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 40,
                padding: '4px 12px',
                fontSize: row.label === 'Total' ? 16 : 14,
                fontWeight: row.label === 'Total' ? 700 : 500,
                color: row.label === 'Total' ? NAVY : '#64748B',
              }}
            >
              <span>{row.label}</span>
              <span style={{ minWidth: 100, textAlign: 'right' }}>${row.value.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Payment History */}
      <div style={{ ...card, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Payment History</h2>
        {invoice.payments.length > 0 ? (
          invoice.payments.map((p, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid #F1F5F9',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle size={16} color="#0D9F6E" />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: NAVY }}>${p.amount.toFixed(2)}</div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>{p.method}</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#64748B' }}>{p.date}</div>
            </div>
          ))
        ) : (
          <div style={{ color: '#94A3B8', fontSize: 14 }}>No payments recorded yet.</div>
        )}
      </div>

      {/* Pay Now */}
      {balance > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            style={{
              padding: '12px 32px',
              borderRadius: 8,
              border: 'none',
              background: CYAN,
              color: NAVY,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Pay ${balance.toFixed(2)} Now
          </button>
        </div>
      )}
    </div>
  );
}
