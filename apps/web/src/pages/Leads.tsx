import { useState } from 'react';
import {
  UserPlus,
  Search,
  LayoutGrid,
  List,
  ChevronDown,
  Calendar,
  Mail,
  Phone,
  Anchor,
  Globe,
  User,
} from 'lucide-react';
import LeadDetailPanel from '../components/LeadDetailPanel';
import LeadFormBuilder from '../components/LeadFormBuilder';
import { useApi } from '../hooks/useApi';

/* ── Types ─────────────────────────────────────────────── */

type Stage = 'New' | 'Contacted' | 'Qualified' | 'Proposal Sent' | 'Won' | 'Lost';
type Source = 'Website' | 'Referral' | 'Walk-in' | 'Phone' | 'Social Media';
type SlipType = 'Annual' | 'Seasonal' | 'Transient' | 'Liveaboard';

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stage: Stage;
  source: Source;
  slipType: SlipType;
  boatLength: number;
  assignedTo: string;
  createdAt: string;
  notes: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

const STAGES: Stage[] = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];
const SOURCES: Source[] = ['Website', 'Referral', 'Walk-in', 'Phone', 'Social Media'];

const MOCK_LEADS: Lead[] = [
  { id: '1', firstName: 'James', lastName: 'Morrison', email: 'james@email.com', phone: '(555) 123-4567', stage: 'New', source: 'Website', slipType: 'Annual', boatLength: 32, assignedTo: 'Sarah Chen', createdAt: '2026-03-20', notes: 'Interested in 30-35ft slip' },
  { id: '2', firstName: 'Linda', lastName: 'Park', email: 'linda.park@email.com', phone: '(555) 234-5678', stage: 'New', source: 'Referral', slipType: 'Seasonal', boatLength: 28, assignedTo: 'Mike Torres', createdAt: '2026-03-19', notes: 'Referred by member #412' },
  { id: '3', firstName: 'Robert', lastName: 'Chen', email: 'rchen@email.com', phone: '(555) 345-6789', stage: 'Contacted', source: 'Walk-in', slipType: 'Annual', boatLength: 45, assignedTo: 'Sarah Chen', createdAt: '2026-03-18', notes: 'Large yacht, needs end slip' },
  { id: '4', firstName: 'Maria', lastName: 'Santos', email: 'maria.s@email.com', phone: '(555) 456-7890', stage: 'Contacted', source: 'Website', slipType: 'Transient', boatLength: 24, assignedTo: 'Sarah Chen', createdAt: '2026-03-17', notes: 'Weekend visits only' },
  { id: '5', firstName: 'David', lastName: 'Kim', email: 'dkim@email.com', phone: '(555) 567-8901', stage: 'Qualified', source: 'Phone', slipType: 'Annual', boatLength: 38, assignedTo: 'Mike Torres', createdAt: '2026-03-15', notes: 'Ready to tour the marina' },
  { id: '6', firstName: 'Susan', lastName: 'Wright', email: 'swright@email.com', phone: '(555) 678-9012', stage: 'Qualified', source: 'Social Media', slipType: 'Liveaboard', boatLength: 42, assignedTo: 'Sarah Chen', createdAt: '2026-03-14', notes: 'Needs liveaboard permit info' },
  { id: '7', firstName: 'Tom', lastName: 'Baker', email: 'tbaker@email.com', phone: '(555) 789-0123', stage: 'Proposal Sent', source: 'Website', slipType: 'Annual', boatLength: 36, assignedTo: 'Mike Torres', createdAt: '2026-03-12', notes: 'Sent annual rate sheet' },
  { id: '8', firstName: 'Emily', lastName: 'Johnson', email: 'ejohnson@email.com', phone: '(555) 890-1234', stage: 'Won', source: 'Referral', slipType: 'Annual', boatLength: 30, assignedTo: 'Sarah Chen', createdAt: '2026-03-10', notes: 'Contract signed, awaiting deposit' },
  { id: '9', firstName: 'Mark', lastName: 'Davis', email: 'mdavis@email.com', phone: '(555) 901-2345', stage: 'Lost', source: 'Website', slipType: 'Seasonal', boatLength: 26, assignedTo: 'Mike Torres', createdAt: '2026-03-08', notes: 'Chose competitor marina' },
  { id: '10', firstName: 'Anna', lastName: 'Lee', email: 'alee@email.com', phone: '(555) 012-3456', stage: 'Proposal Sent', source: 'Walk-in', slipType: 'Transient', boatLength: 22, assignedTo: 'Sarah Chen', createdAt: '2026-03-11', notes: 'Short term stay inquiry' },
];

/* ── Stage Colors ──────────────────────────────────────── */

