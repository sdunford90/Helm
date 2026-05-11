// Z-Reports list + manager Z-out reconciliation page (Task #320).
//
// Three things live here so a manager can do their entire end-of-day in
// one place:
//   1. "Pending Z-out" — every CLOSED shift that hasn't been reconciled
//      yet (one row per shift). Each row opens a Run Z-out modal that
//      previews the X-report and posts /api/pos/shifts/:id/z-out.
//   2. Filterable history of locked Z-reports (date range, location,
//      cashier). Headline strip shows totals across the visible rows.
//   3. Per-row print + email actions on the locked Z-reports so a
//      manager can re-send a copy to accounting without opening detail.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import {
  ChevronRight,
  Receipt,
  AlertTriangle,
  Mail,
  Eye,
  Lock,
  Loader2,
  X as XIcon,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { formatCents, formatDate } from '../lib/format';
import type { PosZOutSnapshot } from '@helm/shared-types';

interface ZReportRow {
  id: string;
  locationId: string | null;
  shiftId: string;
  zNumber: number;
  generatedAt: string;
  glJournalId: string | null;
  grossSalesCents: number;
  netSalesCents: number;
  taxCents: number;
  tipsCents: number;
  totalCents: number;
  cashExpectedCents: number;
  cashCountedCents: number;
  cashVarianceCents: number;
  shift?: { cashierId: string; openedAt: string; closedAt: string | null } | null;
}

interface PendingShift {
  id: string;
  locationId: string | null;
  cashierId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloatCents: number;
  closingCashCents: number | null;
  declaredCheckCents: number;
  declaredOtherCents: number;
  paidOutsCents: number;
}

interface LocationLite {
  id: string;
  name: string;
}

