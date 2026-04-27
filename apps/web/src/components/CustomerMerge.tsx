import React, { useState } from 'react';
import { X, Search, ChevronRight, AlertTriangle, CheckCircle } from 'lucide-react';
import { useApi } from '../hooks/useApi';

interface MergeCustomer {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
  status: string;
  boats: number;
  invoices: number;
  payments: number;
}

interface CustomerMergeProps {
  source: MergeCustomer;
  onClose: () => void;
  onMerge: (targetId: string, fieldSelections: Record<string, 'source' | 'target'>) => void;
}

const MERGE_FIELDS = ['name', 'email', 'phone', 'company', 'address', 'status'] as const;
type MergeField = typeof MERGE_FIELDS[number];

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#FFFFFF',
    borderRadius: '8px',
    width: '780px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 32px 16px',
    borderBottom: '1px solid #E2E8F0',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#2E4A6B',
    padding: '4px',
  },
  body: {
    padding: '24px 32px',
  },
  steps: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '32px',
  },
  stepDot: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 700,
  },
  stepLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
  },
  stepArrow: {
    color: '#CCC',
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px 10px 36px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    boxSizing: 'border-box' as const,
    marginBottom: '16px',
  },
  customerOption: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    cursor: 'pointer',
    marginBottom: '8px',
    transition: 'background 0.15s',
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0',
  },
  colHeader: {
    padding: '12px 16px',
    fontSize: '13px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
  },
  fieldRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    borderBottom: '1px solid #E2E8F0',
  },
  fieldCell: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#0A2342',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fieldLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    padding: '8px 16px',
    backgroundColor: '#F2F4F6',
    gridColumn: '1 / -1',
  },
  radio: {
    accentColor: '#0A2342',
    cursor: 'pointer',
  },
  summaryCard: {
    background: '#F7F9FB',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '16px',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    fontSize: '14px',
    color: '#0A2342',
  },
  warningBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '16px',
    background: '#FFF3CD',
    borderRadius: '6px',
    border: '1px solid #F0E68C',
    marginTop: '16px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '16px 32px 24px',
    borderTop: '1px solid #E2E8F0',
  },
  secondaryBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2E4A6B',
    background: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  primaryBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  dangerBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#B71C1C',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

interface ApiCustomer {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string | null;
  addressJson?: { address?: string; city?: string; state?: string; zip?: string } | null;
  status?: string;
}

function formatAddressFromJson(a?: { address?: string; city?: string; state?: string; zip?: string } | null): string {
  if (!a) return '';
  const parts: string[] = [];
  if (a.address) parts.push(a.address);
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (cityLine) parts.push(cityLine);
  return parts.join(', ');
}

