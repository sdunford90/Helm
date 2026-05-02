import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Lock, Unlock, Calendar, Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

// Matches the on-disk AccountingPeriod row shape exactly. The API returns the
// raw Prisma fields (periodStart / periodEnd / closedAt) — there is no `name`
// or `status` column. We derive a friendly label and an OPEN/CLOSED status
// badge from those fields on the client.
interface RawAccountingPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  closedAt: string | null;
  closedByUserId: string | null;
  notes: string | null;
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '0', overflow: 'hidden' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: '#F8FAFC' },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'middle' as const },
  badge: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 } as React.CSSProperties,
  actionBtn: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, border: '1px solid #E2E8F0', borderRadius: '5px', cursor: 'pointer', backgroundColor: '#F8FAFC', color: '#0A2342' } as React.CSSProperties,
  addBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '10px', width: '440px', maxWidth: '90vw', boxShadow: '0 25px 60px rgba(0,0,0,0.18)' },
  modalHeader: { padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalBody: { padding: '24px', display: 'grid', gap: '12px' } as React.CSSProperties,
  modalFooter: { padding: '16px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '8px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  label: { fontSize: '12px', fontWeight: 600, color: '#475569' } as React.CSSProperties,
  input: { padding: '10px 12px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '14px', color: '#0A2342' } as React.CSSProperties,
  cancelBtn: { background: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function periodLabel(p: RawAccountingPeriod): string {
  const start = new Date(p.periodStart);
  const end = new Date(p.periodEnd);
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) {
    return start.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });
  }
  return `${start.toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' })} – ${end.toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' })}`;
}

function statusBadge(closedAt: string | null): React.ReactNode {
  if (!closedAt) {
    return <span style={{ ...stl.badge, background: '#DCFCE7', color: '#15803D' }}>Open</span>;
  }
  return <span style={{ ...stl.badge, background: '#FEF3C7', color: '#92400E' }}><Lock size={10} /> Closed</span>;
}

// Returns YYYY-MM-DD strings for the first and last day of the given offset
// month (0 = current month, -1 = previous month, etc), in UTC so the dates
// match what the API stores without TZ slippage.
function monthRange(monthOffset: number): { start: string; end: string; label: string } {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  const startStr = target.toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0));
  const endStr = endDate.toISOString().slice(0, 10);
  const label = target.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });
  return { start: startStr, end: endStr, label };
}

interface CreatePeriodModalProps {
  onClose: () => void;
  onSave: (payload: { periodStart: string; periodEnd: string; notes: string | null }) => Promise<void>;
}

