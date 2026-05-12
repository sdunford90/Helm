import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApiFetch } from '../lib/api';
import { useAdminMe, isSuperuser } from '../hooks/useAdminMe';

const API = '/api/admin';

interface Location {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  timezone: string;
  active: boolean;
  subscription?: {
    tier: { id: string; name: string; monthlyFeeCents: number } | null;
    status: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    gracePeriodStartedAt: string | null;
  };
}

interface TenantUser {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  active: boolean;
  createdAt: string;
}

interface TenantData {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  status: string;
  timezone: string;
  fiscalYearEnd: string;
  createdAt: string;
  connectedServices: { stripe: boolean; quickbooks: boolean };
  subscription: {
    tierId?: string;
    tierName: string;
    monthlyFeeCents: number;
    achFeeRate: number;
    cardFeeRate: number;
    storageLimitGb: number;
  } | null;
  usage: {
    slips: number;
    customers: number;
    invoices: number;
    completedPayments: number;
    totalPaymentVolumeCents: number;
  };
  users: TenantUser[];
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  ACTIVE: { label: 'Active', bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  TRIAL: { label: 'Trial', bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  GRACE_PERIOD: { label: 'Grace Period', bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  LOCKED: { label: 'Locked', bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
};

const ROLE_COLORS: Record<string, string> = {
  PLATFORM_ADMIN: '#F44336',
  MARINA_OWNER: '#00D4FF',
  MARINA_MANAGER: '#4CAF50',
  DOCK_STAFF: '#FF9800',
  POS_CASHIER: '#FF9800',
  ACCOUNTING: '#9C27B0',
  PORTAL_USER: '#64748B',
};

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  MARINA_OWNER: 'Marina Owner',
  MARINA_MANAGER: 'Manager',
  DOCK_STAFF: 'Dock Staff',
  POS_CASHIER: 'POS Cashier',
  ACCOUNTING: 'Accounting',
  PORTAL_USER: 'Portal User',
};

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu',
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

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

const fieldRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const fieldLabel: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.4)' };
const fieldValue: React.CSSProperties = { fontSize: 13, color: '#FFF', fontWeight: 500 };

const fmtCents = (c: number) =>
  (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

type Tab = 'overview' | 'subscription' | 'usage' | 'locations' | 'users' | 'export' | 'danger' | 'notes';

interface TenantExportRow {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  fileSizeBytes: number | null;
  rowCounts: Record<string, number> | null;
  errorMsg: string | null;
  downloadToken: string | null;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
  requestedByEmail: string | null;
}

interface TenantDeletionRow {
  id: string;
  status: 'PENDING' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
  scheduledFor: string;
  completedAt: string | null;
  cancelledAt: string | null;
  requestedByEmail: string | null;
  errorMsg: string | null;
}

const fmtBytes = (n: number | null) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

interface TenantNote {
  id: string;
  tenantId: string;
  authorId: string;
  authorEmail: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface ActivityItem {
  kind: 'note' | 'event';
  id: string;
  createdAt: string;
  actorEmail: string | null;
  body?: string;
  authorId?: string;
  action?: string;
  metadata?: unknown;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  IMPERSONATION_STARTED: { label: 'Impersonation started', color: '#FF9800' },
  IMPERSONATION_ENDED: { label: 'Impersonation ended', color: '#94A3B8' },
  TENANT_LOCKED: { label: 'Tenant locked', color: '#F44336' },
  TENANT_UNLOCKED: { label: 'Tenant unlocked', color: '#4CAF50' },
  TENANT_TIER_CHANGED: { label: 'Tier changed', color: '#00D4FF' },
  ANNOUNCEMENT_SENT: { label: 'Announcement sent', color: '#9C27B0' },
  NOTE_CREATED: { label: 'Note added', color: '#64748B' },
  NOTE_UPDATED: { label: 'Note edited', color: '#64748B' },
  NOTE_DELETED: { label: 'Note deleted', color: '#64748B' },
};

interface AdminTier {
  id: string;
  name: string;
  monthlyFeeCents: number;
}

const BLANK_LOC = {
  name: '', address: '', city: '', state: '', zip: '', phone: '',
  timezone: 'America/New_York', active: true,
};

const LocationModal: React.FC<{
  initial?: Partial<Location>;
  onSave: (data: typeof BLANK_LOC) => Promise<void>;
  onClose: () => void;
}> = ({ initial, onSave, onClose }) => {
  const [form, setForm] = useState({
    ...BLANK_LOC,
    ...(initial ? {
      name: initial.name ?? '',
      address: initial.address ?? '',
      city: initial.city ?? '',
      state: initial.state ?? '',
      zip: initial.zip ?? '',
      phone: initial.phone ?? '',
      timezone: initial.timezone ?? 'America/New_York',
      active: initial.active !== undefined ? initial.active : true,
    } : {}),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = <K extends keyof typeof BLANK_LOC>(k: K, v: typeof BLANK_LOC[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const inp: React.CSSProperties = {
    width: '100%', background: '#0A1929', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6, padding: '8px 12px', color: '#FFF', fontSize: 13, boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#0D1B2A', borderRadius: 12, padding: 28, width: 520,
        border: '1px solid rgba(255,255,255,0.08)',
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', color: '#FFF', fontSize: 16 }}>
          {initial?.id ? 'Edit Location' : 'Add Location'}
        </h3>
        {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Location Name *</label>
            <input style={inp} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Main Dock" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Street Address</label>
            <input style={inp} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Marina Drive" />
          </div>
          <div>
            <label style={lbl}>City</label>
            <input style={inp} value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>State</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={form.state} onChange={(e) => set('state', e.target.value)}>
              <option value="">— Select —</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>ZIP Code</label>
            <input style={inp} value={form.zip} onChange={(e) => set('zip', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Phone</label>
            <input style={inp} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(555) 000-0000" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Timezone</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="loc-active" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            <label htmlFor="loc-active" style={{ ...lbl, margin: 0, cursor: 'pointer' }}>Active</label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{
            padding: '8px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button
            onClick={async () => {
              if (!form.name.trim()) { setErr('Location name is required'); return; }
              setSaving(true);
              try {
                await onSave(form);
                onClose();
              } catch (e: unknown) {
                setErr((e as Error).message || 'Save failed');
                setSaving(false);
              }
            }}
            disabled={saving}
            style={{
              padding: '8px 20px', background: '#00D4FF', border: 'none', borderRadius: 6,
              color: '#0A2342', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 13, opacity: saving ? 0.7 : 1,
            }}
          >{saving ? 'Saving…' : 'Save Location'}</button>
        </div>
      </div>
    </div>
  );
};

interface TierOption {
  id: string;
  name: string;
  monthlyFeeCents: number;
}

interface ProrationPreview {
  creditCents: number;
  chargeCents: number;
  prorationCents: number;
  daysUsed: number;
  daysRemaining: number;
  cycleDays: number;
  fromTierName: string | null;
  toTierName: string;
  fromMonthlyFeeCents: number;
  toMonthlyFeeCents: number;
}

const PlanChangeModal: React.FC<{
  tenantId: string;
  currentTierId?: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ tenantId, currentTierId, onClose, onSaved }) => {
  const [tiers, setTiers] = useState<TierOption[]>([]);
  const apiFetch = useApiFetch();
  const [toTierId, setToTierId] = useState('');
  const [preview, setPreview] = useState<ProrationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch(`${API}/billing/tiers`);
        setTiers(Array.isArray(data) ? data : []);
      } catch (e: unknown) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!toTierId || toTierId === currentTierId) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    setErr('');
    apiFetch<ProrationPreview>(`${API}/tenants/${tenantId}/plan/preview`, {
      method: 'POST', body: JSON.stringify({ toTierId }),
    })
      .then((p) => setPreview(p))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setPreviewing(false));
  }, [toTierId, tenantId, currentTierId]);

  const submit = async () => {
    if (!toTierId) { setErr('Pick a new tier'); return; }
    setSaving(true);
    try {
      await apiFetch(`${API}/tenants/${tenantId}/plan/change`, {
        method: 'POST', body: JSON.stringify({ toTierId }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    width: '100%', background: '#0A1929', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6, padding: '8px 12px', color: '#FFF', fontSize: 13, boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#0D1B2A', borderRadius: 12, padding: 28, width: 540,
        border: '1px solid rgba(255,255,255,0.08)',
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', color: '#FFF', fontSize: 16 }}>Change Plan</h3>
        {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <label style={lbl}>New Tier *</label>
        <select
          style={{ ...inp, cursor: 'pointer' }}
          value={toTierId}
          onChange={(e) => setToTierId(e.target.value)}
          disabled={loading}
        >
          <option value="">— Select tier —</option>
          {tiers.filter((t) => t.id !== currentTierId).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {fmtCents(t.monthlyFeeCents)}/mo
            </option>
          ))}
        </select>

        {previewing && (
          <div style={{ marginTop: 20, padding: 16, background: '#0A1929', borderRadius: 6, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            Calculating proration…
          </div>
        )}

        {preview && !previewing && (
          <div style={{ marginTop: 20, padding: 16, background: '#0A1929', borderRadius: 6, border: '1px solid rgba(0,212,255,0.2)' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Proration Preview
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>From:</span>
              <span style={{ color: '#FFF', textAlign: 'right' }}>
                {preview.fromTierName ?? '—'} ({fmtCents(preview.fromMonthlyFeeCents)}/mo)
              </span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>To:</span>
              <span style={{ color: '#FFF', textAlign: 'right' }}>
                {preview.toTierName} ({fmtCents(preview.toMonthlyFeeCents)}/mo)
              </span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>Cycle:</span>
              <span style={{ color: '#FFF', textAlign: 'right' }}>
                day {preview.daysUsed} of {preview.cycleDays} ({preview.daysRemaining} remaining)
              </span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>Credit (unused old):</span>
              <span style={{ color: '#4CAF50', textAlign: 'right' }}>−{fmtCents(preview.creditCents)}</span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>Charge (remaining new):</span>
              <span style={{ color: '#FF9800', textAlign: 'right' }}>+{fmtCents(preview.chargeCents)}</span>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: '#FFF', fontWeight: 600 }}>Net proration:</span>
              <span style={{ color: preview.prorationCents >= 0 ? '#FF9800' : '#4CAF50', fontWeight: 700 }}>
                {preview.prorationCents >= 0 ? '+' : '−'}{fmtCents(Math.abs(preview.prorationCents))}
              </span>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
              The proration {preview.prorationCents >= 0 ? 'charge' : 'credit'} will appear on the next monthly invoice as a separate adjustment line.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{
            padding: '8px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !toTierId || previewing}
            style={{
              padding: '8px 20px', background: '#00D4FF', border: 'none',
              borderRadius: 6, color: '#0A2342', fontWeight: 700,
              cursor: saving || !toTierId || previewing ? 'not-allowed' : 'pointer',
              opacity: saving || !toTierId || previewing ? 0.6 : 1, fontSize: 13,
            }}
          >{saving ? 'Saving…' : 'Apply Plan Change'}</button>
        </div>
      </div>
    </div>
  );
};

const CustomDomainModal: React.FC<{
  tenantId: string;
  currentDomain: string | null;
  subdomain: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ tenantId, currentDomain, subdomain, onClose, onSaved }) => {
  const apiFetch = useApiFetch();
  const [domain, setDomain] = useState(currentDomain ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const trimmed = domain.trim().toLowerCase();
  const looksLikePlaceholder = /\.example$|\.test$|\.invalid$|\.local$/.test(trimmed);
  const looksValid = trimmed === '' || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed);

  const submit = async () => {
    setErr('');
    if (!looksValid) {
      setErr('Enter a valid hostname (e.g. app.tracktheturn.com), or leave blank to clear.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`${API}/tenants/${tenantId}`, {
        method: 'PUT',
        body: JSON.stringify({ customDomain: trimmed === '' ? null : trimmed }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message || 'Failed to update custom domain');
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    width: '100%', background: '#0A1929', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6, padding: '8px 12px', color: '#FFF', fontSize: 13, boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#0D1B2A', borderRadius: 12, padding: 28, width: 540,
        border: '1px solid rgba(255,255,255,0.08)',
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 8px', color: '#FFF', fontSize: 16 }}>Edit Custom Domain</h3>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 20, lineHeight: 1.5 }}>
          The marina&apos;s subdomain <code style={{ color: '#00D4FF' }}>{subdomain}</code> always works
          (e.g. <code style={{ color: '#00D4FF' }}>{subdomain}.tracktheturn.com</code>). Set a custom
          domain here to also serve this tenant from a vanity hostname like{' '}
          <code style={{ color: '#00D4FF' }}>app.tracktheturn.com</code>. DNS for the hostname must
          already point at the platform.
        </div>
        {err && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <label style={lbl}>Custom Domain</label>
        <input
          style={inp}
          value={domain}
          placeholder="app.tracktheturn.com"
          onChange={(e) => setDomain(e.target.value)}
          autoFocus
        />
        {looksLikePlaceholder && (
          <div style={{ fontSize: 12, color: '#FF9800', marginTop: 8 }}>
            Heads up: <code>.example/.test/.invalid/.local</code> are reserved test TLDs and will not
            resolve in production. Use a real hostname or leave the field blank.
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{
            padding: '8px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button
            onClick={submit}
            disabled={saving}
            style={{
              padding: '8px 20px', background: '#00D4FF', border: 'none',
              borderRadius: 6, color: '#0A2342', fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1, fontSize: 13,
            }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
};

const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const { me } = useAdminMe();
  const superuser = isSuperuser(me);

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [locLoading, setLocLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [showLocModal, setShowLocModal] = useState(false);
  const [editingLoc, setEditingLoc] = useState<Location | undefined>();
  const [tiers, setTiers] = useState<AdminTier[]>([]);
  const [pickedTierByLoc, setPickedTierByLoc] = useState<Record<string, string>>({});
  const [billingBusyLocId, setBillingBusyLocId] = useState<string | null>(null);
  const [billingMsg, setBillingMsg] = useState<{ locId: string; kind: 'ok' | 'err'; text: string } | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [notes, setNotes] = useState<TenantNote[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteBody, setEditingNoteBody] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const [exports, setExports] = useState<TenantExportRow[]>([]);
  const [exportsLoading, setExportsLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');

  const [deletion, setDeletion] = useState<TenantDeletionRow | null>(null);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const fetchTenant = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<TenantData>(`${API}/tenants/${id}`);
      setTenant(data);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load tenant');
    } finally {
      setLoading(false);
    }
  }, [id, apiFetch]);

  const fetchLocations = useCallback(async () => {
    if (!id) return;
    setLocLoading(true);
    try {
      const data = await apiFetch<Location[]>(`${API}/tenants/${id}/locations`);
      setLocations(Array.isArray(data) ? data : []);
    } finally {
      setLocLoading(false);
    }
  }, [id, apiFetch]);

  const fetchTiers = useCallback(async () => {
    try {
      const data = await apiFetch<{ tiers?: AdminTier[] } | AdminTier[]>(
        `${API}/billing/tiers`,
      );
      // Endpoint returns { tiers: [...] }; defend against future drift.
      const list = Array.isArray(data) ? data : data?.tiers ?? [];
      setTiers(list);
    } catch {
      setTiers([]);
    }
  }, [apiFetch]);

  const fetchExports = useCallback(async () => {
    if (!id) return;
    setExportsLoading(true);
    try {
      const data = (await apiFetch(`${API}/tenants/${id}/exports`)) as { items?: unknown };
      setExports(Array.isArray(data?.items) ? (data.items as TenantExportRow[]) : []);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExportsLoading(false);
    }
  }, [id, apiFetch]);

  const fetchDeletion = useCallback(async () => {
    if (!id) return;
    setDeletionLoading(true);
    try {
      const data = await apiFetch(`${API}/tenants/${id}/deletion`);
      setDeletion(data as TenantDeletionRow | null);
    } catch {
      // silent — endpoint returns null when no deletion
    } finally {
      setDeletionLoading(false);
    }
  }, [id, apiFetch]);

  const fetchNotesAndActivity = useCallback(async () => {
    if (!id) return;
    setNotesLoading(true);
    try {
      const [notesData, activityData] = await Promise.all([
        apiFetch<{ notes?: TenantNote[] }>(`${API}/tenants/${id}/notes`),
        apiFetch<{ items?: ActivityItem[] }>(`${API}/tenants/${id}/activity`),
      ]);
      setNotes(Array.isArray(notesData?.notes) ? notesData.notes : []);
      setActivity(Array.isArray(activityData?.items) ? activityData.items : []);
    } finally {
      setNotesLoading(false);
    }
  }, [id, apiFetch]);

  useEffect(() => { fetchTenant(); }, [fetchTenant]);
  useEffect(() => {
    if (tab === 'locations') {
      fetchLocations();
      fetchTiers();
    }
  }, [tab, fetchLocations, fetchTiers]);
  useEffect(() => { if (tab === 'export') fetchExports(); }, [tab, fetchExports]);
  useEffect(() => { fetchDeletion(); }, [fetchDeletion]);
  useEffect(() => { if (tab === 'notes') fetchNotesAndActivity(); }, [tab, fetchNotesAndActivity]);

  const handleRunExport = async () => {
    if (!id) return;
    setExportBusy(true);
    setExportError('');
    try {
      await apiFetch(`${API}/tenants/${id}/exports`, { method: 'POST' });
      await fetchExports();
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  };

  const handleDownloadExport = (row: TenantExportRow) => {
    if (!id || !row.downloadToken) return;
    const url = `${API}/tenants/${id}/exports/${row.id}/download?token=${encodeURIComponent(row.downloadToken)}`;
    window.open(url, '_blank');
  };

  const handleScheduleDeletion = async () => {
    if (!id || !tenant) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const res = await fetch(`${API}/tenants/${id}/deletion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: deleteConfirm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setDeletion(data as TenantDeletionRow);
      setShowDeleteModal(false);
      setDeleteConfirm('');
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleCancelDeletion = async () => {
    if (!id) return;
    if (!window.confirm('Cancel the scheduled deletion?')) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const res = await fetch(`${API}/tenants/${id}/deletion`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setDeletion(data as TenantDeletionRow);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleStartCheckout = async (loc: Location) => {
    const tierId = pickedTierByLoc[loc.id];
    if (!tierId) {
      setBillingMsg({ locId: loc.id, kind: 'err', text: 'Pick a plan first.' });
      return;
    }
    setBillingBusyLocId(loc.id);
    setBillingMsg(null);
    try {
      const data = await apiFetch<{ url: string | null }>(
        `${API}/locations/${loc.id}/billing/checkout`,
        {
          method: 'POST',
          body: JSON.stringify({ tierId }),
        },
      );
      if (data?.url) {
        await navigator.clipboard.writeText(data.url).catch(() => {});
        window.open(data.url, '_blank', 'noopener,noreferrer');
        setBillingMsg({
          locId: loc.id, kind: 'ok',
          text: 'Checkout opened in a new tab. Link copied to clipboard so you can send it to the marina owner.',
        });
      } else {
        setBillingMsg({ locId: loc.id, kind: 'err', text: 'Stripe did not return a URL.' });
      }
    } catch (e: unknown) {
      setBillingMsg({ locId: loc.id, kind: 'err', text: (e as Error).message || 'Checkout failed.' });
    } finally {
      setBillingBusyLocId(null);
    }
  };

  const handleOpenPortal = async (loc: Location) => {
    setBillingBusyLocId(loc.id);
    setBillingMsg(null);
    try {
      const data = await apiFetch<{ url: string }>(
        `${API}/locations/${loc.id}/billing/portal`,
        { method: 'POST' },
      );
      if (data?.url) {
        await navigator.clipboard.writeText(data.url).catch(() => {});
        window.open(data.url, '_blank', 'noopener,noreferrer');
        setBillingMsg({
          locId: loc.id, kind: 'ok',
          text: 'Portal opened in a new tab. Link copied to clipboard.',
        });
      } else {
        setBillingMsg({ locId: loc.id, kind: 'err', text: 'Stripe did not return a URL.' });
      }
    } catch (e: unknown) {
      setBillingMsg({ locId: loc.id, kind: 'err', text: (e as Error).message || 'Portal failed.' });
    } finally {
      setBillingBusyLocId(null);
    }
  };

  const handleAddNote = async () => {
    const body = newNote.trim();
    if (!body || !id) return;
    setSavingNote(true);
    try {
      await apiFetch(`${API}/tenants/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setNewNote('');
      await fetchNotesAndActivity();
    } catch {
      window.alert('Failed to add note.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!id || !window.confirm('Delete this note?')) return;
    try {
      await apiFetch(`${API}/tenants/${id}/notes/${noteId}`, { method: 'DELETE' });
      await fetchNotesAndActivity();
    } catch {
      window.alert('Failed to delete note (you can only delete your own).');
    }
  };

  const beginEditNote = (note: TenantNote) => {
    setEditingNoteId(note.id);
    setEditingNoteBody(note.body);
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteBody('');
  };

  const handleSaveEditNote = async () => {
    if (!id || !editingNoteId) return;
    const body = editingNoteBody.trim();
    if (!body) return;
    setSavingEdit(true);
    try {
      await apiFetch(`${API}/tenants/${id}/notes/${editingNoteId}`, {
        method: 'PUT',
        body: JSON.stringify({ body }),
      });
      cancelEditNote();
      await fetchNotesAndActivity();
    } catch {
      window.alert('Failed to update note (you can only edit your own).');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleImpersonate = async () => {
    if (!id || !tenant) return;
    // A11: require a reason — typed in here, persisted server-side in the
    // audit metadata, and surfaced in the Impersonation Log.
    const reason = window.prompt(
      `Log in as ${tenant.name} (${tenant.subdomain}.gethelm.com)?\n\n` +
      `Enter a reason — this is required and shown in the Impersonation Log.\n` +
      `The tenant will see a banner indicating an admin is impersonating them.`,
      '',
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      window.alert('A reason is required to start an impersonation session.');
      return;
    }

    setImpersonating(true);
    try {
      const data = await apiFetch<{ token: string; tenantSubdomain: string }>(
        `${API}/tenants/${id}/impersonate`,
        { method: 'POST', body: JSON.stringify({ reason: trimmed }) },
      );
      // Cross-origin handoff: pass the signed token in the URL fragment of the
      // tenant subdomain. The fragment is kept client-side (never sent to the
      // server) and is consumed by the tenant app's ImpersonationBanner, which
      // calls /api/impersonation/verify and then strips it from the URL.
      const host = window.location.hostname;
      const protocol = window.location.protocol;
      let target = '';
      if (host.includes('localhost') || host.includes('127.0.0.1')) {
        target = `${protocol}//${data.tenantSubdomain}.localhost:5173`;
      } else {
        const parts = host.split('.');
        if (parts.length > 1) parts[0] = data.tenantSubdomain;
        target = `${protocol}//${parts.join('.')}`;
      }
      target += `#imp_token=${encodeURIComponent(data.token)}`;
      window.open(target, '_blank', 'noopener');
      await fetchNotesAndActivity();
    } catch {
      window.alert('Failed to start impersonation session.');
    } finally {
      setImpersonating(false);
    }
  };

  const handleSaveLocation = async (form: typeof BLANK_LOC) => {
    if (editingLoc) {
      await apiFetch(`${API}/tenants/${id}/locations/${editingLoc.id}`, {
        method: 'PUT', body: JSON.stringify(form),
      });
    } else {
      await apiFetch(`${API}/tenants/${id}/locations`, {
        method: 'POST', body: JSON.stringify(form),
      });
    }
    await fetchLocations();
  };

  const handleDeleteLocation = async (locId: string) => {
    if (!window.confirm('Delete this location? This cannot be undone.')) return;
    await apiFetch(`${API}/tenants/${id}/locations/${locId}`, { method: 'DELETE' });
    setLocations((prev) => prev.filter((l) => l.id !== locId));
  };

  if (loading) return (
    <div style={{ padding: 32, color: 'rgba(255,255,255,0.4)', textAlign: 'center', fontSize: 14 }}>
      Loading tenant…
    </div>
  );
  if (error) return (
    <div style={{ padding: 32, color: '#F44336', fontSize: 14 }}>{error}</div>
  );
  if (!tenant) return null;

  const statusCfg = STATUS_CONFIG[tenant.status] ?? {
    label: tenant.status, bg: 'rgba(255,255,255,0.1)', color: '#FFF',
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'subscription', label: 'Subscription' },
    { key: 'usage', label: 'Usage' },
    { key: 'locations', label: `Locations${locations.length > 0 ? ` (${locations.length})` : ''}` },
    { key: 'users', label: `Users (${tenant.users.length})` },
    { key: 'export', label: 'Export Data' },
    { key: 'danger', label: 'Danger Zone' },
    { key: 'notes', label: 'Notes & Activity' },
  ];

  const pendingDeletion = deletion && deletion.status === 'PENDING' ? deletion : null;

  return (
    <div style={{
      padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#FFF', minHeight: '100vh', background: '#060D18',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <button onClick={() => navigate('/tenants')} style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer', fontSize: 13, marginBottom: 8, padding: 0,
          }}>← Back to Tenants</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{tenant.name}</h1>
            <span style={{
              padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
              background: statusCfg.bg, color: statusCfg.color,
            }}>{statusCfg.label}</span>
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            {tenant.subdomain}.gethelm.com
            {tenant.customDomain ? ` · ${tenant.customDomain}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleImpersonate}
            disabled={impersonating}
            title="Open this tenant's app as one of their owners (audit-logged)."
            style={{
              padding: '8px 16px', background: 'transparent', border: '1px solid #00D4FF',
              borderRadius: 6, color: '#00D4FF', cursor: impersonating ? 'wait' : 'pointer',
              fontSize: 13, fontWeight: 600, opacity: impersonating ? 0.6 : 1,
            }}
          >{impersonating ? 'Starting…' : 'Log in as Tenant'}</button>
          {tenant.status === 'ACTIVE' ? (
            <button onClick={async () => {
              if (!window.confirm('Lock this tenant? They will lose access.')) return;
              try {
                await apiFetch(`${API}/tenants/${id}/lock`, { method: 'POST' });
                fetchTenant();
              } catch { window.alert('Failed to lock tenant'); }
            }} style={{
              padding: '8px 16px', background: 'transparent', border: '1px solid #F44336',
              borderRadius: 6, color: '#F44336', cursor: 'pointer', fontSize: 13,
            }}>Lock Tenant</button>
          ) : (
            <button onClick={async () => {
              try {
                await apiFetch(`${API}/tenants/${id}/unlock`, { method: 'POST' });
                fetchTenant();
              } catch { window.alert('Failed to unlock tenant'); }
            }} style={{
              padding: '8px 16px', background: '#4CAF50', border: 'none',
              borderRadius: 6, color: '#FFF', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>Unlock Tenant</button>
          )}
        </div>
      </div>

      {/* Pending deletion banner — visible across all tabs */}
      {pendingDeletion && (
        <div style={{
          background: 'rgba(244,67,54,0.08)',
          border: '1px solid rgba(244,67,54,0.4)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F44336', marginBottom: 4 }}>
              ⚠ Hard-delete scheduled for {fmtDateTime(pendingDeletion.scheduledFor)}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
              Requested by {pendingDeletion.requestedByEmail ?? 'unknown'}. All tenant data will be
              permanently destroyed unless cancelled before the scheduled time.
            </div>
          </div>
          {superuser && (
            <button
              onClick={handleCancelDeletion}
              disabled={deleteBusy}
              style={{
                padding: '8px 18px', background: '#FFF', border: 'none',
                borderRadius: 6, color: '#0A2342', fontWeight: 700,
                fontSize: 13, cursor: deleteBusy ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >Cancel Deletion</button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 24 }}>
        {TABS.map((t) => (
          <button key={t.key} style={tabBtn(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Account Details
              </div>
              <button
                onClick={() => setShowDomainModal(true)}
                style={{
                  padding: '4px 12px', background: 'transparent',
                  border: '1px solid rgba(0,212,255,0.4)', borderRadius: 4,
                  color: '#00D4FF', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >Edit Domain</button>
            </div>
            {([
              ['Subdomain', tenant.subdomain],
              ['Custom Domain', tenant.customDomain || '—'],
              ['Timezone', tenant.timezone],
              ['Fiscal Year End', tenant.fiscalYearEnd],
              ['Created', fmtDate(tenant.createdAt)],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l} style={fieldRow}>
                <span style={fieldLabel}>{l}</span>
                <span style={fieldValue}>{v}</span>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
              Connected Integrations
            </div>
            {([
              ['Stripe Connect', tenant.connectedServices.stripe ? '✓ Connected' : '— Not connected', tenant.connectedServices.stripe ? '#4CAF50' : '#FF9800'],
              ['QuickBooks Online', tenant.connectedServices.quickbooks ? '✓ Connected' : '— Not connected', tenant.connectedServices.quickbooks ? '#4CAF50' : '#FF9800'],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={fieldRow}>
                <span style={fieldLabel}>{l}</span>
                <span style={{ ...fieldValue, color: c }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Subscription ── */}
      {tab === 'subscription' && (
        <div>
          {tenant.subscription ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button
                  onClick={() => setShowPlanModal(true)}
                  style={{
                    padding: '8px 18px', background: '#00D4FF', border: 'none', borderRadius: 6,
                    color: '#0A2342', fontWeight: 700, cursor: 'pointer', fontSize: 13,
                  }}
                >Change Plan</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
                {[
                  { label: 'Tier', value: tenant.subscription.tierName },
                  { label: 'Monthly Fee', value: fmtCents(tenant.subscription.monthlyFeeCents) },
                  { label: 'ACH Fee Rate', value: `${tenant.subscription.achFeeRate}%` },
                  { label: 'Card Fee Rate', value: `${tenant.subscription.cardFeeRate}%` },
                ].map((s) => (
                  <div key={s.label} style={card}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#FFF' }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={card}>
                <div style={fieldRow}>
                  <span style={fieldLabel}>Storage Limit</span>
                  <span style={fieldValue}>{tenant.subscription.storageLimitGb} GB</span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ ...card, textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: 40 }}>
              <div style={{ marginBottom: 16 }}>No subscription tier assigned to this tenant.</div>
              <button
                onClick={() => setShowPlanModal(true)}
                style={{
                  padding: '8px 18px', background: '#00D4FF', border: 'none', borderRadius: 6,
                  color: '#0A2342', fontWeight: 700, cursor: 'pointer', fontSize: 13,
                }}
              >Assign Plan</button>
            </div>
          )}
        </div>
      )}

      {/* ── Usage ── */}
      {tab === 'usage' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { label: 'Slips', value: tenant.usage.slips.toLocaleString() },
            { label: 'Customers', value: tenant.usage.customers.toLocaleString() },
            { label: 'Invoices', value: tenant.usage.invoices.toLocaleString() },
            { label: 'Completed Payments', value: tenant.usage.completedPayments.toLocaleString() },
            { label: 'Total Payment Volume', value: fmtCents(tenant.usage.totalPaymentVolumeCents) },
          ].map((s) => (
            <div key={s.label} style={card}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#00D4FF' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Locations ── */}
      {tab === 'locations' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', maxWidth: 560, lineHeight: 1.5 }}>
              A location can be an entirely separate marina property, or a different physical terminal / area within the same marina (e.g. Main Dock office, Fuel Dock kiosk, Rental Center). Each gets its own point-of-sale and reporting context.
            </div>
            <button onClick={() => { setEditingLoc(undefined); setShowLocModal(true); }} style={{
              padding: '8px 18px', background: '#00D4FF', border: 'none', borderRadius: 6,
              color: '#0A2342', fontWeight: 700, cursor: 'pointer', fontSize: 13,
            }}>+ Add Location</button>
          </div>

          {locLoading ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', padding: 20, textAlign: 'center' }}>Loading locations…</div>
          ) : locations.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📍</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#FFF', marginBottom: 8 }}>No locations yet</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>
                Add locations like Main Dock, Fuel Dock, or Rental Center for this marina.
              </div>
              <button onClick={() => { setEditingLoc(undefined); setShowLocModal(true); }} style={{
                padding: '9px 20px', background: '#00D4FF', border: 'none', borderRadius: 6,
                color: '#0A2342', fontWeight: 700, cursor: 'pointer', fontSize: 13,
              }}>Add First Location</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {locations.map((loc) => (
                <div key={loc.id} style={{
                  ...card,
                  borderColor: loc.active ? 'rgba(0,212,255,0.2)' : 'rgba(255,255,255,0.06)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#FFF', marginBottom: 4 }}>{loc.name}</div>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: loc.active ? '#4CAF50' : '#94A3B8',
                        background: loc.active ? 'rgba(76,175,80,0.15)' : 'rgba(148,163,184,0.1)',
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                      }}>{loc.active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { setEditingLoc(loc); setShowLocModal(true); }} style={{
                        background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6, color: '#00D4FF', cursor: 'pointer',
                        padding: '4px 10px', fontSize: 12,
                      }}>Edit</button>
                      <button onClick={() => handleDeleteLocation(loc.id)} style={{
                        background: 'transparent', border: '1px solid rgba(244,67,54,0.3)',
                        borderRadius: 6, color: '#F44336', cursor: 'pointer',
                        padding: '4px 10px', fontSize: 12,
                      }}>Delete</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
                    {[
                      loc.address,
                      [loc.city, loc.state, loc.zip].filter(Boolean).join(', '),
                      loc.phone,
                    ].filter(Boolean).map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>{loc.timezone}</div>

                  {/* Per-location SaaS subscription summary + admin actions */}
                  <div style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                      Subscription
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                      <span>Tier</span>
                      <span style={{ fontWeight: 600, color: '#FFF' }}>
                        {loc.subscription?.tier
                          ? `${loc.subscription.tier.name} · ${fmtCents(loc.subscription.tier.monthlyFeeCents)}/mo`
                          : '— No tier —'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                      <span>Status</span>
                      <span style={{
                        fontWeight: 600,
                        color: loc.subscription?.status === 'active' ? '#4CAF50'
                          : loc.subscription?.status === 'past_due' ? '#FF9800'
                          : loc.subscription?.status === 'canceled' ? '#F44336'
                          : 'rgba(255,255,255,0.5)',
                      }}>
                        {loc.subscription?.status ?? 'Not subscribed'}
                      </span>
                    </div>
                    {loc.subscription?.gracePeriodStartedAt && (
                      <div style={{ fontSize: 11, color: '#FF9800', marginTop: 6 }}>
                        ⚠ In grace period since {new Date(loc.subscription.gracePeriodStartedAt).toLocaleDateString()}
                      </div>
                    )}

                    {/* Admin actions: start checkout when no sub, open portal when one exists. */}
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {loc.subscription?.stripeSubscriptionId ? (
                        <button
                          onClick={() => handleOpenPortal(loc)}
                          disabled={billingBusyLocId === loc.id}
                          style={{
                            background: 'transparent', border: '1px solid rgba(0,212,255,0.3)',
                            borderRadius: 6, color: '#00D4FF',
                            cursor: billingBusyLocId === loc.id ? 'wait' : 'pointer',
                            padding: '4px 10px', fontSize: 12,
                            opacity: billingBusyLocId === loc.id ? 0.6 : 1,
                          }}
                        >
                          {billingBusyLocId === loc.id ? 'Opening…' : 'Open Stripe Portal'}
                        </button>
                      ) : (
                        <>
                          <select
                            value={pickedTierByLoc[loc.id] ?? ''}
                            onChange={(e) =>
                              setPickedTierByLoc((p) => ({ ...p, [loc.id]: e.target.value }))
                            }
                            style={{
                              background: '#0A2342', color: '#FFF',
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: 6, padding: '4px 8px', fontSize: 12,
                            }}
                          >
                            <option value="">Pick plan…</option>
                            {tiers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} · {fmtCents(t.monthlyFeeCents)}/mo
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleStartCheckout(loc)}
                            disabled={billingBusyLocId === loc.id || !pickedTierByLoc[loc.id]}
                            style={{
                              background: '#00D4FF', border: 'none', borderRadius: 6,
                              color: '#0A2342', fontWeight: 700,
                              cursor: billingBusyLocId === loc.id ? 'wait' : 'pointer',
                              padding: '4px 10px', fontSize: 12,
                              opacity: (billingBusyLocId === loc.id || !pickedTierByLoc[loc.id]) ? 0.5 : 1,
                            }}
                          >
                            {billingBusyLocId === loc.id ? 'Starting…' : 'Start Checkout'}
                          </button>
                        </>
                      )}
                    </div>
                    {billingMsg && billingMsg.locId === loc.id && (
                      <div style={{
                        marginTop: 6, fontSize: 11,
                        color: billingMsg.kind === 'ok' ? '#4CAF50' : '#F44336',
                      }}>
                        {billingMsg.text}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Users ── */}
      {tab === 'users' && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
            Tenant Users ({tenant.users.length})
          </div>
          {tenant.users.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', padding: '20px 0', textAlign: 'center', fontSize: 13 }}>
              No users found for this tenant.
            </div>
          ) : (
            tenant.users.map((u) => (
              <div key={u.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#FFF' }}>
                    {u.firstName} {u.lastName}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{u.email}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 10,
                    background: ROLE_COLORS[u.role] ? `${ROLE_COLORS[u.role]}22` : 'rgba(255,255,255,0.1)',
                    color: ROLE_COLORS[u.role] ?? '#FFF',
                  }}>{ROLE_LABELS[u.role] ?? u.role}</span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: u.active ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.15)',
                    color: u.active ? '#4CAF50' : '#F44336',
                  }}>{u.active ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Export Data ── */}
      {tab === 'export' && (
        <div>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16,
            }}>
              <div style={{ maxWidth: 560 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: '#FFF', marginBottom: 6,
                }}>Export Tenant Data</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
                  Generates a single zip archive of CSV files for every primary table owned by this
                  tenant: customers, vessels, slips, contracts, invoices, payments, and more.
                  Exports are stored for 7 days and require a Superuser to download.
                </div>
              </div>
              <button
                onClick={handleRunExport}
                disabled={!superuser || exportBusy}
                title={!superuser ? 'Superuser only' : ''}
                style={{
                  padding: '10px 22px',
                  background: !superuser ? 'rgba(255,255,255,0.05)' : '#00D4FF',
                  border: 'none', borderRadius: 6,
                  color: !superuser ? 'rgba(255,255,255,0.3)' : '#0A2342',
                  fontWeight: 700, fontSize: 13,
                  cursor: !superuser || exportBusy ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >{exportBusy ? 'Generating…' : '+ Run New Export'}</button>
            </div>
            {exportError && (
              <div style={{
                background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.3)',
                borderRadius: 6, padding: 12, color: '#F44336', fontSize: 13, marginTop: 12,
              }}>{exportError}</div>
            )}
          </div>

          <div style={card}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16,
            }}>Recent Exports</div>
            {exportsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                Loading exports…
              </div>
            ) : exports.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                No exports yet. Click "Run New Export" to create one.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Created', 'Status', 'Size', 'Requested By', 'Expires', ''].map((h) => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '10px 12px', fontSize: 11,
                        fontWeight: 600, color: 'rgba(255,255,255,0.4)',
                        textTransform: 'uppercase', letterSpacing: 0.5,
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exports.map((row) => {
                    const statusColor =
                      row.status === 'COMPLETED' ? '#4CAF50' :
                      row.status === 'FAILED' ? '#F44336' : '#FF9800';
                    const expired = row.expiresAt && new Date(row.expiresAt) < new Date();
                    return (
                      <tr key={row.id}>
                        <td style={{ padding: '12px', fontSize: 12, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap' }}>
                          {fmtDateTime(row.createdAt)}
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{
                            background: `${statusColor}22`, color: statusColor,
                            padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          }}>{row.status}</span>
                          {row.errorMsg && (
                            <div style={{ fontSize: 11, color: '#F44336', marginTop: 4 }}>{row.errorMsg}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          {fmtBytes(row.fileSizeBytes)}
                        </td>
                        <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          {row.requestedByEmail ?? '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: 12, color: expired ? '#F44336' : 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap' }}>
                          {expired ? 'Expired' : fmtDateTime(row.expiresAt)}
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'right' }}>
                          {row.status === 'COMPLETED' && !expired && row.downloadToken && superuser ? (
                            <button onClick={() => handleDownloadExport(row)} style={{
                              background: 'transparent', border: '1px solid rgba(0,212,255,0.4)',
                              borderRadius: 6, color: '#00D4FF', cursor: 'pointer',
                              padding: '4px 14px', fontSize: 12,
                            }}>Download</button>
                          ) : (
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Danger Zone ── */}
      {tab === 'danger' && (
        <div>
          <div style={{
            ...card, border: '1px solid rgba(244,67,54,0.3)', marginBottom: 16,
          }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: '#F44336',
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16,
            }}>Danger Zone</div>

            {deletionLoading && !deletion ? (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading deletion status…</div>
            ) : pendingDeletion ? (
              <div>
                <div style={{ fontSize: 14, color: '#FFF', marginBottom: 8 }}>
                  A deletion is already scheduled. See the banner above to cancel it.
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#FFF', marginBottom: 6 }}>
                  Delete Tenant Permanently
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: 16, maxWidth: 620 }}>
                  Schedules a hard-delete of <strong>{tenant.name}</strong> and every record owned by it
                  (customers, contracts, invoices, payments, locations, users, etc). The deletion
                  will execute automatically <strong>24 hours</strong> after scheduling. A Superuser
                  may cancel it at any time during the grace period from the banner above.
                </div>
                <button
                  onClick={() => { setShowDeleteModal(true); setDeleteConfirm(''); setDeleteError(''); }}
                  disabled={!superuser}
                  title={!superuser ? 'Superuser only' : ''}
                  style={{
                    padding: '10px 22px',
                    background: !superuser ? 'rgba(255,255,255,0.05)' : '#F44336',
                    border: 'none', borderRadius: 6,
                    color: !superuser ? 'rgba(255,255,255,0.3)' : '#FFF',
                    fontWeight: 700, fontSize: 13,
                    cursor: !superuser ? 'not-allowed' : 'pointer',
                  }}
                >Schedule Hard-Delete</button>
              </div>
            )}

            {deletion && deletion.status !== 'PENDING' && (
              <div style={{
                marginTop: 16, padding: 12, borderRadius: 6,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                fontSize: 12, color: 'rgba(255,255,255,0.6)',
              }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>Last deletion attempt:</strong> {deletion.status}
                </div>
                <div>Scheduled for {fmtDateTime(deletion.scheduledFor)}</div>
                {deletion.completedAt && <div>Completed at {fmtDateTime(deletion.completedAt)}</div>}
                {deletion.cancelledAt && <div>Cancelled at {fmtDateTime(deletion.cancelledAt)}</div>}
                {deletion.errorMsg && <div style={{ color: '#F44336', marginTop: 4 }}>{deletion.errorMsg}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && tenant && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => !deleteBusy && setShowDeleteModal(false)}
        >
          <div
            style={{
              background: '#0D1B2A', borderRadius: 12, padding: 28, width: 540,
              border: '1px solid rgba(244,67,54,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', color: '#F44336', fontSize: 18 }}>
              ⚠ Schedule Hard-Delete
            </h3>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, marginBottom: 16 }}>
              This will permanently destroy <strong>{tenant.name}</strong> and every database record
              owned by it. The deletion will run after a 24-hour grace period during which a
              Superuser can cancel it.
            </div>
            <div style={{
              background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.3)',
              borderRadius: 6, padding: 12, marginBottom: 16,
            }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
                Type the tenant subdomain <strong style={{ color: '#FFF' }}>{tenant.subdomain}</strong> to confirm:
              </div>
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={tenant.subdomain}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#070E18', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 6, padding: '10px 12px', color: '#FFF',
                  fontSize: 13, fontFamily: 'monospace', outline: 'none',
                }}
                autoFocus
              />
            </div>
            {deleteError && (
              <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{deleteError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteBusy}
                style={{
                  padding: '8px 20px', background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
                  color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13,
                }}
              >Cancel</button>
              <button
                onClick={handleScheduleDeletion}
                disabled={deleteBusy || deleteConfirm !== tenant.subdomain}
                style={{
                  padding: '8px 20px',
                  background: deleteConfirm === tenant.subdomain ? '#F44336' : 'rgba(244,67,54,0.3)',
                  border: 'none', borderRadius: 6, color: '#FFF',
                  fontWeight: 700, cursor: deleteBusy || deleteConfirm !== tenant.subdomain ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                }}
              >{deleteBusy ? 'Scheduling…' : 'Schedule Deletion'}</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Notes & Activity ── */}
      {tab === 'notes' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Notes column */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Internal Notes ({notes.length})
            </div>
            <div style={{ marginBottom: 16 }}>
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add an internal note about this tenant. Notes are visible to all platform admins but never to the tenant."
                rows={3}
                style={{
                  width: '100%', background: '#0A1929', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6, padding: '8px 12px', color: '#FFF', fontSize: 13,
                  boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || savingNote}
                  style={{
                    padding: '6px 16px', background: '#00D4FF', border: 'none', borderRadius: 6,
                    color: '#0A2342', fontWeight: 700, fontSize: 12,
                    cursor: !newNote.trim() || savingNote ? 'not-allowed' : 'pointer',
                    opacity: !newNote.trim() || savingNote ? 0.5 : 1,
                  }}
                >{savingNote ? 'Saving…' : 'Add Note'}</button>
              </div>
            </div>
            {notesLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', padding: 12, textAlign: 'center', fontSize: 12 }}>Loading…</div>
            ) : notes.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', padding: 20, textAlign: 'center', fontSize: 13 }}>
                No notes yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {notes.map((n) => {
                  const isEditing = editingNoteId === n.id;
                  return (
                  <div
                    key={n.id}
                    style={{
                      padding: 12,
                      background: '#0A1929',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {isEditing ? (
                      <>
                        <textarea
                          value={editingNoteBody}
                          onChange={(e) => setEditingNoteBody(e.target.value)}
                          rows={3}
                          maxLength={5000}
                          style={{
                            width: '100%', padding: 8, fontSize: 13,
                            background: '#020A14', color: '#FFF',
                            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
                            resize: 'vertical', fontFamily: 'inherit',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                          <button
                            onClick={cancelEditNote}
                            disabled={savingEdit}
                            style={{
                              background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                              color: 'rgba(255,255,255,0.7)', borderRadius: 4,
                              padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                            }}
                          >Cancel</button>
                          <button
                            onClick={handleSaveEditNote}
                            disabled={!editingNoteBody.trim() || savingEdit}
                            style={{
                              background: '#1E88E5', border: 'none', color: '#FFF',
                              borderRadius: 4, padding: '4px 10px', fontSize: 11,
                              cursor: !editingNoteBody.trim() || savingEdit ? 'not-allowed' : 'pointer',
                              opacity: !editingNoteBody.trim() || savingEdit ? 0.5 : 1,
                            }}
                          >{savingEdit ? 'Saving…' : 'Save'}</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, color: '#FFF', whiteSpace: 'pre-wrap' }}>{n.body}</div>
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.4)',
                        }}>
                          <span>
                            {n.authorEmail ?? n.authorId} · {new Date(n.createdAt).toLocaleString()}
                            {n.updatedAt && n.updatedAt !== n.createdAt ? ' (edited)' : ''}
                          </span>
                          <span style={{ display: 'flex', gap: 12 }}>
                            <button
                              onClick={() => beginEditNote(n)}
                              style={{
                                background: 'transparent', border: 'none', color: '#1E88E5',
                                fontSize: 11, cursor: 'pointer', padding: 0,
                              }}
                            >Edit</button>
                            <button
                              onClick={() => handleDeleteNote(n.id)}
                              style={{
                                background: 'transparent', border: 'none', color: '#F44336',
                                fontSize: 11, cursor: 'pointer', padding: 0,
                              }}
                            >Delete</button>
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activity timeline column */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Activity Timeline
            </div>
            {notesLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', padding: 12, textAlign: 'center', fontSize: 12 }}>Loading…</div>
            ) : activity.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', padding: 20, textAlign: 'center', fontSize: 13 }}>
                No recorded activity yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activity.map((item) => {
                  const cfg = item.action ? ACTION_LABELS[item.action] : undefined;
                  const dotColor = item.kind === 'note' ? '#64748B' : (cfg?.color ?? '#94A3B8');
                  return (
                    <div key={`${item.kind}:${item.id}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', background: dotColor,
                        marginTop: 6, flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ fontSize: 12, color: '#FFF', fontWeight: 500 }}>
                          {item.kind === 'note'
                            ? 'Internal note added'
                            : (cfg?.label ?? item.action ?? 'Event')}
                        </div>
                        {item.kind === 'note' && item.body && (
                          <div style={{
                            fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2,
                            whiteSpace: 'pre-wrap',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}>{item.body}</div>
                        )}
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                          {item.actorEmail ?? 'admin'} · {new Date(item.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Location Modal */}
      {showLocModal && (
        <LocationModal
          initial={editingLoc}
          onSave={handleSaveLocation}
          onClose={() => { setShowLocModal(false); setEditingLoc(undefined); }}
        />
      )}

      {/* Custom Domain Modal */}
      {showDomainModal && id && tenant && (
        <CustomDomainModal
          tenantId={id}
          currentDomain={tenant.customDomain}
          subdomain={tenant.subdomain}
          onClose={() => setShowDomainModal(false)}
          onSaved={() => fetchTenant()}
        />
      )}

      {/* Plan Change Modal */}
      {showPlanModal && id && (
        <PlanChangeModal
          tenantId={id}
          currentTierId={tenant.subscription?.tierId}
          onClose={() => setShowPlanModal(false)}
          onSaved={fetchTenant}
        />
      )}
    </div>
  );
};

export default TenantDetail;
