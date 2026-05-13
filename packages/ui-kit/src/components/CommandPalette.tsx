import React, { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

// Plan 19 — Keyboard-first ⌘K command palette.
//
// Mounted at app root; opens on Cmd/Ctrl+K or "/". Filters a caller-supplied
// list of commands (page-jumps, quick-actions). Optionally augments the
// list with live search results by calling an async `onSearch(term)`.

export interface CommandItem {
  /** Stable id for keyboard navigation. */
  id: string;
  /** Primary label rendered in the row. */
  label: string;
  /** Secondary line — section, route, or short description. */
  hint?: string;
  /** Optional grouping label (e.g., "Pages", "Customers", "Slips"). */
  group?: string;
  /** Optional keywords searched alongside the label. */
  keywords?: string[];
  /** Called when the user presses Enter / clicks. */
  onSelect: () => void;
}

export interface CommandPaletteProps {
  /** Static commands always available (page jumps, recent items, etc.). */
  commands: CommandItem[];
  /** Optional async lookup. Called debounced ~150ms after each keystroke. */
  onSearch?: (term: string) => Promise<CommandItem[]>;
  /** Open state — owned by the parent so app-level keyboard shortcuts work. */
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 96,
};

const panelStyle: CSSProperties = {
  width: '100%',
  maxWidth: 600,
  background: '#FFFFFF',
  borderRadius: 12,
  boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
  overflow: 'hidden',
  maxHeight: '70vh',
  display: 'flex',
  flexDirection: 'column',
};

const inputStyle: CSSProperties = {
  border: 0,
  outline: 'none',
  padding: '18px 20px',
  fontSize: 16,
  width: '100%',
  fontFamily: 'inherit',
  color: '#0A2342',
  borderBottom: '1px solid #E2E8F0',
};

const groupHeaderStyle: CSSProperties = {
  padding: '10px 16px 4px',
  fontSize: 10,
  fontWeight: 700,
  color: '#94A3B8',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

function itemStyle(active: boolean): CSSProperties {
  return {
    padding: '10px 16px',
    cursor: 'pointer',
    background: active ? '#F0F9FF' : 'transparent',
    borderLeft: active ? '3px solid #0EA5E9' : '3px solid transparent',
    display: 'flex',
    flexDirection: 'column',
  };
}

function score(item: CommandItem, term: string): number {
  if (!term) return 1;
  const needle = term.toLowerCase();
  const fields = [item.label, item.hint ?? '', (item.keywords ?? []).join(' ')];
  let s = 0;
  for (const f of fields) {
    const v = f.toLowerCase();
    if (v.startsWith(needle)) s += 3;
    else if (v.includes(needle)) s += 1;
  }
  return s;
}

export function CommandPalette({ commands, onSearch, open, onOpenChange }: CommandPaletteProps) {
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const [searchResults, setSearchResults] = useState<CommandItem[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input on open; reset term/active on close.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setTerm('');
      setActive(0);
      setSearchResults([]);
    }
  }, [open]);

  // Debounced server-side search.
  useEffect(() => {
    if (!onSearch || !open || term.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await onSearch(term);
        setSearchResults(r);
      } catch {
        setSearchResults([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [term, onSearch, open]);

  const filtered = useMemo(() => {
    const merged = [...commands, ...searchResults];
    if (!term) return merged.slice(0, 20);
    return merged
      .map((c) => ({ c, s: score(c, term) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
      .slice(0, 40);
  }, [commands, searchResults, term]);

  useEffect(() => { setActive(0); }, [term]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[active];
      if (item) {
        item.onSelect();
        onOpenChange(false);
      }
    }
  };

  if (!open) return null;

  // Build grouped render.
  const groups = new Map<string, CommandItem[]>();
  for (const item of filtered) {
    const key = item.group ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  let visibleIndex = -1;

  return (
    <div style={overlayStyle} onClick={() => onOpenChange(false)}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          style={inputStyle}
          placeholder="Type to jump or search…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              No matches.
            </div>
          ) : (
            Array.from(groups.entries()).map(([groupKey, items]) => (
              <div key={groupKey || '_'}>
                {groupKey && <div style={groupHeaderStyle}>{groupKey}</div>}
                {items.map((it) => {
                  visibleIndex += 1;
                  const isActive = visibleIndex === active;
                  return (
                    <div
                      key={it.id}
                      style={itemStyle(isActive)}
                      onMouseEnter={() => setActive(visibleIndex)}
                      onClick={() => {
                        it.onSelect();
                        onOpenChange(false);
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#0A2342', fontSize: 14 }}>{it.label}</div>
                      {it.hint && (
                        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{it.hint}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div style={{ padding: '8px 16px', fontSize: 11, color: '#94A3B8', borderTop: '1px solid #E2E8F0' }}>
          ↑↓ to move · ↵ to select · esc to close
        </div>
      </div>
    </div>
  );
}

/** Wires the standard Cmd/Ctrl+K opener onto window. Returns the open/close state. */
export function useCommandPaletteHotkey(): { open: boolean; setOpen: (v: boolean) => void } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}
