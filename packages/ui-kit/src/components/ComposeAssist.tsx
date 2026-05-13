import React, { CSSProperties, useState } from 'react';

// Plan 33 — Email/message draft rewriter.
//
// Drop-in panel above a textarea: user types a draft, picks a tone, clicks
// Rewrite. The returned text is shown side-by-side with Apply / Discard so
// nothing replaces their draft without consent. Caller passes onApply to
// commit the rewrite back to their own state.

export type ComposeTone = 'friendly' | 'firm' | 'formal' | 'concise';

export interface ComposeAssistProps {
  draft: string;
  /** Optional one-paragraph hint about who this is going to and why. */
  context?: string;
  /** Called when the user clicks "Apply" on a returned rewrite. */
  onApply: (rewritten: string) => void;
  /**
   * Endpoint to hit. Defaults to /api/compose-assist. Useful if you want
   * to point staff vs portal at different paths.
   */
  endpoint?: string;
  /** Function that returns a Clerk auth token. */
  getToken?: () => Promise<string | null>;
}

const TONES: { value: ComposeTone; label: string; hint: string }[] = [
  { value: 'friendly', label: 'Friendly', hint: 'warm, conversational' },
  { value: 'firm', label: 'Firm', hint: 'direct, no hedging' },
  { value: 'formal', label: 'Formal', hint: 'business polish, no contractions' },
  { value: 'concise', label: 'Concise', hint: 'cut every non-essential word' },
];

const styles: Record<string, CSSProperties> = {
  card: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 13, fontWeight: 700, color: '#0A2342', margin: 0 },
  toneRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  toneBtn: {
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    border: '1px solid #CBD5E1',
    background: '#FFFFFF',
    color: '#0A2342',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  toneBtnActive: {
    background: '#0A2342',
    color: '#FFFFFF',
    borderColor: '#0A2342',
  },
  rewriteBtn: {
    background: '#0A2342',
    color: '#FFFFFF',
    border: 0,
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  err: {
    background: '#FEE2E2',
    color: '#991B1B',
    padding: 8,
    borderRadius: 6,
    fontSize: 12,
    marginTop: 8,
  },
  preview: {
    marginTop: 10,
    padding: 12,
    background: '#F0F9FF',
    border: '1px solid #BAE6FD',
    borderRadius: 6,
    fontSize: 13,
    lineHeight: 1.5,
    color: '#0A2342',
    whiteSpace: 'pre-wrap' as const,
  },
  previewActions: { marginTop: 8, display: 'flex', gap: 8 },
  applyBtn: {
    background: '#0EA5E9',
    color: '#FFFFFF',
    border: 0,
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  discardBtn: {
    background: '#FFFFFF',
    color: '#475569',
    border: '1px solid #CBD5E1',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  hint: { fontSize: 11, color: '#94A3B8', marginTop: 6 },
};

export function ComposeAssist({
  draft,
  context,
  onApply,
  endpoint = '/api/compose-assist',
  getToken,
}: ComposeAssistProps) {
  const [tone, setTone] = useState<ComposeTone>('friendly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rewritten, setRewritten] = useState<string | null>(null);

  const rewrite = async () => {
    setError(null);
    setRewritten(null);
    if (!draft.trim()) {
      setError('Write a draft first.');
      return;
    }
    setBusy(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (getToken) {
        const token = await getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ draft, tone, context }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const data = (await res.json()) as { rewritten: string };
      if (data.rewritten === 'NO_DRAFT') {
        setError("Couldn't make sense of the draft. Try expanding it.");
        return;
      }
      setRewritten(data.rewritten);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (rewritten) {
      onApply(rewritten);
      setRewritten(null);
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <h4 style={styles.title}>Rewrite assistant</h4>
        <button style={styles.rewriteBtn} onClick={rewrite} disabled={busy}>
          {busy ? 'Rewriting…' : 'Rewrite'}
        </button>
      </div>
      <div style={styles.toneRow}>
        {TONES.map((t) => {
          const active = t.value === tone;
          return (
            <button
              key={t.value}
              style={{ ...styles.toneBtn, ...(active ? styles.toneBtnActive : {}) }}
              onClick={() => setTone(t.value)}
              title={t.hint}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={styles.hint}>
        Rewrites are drafts. Nothing replaces your text until you click Apply.
      </div>

      {error && <div style={styles.err}>{error}</div>}

      {rewritten && (
        <>
          <div style={styles.preview}>{rewritten}</div>
          <div style={styles.previewActions}>
            <button style={styles.applyBtn} onClick={apply}>
              Apply
            </button>
            <button style={styles.discardBtn} onClick={() => setRewritten(null)}>
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
