import React, { useCallback, useEffect, useState } from 'react';

const API = '/api/admin';

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    let msg = `API ${res.status}`;
    try {
      const j = JSON.parse(body);
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

const fmtCents = (c: number) =>
  (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? '#00D4FF' : 'rgba(255,255,255,0.5)',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #00D4FF' : '2px solid transparent',
  cursor: 'pointer',
});

const btn = (variant: 'primary' | 'ghost' | 'danger' = 'primary'): React.CSSProperties => {
  const base: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    cursor: 'pointer',
    border: '1px solid transparent',
  };
  if (variant === 'primary') return { ...base, background: '#00D4FF', color: '#0A2342' };
  if (variant === 'danger') return { ...base, background: 'transparent', borderColor: '#F44336', color: '#F44336' };
  return { ...base, background: 'transparent', borderColor: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)' };
};

const inp: React.CSSProperties = {
  width: '100%', background: '#0A1929', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6, padding: '8px 12px', color: '#FFF', fontSize: 13, boxSizing: 'border-box',
};
const lbl: React.CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, display: 'block' };

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  paid: { bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  issued: { bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  past_due: { bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  failed: { bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
  written_off: { bg: 'rgba(148,163,184,0.15)', color: '#94A3B8' },
  draft: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BillingOverview {
  totalMrrCents: number;
  totalArrCents: number;
  activeTenants: number;
  totalTenants: number;
  arpuCents: number;
  newTenantsLast30Days: number;
}

interface SaasInvoice {
  id: string;
  tenantId: string;
  tenantName: string;
  amountCents: number;
  discountCents: number;
  refundedCents: number;
  prorationCents: number;
  outstandingCents: number;
  status: string;
  issuedAt: string;
  dueDate: string | null;
  paidAt: string | null;
  failedAttempts: number;
  dunningPaused: boolean;
  pausedUntil: string | null;
  writeOffAt: string | null;
  writeOffReason: string | null;
}

interface CouponRedemption {
  id: string;
  tenantId: string;
  tenantName: string;
  active: boolean;
  cyclesRemaining: number | null;
  redeemedAt: string;
  lastAppliedAt: string | null;
}

interface Tier {
  id: string;
  name: string;
  monthlyFeeCents: number;
  perLocationFeeCents: number;
  achFeeRate: number;
  cardFeeRate: number;
  storageLimitGb: number;
  tenantCount: number;
}

interface Coupon {
  id: string;
  code: string;
  name: string;
  discountType: 'PERCENT' | 'FIXED' | 'TRIAL_EXTENSION';
  discountValue: number;
  duration: 'ONCE' | 'REPEATING';
  durationCycles: number | null;
  maxRedemptions: number | null;
  active: boolean;
  notes: string | null;
  redemptionCount: number;
  activeRedemptions: number;
  createdAt: string;
}

interface DunningRow {
  id: string;
  tenantId: string;
  tenantName: string;
  outstandingCents: number;
  status: string;
  dueDate: string | null;
  daysOverdue: number;
  failedAttempts: number;
  lastAttemptAt: string | null;
  dunningPaused: boolean;
  pausedUntil: string | null;
  hoursUntilLock: number | null;
}

interface TenantSummary { id: string; name: string }

const REFUND_REASONS = [
  { value: 'DUPLICATE_CHARGE', label: 'Duplicate charge' },
  { value: 'SERVICE_OUTAGE', label: 'Service outage' },
  { value: 'GOODWILL', label: 'Goodwill' },
  { value: 'BILLING_ERROR', label: 'Billing error' },
  { value: 'CANCELLATION', label: 'Cancellation' },
  { value: 'OTHER', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Modal: Refund
// ---------------------------------------------------------------------------
const RefundModal: React.FC<{
  invoice: SaasInvoice;
  onClose: () => void;
  onSaved: () => void;
}> = ({ invoice, onClose, onSaved }) => {
  const [amount, setAmount] = useState<string>(String((invoice.outstandingCents / 100).toFixed(2)));
  const [reason, setReason] = useState<string>(REFUND_REASONS[0].value);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setErr('Enter a valid amount');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await apiFetch(`${API}/billing/invoices/${invoice.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ amountCents: cents, reason, notes: notes || undefined }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message || 'Refund failed');
      setSaving(false);
    }
  };

  const refundable = invoice.amountCents - invoice.discountCents - invoice.refundedCents;

  return (
    <Modal title="Refund SaaS Invoice" onClose={onClose}>
      <div style={{ marginBottom: 12, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
        Tenant: <span style={{ color: '#FFF' }}>{invoice.tenantName}</span>
      </div>
      <div style={{ marginBottom: 12, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
        Refundable: <span style={{ color: '#FFF' }}>{fmtCents(refundable)}</span>
      </div>
      {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <label style={lbl}>Amount (USD)</label>
      <input style={inp} value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" />
      <div style={{ height: 12 }} />
      <label style={lbl}>Reason *</label>
      <select style={{ ...inp, cursor: 'pointer' }} value={reason} onChange={(e) => setReason(e.target.value)}>
        {REFUND_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <div style={{ height: 12 }} />
      <label style={lbl}>Notes (optional)</label>
      <textarea style={{ ...inp, height: 70, fontFamily: 'inherit' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <ModalActions onClose={onClose} onSave={submit} saving={saving} saveLabel="Issue Refund" />
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Modal: Coupon
// ---------------------------------------------------------------------------
const CouponModal: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED' | 'TRIAL_EXTENSION'>('PERCENT');
  const [discountValue, setDiscountValue] = useState('10');
  const [duration, setDuration] = useState<'ONCE' | 'REPEATING'>('ONCE');
  const [durationCycles, setDurationCycles] = useState('3');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const dv = parseInt(discountValue, 10);
    if (!Number.isFinite(dv) || dv <= 0) { setErr('Enter a positive discount value'); return; }

    const valueToSend =
      discountType === 'PERCENT' ? Math.round(dv * 100) : // bps
      discountType === 'FIXED' ? Math.round(dv * 100) : // cents
      dv; // days

    setSaving(true);
    setErr('');
    try {
      await apiFetch(`${API}/billing/coupons`, {
        method: 'POST',
        body: JSON.stringify({
          code,
          name,
          discountType,
          discountValue: valueToSend,
          duration,
          durationCycles: duration === 'REPEATING' ? parseInt(durationCycles, 10) : undefined,
          maxRedemptions: maxRedemptions ? parseInt(maxRedemptions, 10) : undefined,
          notes: notes || undefined,
        }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message || 'Save failed');
      setSaving(false);
    }
  };

  const valueLabel =
    discountType === 'PERCENT' ? 'Percent off (e.g. 10 = 10%)' :
    discountType === 'FIXED' ? 'Amount off in dollars (e.g. 50 = $50)' :
    'Trial extension in days';

  return (
    <Modal title="Create Coupon" onClose={onClose}>
      {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={lbl}>Code *</label>
          <input style={inp} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME10" />
        </div>
        <div>
          <label style={lbl}>Internal Name *</label>
          <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome 10% Off" />
        </div>
        <div>
          <label style={lbl}>Discount Type</label>
          <select
            style={{ ...inp, cursor: 'pointer' }}
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as 'PERCENT' | 'FIXED' | 'TRIAL_EXTENSION')}
          >
            <option value="PERCENT">Percent off</option>
            <option value="FIXED">Fixed amount off</option>
            <option value="TRIAL_EXTENSION">Trial extension (days)</option>
          </select>
        </div>
        <div>
          <label style={lbl}>{valueLabel}</label>
          <input style={inp} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} type="number" />
        </div>
        <div>
          <label style={lbl}>Duration</label>
          <select
            style={{ ...inp, cursor: 'pointer' }}
            value={duration}
            onChange={(e) => setDuration(e.target.value as 'ONCE' | 'REPEATING')}
          >
            <option value="ONCE">One-time</option>
            <option value="REPEATING">Recurring for N cycles</option>
          </select>
        </div>
        {duration === 'REPEATING' && (
          <div>
            <label style={lbl}>Number of cycles</label>
            <input style={inp} value={durationCycles} onChange={(e) => setDurationCycles(e.target.value)} type="number" />
          </div>
        )}
        <div>
          <label style={lbl}>Max redemptions (blank = unlimited)</label>
          <input style={inp} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} type="number" />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={lbl}>Notes</label>
          <input style={inp} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <ModalActions onClose={onClose} onSave={submit} saving={saving} saveLabel="Create Coupon" />
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Modal: Edit coupon
// ---------------------------------------------------------------------------
const CouponEditModal: React.FC<{
  coupon: Coupon;
  onClose: () => void;
  onSaved: () => void;
}> = ({ coupon, onClose, onSaved }) => {
  const [name, setName] = useState(coupon.name);
  const [notes, setNotes] = useState(coupon.notes ?? '');
  const [maxRedemptions, setMaxRedemptions] = useState(
    coupon.maxRedemptions != null ? String(coupon.maxRedemptions) : '',
  );
  const [active, setActive] = useState(coupon.active);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch(`${API}/billing/coupons/${coupon.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          notes: notes || null,
          maxRedemptions: maxRedemptions ? parseInt(maxRedemptions, 10) : null,
          active,
        }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title={`Edit ${coupon.code}`} onClose={onClose}>
      {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <div style={{ marginBottom: 12, padding: 10, background: '#0A1929', borderRadius: 6, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
        Discount type and value are immutable; create a new coupon if you need different math.
      </div>
      <label style={lbl}>Internal Name *</label>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} />
      <div style={{ height: 12 }} />
      <label style={lbl}>Notes</label>
      <input style={inp} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={{ height: 12 }} />
      <label style={lbl}>Max Redemptions (blank = unlimited)</label>
      <input style={inp} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} type="number" />
      <div style={{ height: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id="coupon-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <label htmlFor="coupon-active" style={{ ...lbl, margin: 0, cursor: 'pointer' }}>Active</label>
      </div>
      <ModalActions onClose={onClose} onSave={submit} saving={saving} saveLabel="Save Changes" />
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Modal: Coupon redemption history
// ---------------------------------------------------------------------------
const CouponRedemptionsModal: React.FC<{
  coupon: Coupon;
  onClose: () => void;
}> = ({ coupon, onClose }) => {
  const [rows, setRows] = useState<CouponRedemption[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<CouponRedemption[]>(`${API}/billing/coupons/${coupon.id}/redemptions`)
      .then(setRows)
      .catch((e: Error) => setErr(e.message));
  }, [coupon.id]);

  return (
    <Modal title={`Redemptions for ${coupon.code}`} onClose={onClose}>
      {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {!rows && !err && (
        <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading…</div>
      )}
      {rows && rows.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          No tenants have used this coupon yet.
        </div>
      )}
      {rows && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Tenant', 'Status', 'Cycles Left', 'Redeemed', 'Last Applied'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', fontSize: 10, fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: '8px 10px', color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{r.tenantName}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                    background: r.active ? 'rgba(76,175,80,0.15)' : 'rgba(148,163,184,0.15)',
                    color: r.active ? '#4CAF50' : '#94A3B8',
                  }}>{r.active ? 'Active' : 'Consumed'}</span>
                </td>
                <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{r.cyclesRemaining ?? '—'}</td>
                <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtDate(r.redeemedAt)}</td>
                <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtDate(r.lastAppliedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose} style={btn('ghost')}>Close</button>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Modal: Apply coupon to tenant
// ---------------------------------------------------------------------------
const ApplyCouponModal: React.FC<{
  coupon: Coupon;
  tenants: TenantSummary[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ coupon, tenants, onClose, onSaved }) => {
  const [tenantId, setTenantId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!tenantId) { setErr('Pick a tenant'); return; }
    setSaving(true);
    setErr('');
    try {
      await apiFetch(`${API}/billing/coupons/${coupon.id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ tenantId }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message || 'Apply failed');
      setSaving(false);
    }
  };

  return (
    <Modal title={`Apply ${coupon.code} to Tenant`} onClose={onClose}>
      {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <label style={lbl}>Tenant *</label>
      <select style={{ ...inp, cursor: 'pointer' }} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
        <option value="">— Select —</option>
        {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <ModalActions onClose={onClose} onSave={submit} saving={saving} saveLabel="Apply Coupon" />
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Modal: Pause dunning
// ---------------------------------------------------------------------------
const PauseModal: React.FC<{
  invoiceId: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ invoiceId, onClose, onSaved }) => {
  const [days, setDays] = useState('7');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const d = parseInt(days, 10);
    if (!Number.isFinite(d) || d <= 0) { setErr('Enter a positive number of days'); return; }
    setSaving(true);
    try {
      await apiFetch(`${API}/billing/dunning/${invoiceId}/pause`, {
        method: 'POST', body: JSON.stringify({ days: d }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title="Pause auto-lock" onClose={onClose}>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
        While paused, the lifecycle job will not lock this tenant for non-payment.
      </div>
      {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <label style={lbl}>Pause for (days)</label>
      <input style={inp} value={days} onChange={(e) => setDays(e.target.value)} type="number" />
      <ModalActions onClose={onClose} onSave={submit} saving={saving} saveLabel="Pause" />
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Modal: Write off
// ---------------------------------------------------------------------------
const WriteOffModal: React.FC<{
  invoiceId: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ invoiceId, onClose, onSaved }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!reason.trim()) { setErr('Reason is required'); return; }
    setSaving(true);
    try {
      await apiFetch(`${API}/billing/dunning/${invoiceId}/write-off`, {
        method: 'POST', body: JSON.stringify({ reason }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title="Write off invoice" onClose={onClose}>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
        This marks the invoice as uncollectable. The action is logged in the audit trail.
      </div>
      {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <label style={lbl}>Reason *</label>
      <textarea style={{ ...inp, height: 80, fontFamily: 'inherit' }} value={reason} onChange={(e) => setReason(e.target.value)} />
      <ModalActions onClose={onClose} onSave={submit} saving={saving} saveLabel="Write Off" danger />
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Generic modal shell
// ---------------------------------------------------------------------------
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  }} onClick={onClose}>
    <div style={{
      background: '#0D1B2A', borderRadius: 12, padding: 28, width: 540, maxHeight: '90vh', overflowY: 'auto',
      border: '1px solid rgba(255,255,255,0.08)',
    }} onClick={(e) => e.stopPropagation()}>
      <h3 style={{ margin: '0 0 20px', color: '#FFF', fontSize: 16 }}>{title}</h3>
      {children}
    </div>
  </div>
);

const ModalActions: React.FC<{
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
  danger?: boolean;
}> = ({ onClose, onSave, saving, saveLabel, danger }) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
    <button onClick={onClose} style={btn('ghost')}>Cancel</button>
    <button
      onClick={onSave}
      disabled={saving}
      style={{
        ...btn(danger ? 'danger' : 'primary'),
        ...(danger ? { background: '#F44336', color: '#FFF', border: 'none' } : {}),
        opacity: saving ? 0.7 : 1, cursor: saving ? 'not-allowed' : 'pointer', padding: '8px 18px', fontSize: 13,
      }}
    >{saving ? 'Saving…' : saveLabel}</button>
  </div>
);

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
type Tab = 'invoices' | 'tiers' | 'coupons' | 'dunning';

const Billing: React.FC = () => {
  const [tab, setTab] = useState<Tab>('invoices');

  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [invoices, setInvoices] = useState<SaasInvoice[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [dunning, setDunning] = useState<DunningRow[]>([]);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [refundFor, setRefundFor] = useState<SaasInvoice | null>(null);
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [applyCouponFor, setApplyCouponFor] = useState<Coupon | null>(null);
  const [editCouponFor, setEditCouponFor] = useState<Coupon | null>(null);
  const [redemptionsFor, setRedemptionsFor] = useState<Coupon | null>(null);
  const [pauseFor, setPauseFor] = useState<string | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ov, inv, tr, co, du, tn] = await Promise.all([
        apiFetch<BillingOverview>(`${API}/billing/overview`),
        apiFetch<{ items: SaasInvoice[] }>(`${API}/billing/invoices?limit=100`),
        apiFetch<Tier[]>(`${API}/billing/tiers`),
        apiFetch<Coupon[]>(`${API}/billing/coupons`),
        apiFetch<{ items: DunningRow[] }>(`${API}/billing/dunning`),
        apiFetch<{ items: TenantSummary[] }>(`${API}/tenants?limit=200`),
      ]);
      setOverview(ov);
      setInvoices(inv.items);
      setTiers(tr);
      setCoupons(co);
      setDunning(du.items);
      setTenants(tn.items);
    } catch (e: unknown) {
      setError((e as Error).message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const generateInvoices = async () => {
    if (!window.confirm('Generate this month\'s SaaS invoices?')) return;
    try {
      await apiFetch(`${API}/billing/invoices/generate`, { method: 'POST' });
      fetchAll();
    } catch (e: unknown) {
      window.alert((e as Error).message);
    }
  };

  const dunningAction = async (id: string, action: 'retry' | 'remind' | 'resume') => {
    try {
      await apiFetch(`${API}/billing/dunning/${id}/${action}`, { method: 'POST' });
      fetchAll();
    } catch (e: unknown) {
      window.alert((e as Error).message);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 32, color: 'rgba(255,255,255,0.4)', textAlign: 'center', fontSize: 14 }}>
        Loading billing…
      </div>
    );
  }
  if (error) {
    return <div style={{ padding: 32, color: '#F44336', fontSize: 14 }}>{error}</div>;
  }

  // --- Stats from overview ----------------------------------------------------
  const STATS = [
    { label: 'Total MRR', value: overview ? fmtCents(overview.totalMrrCents) : '—', color: '#4CAF50' },
    { label: 'Active Tenants', value: String(overview?.activeTenants ?? 0), color: '#2196F3' },
    { label: 'ARPU', value: overview ? fmtCents(overview.arpuCents) : '—', color: '#FF9800' },
    { label: 'New (30d)', value: String(overview?.newTenantsLast30Days ?? 0), color: '#9C27B0' },
  ];

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {STATS.map((s) => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 20, display: 'flex' }}>
        <button onClick={() => setTab('invoices')} style={tabBtn(tab === 'invoices')}>Invoices</button>
        <button onClick={() => setTab('dunning')} style={tabBtn(tab === 'dunning')}>
          Dunning{dunning.length > 0 ? ` (${dunning.length})` : ''}
        </button>
        <button onClick={() => setTab('coupons')} style={tabBtn(tab === 'coupons')}>Coupons</button>
        <button onClick={() => setTab('tiers')} style={tabBtn(tab === 'tiers')}>Tiers</button>
      </div>

      {/* ── Invoices ── */}
      {tab === 'invoices' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 }}>
              SaaS Invoices ({invoices.length})
            </div>
            <button onClick={generateInvoices} style={{ ...btn('primary'), padding: '8px 16px' }}>
              Generate Monthly Invoices
            </button>
          </div>
          {invoices.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
              No invoices yet. Click "Generate Monthly Invoices" to issue this period.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Tenant', 'Period', 'Amount', 'Proration', 'Discount', 'Refunded', 'Outstanding', 'Status', 'Due', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const ss = STATUS_STYLE[inv.status] ?? STATUS_STYLE.draft;
                  return (
                    <tr key={inv.id}>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: '#FFF', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {inv.tenantName}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {fmtDate(inv.issuedAt)}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtCents(inv.amountCents)}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: inv.prorationCents ? (inv.prorationCents > 0 ? '#FF9800' : '#4CAF50') : 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {inv.prorationCents ? `${inv.prorationCents > 0 ? '+' : '−'}${fmtCents(Math.abs(inv.prorationCents))}` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: inv.discountCents ? '#4CAF50' : 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {inv.discountCents ? `−${fmtCents(inv.discountCents)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: inv.refundedCents ? '#FF9800' : 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {inv.refundedCents ? `−${fmtCents(inv.refundedCents)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#00D4FF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtCents(inv.outstandingCents)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ background: ss.bg, color: ss.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{inv.status.replace('_', ' ')}</span>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtDate(inv.dueDate)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {inv.status === 'paid' && (
                          <button onClick={() => setRefundFor(inv)} style={btn('ghost')}>Refund</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Dunning ── */}
      {tab === 'dunning' && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
            Failed / Overdue Payments ({dunning.length})
          </div>
          {dunning.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
              All clear — no overdue SaaS invoices.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Tenant', 'Outstanding', 'Days Overdue', 'Failed Attempts', 'Auto-lock In', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dunning.map((d) => (
                  <tr key={d.id}>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#FFF', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{d.tenantName}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#F44336', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtCents(d.outstandingCents)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#FF9800', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{d.daysOverdue}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{d.failedAttempts}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      {d.dunningPaused
                        ? <span style={{ color: '#9C27B0' }}>Paused {d.pausedUntil ? `until ${fmtDate(d.pausedUntil)}` : ''}</span>
                        : d.hoursUntilLock !== null
                          ? `${Math.floor(d.hoursUntilLock / 24)}d ${d.hoursUntilLock % 24}h`
                          : 'n/a'}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ background: STATUS_STYLE[d.status]?.bg ?? 'rgba(255,255,255,0.06)', color: STATUS_STYLE[d.status]?.color ?? '#FFF', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{d.status.replace('_', ' ')}</span>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => dunningAction(d.id, 'retry')} style={btn('ghost')}>Retry</button>
                      <button onClick={() => dunningAction(d.id, 'remind')} style={btn('ghost')}>Remind</button>
                      {d.dunningPaused
                        ? <button onClick={() => dunningAction(d.id, 'resume')} style={btn('ghost')}>Resume</button>
                        : <button onClick={() => setPauseFor(d.id)} style={btn('ghost')}>Pause</button>}
                      <button onClick={() => setWriteOffFor(d.id)} style={btn('danger')}>Write Off</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Coupons ── */}
      {tab === 'coupons' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Coupons & Promo Codes ({coupons.length})
            </div>
            <button onClick={() => setShowCouponModal(true)} style={{ ...btn('primary'), padding: '8px 16px' }}>+ New Coupon</button>
          </div>
          {coupons.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
              No coupons yet. Create one to offer percentage, fixed-amount, or trial-extension discounts.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Code', 'Name', 'Discount', 'Duration', 'Redemptions', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => {
                  const discountStr =
                    c.discountType === 'PERCENT' ? `${(c.discountValue / 100).toFixed(0)}% off` :
                    c.discountType === 'FIXED' ? `${fmtCents(c.discountValue)} off` :
                    `${c.discountValue}-day trial extension`;
                  const durStr = c.duration === 'ONCE' ? 'One-time' : `${c.durationCycles} cycles`;
                  return (
                    <tr key={c.id}>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: '#00D4FF', fontWeight: 700, fontFamily: 'monospace', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{c.code}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{c.name}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: '#4CAF50', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{discountStr}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{durStr}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {c.activeRedemptions} active / {c.redemptionCount} total
                        {c.maxRedemptions ? ` (max ${c.maxRedemptions})` : ''}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: c.active ? 'rgba(76,175,80,0.15)' : 'rgba(148,163,184,0.15)',
                          color: c.active ? '#4CAF50' : '#94A3B8',
                        }}>{c.active ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button onClick={() => setApplyCouponFor(c)} disabled={!c.active} style={{ ...btn('ghost'), opacity: c.active ? 1 : 0.5 }}>Apply</button>
                        <button onClick={() => setEditCouponFor(c)} style={btn('ghost')}>Edit</button>
                        <button onClick={() => setRedemptionsFor(c)} style={btn('ghost')}>History</button>
                        {c.active && (
                          <button onClick={async () => {
                            if (!window.confirm(`Deactivate ${c.code}?`)) return;
                            await apiFetch(`${API}/billing/coupons/${c.id}/deactivate`, { method: 'POST' });
                            fetchAll();
                          }} style={btn('ghost')}>Deactivate</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tiers ── */}
      {tab === 'tiers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {tiers.map((tier) => (
            <div key={tier.id} style={{ ...card, borderTop: '3px solid #00D4FF' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#FFF' }}>{tier.name}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#00D4FF', marginTop: 4 }}>{fmtCents(tier.monthlyFeeCents)}/mo</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#FFF' }}>{tier.tenantCount}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>tenants</div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8 }}>
                <div>ACH fee: {(tier.achFeeRate * 100).toFixed(2)}%</div>
                <div>Card fee: {(tier.cardFeeRate * 100).toFixed(2)}%</div>
                <div>Storage: {tier.storageLimitGb} GB</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {refundFor && (
        <RefundModal invoice={refundFor} onClose={() => setRefundFor(null)} onSaved={fetchAll} />
      )}
      {showCouponModal && (
        <CouponModal onClose={() => setShowCouponModal(false)} onSaved={fetchAll} />
      )}
      {applyCouponFor && (
        <ApplyCouponModal coupon={applyCouponFor} tenants={tenants} onClose={() => setApplyCouponFor(null)} onSaved={fetchAll} />
      )}
      {editCouponFor && (
        <CouponEditModal coupon={editCouponFor} onClose={() => setEditCouponFor(null)} onSaved={fetchAll} />
      )}
      {redemptionsFor && (
        <CouponRedemptionsModal coupon={redemptionsFor} onClose={() => setRedemptionsFor(null)} />
      )}
      {pauseFor && (
        <PauseModal invoiceId={pauseFor} onClose={() => setPauseFor(null)} onSaved={fetchAll} />
      )}
      {writeOffFor && (
        <WriteOffModal invoiceId={writeOffFor} onClose={() => setWriteOffFor(null)} onSaved={fetchAll} />
      )}
    </div>
  );
};

export default Billing;
