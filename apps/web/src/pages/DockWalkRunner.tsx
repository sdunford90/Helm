import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Anchor,
  Camera, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { useToast } from '../components/Toast';

/* ── Upload error helpers (mirrors CustomerDetail boat-photo pipeline) ── */

const MAX_PHOTOS_PER_SLIP = 4;

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  EXTENSION_FORBIDDEN:
    "That file type isn't supported. Please choose a JPG, PNG, WEBP, or HEIC image.",
  CONTENT_TYPE_FORBIDDEN:
    "That file type isn't supported. Please choose a JPG, PNG, WEBP, or HEIC image.",
  SIZE_EXCEEDED: 'Image is too large. Photos must be under the storage limit.',
  MAGIC_MISMATCH:
    "The file's contents didn't match its extension. Please try a fresh photo from the camera.",
  QUOTA_EXCEEDED:
    'Your storage quota is full. Delete some old files to free up space, then try again.',
  AV_INFECTED: 'That photo was rejected by the antivirus scanner.',
  AV_REQUIRED_BUT_SKIPPED:
    'Antivirus scanning is temporarily unavailable. Please try again in a few minutes.',
  FORBIDDEN: "You don't have permission to upload here.",
  STORAGE_NETWORK_BLOCKED:
    "Couldn't reach file storage. This is usually a network or CORS issue — please contact support.",
  STORAGE_PUT_FAILED: 'Upload to storage failed — please try again.',
};

function describeUploadError(err: unknown): { title: string; message: string } {
  if (err instanceof ApiClientError) {
    const friendly = err.code ? UPLOAD_ERROR_MESSAGES[err.code] : undefined;
    if (friendly) return { title: 'Upload failed', message: friendly };
    return {
      title: 'Upload failed',
      message: `${err.message} (status ${err.status}${err.code ? `, ${err.code}` : ''})`,
    };
  }
  if (err instanceof Error) return { title: 'Upload failed', message: err.message };
  return { title: 'Upload failed', message: 'An unexpected error occurred.' };
}

/* ── API shapes ──────────────────────────────────────────── */

type ItemStatus = 'OK' | 'VIOLATION' | 'NEEDS_ATTENTION';