function CreatePeriodModal({ onClose, onSave }: CreatePeriodModalProps) {
  // Default to the previous month — the most common case for "I just want to
  // close last month so it's locked from edits."
  const lastMonth = monthRange(-1);
  const [start, setStart] = useState(lastMonth.start);
  const [end, setEnd] = useState(lastMonth.end);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyPreset = (offset: number) => {
    const r = monthRange(offset);
    setStart(r.start);
    setEnd(r.end);
  };

  const handleSave = async () => {
    if (!start || !end) {
      setErr('Both dates are required.');
      return;
    }
    if (new Date(end) < new Date(start)) {
      setErr('End date must be on or after start date.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        periodStart: new Date(`${start}T00:00:00Z`).toISOString(),
        periodEnd: new Date(`${end}T23:59:59Z`).toISOString(),
        notes: notes.trim() || null,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create period');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={stl.overlay} onClick={onClose}>
      <div style={stl.modal} onClick={(e) => e.stopPropagation()}>
        <div style={stl.modalHeader}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Create Accounting Period</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={stl.modalBody}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const }}>
            <button style={{ ...stl.actionBtn, fontSize: '11px' }} type="button" onClick={() => applyPreset(-1)}>Last month</button>
            <button style={{ ...stl.actionBtn, fontSize: '11px' }} type="button" onClick={() => applyPreset(0)}>This month</button>
            <button style={{ ...stl.actionBtn, fontSize: '11px' }} type="button" onClick={() => applyPreset(-2)}>2 months ago</button>
          </div>
          <div style={stl.field}>
            <label style={stl.label}>Start Date</label>
            <input style={stl.input} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div style={stl.field}>
            <label style={stl.label}>End Date</label>
            <input style={stl.input} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div style={stl.field}>
            <label style={stl.label}>Notes (optional)</label>
            <input style={stl.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Q1 close, audit prep" />
          </div>
          {err && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#B91C1C', fontSize: '13px' }}>
              <AlertTriangle size={14} /> {err}
            </div>
          )}
        </div>
        <div style={stl.modalFooter}>
          <button style={stl.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={stl.addBtn} onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Creating…' : 'Create Period'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PeriodManagementPanel() {
  const { currentLocationId } = useModules();
  const [periods, setPeriods] = useState<RawAccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const r = await api.get<{ data: RawAccountingPeriod[] }>(
        `/api/accounting/periods?locationId=${encodeURIComponent(currentLocationId)}`,
      );
      setPeriods(r.data ?? []);
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 501) {
        setUnavailable(true);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load periods');
      }
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (payload: { periodStart: string; periodEnd: string; notes: string | null }) => {
    if (!currentLocationId) throw new Error('Pick a location first.');
    await api.post('/api/accounting/periods', {
      locationId: currentLocationId,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      notes: payload.notes,
    });
    setShowCreate(false);
    await load();
  };

  const handleClose = async (periodId: string) => {
    if (!confirm('Close this accounting period? This will prevent further edits to transactions within it.')) return;
    setBusy(periodId);
    try {
      // Backend route is PATCH, not POST — using POST returns 404 and the
      // close button silently fails for the operator.
      await api.patch(`/api/accounting/periods/${periodId}/close`);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Close failed');
    } finally {
      setBusy(null);
    }
  };

  const handleReopen = async (periodId: string) => {
    if (!confirm('Reopen this accounting period?')) return;
    setBusy(periodId);
    try {
      await api.patch(`/api/accounting/periods/${periodId}/reopen`);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Reopen failed');
    } finally {
      setBusy(null);
    }
  };

  if (!currentLocationId) {
    return <div style={{ padding: '24px', color: '#64748B', fontSize: '14px' }}>Select a location to manage accounting periods.</div>;
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><Calendar size={16} /> Loading periods…</div>;
  }

  if (unavailable) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
        <Calendar size={32} style={{ margin: '0 auto 12px', display: 'block', color: '#CBD5E1' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>Period Management coming soon</div>
        <div style={{ fontSize: '13px', marginTop: '4px' }}>
          Fiscal period management is not yet available. Check back after the next deployment.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
        <AlertTriangle size={16} /> {error}
      </div>
    );
  }

  const openCount = periods.filter((p) => !p.closedAt).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', color: '#64748B' }}>
          {periods.length} fiscal period{periods.length !== 1 ? 's' : ''} · {openCount} open
        </div>
        <button style={stl.addBtn} onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Create Period
        </button>
      </div>

      {periods.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8', fontSize: '14px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          No accounting periods configured yet. Use “Create Period” above to add a month for closing.
        </div>
      ) : (
        <div style={stl.card}>
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Period</th>
                <th style={stl.th}>Dates</th>
                <th style={stl.th}>Status</th>
                <th style={stl.th}>Closed</th>
                <th style={stl.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...stl.td, fontWeight: 600 }}>{periodLabel(p)}</td>
                  <td style={{ ...stl.td, fontSize: '12px', color: '#475569' }}>
                    {fmtDate(p.periodStart)} — {fmtDate(p.periodEnd)}
                  </td>
                  <td style={stl.td}>{statusBadge(p.closedAt)}</td>
                  <td style={{ ...stl.td, fontSize: '12px', color: '#64748B' }}>
                    {p.closedAt ? fmtDate(p.closedAt) : '—'}
                  </td>
                  <td style={stl.td}>
                    {!p.closedAt ? (
                      <button
                        style={{ ...stl.actionBtn, color: '#92400E', borderColor: '#FDE68A', background: '#FFFBEB' }}
                        onClick={() => void handleClose(p.id)}
                        disabled={busy === p.id}
                      >
                        <Lock size={12} /> {busy === p.id ? '…' : 'Close Period'}
                      </button>
                    ) : (
                      <button
                        style={stl.actionBtn}
                        onClick={() => void handleReopen(p.id)}
                        disabled={busy === p.id}
                      >
                        <Unlock size={12} /> {busy === p.id ? '…' : 'Reopen'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreatePeriodModal
          onClose={() => setShowCreate(false)}
          onSave={handleCreate}
        />
      )}
    </div>
  );
}