export default function CustomerMerge({ source, onClose, onMerge }: CustomerMergeProps) {
  const [step, setStep] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [target, setTarget] = useState<MergeCustomer | null>(null);
  const [selections, setSelections] = useState<Record<MergeField, 'source' | 'target'>>({
    name: 'source',
    email: 'source',
    phone: 'source',
    company: 'source',
    address: 'source',
    status: 'source',
  });

  const { data: apiCustomers } = useApi<ApiCustomer[]>('get', '/api/customers', { immediate: true });
  const candidates: MergeCustomer[] = (apiCustomers ?? []).map((c) => ({
    id: c.id,
    name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || c.id,
    email: c.email ?? '',
    phone: c.phone ?? '',
    company: c.company ?? '',
    address: formatAddressFromJson(c.addressJson),
    status: c.status ?? '',
    boats: 0,
    invoices: 0,
    payments: 0,
  }));

  const filteredTargets = candidates.filter(
    (c) => c.id !== source.id && c.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const getFieldValue = (customer: MergeCustomer, field: MergeField): string => {
    return (customer as unknown as Record<string, unknown>)[field] as string || '(empty)';
  };

  const isConflict = (field: MergeField): boolean => {
    if (!target) return false;
    return getFieldValue(source, field) !== getFieldValue(target, field);
  };

  const stepLabels = ['Select Target', 'Compare Fields', 'Summary', 'Confirm'];

  const renderSteps = () => (
    <div style={styles.steps}>
      {stepLabels.map((label, i) => {
        const num = i + 1;
        const isActive = num === step;
        const isDone = num < step;
        return (
          <React.Fragment key={num}>
            {i > 0 && <ChevronRight size={16} style={styles.stepArrow} />}
            <div
              style={{
                ...styles.stepDot,
                backgroundColor: isActive ? '#0A2342' : isDone ? '#00D4FF' : '#F2F4F6',
                color: isActive ? '#FFFFFF' : isDone ? '#0A2342' : '#64748B',
              }}
            >
              {isDone ? <CheckCircle size={16} /> : num}
            </div>
            <span style={{ ...styles.stepLabel, color: isActive ? '#0A2342' : '#64748B' }}>{label}</span>
          </React.Fragment>
        );
      })}
    </div>
  );

  const renderStep1 = () => (
    <div>
      <p style={{ fontSize: '14px', color: '#2E4A6B', marginBottom: '16px' }}>
        Select the customer to merge <strong>{source.name}</strong> into:
      </p>
      <div style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: '10px', top: '12px', color: '#64748B', pointerEvents: 'none' }} />
        <input
          style={styles.searchInput}
          placeholder="Search customers..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      {filteredTargets.map((c) => (
        <div
          key={c.id}
          style={{
            ...styles.customerOption,
            backgroundColor: target?.id === c.id ? '#D6E8F4' : '#FFFFFF',
            borderColor: target?.id === c.id ? '#00D4FF' : '#E2E8F0',
          }}
          onClick={() => setTarget(c)}
        >
          <div>
            <div style={{ fontWeight: 600, color: '#0A2342' }}>{c.name}</div>
            <div style={{ fontSize: '13px', color: '#64748B' }}>{c.email} | {c.phone}</div>
          </div>
          <div style={{ fontSize: '13px', color: '#2E4A6B' }}>{c.status}</div>
        </div>
      ))}
    </div>
  );

  const renderStep2 = () => (
    <div>
      <p style={{ fontSize: '14px', color: '#2E4A6B', marginBottom: '16px' }}>
        For each conflicting field, select which value to keep:
      </p>
      <div style={{ border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={styles.twoCol}>
          <div style={styles.colHeader}>Source: {source.name}</div>
          <div style={styles.colHeader}>Target: {target?.name}</div>
        </div>
        {MERGE_FIELDS.map((field) => {
          const conflict = isConflict(field);
          return (
            <React.Fragment key={field}>
              <div style={styles.fieldLabel}>{field.charAt(0).toUpperCase() + field.slice(1)}</div>
              <div style={{ ...styles.fieldRow, backgroundColor: conflict ? '#FFFBE6' : '#FFFFFF' }}>
                <div style={styles.fieldCell}>
                  {conflict ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={field}
                        checked={selections[field] === 'source'}
                        onChange={() => setSelections((s) => ({ ...s, [field]: 'source' }))}
                        style={styles.radio}
                      />
                      {getFieldValue(source, field)}
                    </label>
                  ) : (
                    <span style={{ color: '#64748B' }}>{getFieldValue(source, field)}</span>
                  )}
                </div>
                <div style={styles.fieldCell}>
                  {conflict ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={field}
                        checked={selections[field] === 'target'}
                        onChange={() => setSelections((s) => ({ ...s, [field]: 'target' }))}
                        style={styles.radio}
                      />
                      {target ? getFieldValue(target, field) : ''}
                    </label>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#1B5E20' }}>
                      <CheckCircle size={14} /> Auto-resolved (matching)
                    </span>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div>
      <p style={{ fontSize: '14px', color: '#2E4A6B', marginBottom: '16px' }}>
        Review what will be merged from <strong>{source.name}</strong> into <strong>{target?.name}</strong>:
      </p>
      <div style={styles.summaryCard}>
        <div style={styles.summaryRow}>
          <span>Invoices to transfer</span>
          <strong style={{ fontFamily: '"JetBrains Mono", monospace' }}>{source.invoices}</strong>
        </div>
        <div style={styles.summaryRow}>
          <span>Boats to transfer</span>
          <strong style={{ fontFamily: '"JetBrains Mono", monospace' }}>{source.boats}</strong>
        </div>
        <div style={styles.summaryRow}>
          <span>Payments to transfer</span>
          <strong style={{ fontFamily: '"JetBrains Mono", monospace' }}>{source.payments}</strong>
        </div>
        <div style={{ ...styles.summaryRow, borderTop: '1px solid #E2E8F0', paddingTop: '12px', marginTop: '4px' }}>
          <span>Field selections</span>
          <span>
            {MERGE_FIELDS.filter((f) => isConflict(f) && selections[f] === 'source').length} from source,{' '}
            {MERGE_FIELDS.filter((f) => isConflict(f) && selections[f] === 'target').length} from target
          </span>
        </div>
      </div>
      <div style={{ fontSize: '13px', color: '#64748B' }}>
        The source customer record <strong>{source.name}</strong> will be deactivated after merge.
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div>
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <AlertTriangle size={40} style={{ color: '#856404', marginBottom: '16px' }} />
        <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: '0 0 8px' }}>
          Confirm Customer Merge
        </h3>
        <p style={{ fontSize: '14px', color: '#2E4A6B', margin: '0 0 16px' }}>
          This will merge <strong>{source.name}</strong> into <strong>{target?.name}</strong>.
          All invoices, boats, payments, and documents will be transferred.
        </p>
      </div>
      <div style={styles.warningBox}>
        <AlertTriangle size={20} style={{ color: '#856404', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#856404', marginBottom: '4px' }}>
            This action can be undone within 15 minutes
          </div>
          <div style={{ fontSize: '13px', color: '#856404' }}>
            After 15 minutes, the merge becomes permanent and cannot be reversed.
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Merge Customer</h2>
          <button style={styles.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={styles.body}>
          {renderSteps()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </div>
        <div style={styles.footer}>
          <button
            style={styles.secondaryBtn}
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 4 ? (
            <button
              style={{
                ...styles.primaryBtn,
                opacity: step === 1 && !target ? 0.5 : 1,
                pointerEvents: step === 1 && !target ? 'none' : 'auto',
              }}
              onClick={() => setStep(step + 1)}
            >
              Next
            </button>
          ) : (
            <button
              style={styles.dangerBtn}
              onClick={() => target && onMerge(target.id, selections)}
            >
              Confirm Merge
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