const NAVY = '#0A2342';
const styles: Record<string, React.CSSProperties> = {
  page: { padding: 32 },
  title: { fontSize: 36, fontWeight: 700, color: NAVY, letterSpacing: '-0.02em', margin: 0 },
  divider: {
    height: 4,
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: 12,
    marginBottom: 32,
    borderRadius: 2,
  },
  filters: { display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: { padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 14, minWidth: 160 },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    textAlign: 'left',
    padding: '12px 16px',
    backgroundColor: '#F8FAFC',
    color: '#475569',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #E2E8F0',
  },
  td: {
    padding: '14px 16px',
    borderBottom: '1px solid #F1F5F9',
    color: NAVY,
    fontVariantNumeric: 'tabular-nums',
  },
  empty: { padding: 48, textAlign: 'center', color: '#64748B' },
  varianceOk: { color: '#059669', fontWeight: 600 },
  varianceBad: { color: '#DC2626', fontWeight: 600 },
  zPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: NAVY,
    color: '#fff',
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  iconBtn: {
    background: 'transparent',
    border: '1px solid #CBD5E1',
    borderRadius: 6,
    padding: '4px 8px',
    cursor: 'pointer',
    color: NAVY,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
  },
  primaryBtn: {
    padding: '8px 14px',
    background: NAVY,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  pendingHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 700,
    color: '#92400E',
    background: '#FEF3C7',
    padding: '12px 16px',
    borderBottom: '1px solid #FDE68A',
  },
};

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default function ZReports() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthAgo = useMemo(
    () => new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    [],
  );
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);
  const [locationId, setLocationId] = useState('');
  const [cashierId, setCashierId] = useState('');

  const qs = new URLSearchParams();
  if (dateFrom) qs.set('dateFrom', dateFrom);
  if (dateTo) qs.set('dateTo', dateTo);
  if (locationId) qs.set('locationId', locationId);
  if (cashierId) qs.set('cashierId', cashierId);
  qs.set('take', '100');

  const { data, loading, error, execute: refresh } = useApi<{
    data: ZReportRow[];
    pagination: { skip: number; take: number; total: number };
  }>('get', `/api/pos/z-reports?${qs.toString()}`, { immediate: true });

  const { data: pendingData, execute: refreshPending } = useApi<{ data: PendingShift[] }>(
    'get',
    '/api/pos/shifts/pending-zout',
    { immediate: true },
  );

  const { data: locationsData } = useApi<{ data: LocationLite[] } | LocationLite[]>(
    'get',
    '/api/locations',
    { immediate: true },
  );
  const locations: LocationLite[] = useMemo(() => {
    const raw = locationsData as { data?: LocationLite[] } | LocationLite[] | null;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return Array.isArray(raw.data) ? raw.data : [];
  }, [locationsData]);
  const locationName = (id: string | null): string => {
    if (!id) return 'All locations';
    return locations.find((l) => l.id === id)?.name ?? id.slice(0, 8);
  };

  const rows = data?.data ?? [];
  const pending = pendingData?.data ?? [];

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.gross += r.grossSalesCents;
          acc.net += r.netSalesCents;
          acc.tax += r.taxCents;
          acc.total += r.totalCents;
          acc.variance += r.cashVarianceCents;
          return acc;
        },
        { gross: 0, net: 0, tax: 0, total: 0, variance: 0 },
      ),
    [rows],
  );

  // Re-email row action — opens an inline prompt rather than the full
  // detail page so a manager can fire off a copy in one click.
  const { getToken } = useAuth();
  const [emailingRowId, setEmailingRowId] = useState<string | null>(null);
  const [rowEmailMsg, setRowEmailMsg] = useState<{ id: string; kind: 'ok' | 'err'; text: string } | null>(null);
  const sendRowEmail = async (row: ZReportRow) => {
    // Empty input → server falls back to the location's configured
    // Z-report distribution list. Lets a manager fire off the configured
    // send in one click without re-typing addresses every night.
    const to = window.prompt(
      `Email Z #${row.zNumber} to (leave blank to use configured distribution list):`,
      '',
    );
    if (to === null) return; // cancel
    setEmailingRowId(row.id);
    setRowEmailMsg(null);
    try {
      const token = await getToken();
      const body: { to?: string } = {};
      if (to.trim()) body.to = to.trim();
      await api.post(`/api/pos/z-reports/${row.id}/email`, body, token);
      setRowEmailMsg({
        id: row.id,
        kind: 'ok',
        text: to.trim() ? `Sent to ${to.trim()}` : 'Sent to configured list',
      });
    } catch (err) {
      setRowEmailMsg({
        id: row.id,
        kind: 'err',
        text: (err as Error).message ?? 'Failed to send email',
      });
    } finally {
      setEmailingRowId(null);
    }
  };

  // Run Z-out modal state.
  const [reconcileShift, setReconcileShift] = useState<PendingShift | null>(null);
  const onZoutCommitted = () => {
    setReconcileShift(null);
    refresh();
    refreshPending();
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Z-Reports</h1>
      <hr style={styles.divider} />

      {/* Pending Z-out — manager landing list. Hidden when nothing is
          waiting so the page doesn't carry empty visual weight. */}
      {pending.length > 0 && (
        <div style={{ ...styles.card, marginBottom: 24, borderColor: '#FDE68A' }}>
          <div style={styles.pendingHeader}>
            <AlertTriangle size={16} />
            {pending.length} shift{pending.length === 1 ? '' : 's'} awaiting Z-out
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Cashier</th>
                <th style={styles.th}>Location</th>
                <th style={styles.th}>Closed</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Counted cash</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Declared check</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Paid-outs</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id}>
                  <td style={styles.td}>{p.cashierId.slice(0, 8)}</td>
                  <td style={styles.td}>{locationName(p.locationId)}</td>
                  <td style={styles.td}>{p.closedAt ? formatDate(p.closedAt) : '—'}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {p.closingCashCents != null ? formatCents(p.closingCashCents) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {formatCents(p.declaredCheckCents)}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {formatCents(p.paidOutsCents)}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <a
                      href={`/pos/x-report/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ ...styles.iconBtn, marginRight: 8, textDecoration: 'none' }}
                    >
                      <Eye size={12} /> Preview
                    </a>
                    <button
                      style={{ ...styles.primaryBtn, padding: '6px 12px', fontSize: 13 }}
                      onClick={() => setReconcileShift(p)}
                    >
                      <Lock size={12} style={{ marginRight: 4, verticalAlign: -1 }} /> Run Z-out
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      <div style={styles.filters}>
        <div style={styles.field}>
          <label style={styles.label}>From</label>
          <input
            style={styles.input}
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>To</label>
          <input
            style={styles.input}
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        {locations.length > 1 && (
          <div style={styles.field}>
            <label style={styles.label}>Location</label>
            <select
              style={styles.input}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={styles.field}>
          <label style={styles.label}>Cashier ID</label>
          <input
            style={styles.input}
            type="text"
            placeholder="user id (optional)"
            value={cashierId}
            onChange={(e) => setCashierId(e.target.value)}
          />
        </div>
        <div style={{ ...styles.field, marginLeft: 'auto', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 13, color: '#64748B' }}>
            {loading ? 'Loading…' : `${rows.length} report${rows.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {/* Headline strip */}
      {rows.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {[
            { label: 'Gross sales', v: totals.gross },
            { label: 'Net sales', v: totals.net },
            { label: 'Tax', v: totals.tax },
            { label: 'Grand total', v: totals.total },
            { label: 'Net variance', v: totals.variance, variance: true },
          ].map((c) => (
            <div
              key={c.label}
              style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: 14 }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#64748B',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {c.label}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 4,
                  fontVariantNumeric: 'tabular-nums',
                  color: c.variance
                    ? c.v === 0
                      ? '#059669'
                      : c.v > 0
                        ? '#059669'
                        : '#DC2626'
                    : NAVY,
                }}
              >
                {c.variance && c.v >= 0 ? '+' : ''}
                {formatCents(c.v)}
              </div>
            </div>
          ))}
        </div>
      )}

      {error ? (
        <div style={{ padding: 16, background: '#FEE2E2', borderRadius: 6, color: '#991B1B' }}>
          {(error as unknown as Error)?.message ?? String(error) ?? 'Failed to load Z-reports'}
        </div>
      ) : (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Z #</th>
                <th style={styles.th}>Generated</th>
                <th style={styles.th}>Location</th>
                <th style={styles.th}>Cashier</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Net sales</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Tax</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Total</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Cash variance</th>
                <th style={styles.th}>GL</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td style={styles.empty} colSpan={10}>
                    <Receipt size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                    <div>No Z-reports in this date range yet.</div>
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={styles.td}>
                    <Link to={`/pos/z-reports/${r.id}`} style={{ textDecoration: 'none' }}>
                      <span style={styles.zPill}>
                        <Receipt size={12} />Z #{r.zNumber}
                      </span>
                    </Link>
                  </td>
                  <td style={styles.td}>{formatDate(r.generatedAt)}</td>
                  <td style={styles.td}>{locationName(r.locationId)}</td>
                  <td style={styles.td}>
                    {r.shift?.cashierId ? r.shift.cashierId.slice(0, 8) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{formatCents(r.netSalesCents)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{formatCents(r.taxCents)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>
                    {formatCents(r.totalCents)}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: 'right',
                      ...(r.cashVarianceCents === 0 ? styles.varianceOk : styles.varianceBad),
                    }}
                  >
                    {r.cashVarianceCents !== 0 && (
                      <AlertTriangle
                        size={12}
                        style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }}
                      />
                    )}
                    {r.cashVarianceCents >= 0 ? '+' : ''}
                    {formatCents(r.cashVarianceCents)}
                  </td>
                  <td style={styles.td}>
                    {r.glJournalId ? (
                      <span style={{ fontSize: 12, color: '#059669' }}>Posted</span>
                    ) : (
                      <span style={{ fontSize: 12, color: '#94A3B8' }}>—</span>
                    )}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      style={styles.iconBtn}
                      title="Email Z-report"
                      disabled={emailingRowId === r.id}
                      onClick={() => sendRowEmail(r)}
                    >
                      {emailingRowId === r.id ? (
                        <Loader2 size={12} className="spin" />
                      ) : (
                        <Mail size={12} />
                      )}
                      Email
                    </button>{' '}
                    <Link
                      to={`/pos/z-reports/${r.id}`}
                      style={{ ...styles.iconBtn, textDecoration: 'none' }}
                      title="Open / print"
                    >
                      Open <ChevronRight size={12} />
                    </Link>
                    {rowEmailMsg && rowEmailMsg.id === r.id && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: rowEmailMsg.kind === 'ok' ? '#059669' : '#DC2626',
                        }}
                      >
                        {rowEmailMsg.text}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reconcileShift && (
        <RunZoutModal
          shift={reconcileShift}
          locationName={locationName(reconcileShift.locationId)}
          onClose={() => setReconcileShift(null)}
          onCommitted={onZoutCommitted}
        />
      )}
    </div>
  );
}

