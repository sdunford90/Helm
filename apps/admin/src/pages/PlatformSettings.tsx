import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiFetch } from '../lib/api';
import { useAdminMe, isSuperuser, canMutate, adminRoleLabel, AdminRole } from '../hooks/useAdminMe';

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 24,
};

const cardTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 20,
};

const fieldRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 0',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const fieldLabel: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.6)' };

const inputStyle: React.CSSProperties = {
  background: '#070E18',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#FFF',
  fontSize: 13,
  outline: 'none',
  width: 200,
  textAlign: 'right',
};

const toggleStyle = (on: boolean, disabled = false): React.CSSProperties => ({
  width: 44,
  height: 24,
  borderRadius: 12,
  background: on ? '#00D4FF' : 'rgba(255,255,255,0.1)',
  position: 'relative',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background 0.2s',
  border: 'none',
  padding: 0,
  opacity: disabled ? 0.6 : 1,
});

const toggleKnob = (on: boolean): React.CSSProperties => ({
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: '#FFF',
  position: 'absolute',
  top: 3,
  left: on ? 23 : 3,
  transition: 'left 0.2s',
});

interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  active: boolean;
  adminRole: AdminRole | null;
  createdAt: string;
  updatedAt: string;
}

const ADMIN_ROLE_OPTIONS: AdminRole[] = ['SUPERUSER', 'BILLING_ADMIN', 'READ_ONLY_SUPPORT'];

const adminBadgeColor = (role: AdminRole | null): string => {
  switch (role) {
    case 'SUPERUSER': return '#F44336';
    case 'BILLING_ADMIN': return '#00D4FF';
    case 'READ_ONLY_SUPPORT': return '#9C27B0';
    default: return '#94A3B8';
  }
};

