import { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Eye,
  Code,
  Save,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type FormType = 'Slip Inquiry' | 'Rental Inquiry' | 'Waitlist Signup' | 'General Contact';

interface FormField {
  key: string;
  label: string;
  enabled: boolean;
  required: boolean;
}

interface LeadFormBuilderProps {
  onClose: () => void;
}

/* ── Default Fields ───────────────────────────────────── */

const DEFAULT_FIELDS: FormField[] = [
  { key: 'firstName', label: 'First Name', enabled: true, required: true },
  { key: 'lastName', label: 'Last Name', enabled: true, required: true },
  { key: 'email', label: 'Email', enabled: true, required: true },
  { key: 'phone', label: 'Phone', enabled: true, required: false },
  { key: 'boatLength', label: 'Boat Length', enabled: true, required: false },
  { key: 'slipType', label: 'Slip Type', enabled: true, required: false },
  { key: 'notes', label: 'Notes', enabled: true, required: false },
  { key: 'preferredDate', label: 'Preferred Date', enabled: false, required: false },
];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.5)',
    zIndex: 1100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    width: '640px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '24px',
    borderBottom: '1px solid #E2E8F0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
  },
  closeBtn: {
    padding: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: '#2E4A6B',
    display: 'flex',
    alignItems: 'center',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
  },
  formGroup: {
    marginBottom: '24px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFF',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    padding: '10px 32px 10px 12px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFF',
    appearance: 'none' as const,
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
  },
  fieldsHeader: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    marginBottom: '12px',
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #E2E8F0',
    marginBottom: '8px',
    backgroundColor: '#FFFFFF',
  },
  fieldRowDisabled: {
    backgroundColor: '#F7F9FB',
    opacity: 0.6,
  },
  checkbox: {
    width: '18px',
    height: '18px',
    accentColor: '#0A2342',
    cursor: 'pointer',
  },
  fieldLabel: {
    flex: 1,
    fontSize: '14px',
    color: '#0A2342',
    fontWeight: 500,
  },
  requiredBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#B71C1C',
    backgroundColor: '#FDECEA',
    padding: '2px 8px',
    borderRadius: '9999px',
  },
  optionalBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#64748B',
    backgroundColor: '#F2F4F6',
    padding: '2px 8px',
    borderRadius: '9999px',
  },
  divider: {
    height: '1px',
    backgroundColor: '#E2E8F0',
    border: 'none',
    margin: '24px 0',
  },
  tabBar: {
    display: 'flex',
    gap: '0px',
    marginBottom: '16px',
    borderBottom: '2px solid #E2E8F0',
  },
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
  tabActive: {
    color: '#0A2342',
    borderBottomColor: '#00D4FF',
  },
  codeBlock: {
    backgroundColor: '#0A2342',
    color: '#00D4FF',
    padding: '16px',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: '"JetBrains Mono", monospace',
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
  previewCard: {
    backgroundColor: '#F7F9FB',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '24px',
  },
  previewTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#0A2342',
    marginBottom: '20px',
  },
  previewField: {
    marginBottom: '16px',
  },
  previewLabel: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    marginBottom: '4px',
  },
  previewInput: {
    width: '100%',
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFFFFF',
    color: '#999',
    boxSizing: 'border-box' as const,
  },
  footer: {
    padding: '20px 24px',
    borderTop: '1px solid #E2E8F0',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    backgroundColor: '#F7F9FB',
  },
  cancelBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#0A2342',
    backgroundColor: '#FFFFFF',
    border: '1px solid #0A2342',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  saveBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

/* ── Component ─────────────────────────────────────────── */

export default function LeadFormBuilder({ onClose }: LeadFormBuilderProps) {
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<FormType>('Slip Inquiry');
  const [fields, setFields] = useState<FormField[]>(DEFAULT_FIELDS);
  const [previewTab, setPreviewTab] = useState<'preview' | 'embed'>('preview');
  const [copied, setCopied] = useState(false);

  const toggleField = (key: string) => {
    setFields(fields.map((f) => {
      if (f.key === key) {
        // Don't allow disabling required fields
        if (f.required) return f;
        return { ...f, enabled: !f.enabled };
      }
      return f;
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
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <h2 style={s.headerTitle}>Lead Form Builder</h2>
          <button style={s.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
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
              <select
                style={s.select}
                value={formType}
                onChange={(e) => setFormType(e.target.value as FormType)}
              >
                <option>Slip Inquiry</option>
                <option>Rental Inquiry</option>
                <option>Waitlist Signup</option>
                <option>General Contact</option>
              </select>
            </div>
          </div>

          {/* Field List */}
          <div style={s.fieldsHeader}>Form Fields</div>
          {fields.map((field) => (
            <div
              key={field.key}
              style={{
                ...s.fieldRow,
                ...(field.enabled ? {} : s.fieldRowDisabled),
              }}
            >
              <input
                type="checkbox"
                style={s.checkbox}
                checked={field.enabled}
                onChange={() => toggleField(field.key)}
                disabled={field.required}
              />
              <span style={s.fieldLabel}>{field.label}</span>
              {field.required ? (
                <span style={s.requiredBadge}>Required</span>
              ) : (
                <span style={s.optionalBadge}>Optional</span>
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
              <div style={s.previewTitle}>
                {formName || 'Untitled Form'}
              </div>
              {enabledFields.map((field) => (
                <div key={field.key} style={s.previewField}>
                  <label style={s.previewLabel}>
                    {field.label}
                    {field.required && <span style={{ color: '#B71C1C' }}> *</span>}
                  </label>
                  {field.key === 'notes' ? (
                    <textarea
                      style={{ ...s.previewInput, minHeight: '60px', resize: 'vertical' as const }}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                      readOnly
                    />
                  ) : field.key === 'slipType' ? (
                    <select style={{ ...s.previewInput, appearance: 'none' as const }} disabled>
                      <option>Select slip type...</option>
                    </select>
                  ) : (
                    <input
                      style={s.previewInput}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                      readOnly
                    />
                  )}
                </div>
              ))}
              <button
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  backgroundColor: '#0A2342',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'default',
                  marginTop: '8px',
                }}
              >
                Submit Inquiry
              </button>
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
          <button style={s.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button style={s.saveBtn} onClick={onClose}>
            <Save size={16} />
            Save Form
          </button>
        </div>
      </div>
    </div>
  );
}
