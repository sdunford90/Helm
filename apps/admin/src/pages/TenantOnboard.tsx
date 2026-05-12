import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiFetch } from '../lib/api';

// A9 — Tenant Onboarding Wizard. A guided 4-step flow on top of the
// existing POST /api/admin/tenants endpoint (which already wraps the
// tenant + location + owner-user creation in a transaction).
//
// Step 1: Org info        name, subdomain, owner email
// Step 2: First location  name, timezone, address
// Step 3: Tier            pick from /api/admin/billing/tiers
// Step 4: Review          confirm, then POST

interface Tier {
  id: string;
  name: string;
  monthlyFeeCents: number;
  perLocationFeeCents: number;
}

interface FormState {
  name: string;
  subdomain: string;
  adminEmail: string;
  locationName: string;
  timezone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  saasTierId: string;
}

const blank: FormState = {
  name: '',
  subdomain: '',
  adminEmail: '',
  locationName: '',
  timezone: 'America/New_York',
  address: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  saasTierId: '',
};

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const stepRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 24 };
const stepPill = (active: boolean, done: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
  background: active ? '#00D4FF' : done ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)',
  color: active ? '#070E18' : done ? '#86EFAC' : 'rgba(255,255,255,0.55)',
});
const card: React.CSSProperties = { background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 24 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, display: 'block' };
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', fontSize: 13, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#FFFFFF', fontFamily: 'inherit', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '10px 22px', fontSize: 13, fontWeight: 700, color: '#070E18', background: '#00D4FF', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: React.CSSProperties = { padding: '9px 18px', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
];

