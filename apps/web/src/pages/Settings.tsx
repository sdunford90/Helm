import { useState, useEffect } from 'react';
import {
  Building2,
  Palette,
  CreditCard,
  Link,
  BookOpen,
  ShieldCheck,
  Save,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api';

type Section = 'marina' | 'branding' | 'billing' | 'stripe' | 'qbo' | 'team';

const sectionConfig: { key: Section; icon: typeof Building2; title: string; description: string }[] = [
  { key: 'marina', icon: Building2, title: 'Marina Profile', description: 'Update your marina name, address, contact info, and operating hours.' },
  { key: 'branding', icon: Palette, title: 'Branding', description: 'Customize your logo, brand colors, and customer-facing appearance.' },
  { key: 'billing', icon: CreditCard, title: 'Billing Configuration', description: 'Set default payment terms, tax rates, and invoice templates.' },
  { key: 'stripe', icon: Link, title: 'Stripe Connect', description: 'Connect your Stripe account to accept payments and process payouts.' },
  { key: 'qbo', icon: BookOpen, title: 'QuickBooks Online', description: 'Sync invoices, payments, and customer data with QuickBooks.' },
  { key: 'team', icon: ShieldCheck, title: 'Team & Roles', description: 'Manage staff accounts, permissions, and role-based access controls.' },
];

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '40px', borderRadius: '2px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '24px', cursor: 'pointer', transition: 'box-shadow 0.15s' },
  cardIcon: { color: '#2E4A6B', marginBottom: '12px' },
  cardTitle: { fontSize: '17px', fontWeight: 600, color: '#0A2342', margin: '0 0 6px 0' },
  cardDescription: { fontSize: '14px', color: '#64748B', lineHeight: 1.5, margin: 0 },
  backBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '14px', fontWeight: 600, color: '#0A2342', background: 'none', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer', marginBottom: '24px' },
  formCard: { background: '#FFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '32px', maxWidth: '640px' },
  formTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', marginBottom: '24px' },
  formGroup: { marginBottom: '16px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '4px' },
  input: { width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '6px', boxSizing: 'border-box' as const },
  select: { width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '6px', boxSizing: 'border-box' as const },
  saveBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#FFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', marginTop: '16px' },
  secondaryBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFF', border: '1px solid #0A2342', borderRadius: '6px', cursor: 'pointer' },
  dangerBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#FFF', backgroundColor: '#B71C1C', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  statusBadge: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px', fontSize: '14px', fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '10px 16px', backgroundColor: '#0A2342', color: '#FFF', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const },
  td: { padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342' },
  loading: { display: 'flex', justifyContent: 'center', padding: '32px', color: '#64748B' },
};

/* ── Marina Profile ── */
function MarinaSection({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState({ name: '', address: '', phone: '', email: '', website: '', timezone: 'America/New_York', fiscalYearEnd: '12/31' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<typeof data>('/settings/marina').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings/marina', data); } catch { /* ignore */ }
    setSaving(false);
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div>
      <button style={styles.backBtn} onClick={onBack}>&larr; Back</button>
      <div style={styles.formCard}>
        <div style={styles.formTitle}>Marina Profile</div>
        <div style={styles.formGroup}><label style={styles.label}>Marina Name</label><input style={styles.input} value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} /></div>
        <div style={styles.formGroup}><label style={styles.label}>Address</label><input style={styles.input} value={data.address} onChange={(e) => setData({ ...data, address: e.target.value })} /></div>
        <div style={styles.formGroup}><label style={styles.label}>Phone</label><input style={styles.input} value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} /></div>
        <div style={styles.formGroup}><label style={styles.label}>Email</label><input style={styles.input} type="email" value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} /></div>
        <div style={styles.formGroup}><label style={styles.label}>Website</label><input style={styles.input} value={data.website} onChange={(e) => setData({ ...data, website: e.target.value })} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={styles.formGroup}><label style={styles.label}>Timezone</label><input style={styles.input} value={data.timezone} onChange={(e) => setData({ ...data, timezone: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Fiscal Year End (MM/DD)</label><input style={styles.input} value={data.fiscalYearEnd} onChange={(e) => setData({ ...data, fiscalYearEnd: e.target.value })} /></div>
        </div>
        <button style={styles.saveBtn} onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

/* ── Branding ── */
function BrandingSection({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState({ logoUrl: '', primaryColor: '#0A2342', secondaryColor: '#00D4FF', faviconUrl: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<typeof data>('/settings/branding').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings/branding', data); } catch { /* ignore */ }
    setSaving(false);
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div>
      <button style={styles.backBtn} onClick={onBack}>&larr; Back</button>
      <div style={styles.formCard}>
        <div style={styles.formTitle}>Branding</div>
        <div style={styles.formGroup}><label style={styles.label}>Logo URL</label><input style={styles.input} value={data.logoUrl} onChange={(e) => setData({ ...data, logoUrl: e.target.value })} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Primary Color</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="color" value={data.primaryColor} onChange={(e) => setData({ ...data, primaryColor: e.target.value })} style={{ width: '40px', height: '36px', border: '1px solid #CCC', borderRadius: '4px', cursor: 'pointer' }} />
              <input style={styles.input} value={data.primaryColor} onChange={(e) => setData({ ...data, primaryColor: e.target.value })} />
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Secondary Color</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="color" value={data.secondaryColor} onChange={(e) => setData({ ...data, secondaryColor: e.target.value })} style={{ width: '40px', height: '36px', border: '1px solid #CCC', borderRadius: '4px', cursor: 'pointer' }} />
              <input style={styles.input} value={data.secondaryColor} onChange={(e) => setData({ ...data, secondaryColor: e.target.value })} />
            </div>
          </div>
        </div>
        <div style={styles.formGroup}><label style={styles.label}>Favicon URL</label><input style={styles.input} value={data.faviconUrl} onChange={(e) => setData({ ...data, faviconUrl: e.target.value })} /></div>
        <button style={styles.saveBtn} onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

/* ── Billing Config ── */
function BillingSection({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState({ defaultPaymentTerms: 'NET_30', lateFeePercent: 1.5, lateFeeGraceDays: 10, autoChargeEnabled: false, invoicePrefix: 'INV-', nextInvoiceNumber: 1001, taxRate: 0, electricityRatePerKwh: 0.12, securityDepositDefault: 50000 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<typeof data>('/settings/billing').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings/billing', data); } catch { /* ignore */ }
    setSaving(false);
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div>
      <button style={styles.backBtn} onClick={onBack}>&larr; Back</button>
      <div style={styles.formCard}>
        <div style={styles.formTitle}>Billing Configuration</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Payment Terms</label>
            <select style={styles.select} value={data.defaultPaymentTerms} onChange={(e) => setData({ ...data, defaultPaymentTerms: e.target.value })}>
              <option value="NET_15">Net 15</option><option value="NET_30">Net 30</option><option value="NET_45">Net 45</option><option value="NET_60">Net 60</option>
            </select>
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Tax Rate (%)</label><input style={styles.input} type="number" step="0.01" value={data.taxRate} onChange={(e) => setData({ ...data, taxRate: parseFloat(e.target.value) || 0 })} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={styles.formGroup}><label style={styles.label}>Late Fee (%)</label><input style={styles.input} type="number" step="0.1" value={data.lateFeePercent} onChange={(e) => setData({ ...data, lateFeePercent: parseFloat(e.target.value) || 0 })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Grace Period (days)</label><input style={styles.input} type="number" value={data.lateFeeGraceDays} onChange={(e) => setData({ ...data, lateFeeGraceDays: parseInt(e.target.value) || 0 })} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={styles.formGroup}><label style={styles.label}>Invoice Prefix</label><input style={styles.input} value={data.invoicePrefix} onChange={(e) => setData({ ...data, invoicePrefix: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Next Invoice #</label><input style={styles.input} type="number" value={data.nextInvoiceNumber} onChange={(e) => setData({ ...data, nextInvoiceNumber: parseInt(e.target.value) || 1 })} /></div>
        </div>
        <div style={styles.formGroup}><label style={styles.label}>Electricity Rate ($/kWh)</label><input style={styles.input} type="number" step="0.01" value={data.electricityRatePerKwh} onChange={(e) => setData({ ...data, electricityRatePerKwh: parseFloat(e.target.value) || 0 })} /></div>
        <div style={styles.formGroup}>
          <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={data.autoChargeEnabled} onChange={(e) => setData({ ...data, autoChargeEnabled: e.target.checked })} />
            Auto-charge enabled (charge card on file for recurring invoices)
          </label>
        </div>
        <button style={styles.saveBtn} onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

/* ── Stripe Connect ── */
function StripeSection({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<{ connected: boolean; accountId: string | null }>({ connected: false, accountId: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<typeof status>('/settings/stripe').then(setStatus).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const connect = async () => {
    const res = await api.post<{ url: string }>('/settings/stripe/connect');
    if (res.url) window.location.href = res.url;
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div>
      <button style={styles.backBtn} onClick={onBack}>&larr; Back</button>
      <div style={styles.formCard}>
        <div style={styles.formTitle}>Stripe Connect</div>
        <div style={{ ...styles.statusBadge, background: status.connected ? '#E8F5E9' : '#FDECEA', color: status.connected ? '#1B5E20' : '#B71C1C', marginBottom: '24px' }}>
          {status.connected ? 'Connected' : 'Not Connected'}
          {status.accountId && <span style={{ fontWeight: 400, color: '#64748B', marginLeft: '8px' }}>{status.accountId}</span>}
        </div>
        {status.connected ? (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button style={styles.secondaryBtn}><ExternalLink size={16} /> Open Stripe Dashboard</button>
            <button style={styles.dangerBtn} onClick={() => api.post('/settings/stripe/disconnect', { confirm: true }).then(() => setStatus({ connected: false, accountId: null }))}>Disconnect</button>
          </div>
        ) : (
          <button style={styles.saveBtn} onClick={connect}><Link size={16} /> Connect Stripe</button>
        )}
      </div>
    </div>
  );
}

/* ── QuickBooks ── */
function QBOSection({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<{ connected: boolean; realmId: string | null; lastSync: string | null }>({ connected: false, realmId: null, lastSync: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<typeof status>('/settings/qbo').then(setStatus).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const connect = async () => {
    const res = await api.post<{ url: string }>('/settings/qbo/connect');
    if (res.url) window.location.href = res.url;
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div>
      <button style={styles.backBtn} onClick={onBack}>&larr; Back</button>
      <div style={styles.formCard}>
        <div style={styles.formTitle}>QuickBooks Online</div>
        <div style={{ ...styles.statusBadge, background: status.connected ? '#E8F5E9' : '#FDECEA', color: status.connected ? '#1B5E20' : '#B71C1C', marginBottom: '24px' }}>
          {status.connected ? 'Connected' : 'Not Connected'}
        </div>
        {status.lastSync && <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '16px' }}>Last synced: {new Date(status.lastSync).toLocaleString()}</p>}
        {status.connected ? (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button style={styles.secondaryBtn} onClick={() => api.post('/settings/qbo/sync')}>Sync Now</button>
            <button style={styles.dangerBtn} onClick={() => api.post('/settings/qbo/disconnect', { confirm: true }).then(() => setStatus({ connected: false, realmId: null, lastSync: null }))}>Disconnect</button>
          </div>
        ) : (
          <button style={styles.saveBtn} onClick={connect}><BookOpen size={16} /> Connect QuickBooks</button>
        )}
      </div>
    </div>
  );
}

/* ── Team ── */
interface TeamMember { id: string; email: string; firstName: string; lastName: string; role: string; active: boolean }

function TeamSection({ onBack }: { onBack: () => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ email: '', firstName: '', lastName: '', role: 'DOCK_STAFF' });

  useEffect(() => {
    api.get<{ members: TeamMember[] }>('/settings/team').then((r) => setMembers(r.members ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const sendInvite = async () => {
    try {
      const res = await api.post<{ member: TeamMember }>('/settings/team/invite', invite);
      if (res.member) setMembers((prev) => [...prev, res.member]);
      setShowInvite(false);
      setInvite({ email: '', firstName: '', lastName: '', role: 'DOCK_STAFF' });
    } catch { /* ignore */ }
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  const ROLE_LABELS: Record<string, string> = {
    PLATFORM_ADMIN: 'Platform Admin', MARINA_OWNER: 'Owner', MARINA_MANAGER: 'Manager',
    DOCK_STAFF: 'Dock Staff', POS_CASHIER: 'Cashier', ACCOUNTING: 'Accounting', PORTAL_USER: 'Portal User',
  };

  return (
    <div>
      <button style={styles.backBtn} onClick={onBack}>&larr; Back</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={styles.formTitle}>Team Members</div>
        <button style={styles.saveBtn} onClick={() => setShowInvite(true)}><Plus size={16} /> Invite Member</button>
      </div>
      <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #E2E8F0' }}>
        <table style={styles.table}>
          <thead><tr><th style={styles.th}>Name</th><th style={styles.th}>Email</th><th style={styles.th}>Role</th><th style={styles.th}>Status</th><th style={styles.th}></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td style={styles.td}>{m.firstName} {m.lastName}</td>
                <td style={styles.td}>{m.email}</td>
                <td style={styles.td}>{ROLE_LABELS[m.role] ?? m.role}</td>
                <td style={styles.td}>
                  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, backgroundColor: m.active ? '#E8F5E9' : '#FDECEA', color: m.active ? '#1B5E20' : '#B71C1C' }}>
                    {m.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ ...styles.td, textAlign: 'center' }}>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B71C1C' }} title="Remove" onClick={() => api.delete(`/settings/team/${m.id}`).then(() => setMembers((prev) => prev.filter((x) => x.id !== m.id)))}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#FFF', borderRadius: '12px', padding: '32px', width: '480px' }}>
            <div style={styles.formTitle}>Invite Team Member</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={styles.formGroup}><label style={styles.label}>First Name</label><input style={styles.input} value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} /></div>
              <div style={styles.formGroup}><label style={styles.label}>Last Name</label><input style={styles.input} value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} /></div>
            </div>
            <div style={styles.formGroup}><label style={styles.label}>Email</label><input style={styles.input} type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Role</label>
              <select style={styles.select} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                <option value="MARINA_MANAGER">Manager</option><option value="DOCK_STAFF">Dock Staff</option><option value="POS_CASHIER">Cashier</option><option value="ACCOUNTING">Accounting</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button style={styles.saveBtn} onClick={sendInvite}>Send Invite</button>
              <button style={styles.secondaryBtn} onClick={() => setShowInvite(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main ── */
export default function Settings() {
  const [section, setSection] = useState<Section | null>(null);

  if (section === 'marina') return <div style={styles.page}><MarinaSection onBack={() => setSection(null)} /></div>;
  if (section === 'branding') return <div style={styles.page}><BrandingSection onBack={() => setSection(null)} /></div>;
  if (section === 'billing') return <div style={styles.page}><BillingSection onBack={() => setSection(null)} /></div>;
  if (section === 'stripe') return <div style={styles.page}><StripeSection onBack={() => setSection(null)} /></div>;
  if (section === 'qbo') return <div style={styles.page}><QBOSection onBack={() => setSection(null)} /></div>;
  if (section === 'team') return <div style={styles.page}><TeamSection onBack={() => setSection(null)} /></div>;

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Settings</h1>
      <hr style={styles.divider} />
      <div style={styles.grid}>
        {sectionConfig.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.key} style={styles.card} onClick={() => setSection(card.key)}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
            >
              <div style={styles.cardIcon}><Icon size={32} /></div>
              <h3 style={styles.cardTitle}>{card.title}</h3>
              <p style={styles.cardDescription}>{card.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
