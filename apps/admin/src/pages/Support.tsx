import React, { useCallback, useEffect, useState } from 'react';
import { useApiFetch } from '../lib/api';
import { canMutate, useAdminMe } from '../hooks/useAdminMe';

type TicketStatus = 'open' | 'in_progress' | 'waiting_on_customer' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

interface Ticket {
  id: string;
  tenantId: string;
  tenantName: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TicketResponse {
  items: Ticket[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface TenantOption {
  id: string;
  name: string;
}

const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  low: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' },
  medium: { bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  high: { bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  urgent: { bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  open: { bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
  in_progress: { bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  waiting_on_customer: { bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  resolved: { bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  closed: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' },
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_on_customer: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const inputStyle: React.CSSProperties = {
  background: '#070E18',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#FFF',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const formatDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
};

// A10 — Ticket timeline component. Renders the chronological event feed
// for one ticket and lets a platform admin add an internal note inline.

interface TicketEvent {
  id: string;
  ticketId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  kind: 'NOTE' | 'STATUS' | 'ASSIGNMENT' | 'REPLY';
  body: string | null;
  status: string | null;
  assignedTo: string | null;
  internal: boolean;
  createdAt: string;
}

const TicketTimeline: React.FC<{ ticketId: string; allowedToMutate: boolean; apiFetch: ReturnType<typeof useApiFetch> }> = ({ ticketId, allowedToMutate, apiFetch }) => {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await apiFetch<{ events: TicketEvent[] }>(`/api/admin/support/tickets/${ticketId}/events`);
      setEvents(body.events ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [apiFetch, ticketId]);

  useEffect(() => { void load(); }, [load]);

  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/admin/support/tickets/${ticketId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: note.trim(), internal: true }),
      });
      setNote('');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>
        Timeline ({events.length})
      </div>
      {err && (
        <div style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 8 }}>{err}</div>
      )}
      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>No activity yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 240, overflowY: 'auto' }}>
          {events.map((ev) => (
            <div key={ev.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
              <div style={{ color: 'rgba(255,255,255,0.4)' }}>
                {new Date(ev.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
              <div>
                <span style={{
                  display: 'inline-block', padding: '1px 6px', borderRadius: 4, marginRight: 6,
                  fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                  background: ev.kind === 'NOTE' ? 'rgba(250,204,21,0.15)' : 'rgba(96,165,250,0.15)',
                  color: ev.kind === 'NOTE' ? '#FDE68A' : '#BFDBFE',
                }}>
                  {ev.kind === 'NOTE' && ev.internal ? 'INTERNAL' : ev.kind}
                </span>
                <span>{ev.body ?? `Status set to ${ev.status ?? ev.assignedTo ?? '—'}`}</span>
                {ev.actorEmail && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    by {ev.actorEmail}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {allowedToMutate && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add an internal note…"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addNote(); } }}
            style={{
              flex: 1, padding: '8px 12px', fontSize: 13, background: '#070E18',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#FFFFFF',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={addNote}
            disabled={saving || !note.trim()}
            style={{
              padding: '8px 16px', fontSize: 12, fontWeight: 600,
              background: 'rgba(250,204,21,0.18)', color: '#FDE68A',
              border: '1px solid rgba(250,204,21,0.3)', borderRadius: 6,
              cursor: saving || !note.trim() ? 'wait' : 'pointer',
              opacity: saving || !note.trim() ? 0.5 : 1,
              fontFamily: 'inherit',
            }}
          >
            {saving ? 'Adding…' : 'Add note'}
          </button>
        </div>
      )}
    </div>
  );
};

const Support: React.FC = () => {
  const apiFetch = useApiFetch();
  const { me } = useAdminMe();
  const allowedToMutate = canMutate(me);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [editStatus, setEditStatus] = useState<TicketStatus>('open');
  const [editPriority, setEditPriority] = useState<TicketPriority>('low');
  const [savingEdit, setSavingEdit] = useState(false);

  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createTenantId, setCreateTenantId] = useState('');
  const [createSubject, setCreateSubject] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createPriority, setCreatePriority] = useState<TicketPriority>('medium');
  const [creating, setCreating] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      const data = await apiFetch<TicketResponse>(`/api/admin/support/tickets?${params.toString()}`);
      setTickets(data.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, statusFilter, priorityFilter]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Tenant list for the "Create ticket" dropdown. Best-effort — if it
  // fails the modal still works, we just don't autocomplete tenant names.
  useEffect(() => {
    let aborted = false;
    apiFetch<{ items: TenantOption[] }>('/api/admin/tenants?limit=100')
      .then((data) => { if (!aborted) setTenants(data.items); })
      .catch(() => { if (!aborted) setTenants([]); });
    return () => { aborted = true; };
  }, [apiFetch]);

  const openCount = tickets.filter((t) => t.status === 'open').length;
  const highCount = tickets.filter((t) => t.priority === 'high' || t.priority === 'urgent').length;
  const resolvedCount = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length;

  const handleSelectTicket = (t: Ticket) => {
    setSelectedTicket(t);
    setEditStatus(t.status);
    setEditPriority(t.priority);
  };

  const handleUpdateTicket = async () => {
    if (!selectedTicket || !allowedToMutate) return;
    setSavingEdit(true);
    setError(null);
    try {
      const updated = await apiFetch<Ticket>(`/api/admin/support/tickets/${selectedTicket.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: editStatus, priority: editPriority }),
      });
      setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSelectedTicket(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleResolveTicket = async () => {
    if (!selectedTicket || !allowedToMutate) return;
    setSavingEdit(true);
    setError(null);
    try {
      const updated = await apiFetch<Ticket>(`/api/admin/support/tickets/${selectedTicket.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'resolved' }),
      });
      setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSelectedTicket(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!createTenantId || !createSubject.trim() || !createDescription.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<Ticket>('/api/admin/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: createTenantId,
          subject: createSubject.trim(),
          description: createDescription.trim(),
          priority: createPriority,
        }),
      });
      setTickets((prev) => [created, ...prev]);
      setShowCreate(false);
      setCreateTenantId('');
      setCreateSubject('');
      setCreateDescription('');
      setCreatePriority('medium');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Total Tickets', value: tickets.length.toString(), color: '#2196F3' },
          { label: 'Open', value: openCount.toString(), color: '#F44336' },
          { label: 'High/Urgent', value: highCount.toString(), color: '#FF9800' },
          { label: 'Resolved/Closed', value: resolvedCount.toString(), color: '#4CAF50' },
        ].map((s) => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{
          background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.2)',
          borderRadius: 6, padding: 12, color: '#F44336', fontSize: 13, marginBottom: 12,
        }}>{error}</div>
      )}

      {/* Filters + Create */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 14px', color: '#FFF', fontSize: 13, outline: 'none' }}>
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="waiting_on_customer">Waiting</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 14px', color: '#FFF', fontSize: 13, outline: 'none' }}>
          <option value="all">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <div style={{ flex: 1 }} />
        {allowedToMutate && (
          <button
            onClick={() => setShowCreate(true)}
            style={{ background: '#0A2342', border: '1px solid #00D4FF', borderRadius: 6, padding: '8px 16px', color: '#00D4FF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >+ New Ticket</button>
        )}
      </div>

      {/* Table */}
      <div style={card}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            No tickets match the current filters.{statusFilter === 'all' && priorityFilter === 'all' ? ' Create one with the button above.' : ''}
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Ticket #', 'Tenant', 'Subject', 'Priority', 'Status', 'Created', 'Assignee'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 10px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const ps = PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.low;
                  const ss = STATUS_STYLE[t.status] ?? STATUS_STYLE.open;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => handleSelectTicket(t)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '10px', fontSize: 13, fontWeight: 600, color: '#00D4FF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.id.slice(0, 8)}</td>
                      <td style={{ padding: '10px', fontSize: 12, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.tenantName}</td>
                      <td style={{ padding: '10px', fontSize: 13, color: '#FFF', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.04)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</td>
                      <td style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ background: ps.bg, color: ps.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{t.priority}</span>
                      </td>
                      <td style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ background: ss.bg, color: ss.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{STATUS_LABEL[t.status] ?? t.status}</span>
                      </td>
                      <td style={{ padding: '10px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{formatDate(t.createdAt)}</td>
                      <td style={{ padding: '10px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.assignedTo ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: '12px 10px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
              Showing {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
            </div>
          </>
        )}
      </div>

      {/* Detail Modal */}
      {selectedTicket && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 32, width: 520, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#00D4FF', marginBottom: 4 }}>{selectedTicket.id.slice(0, 8)}</div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#FFF' }}>{selectedTicket.subject}</h3>
              </div>
              <button onClick={() => setSelectedTicket(null)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer', padding: 4 }}>x</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {[
                ['Tenant', selectedTicket.tenantName],
                ['Assignee', selectedTicket.assignedTo ?? '—'],
                ['Created', formatDate(selectedTicket.createdAt)],
                ['Updated', formatDate(selectedTicket.updatedAt)],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>{l}</div>
                  <div style={{ fontSize: 13, color: '#FFF', fontWeight: 500 }}>{v}</div>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                <select value={editStatus} disabled={!allowedToMutate} onChange={(e) => setEditStatus(e.target.value as TicketStatus)} style={{ ...inputStyle }}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="waiting_on_customer">Waiting</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Priority</div>
                <select value={editPriority} disabled={!allowedToMutate} onChange={(e) => setEditPriority(e.target.value as TicketPriority)} style={{ ...inputStyle }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>Description</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedTicket.description}</div>
            </div>
            <TicketTimeline ticketId={selectedTicket.id} allowedToMutate={allowedToMutate} apiFetch={apiFetch} />
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setSelectedTicket(null)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '8px 16px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              {allowedToMutate && selectedTicket.status !== 'resolved' && selectedTicket.status !== 'closed' && (
                <button
                  onClick={handleResolveTicket}
                  disabled={savingEdit}
                  style={{ background: 'transparent', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 6, padding: '8px 16px', color: '#4CAF50', fontSize: 13, fontWeight: 600, cursor: savingEdit ? 'wait' : 'pointer' }}
                >Mark Resolved</button>
              )}
              {allowedToMutate && (
                <button
                  onClick={handleUpdateTicket}
                  disabled={savingEdit}
                  style={{ background: '#0A2342', border: '1px solid #00D4FF', borderRadius: 6, padding: '8px 16px', color: '#00D4FF', fontSize: 13, fontWeight: 600, cursor: savingEdit ? 'wait' : 'pointer' }}
                >{savingEdit ? 'Saving…' : 'Save Changes'}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 32, width: 520 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#FFF', marginBottom: 20 }}>New Support Ticket</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Tenant</div>
                <select value={createTenantId} onChange={(e) => setCreateTenantId(e.target.value)} style={inputStyle}>
                  <option value="">— select tenant —</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Subject</div>
                <input value={createSubject} onChange={(e) => setCreateSubject(e.target.value)} placeholder="Short subject line" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Description</div>
                <textarea
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="What happened?"
                  style={{ ...inputStyle, minHeight: 100, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Priority</div>
                <select value={createPriority} onChange={(e) => setCreatePriority(e.target.value as TicketPriority)} style={inputStyle}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} disabled={creating} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '8px 16px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleCreateTicket}
                disabled={creating || !createTenantId || !createSubject.trim() || !createDescription.trim()}
                style={{
                  background: '#0A2342',
                  border: '1px solid #00D4FF',
                  borderRadius: 6,
                  padding: '8px 16px',
                  color: '#00D4FF',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: creating ? 'wait' : 'pointer',
                  opacity: !createTenantId || !createSubject.trim() || !createDescription.trim() ? 0.5 : 1,
                }}
              >{creating ? 'Creating…' : 'Create Ticket'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Support;
