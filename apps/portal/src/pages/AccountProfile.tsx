import { CSSProperties, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { User, Check, AlertCircle, Loader2 } from 'lucide-react';

const NAVY = '#0A2342';

interface PortalCustomer {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
}

const styles: Record<string, CSSProperties> = {
  page: { padding: 32, maxWidth: 720 },
  title: { fontSize: 32, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 16, marginBottom: 24, borderRadius: 2 },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldFull: { display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' },
  label: { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { padding: '9px 12px', fontSize: 14, border: '1px solid #CBD5E1', borderRadius: 6, color: NAVY, background: '#FFFFFF' },
  buttonRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 14, fontWeight: 700, color: '#FFFFFF', background: NAVY, border: 'none', borderRadius: 6, cursor: 'pointer' },
  iconHead: { width: 36, height: 36, borderRadius: 8, background: 'rgba(0,212,255,0.10)', color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  loading: { padding: 48, textAlign: 'center', color: '#94A3B8' },
};

function toastStyle(kind: 'ok' | 'err'): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    background: kind === 'ok' ? '#DCFCE7' : '#FEE2E2',
    color: kind === 'ok' ? '#166534' : '#991B1B',
  };
}

export default function AccountProfile() {
  const { getToken } = useAuth();
  const [data, setData] = useState<PortalCustomer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/portal/me', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
        const body = (await res.json()) as PortalCustomer;
        if (cancelled) return;
        setData(body);
        setFirstName(body.firstName ?? '');
        setLastName(body.lastName ?? '');
        setCompany(body.company ?? '');
        setEmail(body.email ?? '');
        setPhone(body.phone ?? '');
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  async function save() {
    if (!data) return;
    setSaving(true);
    setToast(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/portal/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          company: company.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      const updated = (await res.json()) as PortalCustomer;
      setData(updated);
      setToast({ kind: 'ok', msg: 'Profile saved' });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast({ kind: 'err', msg: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div style={styles.page}>
        <h1 style={styles.title}>Profile</h1>
        <hr style={styles.divider} />
        <div style={toastStyle('err')}>
          <AlertCircle size={16} /> {loadError}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={styles.page}>
        <h1 style={styles.title}>Profile</h1>
        <hr style={styles.divider} />
        <div style={styles.loading}><Loader2 size={20} /></div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Profile</h1>
      <div style={styles.subtitle}>Your name, contact details, and how the marina reaches you.</div>
      <hr style={styles.divider} />

      <div style={styles.card}>
        <div style={styles.iconHead}><User size={20} /></div>
        <div style={styles.formGrid}>
          <div style={styles.field}>
            <label style={styles.label}>First Name</label>
            <input style={styles.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Last Name</label>
            <input style={styles.input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div style={styles.fieldFull}>
            <label style={styles.label}>Company (optional)</label>
            <input style={styles.input} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Charters" />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Phone</label>
            <input style={styles.input} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
          </div>
        </div>
        <div style={styles.buttonRow}>
          <button style={{ ...styles.primaryBtn, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={save}>
            {saving ? <Loader2 size={14} /> : <Check size={14} />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {toast && (
            <div style={toastStyle(toast.kind)}>
              {toast.kind === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
              {toast.msg}
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 16 }}>
          Address, driver-license, and emergency-contact details stay marina-managed for the moment —
          contact the office to update those.
        </div>
      </div>
    </div>
  );
}
