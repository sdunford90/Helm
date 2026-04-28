import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiFetch } from '../lib/api';

interface ChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  completedAt: string | null;
}

interface TrialTenant {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  saasTier: { id: string; name: string; monthlyFeeCents: number } | null;
  createdAt: string;
  trialStartedAt: string;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  assignedAdminUserId: string | null;
  checklist: ChecklistItem[];
  completed: number;
  total: number;
  pctComplete: number;
  lastProgressAt: string;
  stalled: boolean;
}

interface TrialsResponse {
  total: number;
  stalledCount: number;
  stalledAfterDays: number;
  items: TrialTenant[];
}

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const ChecklistDots: React.FC<{ items: ChecklistItem[] }> = ({ items }) => (
  <div style={{ display: 'flex', gap: 4 }}>
    {items.map((it) => (
      <span
        key={it.key}
        title={`${it.label}${it.complete && it.completedAt ? ` — ${new Date(it.completedAt).toLocaleDateString()}` : ''}`}
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: it.complete ? '#4CAF50' : 'rgba(255,255,255,0.1)',
          border: it.complete ? '1px solid #4CAF50' : '1px solid rgba(255,255,255,0.15)',
          display: 'inline-block',
        }}
      />
    ))}
  </div>
);

const TEMPLATE_OPTIONS = [
  { value: 'welcome', label: 'Welcome — getting started' },
  { value: 'midtrial', label: 'Mid-trial — need a hand?' },
  { value: 'final', label: 'Final days — let\'s talk' },
];