interface WalkListItem {
  id: string;
  status: ItemStatus;
  notes: string | null;
  boatPresent: boolean | null;
  expectedMatch: boolean | null;
  expectedBoatId: string | null;
  // Stored as Json? in Postgres; the API hands it back as an array of
  // R2 storage keys (or null when never set). We don't render raw R2
  // keys — they're swapped for short-lived signed URLs at load time.
  photoUrls: string[] | null;
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

interface PresignUploadResponse {
  url: string;
  key: string;
}

interface PresignDownloadBatchResponse {
  urls: Record<string, string>;
  errors: Record<string, { code: string; error: string }>;
}

/* ── Local UI state ─────────────────────────────────────── */

interface DraftEntry {
  // null = not set yet, true/false = inspector picked
  boatPresent: boolean | null;
  expectedMatch: boolean | null;
  notes: string;
  hasIssue: boolean;
  // R2 storage keys for this slip; persisted to the DockWalkItem on save.
  photoUrls: string[];
  saving: boolean;
  uploading: boolean;
  error: string | null;
  photoError: string | null;
}

function emptyDraft(): DraftEntry {
  return {
    boatPresent: null,
    expectedMatch: null,
    notes: '',
    hasIssue: false,
    photoUrls: [],
    saving: false,
    uploading: false,
    error: null,
    photoError: null,
  };
}

function draftFromItem(item: WalkListItem | null): DraftEntry {
  if (!item) return emptyDraft();
  return {
    boatPresent: item.boatPresent,
    expectedMatch: item.expectedMatch,
    notes: item.notes ?? '',
    hasIssue: !!(item.notes && item.notes.length > 0) || item.status !== 'OK',
    photoUrls: Array.isArray(item.photoUrls) ? item.photoUrls.filter((k): k is string => typeof k === 'string') : [],
    saving: false,
    uploading: false,
    error: null,
    photoError: null,
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

// The R2 keys currently saved on the DockWalkItem. We treat these as
// "persisted" — removing one from the draft must NOT immediately delete
// the R2 object, because the DB still references it until a successful
// re-save with the shorter list.
function persistedPhotoKeys(row: WalkListSlip): string[] {
  const raw = row.item?.photoUrls;
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === 'string');
}

function resolvePhotoContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return 'image/jpeg';
}

/* ── Inline styles (mobile-first) ───────────────────────── */

const c = {
  navy: '#0A2342',
  navyDeep: '#06182E',
  cyan: '#00D4FF',
  ink: '#0A2342',
  sub: '#475569',
  subSoft: '#94A3B8',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  bg: '#F1F5F9',
  surface: '#FFFFFF',
  green: '#16A34A',
  red: '#DC2626',
  redSoft: '#FEE2E2',
  amber: '#D97706',
};

const ui = {
  page: {
    minHeight: '100vh',
    background: c.bg,
    color: c.ink,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    paddingBottom: 'calc(96px + env(safe-area-inset-bottom))',
    overflowX: 'hidden' as const,
  } as React.CSSProperties,
  header: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 20,
    background: `linear-gradient(135deg, ${c.navy} 0%, ${c.navyDeep} 100%)`,
    color: '#fff',
    padding: '12px 14px',
    paddingTop: 'calc(12px + env(safe-area-inset-top))',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    boxShadow: '0 4px 14px rgba(6,24,46,0.25)',
  } as React.CSSProperties,
  backBtn: {
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    color: '#fff',
    padding: '8px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    minWidth: '44px',
    minHeight: '44px',
    justifyContent: 'center',
  } as React.CSSProperties,
  headerTitle: { flex: 1, fontSize: '15px', fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
  headerSub: { fontSize: '12px', opacity: 0.85, marginTop: '2px', fontWeight: 500 } as React.CSSProperties,
  doneBtn: {
    background: c.green,
    color: '#fff',
    border: 'none',
    padding: '10px 14px',
    borderRadius: '10px',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer',
    minHeight: '44px',
    boxShadow: '0 2px 6px rgba(22,163,74,0.4)',
  } as React.CSSProperties,
  segmentBar: {
    position: 'sticky' as const,
    top: 'calc(68px + env(safe-area-inset-top))',
    zIndex: 19,
    background: c.surface,
    borderBottom: `1px solid ${c.border}`,
    padding: '10px 12px',
    display: 'flex',
    gap: '3px',
    overflowX: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as const,
    scrollbarWidth: 'none' as const,
  } as React.CSSProperties,
  segment: (color: string, active: boolean): React.CSSProperties => ({
    flex: '1 0 14px',
    minWidth: '14px',
    height: active ? '14px' : '8px',
    alignSelf: 'center',
    background: color,
    borderRadius: '999px',
    cursor: 'pointer',
    border: active ? `2px solid ${c.navy}` : 'none',
    transition: 'height 0.15s, border 0.15s',
  }),
  cardWrap: {
    padding: '14px',
    transition: 'transform 0.25s ease, opacity 0.2s ease',
  } as React.CSSProperties,
  card: {
    background: c.surface,
    borderRadius: '18px',
    border: `1px solid ${c.border}`,
    overflow: 'hidden' as const,
    boxShadow: '0 4px 16px rgba(10,35,66,0.08)',
  } as React.CSSProperties,
  hero: {
    background: `linear-gradient(135deg, ${c.navy} 0%, ${c.navyDeep} 100%)`,
    color: '#fff',
    padding: '20px 18px',
    position: 'relative' as const,
  } as React.CSSProperties,
  heroLabel: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    opacity: 0.7,
    marginBottom: '4px',
  } as React.CSSProperties,
  heroSlip: {
    fontSize: '34px',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    margin: 0,
    lineHeight: 1.05,
  } as React.CSSProperties,
  heroBoat: {
    marginTop: '12px',
    fontSize: '17px',
    fontWeight: 700,
    lineHeight: 1.25,
    color: '#fff',
  } as React.CSSProperties,
  heroCustomer: {
    fontSize: '13px',
    opacity: 0.85,
    marginTop: '2px',
    fontWeight: 500,
  } as React.CSSProperties,
  vacantPill: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: '4px 10px',
    borderRadius: '999px',
    background: 'rgba(14,165,233,0.2)',
    color: '#bae6fd',
    marginTop: '12px',
    border: '1px solid rgba(186,230,253,0.4)',
  } as React.CSSProperties,
  statusPill: (kind: 'ok' | 'attn' | 'vio' | 'pending'): React.CSSProperties => {
    const palette = {
      ok: { bg: 'rgba(22,163,74,0.2)', fg: '#bbf7d0', border: 'rgba(187,247,208,0.4)' },
      attn: { bg: 'rgba(217,119,6,0.25)', fg: '#fde68a', border: 'rgba(253,230,138,0.4)' },
      vio: { bg: 'rgba(220,38,38,0.25)', fg: '#fecaca', border: 'rgba(254,202,202,0.4)' },
      pending: { bg: 'rgba(255,255,255,0.12)', fg: '#cbd5e1', border: 'rgba(203,213,225,0.3)' },
    }[kind];
    return {
      position: 'absolute' as const,
      top: '14px',
      right: '14px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.08em',
      padding: '5px 10px',
      borderRadius: '999px',
      background: palette.bg,
      color: palette.fg,
      border: `1px solid ${palette.border}`,
    };
  },
  body: { padding: '16px 18px 20px' } as React.CSSProperties,
  questionLabel: {
    fontSize: '11px',
    fontWeight: 700,
    color: c.sub,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginTop: '16px',
    marginBottom: '8px',
  } as React.CSSProperties,
  buttonRow: { display: 'flex', gap: '8px' } as React.CSSProperties,
  choiceBtn: (active: boolean, tone: 'pos' | 'neg' | 'neutral'): React.CSSProperties => {
    const palette = {
      pos: { bg: c.green, fg: '#fff', border: c.green },
      neg: { bg: c.red, fg: '#fff', border: c.red },
      neutral: { bg: c.navy, fg: '#fff', border: c.navy },
    }[tone];
    return {
      flex: 1,
      minHeight: '56px',
      borderRadius: '12px',
      border: `2px solid ${active ? palette.border : c.borderStrong}`,
      background: active ? palette.bg : '#fff',
      color: active ? palette.fg : c.ink,
      fontSize: '15px',
      fontWeight: 700,
      cursor: 'pointer',
      transition: 'all 0.1s',
      WebkitTapHighlightColor: 'transparent',
    };
  },
  notesArea: {
    width: '100%',
    minHeight: '90px',
    marginTop: '10px',
    padding: '12px',
    border: `1px solid ${c.borderStrong}`,
    borderRadius: '12px',
    fontSize: '15px',
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))',
    gap: '8px',
    marginTop: '10px',
  } as React.CSSProperties,
  photoTile: {
    position: 'relative' as const,
    width: '100%',
    aspectRatio: '1 / 1',
    borderRadius: '10px',
    overflow: 'hidden' as const,
    background: c.bg,
    border: `1px solid ${c.border}`,
  } as React.CSSProperties,
  photoImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
  } as React.CSSProperties,
  photoSpinner: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: c.subSoft,
    fontSize: '11px',
    fontWeight: 600,
  } as React.CSSProperties,
  photoRemove: {
    position: 'absolute' as const,
    top: '4px',
    right: '4px',
    width: '24px',
    height: '24px',
    border: 'none',
    borderRadius: '999px',
    background: 'rgba(10,35,66,0.85)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  } as React.CSSProperties,
  photoAddTile: {
    width: '100%',
    aspectRatio: '1 / 1',
    borderRadius: '10px',
    border: `2px dashed ${c.borderStrong}`,
    background: '#fff',
    color: c.sub,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
    gap: '4px',
    WebkitTapHighlightColor: 'transparent',
  } as React.CSSProperties,
  hiddenInput: {
    position: 'absolute' as const,
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden' as const,
    clip: 'rect(0,0,0,0)',
    border: 0,
  } as React.CSSProperties,
  errorText: { color: c.red, fontSize: '13px', marginTop: '8px', fontWeight: 500 } as React.CSSProperties,
  helperText: { color: c.sub, fontSize: '13px', marginTop: '6px' } as React.CSSProperties,
  bottomBar: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: c.surface,
    borderTop: `1px solid ${c.border}`,
    padding: '10px 12px',
    paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
    boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
    zIndex: 18,
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  } as React.CSSProperties,
  navBtn: (variant: 'ghost' | 'primary' | 'success', disabled?: boolean): React.CSSProperties => {
    if (variant === 'ghost') {
      return {
        flex: '0 0 56px',
        minHeight: '56px',
        borderRadius: '12px',
        border: `1px solid ${c.border}`,
        background: '#fff',
        color: disabled ? c.subSoft : c.ink,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      };
    }
    // Accent gradient on the primary CTA so Save & Next really pops; the
    // success variant uses a green gradient for the final-slip "Save slip"
    // moment.
    const bg = disabled
      ? '#94A3B8'
      : variant === 'success'
      ? `linear-gradient(135deg, #15803D 0%, ${c.green} 100%)`
      : `linear-gradient(135deg, ${c.navy} 0%, #1E40AF 60%, #0EA5E9 100%)`;
    const shadow = disabled
      ? 'none'
      : variant === 'success'
      ? '0 4px 14px rgba(22,163,74,0.32)'
      : '0 4px 14px rgba(14,165,233,0.32)';
    return {
      flex: 1,
      minHeight: '56px',
      borderRadius: '12px',
      border: 'none',
      background: bg,
      color: '#fff',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: '16px',
      fontWeight: 700,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      boxShadow: shadow,
      letterSpacing: '0.01em',
    };
  },
  emptyState: {
    padding: '60px 24px',
    textAlign: 'center' as const,
    color: c.sub,
  } as React.CSSProperties,
};

