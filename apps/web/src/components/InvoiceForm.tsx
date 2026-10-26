import { useState, useCallback } from 'react';
import { X, Plus, Trash2, Save, Send } from 'lucide-react';
import { formatCents, todayKey } from '../lib/format';
import { errorMessage } from '../lib/api';
import { useApiClient } from '../hooks/useApi';
import CustomerPicker from './CustomerPicker';
import type { CustomerRef, InvoiceDTO } from '../lib/dto';

/* ─── Types ─── */
interface LineItem {
  id: number;
  description: string;
  qty: string;   // raw input text, parsed on submit
  price: string; // raw dollar text, so typing "12.5" is not reformatted mid-keystroke
}

interface InvoiceFormProps {
  onClose: () => void;
  /** Called only after the server accepted the invoice. */
  onCreated: (invoice: InvoiceDTO, finalized: boolean) => void;
  initialCustomer?: CustomerRef | null;
}

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    backgroundColor: '#FFFFFF', borderRadius: '8px', width: '800px', maxHeight: '90vh',
    overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '24px 32px', borderBottom: '1px solid #E2E8F0',
  },
  headerTitle: {
    fontSize: '22px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0,
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px',
  },
  body: { padding: '32px' },
  fieldGroup: { marginBottom: '24px' },
  label: {
    display: 'block', fontSize: '13px', fontWeight: 600, color: '#2E4A6B',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px',
  },
  input: {
    width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CCCCCC',
    fontSize: '14px', color: '#0A2342', boxSizing: 'border-box',
  },
  customerDropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#FFFFFF',
    border: '1px solid #CCCCCC', borderRadius: '0 0 6px 6px', maxHeight: '180px',
    overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  customerOption: {
    padding: '8px 12px', fontSize: '14px', color: '#0A2342', cursor: 'pointer',
    borderBottom: '1px solid #F2F4F6',
  },
  row: { display: 'flex', gap: '16px' },
  lineHeader: {
    display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr 1fr 40px',
    gap: '8px', marginBottom: '8px',
  },
  lineRow: {
    display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr 1fr 40px',
    gap: '8px', marginBottom: '8px', alignItems: 'center',
  },
  lineInput: {
    padding: '8px 10px', borderRadius: '6px', border: '1px solid #CCCCCC',
    fontSize: '13px', color: '#0A2342', boxSizing: 'border-box', width: '100%',
  },
  lineInputMono: {
    padding: '8px 10px', borderRadius: '6px', border: '1px solid #CCCCCC',
    fontSize: '13px', color: '#0A2342', boxSizing: 'border-box', width: '100%',
    ...mono, textAlign: 'right',
  },
  removeBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#B71C1C', padding: '4px',
  },
  addLineBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px',
    fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#F2F4F6',
    border: '1px solid #CCCCCC', borderRadius: '6px', cursor: 'pointer', marginTop: '4px',
  },
  totalsSection: {
    display: 'flex', justifyContent: 'flex-end', marginTop: '24px',
  },
  totalsTable: {
    width: '280px',
  },
  totalsRow: {
    display: 'flex', justifyContent: 'space-between', padding: '6px 0',
    fontSize: '14px', color: '#0A2342',
  },
  totalsFinal: {
    display: 'flex', justifyContent: 'space-between', padding: '10px 0',
    fontSize: '18px', fontWeight: 700, color: '#0A2342', borderTop: '2px solid #0A2342',
    marginTop: '4px',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: '12px',
    padding: '24px 32px', borderTop: '1px solid #E2E8F0',
  },
  secondaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px',
    fontSize: '14px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF',
    border: '1px solid #CCCCCC', borderRadius: '6px', cursor: 'pointer',
  },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px',
    fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  colLabel: {
    fontSize: '11px', fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};

let nextId = 1;
function blankLine(): LineItem {
  return { id: nextId++, description: '', qty: '1', price: '' };
}

