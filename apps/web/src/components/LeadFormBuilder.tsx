import { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Eye,
  Code,
  Save,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type FormType = 'Slip Inquiry' | 'Rental Inquiry' | 'Waitlist Signup' | 'General Contact';
type FieldType = 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'dropdown' | 'date';

interface FormField {
  key: string;
  label: string;
  enabled: boolean;
  required: boolean;
  type: FieldType;
  options: string[];
  expanded: boolean;
}

interface LeadFormBuilderProps {
  onClose: () => void;
  onSave?: (name: string, type: FormType, fields: FormField[]) => void;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  textarea: 'Long Text',
  dropdown: 'Dropdown',
  date: 'Date',
};

/* ── Default Fields ───────────────────────────────────── */

const DEFAULT_FIELDS: FormField[] = [
  { key: 'firstName', label: 'First Name', enabled: true, required: true, type: 'text', options: [], expanded: false },
  { key: 'lastName', label: 'Last Name', enabled: true, required: true, type: 'text', options: [], expanded: false },
  { key: 'email', label: 'Email', enabled: true, required: true, type: 'email', options: [], expanded: false },
  { key: 'phone', label: 'Phone', enabled: true, required: false, type: 'phone', options: [], expanded: false },
  { key: 'boatLength', label: 'Boat Length', enabled: true, required: false, type: 'number', options: [], expanded: false },
  { key: 'slipType', label: 'Slip Type', enabled: true, required: false, type: 'dropdown', options: ['Annual', 'Seasonal', 'Transient', 'Liveaboard'], expanded: false },
  { key: 'notes', label: 'Notes / Comments', enabled: true, required: false, type: 'textarea', options: [], expanded: false },
  { key: 'preferredDate', label: 'Preferred Move-in Date', enabled: false, required: false, type: 'date', options: [], expanded: false },
];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.5)',
    zIndex: 1100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    width: '680px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '20px 24px',
    borderBottom: '1px solid #E2E8F0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { padding: '4px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#2E4A6B', display: 'flex', alignItems: 'center' },
  body: { flex: 1, overflowY: 'auto', padding: '24px' },
  formGroup: { marginBottom: '20px' },
  label: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#2E4A6B', marginBottom: '6px', textTransform: 'uppercase' as const, letterSpacing: '0.03em' },
  input: { width: '100%', padding: '9px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CBD5E1', borderRadius: '6px', backgroundColor: '#FFF', outline: 'none', boxSizing: 'border-box' as const },
  select: { width: '100%', padding: '9px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CBD5E1', borderRadius: '6px', backgroundColor: '#FFF', cursor: 'pointer', boxSizing: 'border-box' as const },
  sectionLabel: { fontSize: '12px', fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase' as const, letterSpacing: '0.03em', marginBottom: '10px' },
  fieldRow: {
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    marginBottom: '8px',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  fieldRowDisabled: { backgroundColor: '#F7F9FB', opacity: 0.6 },
  fieldRowMain: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
  },
  checkbox: { width: '16px', height: '16px', accentColor: '#0A2342', cursor: 'pointer', flexShrink: 0 },
  fieldLabel: { flex: 1, fontSize: '14px', color: '#0A2342', fontWeight: 500 },
  typeSelect: {
    padding: '4px 8px',
    fontSize: '12px',
    color: '#0A2342',
    border: '1px solid #CBD5E1',
    borderRadius: '4px',
    backgroundColor: '#F7F9FB',
    cursor: 'pointer',
    outline: 'none',
  },
  requiredToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 10px',
    borderRadius: '9999px',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid transparent',
    userSelect: 'none' as const,
  },
  expandBtn: {
    padding: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: '#64748B',
    display: 'flex',
    alignItems: 'center',
  },
  fieldExpanded: {
    padding: '12px 14px',
    borderTop: '1px solid #F0F4F8',
    backgroundColor: '#FAFCFE',
  },
  optionRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  optionInput: {
    flex: 1,
    padding: '6px 10px',
    fontSize: '13px',
    color: '#0A2342',
    border: '1px solid #CBD5E1',
    borderRadius: '4px',
    outline: 'none',
    backgroundColor: '#FFF',
  },
  optionDeleteBtn: {
    padding: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: '#EF4444',
    display: 'flex',
    alignItems: 'center',
  },
  addOptionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#0A2342',
    backgroundColor: '#F0F4F8',
    border: '1px solid #CBD5E1',
    borderRadius: '4px',
    cursor: 'pointer',
    marginTop: '4px',
  },
  divider: { height: '1px', backgroundColor: '#E2E8F0', border: 'none', margin: '20px 0' },
  tabBar: { display: 'flex', gap: '0px', marginBottom: '16px', borderBottom: '2px solid #E2E8F0' },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#64748B',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    cursor: 'pointer',
  },
  tabActive: { color: '#0A2342', borderBottomColor: '#00D4FF' },
  codeBlock: {
    backgroundColor: '#0A2342',
    color: '#00D4FF',
    padding: '16px',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.6,
    overflowX: 'auto' as const,
    position: 'relative' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  copyBtn: {
    position: 'absolute' as const,
    top: '8px',
    right: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  previewCard: { backgroundColor: '#F7F9FB', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '24px' },
  previewTitle: { fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '20px' },
  previewField: { marginBottom: '16px' },
  previewLabel: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#2E4A6B', marginBottom: '4px' },
  previewInput: { width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFFFFF', color: '#999', boxSizing: 'border-box' as const },
  footer: { padding: '20px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#F7F9FB' },
  cancelBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #0A2342', borderRadius: '6px', cursor: 'pointer' },
  saveBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
};

/* ── Component ─────────────────────────────────────────── */

export default function LeadFormBuilder({ onClose, onSave }: LeadFormBuilderProps) {
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<FormType>('Slip Inquiry');
  const [fields, setFields] = useState<FormField[]>(DEFAULT_FIELDS);
  const [previewTab, setPreviewTab] = useState<'preview' | 'embed'>('preview');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateField = (key: string, changes: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => f.key === key ? { ...f, ...changes } : f));
  };

  const toggleEnabled = (key: string) => {
    setFields((prev) => prev.map((f) => {
      if (f.key !== key) return f;
      if (f.required) return f; // can't disable required fields unless you un-require them first
      return { ...f, enabled: !f.enabled };
    }));
  };

  const toggleRequired = (key: string) => {
    setFields((prev) => prev.map((f) => {
      if (f.key !== key) return f;
      const nowRequired = !f.required;
      return { ...f, required: nowRequired, enabled: nowRequired ? true : f.enabled };
    }));
  };

  const toggleExpanded = (key: string) => {
    setFields((prev) => prev.map((f) => f.key === key ? { ...f, expanded: !f.expanded } : f));
  };

  const addOption = (key: string) => {
    setFields((prev) => prev.map((f) => f.key === key ? { ...f, options: [...f.options, ''] } : f));
  };

  const updateOption = (key: string, idx: number, value: string) => {
    setFields((prev) => prev.map((f) => {
      if (f.key !== key) return f;
      const opts = [...f.options];
      opts[idx] = value;
      return { ...f, options: opts };
    }));
  };

  const removeOption = (key: string, idx: number) => {
    setFields((prev) => prev.map((f) => {
      if (f.key !== key) return f;
      return { ...f, options: f.options.filter((_, i) => i !== idx) };
    }));
  };

  const enabledFields = fields.filter((f) => f.enabled);

  const embedCode = `<script
  src="https://cdn.helmhq.com/forms/v1.js"
  data-helm-form="${formName || 'untitled'}"
  data-helm-type="${formType.toLowerCase().replace(/\s/g, '-')}"
  data-helm-fields="${enabledFields.map((f) => f.key).join(',')}"
  data-helm-marina="YOUR_MARINA_ID"
></script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <h2 style={s.headerTitle}>Lead Form Builder</h2>
          <button style={s.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={s.body}>
          {/* Form Settings */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
            <div style={s.formGroup}>
              <label style={s.label}>Form Name</label>
              <input
                style={s.input}
                placeholder="e.g., Homepage Slip Inquiry"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Form Type</label>
              <select style={s.select} value={formType} onChange={(e) => setFormType(e.target.value as FormType)}>
                <option>Slip Inquiry</option>
                <option>Rental Inquiry</option>
                <option>Waitlist Signup</option>
                <option>General Contact</option>
              </select>
            </div>
          </div>

          {/* Field List */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div style={s.sectionLabel}>Form Fields</div>
            <div style={{ fontSize: '12px', color: '#64748B' }}>
              Check to include · Click badge to toggle required · Expand for options
            </div>
          </div>

          {fields.map((field) => (
            <div
              key={field.key}
              style={{ ...s.fieldRow, ...(field.enabled ? {} : s.fieldRowDisabled) }}
            >
              <div style={s.fieldRowMain}>
                {/* Enable/Disable */}
                <input
                  type="checkbox"
                  style={s.checkbox}
                  checked={field.enabled}
                  onChange={() => toggleEnabled(field.key)}
                  title={field.required ? 'Un-require this field to disable it' : ''}
                />

                {/* Label */}
                <span style={s.fieldLabel}>{field.label}</span>

                {/* Field Type */}
                <select
                  style={s.typeSelect}
                  value={field.type}
                  onChange={(e) => updateField(field.key, { type: e.target.value as FieldType })}
                  disabled={!field.enabled}
                >
                  {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                    <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                  ))}
                </select>

                {/* Required Toggle */}
                <button
                  onClick={() => toggleRequired(field.key)}
                  style={{
                    ...s.requiredToggle,
                    ...(field.required
                      ? { backgroundColor: '#FDECEA', color: '#B71C1C', borderColor: '#F5C0BB' }
                      : { backgroundColor: '#F2F4F6', color: '#64748B', borderColor: '#E2E8F0' }),
                  }}
                  title="Click to toggle required"
                >
                  {field.required ? '★ Required' : '☆ Optional'}
                </button>

                {/* Expand (for dropdown options) */}
                {field.type === 'dropdown' && field.enabled && (
                  <button style={s.expandBtn} onClick={() => toggleExpanded(field.key)}>
                    {field.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
              </div>

              {/* Dropdown Options Editor */}
              {field.type === 'dropdown' && field.expanded && field.enabled && (
                <div style={s.fieldExpanded}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#2E4A6B', marginBottom: '8px' }}>
                    DROPDOWN OPTIONS
                  </div>
                  {field.options.map((opt, idx) => (
                    <div key={idx} style={s.optionRow}>
                      <input
                        style={s.optionInput}
                        value={opt}
                        placeholder={`Option ${idx + 1}`}
                        onChange={(e) => updateOption(field.key, idx, e.target.value)}
                      />
                      <button style={s.optionDeleteBtn} onClick={() => removeOption(field.key, idx)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button style={s.addOptionBtn} onClick={() => addOption(field.key)}>
                    <Plus size={12} />
                    Add Option
                  </button>
                </div>
              )}
            </div>
          ))}

          <hr style={s.divider} />

          {/* Preview / Embed Tabs */}
          <div style={s.tabBar}>
            <button
              style={{ ...s.tab, ...(previewTab === 'preview' ? s.tabActive : {}) }}
              onClick={() => setPreviewTab('preview')}
            >
              <Eye size={14} />
              Preview
            </button>
            <button
              style={{ ...s.tab, ...(previewTab === 'embed' ? s.tabActive : {}) }}
              onClick={() => setPreviewTab('embed')}
            >
              <Code size={14} />
              Embed Code
            </button>
          </div>

          {previewTab === 'preview' && (
            <div style={s.previewCard}>
              <div style={s.previewTitle}>{formName || 'Untitled Form'}</div>
              {enabledFields.map((field) => (
                <div key={field.key} style={s.previewField}>
                  <label style={s.previewLabel}>
                    {field.label}
                    {field.required && <span style={{ color: '#B71C1C' }}> *</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      style={{ ...s.previewInput, minHeight: '60px', resize: 'vertical' as const }}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                      readOnly
                    />
                  ) : field.type === 'dropdown' ? (
                    <select style={{ ...s.previewInput }} disabled>
                      <option>Select {field.label.toLowerCase()}...</option>
                      {field.options.filter(Boolean).map((opt) => (
                        <option key={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      style={s.previewInput}
                      type={field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                      readOnly
                    />
                  )}
                </div>
              ))}
              {enabledFields.length === 0 && (
                <div style={{ color: '#64748B', fontSize: '14px' }}>No fields enabled.</div>
              )}
              {enabledFields.length > 0 && (
                <button style={{ width: '100%', padding: '12px', fontSize: '15px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'default', marginTop: '8px' }}>
                  Submit Inquiry
                </button>
              )}
            </div>
          )}

          {previewTab === 'embed' && (
            <div style={s.codeBlock}>
              <button style={s.copyBtn} onClick={handleCopy}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              {embedCode}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...s.saveBtn, backgroundColor: saved ? '#16A34A' : undefined }}
            onClick={() => {
              if (saved) return;
              onSave?.(formName, formType, fields);
              setSaved(true);
              setTimeout(() => onClose(), 1000);
            }}
          >
            {saved ? <Check size={16} /> : <Save size={16} />}
            {saved ? 'Saved!' : 'Save Form'}
          </button>
        </div>
      </div>
    </div>
  );
}
