import { useState } from 'react';
import { useAuth, useUser, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TenantResponse {
  tenant: { id: string; name: string; subdomain: string };
  adminUser: { id: string; email: string };
  setupSteps: Record<string, { complete: boolean; label: string }>;
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const NAVY = '#0A2342';
const CYAN = '#00D4FF';
const WHITE = '#FFFFFF';
const BORDER = '#CCCCCC';
const SLATE = '#64748B';
const GREEN = '#16A34A';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Phoenix',
  'America/Detroit',
  'America/Indiana/Indianapolis',
  'America/Kentucky/Louisville',
];

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    minHeight: '100vh',
    background: '#F1F5F9',
    padding: '40px 24px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  container: {
    maxWidth: 720,
    margin: '0 auto',
  },
  h1: {
    fontSize: 32,
    fontWeight: 700,
    color: NAVY,
    margin: '0 0 32px',
    textAlign: 'center' as const,
  },

  // Progress bar
  progressWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    marginBottom: 40,
  },
  stepCircle: (active: boolean, done: boolean): React.CSSProperties => ({
    width: 36,
    height: 36,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 14,
    color: active || done ? WHITE : NAVY,
    background: active ? CYAN : done ? NAVY : WHITE,
    border: `2px solid ${active ? CYAN : NAVY}`,
    flexShrink: 0,
    transition: 'all 0.2s',
  }),
  stepLine: (done: boolean): React.CSSProperties => ({
    height: 3,
    width: 60,
    background: done ? NAVY : BORDER,
    transition: 'background 0.2s',
  }),

  // Card
  card: {
    background: WHITE,
    borderRadius: 8,
    padding: '32px 28px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: NAVY,
    margin: '0 0 24px',
  },

  // Form
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    color: NAVY,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${BORDER}`,
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'box-shadow 0.15s',
  },
  inputFocus: {
    boxShadow: `0 0 0 2px ${SLATE}`,
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${BORDER}`,
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    background: WHITE,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  subdomainWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
  },
  subdomainSuffix: {
    padding: '10px 12px',
    background: '#F1F5F9',
    border: `1px solid ${BORDER}`,
    borderLeft: 'none',
    borderRadius: '0 4px 4px 0',
    fontSize: 14,
    color: SLATE,
    whiteSpace: 'nowrap' as const,
  },
  subdomainInput: {
    flex: 1,
    padding: '10px 12px',
    border: `1px solid ${BORDER}`,
    borderRadius: '4px 0 0 4px',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },

  // Buttons
  buttonRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 32,
  },
  primaryBtn: {
    padding: '10px 28px',
    background: NAVY,
    color: WHITE,
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  secondaryBtn: {
    padding: '10px 28px',
    background: WHITE,
    color: NAVY,
    border: `1.5px solid ${NAVY}`,
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  launchBtn: {
    padding: '12px 36px',
    background: NAVY,
    color: CYAN,
    border: `2px solid ${CYAN}`,
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  connectBtn: {
    padding: '12px 32px',
    background: NAVY,
    color: WHITE,
    border: 'none',
    borderRadius: 6,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  successBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: '#F0FDF4',
    color: GREEN,
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    marginTop: 6,
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: '1px solid #E2E8F0',
    fontSize: 14,
  },
  summaryLabel: {
    color: SLATE,
    fontWeight: 500,
  },
  summaryValue: {
    color: NAVY,
    fontWeight: 600,
  },
};

// ---------------------------------------------------------------------------
// FocusInput — an input that shows Slate focus ring
// ---------------------------------------------------------------------------

function FocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={{
        ...styles.input,
        ...(focused ? styles.inputFocus : {}),
        ...(props.style ?? {}),
      }}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STEP_LABELS = ['Marina Details', 'Branding', 'Stripe Connect', 'QuickBooks', 'Review & Launch'];

export default function Onboarding() {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn redirectUrl="/onboarding" />
      </SignedOut>
      <SignedIn>
        <OnboardingInner />
      </SignedIn>
    </>
  );
}

function OnboardingInner() {
  const { userId } = useAuth();
  const { user } = useUser();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 1 — Marina Details (prefilled from the signed-in Clerk profile)
  const [marinaName, setMarinaName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [adminEmail, setAdminEmail] = useState(
    user?.primaryEmailAddress?.emailAddress ?? '',
  );
  const [adminFirstName, setAdminFirstName] = useState(user?.firstName ?? '');
  const [adminLastName, setAdminLastName] = useState(user?.lastName ?? '');
  const [timezone, setTimezone] = useState('America/New_York');
  const [fiscalYearEnd, setFiscalYearEnd] = useState('12-31');

  // Result of step 1
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Step 2 — Branding
  const [logo, setLogo] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0A2342');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [brandingSaved, setBrandingSaved] = useState(false);

  // Step 3 — Stripe
  const [stripeConnected, setStripeConnected] = useState(false);

  // Step 4 — QBO
  const [qboConnected, setQboConnected] = useState(false);

  // Step 5 — Launch
  const [launched, setLaunched] = useState(false);

  // -----------------------------------------------------------------------
  // API helpers
  // -----------------------------------------------------------------------

  async function handleStartOnboarding() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marinaName,
          subdomain,
          adminEmail,
          adminFirstName,
          adminLastName,
          timezone,
          fiscalYearEnd,
          // Identifies the Clerk account doing the signup — the backend
          // uses it to create a Clerk Organization tied to this tenant.
          clerkUserId: userId ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data: TenantResponse = await res.json();
      setTenantId(data.tenant.id);
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveBranding() {
    if (!tenantId) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/${tenantId}/branding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logo: logo || undefined,
          primaryColor,
          marinaName,
          address: address || undefined,
          phone: phone || undefined,
          email: contactEmail || undefined,
          website: website || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setBrandingSaved(true);
      setStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectStripe() {
    if (!tenantId) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/${tenantId}/stripe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      // Open Stripe OAuth in a new window
      window.open(data.url, '_blank', 'noopener,noreferrer');
      setStripeConnected(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectQBO() {
    if (!tenantId) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/${tenantId}/qbo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      window.open(data.url, '_blank', 'noopener,noreferrer');
      setQboConnected(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleLaunch() {
    if (!tenantId) return;
    setError('');
    setLoading(true);
    try {
      // Chart of accounts was seeded during /start. Re-run here to cover the
      // case where the initial seed failed mid-transaction — the endpoint is
      // idempotent.
      const res = await fetch(`${API_BASE}/api/onboarding/${tenantId}/chart-of-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setLaunched(true);
      // Hand the newly-provisioned marina off to the main dashboard.
      setTimeout(() => navigate('/'), 800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Progress indicator
  // -----------------------------------------------------------------------

  function renderProgress() {
    return (
      <div style={styles.progressWrapper}>
        {STEP_LABELS.map((label, i) => {
          const num = i + 1;
          const active = num === step;
          const done = num < step;
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <div style={styles.stepLine(done)} />}
              <div
                style={styles.stepCircle(active, done)}
                title={label}
              >
                {done ? '\u2713' : num}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Step renderers
  // -----------------------------------------------------------------------

  function renderStep1() {
    return (
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Marina Details</h2>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Marina Name</label>
          <FocusInput
            value={marinaName}
            onChange={(e) => setMarinaName(e.target.value)}
            placeholder="Harbour Bay Marina"
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Subdomain</label>
          <div style={styles.subdomainWrapper}>
            <input
              style={styles.subdomainInput}
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              placeholder="harbourbay"
            />
            <span style={styles.subdomainSuffix}>.gethelm.com</span>
          </div>
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Admin Email</label>
          <FocusInput
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="admin@marina.com"
          />
        </div>

        <div style={styles.row}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>First Name</label>
            <FocusInput
              value={adminFirstName}
              onChange={(e) => setAdminFirstName(e.target.value)}
              placeholder="Jane"
            />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Last Name</label>
            <FocusInput
              value={adminLastName}
              onChange={(e) => setAdminLastName(e.target.value)}
              placeholder="Smith"
            />
          </div>
        </div>

        <div style={styles.row}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Timezone</label>
            <select
              style={styles.select}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Fiscal Year End (MM-DD)</label>
            <FocusInput
              value={fiscalYearEnd}
              onChange={(e) => setFiscalYearEnd(e.target.value)}
              placeholder="12-31"
            />
          </div>
        </div>

        {error && <p style={styles.errorText}>{error}</p>}

        <div style={{ ...styles.buttonRow, justifyContent: 'flex-end' }}>
          <button
            style={{ ...styles.primaryBtn, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
            onClick={handleStartOnboarding}
          >
            {loading ? 'Creating...' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  function renderStep2() {
    return (
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Branding</h2>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Logo URL</label>
          <FocusInput
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            placeholder="https://example.com/logo.png"
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Primary Color</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              style={{ width: 40, height: 36, border: 'none', cursor: 'pointer', padding: 0 }}
            />
            <FocusInput
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#0A2342"
              style={{ flex: 1 }}
            />
          </div>
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Address</label>
          <FocusInput
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Marina Way, Coastal City, FL 33101"
          />
        </div>

        <div style={styles.row}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Phone</label>
            <FocusInput
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(305) 555-0100"
            />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Email</label>
            <FocusInput
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="info@marina.com"
            />
          </div>
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Website</label>
          <FocusInput
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://marina.com"
          />
        </div>

        {error && <p style={styles.errorText}>{error}</p>}

        <div style={styles.buttonRow}>
          <button style={styles.secondaryBtn} onClick={() => { setError(''); setStep(1); }}>
            Back
          </button>
          <button
            style={{ ...styles.primaryBtn, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
            onClick={handleSaveBranding}
          >
            {loading ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  function renderStep3() {
    return (
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Connect Stripe Account</h2>
        <p style={{ color: SLATE, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
          Connect your Stripe account to accept credit card payments, process payouts, and
          manage subscriptions for your marina.
        </p>

        {stripeConnected ? (
          <div style={styles.successBadge}>
            <span style={{ fontSize: 18 }}>&#10003;</span> Stripe Connected
          </div>
        ) : (
          <button
            style={{ ...styles.connectBtn, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
            onClick={handleConnectStripe}
          >
            {loading ? 'Connecting...' : 'Connect Stripe Account'}
          </button>
        )}

        {error && <p style={styles.errorText}>{error}</p>}

        <div style={styles.buttonRow}>
          <button style={styles.secondaryBtn} onClick={() => { setError(''); setStep(2); }}>
            Back
          </button>
          <button style={styles.primaryBtn} onClick={() => { setError(''); setStep(4); }}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  function renderStep4() {
    return (
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Connect QuickBooks</h2>
        <p style={{ color: SLATE, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
          Link your QuickBooks Online account to automatically sync invoices, payments, and
          financial data with your accounting system.
        </p>

        {qboConnected ? (
          <div style={styles.successBadge}>
            <span style={{ fontSize: 18 }}>&#10003;</span> QuickBooks Connected
          </div>
        ) : (
          <button
            style={{ ...styles.connectBtn, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
            onClick={handleConnectQBO}
          >
            {loading ? 'Connecting...' : 'Connect QuickBooks'}
          </button>
        )}

        {error && <p style={styles.errorText}>{error}</p>}

        <div style={styles.buttonRow}>
          <button style={styles.secondaryBtn} onClick={() => { setError(''); setStep(3); }}>
            Back
          </button>
          <button style={styles.primaryBtn} onClick={() => { setError(''); setStep(5); }}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  function renderStep5() {
    if (launched) {
      return (
        <div style={{ ...styles.card, textAlign: 'center' as const }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#10003;</div>
          <h2 style={{ ...styles.cardTitle, textAlign: 'center' as const }}>
            Your Marina Is Live!
          </h2>
          <p style={{ color: SLATE, fontSize: 15, marginBottom: 24 }}>
            <strong>{marinaName}</strong> is ready at{' '}
            <span style={{ color: CYAN, fontWeight: 600 }}>{subdomain}.gethelm.com</span>
          </p>
          <a
            href="/"
            style={{
              ...styles.primaryBtn,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Go to Dashboard
          </a>
        </div>
      );
    }

    const summaryItems = [
      { label: 'Marina Name', value: marinaName },
      { label: 'Subdomain', value: `${subdomain}.gethelm.com` },
      { label: 'Admin Email', value: adminEmail },
      { label: 'Admin', value: `${adminFirstName} ${adminLastName}` },
      { label: 'Timezone', value: timezone.replace(/_/g, ' ') },
      { label: 'Fiscal Year End', value: fiscalYearEnd },
      { label: 'Branding', value: brandingSaved ? 'Configured' : 'Not configured' },
      { label: 'Stripe', value: stripeConnected ? 'Connected' : 'Not connected' },
      { label: 'QuickBooks', value: qboConnected ? 'Connected' : 'Not connected' },
    ];

    return (
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Review &amp; Launch</h2>
        <p style={{ color: SLATE, fontSize: 14, marginBottom: 20 }}>
          Review your marina settings before going live. You can always change these later
          in Settings.
        </p>

        <div style={{ marginBottom: 24 }}>
          {summaryItems.map((item) => (
            <div key={item.label} style={styles.summaryRow}>
              <span style={styles.summaryLabel}>{item.label}</span>
              <span
                style={{
                  ...styles.summaryValue,
                  color:
                    item.value === 'Not connected' || item.value === 'Not configured'
                      ? '#F59E0B'
                      : item.value === 'Connected' || item.value === 'Configured'
                        ? GREEN
                        : NAVY,
                }}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>

        {error && <p style={styles.errorText}>{error}</p>}

        <div style={styles.buttonRow}>
          <button style={styles.secondaryBtn} onClick={() => { setError(''); setStep(4); }}>
            Back
          </button>
          <button
            style={{ ...styles.launchBtn, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
            onClick={handleLaunch}
          >
            {loading ? 'Launching...' : 'Launch Marina'}
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1} className="helm-page-title">Set Up Your Marina</h1>
        {renderProgress()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
      </div>
    </div>
  );
}