const STAGE_COLORS: Record<Stage, { bg: string; text: string }> = {
  New: { bg: '#D6E8F4', text: '#0A2342' },
  Contacted: { bg: '#E0F2FE', text: '#0369A1' },
  Qualified: { bg: '#FFF3CD', text: '#856404' },
  'Proposal Sent': { bg: '#E8D5F5', text: '#6B21A8' },
  Won: { bg: '#E8F5E9', text: '#1B5E20' },
  Lost: { bg: '#FDECEA', text: '#B71C1C' },
};

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  divider: {
    height: '4px',
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: '12px',
    marginBottom: '32px',
    borderRadius: '2px',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  select: {
    padding: '8px 32px 8px 12px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFF',
    appearance: 'none' as const,
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    cursor: 'pointer',
    minWidth: '140px',
  },
  searchWrap: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: '10px',
    color: '#2E4A6B',
    pointerEvents: 'none' as const,
  },
  searchInput: {
    padding: '8px 12px 8px 34px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFF',
    width: '220px',
    outline: 'none',
  },
  spacer: { flex: 1 },
  viewToggle: {
    display: 'flex',
    border: '1px solid #CCC',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  viewBtn: {
    padding: '7px 10px',
    border: 'none',
    backgroundColor: '#FFF',
    cursor: 'pointer',
    color: '#2E4A6B',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtnActive: {
    backgroundColor: '#0A2342',
    color: '#FFF',
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#0A2342',
    backgroundColor: '#FFFFFF',
    border: '1px solid #0A2342',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  /* Kanban */
  kanban: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '16px',
    overflowX: 'auto' as const,
  },
  column: {
    minWidth: '220px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0px',
  },
  colHeader: {
    backgroundColor: '#0A2342',
    color: '#FFFFFF',
    padding: '12px 16px',
    borderRadius: '8px 8px 0 0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px',
    fontWeight: 600,
  },
  colBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: '#FFFFFF',
    padding: '2px 8px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
  },
  colBody: {
    backgroundColor: '#F2F4F6',
    padding: '12px',
    borderRadius: '0 0 8px 8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
    minHeight: '120px',
    flex: 1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '8px',
    padding: '14px',
    cursor: 'pointer',
    transition: 'box-shadow 0.15s ease',
  },
  cardName: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#0A2342',
    margin: '0 0 4px 0',
  },
  cardDetail: {
    fontSize: '13px',
    color: '#2E4A6B',
    margin: '2px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '9999px',
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: '18px',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '8px',
  },
  cardDate: {
    fontSize: '12px',
    color: '#64748B',
  },
  cardAssignee: {
    fontSize: '12px',
    color: '#2E4A6B',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  /* Table */
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  th: {
    backgroundColor: '#0A2342',
    color: '#FFFFFF',
    padding: '12px 16px',
    fontSize: '13px',
    fontWeight: 600,
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#0A2342',
    borderBottom: '1px solid #E2E8F0',
    whiteSpace: 'nowrap' as const,
  },
  rowEven: { backgroundColor: '#D6E8F4' },
  rowOdd: { backgroundColor: '#FFFFFF' },
  rowHover: { cursor: 'pointer' },
};

/* ── Component ─────────────────────────────────────────── */

