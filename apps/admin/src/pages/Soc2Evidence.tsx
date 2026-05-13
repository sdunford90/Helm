import React, { useEffect, useState } from 'react';
import { useApiFetch } from '../lib/api';

// Plan 63 — SOC 2 evidence bundle UI.
//
// One-click "generate + download" for the JSON bundle that buildSoc2EvidenceBundle
// returns. Lets the auditor walk through controls without us having to
// hand-pull data from psql. Defaults to a 90-day window; the user can
// override.

interface Summary {
  tenants: { total: number; active: number; trial: number; locked: number };
  adminUsers: number;
  staffUsers: number;
  impersonationsInWindow: number;
  tenantExportsInWindow: number;
  periodsClosedInWindow: number;
  webhookAutoDisablesInWindow: number;
}

interface Bundle {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  summary: Summary;
  adminActions: unknown[];
  impersonations: unknown[];
  tenantExports: unknown[];
  periodCloses: unknown[];
  disabledWebhooks: unknown[];
}

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const card: React.CSSProperties = { background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 20, marginTop: 24 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, display: 'block' };
const input: React.CSSProperties = { padding: '7px 11px', fontSize: 12, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#FFFFFF', fontFamily: 'inherit', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13, fontWeight: 700, color: '#070E18', background: '#00D4FF', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };

const kpiTile: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 6,
  padding: 14,
};

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function Soc2Evidence() {
  const api = useApiFetch();
  const today = new Date();
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 86_400_000);
  const [windowStart, setWindowStart] = useState(isoDateOnly(ninetyDaysAgo));
  const [windowEnd, setWindowEnd] = useState(isoDateOnly(today));
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(`${windowEnd}T23:59:59`).toISOString(),
      });
      const r = await api<Bundle>(`/api/admin/soc2-evidence?${q.toString()}`);
      setBundle(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const download = () => {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soc2-evidence-${windowStart}-${windowEnd}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={page}>
      <h1 style={header}>SOC 2 Evidence</h1>
      <div style={subtitle}>
        Platform-wide control evidence bundle for SOC 2 walkthroughs. Defaults to the last 90 days.
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <label style={label}>Window start</label>
            <input
              style={input}
              type="date"
              value={windowStart}
              max={windowEnd}
              onChange={(e) => setWindowStart(e.target.value)}
            />
          </div>
          <div>
            <label style={label}>Window end</label>
            <input
              style={input}
              type="date"
              value={windowEnd}
              min={windowStart}
              onChange={(e) => setWindowEnd(e.target.value)}
            />
          </div>
          <button style={btnGhost} onClick={load} disabled={busy}>
            {busy ? 'Generating…' : 'Refresh'}
          </button>
          <button style={btnPrimary} onClick={download} disabled={!bundle || busy}>
            Download JSON
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...card, color: '#F44336' }}>{error}</div>
      )}

      {bundle && (
        <>
          <div style={card}>
            <div style={label}>Summary (window: {bundle.windowStart.slice(0, 10)} → {bundle.windowEnd.slice(0, 10)})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <KpiTile label="Tenants total" value={bundle.summary.tenants.total} />
              <KpiTile label="Active" value={bundle.summary.tenants.active} accent="#4CAF50" />
              <KpiTile label="Trial" value={bundle.summary.tenants.trial} accent="#00D4FF" />
              <KpiTile label="Locked" value={bundle.summary.tenants.locked} accent="#F44336" />
              <KpiTile label="Admin users" value={bundle.summary.adminUsers} />
              <KpiTile label="Staff users" value={bundle.summary.staffUsers} />
              <KpiTile label="Impersonations" value={bundle.summary.impersonationsInWindow} accent="#FF9800" />
              <KpiTile label="Tenant exports" value={bundle.summary.tenantExportsInWindow} />
              <KpiTile label="Period closes" value={bundle.summary.periodsClosedInWindow} />
              <KpiTile label="Webhook auto-disables" value={bundle.summary.webhookAutoDisablesInWindow} accent="#F44336" />
            </div>
          </div>

          <div style={card}>
            <div style={label}>Section sizes</div>
            <table style={{ width: '100%', fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
              <tbody>
                <Row name="Admin actions" count={bundle.adminActions.length} />
                <Row name="Impersonations" count={bundle.impersonations.length} />
                <Row name="Tenant exports" count={bundle.tenantExports.length} />
                <Row name="Period closes" count={bundle.periodCloses.length} />
                <Row name="Disabled webhooks" count={bundle.disabledWebhooks.length} />
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 12 }}>
              Click <em>Download JSON</em> above to save the full bundle. The file is platform-wide; no customer PII is included.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const KpiTile: React.FC<{ label: string; value: number; accent?: string }> = ({ label, value, accent = '#FFF' }) => (
  <div style={kpiTile}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 4 }}>{value}</div>
  </div>
);

const Row: React.FC<{ name: string; count: number }> = ({ name, count }) => (
  <tr>
    <td style={{ padding: '8px 0', color: 'rgba(255,255,255,0.6)' }}>{name}</td>
    <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{count.toLocaleString()}</td>
  </tr>
);
