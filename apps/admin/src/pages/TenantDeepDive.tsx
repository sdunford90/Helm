import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApiFetch } from '../lib/api';

interface Signal {
  label: string;
  unit?: string;
  series: number[];
  last: number;
  wowChangePct: number | null;
}

interface DeepDive {
  tenant: {
    id: string;
    name: string;
    subdomain: string;
    status: string;
    createdAt: string;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    assignedAdmin: { id: string; firstName: string; lastName: string; email: string } | null;
    saasTier: { id: string; name: string; monthlyFeeCents: number } | null;
    userCount: number;
    locationCount: number;
  };
  weekLabels: string[];
  signals: {
    invoicesPerWeek: Signal;
    paymentVolumePerWeek: Signal;
    newCustomersPerWeek: Signal;
    activeUsersPerWeek: Signal;
    userActivityPerWeek: Signal;
  };
  lastActivityAt: string | null;
  recentTickets: {
    id: string;
    subject: string;
    status: string;
    priority: string;
    createdAt: string;
  }[];
}

interface TimelineEvent {
  id: string;
  type: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  admin: { id: string; firstName: string; lastName: string; email: string } | null;
}

interface Tier {
  id: string;
  name: string;
  monthlyFeeCents: number;
}

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const cardTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.4)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 14,
};

const fmtCents = (c: number) =>
  (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const TYPE_ICONS: Record<string, { color: string; label: string }> = {
  nudge_sent: { color: '#00D4FF', label: 'Nudge' },
  assigned: { color: '#4CAF50', label: 'Assigned' },
  unassigned: { color: 'rgba(255,255,255,0.4)', label: 'Unassigned' },
  trial_extended: { color: '#9C27B0', label: 'Trial extended' },
  coupon_applied: { color: '#FF9800', label: 'Coupon' },
  tier_changed: { color: '#2196F3', label: 'Tier changed' },
  check_in_scheduled: { color: '#00D4FF', label: 'Check-in' },
  ticket_opened: { color: '#F44336', label: 'Ticket' },
  note: { color: 'rgba(255,255,255,0.5)', label: 'Note' },
};

const Sparkline: React.FC<{ series: number[]; color?: string }> = ({ series, color = '#00D4FF' }) => {
  if (!series.length) return null;
  const max = Math.max(...series, 1);
  const w = 220;
  const h = 50;
  const step = w / Math.max(1, series.length - 1);
  const points = series.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 50, display: 'block' }} preserveAspectRatio="none">
      <polygon points={areaPoints} fill={color} fillOpacity="0.1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {series.map((v, i) => (
        <circle key={i} cx={(i * step).toFixed(1)} cy={(h - (v / max) * h).toFixed(1)} r={i === series.length - 1 ? 3 : 1.5} fill={color} />
      ))}
    </svg>
  );
};

const SignalCard: React.FC<{ signal: Signal; isCurrency?: boolean }> = ({ signal, isCurrency }) => {
  const change = signal.wowChangePct;
  const trendColor = change === null ? 'rgba(255,255,255,0.4)' : change >= 0 ? '#4CAF50' : '#F44336';
  const sparkColor = change === null || change >= 0 ? '#00D4FF' : '#F44336';
  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{signal.label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#FFF' }}>
          {isCurrency ? fmtCents(signal.last) : signal.last.toLocaleString()}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: trendColor }}>
          {change === null ? '—' : `${change >= 0 ? '+' : ''}${change}% WoW`}
        </div>
      </div>
      <Sparkline series={signal.series} color={sparkColor} />
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>last 8 weeks</div>
    </div>
  );
};