/** Parse a dollar string to integer cents; null when not a valid amount. */
function toCents(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export default function InvoiceForm({ onClose, onCreated, initialCustomer }: InvoiceFormProps) {
  const client = useApiClient();
  const [customer, setCustomer] = useState<CustomerRef | null>(initialCustomer ?? null);
  const [issuedDate, setIssuedDate] = useState(todayKey());
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<LineItem[]>([blankLine()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const updateLine = useCallback((id: number, field: 'description' | 'qty' | 'price', value: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }, []);

  const removeLine = (id: number) => setLines((prev) => prev.filter((l) => l.id !== id));
  const addLine = () => setLines((prev) => [...prev, blankLine()]);

  const lineTotal = (l: LineItem) => {
    const q = Number(l.qty);
    const c = toCents(l.price);
    return Number.isFinite(q) && c !== null ? Math.round(q * c) : 0;
  };
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  const validate = (): string | null => {
    if (!customer) return 'Select a customer from the list.';
    if (!issuedDate) return 'Set an issue date.';
    if (!dueDate) return 'Set a due date.';
    if (dueDate < issuedDate) return 'The due date cannot be before the issue date.';
    for (const [i, l] of lines.entries()) {
      if (!l.description.trim()) return `Line ${i + 1}: add a description.`;
      const q = Number(l.qty);
      if (!Number.isFinite(q) || q <= 0) return `Line ${i + 1}: quantity must be greater than 0.`;
      if (toCents(l.price) === null) return `Line ${i + 1}: enter a unit price.`;
    }
    return null;
  };

  const submit = async (finalize: boolean) => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSaving(true);
    let created: InvoiceDTO | null = null;
    try {
      created = await client.post<InvoiceDTO>('/invoices', {
        customerId: customer!.id,
        issuedDate,
        dueDate,
        lineItems: lines.map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.qty),
          unitPriceCents: toCents(l.price)!,
        })),
      });
      if (finalize) {
        const finalized = await client.post<InvoiceDTO>(`/invoices/${created.id}/finalize`);
        onCreated(finalized, true);
      } else {
        onCreated(created, false);
      }
      onClose();
    } catch (err) {
      if (created) {
        // The draft exists; only finalizing failed. Say exactly that.
        setError(`Draft ${created.invoiceNumber} was saved, but finalizing failed: ${errorMessage(err)}`);
        onCreated(created, false);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.overlay}>
      <div style={s.modal} className="helm-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-form-title">
        {/* Header */}
        <div style={s.header}>
          <h2 id="invoice-form-title" style={s.headerTitle}>Create Invoice</h2>
          <button style={s.closeBtn} onClick={onClose} disabled={saving} aria-label="Close"><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={s.body}>
          {/* Customer Picker */}
          <div style={s.fieldGroup}>
            <label style={s.label}>Customer</label>
            <CustomerPicker value={customer} onChange={setCustomer} inputStyle={s.input} />
          </div>

          {/* Dates */}
          <div style={{ ...s.row, marginBottom: '24px' }} className="helm-form-grid">
            <div style={{ flex: 1 }}>
              <label style={s.label}>Issue Date</label>
              <input type="date" style={s.input} value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Due Date</label>
              <input type="date" style={s.input} value={dueDate} min={issuedDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Line Items */}
          <label style={{ ...s.label, marginBottom: '12px' }}>Line Items</label>
          <div style={s.lineHeader}>
            <span style={s.colLabel as React.CSSProperties}>Description</span>
            <span style={s.colLabel as React.CSSProperties}>Qty</span>
            <span style={s.colLabel as React.CSSProperties}>Unit Price</span>
            <span style={{ ...s.colLabel as React.CSSProperties, textAlign: 'right' }}>Amount</span>
            <span />
          </div>
          {lines.map((line) => (
            <div key={line.id} style={s.lineRow}>
              <input
                style={s.lineInput}
                placeholder="Description..."
                aria-label="Line description"
                value={line.description}
                onChange={(e) => updateLine(line.id, 'description', e.target.value)}
              />
              <input
                style={s.lineInputMono as React.CSSProperties}
                type="number"
                min={0}
                step="any"
                aria-label="Quantity"
                value={line.qty}
                onChange={(e) => updateLine(line.id, 'qty', e.target.value)}
              />
              <input
                style={s.lineInputMono as React.CSSProperties}
                type="number"
                step={0.01}
                placeholder="0.00"
                aria-label="Unit price in dollars"
                value={line.price}
                onChange={(e) => updateLine(line.id, 'price', e.target.value)}
              />
              <div style={{ ...mono, textAlign: 'right', fontSize: '13px', fontWeight: 600, color: '#0A2342', padding: '8px 4px' }}>
                {formatCents(lineTotal(line))}
              </div>
              <button
                style={s.removeBtn}
                onClick={() => removeLine(line.id)}
                disabled={lines.length === 1}
                title="Remove line"
                aria-label="Remove line"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button style={s.addLineBtn} onClick={addLine}>
            <Plus size={14} /> Add Line Item
          </button>

          {/* Totals */}
          <div style={s.totalsSection}>
            <div style={s.totalsTable}>
              <div style={s.totalsRow}>
                <span>Subtotal</span>
                <span style={{ ...mono, fontWeight: 600 }}>{formatCents(subtotal)}</span>
              </div>
              <div style={{ ...s.totalsRow, color: '#64748B', fontSize: '13px' }}>
                <span>Tax</span>
                <span>Calculated by the server on save</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>
          {error && <span role="alert" style={{ fontSize: '13px', color: '#B71C1C', flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button style={s.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...s.secondaryBtn, opacity: saving ? 0.7 : 1 }} onClick={() => submit(false)} disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button style={{ ...s.primaryBtn, opacity: saving ? 0.7 : 1 }} onClick={() => submit(true)} disabled={saving}>
            <Send size={16} /> {saving ? 'Saving...' : 'Save & Finalize'}
          </button>
        </div>
      </div>
    </div>
  );
}
