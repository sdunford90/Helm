import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';

interface CustomerFormData {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  dob: string;
  dlNumber: string;
  dlState: string;
  dlExpiry: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencyEmail: string;
  taxExempt: boolean;
  taxCertExpiry: string;
  status: string;
}

interface CustomerFormProps {
  onClose: () => void;
  onSave: (data: CustomerFormData) => void;
  initial?: Partial<CustomerFormData>;
}

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
    width: '720px',
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
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '16px',
    marginTop: '24px',
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#0A2342',
  },
  input: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    outline: 'none',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  textarea: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    outline: 'none',
    resize: 'vertical' as const,
    minHeight: '72px',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    background: '#FFFFFF',
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '8px',
  },
  checkbox: {
    accentColor: '#0A2342',
    cursor: 'pointer',
  },
  checkLabel: {
    fontSize: '14px',
    color: '#0A2342',
    cursor: 'pointer',
  },
  uploadBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    background: '#F2F4F6',
    border: '1px solid #CCC',
    borderRadius: '4px',
    cursor: 'pointer',
    marginTop: '8px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 32px 24px',
    borderTop: '1px solid #E2E8F0',
  },
  cancelBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2E4A6B',
    background: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  error: {
    fontSize: '12px',
    color: '#B71C1C',
    marginTop: '2px',
  },
};

export default function CustomerForm({ onClose, onSave, initial }: CustomerFormProps) {
  const [form, setForm] = useState<CustomerFormData>({
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    company: initial?.company ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    dob: initial?.dob ?? '',
    dlNumber: initial?.dlNumber ?? '',
    dlState: initial?.dlState ?? '',
    dlExpiry: initial?.dlExpiry ?? '',
    emergencyName: initial?.emergencyName ?? '',
    emergencyRelationship: initial?.emergencyRelationship ?? '',
    emergencyPhone: initial?.emergencyPhone ?? '',
    emergencyEmail: initial?.emergencyEmail ?? '',
    taxExempt: initial?.taxExempt ?? false,
    taxCertExpiry: initial?.taxCertExpiry ?? '',
    status: initial?.status ?? 'Active',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof CustomerFormData, string>>>({});

  const set = (key: keyof CustomerFormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim()) e.phone = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (validate()) onSave(form);
  };

  const inputStyle = (key: keyof CustomerFormData): React.CSSProperties => ({
    ...styles.input,
    ...(errors[key] ? { borderColor: '#B71C1C', boxShadow: '0 0 0 2px rgba(183,28,28,0.15)' } : {}),
  });

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>{initial ? 'Edit Customer' : 'Add Customer'}</h2>
          <button style={styles.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        <div style={styles.body}>
          <div style={{ ...styles.sectionTitle, marginTop: 0 }}>Contact Information</div>
          <div style={styles.twoCol}>
            {/* Left column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={styles.field}>
                <label style={styles.label}>First Name *</label>
                <input style={inputStyle('firstName')} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
                {errors.firstName && <span style={styles.error}>{errors.firstName}</span>}
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Last Name *</label>
                <input style={inputStyle('lastName')} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
                {errors.lastName && <span style={styles.error}>{errors.lastName}</span>}
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Company</label>
                <input style={styles.input} value={form.company} onChange={(e) => set('company', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Email *</label>
                <input style={inputStyle('email')} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
                {errors.email && <span style={styles.error}>{errors.email}</span>}
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Phone *</label>
                <input style={inputStyle('phone')} value={form.phone} onChange={(e) => set('phone', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
                {errors.phone && <span style={styles.error}>{errors.phone}</span>}
              </div>
            </div>

            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={styles.field}>
                <label style={styles.label}>Address</label>
                <textarea style={styles.textarea} value={form.address} onChange={(e) => set('address', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Date of Birth</label>
                <input style={styles.input} type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Driver's License #</label>
                <input style={styles.input} value={form.dlNumber} onChange={(e) => set('dlNumber', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>DL State</label>
                <input style={styles.input} value={form.dlState} onChange={(e) => set('dlState', e.target.value)} placeholder="e.g. FL" onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>DL Expiry</label>
                <input style={styles.input} type="date" value={form.dlExpiry} onChange={(e) => set('dlExpiry', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
              </div>
            </div>
          </div>

          {/* Emergency Contact */}
          <div style={styles.sectionTitle}>Emergency Contact</div>
          <div style={styles.twoCol}>
            <div style={styles.field}>
              <label style={styles.label}>Name</label>
              <input style={styles.input} value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Relationship</label>
              <input style={styles.input} value={form.emergencyRelationship} onChange={(e) => set('emergencyRelationship', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Phone</label>
              <input style={styles.input} value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={form.emergencyEmail} onChange={(e) => set('emergencyEmail', e.target.value)} onFocus={(e) => { e.target.style.borderColor = '#2E4A6B'; e.target.style.boxShadow = '0 0 0 2px rgba(46,74,107,0.2)'; }} onBlur={(e) => { e.target.style.borderColor = '#CCC'; e.target.style.boxShadow = 'none'; }} />
            </div>
          </div>

          {/* Settings */}
          <div style={styles.sectionTitle}>Settings</div>
          <div style={styles.twoCol}>
            <div>
              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={form.taxExempt}
                  onChange={(e) => set('taxExempt', e.target.checked)}
                  style={styles.checkbox}
                />
                <span style={styles.checkLabel}>Tax Exempt</span>
              </label>
              {form.taxExempt && (
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button style={styles.uploadBtn}>
                    <Upload size={14} />
                    Upload Tax Certificate
                  </button>
                  <div style={styles.field}>
                    <label style={styles.label}>Certificate Expiry</label>
                    <input style={styles.input} type="date" value={form.taxCertExpiry} onChange={(e) => set('taxCertExpiry', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Status</label>
              <select style={styles.select} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Waitlist">Waitlist</option>
                <option value="Collections Hold">Collections Hold</option>
                <option value="Seasonal">Seasonal</option>
              </select>
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.saveBtn} onClick={handleSave}>Save Customer</button>
        </div>
      </div>
    </div>
  );
}