const TenantDeepDive: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();

  const [data, setData] = useState<DeepDive | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Save-play form state
  const [extendDays, setExtendDays] = useState(14);
  const [couponCode, setCouponCode] = useState('');
  const [couponPct, setCouponPct] = useState(20);
  const [tierTarget, setTierTarget] = useState('');
  const [checkInAt, setCheckInAt] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketBody, setTicketBody] = useState('');
  const [ticketPriority, setTicketPriority] = useState('high');
  const [noteText, setNoteText] = useState('');

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [dd, tl, tiersRes] = await Promise.all([
        apiFetch<DeepDive>(`/api/admin/tenants/${id}/deep-dive`),
        apiFetch<{ items: TimelineEvent[] }>(`/api/admin/tenants/${id}/timeline`),
        apiFetch<Tier[]>(`/api/admin/billing/tiers`),
      ]);
      setData(dd);
      setTimeline(tl.items);
      setTiers(tiersRes);
      if (dd.tenant.saasTier) setTierTarget(dd.tenant.saasTier.id);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const runSavePlay = async (action: string, body: Record<string, unknown>) => {
    if (!id) return;
    setBusy(action);
    try {
      await apiFetch(`/api/admin/tenants/${id}/save-play`, {
        method: 'POST',
        body: JSON.stringify({ action, ...body }),
      });
      await fetchAll();
    } catch (e) {
      window.alert(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleAssignToMe = async () => {
    if (!id) return;
    setBusy('assign');
    try {
      await apiFetch(`/api/admin/tenants/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await fetchAll();
    } catch (e) {
      window.alert(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>Loading deep-dive…</div>;
  }
  if (error || !data) {
    return <div style={{ padding: 40, color: '#F44336' }}>{error || 'No data'}</div>;
  }

  const { tenant, signals, recentTickets, lastActivityAt } = data;
  const lastActivityDays = lastActivityAt
    ? Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 13, marginBottom: 8, padding: 0 }}
        >
          ← Back
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#FFF' }}>{tenant.name}</h1>
              <span style={{ background: 'rgba(244,67,54,0.15)', color: '#F44336', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                AT-RISK DEEP DIVE
              </span>
              <span style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                {tenant.status}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
              {tenant.subdomain}.gethelm.com · {tenant.userCount} users · {tenant.locationCount} locations
              {tenant.saasTier && ` · ${tenant.saasTier.name} (${fmtCents(tenant.saasTier.monthlyFeeCents)}/mo)`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {tenant.assignedAdmin ? (
              <div style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.3)', padding: '6px 12px', borderRadius: 6, fontSize: 12, color: '#4CAF50' }}>
                Assigned to {tenant.assignedAdmin.firstName} {tenant.assignedAdmin.lastName}
              </div>
            ) : (
              <button
                onClick={handleAssignToMe}
                disabled={busy === 'assign'}
                style={{ background: 'transparent', border: '1px solid #4CAF50', borderRadius: 6, padding: '7px 14px', color: '#4CAF50', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {busy === 'assign' ? 'Assigning…' : 'Assign to me'}
              </button>
            )}
            <button
              onClick={() => navigate(`/tenants/${tenant.id}`)}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 14px', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Tenant detail →
            </button>
          </div>
        </div>
      </div>

      {/* Activity strip */}
      <div style={{ ...card, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>Last meaningful activity</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#FFF', marginTop: 4 }}>
            {lastActivityAt ? new Date(lastActivityAt).toLocaleString() : 'No activity recorded yet'}
          </div>
        </div>
        {lastActivityDays !== null && (
          <div style={{
            fontSize: 18, fontWeight: 700,
            color: lastActivityDays > 14 ? '#F44336' : lastActivityDays > 7 ? '#FF9800' : '#4CAF50',
          }}>
            {lastActivityDays === 0 ? 'today' : `${lastActivityDays}d ago`}
          </div>
        )}
      </div>

      {/* Sparklines — 5 signals across two rows */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 20 }}>
        <SignalCard signal={signals.activeUsersPerWeek} />
        <SignalCard signal={signals.userActivityPerWeek} />
        <SignalCard signal={signals.invoicesPerWeek} />
        <SignalCard signal={signals.paymentVolumePerWeek} isCurrency />
        <SignalCard signal={signals.newCustomersPerWeek} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Save Play panel */}
        <div style={card}>
          <div style={cardTitle}>Save Play — quick actions</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Extend trial */}
            <div style={{ paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#FFF' }}>Extend trial</span>
                <input
                  type="number" min={1} max={60} value={extendDays}
                  onChange={(e) => setExtendDays(Math.max(1, Math.min(60, parseInt(e.target.value) || 14)))}
                  style={{ background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12, width: 56 }}
                />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>days</span>
                <button
                  onClick={() => runSavePlay('extend_trial', { days: extendDays })}
                  disabled={!!busy}
                  style={{ background: '#9C27B0', border: 'none', borderRadius: 4, padding: '5px 12px', color: '#FFF', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Apply coupon */}
            <div style={{ paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#FFF', marginBottom: 8 }}>Apply coupon</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  placeholder="CODE"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  style={{ flex: 1, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12 }}
                />
                <input
                  type="number" min={1} max={100} value={couponPct}
                  onChange={(e) => setCouponPct(Math.max(1, Math.min(100, parseInt(e.target.value) || 20)))}
                  style={{ background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12, width: 48 }}
                />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>%</span>
                <button
                  onClick={() => runSavePlay('apply_coupon', { code: couponCode, percentOff: couponPct })}
                  disabled={!!busy || !couponCode}
                  style={{ background: '#FF9800', border: 'none', borderRadius: 4, padding: '5px 12px', color: '#FFF', fontSize: 11, fontWeight: 600, cursor: couponCode ? 'pointer' : 'not-allowed', opacity: couponCode ? 1 : 0.5 }}
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Change tier */}
            <div style={{ paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#FFF', marginBottom: 8 }}>Change plan</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={tierTarget}
                  onChange={(e) => setTierTarget(e.target.value)}
                  style={{ flex: 1, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12 }}
                >
                  <option value="">— Select tier —</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} — {fmtCents(t.monthlyFeeCents)}/mo</option>
                  ))}
                </select>
                <button
                  onClick={() => runSavePlay('change_tier', { tierId: tierTarget })}
                  disabled={!!busy || !tierTarget}
                  style={{ background: '#2196F3', border: 'none', borderRadius: 4, padding: '5px 12px', color: '#FFF', fontSize: 11, fontWeight: 600, cursor: tierTarget ? 'pointer' : 'not-allowed', opacity: tierTarget ? 1 : 0.5 }}
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Schedule check-in */}
            <div style={{ paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#FFF', marginBottom: 8 }}>Schedule check-in</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="datetime-local"
                  value={checkInAt}
                  onChange={(e) => setCheckInAt(e.target.value)}
                  style={{ flex: 1, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12 }}
                />
                <button
                  onClick={() => runSavePlay('schedule_check_in', { scheduledAt: new Date(checkInAt).toISOString() })}
                  disabled={!!busy || !checkInAt}
                  style={{ background: '#00D4FF', border: 'none', borderRadius: 4, padding: '5px 12px', color: '#0A2342', fontSize: 11, fontWeight: 700, cursor: checkInAt ? 'pointer' : 'not-allowed', opacity: checkInAt ? 1 : 0.5 }}
                >
                  Schedule
                </button>
              </div>
            </div>

            {/* Open ticket */}
            <div style={{ paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#FFF', marginBottom: 8 }}>Open support ticket</div>
              <input
                placeholder="Subject"
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12, marginBottom: 6, boxSizing: 'border-box' }}
              />
              <textarea
                placeholder="Description"
                value={ticketBody}
                onChange={(e) => setTicketBody(e.target.value)}
                rows={2}
                style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12, marginBottom: 6, boxSizing: 'border-box', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value)}
                  style={{ background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12 }}
                >
                  {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button
                  onClick={() => runSavePlay('open_ticket', { subject: ticketSubject, description: ticketBody, priority: ticketPriority })}
                  disabled={!!busy || !ticketSubject || !ticketBody}
                  style={{ flex: 1, background: '#F44336', border: 'none', borderRadius: 4, padding: '5px 12px', color: '#FFF', fontSize: 11, fontWeight: 600, cursor: (ticketSubject && ticketBody) ? 'pointer' : 'not-allowed', opacity: (ticketSubject && ticketBody) ? 1 : 0.5 }}
                >
                  Open ticket
                </button>
              </div>
            </div>

            {/* Quick note */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#FFF', marginBottom: 8 }}>Add note</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  placeholder="Quick context for the timeline…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  style={{ flex: 1, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '5px 8px', color: '#FFF', fontSize: 12 }}
                />
                <button
                  onClick={async () => {
                    await runSavePlay('note', { note: noteText });
                    setNoteText('');
                  }}
                  disabled={!!busy || !noteText}
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '5px 12px', color: '#FFF', fontSize: 11, fontWeight: 600, cursor: noteText ? 'pointer' : 'not-allowed', opacity: noteText ? 1 : 0.5 }}
                >
                  Log
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Recent tickets */}
        <div style={card}>
          <div style={cardTitle}>Recent support tickets</div>
          {recentTickets.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: 20, textAlign: 'center' }}>
              No support tickets in this tenant.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentTickets.map((t) => (
                <div key={t.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: '#FFF', fontWeight: 500 }}>{t.subject}</span>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 8, fontWeight: 600,
                      background: t.priority === 'urgent' || t.priority === 'high' ? 'rgba(244,67,54,0.15)' : 'rgba(33,150,243,0.15)',
                      color: t.priority === 'urgent' || t.priority === 'high' ? '#F44336' : '#2196F3',
                    }}>{t.priority.toUpperCase()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                    <span>{t.status}</span>
                    <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity timeline */}
      <div style={card}>
        <div style={cardTitle}>Tenant activity timeline</div>
        {timeline.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            No activity logged yet. Save-play actions and nudges will appear here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {timeline.map((e, i) => {
              const cfg = TYPE_ICONS[e.type] ?? { color: 'rgba(255,255,255,0.5)', label: e.type };
              return (
                <div key={e.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: i < timeline.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, marginTop: 6, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{cfg.label}</span>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#FFF', marginTop: 3 }}>{e.summary}</div>
                    {e.admin && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                        by {e.admin.firstName} {e.admin.lastName}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantDeepDive;
