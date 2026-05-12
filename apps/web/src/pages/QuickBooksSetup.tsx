import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Check,
  Plug,
  Unplug,
  CreditCard,
} from 'lucide-react';
import { api } from '../lib/api';
import { useModules } from '../context/ModulesContext';

interface LocationStatus {
  locationId: string;
  locationName: string;
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  lastChartOfAccountsSyncAt: string | null;
  glAccountCount: number;
  missingMappings: number;
}

interface MissingItem {
  kind: 'product' | 'category' | 'dockage_rate' | 'service_fee';
  id: string;
  name: string;
  missing: string[];
}

interface MissingWarning {
  locationId: string;
  locationName: string;
  items: MissingItem[];
  totalIssues: number;
}

interface StripeStatus {
  connected: boolean;
  onboardingComplete: boolean;
  accountId: string | null;
  dashboardUrl: string | null;
}

interface CoaAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  subType: string | null;
  source: 'QBO' | 'MANUAL';
  isActive: boolean;
  qboAccountId: string | null;
}

interface PostingAccountsResponse {
  locationId: string;
  qboConnected: boolean;
  accounts: {
    arGlAccountId: string | null;
    undepositedFundsGlAccountId: string | null;
    deferredRevenueGlAccountId: string | null;
    defaultRevenueGlAccountId: string | null;
    salesTaxGlAccountId: string | null;
    earlyTerminationGlAccountId: string | null;
    achReturnFeeGlAccountId: string | null;
  };
  candidates: Array<{
    id: string;
    accountNumber: string;
    name: string;
    type: string;
    locationId: string | null;
    qboAccountId: string | null;
  }>;
}

function statusPillStyle(connected: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '4px 10px', borderRadius: '999px',
    fontSize: '12px', fontWeight: 600,
    backgroundColor: connected ? '#DCFCE7' : '#F1F5F9',
    color: connected ? '#16A34A' : '#64748B',
  };
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px', maxWidth: '1200px', margin: '0 auto' },
  title: {
    fontSize: '32px', fontWeight: 700, color: '#0A2342',
    letterSpacing: '-0.02em', margin: 0,
  },
  subtitle: { fontSize: '14px', color: '#64748B', marginTop: '4px' },
  divider: {
    height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none', marginTop: '12px', marginBottom: '24px', borderRadius: '2px',
  },
  card: {
    border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px',
    marginBottom: '16px', backgroundColor: '#FFFFFF',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  cardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: '12px',
  },
  locName: { fontSize: '18px', fontWeight: 600, color: '#0A2342' },
  meta: { fontSize: '13px', color: '#64748B', marginTop: '4px' },
  actions: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '8px 14px', fontSize: '13px', fontWeight: 600,
    border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer',
    backgroundColor: '#F8FAFC', color: '#0A2342',
  },
  primary: {
    backgroundColor: '#0A2342', color: '#FFFFFF', borderColor: '#0A2342',
  },
  danger: {
    backgroundColor: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA',
  },
  warningCard: {
    border: '1px solid #FBBF24', borderRadius: '8px', padding: '16px',
    backgroundColor: '#FFFBEB', marginTop: '12px',
  },
  infoCard: {
    border: '1px solid #BAE6FD', borderRadius: '8px', padding: '12px 16px',
    backgroundColor: '#F0F9FF', marginTop: '12px', fontSize: '13px',
    color: '#075985', lineHeight: '1.5',
  },
  warnTitle: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '14px', fontWeight: 600, color: '#92400E', marginBottom: '8px',
  },
  warnList: { fontSize: '13px', color: '#78350F', lineHeight: '1.6' },
  table: {
    width: '100%', borderCollapse: 'collapse',
    fontSize: '13px', marginTop: '12px',
  },
  th: {
    textAlign: 'left', padding: '8px 12px', backgroundColor: '#F1F5F9',
    color: '#475569', fontSize: '12px', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    borderBottom: '1px solid #E2E8F0',
  },
  td: { padding: '8px 12px', borderBottom: '1px solid #F1F5F9' },
  badge: {
    display: 'inline-block', padding: '2px 6px', borderRadius: '4px',
    fontSize: '11px', fontWeight: 600,
    backgroundColor: '#E0F2FE', color: '#0369A1',
  },
  inactive: { color: '#94A3B8' },
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

