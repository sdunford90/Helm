import React, { useState } from 'react';

interface Ticket {
  id: string;
  tenant: string;
  subject: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  created: string;
  assignee: string;
  description: string;
}

const INITIAL_TICKETS: Ticket[] = [
  { id: 'T-1042', tenant: 'Sunset Cove Marina', subject: 'Custom domain SSL certificate not working', category: 'Technical', priority: 'high', status: 'open', created: '2026-03-22', assignee: 'Mike D.', description: 'SSL cert provisioning failed for marina.sunsetcove.com.' },
  { id: 'T-1041', tenant: 'Pacific Coast Marina', subject: 'Request for bulk invoice export', category: 'Feature Request', priority: 'medium', status: 'in_progress', created: '2026-03-21', assignee: 'Sarah A.', description: 'Need ability to export all invoices as CSV for tax season.' },
  { id: 'T-1040', tenant: 'Fisherman\'s Wharf Marina', subject: 'Stripe payout delayed', category: 'Billing', priority: 'high', status: 'open', created: '2026-03-20', assignee: 'Mike D.', description: 'Weekly payout has not arrived, it has been 5 business days.' },
  { id: 'T-1039', tenant: 'Old Port Marina', subject: 'Cannot update payment method', category: 'Billing', priority: 'urgent', status: 'open', created: '2026-03-19', assignee: 'Sarah A.', description: 'Card on file expired, and the update form shows an error.' },
  { id: 'T-1038', tenant: 'Sunset Cove Marina', subject: 'How to customize invoice template', category: 'General', priority: 'low', status: 'resolved', created: '2026-03-15', assignee: 'Alex K.', description: 'Looking for guidance on changing invoice logo and colors.' },
  { id: 'T-1037', tenant: 'Blue Horizon Marina', subject: 'Waitlist notification not sending', category: 'Technical', priority: 'medium', status: 'waiting', created: '2026-03-14', assignee: 'Mike D.', description: 'Automated waitlist emails stopped going out two days ago.' },
  { id: 'T-1036', tenant: 'Anchor Point Marina', subject: 'Request for annual billing option', category: 'Feature Request', priority: 'low', status: 'closed', created: '2026-03-10', assignee: 'Sarah A.', description: 'Would like to pay annually for a discount.' },
  { id: 'T-1035', tenant: 'Windward Yacht Harbor', subject: 'API rate limit too low', category: 'Technical', priority: 'medium', status: 'in_progress', created: '2026-03-08', assignee: 'Alex K.', description: 'Hitting 100 req/min limit during peak booking hours.' },
  { id: 'T-1034', tenant: 'Coral Reef Marina', subject: 'QuickBooks sync duplicating invoices', category: 'Technical', priority: 'high', status: 'open', created: '2026-03-07', assignee: 'Mike D.', description: 'QBO integration is creating duplicate invoice entries.' },
  { id: 'T-1033', tenant: 'Seabreeze Marina', subject: 'Onboarding documentation unclear', category: 'General', priority: 'low', status: 'resolved', created: '2026-03-05', assignee: 'Alex K.', description: 'Suggestions for improving the getting started guide.' },
];

const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  low: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' },
  medium: { bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  high: { bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  urgent: { bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  open: { bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
  in_progress: { bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
  waiting: { bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
  resolved: { bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  closed: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' },
};

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const Support: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>(INITIAL_TICKETS);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [editStatus, setEditStatus] = useState<Ticket['status']>('open');
  const [editPriority, setEditPriority] = useState<Ticket['priority']>('low');

  const filtered = tickets.filter((t) => {
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchPriority = priorityFilter === 'all' || t.priority === priorityFilter;
    return matchStatus && matchPriority;
  });

  const openCount = tickets.filter((t) => t.status === 'open').length;
  const highCount = tickets.filter((t) => t.priority === 'high' || t.priority === 'urgent').length;

  const handleSelectTicket = (t: Ticket) => {
    setSelectedTicket(t);
    setEditStatus(t.status);
    setEditPriority(t.priority);
  };

  const handleUpdateTicket = () => {
    if (!selectedTicket) return;
    setTickets((prev) =>
      prev.map((t) =>
        t.id === selectedTicket.id ? { ...t, status: editStatus, priority: editPriority } : t
      )
    );
    setSelectedTicket(null);
  };

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Total Tickets', value: tickets.length.toString(), color: '#2196F3' },
          { label: 'Open', value: openCount.toString(), color: '#F44336' },
          { label: 'High/Urgent', value: highCount.toString(), color: '#FF9800' },
          { label: 'Avg Resolution', value: '4.2 hrs', color: '#4CAF50' },
        ].map((s) => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 14px', color: '#FFF', fontSize: 13, outline: 'none' }}>
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="waiting">Waiting</option>
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
      </div>

      {/* Table */}
      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Ticket #', 'Tenant', 'Subject', 'Category', 'Priority', 'Status', 'Created', 'Assignee'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 10px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const ps = PRIORITY_STYLE[t.priority];
              const ss = STATUS_STYLE[t.status];
              return (
                <tr
                  key={t.id}
                  onClick={() => handleSelectTicket(t)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px', fontSize: 13, fontWeight: 600, color: '#00D4FF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.id}</td>
                  <td style={{ padding: '10px', fontSize: 12, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.tenant}</td>
                  <td style={{ padding: '10px', fontSize: 13, color: '#FFF', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.04)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</td>
                  <td style={{ padding: '10px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.category}</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ background: ps.bg, color: ps.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{t.priority}</span>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ background: ss.bg, color: ss.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{t.status.replace('_', ' ')}</span>
                  </td>
                  <td style={{ padding: '10px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.created}</td>
                  <td style={{ padding: '10px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.assignee}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: '12px 10px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Showing {filtered.length} of {tickets.length} tickets</div>
      </div>

      {/* Detail Modal */}
      {selectedTicket && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 32, width: 520, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', marginBottom: 4 }}>{selectedTicket.id}</div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#FFF' }}>{selectedTicket.subject}</h3>
              </div>
              <button onClick={() => setSelectedTicket(null)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer', padding: 4 }}>x</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {[
                ['Tenant', selectedTicket.tenant],
                ['Category', selectedTicket.category],
                ['Assignee', selectedTicket.assignee],
                ['Created', selectedTicket.created],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>{l}</div>
                  <div style={{ fontSize: 13, color: '#FFF', fontWeight: 500 }}>{v}</div>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as Ticket['status'])} style={{ background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 12px', color: '#FFF', fontSize: 13, outline: 'none', width: '100%' }}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="waiting">Waiting</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Priority</div>
                <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as Ticket['priority'])} style={{ background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 12px', color: '#FFF', fontSize: 13, outline: 'none', width: '100%' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>Description</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>{selectedTicket.description}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setSelectedTicket(null)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '8px 16px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleUpdateTicket} style={{ background: '#0A2342', border: '1px solid #00D4FF', borderRadius: 6, padding: '8px 16px', color: '#00D4FF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Support;
