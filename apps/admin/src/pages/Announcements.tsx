import React, { useCallback, useEffect, useState } from 'react';

// A12 — Platform Announcements management.
// CRUD over /api/admin/announcements. Surfaces in tenant banners on the
// web/portal/admin top bars when active windows overlap with the current
// time and the audience matches.

interface Announcement {
  id: string;
  severity: 'INFO' | 'WARNING' | 'MAINTENANCE';
  title: string;
  body: string;
  link: string | null;
  audience: 'ALL' | 'TIER' | 'ROLE';
  audienceValue: string | null;
  startsAt: string;
  endsAt: string | null;
  dismissable: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const card: React.CSSProperties = { background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 20, marginTop: 24 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, display: 'block' };
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', fontSize: 13, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#FFFFFF', fontFamily: 'inherit', boxSizing: 'border-box' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 };
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13, fontWeight: 700, color: '#070E18', background: '#00D4FF', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const btnDanger: React.CSSProperties = { ...btnGhost, color: '#FCA5A5', borderColor: 'rgba(248,113,113,0.4)' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' };
const td: React.CSSProperties = { padding: '12px 14px', color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' };
const severityChip = (sev: string): React.CSSProperties => {
  const tone =
    sev === 'WARNING' ? { background: 'rgba(250,204,21,0.15)', color: '#FDE68A' } :
    sev === 'MAINTENANCE' ? { background: 'rgba(248,113,113,0.15)', color: '#FCA5A5' } :
    { background: 'rgba(96,165,250,0.15)', color: '#BFDBFE' };
  return { ...tone, display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.4 };
};

interface Form {
  severity: 'INFO' | 'WARNING' | 'MAINTENANCE';
  title: string;
  body: string;
  link: string;
  audience: 'ALL' | 'TIER' | 'ROLE';
  audienceValue: string;
  startsAt: string;
  endsAt: string;
  dismissable: boolean;
}

const blankForm: Form = {
  severity: 'INFO',
  title: '',
  body: '',
  link: '',
  audience: 'ALL',
  audienceValue: '',
  startsAt: '',
  endsAt: '',
  dismissable: true,
};

function isActive(a: Announcement): boolean {
  const now = Date.now();
  const starts = new Date(a.startsAt).getTime();
  const ends = a.endsAt ? new Date(a.endsAt).getTime() : Infinity;
  return starts <= now && now <= ends;
}

const Announcements: React.FC = () => {
  const [list, setList] = useState<Announcement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/announcements');
      if (!res.ok) throw new Error(`API ${res.status}`);
      const body = await res.json();
      setList(body.announcements ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        severity: form.severity,
        title: form.title,
        body: form.body,
        link: form.link.trim() || null,
        audience: form.audience,
        audienceValue: form.audience === 'ALL' ? null : (form.audienceValue.trim() || null),
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        dismissable: form.dismissable,
      };
      const url = editingId ? `/api/admin/announcements/${editingId}` : '/api/admin/announcements';
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setForm(blankForm);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function edit(a: Announcement) {
    setEditingId(a.id);
    setForm({
      severity: a.severity,
      title: a.title,
      body: a.body,
      link: a.link ?? '',
      audience: a.audience,
      audienceValue: a.audienceValue ?? '',
      startsAt: a.startsAt.slice(0, 16),
      endsAt: a.endsAt ? a.endsAt.slice(0, 16) : '',
      dismissable: a.dismissable,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(id: string) {
    if (!confirm('Delete this announcement? Tenants will stop seeing it immediately.')) return;
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={page}>
      <h1 style={header}>Platform Announcements</h1>
      <div style={subtitle}>
        Push a banner to every tenant&apos;s web / portal / admin top bar. Filter by tier or role; set
        a start + end window or leave end open for an indefinite notice.
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid rgba(244,67,54,0.4)', borderRadius: 6, color: '#FCA5A5', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF', marginBottom: 14 }}>
          {editingId ? 'Edit announcement' : 'New announcement'}
        </div>
        <div style={grid}>
          <div>
            <label style={label}>Severity</label>
            <select style={input} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Form['severity'] })}>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="MAINTENANCE">Maintenance</option>
            </select>
          </div>
          <div>
            <label style={label}>Audience</label>
            <select style={input} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as Form['audience'] })}>
              <option value="ALL">All tenants</option>
              <option value="TIER">By tier</option>
              <option value="ROLE">By user role</option>
            </select>
          </div>
          {form.audience !== 'ALL' && (
            <div>
              <label style={label}>{form.audience === 'TIER' ? 'Tier id' : 'Role'}</label>
              <input style={input} value={form.audienceValue} onChange={(e) => setForm({ ...form, audienceValue: e.target.value })} placeholder={form.audience === 'TIER' ? 'tier-uuid' : 'TENANT_ADMIN'} />
            </div>
          )}
          <div>
            <label style={label}>Starts at</label>
            <input style={input} type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </div>
          <div>
            <label style={label}>Ends at (optional)</label>
            <input style={input} type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Title</label>
          <input style={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Scheduled maintenance — Saturday 2am ET" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>Body</label>
          <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="The platform will be down for ~20 minutes for a database upgrade." />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={label}>Link (optional)</label>
            <input style={input} value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://status.helm.app" />
          </div>
          <div>
            <label style={label}>Dismissable?</label>
            <select style={input} value={form.dismissable ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, dismissable: e.target.value === 'yes' })}>
              <option value="yes">Yes — user can close</option>
              <option value="no">No — banner stays</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...btnPrimary, opacity: saving || !form.title.trim() || !form.body.trim() ? 0.5 : 1 }} disabled={saving || !form.title.trim() || !form.body.trim()} onClick={save}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Publish announcement'}
          </button>
          {editingId && (
            <button style={btnGhost} onClick={() => { setEditingId(null); setForm(blankForm); }}>Cancel</button>
          )}
        </div>
      </div>

      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Status</th>
            <th style={th}>Severity</th>
            <th style={th}>Title</th>
            <th style={th}>Audience</th>
            <th style={th}>Window</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>No announcements yet.</td></tr>
          ) : list.map((a) => (
            <tr key={a.id}>
              <td style={td}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                  ...(isActive(a) ? { background: 'rgba(34,197,94,0.15)', color: '#86EFAC' } : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }),
                }}>{isActive(a) ? 'LIVE' : 'INACTIVE'}</span>
              </td>
              <td style={td}><span style={severityChip(a.severity)}>{a.severity}</span></td>
              <td style={{ ...td, color: '#FFFFFF', fontWeight: 600 }}>{a.title}</td>
              <td style={td}>{a.audience}{a.audienceValue ? ` · ${a.audienceValue}` : ''}</td>
              <td style={td}>
                {new Date(a.startsAt).toLocaleString()}
                {a.endsAt ? ` → ${new Date(a.endsAt).toLocaleString()}` : ' →  no end'}
              </td>
              <td style={td}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={btnGhost} onClick={() => edit(a)}>Edit</button>
                  <button style={btnDanger} onClick={() => remove(a.id)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Announcements;