export default function QuickBooksSetup() {
  const { currentLocationId } = useModules();
  const [locations, setLocations] = useState<LocationStatus[]>([]);
  const [warnings, setWarnings] = useState<MissingWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyLoc, setBusyLoc] = useState<string | null>(null);
  const [accountsByLoc, setAccountsByLoc] = useState<
    Record<string, { accounts: CoaAccount[]; lastSyncAt: string | null }>
  >({});
  const [stripeByLoc, setStripeByLoc] = useState<Record<string, StripeStatus>>(
    {},
  );
  // Per-location pinned posting accounts (A/R, undeposited funds, deferred
  // revenue). Loaded lazily per card and updated optimistically on save so
  // the dropdowns reflect the new selection without a full page reload.
  const [postingByLoc, setPostingByLoc] = useState<
    Record<string, PostingAccountsResponse>
  >({});
  const [savingPostingLoc, setSavingPostingLoc] = useState<string | null>(null);
  const [postingError, setPostingError] = useState<Record<string, string | null>>(
    {},
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (currentLocationId) qs.set('locationId', currentLocationId);
      const r = await api.get<{ data: LocationStatus[]; warnings: MissingWarning[] }>(
        `/api/qbo/locations/status?${qs}`,
      );
      setLocations(r.data);
      setWarnings(r.warnings);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadAccounts = useCallback(async (locationId: string) => {
    try {
      const r = await api.get<{ data: CoaAccount[]; lastSyncAt: string | null }>(
        `/api/qbo/locations/${locationId}/chart-of-accounts`,
      );
      setAccountsByLoc((m) => ({
        ...m,
        [locationId]: { accounts: r.data, lastSyncAt: r.lastSyncAt },
      }));
    } catch {
      /* ignore */
    }
  }, []);

  const loadStripe = useCallback(async (locationId: string) => {
    try {
      const r = await api.get<StripeStatus>(
        `/api/settings/stripe?locationId=${encodeURIComponent(locationId)}`,
      );
      setStripeByLoc((m) => ({ ...m, [locationId]: r }));
    } catch {
      setStripeByLoc((m) => ({
        ...m,
        [locationId]: {
          connected: false,
          onboardingComplete: false,
          accountId: null,
          dashboardUrl: null,
        },
      }));
    }
  }, []);

  const loadPostingAccounts = useCallback(async (locationId: string) => {
    try {
      const r = await api.get<PostingAccountsResponse>(
        `/api/settings/locations/${locationId}/posting-accounts`,
      );
      setPostingByLoc((m) => ({ ...m, [locationId]: r }));
      setPostingError((m) => ({ ...m, [locationId]: null }));
    } catch (e: any) {
      setPostingError((m) => ({
        ...m,
        [locationId]: e?.response?.data?.error ?? 'Failed to load posting accounts',
      }));
    }
  }, []);

  const savePostingAccounts = useCallback(
    async (
      locationId: string,
      patch: Partial<PostingAccountsResponse['accounts']>,
    ) => {
      setSavingPostingLoc(locationId);
      try {
        const r = await api.put<{
          locationId: string;
          accounts: PostingAccountsResponse['accounts'];
        }>(`/api/settings/locations/${locationId}/posting-accounts`, patch);
        setPostingByLoc((m) => {
          const prev = m[locationId];
          if (!prev) return m;
          return { ...m, [locationId]: { ...prev, accounts: r.accounts } };
        });
        setPostingError((m) => ({ ...m, [locationId]: null }));
      } catch (e: any) {
        setPostingError((m) => ({
          ...m,
          [locationId]: e?.response?.data?.error ?? 'Failed to save posting accounts',
        }));
      } finally {
        setSavingPostingLoc(null);
      }
    },
    [],
  );

  useEffect(() => {
    locations.forEach((l) => {
      if (l.connected && !accountsByLoc[l.locationId]) loadAccounts(l.locationId);
      if (!stripeByLoc[l.locationId]) loadStripe(l.locationId);
      if (!postingByLoc[l.locationId]) loadPostingAccounts(l.locationId);
    });
  }, [
    locations,
    accountsByLoc,
    stripeByLoc,
    postingByLoc,
    loadAccounts,
    loadStripe,
    loadPostingAccounts,
  ]);

  const handleSync = async (locationId: string) => {
    setBusyLoc(locationId);
    try {
      await api.post(`/api/qbo/locations/${locationId}/sync-chart-of-accounts`);
      await Promise.all([load(), loadAccounts(locationId)]);
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Sync failed');
    } finally {
      setBusyLoc(null);
    }
  };

  const handleConnect = async (locationId: string) => {
    setBusyLoc(locationId);
    try {
      const r = await api.post<{ url: string }>(
        `/api/settings/qbo/connect`,
        { locationId },
      );
      if (r?.url) window.location.href = r.url;
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Connect failed');
    } finally {
      setBusyLoc(null);
    }
  };

  const handleDisconnect = async (locationId: string) => {
    if (!confirm('Disconnect QuickBooks for this location?')) return;
    setBusyLoc(locationId);
    try {
      await api.post(`/api/settings/qbo/disconnect`, {
        locationId,
        confirm: true,
      });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Disconnect failed');
    } finally {
      setBusyLoc(null);
    }
  };

  if (loading) {
    return (
      <div style={s.subtitle}>Loading QuickBooks setup…</div>
    );
  }

  return (
    <>
      <h2 style={{ ...s.title, fontSize: 24, marginTop: 8 }}>QuickBooks Setup</h2>
      <div style={s.subtitle}>
        Connect each location to its own QuickBooks Online company and pull its
        chart of accounts. Per-location product/category/dockage/fee mappings
        live in <Link to="/settings/products">Products & Revenue</Link> and
        <Link to="/billing/chart-of-accounts"> Chart of Accounts</Link>.
      </div>

      <div style={s.infoCard}>
        <strong>Stripe per location:</strong> each card below also shows the
        Stripe Connect status for that same location. Manage Stripe in detail
        on the <Link to="/settings">main Settings page</Link>.
      </div>

      <hr style={s.divider} />

      {error && (
        <div style={s.warningCard}>
          <div style={s.warnTitle}>
            <AlertTriangle size={14} /> {error}
          </div>
        </div>
      )}

      {locations.length === 0 && (
        <div style={s.card}>
          No locations configured yet. Create a location in Settings first.
        </div>
      )}

      {locations.map((l) => {
        const w = warnings.find((x) => x.locationId === l.locationId);
        const accountsState = accountsByLoc[l.locationId];
        const stripe = stripeByLoc[l.locationId];
        const posting = postingByLoc[l.locationId];
        const postingErr = postingError[l.locationId];
        return (
          <div key={l.locationId} style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <div style={s.locName}>{l.locationName}</div>
                <div style={s.meta}>
                  {l.connected ? (
                    <>
                      <span style={statusPillStyle(true)}>
                        <Check size={12} /> Connected
                      </span>
                      &nbsp;to <strong>{l.companyName ?? l.realmId}</strong>
                      &nbsp;· {l.glAccountCount} GL accounts · last pulled{' '}
                      {fmtDate(l.lastChartOfAccountsSyncAt)}
                    </>
                  ) : (
                    <span style={statusPillStyle(false)}>Not connected</span>
                  )}
                </div>
              </div>
              <div style={s.actions}>
                {l.connected ? (
                  <>
                    <button
                      style={{ ...s.btn, ...s.primary }}
                      onClick={() => handleSync(l.locationId)}
                      disabled={busyLoc === l.locationId}
                    >
                      <RefreshCw size={14} />{' '}
                      {busyLoc === l.locationId
                        ? 'Pulling…'
                        : 'Import / Refresh Chart of Accounts'}
                    </button>
                    <button
                      style={{ ...s.btn, ...s.danger }}
                      onClick={() => handleDisconnect(l.locationId)}
                      disabled={busyLoc === l.locationId}
                    >
                      <Unplug size={14} /> Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    style={{ ...s.btn, ...s.primary }}
                    onClick={() => handleConnect(l.locationId)}
                    disabled={busyLoc === l.locationId}
                  >
                    <Plug size={14} /> Connect QuickBooks
                  </button>
                )}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                color: '#475569',
                marginTop: '8px',
                padding: '8px 12px',
                backgroundColor: '#F8FAFC',
                borderRadius: '6px',
              }}
            >
              <CreditCard size={14} />
              <strong>Stripe:</strong>
              {!stripe ? (
                <span>Loading…</span>
              ) : stripe.connected && stripe.onboardingComplete ? (
                <>
                  <span style={statusPillStyle(true)}>
                    <Check size={12} /> Connected
                  </span>
                  {stripe.accountId && <span>· {stripe.accountId}</span>}
                  {stripe.dashboardUrl && (
                    <a
                      href={stripe.dashboardUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#0369A1' }}
                    >
                      Stripe dashboard{' '}
                      <ExternalLink
                        size={11}
                        style={{ verticalAlign: 'middle' }}
                      />
                    </a>
                  )}
                </>
              ) : stripe.connected ? (
                <>
                  <span style={statusPillStyle(false)}>Onboarding pending</span>
                  <Link to="/settings">Finish in Settings</Link>
                </>
              ) : (
                <>
                  <span style={statusPillStyle(false)}>Not connected</span>
                  <Link to="/settings">Connect in Settings</Link>
                </>
              )}
            </div>

            {posting && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '12px 16px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '6px',
                  backgroundColor: '#FAFCFF',
                }}
              >
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#0A2342',
                    marginBottom: '6px',
                  }}
                >
                  Posting accounts
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#475569',
                    marginBottom: '10px',
                    lineHeight: '1.4',
                  }}
                >
                  Pin which GL accounts invoices and payments for this
                  location post to. When set, these win over the tenant
                  defaults and (for QBO-connected locations) are sent to
                  QuickBooks as the A/R and Deposit-To accounts.
                </div>
                {posting.candidates.length === 0 ? (
                  <div style={{ fontSize: '12px', color: '#92400E' }}>
                    No accounts available yet — import the chart of accounts
                    first.
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '12px',
                    }}
                  >
                    {(
                      [
                        { key: 'arGlAccountId', label: 'Accounts Receivable', types: null, system: false },
                        { key: 'undepositedFundsGlAccountId', label: 'Cash / Undeposited Funds', types: null, system: false },
                        { key: 'deferredRevenueGlAccountId', label: 'Deferred Revenue', types: null, system: false },
                        { key: 'defaultRevenueGlAccountId', label: 'Default Revenue (4500)', types: ['REVENUE'] as const, system: true },
                        { key: 'salesTaxGlAccountId', label: 'Sales Tax Payable (2400)', types: ['LIABILITY'] as const, system: true },
                        { key: 'earlyTerminationGlAccountId', label: 'Early Termination Income (4700)', types: ['REVENUE'] as const, system: true },
                        { key: 'achReturnFeeGlAccountId', label: 'ACH Return Fee Revenue (4600)', types: ['REVENUE'] as const, system: true },
                      ] as const
                    ).map(({ key, label, types, system }) => {
                      const filtered = types
                        ? posting.candidates.filter((c) =>
                            (types as ReadonlyArray<string>).includes(c.type),
                          )
                        : posting.candidates;
                      return (
                        <label
                          key={key}
                          style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
                        >
                          <span style={{ fontSize: '12px', color: '#475569' }}>
                            {label}
                          </span>
                          <select
                            value={posting.accounts[key] ?? ''}
                            disabled={savingPostingLoc === l.locationId}
                            onChange={(e) =>
                              savePostingAccounts(l.locationId, {
                                [key]: e.target.value === '' ? null : e.target.value,
                              } as Partial<PostingAccountsResponse['accounts']>)
                            }
                            style={{
                              padding: '6px 8px',
                              fontSize: '13px',
                              border: '1px solid #CBD5E1',
                              borderRadius: '4px',
                              backgroundColor: '#FFFFFF',
                            }}
                          >
                            <option value="">
                              {system && posting.qboConnected
                                ? '— Required: pin an account —'
                                : '— Use tenant default —'}
                            </option>
                            {filtered.length === 0 ? (
                              <option value="" disabled>
                                No matching {types ? types.join('/') : ''} accounts in chart
                              </option>
                            ) : (
                              filtered.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.accountNumber} · {c.name}
                                  {c.qboAccountId ? ' · QBO' : ''}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                )}
                {postingErr && (
                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '12px',
                      color: '#B91C1C',
                    }}
                  >
                    {postingErr}
                  </div>
                )}
              </div>
            )}

            {w && w.totalIssues > 0 && (
              <div style={s.warningCard}>
                <div style={s.warnTitle}>
                  <AlertTriangle size={14} />
                  {w.totalIssues} item{w.totalIssues === 1 ? '' : 's'} missing
                  GL mappings for this location
                </div>
                <div style={s.warnList}>
                  {w.items.slice(0, 8).map((it) => {
                    const link =
                      it.kind === 'product' || it.kind === 'category'
                        ? '/settings/products'
                        : it.kind === 'dockage_rate' || it.kind === 'service_fee'
                          ? '/settings/products'
                          : '/billing/chart-of-accounts';
                    return (
                      <div key={`${it.kind}-${it.id}`}>
                        <Link to={link}>
                          {it.name}{' '}
                          <ExternalLink
                            size={11}
                            style={{ verticalAlign: 'middle' }}
                          />
                        </Link>{' '}
                        — missing {it.missing.join(', ')}
                      </div>
                    );
                  })}
                  {w.items.length > 8 && (
                    <div>+{w.items.length - 8} more…</div>
                  )}
                </div>
              </div>
            )}

            {l.connected && accountsState && accountsState.accounts.length > 0 && (
              <div>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>Name</th>
                      <th style={s.th}>Type</th>
                      <th style={s.th}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountsState.accounts.map((a) => (
                      <tr
                        key={a.id}
                        style={a.isActive ? undefined : s.inactive}
                      >
                        <td style={s.td}>{a.accountNumber}</td>
                        <td style={s.td}>{a.name}</td>
                        <td style={s.td}>{a.type}</td>
                        <td style={s.td}>
                          <span style={s.badge}>
                            {a.source === 'QBO' ? 'QuickBooks' : 'Manual'}
                          </span>
                          {!a.isActive && ' (inactive)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
