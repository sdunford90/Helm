import React, { useCallback, useEffect, useMemo, useState } from 'react';

// ---------- API types -----------------------------------------------------

interface CohortRow {
  cohort: string;
  signups: number;
  startingMrrCents: number;
  retainedByMonth: { month: string; retained: number; mrrCents: number }[];
  churnRate: number;
  nrr: number;
}
interface ArpuPoint {
  month: string;
  activeTenants: number;
  totalMrrCents: number;
  arpuCents: number;
}
interface CohortsReport {
  range: { from: string; to: string };
  cohorts: CohortRow[];
  arpu: ArpuPoint[];
  totals: {
    signups: number;
    activeNow: number;
    churnedNow: number;
    overallChurnRate: number;
    overallNrr: number;
  };
}

interface FunnelReport {
  range: { from: string; to: string };
  trialSignups: number;
  converted: number;
  conversionRate: number;
  medianTimeToPaidDays: number | null;
  dropoff: { neverActivated: number; expired: number; downgraded: number };
  monthly: {
    month: string;
    signups: number;
    converted: number;
    conversionRate: number;
  }[];
}

interface FeatureUsageReport {
  range: { from: string; to: string };
  tiers: { id: string; name: string; tenantCount: number }[];
  features: string[];
  matrix: number[][];
  counts: number[][];
}

// ---------- Styling -------------------------------------------------------

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#FFF',
  margin: 0,
};

const cardLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 16,
};

const subtle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,255,255,0.45)',
};

const dateInput: React.CSSProperties = {
  background: '#0A2342',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#FFF',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
};

const downloadBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(0,212,255,0.4)',
  color: '#00D4FF',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
};

