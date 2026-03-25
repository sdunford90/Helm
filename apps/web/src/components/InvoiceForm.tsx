import { useState, useCallback } from 'react';
import { X, Plus, Trash2, Save, Send } from 'lucide-react';
import { formatCents } from '../lib/format';

/* ─── Types ─── */
interface LineItem {
  id: number;
  description: string;
  qty: number;
  unitPrice: number; // cents
  taxRate: number;   // percentage e.g. 7
}

interface InvoiceFormProps {
  onClose: () => void;
  onSaveDraft?: (data: Record<string, unknown>) => void;
  onFinalize?: (data: Record<string, unknown>) => void;
}

/* ─── Mock customers ─── */
const mockCustomers = [
  'Harbor Point Yacht Club',
  'James T. Morrison',
  'Coastal Marine LLC',
  'Maria Gonzalez',
  'Sunset Bay Holdings',
  'Robert Chen',
  'Windward Sailing Co.',
  'Patricia Williams',
  'Blue Horizon Charters',
  'Thomas Drake',
  'Anchor Bay Marina',
  'Lisa Park',
];

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
    display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr 0.7fr 1fr 40px',
    gap: '8px', marginBottom: '8px',
  },
  lineRow: {
    display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr 0.7fr 1fr 40px',
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
  return { id: nextId++, description: '', qty: 1, unitPrice: 0, taxRate: 7 };
}

export default function InvoiceForm({ onClose, onSaveDraft, onFinalize }: InvoiceFormProps) {
  const [customer, setCustomer] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([blankLine()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredCustomers = mockCustomers.filter((c) =>
    c.toLowerCase().includes(customer.toLowerCase())
  );

  const updateLine = useCallback((id: number, field: keyof LineItem, value: string | number) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  }, []);

  const removeLine = (id: number) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const addLine = () => setLines((prev) => [...prev, blankLine()]);

  const lineTotal = (l: LineItem) => l.qty * l.unitPrice;
  const lineTax = (l: LineItem) => Math.round(lineTotal(l) * (l.taxRate / 100));
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const totalTax = lines.reduce((sum, l) => sum + lineTax(l), 0);
  const total = subtotal + totalTax;

  const buildPayload = () => ({
    customer,
    dueDate,
    notes,
    lines: lines.map((l) => ({
      description: l.description,
      qty: l.qty,
      unitPriceCents: l.unitPrice,
      taxRate: l.taxRate,
    })),
    subtotalCents: subtotal,
    taxCents: totalTax,
    totalCents: total,
  });

  const validate = (): boolean => {
    if (!customer.trim()) { setError('Please select a customer.'); return false; }
    if (!dueDate) { setError('Please set a due date.'); return false; }
    if (lines.every((l) => !l.description.trim() && l.unitPrice === 0)) { setError('Please add at least one line item.'); return false; }
    setError('');
    return true;
  };

  const handleSaveDraft = async () => {
    if (!validate()) return;
    setSaving(true);
    await onSaveDraft?.(buildPayload());
    setSaving(false);
    onClose();
  };

  const handleFinalize = async () => {
    if (!validate()) return;
    setSaving(true);
    await onFinalize?.(buildPayload());
    setSaving(false);
    onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <h2 style={s.headerTitle}>Create Invoice</h2>
          <button style={s.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={s.body}>
          {/* Customer Picker */}
          <div style={{ ...s.fieldGroup, position: 'relative' }}>
            <label style={s.label}>Customer</label>
            <input
              style={s.input}
              placeholder="Search for a customer..."
              value={customer}
              onChange={(e) => { setCustomer(e.target.value); setCustomerOpen(true); }}
              onFocus={() => setCustomerOpen(true)}
              onBlur={() => setTimeout(() => setCustomerOpen(false), 150)}
            />
            {customerOpen && customer.length > 0 && filteredCustomers.length > 0 && (
              <div style={s.customerDropdown as React.CSSProperties}>
                {filteredCustomers.map((c) => (
                  <div
                    key={c}
                    style={s.customerOption}
                    onMouseDown={() => { setCustomer(c); setCustomerOpen(false); }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#D6E8F4'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#FFFFFF'; }}
                  >
                    {c}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Due date & Notes */}
          <div style={{ ...s.row, marginBottom: '24px' }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Due Date</label>
              <input
                type="date"
                style={s.input}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div style={{ flex: 2 }}>
              <label style={s.label}>Notes</label>
              <input
                style={s.input}
                placeholder="Optional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Line Items */}
          <label style={{ ...s.label, marginBottom: '12px' }}>Line Items</label>
          <div style={s.lineHeader}>
            <span style={s.colLabel as React.CSSProperties}>Description</span>
            <span style={s.colLabel as React.CSSProperties}>Qty</span>
            <span style={s.colLabel as React.CSSProperties}>Unit Price</span>
            <span style={s.colLabel as React.CSSProperties}>Tax %</span>
            <span style={{ ...s.colLabel as React.CSSProperties, textAlign: 'right' }}>Total</span>
            <span />
          </div>
          {lines.map((line) => (
            <div key={line.id} style={s.lineRow}>
              <input
                style={s.lineInput}
                placeholder="Description..."
                value={line.description}
                onChange={(e) => updateLine(line.id, 'description', e.target.value)}
              />
              <input
                style={s.lineInputMono as React.CSSProperties}
                type="number"
                min={1}
                value={line.qty}
                onChange={(e) => updateLine(line.id, 'qty', parseInt(e.target.value) || 0)}
              />
              <input
                style={s.lineInputMono as React.CSSProperties}
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={line.unitPrice ? (line.unitPrice / 100).toFixed(2) : ''}
                onChange={(e) => updateLine(line.id, 'unitPrice', Math.round(parseFloat(e.target.value || '0') * 100))}
              />
              <input
                style={s.lineInputMono as React.CSSProperties}
                type="number"
                min={0}
                step={0.5}
                value={line.taxRate}
                onChange={(e) => updateLine(line.id, 'taxRate', parseFloat(e.target.value) || 0)}
              />
              <div style={{ ...mono, textAlign: 'right', fontSize: '13px', fontWeight: 600, color: '#0A2342', padding: '8px 4px' }}>
                {formatCents(lineTotal(line) + lineTax(line))}
              </div>
              <button
                style={s.removeBtn}
                onClick={() => removeLine(line.id)}
                disabled={lines.length === 1}
                title="Remove line"
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
              <div style={s.totalsRow}>
                <span>Tax</span>
                <span style={{ ...mono, fontWeight: 600 }}>{formatCents(totalTax)}</span>
              </div>
              <div style={s.totalsFinal}>
                <span>Total</span>
                <span style={mono}>{formatCents(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>
          {error && <span style={{ fontSize: '13px', color: '#B71C1C', flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button style={s.secondaryBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...s.secondaryBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSaveDraft} disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button style={{ ...s.primaryBtn, opacity: saving ? 0.7 : 1 }} onClick={handleFinalize} disabled={saving}>
            <Send size={16} /> {saving ? 'Saving...' : 'Save & Finalize'}
          </button>
        </div>
      </div>
    </div>
  );
}
