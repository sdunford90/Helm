import React, { useEffect, useState } from 'react';
import { Building2, CreditCard, Palette, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useApiClient, useResource } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { formatDateTime, humanizeEnum } from '../lib/format';
import { ComingSoonButton, ErrorState, InlineError, LoadingState } from './StateViews';
import { useToast } from './Toast';

/*
 * Settings sections backed by the real /settings/* endpoints. Each one loads
 * its own data, shows the server's state (or an error), and reports success
 * only after the server accepted the change.
 */

type Styles = Record<string, React.CSSProperties>;

function forbiddenMessage(status: number | null, error: string | null): string | null {
  if (status === 403) return 'Only the marina owner or a manager can view these settings.';
  return error;
}

/* ── Marina profile: GET/PUT /settings/marina ───────────────────────── */

interface MarinaProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  timezone: string;
  fiscalYearEnd: string;
}

const TIMEZONES = [
  ['America/New_York', 'Eastern (ET)'],
  ['America/Chicago', 'Central (CT)'],
  ['America/Denver', 'Mountain (MT)'],
  ['America/Phoenix', 'Arizona (MST)'],
  ['America/Los_Angeles', 'Pacific (PT)'],
  ['America/Anchorage', 'Alaska (AKT)'],
  ['Pacific/Honolulu', 'Hawaii (HT)'],
];

export function MarinaProfileSection({ st }: { st: Styles }) {
  const client = useApiClient();
  const toast = useToast();
  const res = useResource<MarinaProfile>('/settings/marina');
  const [form, setForm] = useState<MarinaProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (res.data) setForm(res.data);
  }, [res.data]);

  if (res.loading) return <LoadingState label="Loading marina profile…" />;
  if (!form) return <ErrorState title="Could not load the marina profile" message={forbiddenMessage(res.status, res.error)} onRetry={res.refetch} />;

  const set = (k: keyof MarinaProfile, v: string) => setForm({ ...form, [k]: v });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await client.put('/settings/marina', {
        ...form,
        email: form.email || undefined,
        address: form.address || undefined,
        phone: form.phone || undefined,
      });
      toast.success('Marina profile saved');
      res.refetch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.card}>
      <h3 style={st.sectionTitle}><Building2 size={20} /> Marina Profile</h3>
      {error && <div style={{ marginBottom: 16 }}><InlineError message={error} /></div>}
      <div style={st.formGrid} className="helm-form-grid">
        <div style={st.field}>
          <label style={st.label}>Marina Name</label>
          <input style={st.input} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div style={st.field}>
          <label style={st.label}>Phone</label>
          <input style={st.input} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div style={st.fieldFull}>
          <label style={st.label}>Address</label>
          <input style={st.input} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, city, state, zip" />
        </div>
        <div style={st.field}>
          <label style={st.label}>Email</label>
          <input style={st.input} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div style={st.field}>
          <label style={st.label}>Website</label>
          <input style={st.input} value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
        </div>
        <div style={st.field}>
          <label style={st.label}>Timezone</label>
          <select style={st.select} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
            {!TIMEZONES.some(([v]) => v === form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
            {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={st.field}>
          <label style={st.label}>Fiscal Year End (MM/DD)</label>
          <input style={st.input} value={form.fiscalYearEnd} onChange={(e) => set('fiscalYearEnd', e.target.value)} placeholder="12/31" />
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#64748B', margin: '8px 0 16px' }}>Operating hours are not stored by the server yet.</p>
      <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );
}

/* ── Branding: GET/PUT /settings/branding ───────────────────────────── */

interface Branding {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  faviconUrl: string;
}

export function BrandingSection({ st }: { st: Styles }) {
  const client = useApiClient();
  const toast = useToast();
  const res = useResource<Branding>('/settings/branding');
  const [form, setForm] = useState<Branding | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (res.data) setForm(res.data);
  }, [res.data]);

  if (res.loading) return <LoadingState label="Loading branding…" />;
  if (!form) return <ErrorState title="Could not load branding" message={forbiddenMessage(res.status, res.error)} onRetry={res.refetch} />;

  const set = (k: keyof Branding, v: string) => setForm({ ...form, [k]: v });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await client.put('/settings/branding', form);
      toast.success('Branding saved');
      res.refetch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.card}>
      <h3 style={st.sectionTitle}><Palette size={20} /> Branding</h3>
      {error && <div style={{ marginBottom: 16 }}><InlineError message={error} /></div>}
      <div style={st.formGrid} className="helm-form-grid">
        <div style={st.field}>
          <label style={st.label}>Primary Color</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="color" value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value.toUpperCase())} aria-label="Primary color" />
            <input style={st.input} value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
          </div>
        </div>
        <div style={st.field}>
          <label style={st.label}>Secondary Color</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="color" value={form.secondaryColor} onChange={(e) => set('secondaryColor', e.target.value.toUpperCase())} aria-label="Secondary color" />
            <input style={st.input} value={form.secondaryColor} onChange={(e) => set('secondaryColor', e.target.value)} />
          </div>
        </div>
        <div style={st.field}>
          <label style={st.label}>Logo URL</label>
          <input style={st.input} value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://" />
        </div>
        <div style={st.field}>
          <label style={st.label}>Favicon URL</label>
          <input style={st.input} value={form.faviconUrl} onChange={(e) => set('faviconUrl', e.target.value)} placeholder="https://" />
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#64748B', margin: '8px 0 16px' }}>Logo file upload is not connected yet; paste a hosted image URL.</p>
      <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save Branding'}
      </button>
    </div>
  );
}