/* ── Page ───────────────────────────────────────────────── */

export default function DockWalkRunner() {
  const { id: walkId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<WalkListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  // 'left' = card slides in from the right (next), 'right' = from the left (prev).
  const [slideDir, setSlideDir] = useState<'left' | 'right' | null>(null);
  // storageKey -> short-lived presigned download URL for thumbnail rendering.
  const [photoUrlMap, setPhotoUrlMap] = useState<Record<string, string>>({});

  // Synchronous double-submit guard. Set BEFORE the await so two rapid taps
  // can't both observe row.item === null and issue two POSTs (the schema has
  // no unique (dockWalkId, slipId) constraint so we'd silently duplicate).
  const inFlightRef = useRef<Set<string>>(new Set());
  // Each storage key gets at most one on-error thumbnail re-fetch per
  // page lifetime so a permanently-broken key can't loop us forever.
  const thumbnailRefreshAttempted = useRef<Set<string>>(new Set());

  /* Re-presign a single storage key when its signed URL has expired
     (the <img> errors out). No-ops after one attempt per key. */
  async function refreshThumbnailUrl(key: string) {
    if (thumbnailRefreshAttempted.current.has(key)) return;
    thumbnailRefreshAttempted.current.add(key);
    try {
      const token = await getToken();
      const dl = await api.post<PresignDownloadBatchResponse>(
        '/api/storage/presign-download-batch',
        { keys: [key] },
        token,
      );
      const fresh = dl.urls?.[key];
      if (fresh) {
        setPhotoUrlMap((prev) => ({ ...prev, [key]: fresh }));
      }
    } catch {
      /* leave the broken-image placeholder; next reload will retry */
    }
  }
  // Hidden file input — one per render keyed off the current slip so the
  // browser stays happy (we just reset .value after each pick).
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* ── Resolve presigned download URLs for any keys we don't have yet ── */
  const fetchPhotoUrls = useCallback(
    async (keys: string[]) => {
      if (keys.length === 0) return;
      const missing = keys.filter((k) => !photoUrlMap[k]);
      if (missing.length === 0) return;
      try {
        const token = await getToken();
        const res = await api.post<PresignDownloadBatchResponse>(
          '/api/storage/presign-download-batch',
          { keys: missing },
          token,
        );
        if (res.urls && Object.keys(res.urls).length > 0) {
          setPhotoUrlMap((prev) => ({ ...prev, ...res.urls }));
        }
      } catch {
        // Non-fatal — thumbnails just stay as a placeholder.
      }
    },
    [getToken, photoUrlMap],
  );

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
        const allKeys: string[] = [];
        for (const row of res.slips) {
          const draft = draftFromItem(row.item);
          seeded[row.slip.id] = draft;
          for (const k of draft.photoUrls) allKeys.push(k);
        }
        setDrafts(seeded);
        // Jump to the first un-filed slip so the inspector picks up where
        // they left off after a refresh / device swap.
        const firstUnfiled = res.slips.findIndex((s) => !s.item);
        setCurrentIndex(firstUnfiled === -1 ? 0 : firstUnfiled);
        if (allKeys.length > 0) {
          // Fire-and-forget — UI renders without waiting on signed URLs.
          void fetchPhotoUrls(Array.from(new Set(allKeys)));
        }
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
    // fetchPhotoUrls intentionally omitted — only need to seed on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkId, getToken]);

  const totalSlips = data?.slips.length ?? 0;
  const filedCount = useMemo(
    () => (data ? data.slips.filter((s) => !!s.item).length : 0),
    [data],
  );

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
    if (d.uploading) return false;
    return true;
  }

  /* ── Photo upload (presign → PUT → verify → attach) ───────────────── */
  async function handlePhotoUpload(slipId: string, file: File) {
    // Hard cap — task spec: up to 4 photos per slip.
    const currentCount = drafts[slipId]?.photoUrls.length ?? 0;
    if (currentCount >= MAX_PHOTOS_PER_SLIP) {
      const msg = `You can attach up to ${MAX_PHOTOS_PER_SLIP} photos per slip. Remove one to add another.`;
      patchDraft(slipId, { photoError: msg });
      toast.error('Photo limit reached', msg);
      return;
    }
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      const msg = 'Please pick an image file.';
      patchDraft(slipId, { photoError: msg });
      toast.error('Unsupported file', msg);
      return;
    }
    patchDraft(slipId, { uploading: true, photoError: null });
    let presignKey: string | null = null;
    try {
      const token = await getToken();
      const contentType = resolvePhotoContentType(file);

      const presign = await api.post<PresignUploadResponse>(
        '/api/storage/presign-upload',
        { category: 'photos', filename: file.name, contentType },
        token,
      );
      presignKey = presign.key;

      // R2 PUT with structured CORS / network diagnostics so a future
      // bucket misconfiguration is debuggable from a single console line.
      let put: Response;
      try {
        put = await fetch(presign.url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': contentType },
        });
      } catch (netErr) {
        let r2Host = 'unknown';
        try {
          r2Host = new URL(presign.url).host;
        } catch {
          /* malformed presign URL */
        }
        // eslint-disable-next-line no-console
        console.error('[dock walk photo upload network error]', {
          stage: 'r2-put',
          r2Host,
          storageKey: presignKey,
          filename: file.name,
          sizeBytes: file.size,
          contentType,
          error: netErr,
        });
        throw new ApiClientError(
          UPLOAD_ERROR_MESSAGES.STORAGE_NETWORK_BLOCKED,
          0,
          'STORAGE_NETWORK_BLOCKED',
        );
      }
      if (!put.ok) {
        throw new ApiClientError(
          `Upload to storage failed (status ${put.status})`,
          put.status,
          'STORAGE_PUT_FAILED',
        );
      }

      // Magic-byte verify; on failure, clean up the orphan and bail.
      try {
        await api.post('/api/storage/verify-upload', { key: presign.key, contentType }, token);
      } catch (verifyErr) {
        await api
          .delete(`/api/storage/${encodeURIComponent(presign.key)}`, token)
          .catch(() => {/* best effort */});
        throw verifyErr;
      }

      // Get a presigned download URL so we can render the thumbnail right away.
      try {
        const dl = await api.post<PresignDownloadBatchResponse>(
          '/api/storage/presign-download-batch',
          { keys: [presign.key] },
          token,
        );
        if (dl.urls?.[presign.key]) {
          setPhotoUrlMap((prev) => ({ ...prev, [presign.key]: dl.urls[presign.key] }));
        }
      } catch {
        // Non-fatal — the tile shows a placeholder; the photo is still saved.
      }

      // Attach to draft. NOTE: this only stages it; the inspector still
      // needs to tap Save to write photoUrls to the DockWalkItem.
      setDrafts((prev) => {
        const cur = prev[slipId] ?? emptyDraft();
        return {
          ...prev,
          [slipId]: {
            ...cur,
            photoUrls: [...cur.photoUrls, presign.key],
            uploading: false,
            photoError: null,
          },
        };
      });
    } catch (err) {
      const status = err instanceof ApiClientError ? err.status : undefined;
      // eslint-disable-next-line no-console
      console.error('[dock walk photo upload failed]', {
        storageKey: presignKey,
        filename: file.name,
        sizeBytes: file.size,
        httpStatus: status,
        error: err,
      });
      const { title, message } = describeUploadError(err);
      patchDraft(slipId, { uploading: false, photoError: message });
      toast.error(title, message);
      // If we managed to presign but never finished, the orphan is benign:
      // the storage quota worker will sweep it. We only proactively delete
      // when verify failed (handled above).
      void presignKey;
    }
  }

  async function removePhoto(row: WalkListSlip, key: string) {
    if (!walkId) return;
    const persistedKeys = persistedPhotoKeys(row);
    const isPersisted = persistedKeys.includes(key);

    // Optimistic local update so the tile disappears immediately.
    const prevDraft = drafts[row.slip.id] ?? emptyDraft();
    const newDraftKeys = prevDraft.photoUrls.filter((k) => k !== key);
    setDrafts((prev) => {
      const cur = prev[row.slip.id] ?? emptyDraft();
      return {
        ...prev,
        [row.slip.id]: { ...cur, photoUrls: newDraftKeys },
      };
    });

    // Session-only key (uploaded but not yet saved to a DockWalkItem):
    // safe to free the R2 bytes right now since nothing references them.
    if (!isPersisted) {
      try {
        const token = await getToken();
        await api.delete(`/api/storage/${encodeURIComponent(key)}`, token);
      } catch {
        /* best-effort */
      }
      return;
    }

    // Persisted key: per task spec, immediately PUT the new photoUrls list
    // so the DB stops referencing the object BEFORE we delete it from R2.
    // If the PUT fails we revert the optimistic change so the UI stays in
    // sync with what's actually saved.
    if (!row.item) return;
    try {
      const token = await getToken();
      const updated = await api.put<WalkListItem>(
        `/api/dock-walks/${walkId}/items/${row.item.id}`,
        { photoUrls: newDraftKeys.length > 0 ? newDraftKeys : null },
        token,
      );
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          slips: prev.slips.map((s) =>
            s.slip.id === row.slip.id ? { ...s, item: updated } : s,
          ),
        };
      });
      // Best-effort R2 delete — the DB no longer points at this key.
      api
        .delete(`/api/storage/${encodeURIComponent(key)}`, token)
        .catch(() => {/* best-effort */});
      toast.success('Photo removed');
    } catch (err) {
      // Revert optimistic update.
      setDrafts((prev) => {
        const cur = prev[row.slip.id] ?? emptyDraft();
        if (cur.photoUrls.includes(key)) return prev;
        return { ...prev, [row.slip.id]: { ...cur, photoUrls: prevDraft.photoUrls } };
      });
      const message = err instanceof Error ? err.message : 'Could not remove photo';
      toast.error('Could not remove photo', message);
    }
  }

  // Save (POST first time, PUT on edit). Idempotent against double-tap via
  // a synchronous in-flight set keyed by slipId.
  async function handleSave(row: WalkListSlip): Promise<boolean> {
    if (!walkId || !data) return false;
    const draft = drafts[row.slip.id];
    if (!draft || !isSaveable(draft)) return false;

    // Synchronous guard — must run BEFORE any await.
    if (inFlightRef.current.has(row.slip.id)) return false;
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
        photoUrls: draft.photoUrls.length > 0 ? draft.photoUrls : null,
      };
      if (isCreate) {
        body.expectedBoatId = row.expectedBoat?.id ?? null;
      }

      const previouslyPersistedKeys = persistedPhotoKeys(row);

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

      // Sweep R2 objects that used to be referenced by this DockWalkItem
      // but aren't anymore — defensive cleanup for any keys whose physical
      // delete might not have happened during a removePhoto call. Now that
      // the DB no longer references them, it's safe to free the bytes.
      const keptKeys = new Set(draft.photoUrls);
      const orphans = previouslyPersistedKeys.filter((k) => !keptKeys.has(k));
      if (orphans.length > 0) {
        for (const k of orphans) {
          api
            .delete(`/api/storage/${encodeURIComponent(k)}`, token)
            .catch(() => {/* best-effort */});
        }
      }

      // Success toast — confirms the save without stealing focus from the
      // next slip the inspector is about to see.
      const slipLabel = row.slip.slipNumber ?? `Slip ${row.slip.id.slice(0, 6)}`;
      toast.success(
        isCreate ? 'Slip saved' : 'Slip updated',
        `${slipLabel} · ${status === 'OK' ? 'OK' : status === 'VIOLATION' ? 'Issue flagged' : 'Needs follow-up'}`,
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      patchDraft(row.slip.id, { saving: false, error: msg });
      toast.error('Save failed', msg);
      return false;
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

  /* ── Navigation between slips ─────────────────────────── */
  function goToIndex(target: number, dir: 'left' | 'right' | null) {
    if (!data) return;
    const clamped = Math.max(0, Math.min(target, data.slips.length - 1));
    if (clamped === currentIndex) return;
    setSlideDir(dir);
    setCurrentIndex(clamped);
    // Clear the slide direction after the animation lands so identical
    // re-renders don't re-trigger the slide-in animation.
    window.setTimeout(() => setSlideDir(null), 280);
  }

  async function handleSaveAndNext(row: WalkListSlip, idxAtClick: number) {
    const ok = await handleSave(row);
    if (!ok) return;
    // STALE-STATE GUARD: only auto-advance if the inspector is still on
    // the slip we just saved. They may have swiped/tapped to another slip
    // while the request was in flight — respect that and don't yank them
    // back. We use a functional setter so we read the LATEST currentIndex,
    // not the closure-captured one.
    setCurrentIndex((latest) => {
      if (latest !== idxAtClick) return latest;
      const next = Math.min(latest + 1, totalSlips - 1);
      if (next === latest) return latest;
      setSlideDir('left');
      window.setTimeout(() => setSlideDir(null), 280);
      return next;
    });
  }

  /* ── Touch / pointer swipe ────────────────────────────── */
  const swipeRef = useRef<{ startX: number; startY: number; active: boolean }>({
    startX: 0,
    startY: 0,
    active: false,
  });

  function onPointerDown(e: React.PointerEvent) {
    // Don't hijack swipes that begin on text inputs / buttons.
    const target = e.target as HTMLElement;
    if (target.closest('button, textarea, input, a, label')) return;
    swipeRef.current = { startX: e.clientX, startY: e.clientY, active: true };
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!swipeRef.current.active) return;
    const dx = e.clientX - swipeRef.current.startX;
    const dy = e.clientY - swipeRef.current.startY;
    swipeRef.current.active = false;
    // Require mostly-horizontal motion of ≥ 60px so accidental scrolls
    // never flip the slip.
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) goToIndex(currentIndex + 1, 'left');
    else goToIndex(currentIndex - 1, 'right');
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

  // Empty dock — nothing to inspect.
  if (data.slips.length === 0) {
    return (
      <div style={ui.page}>
        <header style={ui.header}>
          <button style={ui.backBtn} onClick={() => navigate('/dock-walks')} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <div style={ui.headerTitle}>
            <div>{dockLabel}</div>
            <div style={ui.headerSub}>0 slips on this dock</div>
          </div>
        </header>
        <div style={ui.emptyState}>
          <Anchor size={48} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
          <div style={{ fontSize: '15px' }}>No slips on this dock to walk.</div>
        </div>
      </div>
    );
  }

  const row = data.slips[currentIndex];
  const draft = drafts[row.slip.id] ?? emptyDraft();
  const filed = !!row.item;
  const hasExpectedBoat = !!row.expectedBoat;
  const customerName = customerLabel(row.expectedCustomer);
  const slideAnim =
    slideDir === 'left'
      ? 'helm-slide-in-right 0.25s ease'
      : slideDir === 'right'
      ? 'helm-slide-in-left 0.25s ease'
      : undefined;

  function segmentColor(s: WalkListSlip): string {
    if (!s.item) return c.borderStrong;
    if (s.item.status === 'VIOLATION') return c.red;
    if (s.item.status === 'NEEDS_ATTENTION') return c.amber;
    return c.green;
  }

  const filedStatusKind: 'ok' | 'attn' | 'vio' | 'pending' = !filed
    ? 'pending'
    : row.item!.status === 'VIOLATION'
    ? 'vio'
    : row.item!.status === 'NEEDS_ATTENTION'
    ? 'attn'
    : 'ok';
  const filedStatusLabel =
    filedStatusKind === 'ok'
      ? 'Filed'
      : filedStatusKind === 'attn'
      ? 'Follow-up'
      : filedStatusKind === 'vio'
      ? 'Issue'
      : 'Not filed';

  // NB: keep the primary CTA mounted while a save is in flight (the label
  // flips to "Saving…" inside the button) so the action bar doesn't flicker
  // between primary and skip variants. inFlightRef in handleSave already
  // makes a re-tap a no-op.
  const canSave = isSaveable(draft) && !isCompleted;
  const atLast = currentIndex >= data.slips.length - 1;

  return (
    <div style={ui.page}>
      <style>{`
        @keyframes helm-slide-in-right {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes helm-slide-in-left {
          from { transform: translateX(-40px); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
        .helm-segbar::-webkit-scrollbar { display: none; }
      `}</style>

      <header style={ui.header}>
        <button style={ui.backBtn} onClick={() => navigate('/dock-walks')} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div style={ui.headerTitle}>
          <div>{dockLabel}</div>
          <div style={ui.headerSub}>
            Slip {currentIndex + 1} of {totalSlips}
            <span style={{ opacity: 0.6, margin: '0 6px' }}>·</span>
            {filedCount} filed
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

      {/* Segmented progress bar — one segment per slip, color = status */}
      <div style={ui.segmentBar} className="helm-segbar">
        {data.slips.map((s, idx) => (
          <button
            key={s.slip.id}
            type="button"
            aria-label={`Go to slip ${s.slip.slipNumber}`}
            style={{
              ...ui.segment(segmentColor(s), idx === currentIndex),
              padding: 0,
            }}
            onClick={() =>
              goToIndex(idx, idx > currentIndex ? 'left' : 'right')
            }
          />
        ))}
      </div>

      {completeError && (
        <div style={{ padding: '12px 14px', background: c.redSoft, color: c.red, fontSize: '14px' }}>
          {completeError}
        </div>
      )}

      <div
        style={{ ...ui.cardWrap, animation: slideAnim }}
        key={row.slip.id}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div style={ui.card}>
          {/* Hero header */}
          <div style={ui.hero}>
            <div style={ui.heroLabel}>Slip</div>
            <h2 style={ui.heroSlip}>{row.slip.slipNumber}</h2>
            {hasExpectedBoat ? (
              <>
                <div style={ui.heroBoat}>{boatLabel(row.expectedBoat)}</div>
                {customerName && <div style={ui.heroCustomer}>{customerName}</div>}
              </>
            ) : (
              <span style={ui.vacantPill}>Vacant — no active contract</span>
            )}
            {filed && (
              <span style={ui.statusPill(filedStatusKind)}>
                {filedStatusKind === 'ok' && <CheckCircle2 size={11} />}
                {filedStatusKind === 'attn' && <AlertTriangle size={11} />}
                {filedStatusKind === 'vio' && <AlertTriangle size={11} />}
                {filedStatusLabel}
              </span>
            )}
          </div>

          <div style={ui.body}>
            {/* Q1 — Boat in slip */}
            <div style={ui.questionLabel}>Boat in slip?</div>
            <div style={ui.buttonRow}>
              <button
                style={ui.choiceBtn(draft.boatPresent === true, 'pos')}
                onClick={() =>
                  patchDraft(row.slip.id, {
                    boatPresent: true,
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

            {/* Q2 — Right boat? (only when present + expected boat exists) */}
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

            {/* Q3 — Issue */}
            <div style={ui.questionLabel}>Issue to flag?</div>
            <div style={ui.buttonRow}>
              <button
                style={ui.choiceBtn(!draft.hasIssue, 'neutral')}
                onClick={() => patchDraft(row.slip.id, { hasIssue: false, notes: '' })}
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
                onChange={(e) => patchDraft(row.slip.id, { notes: e.target.value })}
              />
            )}

            {/* Photos (max MAX_PHOTOS_PER_SLIP per slip) */}
            <div style={ui.questionLabel}>
              Photos ({draft.photoUrls.length}/{MAX_PHOTOS_PER_SLIP})
            </div>
            <div style={ui.photoGrid}>
              {draft.photoUrls.map((key) => {
                const url = photoUrlMap[key];
                return (
                  <div key={key} style={ui.photoTile}>
                    {url ? (
                      <img
                        src={url}
                        alt="Slip"
                        style={ui.photoImg}
                        onError={() => void refreshThumbnailUrl(key)}
                      />
                    ) : (
                      <div style={ui.photoSpinner}>Loading…</div>
                    )}
                    {!isCompleted && (
                      <button
                        type="button"
                        style={ui.photoRemove}
                        onClick={() => void removePhoto(row, key)}
                        aria-label="Remove photo"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
              {!isCompleted && draft.photoUrls.length < MAX_PHOTOS_PER_SLIP && (
                <label style={ui.photoAddTile}>
                  {draft.uploading ? (
                    <>
                      <Camera size={22} />
                      <span>Uploading…</span>
                    </>
                  ) : (
                    <>
                      <Camera size={22} />
                      <span>Add photo</span>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={ui.hiddenInput}
                    disabled={draft.uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handlePhotoUpload(row.slip.id, file);
                      // Reset so the same file can be re-picked.
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  />
                </label>
              )}
            </div>
            {!isCompleted && draft.photoUrls.length >= MAX_PHOTOS_PER_SLIP && (
              <div style={ui.helperText}>
                Maximum {MAX_PHOTOS_PER_SLIP} photos per slip — remove one to add another.
              </div>
            )}
            {draft.photoError && <div style={ui.errorText}>{draft.photoError}</div>}

            {/* Save state hints */}
            {draft.hasIssue && draft.notes.trim().length === 0 && (
              <div style={ui.helperText}>
                Add a note describing the issue before saving.
              </div>
            )}
            {draft.boatPresent === null && (
              <div style={ui.helperText}>
                Pick whether a boat is in the slip to save this row.
              </div>
            )}
            {draft.error && <div style={ui.errorText}>{draft.error}</div>}
          </div>
        </div>
      </div>

      {/* Sticky bottom action bar */}
      <div style={ui.bottomBar}>
        <button
          type="button"
          style={ui.navBtn('ghost', currentIndex === 0)}
          disabled={currentIndex === 0}
          onClick={() => goToIndex(currentIndex - 1, 'right')}
          aria-label="Previous slip"
        >
          <ChevronLeft size={22} />
        </button>

        {canSave ? (
          <button
            type="button"
            style={ui.navBtn(atLast ? 'success' : 'primary', false)}
            onClick={() => handleSaveAndNext(row, currentIndex)}
          >
            {draft.saving
              ? 'Saving…'
              : filed
              ? atLast
                ? 'Update'
                : 'Update & next'
              : atLast
              ? 'Save slip'
              : 'Save & next'}
            {!atLast && !draft.saving && <ChevronRight size={20} />}
          </button>
        ) : (
          <button
            type="button"
            style={ui.navBtn('primary', atLast)}
            disabled={atLast}
            onClick={() => goToIndex(currentIndex + 1, 'left')}
          >
            {filed ? 'Next slip' : 'Skip for now'}
            {!atLast && <ChevronRight size={20} />}
          </button>
        )}
      </div>
    </div>
  );
}