// ---------- Helpers -------------------------------------------------------

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function fmtMoney(cents: number): string {
  if (cents >= 100_000_000) return `$${(cents / 100_000_000).toFixed(2)}M`;
  if (cents >= 100_000) return `$${(cents / 100_000).toFixed(1)}k`;
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

// ---------- Section: Date range picker ------------------------------------

const RangePicker: React.FC<{
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  csvHref: string;
}> = ({ from, to, onChange, csvHref }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <span style={subtle}>From</span>
    <input
      type="date"
      value={from}
      max={to}
      style={dateInput}
      onChange={(e) => onChange({ from: e.target.value, to })}
    />
    <span style={subtle}>To</span>
    <input
      type="date"
      value={to}
      min={from}
      style={dateInput}
      onChange={(e) => onChange({ from, to: e.target.value })}
    />
    <a href={csvHref} download style={downloadBtn}>Download CSV</a>
  </div>
);

// ---------- Section 1: Cohorts & retention --------------------------------

const CohortsSection: React.FC<{
  range: { from: string; to: string };
  setRange: (r: { from: string; to: string }) => void;
}> = ({ range, setRange }) => {
  const [data, setData] = useState<CohortsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJson<CohortsReport>(`/api/admin/analytics/cohorts?from=${range.from}&to=${range.to}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError('Failed to load cohort data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  const csvHref = `/api/admin/analytics/cohorts?from=${range.from}&to=${range.to}&format=csv`;

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={sectionTitle}>Cohorts &amp; Retention</h2>
          <div style={{ ...subtle, marginTop: 4 }}>Monthly signup cohorts, churn, NRR, and ARPU trend.</div>
        </div>
        <RangePicker from={range.from} to={range.to} onChange={setRange} csvHref={csvHref} />
      </div>

      {loading && <div style={subtle}>Loading…</div>}
      {error && <div style={{ ...subtle, color: '#F44336' }}>{error}</div>}

      {data && !loading && !error && (
        <>
          {/* Top KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <KpiTile label="Signups in window" value={String(data.totals.signups)} accent="#00D4FF" />
            <KpiTile label="Active now" value={String(data.totals.activeNow)} accent="#4CAF50" />
            <KpiTile label="Overall churn" value={fmtPct(data.totals.overallChurnRate)} accent="#F44336" />
            <KpiTile label="Net revenue retention" value={fmtPct(data.totals.overallNrr)} accent="#FF9800" />
          </div>

          {/* ARPU trend bars */}
          <div style={{ marginBottom: 24 }}>
            <div style={cardLabel}>ARPU Trend</div>
            {data.arpu.length === 0 ? (
              <div style={subtle}>No data in this window.</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
                {data.arpu.map((p) => {
                  const max = Math.max(1, ...data.arpu.map((x) => x.arpuCents));
                  return (
                    <div key={p.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 10, color: '#4CAF50', fontWeight: 600 }}>
                        {p.activeTenants > 0 ? fmtMoney(p.arpuCents) : '—'}
                      </div>
                      <div
                        title={`${fmtMonth(p.month)} • ${p.activeTenants} active • ${fmtMoney(p.totalMrrCents)} MRR`}
                        style={{
                          width: '100%',
                          height: `${(p.arpuCents / max) * 110}px`,
                          background: 'linear-gradient(180deg, #00D4FF 0%, #0A2342 100%)',
                          borderRadius: 3,
                          minHeight: 1,
                        }}
                      />
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{fmtMonth(p.month)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cohort retention table */}
          <div style={cardLabel}>Cohort Retention (tenants still active at end of month)</div>
          <CohortRetentionTable cohorts={data.cohorts} />
        </>
      )}
    </div>
  );
};

const KpiTile: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: 14 }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 4 }}>{value}</div>
  </div>
);

const CohortRetentionTable: React.FC<{ cohorts: CohortRow[] }> = ({ cohorts }) => {
  // Find every distinct report-month present so the table aligns nicely.
  const allMonths = useMemo(() => {
    const set = new Set<string>();
    cohorts.forEach((c) => c.retainedByMonth.forEach((r) => set.add(r.month)));
    return Array.from(set).sort();
  }, [cohorts]);

  if (cohorts.length === 0) return <div style={subtle}>No cohorts in this window.</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={th}>Cohort</th>
            <th style={th}>Signups</th>
            <th style={th}>Start MRR</th>
            <th style={th}>Churn</th>
            <th style={th}>NRR</th>
            {allMonths.map((m) => (
              <th key={m} style={th}>{fmtMonth(m)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => {
            const byMonth = new Map(c.retainedByMonth.map((r) => [r.month, r]));
            return (
              <tr key={c.cohort}>
                <td style={td}>{fmtMonth(c.cohort)}</td>
                <td style={td}>{c.signups}</td>
                <td style={td}>{fmtMoney(c.startingMrrCents)}</td>
                <td style={{ ...td, color: c.signups === 0 ? 'rgba(255,255,255,0.2)' : c.churnRate > 0.2 ? '#F44336' : c.churnRate > 0 ? '#FF9800' : 'rgba(255,255,255,0.6)' }}>
                  {c.signups > 0 ? fmtPct(c.churnRate) : '—'}
                </td>
                <td style={{ ...td, color: c.nrr >= 1 ? '#4CAF50' : c.nrr >= 0.85 ? '#FF9800' : '#F44336' }}>
                  {c.signups > 0 ? fmtPct(c.nrr) : '—'}
                </td>
                {allMonths.map((m) => {
                  const r = byMonth.get(m);
                  if (!r) return <td key={m} style={{ ...td, color: 'rgba(255,255,255,0.15)' }}>—</td>;
                  if (c.signups === 0) {
                    return <td key={m} style={{ ...td, color: 'rgba(255,255,255,0.2)' }}>—</td>;
                  }
                  const pct = r.retained / c.signups;
                  return (
                    <td key={m} style={{ ...td, background: heatmapBg(pct), color: '#0A2342', fontWeight: 600 }}>
                      {r.retained}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

function heatmapBg(pct: number): string {
  // pct ∈ [0..1] — interpolate from translucent red → green.
  if (pct === 0) return 'rgba(244,67,54,0.55)';
  if (pct >= 0.95) return 'rgba(76,175,80,0.85)';
  if (pct >= 0.75) return 'rgba(76,175,80,0.65)';
  if (pct >= 0.5) return 'rgba(255,193,7,0.65)';
  return 'rgba(255,152,0,0.6)';
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.45)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  color: 'rgba(255,255,255,0.7)',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  whiteSpace: 'nowrap',
};

// ---------- Section 2: Trial → paid funnel --------------------------------

const FunnelSection: React.FC<{
  range: { from: string; to: string };
  setRange: (r: { from: string; to: string }) => void;
}> = ({ range, setRange }) => {
  const [data, setData] = useState<FunnelReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJson<FunnelReport>(`/api/admin/analytics/funnel?from=${range.from}&to=${range.to}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError('Failed to load funnel data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  const csvHref = `/api/admin/analytics/funnel?from=${range.from}&to=${range.to}&format=csv`;

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={sectionTitle}>Trial → Paid Funnel</h2>
          <div style={{ ...subtle, marginTop: 4 }}>Trial signups, conversions, time-to-paid, and drop-off.</div>
        </div>
        <RangePicker from={range.from} to={range.to} onChange={setRange} csvHref={csvHref} />
      </div>

      {loading && <div style={subtle}>Loading…</div>}
      {error && <div style={{ ...subtle, color: '#F44336' }}>{error}</div>}

      {data && !loading && !error && (
        <>
          {/* Funnel bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20 }}>
            <div>
              <div style={cardLabel}>Funnel</div>
              <FunnelBar label="Trial signups" count={data.trialSignups} max={data.trialSignups} color="#00D4FF" />
              <FunnelBar label="Converted to paid" count={data.converted} max={data.trialSignups} color="#4CAF50" />
              <div style={{ marginTop: 14, display: 'flex', gap: 16 }}>
                <Stat label="Conversion rate" value={fmtPct(data.conversionRate)} accent="#4CAF50" />
                <Stat
                  label="Median time to paid"
                  value={data.medianTimeToPaidDays === null ? '—' : `${data.medianTimeToPaidDays} days`}
                  accent="#00D4FF"
                />
              </div>
            </div>

            <div>
              <div style={cardLabel}>Drop-off Breakdown</div>
              <DropoffRow label="Never activated" count={data.dropoff.neverActivated} total={data.trialSignups} color="#F44336" />
              <DropoffRow label="Expired (locked)" count={data.dropoff.expired} total={data.trialSignups} color="#FF9800" />
              <DropoffRow label="Downgraded" count={data.dropoff.downgraded} total={data.trialSignups} color="#9C27B0" />
            </div>
          </div>

          {/* Monthly mini-table */}
          <div style={cardLabel}>By Month</div>
          {data.monthly.length === 0 ? (
            <div style={subtle}>No signups in this window.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Month</th>
                  <th style={th}>Signups</th>
                  <th style={th}>Converted</th>
                  <th style={th}>Conversion rate</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.month}>
                    <td style={td}>{fmtMonth(m.month)}</td>
                    <td style={td}>{m.signups}</td>
                    <td style={{ ...td, color: '#4CAF50', fontWeight: 600 }}>{m.converted}</td>
                    <td style={td}>{m.signups > 0 ? fmtPct(m.conversionRate) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
};

const FunnelBar: React.FC<{ label: string; count: number; max: number; color: string }> = ({ label, count, max, color }) => {
  const pct = max > 0 ? count / max : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{label}</span>
        <span style={{ fontSize: 12, color: '#FFF', fontWeight: 600 }}>
          {count}{max > 0 && count !== max ? ` (${fmtPct(pct)})` : ''}
        </span>
      </div>
      <div style={{ height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(2, pct * 100)}%`, background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
};

const DropoffRow: React.FC<{ label: string; count: number; total: number; color: string }> = ({ label, count, total, color }) => {
  const pct = total > 0 ? count / total : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{label}</span>
        <span style={{ fontSize: 12, color: '#FFF', fontWeight: 600 }}>{count}<span style={{ ...subtle, marginLeft: 6 }}>{fmtPct(pct)}</span></span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(1, pct * 100)}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
  <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: 12 }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.45)' }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: accent, marginTop: 4 }}>{value}</div>
  </div>
);

// ---------- Section 3: Per-tier feature usage -----------------------------

const FeatureUsageSection: React.FC<{
  range: { from: string; to: string };
  setRange: (r: { from: string; to: string }) => void;
}> = ({ range, setRange }) => {
  const [data, setData] = useState<FeatureUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJson<FeatureUsageReport>(`/api/admin/analytics/feature-usage?from=${range.from}&to=${range.to}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError('Failed to load feature usage data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  const csvHref = `/api/admin/analytics/feature-usage?from=${range.from}&to=${range.to}&format=csv`;

  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={sectionTitle}>Per-Tier Feature Usage</h2>
          <div style={{ ...subtle, marginTop: 4 }}>% of tenants on each tier that used the feature in the window.</div>
        </div>
        <RangePicker from={range.from} to={range.to} onChange={setRange} csvHref={csvHref} />
      </div>

      {loading && <div style={subtle}>Loading…</div>}
      {error && <div style={{ ...subtle, color: '#F44336' }}>{error}</div>}

      {data && !loading && !error && (
        data.tiers.length === 0 ? (
          <div style={subtle}>No tenants assigned to a tier yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Feature</th>
                  {data.tiers.map((t) => (
                    <th key={t.id} style={th}>
                      {t.name}
                      <div style={{ ...subtle, fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>
                        {t.tenantCount} tenant{t.tenantCount === 1 ? '' : 's'}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.features.map((feature, fi) => (
                  <tr key={feature}>
                    <td style={{ ...td, fontWeight: 500, color: '#FFF' }}>{feature}</td>
                    {data.tiers.map((t, ti) => {
                      const pct = data.matrix[fi][ti];
                      const count = data.counts[fi][ti];
                      return (
                        <td
                          key={t.id}
                          style={{
                            ...td,
                            background: usageHeat(pct),
                            color: pct > 0.5 ? '#0A2342' : 'rgba(255,255,255,0.7)',
                            fontWeight: 600,
                            textAlign: 'center',
                            minWidth: 110,
                          }}
                        >
                          {fmtPct(pct)}
                          <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2, color: pct > 0.5 ? 'rgba(10,35,66,0.7)' : 'rgba(255,255,255,0.4)' }}>
                            {count}/{t.tenantCount}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
};

function usageHeat(pct: number): string {
  if (pct === 0) return 'rgba(255,255,255,0.02)';
  if (pct >= 0.9) return 'rgba(76,175,80,0.85)';
  if (pct >= 0.7) return 'rgba(76,175,80,0.65)';
  if (pct >= 0.4) return 'rgba(255,193,7,0.55)';
  if (pct >= 0.15) return 'rgba(255,152,0,0.45)';
  return 'rgba(244,67,54,0.35)';
}

// ---------- Page ----------------------------------------------------------

const Analytics: React.FC = () => {
  const [cohortRange, setCohortRange] = useState(defaultRange);
  const [funnelRange, setFunnelRange] = useState(defaultRange);
  const [featureRange, setFeatureRange] = useState(defaultRange);

  const onSyncAll = useCallback((next: { from: string; to: string }) => {
    setCohortRange(next);
    setFunnelRange(next);
    setFeatureRange(next);
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#FFF', margin: 0 }}>Cross-Tenant Analytics</h1>
          <div style={{ ...subtle, marginTop: 4 }}>
            Cohort retention, trial→paid funnel, and per-tier feature adoption across every tenant.
          </div>
        </div>
        <button
          onClick={() => onSyncAll(defaultRange())}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.7)',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Reset to last 12 months
        </button>
      </div>

      <CohortsSection range={cohortRange} setRange={setCohortRange} />
      <FunnelSection range={funnelRange} setRange={setFunnelRange} />
      <FeatureUsageSection range={featureRange} setRange={setFeatureRange} />
    </div>
  );
};

export default Analytics;