/* ── Billing: GET/PUT /settings/billing ─────────────────────────────── */

interface BillingSettings {
  defaultPaymentTerms: 'NET_15' | 'NET_30' | 'NET_45' | 'NET_60';
  lateFeePercent: number;
  lateFeeGraceDays: number;
  autoChargeEnabled: boolean;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  taxRate: number;
}

export function BillingSettingsSection({ st }: { st: Styles }) {
  const client = useApiClient();
  const toast = useToast();
  const res = useResource<BillingSettings>('/settings/billing');
  const [form, setForm] = useState<BillingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (res.data) setForm(res.data);
  }, [res.data]);

  if (res.loading) return <LoadingState label="Loading billing settings…" />;
  if (!form) return <ErrorState title="Could not load billing settings" message={forbiddenMessage(res.status, res.error)} onRetry={res.refetch} />;

  const set = <K extends keyof BillingSettings>(k: K, v: BillingSettings[K]) => setForm({ ...form, [k]: v });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await client.put('/settings/billing', {
        defaultPaymentTerms: form.defaultPaymentTerms,
        lateFeePercent: Number(form.lateFeePercent),
        lateFeeGraceDays: Math.round(Number(form.lateFeeGraceDays)),
        autoChargeEnabled: form.autoChargeEnabled,
        invoicePrefix: form.invoicePrefix,
        nextInvoiceNumber: Math.round(Number(form.nextInvoiceNumber)),
        taxRate: Number(form.taxRate),
      });
      toast.success('Billing settings saved');
      res.refetch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error && <div style={{ marginBottom: 16 }}><InlineError message={error} /></div>}
      <div style={st.card}>
        <h3 style={st.sectionTitle}><CreditCard size={20} /> Payment Terms</h3>
        <div style={st.formGrid} className="helm-form-grid">
          <div style={st.field}>
            <label style={st.label}>Default Payment Terms</label>
            <select style={st.select} value={form.defaultPaymentTerms} onChange={(e) => set('defaultPaymentTerms', e.target.value as BillingSettings['defaultPaymentTerms'])}>
              <option value="NET_15">Net 15</option>
              <option value="NET_30">Net 30</option>
              <option value="NET_45">Net 45</option>
              <option value="NET_60">Net 60</option>
            </select>
          </div>
          <div style={st.field}>
            <label style={st.label}>Late Fee (%)</label>
            <input style={st.input} type="number" step="0.1" value={form.lateFeePercent} onChange={(e) => set('lateFeePercent', Number(e.target.value))} />
          </div>
          <div style={st.field}>
            <label style={st.label}>Grace Period (days)</label>
            <input style={st.input} type="number" value={form.lateFeeGraceDays} onChange={(e) => set('lateFeeGraceDays', Number(e.target.value))} />
          </div>
          <div style={st.field}>
            <label style={st.label}>Default Tax Rate (%)</label>
            <input style={st.input} type="number" step="0.01" value={form.taxRate} onChange={(e) => set('taxRate', Number(e.target.value))} />
          </div>
        </div>
      </div>
      <div style={st.card}>
        <h3 style={st.sectionTitle}>Invoice Numbering</h3>
        <div style={st.formGrid} className="helm-form-grid">
          <div style={st.field}>
            <label style={st.label}>Prefix</label>
            <input style={st.input} value={form.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value)} />
          </div>
          <div style={st.field}>
            <label style={st.label}>Next Number</label>
            <input style={st.input} type="number" value={form.nextInvoiceNumber} onChange={(e) => set('nextInvoiceNumber', Number(e.target.value))} />
          </div>
        </div>
      </div>
      <div style={st.card}>
        <h3 style={st.sectionTitle}>Auto-Charge</h3>
        <label style={st.checkbox}>
          <input type="checkbox" checked={form.autoChargeEnabled} onChange={(e) => set('autoChargeEnabled', e.target.checked)} /> Auto-charge customers on invoice generation (requires payment method on file)
        </label>
      </div>
      <div style={st.card}>
        <h3 style={st.sectionTitle}>GL Account Mapping</h3>
        <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6 }}>
          Revenue and payment-type GL mapping is not stored by the server yet. Invoice lines post to the GL account set on each line item.
        </p>
      </div>
      <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save Billing Settings'}
      </button>
    </>
  );
}