export default function Leads() {
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [stageFilter, setStageFilter] = useState<string>('All');
  const [sourceFilter, setSourceFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [localLeads, setLocalLeads] = useState<Lead[]>(MOCK_LEADS);

  // API calls
  const { data: apiLeads, loading, execute: refetchLeads } = useApi<Lead[]>('get', '/api/leads', { immediate: true });
  const createLeadApi = useApi<Lead>('post', '/api/leads');
  const updateLeadApi = useApi<Lead>('put', '/api/leads');

  const leads = apiLeads || localLeads;

  const filtered = leads.filter((l) => {
    if (stageFilter !== 'All' && l.stage !== stageFilter) return false;
    if (sourceFilter !== 'All' && l.source !== sourceFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const full = `${l.firstName} ${l.lastName} ${l.email}`.toLowerCase();
      if (!full.includes(q)) return false;
    }
    return true;
  });

  const leadsByStage = (stage: Stage) => filtered.filter((l) => l.stage === stage);

  return (
    <div style={s.page}>
      <h1 style={s.title}>Leads</h1>
      <hr style={s.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>Loading...</div>}

      {/* Filter Bar */}
      <div style={s.filterBar}>
        <select
          style={s.select}
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="All">All Stages</option>
          {STAGES.map((st) => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>

        <select
          style={s.select}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="All">All Sources</option>
          {SOURCES.map((src) => (
            <option key={src} value={src}>{src}</option>
          ))}
        </select>

        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={s.spacer} />

        <div style={s.viewToggle}>
          <button
            style={{ ...s.viewBtn, ...(view === 'kanban' ? s.viewBtnActive : {}) }}
            onClick={() => setView('kanban')}
            title="Board view"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            style={{ ...s.viewBtn, ...(view === 'table' ? s.viewBtnActive : {}) }}
            onClick={() => setView('table')}
            title="List view"
          >
            <List size={16} />
          </button>
        </div>

        <button style={s.secondaryBtn} onClick={() => setShowFormBuilder(true)}>
          <Globe size={16} />
          Lead Form
        </button>

        <button style={s.primaryBtn} onClick={() => setSelectedLead({
          id: '', firstName: '', lastName: '', email: '', phone: '',
          stage: 'New', source: 'Website', slipType: 'Annual',
          boatLength: 0, assignedTo: '', createdAt: new Date().toISOString().slice(0, 10), notes: '',
        })}>
          <UserPlus size={16} />
          Add Lead
        </button>
      </div>

      {/* Kanban View */}
      {view === 'kanban' && (
        <div style={s.kanban}>
          {STAGES.map((stage) => {
            const leads = leadsByStage(stage);
            return (
              <div key={stage} style={s.column}>
                <div style={s.colHeader}>
                  <span>{stage}</span>
                  <span style={s.colBadge}>{leads.length}</span>
                </div>
                <div style={s.colBody}>
                  {leads.map((lead) => (
                    <div
                      key={lead.id}
                      style={s.card}
                      onClick={() => setSelectedLead(lead)}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                      }}
                    >
                      <div style={s.cardName}>{lead.firstName} {lead.lastName}</div>
                      <div style={s.cardDetail}>
                        <Mail size={12} /> {lead.email}
                      </div>
                      <div style={s.cardDetail}>
                        <Anchor size={12} /> {lead.slipType} &middot; {lead.boatLength}ft
                      </div>
                      <div style={s.cardDetail}>
                        <Globe size={12} /> {lead.source}
                      </div>
                      <div style={s.cardFooter}>
                        <span style={s.cardDate}>
                          <Calendar size={11} /> {lead.createdAt}
                        </span>
                        <span style={s.cardAssignee}>
                          <User size={11} /> {lead.assignedTo}
                        </span>
                      </div>
                      <div style={{ marginTop: '8px' }}>
                        <span
                          style={{
                            ...s.badge,
                            backgroundColor: STAGE_COLORS[lead.stage].bg,
                            color: STAGE_COLORS[lead.stage].text,
                          }}
                        >
                          {lead.stage}
                        </span>
                      </div>
                    </div>
                  ))}
                  {leads.length === 0 && (
                    <div style={{ fontSize: '13px', color: '#64748B', textAlign: 'center', padding: '24px 0' }}>
                      No leads
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View */}
      {view === 'table' && (
        <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Email</th>
                <th style={s.th}>Phone</th>
                <th style={s.th}>Stage</th>
                <th style={s.th}>Source</th>
                <th style={s.th}>Assigned To</th>
                <th style={s.th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, idx) => (
                <tr
                  key={lead.id}
                  style={{
                    ...(idx % 2 === 0 ? s.rowOdd : s.rowEven),
                    ...s.rowHover,
                  }}
                  onClick={() => setSelectedLead(lead)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#EBF2FA';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                      idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  }}
                >
                  <td style={s.td}>{lead.firstName} {lead.lastName}</td>
                  <td style={s.td}>{lead.email}</td>
                  <td style={s.td}>{lead.phone}</td>
                  <td style={s.td}>
                    <span
                      style={{
                        ...s.badge,
                        backgroundColor: STAGE_COLORS[lead.stage].bg,
                        color: STAGE_COLORS[lead.stage].text,
                      }}
                    >
                      {lead.stage}
                    </span>
                  </td>
                  <td style={s.td}>{lead.source}</td>
                  <td style={s.td}>{lead.assignedTo}</td>
                  <td style={s.td}>{lead.createdAt}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={7}>
                    No leads match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Lead Detail Panel */}
      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onSave={(updated) => {
            if (updated.id) {
              setLocalLeads((prev) => prev.map((l) => l.id === updated.id ? updated : l));
              updateLeadApi.execute(updated).then(() => refetchLeads());
            } else {
              const newLead = { ...updated, id: String(Date.now()) };
              setLocalLeads((prev) => [newLead, ...prev]);
              createLeadApi.execute(newLead).then(() => refetchLeads());
            }
            setSelectedLead(null);
          }}
          onStageChange={async (newStage) => {
            const updated = { ...selectedLead, stage: newStage as Stage };
            setSelectedLead(updated);
            setLocalLeads((prev) => prev.map((l) => l.id === selectedLead.id ? updated : l));
            if (selectedLead.id) {
              await updateLeadApi.execute(updated);
              refetchLeads();
            }
          }}
        />
      )}

      {/* Form Builder Modal */}
      {showFormBuilder && (
        <LeadFormBuilder onClose={() => setShowFormBuilder(false)} />
      )}
    </div>
  );
}