const Trials: React.FC = () => {
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const [data, setData] = useState<TrialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showStalledOnly, setShowStalledOnly] = useState(false);
  const [stalledAfterDays, setStalledAfterDays] = useState(5);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nudgeFor, setNudgeFor] = useState<TrialTenant | null>(null);
  const [nudgeTemplate, setNudgeTemplate] = useState('midtrial');

  const fetchTrials = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ stalledAfterDays: String(stalledAfterDays) });
      if (showStalledOnly) params.set('onlyStalled', 'true');
      const res = await apiFetch<TrialsResponse>(`/api/admin/tenants/trials?${params}`);
      setData(res);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load trials');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, showStalledOnly, stalledAfterDays]);

  useEffect(() => { fetchTrials(); }, [fetchTrials]);

  const handleAssignToMe = async (tenant: TrialTenant) => {
    setBusyId(tenant.id);
    try {
      await apiFetch(`/api/admin/tenants/${tenant.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await fetchTrials();
    } catch (e) {
      window.alert(`Failed to assign: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSendNudge = async () => {
    if (!nudgeFor) return;
    setBusyId(nudgeFor.id);
    try {
      const res = await apiFetch<{ queued: boolean; recipient: string }>(
        `/api/admin/tenants/${nudgeFor.id}/nudge`,
        {
          method: 'POST',
          body: JSON.stringify({ templateKey: nudgeTemplate }),
        },
      );
      window.alert(
        res.queued
          ? `Nudge queued to ${res.recipient}.`
          : `Logged the nudge attempt for ${res.recipient}, but the email queue is offline.`,
      );
      setNudgeFor(null);
      await fetchTrials();
    } catch (e) {
      window.alert(`Failed to send nudge: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const headerStats = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Active Trials', value: data.total.toString(), color: '#2196F3' },
      { label: 'Stalled', value: data.stalledCount.toString(), color: data.stalledCount > 0 ? '#FF9800' : '#4CAF50' },
      { label: 'Avg. Progress', value: data.items.length
        ? `${Math.round(data.items.reduce((a, t) => a + t.pctComplete, 0) / data.items.length)}%`
        : '—', color: '#00D4FF' },
    ];
  }, [data]);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        {headerStats.map((s) => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
            <input
              type="checkbox"
              checked={showStalledOnly}
              onChange={(e) => setShowStalledOnly(e.target.checked)}
            />
            Stalled trials only
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
            Stall threshold (days):
            <input
              type="number"
              min={1}
              max={60}
              value={stalledAfterDays}
              onChange={(e) => setStalledAfterDays(Math.max(1, Math.min(60, parseInt(e.target.value) || 5)))}
              style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 13, width: 64, outline: 'none' }}
            />
          </label>
        </div>
        <button
          onClick={() => fetchTrials()}
          style={{ background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ ...card, color: '#F44336', marginBottom: 16 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ ...card, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>Loading trials…</div>
      ) : !data || data.items.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: 60 }}>
          {showStalledOnly ? 'No stalled trials right now. 🎉' : 'No trial tenants found.'}
        </div>
      ) : (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Marina', 'Progress', 'Checklist', 'Trial', 'Last Progress', 'Tier', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} style={{ background: t.stalled ? 'rgba(255,152,0,0.04)' : 'transparent' }}>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div
                      onClick={() => navigate(`/tenants/${t.id}/deep-dive`)}
                      style={{ fontSize: 13, fontWeight: 600, color: '#FFF', cursor: 'pointer' }}
                    >
                      {t.name}
                      {t.stalled && (
                        <span style={{ marginLeft: 8, background: 'rgba(255,152,0,0.15)', color: '#FF9800', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600 }}>
                          STALLED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{t.subdomain}.gethelm.com</div>
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${t.pctComplete}%`,
                          height: '100%',
                          background: t.pctComplete === 100 ? '#4CAF50' : '#00D4FF',
                          transition: 'width 0.3s',
                        }} />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#FFF', minWidth: 38, textAlign: 'right' }}>{t.completed}/{t.total}</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{t.pctComplete}% complete</div>
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <ChecklistDots items={t.checklist} />
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                    {t.trialDaysRemaining !== null ? (
                      <>
                        <div style={{
                          color: t.trialDaysRemaining < 0 ? '#F44336' : t.trialDaysRemaining <= 3 ? '#FF9800' : '#FFF',
                          fontWeight: 600,
                        }}>
                          {t.trialDaysRemaining < 0 ? `Expired ${-t.trialDaysRemaining}d ago` : `${t.trialDaysRemaining}d left`}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                          ends {t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString() : '—'}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.35)' }}>No end date set</span>
                    )}
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                    {new Date(t.lastProgressAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                    {t.saasTier?.name ?? '—'}
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => { setNudgeFor(t); setNudgeTemplate('midtrial'); }}
                        disabled={busyId === t.id}
                        style={{ background: 'transparent', border: '1px solid rgba(0,212,255,0.4)', borderRadius: 4, color: '#00D4FF', fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontWeight: 500 }}
                      >
                        Nudge
                      </button>
                      <button
                        onClick={() => handleAssignToMe(t)}
                        disabled={busyId === t.id}
                        style={{
                          background: t.assignedAdminUserId ? 'rgba(76,175,80,0.12)' : 'transparent',
                          border: '1px solid rgba(76,175,80,0.4)',
                          borderRadius: 4,
                          color: '#4CAF50',
                          fontSize: 11,
                          padding: '5px 10px',
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        {t.assignedAdminUserId ? 'Reassign' : 'Assign to me'}
                      </button>
                      <button
                        onClick={() => navigate(`/tenants/${t.id}/deep-dive`)}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, color: 'rgba(255,255,255,0.7)', fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontWeight: 500 }}
                      >
                        Deep dive →
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Nudge modal */}
      {nudgeFor && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setNudgeFor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 28, width: 460 }}
          >
            <h3 style={{ margin: '0 0 6px', color: '#FFF', fontSize: 18 }}>Send nudge email</h3>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>
              To the marina owner of <strong style={{ color: '#FFF' }}>{nudgeFor.name}</strong>
            </div>
            <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Template</label>
            <select
              value={nudgeTemplate}
              onChange={(e) => setNudgeTemplate(e.target.value)}
              style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '9px 12px', color: '#FFF', fontSize: 13, marginBottom: 24, boxSizing: 'border-box' }}
            >
              {TEMPLATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setNudgeFor(null)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '8px 18px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleSendNudge}
                disabled={busyId === nudgeFor.id}
                style={{ background: '#00D4FF', border: 'none', borderRadius: 6, padding: '8px 20px', color: '#0A2342', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                {busyId === nudgeFor.id ? 'Sending…' : 'Send nudge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Trials;