/* ── Integrations: Stripe + QuickBooks status from the API ──────────── */

interface StripeStatus {
  connected: boolean;
  accountId: string | null;
  dashboardUrl: string | null;
}

interface QboStatus {
  connected: boolean;
  realmId: string | null;
  lastSync: string | null;
}

const connectedBadge: React.CSSProperties = { backgroundColor: '#DEF7EC', color: '#03543F' };
const notConnectedBadge: React.CSSProperties = { backgroundColor: '#F3F4F6', color: '#475569' };

export function IntegrationsSection({ st }: { st: Styles }) {
  const client = useApiClient();
  const toast = useToast();
  const stripe = useResource<StripeStatus>('/settings/stripe');
  const qbo = useResource<QboStatus>('/settings/qbo');
  const [busy, setBusy] = useState<null | 'stripe-connect' | 'stripe-disconnect' | 'qbo-connect' | 'qbo-sync' | 'qbo-disconnect'>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const stripeConnect = () =>
    run('stripe-connect', async () => {
      const { url } = await client.post<{ url: string }>('/settings/stripe/connect');
      window.location.assign(url);
    });
  const stripeDisconnect = () =>
    run('stripe-disconnect', async () => {
      if (!window.confirm('Disconnect Stripe? Card and ACH payments will stop working until it is reconnected.')) return;
      await client.post('/settings/stripe/disconnect', { confirm: true });
      toast.success('Stripe disconnected');
      stripe.refetch();
    });
  const qboConnect = () =>
    run('qbo-connect', async () => {
      const { url } = await client.post<{ url: string }>('/settings/qbo/connect');
      window.location.assign(url);
    });
  const qboSync = () =>
    run('qbo-sync', async () => {
      const r = await client.post<{ syncing: boolean; startedAt: string }>('/settings/qbo/sync');
      toast.info('QuickBooks sync requested', r?.startedAt ? `Queued at ${formatDateTime(r.startedAt)}. Check back for the last-sync time.` : undefined);
      qbo.refetch();
    });
  const qboDisconnect = () =>
    run('qbo-disconnect', async () => {
      if (!window.confirm('Disconnect QuickBooks Online? Invoices and payments will stop syncing.')) return;
      await client.post('/settings/qbo/disconnect', { confirm: true });
      toast.success('QuickBooks disconnected');
      qbo.refetch();
    });

  const statusLine = (r: { loading: boolean; error: string | null; status: number | null }) =>
    r.loading ? 'Checking…' : r.error ? (r.status === 403 ? 'Status hidden: owner or manager role required' : `Status unavailable: ${r.error}`) : null;

  return (
    <>
      {error && <div style={{ marginBottom: 16 }}><InlineError message={error} /></div>}
      <div style={st.integrationCard}>
        <div style={st.integrationInfo}>
          <div style={st.integrationIcon}><CreditCard size={24} style={{ color: '#635BFF' }} /></div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>Stripe Connect</div>
            <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>Accept payments and process payouts</div>
            <div style={{ marginTop: '8px' }}>
              {statusLine(stripe) ? (
                <span style={{ fontSize: '12px', color: '#64748B' }}>{statusLine(stripe)}</span>
              ) : stripe.data?.connected ? (
                <>
                  <span style={{ ...st.badge, ...connectedBadge }}>Connected</span>
                  {stripe.data.accountId && <span style={{ ...st.mono, fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>{stripe.data.accountId}</span>}
                </>
              ) : (
                <span style={{ ...st.badge, ...notConnectedBadge }}>Not connected</span>
              )}
            </div>
          </div>
        </div>
        {stripe.data && (stripe.data.connected ? (
          <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }} disabled={!!busy} onClick={stripeDisconnect}>
            {busy === 'stripe-disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button style={st.outlineBtn} disabled={!!busy} onClick={stripeConnect}>
            {busy === 'stripe-connect' ? 'Opening Stripe…' : 'Connect Stripe'}
          </button>
        ))}
      </div>

      <div style={st.integrationCard}>
        <div style={st.integrationInfo}>
          <div style={st.integrationIcon}><Building2 size={24} style={{ color: '#2CA01C' }} /></div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342' }}>QuickBooks Online</div>
            <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>Sync invoices, payments, and customers</div>
            <div style={{ marginTop: '8px' }}>
              {statusLine(qbo) ? (
                <span style={{ fontSize: '12px', color: '#64748B' }}>{statusLine(qbo)}</span>
              ) : qbo.data?.connected ? (
                <>
                  <span style={{ ...st.badge, ...connectedBadge }}>Connected</span>
                  <span style={{ fontSize: '12px', color: '#64748B', marginLeft: '12px' }}>
                    Realm: {qbo.data.realmId} | Last sync: {qbo.data.lastSync ? formatDateTime(qbo.data.lastSync) : 'never'}
                  </span>
                </>
              ) : (
                <span style={{ ...st.badge, ...notConnectedBadge }}>Not connected</span>
              )}
            </div>
          </div>
        </div>
        {qbo.data && (qbo.data.connected ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={st.outlineBtn} disabled={!!busy} onClick={qboSync}><RefreshCw size={14} /> {busy === 'qbo-sync' ? 'Requesting…' : 'Sync Now'}</button>
            <button style={{ ...st.outlineBtn, color: '#DC2626', borderColor: '#FCA5A5' }} disabled={!!busy} onClick={qboDisconnect}>
              {busy === 'qbo-disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <button style={st.outlineBtn} disabled={!!busy} onClick={qboConnect}>
            {busy === 'qbo-connect' ? 'Opening QuickBooks…' : 'Connect QuickBooks'}
          </button>
        ))}
      </div>

      <div style={{ ...st.card, marginTop: '24px' }}>
        <h3 style={st.sectionTitle}>Webhook Endpoints</h3>
        <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6, marginBottom: 12 }}>Outbound webhooks are not available yet.</p>
        <ComingSoonButton style={st.outlineBtn} reason="Coming soon: outbound webhooks are not implemented in the API."><Plus size={14} /> Add Endpoint</ComingSoonButton>
      </div>
    </>
  );
}

