import { CSSProperties, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Bell, Check, AlertCircle, Loader2 } from 'lucide-react';

const NAVY = '#0A2342';

type Channel = 'email' | 'sms';
type Category = 'billing' | 'inspections' | 'marketing' | 'announcements';

const CHANNELS: Channel[] = ['email', 'sms'];
const CATEGORIES: Array<{ key: Category; label: string; description: string }> = [
  { key: 'billing', label: 'Billing', description: 'Invoices, receipts, payment failures.' },
  { key: 'inspections', label: 'Dock Walks & Inspections', description: 'Findings and follow-ups on your boat.' },
  { key: 'announcements', label: 'Announcements', description: 'Marina-wide updates from staff.' },
  { key: 'marketing', label: 'Marketing', description: 'Promotions, events, and newsletters. Opt-out by default.' },
];

interface Pref {
  channel: Channel;
  category: Category;
  optedIn: boolean;
}

const styles: Record<string, CSSProperties> = {
  page: { padding: 32, maxWidth: 820 },
  title: { fontSize: 32, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 16, marginBottom: 24, borderRadius: 2 },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th: { textAlign: 'left' as const, padding: '14px 18px', background: '#F8FAFC', fontWeight: 700, color: '#475569', fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' },
  thChannel: { width: 110, textAlign: 'center' as const },
  td: { padding: '14px 18px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' as const },
  tdChannel: { textAlign: 'center' as const },
  catLabel: { fontWeight: 600, fontSize: 14, color: NAVY },
  catDesc: { fontSize: 12, color: '#64748B', marginTop: 2 },
  buttonRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 14, fontWeight: 700, color: '#FFFFFF', background: NAVY, border: 'none', borderRadius: 6, cursor: 'pointer' },
  loading: { padding: 48, textAlign: 'center' as const, color: '#94A3B8' },
};

function toastStyle(kind: 'ok' | 'err'): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    background: kind === 'ok' ? '#DCFCE7' : '#FEE2E2',
    color: kind === 'ok' ? '#166534' : '#991B1B',
  };
}

function prefKey(channel: Channel, category: Category): string {
  return `${channel}:${category}`;
}

export default function AccountNotifications() {
  const { getToken } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/portal/communication-prefs', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Failed to load preferences (${res.status})`);
        const body = (await res.json()) as { prefs: Pref[] };
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        for (const p of body.prefs) {
          map[prefKey(p.channel, p.category)] = p.optedIn;
        }
        setPrefs(map);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  function toggle(channel: Channel, category: Category) {
    setPrefs((p) => ({ ...p, [prefKey(channel, category)]: !p[prefKey(channel, category)] }));
  }

  async function save() {
    setSaving(true);
    setToast(null);
    const updates: Pref[] = [];
    for (const channel of CHANNELS) {
      for (const cat of CATEGORIES) {
        updates.push({ channel, category: cat.key, optedIn: !!prefs[prefKey(channel, cat.key)] });
      }
    }
    try {
      const token = await getToken();
      const res = await fetch('/api/portal/communication-prefs', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setToast({ kind: 'ok', msg: 'Preferences saved' });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast({ kind: 'err', msg: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Notifications</h1>
      <div style={styles.subtitle}>
        Choose how the marina reaches you — email, SMS, or both — and for which kinds of message.
      </div>
      <hr style={styles.divider} />

      {loadError ? (
        <div style={toastStyle('err')}><AlertCircle size={16} /> {loadError}</div>
      ) : !loaded ? (
        <div style={styles.loading}><Loader2 size={20} /></div>
      ) : (
        <>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Category</th>
                  <th style={{ ...styles.th, ...styles.thChannel }}>Email</th>
                  <th style={{ ...styles.th, ...styles.thChannel }}>SMS</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat) => (
                  <tr key={cat.key}>
                    <td style={styles.td}>
                      <div style={styles.catLabel}>{cat.label}</div>
                      <div style={styles.catDesc}>{cat.description}</div>
                    </td>
                    {CHANNELS.map((ch) => (
                      <td key={ch} style={{ ...styles.td, ...styles.tdChannel }}>
                        <input
                          type="checkbox"
                          checked={!!prefs[prefKey(ch, cat.key)]}
                          onChange={() => toggle(ch, cat.key)}
                          style={{ width: 18, height: 18, cursor: 'pointer' }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.buttonRow}>
            <button style={{ ...styles.primaryBtn, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={save}>
              {saving ? <Loader2 size={14} /> : <Bell size={14} />}
              {saving ? 'Saving…' : 'Save preferences'}
            </button>
            {toast && (
              <div style={toastStyle(toast.kind)}>
                {toast.kind === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
                {toast.msg}
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 16 }}>
            Critical notifications about your account (payment failures, contract expirations) are sent regardless of preferences — they can&apos;t be silenced.
          </div>
        </>
      )}
    </div>
  );
}
