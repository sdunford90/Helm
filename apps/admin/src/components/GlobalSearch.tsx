import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface SearchResults {
  query: string;
  groups: {
    tenants: { id: string; name: string; subdomain: string; status: string }[];
    users: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      tenantId: string;
      tenantName: string | null;
    }[];
    boats: {
      id: string;
      name: string | null;
      registrationNumber: string | null;
      make: string | null;
      model: string | null;
      year: number | null;
      tenantId: string;
      customerId: string;
    }[];
    saasInvoices: {
      id: string;
      tenantId: string;
      tenantName: string;
      amountCents: number;
      status: string;
      issuedAt: string;
    }[];
  };
}

const EMPTY_RESULTS: SearchResults = {
  query: '',
  groups: { tenants: [], users: [], boats: [], saasInvoices: [] },
};

const GlobalSearch: React.FC = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data: SearchResults = await res.json();
        setResults(data);
      } else {
        setResults(EMPTY_RESULTS);
      }
    } catch {
      setResults(EMPTY_RESULTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => runSearch(q), 220);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [q, runSearch]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const goTo = (path: string) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };

  const totalCount =
    results.groups.tenants.length +
    results.groups.users.length +
    results.groups.boats.length +
    results.groups.saasInvoices.length;

  const groupHeader: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.4)',
    padding: '10px 14px 6px',
  };
  const row: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 13,
    color: '#FFF',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  };
  const sub: React.CSSProperties = { fontSize: 11, color: 'rgba(255,255,255,0.5)' };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: 360 }}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search tenants, users, boats, invoices…"
        style={{
          width: '100%',
          background: '#0A1929',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          padding: '8px 12px',
          color: '#FFF',
          fontSize: 13,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {open && q.trim().length >= 2 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#0D1B2A',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            boxShadow: '0 12px 24px rgba(0,0,0,0.45)',
            maxHeight: 460,
            overflowY: 'auto',
            zIndex: 200,
          }}
        >
          {loading && (
            <div style={{ padding: 14, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Searching…</div>
          )}

          {!loading && totalCount === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>No results.</div>
          )}

          {results.groups.tenants.length > 0 && (
            <div>
              <div style={groupHeader}>Tenants ({results.groups.tenants.length})</div>
              {results.groups.tenants.map((t) => (
                <div key={t.id} style={row} onClick={() => goTo(`/tenants/${t.id}`)}>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div style={sub}>{t.subdomain}.gethelm.com · {t.status}</div>
                </div>
              ))}
            </div>
          )}

          {results.groups.users.length > 0 && (
            <div>
              <div style={groupHeader}>Users ({results.groups.users.length})</div>
              {results.groups.users.map((u) => (
                <div
                  key={u.id}
                  style={row}
                  onClick={() => goTo(`/tenants/${u.tenantId}`)}
                >
                  <div style={{ fontWeight: 600 }}>
                    {u.firstName} {u.lastName} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>· {u.email}</span>
                  </div>
                  <div style={sub}>{u.role}{u.tenantName ? ` @ ${u.tenantName}` : ''}</div>
                </div>
              ))}
            </div>
          )}

          {results.groups.boats.length > 0 && (
            <div>
              <div style={groupHeader}>Boats ({results.groups.boats.length})</div>
              {results.groups.boats.map((b) => (
                <div
                  key={b.id}
                  style={row}
                  onClick={() => goTo(`/tenants/${b.tenantId}`)}
                >
                  <div style={{ fontWeight: 600 }}>
                    {b.name ?? '(unnamed)'}
                    {b.registrationNumber && (
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}> · {b.registrationNumber}</span>
                    )}
                  </div>
                  <div style={sub}>
                    {[b.year, b.make, b.model].filter(Boolean).join(' ') || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.groups.saasInvoices.length > 0 && (
            <div>
              <div style={groupHeader}>SaaS Invoices ({results.groups.saasInvoices.length})</div>
              {results.groups.saasInvoices.map((i) => (
                <div key={i.id} style={row} onClick={() => goTo(`/billing`)}>
                  <div style={{ fontWeight: 600 }}>
                    ${(i.amountCents / 100).toFixed(2)} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>· {i.status}</span>
                  </div>
                  <div style={sub}>{i.tenantName} · {new Date(i.issuedAt).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
