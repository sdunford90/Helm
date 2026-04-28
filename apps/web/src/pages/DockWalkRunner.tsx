import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Anchor, X,
} from 'lucide-react';
import { api } from '../lib/api';

/* ── API shapes ──────────────────────────────────────────── */

type ItemStatus = 'OK' | 'VIOLATION' | 'NEEDS_ATTENTION';

interface WalkListItem {
  id: string;
  status: ItemStatus;
  notes: string | null;
  boatPresent: boolean | null;
  expectedMatch: boolean | null;
  expectedBoatId: string | null;
}

interface ExpectedBoat {
  id: string;
  name: string | null;
  registrationNumber: string | null;
  lengthFt: number | null;
  beamFt: number | null;
  make: string | null;
  model: string | null;
}

interface ExpectedCustomer {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
}

interface WalkListSlip {
  slip: {
    id: string;
    slipNumber: string;
    dockId: string | null;
    lengthFt: number;
    beamFt: number | null;
    status: string;
  };
  expectedBoat: ExpectedBoat | null;
  expectedCustomer: ExpectedCustomer | null;
  item: WalkListItem | null;
}

interface WalkListResponse {
  dockWalk: {
    id: string;
    dockId: string | null;
    status: 'IN_PROGRESS' | 'COMPLETED';
    startedAt: string;
    completedAt: string | null;
  };
  slips: WalkListSlip[];
}

/* ── Local UI state ─────────────────────────────────────── */

interface DraftEntry {
  // null = not set yet, true/false = inspector picked
  boatPresent: boolean | null;
  expectedMatch: boolean | null;
  notes: string;
  hasIssue: boolean;
  saving: boolean;
  error: string | null;
}

function emptyDraft(): DraftEntry {
  return {
    boatPresent: null,
    expectedMatch: null,
    notes: '',
    hasIssue: false,
    saving: false,
    error: null,
  };
}

function draftFromItem(item: WalkListItem | null): DraftEntry {
  if (!item) return emptyDraft();
  return {
    boatPresent: item.boatPresent,
    expectedMatch: item.expectedMatch,
    notes: item.notes ?? '',
    hasIssue: !!(item.notes && item.notes.length > 0) || item.status !== 'OK',
    saving: false,
    error: null,
  };
}

function customerLabel(c: ExpectedCustomer | null): string {
  if (!c) return '';
  if (c.company) return c.company;
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
}

function boatLabel(b: ExpectedBoat | null): string {
  if (!b) return 'Vacant slip — no active contract';
  return b.name || b.registrationNumber || `${b.make ?? ''} ${b.model ?? ''}`.trim() || 'Unnamed boat';
}

/* ── Inline styles (mobile-first) ───────────────────────── */

const c = {
  navy: '#0A2342',
  navyDeep: '#06182E',
  ink: '#0A2342',
  sub: '#475569',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  red: '#DC2626',
  redSoft: '#FEE2E2',
  amber: '#D97706',
  amberSoft: '#FEF3C7',
  blue: '#0EA5E9',
};