const AdminUsersCard: React.FC = () => {
  const { me } = useAdminMe();
  const superuser = isSuperuser(me);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error(`Failed to load admins (${res.status})`);
      const data = await res.json();
      setUsers(data.items as AdminUser[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const updateRole = async (user: AdminUser, role: AdminRole) => {
    if (role === user.adminRole) return;
    setBusyId(user.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${user.id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminRole: role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...data } : u)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (user: AdminUser) => {
    setBusyId(user.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${user.id}/active`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !user.active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...data } : u)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
      }}>
        <div>
          <div style={cardTitle}>Platform Admin Users</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: -12 }}>
            {superuser
              ? 'Assign sub-roles for governance and least-privilege access.'
              : 'Only Superusers can change admin roles or activation.'}
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.3)',
          borderRadius: 6, padding: 12, color: '#F44336', fontSize: 13, marginBottom: 12,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          Loading admins…
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Admin', 'Email', 'Sub-role', 'Status', 'Actions'].map((h) => (
                <th key={h} style={{
                  textAlign: 'left', padding: '10px 12px', fontSize: 11,
                  fontWeight: 600, color: 'rgba(255,255,255,0.4)',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const color = adminBadgeColor(u.adminRole);
              const isMe = me?.id === u.id;
              return (
                <tr key={u.id}>
                  <td style={{ padding: '12px', fontSize: 13, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    {`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || '—'}
                    {isMe && <span style={{ marginLeft: 8, fontSize: 10, color: '#00D4FF' }}>(you)</span>}
                  </td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{u.email}</td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    {superuser ? (
                      <select
                        value={u.adminRole ?? ''}
                        disabled={busyId === u.id}
                        onChange={(e) => updateRole(u, e.target.value as AdminRole)}
                        style={{
                          background: '#070E18', color: '#FFF',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 6, padding: '6px 10px', fontSize: 12,
                        }}
                      >
                        {!u.adminRole && <option value="" disabled>— select —</option>}
                        {ADMIN_ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{adminRoleLabel(r)}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{
                        background: `${color}22`, color, padding: '3px 10px',
                        borderRadius: 10, fontSize: 11, fontWeight: 600,
                      }}>{adminRoleLabel(u.adminRole)}</span>
                    )}
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{
                      background: u.active ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.15)',
                      color: u.active ? '#4CAF50' : '#F44336',
                      padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                    }}>{u.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'right' }}>
                    {superuser && !isMe ? (
                      <button
                        disabled={busyId === u.id}
                        onClick={() => toggleActive(u)}
                        style={{
                          background: 'transparent',
                          border: `1px solid ${u.active ? 'rgba(244,67,54,0.4)' : 'rgba(76,175,80,0.4)'}`,
                          borderRadius: 6, padding: '4px 12px',
                          color: u.active ? '#F44336' : '#4CAF50',
                          fontSize: 11, cursor: busyId === u.id ? 'wait' : 'pointer',
                        }}
                      >{u.active ? 'Deactivate' : 'Reactivate'}</button>
                    ) : (
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

interface PlatformSettings {
  defaultTier: string | null;
  trialDurationDays: number;
  gracePeriodDays: number;
  autoLockAfterGrace: boolean;
  achFeeRatePct: number;
  cardFeeRatePct: number;
  stripeConnectFeePct: number;
  feeCapCents: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  featureFlagsJson: Record<string, boolean>;
  updatedAt?: string;
  updatedBy?: string | null;
}

const DEFAULT_FEATURE_FLAGS: Record<string, boolean> = {
  multiCurrency: false,
  advancedAnalytics: true,
  apiAccess: true,
  whiteLabel: true,
  waitlistManagement: true,
  mobileApp: false,
  ssoIntegration: false,
  bulkOperations: true,
};

const TIER_OPTIONS = [
  { label: 'Starter', value: 'Starter' },
  { label: 'Professional', value: 'Professional' },
  { label: 'Enterprise', value: 'Enterprise' },
];

const PlatformSettings: React.FC = () => {
  const apiFetch = useApiFetch();
  const { me } = useAdminMe();
  const allowedToMutate = canMutate(me);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [serverSettings, setServerSettings] = useState<PlatformSettings | null>(null);
  const [draft, setDraft] = useState<PlatformSettings | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<PlatformSettings>('/api/admin/platform-settings');
      const flags = { ...DEFAULT_FEATURE_FLAGS, ...(data.featureFlagsJson ?? {}) };
      const normalized: PlatformSettings = { ...data, featureFlagsJson: flags };
      setServerSettings(normalized);
      setDraft(normalized);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const dirty = useMemo(() => {
    if (!draft || !serverSettings) return false;
    return JSON.stringify(draft) !== JSON.stringify(serverSettings);
  }, [draft, serverSettings]);

  const updateDraft = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSavedAt(null);
  };

  const toggleFeature = (key: string) => {
    if (!draft || !allowedToMutate) return;
    setDraft({
      ...draft,
      featureFlagsJson: { ...draft.featureFlagsJson, [key]: !draft.featureFlagsJson[key] },
    });
    setSavedAt(null);
  };

  const handleSave = async () => {
    if (!draft || !allowedToMutate) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<PlatformSettings>('/api/admin/platform-settings', {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      const flags = { ...DEFAULT_FEATURE_FLAGS, ...(updated.featureFlagsJson ?? {}) };
      const normalized = { ...updated, featureFlagsJson: flags };
      setServerSettings(normalized);
      setDraft(normalized);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!serverSettings) return;
    setDraft(serverSettings);
    setSavedAt(null);
  };

  if (loading || !draft) {
    return (
      <div>
        <AdminUsersCard />
        <div style={{ ...card, textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: 40 }}>
          {error ? `Couldn't load settings: ${error}` : 'Loading platform settings…'}
        </div>
      </div>
    );
  }

  const lockedNote = !allowedToMutate
    ? 'Read-only mode — Superuser or Billing Admin role required to change settings.'
    : null;

  return (
    <div>
      <AdminUsersCard />

      {error && (
        <div style={{
          background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.2)',
          borderRadius: 6, padding: 12, color: '#F44336', fontSize: 13, marginBottom: 16,
        }}>{error}</div>
      )}

      {lockedNote && (
        <div style={{
          background: 'rgba(255,152,0,0.08)', border: '1px solid rgba(255,152,0,0.2)',
          borderRadius: 6, padding: 12, color: '#FF9800', fontSize: 13, marginBottom: 16,
        }}>{lockedNote}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Default Tier */}
        <div style={card}>
          <div style={cardTitle}>Default SaaS Tier Configuration</div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Default tier for new signups</span>
            <select
              value={draft.defaultTier ?? ''}
              disabled={!allowedToMutate}
              onChange={(e) => updateDraft('defaultTier', e.target.value || null)}
              style={inputStyle}
            >
              <option value="">— none —</option>
              {TIER_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Trial duration (days)</span>
            <input
              type="number" min={1} max={365}
              value={draft.trialDurationDays}
              disabled={!allowedToMutate}
              onChange={(e) => updateDraft('trialDurationDays', Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Grace period (days)</span>
            <input
              type="number" min={0} max={90}
              value={draft.gracePeriodDays}
              disabled={!allowedToMutate}
              onChange={(e) => updateDraft('gracePeriodDays', Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <div style={{ ...fieldRow, borderBottom: 'none' }}>
            <span style={fieldLabel}>Auto-lock after grace period</span>
            <button
              style={toggleStyle(draft.autoLockAfterGrace, !allowedToMutate)}
              disabled={!allowedToMutate}
              onClick={() => updateDraft('autoLockAfterGrace', !draft.autoLockAfterGrace)}
            >
              <div style={toggleKnob(draft.autoLockAfterGrace)} />
            </button>
          </div>
        </div>

        {/* Platform Fee Rates */}
        <div style={card}>
          <div style={cardTitle}>Platform Fee Rates</div>
          <div style={fieldRow}>
            <div>
              <div style={fieldLabel}>Default ACH Fee Rate</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Applied to bank transfer payments</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number" step="0.1" min={0}
                value={draft.achFeeRatePct}
                disabled={!allowedToMutate}
                onChange={(e) => updateDraft('achFeeRatePct', Number(e.target.value))}
                style={{ ...inputStyle, width: 80 }}
              />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>%</span>
            </div>
          </div>
          <div style={fieldRow}>
            <div>
              <div style={fieldLabel}>Default Card Fee Rate</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Applied to credit/debit card payments</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number" step="0.1" min={0}
                value={draft.cardFeeRatePct}
                disabled={!allowedToMutate}
                onChange={(e) => updateDraft('cardFeeRatePct', Number(e.target.value))}
                style={{ ...inputStyle, width: 80 }}
              />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>%</span>
            </div>
          </div>
          <div style={fieldRow}>
            <div>
              <div style={fieldLabel}>Stripe Connect Fee</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Platform application fee</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number" step="0.1" min={0}
                value={draft.stripeConnectFeePct}
                disabled={!allowedToMutate}
                onChange={(e) => updateDraft('stripeConnectFeePct', Number(e.target.value))}
                style={{ ...inputStyle, width: 80 }}
              />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>%</span>
            </div>
          </div>
          <div style={{ ...fieldRow, borderBottom: 'none' }}>
            <div>
              <div style={fieldLabel}>Fee Cap per Transaction</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Maximum fee amount (USD)</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>$</span>
              <input
                type="number" step="1" min={0}
                value={(draft.feeCapCents / 100).toFixed(2)}
                disabled={!allowedToMutate}
                onChange={(e) => updateDraft('feeCapCents', Math.round(Number(e.target.value) * 100))}
                style={{ ...inputStyle, width: 100 }}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Maintenance Mode */}
        <div style={card}>
          <div style={cardTitle}>Maintenance Mode</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#FFF' }}>Platform Maintenance Mode</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                When enabled, all tenant apps show a maintenance page. Admin portal remains accessible.
              </div>
            </div>
            <button
              style={toggleStyle(draft.maintenanceMode, !allowedToMutate)}
              disabled={!allowedToMutate}
              onClick={() => updateDraft('maintenanceMode', !draft.maintenanceMode)}
            >
              <div style={toggleKnob(draft.maintenanceMode)} />
            </button>
          </div>
          {draft.maintenanceMode && (
            <div style={{ background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.2)', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F44336', marginBottom: 4 }}>Maintenance Mode Active</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>All tenant-facing applications are currently showing the maintenance page.</div>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Maintenance Message</label>
            <textarea
              value={draft.maintenanceMessage}
              disabled={!allowedToMutate}
              onChange={(e) => updateDraft('maintenanceMessage', e.target.value)}
              style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '10px 12px', color: '#FFF', fontSize: 13, outline: 'none', resize: 'vertical', minHeight: 80, boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Feature Flags */}
        <div style={card}>
          <div style={cardTitle}>Feature Flags</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>Global feature toggles that affect all tenants</div>
          {Object.entries(draft.featureFlagsJson).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
              </span>
              <button
                style={toggleStyle(!!val, !allowedToMutate)}
                disabled={!allowedToMutate}
                onClick={() => toggleFeature(key)}
              >
                <div style={toggleKnob(!!val)} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
        {savedAt && !dirty && (
          <span style={{ fontSize: 12, color: '#4CAF50' }}>Saved at {savedAt}</span>
        )}
        {dirty && (
          <span style={{ fontSize: 12, color: '#FF9800' }}>Unsaved changes</span>
        )}
        <button
          onClick={handleReset}
          disabled={!dirty || saving}
          style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, padding: '10px 24px', color: 'rgba(255,255,255,0.6)',
            fontSize: 13, cursor: dirty ? 'pointer' : 'not-allowed', opacity: dirty ? 1 : 0.5,
          }}
        >Discard Changes</button>
        <button
          onClick={handleSave}
          disabled={!dirty || saving || !allowedToMutate}
          style={{
            background: '#0A2342', border: '1px solid #00D4FF',
            borderRadius: 6, padding: '10px 24px', color: '#00D4FF',
            fontSize: 13, fontWeight: 600,
            cursor: !dirty || !allowedToMutate ? 'not-allowed' : (saving ? 'wait' : 'pointer'),
            opacity: !dirty || !allowedToMutate ? 0.5 : 1,
          }}
        >{saving ? 'Saving…' : 'Save All Changes'}</button>
      </div>
    </div>
  );
};

export default PlatformSettings;