function suggestSubdomain(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

const TenantOnboard: React.FC = () => {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(blank);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const body = await apiFetch<Tier[]>('/api/admin/billing/tiers');
        setTiers(Array.isArray(body) ? body : []);
      } catch {
        // Tiers are optional in the create payload, just leave the list empty.
      }
    })();
  }, [apiFetch]);

  const steps = ['Org', 'First location', 'Tier', 'Review'];
  const canNext: boolean = useMemo(() => {
    if (step === 0) {
      return !!form.name.trim() && !!form.subdomain.trim() && !!form.adminEmail.trim();
    }
    if (step === 1) return !!form.locationName.trim();
    return true;
  }, [step, form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-suggest subdomain when the org name changes (only if user hasn't
      // manually edited it yet — heuristic: suggestion always matches current).
      if (key === 'name' && (prev.subdomain === '' || prev.subdomain === suggestSubdomain(prev.name))) {
        next.subdomain = suggestSubdomain(String(value));
      }
      return next;
    });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        subdomain: form.subdomain.trim(),
        adminEmail: form.adminEmail.trim(),
        saasTierId: form.saasTierId || null,
        initialLocation: {
          name: form.locationName.trim(),
          timezone: form.timezone,
          address: form.address.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          zip: form.zip.trim() || undefined,
          phone: form.phone.trim() || undefined,
        },
      };
      const tenant = await apiFetch<{ id: string; name: string }>('/api/admin/tenants', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      navigate(`/tenants/${tenant.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tenant');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={page}>
      <h1 style={header}>Onboard a new tenant</h1>
      <div style={subtitle}>
        Guided four-step flow on top of POST /api/admin/tenants. Tenant + first location + owner user are
        created atomically.
      </div>

      <div style={stepRow}>
        {steps.map((s, i) => (
          <span key={s} style={stepPill(i === step, i < step)}>{i + 1}. {s}</span>
        ))}
      </div>

      {error && (
        <div style={{ padding: 12, border: '1px solid rgba(244,67,54,0.4)', borderRadius: 6, color: '#FCA5A5', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={card}>
        {step === 0 && (
          <div>
            <div style={grid}>
              <div>
                <label style={label}>Marina / org name</label>
                <input style={input} value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Bayshore Marina" />
              </div>
              <div>
                <label style={label}>Subdomain</label>
                <input style={input} value={form.subdomain} onChange={(e) => update('subdomain', e.target.value.toLowerCase())} placeholder="bayshore" />
              </div>
              <div>
                <label style={label}>Owner email</label>
                <input style={input} type="email" value={form.adminEmail} onChange={(e) => update('adminEmail', e.target.value)} placeholder="owner@bayshoremarina.com" />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              The owner email becomes the first MARINA_OWNER user. They get a Clerk invitation on first login.
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div style={grid}>
              <div>
                <label style={label}>Location name</label>
                <input style={input} value={form.locationName} onChange={(e) => update('locationName', e.target.value)} placeholder="Main dock" />
              </div>
              <div>
                <label style={label}>Timezone</label>
                <select style={input} value={form.timezone} onChange={(e) => update('timezone', e.target.value)}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Phone</label>
                <input style={input} value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="(555) 555-5555" />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={label}>Address</label>
              <input style={input} value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="123 Harbor Way" />
            </div>
            <div style={grid}>
              <div>
                <label style={label}>City</label>
                <input style={input} value={form.city} onChange={(e) => update('city', e.target.value)} placeholder="Portsmouth" />
              </div>
              <div>
                <label style={label}>State</label>
                <input style={input} value={form.state} onChange={(e) => update('state', e.target.value)} placeholder="NH" />
              </div>
              <div>
                <label style={label}>ZIP</label>
                <input style={input} value={form.zip} onChange={(e) => update('zip', e.target.value)} placeholder="03801" />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 14 }}>
              Pick a SaaS tier for the first location. Optional — leaves the location on the default fallback if skipped.
            </div>
            {tiers.length === 0 ? (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                No tiers configured yet. Continue without selecting one; you can attach a tier from the Subscription tab later.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {tiers.map((t) => {
                  const selected = form.saasTierId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => update('saasTierId', selected ? '' : t.id)}
                      style={{
                        textAlign: 'left', padding: 16, borderRadius: 8, cursor: 'pointer',
                        background: selected ? 'rgba(0,212,255,0.15)' : '#070E18',
                        border: selected ? '2px solid #00D4FF' : '1px solid rgba(255,255,255,0.12)',
                        color: '#FFFFFF', fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
                        ${(t.monthlyFeeCents / 100).toFixed(0)}/mo + ${(t.perLocationFeeCents / 100).toFixed(0)}/location
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF', marginBottom: 12 }}>Review</div>
            <table style={{ width: '100%', fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
              <tbody>
                <tr><td style={{ padding: '6px 0', color: 'rgba(255,255,255,0.5)', width: 180 }}>Org name</td><td>{form.name}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'rgba(255,255,255,0.5)' }}>Subdomain</td><td>{form.subdomain}.gethelm.com</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'rgba(255,255,255,0.5)' }}>Owner email</td><td>{form.adminEmail}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'rgba(255,255,255,0.5)' }}>First location</td><td>{form.locationName} · {form.timezone}</td></tr>
                {(form.address || form.city) && (
                  <tr><td style={{ padding: '6px 0', color: 'rgba(255,255,255,0.5)' }}>Address</td><td>{[form.address, form.city, form.state, form.zip].filter(Boolean).join(', ')}</td></tr>
                )}
                {form.phone && (
                  <tr><td style={{ padding: '6px 0', color: 'rgba(255,255,255,0.5)' }}>Phone</td><td>{form.phone}</td></tr>
                )}
                <tr><td style={{ padding: '6px 0', color: 'rgba(255,255,255,0.5)' }}>Tier</td><td>{tiers.find((t) => t.id === form.saasTierId)?.name ?? '— none (default fallback) —'}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <button style={{ ...btnGhost, opacity: step === 0 ? 0.4 : 1 }} disabled={step === 0} onClick={() => setStep(step - 1)}>← Back</button>
          {step < steps.length - 1 ? (
            <button style={{ ...btnPrimary, opacity: canNext ? 1 : 0.5 }} disabled={!canNext} onClick={() => setStep(step + 1)}>
              Next →
            </button>
          ) : (
            <button style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }} disabled={submitting} onClick={submit}>
              {submitting ? 'Provisioning…' : 'Create tenant'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TenantOnboard;
