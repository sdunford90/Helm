import { useEffect, useState } from 'react';
import { useList } from '../hooks/useApi';
import { customerName, type CustomerRef } from '../lib/dto';

/**
 * Typeahead over the real customer list (GET /customers?search=). Selection
 * yields the customer record (with its id), never a free-text name.
 */
export default function CustomerPicker({
  value,
  onChange,
  inputStyle,
  placeholder = 'Search for a customer...',
}: {
  value: CustomerRef | null;
  onChange: (c: CustomerRef | null) => void;
  inputStyle?: React.CSSProperties;
  placeholder?: string;
}) {
  const [text, setText] = useState(value ? customerName(value) : '');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const search = open && debounced.length > 0 && (!value || customerName(value) !== text);
  const results = useList<CustomerRef>(search ? `/customers?take=10&search=${encodeURIComponent(debounced)}` : null);

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        placeholder={placeholder}
        value={text}
        aria-autocomplete="list"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {search && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#FFFFFF',
            border: '1px solid #CCCCCC', borderRadius: '0 0 6px 6px', maxHeight: '200px',
            overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          {results.loading && <div style={optStyle}>Searching…</div>}
          {results.error && <div style={{ ...optStyle, color: '#B71C1C' }}>{results.error}</div>}
          {!results.loading && !results.error && results.items.length === 0 && (
            <div style={{ ...optStyle, color: '#64748B' }}>No customers match “{debounced}”.</div>
          )}
          {results.items.map((c) => (
            <div
              key={c.id}
              role="option"
              aria-selected={value?.id === c.id}
              style={{ ...optStyle, cursor: 'pointer' }}
              onMouseDown={() => {
                onChange(c);
                setText(customerName(c));
                setOpen(false);
              }}
            >
              <div style={{ fontWeight: 600 }}>{customerName(c)}</div>
              {(c.email || c.company) && (
                <div style={{ fontSize: 12, color: '#64748B' }}>{[c.company, c.email].filter(Boolean).join(' · ')}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const optStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #F2F4F6',
};
