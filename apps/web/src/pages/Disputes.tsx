import { useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, Send } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatCents, formatDate } from '../lib/format';

interface Chargeback {
  id: string;
  stripeDisputeId: string;
  amountCents: number;
  status: 'OPEN' | 'EVIDENCE_SUBMITTED' | 'WON' | 'LOST';
  outcome: string | null;
  evidenceSubmittedAt: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    company: string | null;
    email: string | null;
  };
}

const NAVY = '#0A2342';

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 32 },
  title: { fontSize: 36, fontWeight: 700, color: NAVY, letterSpacing: '-0.02em', margin: 0 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 12, marginBottom: 32, borderRadius: 2 },
  card: { background: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 16px', backgroundColor: NAVY, color: '#fff', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' },
  td: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: NAVY },
  input: { width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #CBD5E1', borderRadius: 6, boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #CBD5E1', borderRadius: 6, boxSizing: 'border-box', minHeight: 80, fontFamily: 'inherit' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', fontSize: 14, fontWeight: 600, color: '#fff', backgroundColor: NAVY, border: 'none', borderRadius: 6, cursor: 'pointer' },
};

function badgeStyle(status: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background:
      status === 'WON' ? '#E8F5E9' :
      status === 'LOST' ? '#FDECEA' :
      status === 'EVIDENCE_SUBMITTED' ? '#FFF3CD' : '#FDECEA',
    color:
      status === 'WON' ? '#1B5E20' :
      status === 'LOST' ? '#B71C1C' :
      status === 'EVIDENCE_SUBMITTED' ? '#856404' : '#B71C1C',
  };
}

interface EvidenceFormState {
  productDescription: string;
  customerName: string;
  customerEmailAddress: string;
  serviceDate: string;
  uncategorizedText: string;
}

const EMPTY_EVIDENCE: EvidenceFormState = {
  productDescription: '',
  customerName: '',
  customerEmailAddress: '',
  serviceDate: '',
  uncategorizedText: '',
};

export default function Disputes() {
  const { data, loading, error, execute: reload } = useApi<Chargeback[]>('get', '/api/chargebacks', { immediate: true });
  const submit = useApi<Chargeback>('post', '/api/chargebacks');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<EvidenceFormState>(EMPTY_EVIDENCE);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  async function handleSubmitEvidence(chargebackId: string) {
    setSubmitting(true);
    setSubmitMessage(null);
    const token = /* useApi already appends auth */ undefined;
    void token;
    // Route override since useApi was bound to /api/chargebacks; call the nested path directly.
    const res = await fetch(`/api/chargebacks/${chargebackId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSubmitMessage(body.error ?? `Request failed (${res.status})`);
      return;
    }
    setSubmitMessage('Evidence submitted to Stripe.');
    setForm(EMPTY_EVIDENCE);
    setExpandedId(null);
    void reload();
  }

  const rows = data ?? [];

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Disputes</h1>
      <hr style={styles.divider} />

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}><Loader2 /></div>}
      {error && <div style={{ ...styles.card, borderLeft: '4px solid #B71C1C', color: '#B71C1C' }}>{error}</div>}

      {!loading && rows.length === 0 && (
        <div style={{ ...styles.card, textAlign: 'center', color: '#64748B' }}>
          <CheckCircle size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No disputes on record.</div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Amount</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Outcome</th>
                <th style={styles.th}>Evidence</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const canSubmit = c.status === 'OPEN';
                const expanded = expandedId === c.id;
                return (
                  <>
                    <tr key={c.id}>
                      <td style={styles.td}>
                        {c.customer.company ?? `${c.customer.firstName} ${c.customer.lastName}`}
                        {c.customer.email && (
                          <div style={{ fontSize: 12, color: '#64748B' }}>{c.customer.email}</div>
                        )}
                      </td>
                      <td style={styles.td}>{formatCents(c.amountCents)}</td>
                      <td style={styles.td}>
                        <span style={badgeStyle(c.status)}>{c.status.replace(/_/g, ' ')}</span>
                      </td>
                      <td style={styles.td}>{c.outcome ?? '—'}</td>
                      <td style={styles.td}>{c.evidenceSubmittedAt ? formatDate(c.evidenceSubmittedAt) : '—'}</td>
                      <td style={styles.td}>
                        {canSubmit && (
                          <button
                            style={styles.primaryBtn}
                            onClick={() => setExpandedId(expanded ? null : c.id)}
                          >
                            {expanded ? 'Cancel' : 'Submit evidence'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && canSubmit && (
                      <tr>
                        <td colSpan={6} style={{ padding: 20, background: '#F7F9FB', borderBottom: '1px solid #E2E8F0' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div>
                              <label style={styles.label}>Product description</label>
                              <textarea
                                style={styles.textarea}
                                value={form.productDescription}
                                onChange={(e) => setForm({ ...form, productDescription: e.target.value })}
                                placeholder="What the customer paid for (e.g. Monthly slip C-12 rental for March 2026)"
                              />
                            </div>
                            <div>
                              <label style={styles.label}>Uncategorized notes</label>
                              <textarea
                                style={styles.textarea}
                                value={form.uncategorizedText}
                                onChange={(e) => setForm({ ...form, uncategorizedText: e.target.value })}
                                placeholder="Any other context — emails, prior communication, service delivered."
                              />
                            </div>
                            <div>
                              <label style={styles.label}>Customer name on file</label>
                              <input
                                style={styles.input}
                                value={form.customerName}
                                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                              />
                            </div>
                            <div>
                              <label style={styles.label}>Customer email</label>
                              <input
                                style={styles.input}
                                type="email"
                                value={form.customerEmailAddress}
                                onChange={(e) => setForm({ ...form, customerEmailAddress: e.target.value })}
                              />
                            </div>
                            <div>
                              <label style={styles.label}>Service date</label>
                              <input
                                style={styles.input}
                                value={form.serviceDate}
                                onChange={(e) => setForm({ ...form, serviceDate: e.target.value })}
                                placeholder="2026-03-15"
                              />
                            </div>
                          </div>
                          <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
                            <button
                              style={{ ...styles.primaryBtn, opacity: submitting ? 0.7 : 1 }}
                              disabled={submitting}
                              onClick={() => handleSubmitEvidence(c.id)}
                            >
                              {submitting ? <Loader2 size={16} /> : <Send size={16} />}
                              {submitting ? 'Submitting…' : 'Submit to Stripe'}
                            </button>
                            {submitMessage && (
                              <div style={{ fontSize: 13, color: submitMessage.toLowerCase().includes('submitted') ? '#1B5E20' : '#B71C1C' }}>
                                {submit.error ?? submitMessage}
                              </div>
                            )}
                          </div>
                          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#856404' }}>
                            <AlertTriangle size={14} />
                            Evidence is submitted once. Review carefully before sending.
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
