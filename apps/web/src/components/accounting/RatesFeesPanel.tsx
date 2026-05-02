import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Save } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  locationId?: string | null;
}

interface DockageRate {
  id: string;
  locationId: string;
  slipType: string;
  monthlyRateCents: number;
  glAccountId: string | null;
  active: boolean;
  location: { name: string };
}

interface ServiceFee {
  id: string;
  locationId: string;
  name: string;
  feeType: string;
  amountCents: number | null;
  pct: number | null;
  glAccountId: string | null;
  active: boolean;
  location: { name: string };
}

interface ProductsSummary {
  dockageRates: DockageRate[];
  serviceFees: ServiceFee[];
  glAccounts: GlAccount[];
}

// Per-location GL mapping endpoint shape:
//   { locationId, locationName, qboConnected,
//     override:  { glAccountId },
//     effective: { glAccountId } }
interface SingleGlMappingRow {
  locationId: string;
  locationName: string;
  qboConnected: boolean;
  override?: { glAccountId: string | null };
  effective?: { glAccountId: string | null };
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px', marginBottom: '16px' } as React.CSSProperties,
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342', marginBottom: '12px' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: '#F8FAFC' },
  td: { padding: '10px 12px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'middle' as const },
  select: { padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', color: '#0A2342', background: '#FFFFFF', minWidth: '220px' } as React.CSSProperties,
  saveBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' } as React.CSSProperties,
  label: { fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' } as React.CSSProperties,
};

function fmtCents(c: number | null | undefined) {
  if (c == null) return '—';
  return `$${(c / 100).toFixed(2)}`;
}

export default function RatesFeesPanel() {
  const { currentLocationId } = useModules();
  const [data, setData] = useState<ProductsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dockageGl, setDockageGl] = useState<Record<string, string | null>>({});
  const [serviceFeeGl, setServiceFeeGl] = useState<Record<string, string | null>>({});
  const [savingDockage, setSavingDockage] = useState<string | null>(null);
  const [savingFee, setSavingFee] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // The catalog summary returns { data: { dockageRates, serviceFees,
      // glAccounts, ... } } — a `{ data }` envelope wrapping the payload.
      // Each row is pre-overlaid with its effective per-location GL
      // mapping in `glAccountId`. Earlier this read `r.dockageRates`
      // directly off the envelope (always undefined), so the panel
      // reported "No dockage rates configured" even when the tenant had
      // several active rates. Unwrap `.data` so the row arrays surface.
      const r = await api.get<{ data: ProductsSummary }>(
        `/api/settings/catalog/products-summary?locationId=${encodeURIComponent(currentLocationId)}`,
      );
      const payload = r.data;
      setData(payload);
      const dGl: Record<string, string | null> = {};
      (payload.dockageRates ?? []).forEach((d) => { dGl[d.id] = d.glAccountId; });
      setDockageGl(dGl);

      const fGl: Record<string, string | null> = {};
      (payload.serviceFees ?? []).forEach((f) => { fGl[f.id] = f.glAccountId; });
      setServiceFeeGl(fGl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const saveDockageGl = async (rateId: string) => {
    if (!currentLocationId) return;
    setSavingDockage(rateId);
    try {
      // Real route is the per-location GL-mapping endpoint, not
      // /api/settings/dockage-rates/:id/gl (which 404s).
      await api.put<{ data: SingleGlMappingRow }>(
        `/api/settings/catalog/dockage-rates/${rateId}/gl-mappings/${currentLocationId}`,
        { glAccountId: dockageGl[rateId] || null },
      );
      // Reflect saved value in local state so the "Save" button hides.
      setData((prev) => prev ? {
        ...prev,
        dockageRates: prev.dockageRates.map((d) =>
          d.id === rateId ? { ...d, glAccountId: dockageGl[rateId] || null } : d,
        ),
      } : prev);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingDockage(null);
    }
  };

  const saveServiceFeeGl = async (feeId: string) => {
    if (!currentLocationId) return;
    setSavingFee(feeId);
    try {
      await api.put<{ data: SingleGlMappingRow }>(
        `/api/settings/catalog/service-fees/${feeId}/gl-mappings/${currentLocationId}`,
        { glAccountId: serviceFeeGl[feeId] || null },
      );
      setData((prev) => prev ? {
        ...prev,
        serviceFees: prev.serviceFees.map((f) =>
          f.id === feeId ? { ...f, glAccountId: serviceFeeGl[feeId] || null } : f,
        ),
      } : prev);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingFee(null);
    }
  };

  if (!currentLocationId) {
    return (
      <div style={stl.card}>
        <div style={{ color: '#64748B', fontSize: '14px' }}>Select a location to manage GL mappings for rates and fees.</div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px' }}>Loading rates and fees…</div>;
  }

  if (error) {
    return (
      <div style={{ ...stl.card, border: '1px solid #FECACA', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
          <AlertTriangle size={16} /> {error}
        </div>
      </div>
    );
  }

  const glAccounts = (data?.glAccounts ?? []).filter(
    (a) => a.type === 'REVENUE' || a.type === 'INCOME',
  );
  const dockageRates = (data?.dockageRates ?? []).filter((d) => d.locationId === currentLocationId);
  const serviceFees = (data?.serviceFees ?? []).filter((f) => f.locationId === currentLocationId);

  return (
    <div>
      {/* Dockage Rates GL */}
      <div style={stl.card}>
        <div style={stl.sectionTitle}>Dockage Rates — Revenue GL</div>
        {dockageRates.length === 0 ? (
          <div style={{ color: '#94A3B8', fontSize: '13px' }}>No dockage rates configured for this location.</div>
        ) : (
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Slip Type</th>
                <th style={stl.th}>Monthly Rate</th>
                <th style={stl.th}>Revenue GL Account</th>
                <th style={stl.th}></th>
              </tr>
            </thead>
            <tbody>
              {dockageRates.map((rate) => {
                const currentVal = dockageGl[rate.id] ?? '';
                const originalVal = rate.glAccountId ?? '';
                const dirty = currentVal !== originalVal;

                return (
                  <tr key={rate.id}>
                    <td style={{ ...stl.td, fontWeight: 600 }}>{rate.slipType}</td>
                    <td style={stl.td}>{fmtCents(rate.monthlyRateCents)} / mo</td>
                    <td style={stl.td}>
                      <select
                        style={stl.select}
                        value={currentVal}
                        disabled={savingDockage === rate.id}
                        onChange={(e) => setDockageGl((prev) => ({ ...prev, [rate.id]: e.target.value || null }))}
                      >
                        <option value="">— Not mapped —</option>
                        {glAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.accountNumber} · {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...stl.td, textAlign: 'right' as const }}>
                      {dirty && (
                        <button style={stl.saveBtn} onClick={() => void saveDockageGl(rate.id)} disabled={savingDockage === rate.id}>
                          <Save size={12} /> {savingDockage === rate.id ? '…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Service Fees GL */}
      <div style={stl.card}>
        <div style={stl.sectionTitle}>Service Fees — Revenue GL</div>
        {serviceFees.length === 0 ? (
          <div style={{ color: '#94A3B8', fontSize: '13px' }}>No service fees configured for this location.</div>
        ) : (
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Fee Name</th>
                <th style={stl.th}>Type</th>
                <th style={stl.th}>Amount</th>
                <th style={stl.th}>Revenue GL Account</th>
                <th style={stl.th}></th>
              </tr>
            </thead>
            <tbody>
              {serviceFees.map((fee) => {
                const currentVal = serviceFeeGl[fee.id] ?? '';
                const originalVal = fee.glAccountId ?? '';
                const dirty = currentVal !== originalVal;

                return (
                  <tr key={fee.id}>
                    <td style={{ ...stl.td, fontWeight: 600 }}>{fee.name}</td>
                    <td style={stl.td}>{fee.feeType}</td>
                    <td style={stl.td}>
                      {fee.amountCents != null ? fmtCents(fee.amountCents) : fee.pct != null ? `${fee.pct}%` : '—'}
                    </td>
                    <td style={stl.td}>
                      <select
                        style={stl.select}
                        value={currentVal}
                        disabled={savingFee === fee.id}
                        onChange={(e) => setServiceFeeGl((prev) => ({ ...prev, [fee.id]: e.target.value || null }))}
                      >
                        <option value="">— Not mapped —</option>
                        {glAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.accountNumber} · {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...stl.td, textAlign: 'right' as const }}>
                      {dirty && (
                        <button style={stl.saveBtn} onClick={() => void saveServiceFeeGl(fee.id)} disabled={savingFee === fee.id}>
                          <Save size={12} /> {savingFee === fee.id ? '…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Cash & Other Fees placeholder */}
      <div style={stl.card}>
        <div style={stl.sectionTitle}>Cash & Other Fees</div>
        <div style={{ color: '#94A3B8', fontSize: '13px' }}>
          Cash drawer and convenience fee accounts are configured in the Posting Accounts step (Bank Account Operating slot).
        </div>
      </div>
    </div>
  );
}
