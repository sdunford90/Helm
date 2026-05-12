import React, { useEffect, useRef, useState } from 'react';

export interface RatePlanOption {
  id: string;
  name?: string | null;
  slipType: string;
  monthlyRateCents: number;
}

export function planLabel(p: RatePlanOption): string {
  return `${p.name ? `${p.name} · ` : ''}${p.slipType} · $${(p.monthlyRateCents / 100).toFixed(0)}/mo`;
}

interface RatePlanPickerProps<T extends RatePlanOption> {
  value: string;
  plans: T[];
  onChange: (id: string, plan: T | null) => void;
  placeholder?: string;
  disabled?: boolean;
  inputStyle?: React.CSSProperties;
  title?: string;
}

export default function RatePlanPicker<T extends RatePlanOption>({
  value,
  plans,
  onChange,
  placeholder,
  disabled,
  inputStyle,
  title,
}: RatePlanPickerProps<T>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = plans.find((p) => p.id === value) ?? null;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? plans.filter(
        (p) =>
          (p.name ?? '').toLowerCase().includes(q) ||
          p.slipType.toLowerCase().includes(q),
      )
    : plans;

  const displayValue = open ? query : selected ? planLabel(selected) : '';
  const placeholderText = placeholder ?? (selected ? planLabel(selected) : 'Search rate plans…');

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        style={inputStyle}
        value={displayValue}
        placeholder={placeholderText}
        title={title}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {selected && !open && !disabled && (
        <button
          type="button"
          aria-label="Clear rate plan"
          onMouseDown={(e) => {
            e.preventDefault();
            onChange('', null);
          }}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#64748B',
            fontSize: 16,
            lineHeight: 1,
            padding: 2,
          }}
        >
          ×
        </button>
      )}
      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            zIndex: 30,
            top: '100%',
            left: 0,
            right: 0,
            background: '#FFFFFF',
            border: '1px solid #CCC',
            borderRadius: 4,
            marginTop: 2,
            maxHeight: 240,
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              fontSize: 13,
              color: '#64748B',
              borderBottom: '1px solid #F1F5F9',
              background: value === '' ? '#F1F5F9' : '#FFF',
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('', null);
              setOpen(false);
              setQuery('');
            }}
          >
            Unlinked (legacy fallback)
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: 13, color: '#94A3B8' }}>
              No matching plans
            </div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: '#0A2342',
                  background: p.id === value ? '#F1F5F9' : '#FFF',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(p.id, p);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {planLabel(p)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