const ui = {
  page: {
    minHeight: '100vh',
    background: c.bg,
    color: c.ink,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    paddingBottom: '120px',
  } as React.CSSProperties,
  header: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    background: c.navy,
    color: '#fff',
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  } as React.CSSProperties,
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: '#fff',
    padding: '8px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    minWidth: '44px',
    minHeight: '44px',
    justifyContent: 'center',
  } as React.CSSProperties,
  headerTitle: { flex: 1, fontSize: '15px', fontWeight: 600, lineHeight: 1.25 } as React.CSSProperties,
  headerSub: { fontSize: '12px', opacity: 0.8, marginTop: '2px' } as React.CSSProperties,
  doneBtn: {
    background: c.green,
    color: '#fff',
    border: 'none',
    padding: '10px 14px',
    borderRadius: '10px',
    fontWeight: 600,
    fontSize: '14px',
    cursor: 'pointer',
    minHeight: '44px',
  } as React.CSSProperties,
  list: { padding: '12px', display: 'flex', flexDirection: 'column' as const, gap: '12px' } as React.CSSProperties,
  card: {
    background: c.surface,
    borderRadius: '14px',
    border: `1px solid ${c.border}`,
    padding: '14px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  } as React.CSSProperties,
  cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' } as React.CSSProperties,
  slipNum: { fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', color: c.navy } as React.CSSProperties,
  expected: { marginTop: '4px', fontSize: '14px', color: c.ink, lineHeight: 1.35 } as React.CSSProperties,
  expectedSub: { fontSize: '12px', color: c.sub, marginTop: '2px' } as React.CSSProperties,
  vacantPill: {
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: '3px 8px',
    borderRadius: '999px',
    background: '#E0F2FE',
    color: '#075985',
    marginTop: '4px',
  } as React.CSSProperties,
  filedPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: '4px 8px',
    borderRadius: '999px',
    background: c.greenSoft,
    color: '#166534',
  } as React.CSSProperties,
  flagPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: '4px 8px',
    borderRadius: '999px',
    background: c.amberSoft,
    color: '#92400E',
  } as React.CSSProperties,
  questionLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: c.sub,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginTop: '14px',
    marginBottom: '6px',
  } as React.CSSProperties,
  buttonRow: { display: 'flex', gap: '8px' } as React.CSSProperties,
  choiceBtn: (active: boolean, tone: 'pos' | 'neg' | 'neutral'): React.CSSProperties => {
    const palette = {
      pos: { bg: c.green, fg: '#fff', border: c.green, idleBg: '#fff', idleFg: c.ink, idleBorder: c.borderStrong },
      neg: { bg: c.red, fg: '#fff', border: c.red, idleBg: '#fff', idleFg: c.ink, idleBorder: c.borderStrong },
      neutral: { bg: c.navy, fg: '#fff', border: c.navy, idleBg: '#fff', idleFg: c.ink, idleBorder: c.borderStrong },
    }[tone];
    return {
      flex: 1,
      minHeight: '48px',
      borderRadius: '10px',
      border: `2px solid ${active ? palette.border : palette.idleBorder}`,
      background: active ? palette.bg : palette.idleBg,
      color: active ? palette.fg : palette.idleFg,
      fontSize: '15px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.1s',
    };
  },
  notesArea: {
    width: '100%',
    minHeight: '70px',
    marginTop: '8px',
    padding: '10px',
    border: `1px solid ${c.borderStrong}`,
    borderRadius: '10px',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  saveBtn: (disabled: boolean): React.CSSProperties => ({
    width: '100%',
    marginTop: '12px',
    minHeight: '48px',
    background: disabled ? '#94A3B8' : c.navy,
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }),
  errorText: { color: c.red, fontSize: '13px', marginTop: '8px' } as React.CSSProperties,
  progressTrack: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: c.surface,
    borderTop: `1px solid ${c.border}`,
    padding: '12px 14px',
    paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
    boxShadow: '0 -2px 12px rgba(0,0,0,0.08)',
    zIndex: 9,
  } as React.CSSProperties,
  progressLabel: { fontSize: '12px', color: c.sub, marginBottom: '6px' } as React.CSSProperties,
  progressBar: {
    height: '8px',
    background: c.border,
    borderRadius: '999px',
    overflow: 'hidden',
  } as React.CSSProperties,
  progressFill: (pct: number): React.CSSProperties => ({
    height: '100%',
    width: `${pct}%`,
    background: c.green,
    transition: 'width 0.2s',
  }),
};

/* ── Page ───────────────────────────────────────────────── */