/* ── Team: GET /settings/team, POST /settings/team/invite ───────────── */

interface TeamMemberDTO {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  active: boolean;
  createdAt: string;
}

const INVITE_ROLES = ['MARINA_OWNER', 'MARINA_MANAGER', 'DOCK_STAFF', 'POS_CASHIER', 'ACCOUNTING'] as const;

export function TeamSection({ st }: { st: Styles }) {
  const client = useApiClient();
  const toast = useToast();
  const team = useResource<TeamMemberDTO[], { members: TeamMemberDTO[] }>('/settings/team', { map: (r) => r.members ?? [] });
  const [showInvite, setShowInvite] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>('DOCK_STAFF');
  const [saving, setSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const invite = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setInviteError('First name, last name and email are required.');
      return;
    }
    setSaving(true);
    setInviteError(null);
    try {
      await client.post('/settings/team/invite', { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), role });
      toast.success(`Team member ${email.trim()} added`);
      setShowInvite(false);
      team.refetch();
    } catch (err) {
      setInviteError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ ...st.sectionTitle, marginBottom: 0 }}><ShieldCheck size={20} /> Team Members</h3>
        <button style={st.addBtn} onClick={() => { setShowInvite(true); setFirstName(''); setLastName(''); setEmail(''); setRole('DOCK_STAFF'); setInviteError(null); }}><Plus size={16} /> Invite Team Member</button>
      </div>

      {showInvite && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="helm-modal" role="dialog" aria-modal="true" aria-label="Invite team member" style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', width: '480px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Invite Team Member</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setShowInvite(false)} disabled={saving} aria-label="Close"><X size={20} /></button>
            </div>
            {inviteError && <div style={{ marginBottom: 12 }}><InlineError message={inviteError} /></div>}
            <div style={st.field}>
              <label style={st.label}>First Name</label>
              <input style={st.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Last Name</label>
              <input style={st.input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Email</label>
              <input style={st.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Role</label>
              <select style={st.select} value={role} onChange={(e) => setRole(e.target.value as (typeof INVITE_ROLES)[number])}>
                {INVITE_ROLES.map((r) => <option key={r} value={r}>{humanizeEnum(r)}</option>)}
              </select>
            </div>
            <p style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>This creates the user record. Sending an email invitation is not implemented yet.</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button style={st.outlineBtn} onClick={() => setShowInvite(false)} disabled={saving}>Cancel</button>
              <button style={{ ...st.addBtn, opacity: saving ? 0.7 : 1 }} onClick={invite} disabled={saving}>{saving ? 'Adding…' : 'Add Team Member'}</button>
            </div>
          </div>
        </div>
      )}

      {team.loading ? (
        <LoadingState label="Loading team…" />
      ) : team.error ? (
        <ErrorState title="Could not load the team" message={forbiddenMessage(team.status, team.error)} onRetry={team.refetch} />
      ) : (
        <div style={st.tableWrap} className="helm-table-wrap">
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Name</th>
                <th style={st.th}>Email</th>
                <th style={st.th}>Role</th>
                <th style={st.th}>Status</th>
                <th style={st.th}>Added</th>
                <th style={st.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(team.data ?? []).map((m, idx) => {
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                return (
                  <tr key={m.id}>
                    <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{`${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || '—'}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px' }}>{m.email}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>
                      <span style={{ ...st.badge, backgroundColor: '#E0F7FF', color: '#0A2342' }}>{humanizeEnum(m.role)}</span>
                    </td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>
                      <span style={{ ...st.badge, ...(m.active ? { backgroundColor: '#DEF7EC', color: '#03543F' } : { backgroundColor: '#F3F4F6', color: '#64748B' }) }}>{m.active ? 'Active' : 'Disabled'}</span>
                    </td>
                    <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px' }}>{formatDateTime(m.createdAt)}</td>
                    <td style={{ ...st.td, backgroundColor: rowBg }}>
                      <ComingSoonButton reason="Coming soon: role changes and removal are not wired up in this screen yet." style={{ background: 'none', border: 'none', color: '#0077A3', fontWeight: 600, fontSize: '13px' }}>Edit</ComingSoonButton>
                    </td>
                  </tr>
                );
              })}
              {(team.data ?? []).length === 0 && (
                <tr><td colSpan={6} style={{ ...st.td, textAlign: 'center', color: '#64748B' }}>No team members yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
