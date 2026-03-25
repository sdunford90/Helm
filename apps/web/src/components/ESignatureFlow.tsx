import React, { useState } from 'react';
import { X, FileText, Send, Eye, CheckCircle, Clock, AlertCircle, ChevronRight } from 'lucide-react';

/* ── Types ──────────────────────────────────────────────── */

type SignatureStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined';

interface ESignatureFlowProps {
  contractId: string;
  contractNumber: string;
  customerName: string;
  customerEmail: string;
  onClose: () => void;
  onSent: () => void;
}

/* ── Styles ─────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
  },
  modal: {
    background: '#FFFFFF',
    borderRadius: '8px',
    width: '600px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 28px 16px',
    borderBottom: '1px solid #E2E8F0',
    backgroundColor: '#0A2342',
    borderRadius: '8px 8px 0 0',
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#FFFFFF',
    margin: 0,
  },
  headerSub: {
    fontSize: '13px',
    color: '#94A3B8',
    marginTop: '2px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#FFFFFF',
    padding: '4px',
  },
  body: {
    padding: '24px 28px',
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: '12px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #F1F5F9',
    fontSize: '14px',
  },
  infoLabel: {
    color: '#64748B',
    fontWeight: 500,
  },
  infoValue: {
    color: '#0A2342',
    fontWeight: 600,
  },
  docPreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
    backgroundColor: '#F8FAFC',
    borderRadius: '8px',
    border: '1px dashed #CBD5E1',
  },
  docIcon: {
    width: '48px',
    height: '60px',
    borderRadius: '4px',
    backgroundColor: '#E2E8F0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    marginBottom: '14px',
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
    boxSizing: 'border-box' as const,
    width: '100%',
    minHeight: '80px',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 28px 24px',
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
  sendBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  /* Status tracker */
  tracker: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 0',
  },
  stepDot: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '6px',
    flex: 1,
  },
  stepIcon: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  stepConnector: {
    flex: 1,
    height: '2px',
    marginTop: '-20px',
  },
  /* Confirmation */
  confirmBox: {
    textAlign: 'center' as const,
    padding: '16px 0',
  },
  confirmIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    backgroundColor: '#E8F5E9',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  trackLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: '#00D4FF',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    marginTop: '8px',
  },
};

/* ── Status step config ─────────────────────────────────── */

const STEPS: { key: SignatureStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'viewed', label: 'Viewed' },
  { key: 'signed', label: 'Signed' },
];

const stepOrder: Record<SignatureStatus, number> = {
  draft: 0,
  sent: 1,
  viewed: 2,
  signed: 3,
  declined: -1,
};