// ── Run Z-out modal ────────────────────────────────────────────────────────
// Loads the X-report preview, lets the manager override the counted cash
// and add a note, then POSTs /api/pos/shifts/:id/z-out. On success the
// caller refreshes the lists and the modal flashes the assigned Z #.
function RunZoutModal({
  shift,
  locationName,
  onClose,
  onCommitted,
}: {
  shift: PendingShift;
  locationName: string;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const { getToken } = useAuth();
  const { data: preview, loading: previewLoading, error: previewError } = useApi<{
    snapshot: PosZOutSnapshot;
    shiftStatus: string;
  }>('get', `/api/pos/shifts/${shift.id}/x-report`, { immediate: true });

  const initialCounted = (shift.closingCashCents ?? 0) / 100;
  const [counted, setCounted] = useState<string>(initialCounted.toFixed(2));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ zNumber: number; id: string } | null>(null);

  const expectedCents = preview?.snapshot.cashDrawer.expectedCents ?? 0;
  const countedCents = Math.round(parseFloat(counted || '0') * 100);
  const variance = countedCents - expectedCents;

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await getToken();
      const result = await api.post<{ id: string; zNumber: number }>(
        `/api/pos/shifts/${shift.id}/z-out`,
        {
          countedCashCents: countedCents,
          notes: notes.trim() || undefined,
        },
        token,
      );
      setSuccess({ zNumber: result.zNumber, id: result.id });
    } catch (err) {
      // Surface 409 / validation errors verbatim — they're user-facing.
      setSubmitError((err as Error).message ?? 'Failed to commit Z-out');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 24,
          color: NAVY,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Run Z-out</h2>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            aria-label="Close"
          >
            <XIcon size={20} color="#64748B" />
          </button>
        </div>

        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
          {locationName} · Cashier {shift.cashierId.slice(0, 8)} · Closed{' '}
          {shift.closedAt ? new Date(shift.closedAt).toLocaleString() : '—'}
        </div>

        {success ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 14, color: '#065F46', fontWeight: 600, marginBottom: 8 }}>
              Z-out committed
            </div>
            <div style={{ ...styles.zPill, fontSize: 14, padding: '6px 14px' }}>
              <Receipt size={14} /> Z #{success.zNumber}
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Link
                to={`/pos/z-reports/${success.id}`}
                style={{ ...styles.iconBtn, textDecoration: 'none' }}
              >
                Open Z-report
              </Link>
              <button style={styles.primaryBtn} onClick={onCommitted}>
                Done
              </button>
            </div>
          </div>
        ) : previewLoading ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Loader2 size={20} className="spin" />
          </div>
        ) : previewError || !preview ? (
          <div style={{ padding: 16, background: '#FEE2E2', borderRadius: 6, color: '#991B1B' }}>
            {(previewError as unknown as Error)?.message ?? 'Failed to load shift snapshot'}
          </div>
        ) : (
          <>
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
                fontVariantNumeric: 'tabular-nums',
                fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Net sales</span>
                <span>{formatCents(preview.snapshot.netSalesCents)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Tax</span>
                <span>{formatCents(preview.snapshot.taxCents)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 0',
                  fontWeight: 700,
                  borderTop: '1px solid #E2E8F0',
                  marginTop: 4,
                  paddingTop: 8,
                }}
              >
                <span>Grand total</span>
                <span>{formatCents(preview.snapshot.totalCents)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Expected cash</span>
                <span>{formatCents(expectedCents)}</span>
              </div>
            </div>

            {/*
              Full reconciliation breakdown so the manager doesn't have to
              jump to the X-report page mid-confirmation. Renders the same
              tender / discount / refund / category data the printable Z
              uses, in compact list form. Sections collapse when empty so
              quiet shifts don't waste vertical space.
            */}
            <div
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
                fontVariantNumeric: 'tabular-nums',
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 11, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Tenders
              </div>
              {[
                ['Cash (net)', preview.snapshot.tenders.cash.netCents],
                ['Card · Terminal', preview.snapshot.tenders.cardTerminal.netCents],
                ['Card · Card-Not-Present', preview.snapshot.tenders.cardCnp.netCents],
                ['ACH (net)', preview.snapshot.tenders.ach.netCents],
                ['Charge to A/R', preview.snapshot.tenders.chargeToAr.netCents],
                ['Check (declared)', preview.snapshot.tenders.check.declaredCents],
                ['Other (declared)', preview.snapshot.tenders.other.declaredCents],
              ].map(([label, cents]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{label}</span>
                  <span>{formatCents(cents as number)}</span>
                </div>
              ))}

              {preview.snapshot.salesByCategory.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 11, color: '#475569', marginTop: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Sales by category
                  </div>
                  {preview.snapshot.salesByCategory.map((c) => (
                    <div key={c.categoryId ?? c.categoryName} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span>{c.categoryName}</span>
                      <span>{formatCents(c.netCents)}</span>
                    </div>
                  ))}
                </>
              )}

              {preview.snapshot.discountsApplied.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 11, color: '#475569', marginTop: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Discounts ({preview.snapshot.discountsApplied.reduce((s, d) => s + d.count, 0)})
                  </div>
                  {preview.snapshot.discountsApplied.map((d) => (
                    <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span>{d.label} × {d.count}</span>
                      <span>−{formatCents(d.totalCents)}</span>
                    </div>
                  ))}
                </>
              )}

              {preview.snapshot.refundsList.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 11, color: '#475569', marginTop: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Refunds ({preview.snapshot.refundsList.length})
                  </div>
                  {preview.snapshot.refundsList.slice(0, 6).map((r) => (
                    <div key={r.transactionId} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span>{new Date(r.refundedAt).toLocaleTimeString()} · {r.transactionId.slice(0, 8)}</span>
                      <span>{formatCents(r.totalCents)}</span>
                    </div>
                  ))}
                  {preview.snapshot.refundsList.length > 6 && (
                    <div style={{ fontSize: 11, color: '#64748B', paddingTop: 4 }}>
                      + {preview.snapshot.refundsList.length - 6} more — see full report after locking.
                    </div>
                  )}
                </>
              )}

              {preview.snapshot.topProducts.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 11, color: '#475569', marginTop: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Top products
                  </div>
                  {preview.snapshot.topProducts.slice(0, 5).map((p) => (
                    <div key={p.productId ?? p.productName} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span>{p.productName} × {p.quantity}</span>
                      <span>{formatCents(p.netCents)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div style={{ ...styles.field, marginBottom: 12 }}>
              <label style={styles.label}>Counted cash ($)</label>
              <input
                style={styles.input}
                type="number"
                step="0.01"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: variance === 0 ? '#059669' : variance > 0 ? '#059669' : '#DC2626',
                  fontWeight: 600,
                }}
              >
                Variance: {variance >= 0 ? '+' : ''}${dollars(variance)}{' '}
                {variance !== 0 && (
                  <AlertTriangle
                    size={12}
                    style={{ display: 'inline', verticalAlign: -1, marginLeft: 2 }}
                  />
                )}
              </div>
            </div>

            <div style={{ ...styles.field, marginBottom: 16 }}>
              <label style={styles.label}>Notes (optional)</label>
              <textarea
                style={{ ...styles.input, minHeight: 60, fontFamily: 'inherit' }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything finance should know about this shift…"
              />
            </div>

            {(preview.snapshot.stripeMatching.unmatchedRowIds.length > 0
              || preview.snapshot.stripeMatching.uncapturedRowIds.length > 0
              || preview.snapshot.stripeMatching.unverifiedRowIds.length > 0
              || !preview.snapshot.stripeMatching.verifiedAgainstStripe) && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  background: '#FEF3C7',
                  color: '#92400E',
                  borderRadius: 6,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  {!preview.snapshot.stripeMatching.verifiedAgainstStripe && (
                    <div>Stripe verification skipped — STRIPE_SECRET_KEY is not configured.</div>
                  )}
                  {preview.snapshot.stripeMatching.unmatchedRowIds.length > 0 && (
                    <div>{preview.snapshot.stripeMatching.unmatchedRowIds.length} card sale(s) lack a Stripe PaymentIntent id.</div>
                  )}
                  {preview.snapshot.stripeMatching.uncapturedRowIds.length > 0 && (
                    <div>{preview.snapshot.stripeMatching.uncapturedRowIds.length} card sale(s) whose PaymentIntent has not succeeded.</div>
                  )}
                  {preview.snapshot.stripeMatching.unverifiedRowIds.length > 0 && (
                    <div>{preview.snapshot.stripeMatching.unverifiedRowIds.length} card sale(s) whose PaymentIntent could not be retrieved from Stripe.</div>
                  )}
                </div>
              </div>
            )}

            {submitError && (
              <div
                style={{
                  padding: 10,
                  marginBottom: 12,
                  background: '#FEE2E2',
                  borderRadius: 6,
                  color: '#991B1B',
                  fontSize: 13,
                }}
              >
                {submitError}
              </div>
            )}

            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}
            >
              <button
                onClick={onClose}
                style={{ ...styles.iconBtn, padding: '8px 14px', fontSize: 14 }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button onClick={submit} style={styles.primaryBtn} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 size={14} className="spin" style={{ marginRight: 6, verticalAlign: -2 }} />
                    Posting…
                  </>
                ) : (
                  <>
                    <Lock size={14} style={{ marginRight: 6, verticalAlign: -2 }} /> Lock & post
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
