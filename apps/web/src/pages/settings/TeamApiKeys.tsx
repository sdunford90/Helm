import { CSSProperties, useEffect, useState } from 'react';
import { Key, Trash2, Copy, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';

// Plan 67 — Tenant API key CRUD. Backed by /api/settings/api-keys (Plan 67
// route in apps/api). Plaintext is shown once on issue; we never store or
// re-display it. Operators recognize keys by lastUsedAt + scope + hint.

interface ListedKey {
  id: string;
  scope: 'TENANT' | 'PORTFOLIO';
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  hint: string;
}

interface IssuedKey {
  id: string;
  scope: string;
  plaintext: string;
  fingerprint: string;
  message: string;
}

const NAVY = '#0A2342';

const styles: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 700, color: NAVY, margin: 0 },
  sub: { fontSize: 13, color: '#64748B', margin: 0, marginTop: 4 },
  primaryBtn: {
    background: NAVY, color: '#FFFFFF', border: 0, borderRadius: 8,
    padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    textAlign: 'left' as const, padding: '10px 14px',
    fontSize: 11, fontWeight: 700, color: '#475569',
    textTransform: 'uppercase' as const, letterSpacing: '0.04em',
    borderBottom: '1px solid #E2E8F0',
  },
  td: { padding: '10px 14px', borderBottom: '1px solid #F1F5F9', color: NAVY },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  badge: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
    fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
    background: '#F1F5F9', color: '#475569', textTransform: 'uppercase' as const,
  },
  scopeTENANT: { background: '#DBEAFE', color: '#1E40AF' },
  scopePORTFOLIO: { background: '#FEF3C7', color: '#92400E' },
  revoked: { background: '#FEE2E2', color: '#991B1B' },
  iconBtn: {
    background: 'transparent', border: 0, color: '#B71C1C',
    cursor: 'pointer', padding: 4,
  },
  warning: {
    background: '#FFFBEB', border: '1px solid #FBBF24', color: '#78350F',
    padding: 14, borderRadius: 8, fontSize: 13,
  },
  plaintextRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#0F172A', color: '#FFFFFF', borderRadius: 6,
    padding: '10px 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12, marginTop: 8, wordBreak: 'break-all' as const,
  },
  copyBtn: {
    background: 'transparent', border: '1px solid #FFFFFF55',
    color: '#FFFFFF', borderRadius: 4, padding: '4px 8px',
    fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
};

export default function TeamApiKeys() {
  const { getToken } = useAuth();
  const [keys, setKeys] = useState<ListedKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'TENANT' | 'PORTFOLIO'>('TENANT');
  const [busy, setBusy] = useState(false);
  const [justIssued, setJustIssued] = useState<IssuedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await api.get<{ keys: ListedKey[] }>('/api/settings/api-keys', token);
      setKeys(res.keys);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const issue = async () => {
    setBusy(true);
    setCopied(false);
    try {
      const token = await getToken();
      const r = await api.post<IssuedKey>('/api/settings/api-keys', { scope }, token);
      setJustIssued(r);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key? Any clients using it will get 401.')) return;
    try {
      const token = await getToken();
      await api.delete(`/api/settings/api-keys/${id}`, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copy = () => {
    if (!justIssued) return;
    void navigator.clipboard.writeText(justIssued.plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>API Keys</h2>
          <p style={styles.sub}>
            Bearer tokens for programmatic access. Show once on issue, revoke at any time.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'TENANT' | 'PORTFOLIO')}
            style={{ padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13 }}
          >
            <option value="TENANT">Tenant</option>
            <option value="PORTFOLIO">Portfolio</option>
          </select>
          <button style={styles.primaryBtn} onClick={issue} disabled={busy}>
            <Key size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {busy ? 'Generating…' : 'Issue key'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: 12, borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}

      {justIssued && (
        <div style={styles.warning}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Copy this key now — you won't see it again.</div>
          <div style={styles.plaintextRow}>
            <span style={{ flex: 1 }}>{justIssued.plaintext}</span>
            <button style={styles.copyBtn} onClick={copy}>
              {copied ? <><CheckCircle2 size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Scope: <code>{justIssued.scope}</code> · Fingerprint: <code>{justIssued.fingerprint}</code>
          </div>
          <button
            onClick={() => setJustIssued(null)}
            style={{ background: 'transparent', border: 0, color: '#78350F', fontSize: 12, marginTop: 6, cursor: 'pointer', textDecoration: 'underline' }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Hint</th>
              <th style={styles.th}>Scope</th>
              <th style={styles.th}>Created by</th>
              <th style={styles.th}>Last used</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#94A3B8' }}>Loading…</td></tr>
            )}
            {!loading && keys.length === 0 && (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#94A3B8' }}>No keys issued yet.</td></tr>
            )}
            {keys.map((k) => {
              const scopeStyle = k.scope === 'PORTFOLIO' ? styles.scopePORTFOLIO : styles.scopeTENANT;
              return (
                <tr key={k.id}>
                  <td style={{ ...styles.td, ...styles.mono, color: '#64748B' }}>…{k.hint}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, ...scopeStyle }}>{k.scope}</span>
                  </td>
                  <td style={styles.td}>{k.createdBy ?? '—'}</td>
                  <td style={styles.td}>{k.lastUsedAt ? formatDate(k.lastUsedAt) : '—'}</td>
                  <td style={styles.td}>
                    {k.revokedAt ? (
                      <span style={{ ...styles.badge, ...styles.revoked }}>Revoked</span>
                    ) : (
                      <span style={{ ...styles.badge, background: '#DCFCE7', color: '#166534' }}>Active</span>
                    )}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' as const }}>
                    {!k.revokedAt && (
                      <button style={styles.iconBtn} onClick={() => revoke(k.id)} title="Revoke">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