function StatusTracker({ status }: { status: SignatureStatus }) {
  const currentIdx = stepOrder[status] ?? 0;

  if (status === 'declined') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', backgroundColor: '#FEF2F2', borderRadius: '8px', border: '1px solid #FECACA' }}>
        <AlertCircle size={20} color="#DC2626" />
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#DC2626' }}>Signature Declined</div>
          <div style={{ fontSize: '13px', color: '#7F1D1D', marginTop: '2px' }}>The signer has declined to sign this contract.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={st.tracker}>
      {STEPS.map((step, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isPending = idx > currentIdx;

        const bgColor = isCompleted ? '#1B5E20' : isCurrent ? '#0A2342' : '#E2E8F0';
        const iconColor = isCompleted || isCurrent ? '#FFFFFF' : '#94A3B8';
        const labelColor = isCompleted ? '#1B5E20' : isCurrent ? '#0A2342' : '#94A3B8';
        const connectorColor = isCompleted ? '#1B5E20' : '#E2E8F0';

        return (
          <React.Fragment key={step.key}>
            <div style={st.stepDot}>
              <div style={{ ...st.stepIcon, backgroundColor: bgColor }}>
                {isCompleted ? (
                  <CheckCircle size={18} color={iconColor} />
                ) : isCurrent ? (
                  <Clock size={16} color={iconColor} />
                ) : (
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: iconColor }} />
                )}
              </div>
              <span style={{ ...st.stepLabel, color: labelColor }}>{step.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div style={{ ...st.stepConnector, backgroundColor: connectorColor }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── Component ──────────────────────────────────────────── */

export default function ESignatureFlow({
  contractId,
  contractNumber,
  customerName,
  customerEmail,
  onClose,
  onSent,
}: ESignatureFlowProps) {
  const [signerName, setSignerName] = useState(customerName);
  const [signerEmail, setSignerEmail] = useState(customerEmail);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [signatureStatus, setSignatureStatus] = useState<SignatureStatus>('draft');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const handleSend = async () => {
    if (!signerName.trim() || !signerEmail.trim()) {
      setError('Signer name and email are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setError('');
    setSending(true);

    try {
      const res = await fetch(`/api/contracts/${contractId}/send-for-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerEmail: signerEmail.trim(),
          message: message.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to send for signature');
      }

      const data = await res.json();
      setRequestId(data.requestId);
      setSignatureStatus('sent');
      setSent(true);
      onSent();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send for signature';
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!requestId) return;
    try {
      const res = await fetch(`/api/contracts/${contractId}/signature-status`);
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          setSignatureStatus(data.status);
        }
      }
    } catch {
      // silently fail status check
    }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={st.header}>
          <div>
            <h2 style={st.headerTitle}>Send for E-Signature</h2>
            <div style={st.headerSub}>{contractNumber} &middot; {customerName}</div>
          </div>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        <div style={st.body}>
          {/* Status Tracker */}
          <div style={st.section}>
            <div style={st.sectionTitle}>Signing Status</div>
            <StatusTracker status={signatureStatus} />
          </div>

          {!sent ? (
            <>
              {/* Contract Summary */}
              <div style={st.section}>
                <div style={st.sectionTitle}>Contract Summary</div>
                <div style={st.infoRow}>
                  <span style={st.infoLabel}>Contract</span>
                  <span style={{ ...st.infoValue, fontFamily: '"JetBrains Mono", monospace' }}>{contractNumber}</span>
                </div>
                <div style={st.infoRow}>
                  <span style={st.infoLabel}>Customer</span>
                  <span style={st.infoValue}>{customerName}</span>
                </div>
                <div style={{ ...st.infoRow, borderBottom: 'none' }}>
                  <span style={st.infoLabel}>Date</span>
                  <span style={st.infoValue}>{today}</span>
                </div>
              </div>

              {/* Document Preview */}
              <div style={st.section}>
                <div style={st.sectionTitle}>Document</div>
                <div style={st.docPreview}>
                  <div style={st.docIcon}>
                    <FileText size={24} color="#64748B" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>
                      {contractNumber}_slip_agreement.pdf
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                      Contract document will be generated as PDF for signing
                    </div>
                  </div>
                  <button style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, color: '#0A2342', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '4px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Eye size={13} /> Preview
                  </button>
                </div>
              </div>

              {/* Signer Info */}
              <div style={st.section}>
                <div style={st.sectionTitle}>Signer Information</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={st.field}>
                    <label style={st.label}>Signer Name *</label>
                    <input
                      style={st.input}
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <div style={st.field}>
                    <label style={st.label}>Signer Email *</label>
                    <input
                      style={st.input}
                      type="email"
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                      placeholder="email@example.com"
                    />
                  </div>
                </div>
              </div>

              {/* Custom Message */}
              <div style={st.section}>
                <div style={st.sectionTitle}>Message (Optional)</div>
                <div style={st.field}>
                  <textarea
                    style={st.textarea}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Include a personal message with the signing request..."
                  />
                </div>
              </div>

              {error && (
                <div style={{ color: '#DC2626', fontSize: 13, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6, marginBottom: 12 }}>
                  {error}
                </div>
              )}
            </>
          ) : (
            /* Confirmation view */
            <div style={st.confirmBox}>
              <div style={st.confirmIcon}>
                <Send size={24} color="#1B5E20" />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: '0 0 8px 0' }}>
                Signature Request Sent
              </h3>
              <p style={{ fontSize: '14px', color: '#64748B', margin: '0 0 4px 0' }}>
                Sent to <strong style={{ color: '#0A2342' }}>{signerName}</strong> at{' '}
                <strong style={{ color: '#0A2342' }}>{signerEmail}</strong>
              </p>
              {requestId && (
                <p style={{ fontSize: '12px', color: '#94A3B8', fontFamily: '"JetBrains Mono", monospace', margin: '8px 0 0 0' }}>
                  Request ID: {requestId}
                </p>
              )}
              <button style={st.trackLink} onClick={handleCheckStatus}>
                Refresh signing status <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={st.footer}>
          <button style={st.cancelBtn} onClick={onClose}>
            {sent ? 'Close' : 'Cancel'}
          </button>
          {!sent && (
            <button
              style={{ ...st.sendBtn, opacity: sending ? 0.6 : 1 }}
              onClick={handleSend}
              disabled={sending}
            >
              <Send size={15} />
              {sending ? 'Sending...' : 'Send for Signature'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