export default function DockWalkRunner() {
  const { id: walkId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();

  const [data, setData] = useState<WalkListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // Synchronous double-submit guard. Set BEFORE the await so two rapid taps
  // can't both observe row.item === null and issue two POSTs (the schema has
  // no unique (dockWalkId, slipId) constraint so we'd silently duplicate).
  const inFlightRef = useRef<Set<string>>(new Set());

  // Initial load.
  useEffect(() => {
    if (!walkId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await api.get<WalkListResponse>(`/api/dock-walks/${walkId}/walk-list`, token);
        if (cancelled) return;
        setData(res);
        const seeded: Record<string, DraftEntry> = {};
        for (const row of res.slips) {
          seeded[row.slip.id] = draftFromItem(row.item);
        }
        setDrafts(seeded);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load walk');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walkId, getToken]);

  const totalSlips = data?.slips.length ?? 0;
  const filedCount = useMemo(
    () => (data ? data.slips.filter((s) => !!s.item).length : 0),
    [data],
  );
  const progressPct = totalSlips === 0 ? 0 : Math.round((filedCount / totalSlips) * 100);

  function patchDraft(slipId: string, patch: Partial<DraftEntry>) {
    setDrafts((prev) => ({ ...prev, [slipId]: { ...prev[slipId], ...patch } }));
  }

  // Compute item status from inspector's choices.
  function deriveStatus(d: DraftEntry, hasExpectedBoat: boolean): ItemStatus {
    if (d.hasIssue && d.notes.trim().length > 0) return 'VIOLATION';
    // Right boat in the wrong slip → follow-up.
    if (d.boatPresent === true && hasExpectedBoat && d.expectedMatch === false) {
      return 'NEEDS_ATTENTION';
    }
    // A boat sitting in a slip with no active contract is also a follow-up
    // (probably transient, drift, or a missed renewal — staff should look).
    if (d.boatPresent === true && !hasExpectedBoat) {
      return 'NEEDS_ATTENTION';
    }
    return 'OK';
  }

  // True when the inspector has provided enough information to file the row.
  function isSaveable(d: DraftEntry): boolean {
    if (d.boatPresent === null) return false;
    // "Yes — flag it" only counts once notes have been written, so we don't
    // silently file an OK row when the inspector meant to flag something.
    if (d.hasIssue && d.notes.trim().length === 0) return false;
    return true;
  }

  // Save (POST first time, PUT on edit). Idempotent against double-tap via
  // a synchronous in-flight set keyed by slipId.
  async function handleSave(row: WalkListSlip) {
    if (!walkId || !data) return;
    const draft = drafts[row.slip.id];
    if (!draft || !isSaveable(draft)) return;

    // Synchronous guard — must run BEFORE any await.
    if (inFlightRef.current.has(row.slip.id)) return;
    inFlightRef.current.add(row.slip.id);

    patchDraft(row.slip.id, { saving: true, error: null });
    try {
      const token = await getToken();
      const status = deriveStatus(draft, !!row.expectedBoat);
      const isCreate = !row.item;
      // Snapshot semantics: only stamp expectedBoatId on the *create* call.
      // On subsequent edits we preserve whatever was originally captured at
      // walk-time so a later contract change can't rewrite history.
      const body: Record<string, unknown> = {
        slipId: row.slip.id,
        status,
        notes: draft.notes.trim() || null,
        boatPresent: draft.boatPresent,
        // expectedMatch only meaningful when boat present and there's an
        // expected boat; reset to null otherwise so stale matches don't
        // linger if the inspector toggled boatPresent back to false.
        expectedMatch:
          draft.boatPresent && row.expectedBoat ? draft.expectedMatch : null,
      };
      if (isCreate) {
        body.expectedBoatId = row.expectedBoat?.id ?? null;
      }

      const saved = isCreate
        ? await api.post<WalkListItem>(
            `/api/dock-walks/${walkId}/items`,
            body,
            token,
          )
        : await api.put<WalkListItem>(
            `/api/dock-walks/${walkId}/items/${row.item!.id}`,
            body,
            token,
          );

      // Splice the saved item back into the data so the row shows "Filed".
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          slips: prev.slips.map((s) =>
            s.slip.id === row.slip.id ? { ...s, item: saved } : s,
          ),
        };
      });
      patchDraft(row.slip.id, { saving: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      patchDraft(row.slip.id, { saving: false, error: msg });
    } finally {
      inFlightRef.current.delete(row.slip.id);
    }
  }

  async function handleComplete() {
    if (!walkId) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const token = await getToken();
      await api.post(`/api/dock-walks/${walkId}/complete`, {}, token);
      navigate('/dock-walks');
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : 'Could not complete walk');
      setCompleting(false);
    }
  }

  /* ── Render ───────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={ui.page}>
        <div style={ui.header}>
          <button style={ui.backBtn} onClick={() => navigate('/dock-walks')} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <div style={ui.headerTitle}>Loading walk…</div>
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div style={ui.page}>
        <div style={ui.header}>
          <button style={ui.backBtn} onClick={() => navigate('/dock-walks')} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <div style={ui.headerTitle}>Walk unavailable</div>
        </div>
        <div style={{ padding: '24px', color: c.red }}>{loadError ?? 'Walk not found.'}</div>
      </div>
    );
  }

  const dockLabel = data.dockWalk.dockId ? `Dock ${data.dockWalk.dockId}` : 'All slips';
  const isCompleted = data.dockWalk.status === 'COMPLETED';

  return (
    <div style={ui.page}>
      <header style={ui.header}>
        <button style={ui.backBtn} onClick={() => navigate('/dock-walks')} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div style={ui.headerTitle}>
          <div>{dockLabel}</div>
          <div style={ui.headerSub}>
            {filedCount} / {totalSlips} slips filed
          </div>
        </div>
        {!isCompleted && (
          <button
            style={ui.doneBtn}
            onClick={handleComplete}
            disabled={completing}
          >
            {completing ? 'Finishing…' : 'Finish walk'}
          </button>
        )}
      </header>

      {completeError && (
        <div style={{ padding: '12px 14px', background: c.redSoft, color: c.red, fontSize: '14px' }}>
          {completeError}
        </div>
      )}

      {data.slips.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', color: c.sub }}>
          <Anchor size={48} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
          <div style={{ fontSize: '15px' }}>No slips on this dock to walk.</div>
        </div>
      )}

      <div style={ui.list}>
        {data.slips.map((row) => {
          const draft = drafts[row.slip.id] ?? emptyDraft();
          const filed = !!row.item;
          const hasExpectedBoat = !!row.expectedBoat;
          const customerName = customerLabel(row.expectedCustomer);
          const flagged = filed && row.item && row.item.status !== 'OK';

          return (
            <div key={row.slip.id} style={ui.card}>
              <div style={ui.cardHeader}>
                <div style={{ flex: 1 }}>
                  <div style={ui.slipNum}>Slip {row.slip.slipNumber}</div>
                  {hasExpectedBoat ? (
                    <>
                      <div style={ui.expected}>
                        <strong>{boatLabel(row.expectedBoat)}</strong>
                      </div>
                      {customerName && (
                        <div style={ui.expectedSub}>{customerName}</div>
                      )}
                    </>
                  ) : (
                    <div style={ui.vacantPill}>Vacant — no active contract</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                  {flagged && (
                    <span style={ui.flagPill}>
                      <AlertTriangle size={11} />
                      {row.item!.status === 'VIOLATION' ? 'Issue' : 'Follow-up'}
                    </span>
                  )}
                  {filed && !flagged && (
                    <span style={ui.filedPill}>
                      <CheckCircle2 size={11} />
                      Filed
                    </span>
                  )}
                </div>
              </div>

              <div style={ui.questionLabel}>Boat in slip?</div>
              <div style={ui.buttonRow}>
                <button
                  style={ui.choiceBtn(draft.boatPresent === true, 'pos')}
                  onClick={() =>
                    patchDraft(row.slip.id, {
                      boatPresent: true,
                      // reset expectedMatch when toggling
                      expectedMatch: draft.boatPresent === true ? draft.expectedMatch : null,
                    })
                  }
                >
                  Yes
                </button>
                <button
                  style={ui.choiceBtn(draft.boatPresent === false, 'neg')}
                  onClick={() =>
                    patchDraft(row.slip.id, {
                      boatPresent: false,
                      expectedMatch: null,
                    })
                  }
                >
                  No (vacant)
                </button>
              </div>

              {draft.boatPresent === true && hasExpectedBoat && (
                <>
                  <div style={ui.questionLabel}>Right boat?</div>
                  <div style={ui.buttonRow}>
                    <button
                      style={ui.choiceBtn(draft.expectedMatch === true, 'pos')}
                      onClick={() => patchDraft(row.slip.id, { expectedMatch: true })}
                    >
                      Yes
                    </button>
                    <button
                      style={ui.choiceBtn(draft.expectedMatch === false, 'neg')}
                      onClick={() => patchDraft(row.slip.id, { expectedMatch: false })}
                    >
                      Different boat
                    </button>
                  </div>
                </>
              )}

              <div style={ui.questionLabel}>Issue to flag?</div>
              <div style={ui.buttonRow}>
                <button
                  style={ui.choiceBtn(!draft.hasIssue, 'neutral')}
                  onClick={() =>
                    patchDraft(row.slip.id, { hasIssue: false, notes: '' })
                  }
                >
                  No
                </button>
                <button
                  style={ui.choiceBtn(draft.hasIssue, 'neg')}
                  onClick={() => patchDraft(row.slip.id, { hasIssue: true })}
                >
                  Yes — flag it
                </button>
              </div>

              {draft.hasIssue && (
                <textarea
                  style={ui.notesArea}
                  placeholder="Describe the issue (lines, power, condition, debris…)"
                  value={draft.notes}
                  onChange={(e) =>
                    patchDraft(row.slip.id, { notes: e.target.value })
                  }
                />
              )}

              <button
                style={ui.saveBtn(
                  draft.saving || !isSaveable(draft) || isCompleted,
                )}
                disabled={
                  draft.saving || !isSaveable(draft) || isCompleted
                }
                onClick={() => handleSave(row)}
              >
                {draft.saving
                  ? 'Saving…'
                  : filed
                    ? 'Update'
                    : 'Save & next slip'}
              </button>

              {draft.hasIssue && draft.notes.trim().length === 0 && (
                <div style={{ ...ui.errorText, color: c.sub }}>
                  Add a note describing the issue before saving.
                </div>
              )}
              {draft.error && <div style={ui.errorText}>{draft.error}</div>}
            </div>
          );
        })}
      </div>

      {data.slips.length > 0 && !isCompleted && (
        <div style={ui.progressTrack}>
          <div style={ui.progressLabel}>
            Progress: {filedCount} / {totalSlips}
          </div>
          <div style={ui.progressBar}>
            <div style={ui.progressFill(progressPct)} />
          </div>
        </div>
      )}
    </div>
  );
}
