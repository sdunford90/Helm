import { useState, useEffect } from 'react';
import {
  UserPlus,
  Search,
  LayoutGrid,
  List,
  Calendar,
  Mail,
  Anchor,
  Globe,
  User,
} from 'lucide-react';
import LeadDetailPanel from '../components/LeadDetailPanel';
import LeadFormBuilder from '../components/LeadFormBuilder';
import { api } from '../lib/api';

/* ── Types ─────────────────────────────────────────── */

type Stage = 'New' | 'Contacted' | 'Qualified' | 'Proposal Sent' | 'Won' | 'Lost';
type Source = 'Website' | 'Referral' | 'Walk-in' | 'Phone' | 'Social Media';

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stage: Stage;
  source: Source;
  slipType: string;
  boatLength: number;
  assignedTo: string;
  createdAt: string;
  notes: string;
}

/* ── Stage Colors ──────────────────────────────────── */

const STAGES: Stage[] = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];
const SOURCES: Source[] = ['Website', 'Referral', 'Walk-in', 'Phone', 'Social Media'];

const API_STAGE_MAP: Record<string, Stage> = {
  NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified',
  PROPOSAL_SENT: 'Proposal Sent', WON: 'Won', LOST: 'Lost',
};

const STAGE_COLORS: Record<Stage, { bg: string; text: string }> = {
  New: { bg: '#D6E8F4', text: '#0A2342' },
  Contacted: { bg: '#E0F2FE', text: '#0369A1' },
  Qualified: { bg: '#FFF3CD', text: '#856404' },
  'Proposal Sent': { bg: '#E8D5F5', text: '#6B21A8' },
  Won: { bg: '#E8F5E9', text: '#1B5E20' },
  Lost: { bg: '#FDECEA', text: '#B71C1C' },
};

/* ── Styles ────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  select: { padding: '8px 32px 8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', appearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', cursor: 'pointer', minWidth: '140px' },
  searchWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute' as const, left: '10px', color: '#2E4A6B', pointerEvents: 'none' as const },
  searchInput: { padding: '8px 12px 8px 34px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', width: '220px', outline: 'none' },
  spacer: { flex: 1 },
  viewToggle: { display: 'flex', border: '1px solid #CCC', borderRadius: '6px', overflow: 'hidden' },
  viewBtn: { padding: '7px 10px', border: 'none', backgroundColor: '#FFF', cursor: 'pointer', color: '#2E4A6B', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  viewBtnActive: { backgroundColor: '#0A2342', color: '#FFF' },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  secondaryBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #0A2342', borderRadius: '6px', cursor: 'pointer' },
  kanban: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px', overflowX: 'auto' as const },
  column: { minWidth: '220px', display: 'flex', flexDirection: 'column' as const, gap: '0px' },
  colHeader: { backgroundColor: '#0A2342', color: '#FFFFFF', padding: '12px 16px', borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px', fontWeight: 600 },
  colBadge: { backgroundColor: 'rgba(255,255,255,0.2)', color: '#FFFFFF', padding: '2px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600 },
  colBody: { backgroundColor: '#F2F4F6', padding: '12px', borderRadius: '0 0 8px 8px', display: 'flex', flexDirection: 'column' as const, gap: '10px', minHeight: '120px', flex: 1 },
  card: { backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '8px', padding: '14px', cursor: 'pointer', transition: 'box-shadow 0.15s ease' },
  cardName: { fontSize: '15px', fontWeight: 600, color: '#0A2342', margin: '0 0 4px 0' },
  cardDetail: { fontSize: '13px', color: '#2E4A6B', margin: '2px 0', display: 'flex', alignItems: 'center', gap: '6px' },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, lineHeight: '18px' },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' },
  cardDate: { fontSize: '12px', color: '#64748B' },
  cardAssignee: { fontSize: '12px', color: '#2E4A6B', display: 'flex', alignItems: 'center', gap: '4px' },
  table: { width: '100%', borderCollapse: 'collapse' as const, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  th: { backgroundColor: '#0A2342', color: '#FFFFFF', padding: '12px 16px', fontSize: '13px', fontWeight: 600, textAlign: 'left' as const, whiteSpace: 'nowrap' as const },
  td: { padding: '12px 16px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  rowEven: { backgroundColor: '#D6E8F4' },
  rowOdd: { backgroundColor: '#FFFFFF' },
  loading: { display: 'flex', justifyContent: 'center', padding: '64px', color: '#64748B' },
};

/* ── Component ─────────────────────────────────────── */

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [stageFilter, setStageFilter] = useState<string>('All');
  const [sourceFilter, setSourceFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showFormBuilder, setShowFormBuilder] = useState(false);

  useEffect(() => {
    api.get<{ leads: Array<Record<string, unknown>> }>('/leads')
      .then((res) => {
        const mapped: Lead[] = (res.leads ?? []).map((l) => ({
          id: l.id as string,
          firstName: l.firstName as string ?? '',
          lastName: l.lastName as string ?? '',
          email: l.email as string ?? '',
          phone: l.phone as string ?? '',
          stage: API_STAGE_MAP[l.stage as string] ?? 'New',
          source: (l.source as Source) ?? 'Website',
          slipType: (l.desiredSlipType as string) ?? 'Annual',
          boatLength: (l.boatLength as number) ?? 0,
          assignedTo: (l.assignedTo as string) ?? '',
          createdAt: ((l.createdAt as string) ?? '').slice(0, 10),
          notes: (l.notes as string) ?? '',
        }));
        setLeads(mapped);
      })
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div style={s.loading}>Loading leads...</div>;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Leads</h1>
      <hr style={s.divider} />

      {/* Filter Bar */}
      <div style={s.filterBar}>
        <select style={s.select} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="All">All Stages</option>
          {STAGES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <select style={s.select} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="All">All Sources</option>
          {SOURCES.map((src) => <option key={src} value={src}>{src}</option>)}
        </select>
        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input style={s.searchInput} placeholder="Search leads..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={s.spacer} />
        <div style={s.viewToggle}>
          <button style={{ ...s.viewBtn, ...(view === 'kanban' ? s.viewBtnActive : {}) }} onClick={() => setView('kanban')} title="Board view"><LayoutGrid size={16} /></button>
          <button style={{ ...s.viewBtn, ...(view === 'table' ? s.viewBtnActive : {}) }} onClick={() => setView('table')} title="List view"><List size={16} /></button>
        </div>
        <button style={s.secondaryBtn} onClick={() => setShowFormBuilder(true)}><Globe size={16} /> Lead Form</button>
        <button style={s.primaryBtn} onClick={() => setSelectedLead({ id: '', firstName: '', lastName: '', email: '', phone: '', stage: 'New', source: 'Website', slipType: 'Annual', boatLength: 0, assignedTo: '', createdAt: new Date().toISOString().slice(0, 10), notes: '' })}><UserPlus size={16} /> Add Lead</button>
      </div>

      {/* Kanban View */}
      {view === 'kanban' && (
        <div style={s.kanban}>
          {STAGES.map((stage) => {
            const stageLeads = leadsByStage(stage);
            return (
              <div key={stage} style={s.column}>
                <div style={s.colHeader}>
                  <span>{stage}</span>
                  <span style={s.colBadge}>{stageLeads.length}</span>
                </div>
                <div style={s.colBody}>
                  {stageLeads.map((lead) => (
                    <div key={lead.id} style={s.card} onClick={() => setSelectedLead(lead)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
                    >
                      <div style={s.cardName}>{lead.firstName} {lead.lastName}</div>
                      <div style={s.cardDetail}><Mail size={12} /> {lead.email}</div>
                      <div style={s.cardDetail}><Anchor size={12} /> {lead.slipType} &middot; {lead.boatLength}ft</div>
                      <div style={s.cardDetail}><Globe size={12} /> {lead.source}</div>
                      <div style={s.cardFooter}>
                        <span style={s.cardDate}><Calendar size={11} /> {lead.createdAt}</span>
                        <span style={s.cardAssignee}><User size={11} /> {lead.assignedTo || '—'}</span>
                      </div>
                      <div style={{ marginTop: '8px' }}>
                        <span style={{ ...s.badge, backgroundColor: STAGE_COLORS[lead.stage].bg, color: STAGE_COLORS[lead.stage].text }}>{lead.stage}</span>
                      </div>
                    </div>
                  ))}
                  {stageLeads.length === 0 && (
                    <div style={{ fontSize: '13px', color: '#64748B', textAlign: 'center', padding: '24px 0' }}>No leads</div>
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
                <tr key={lead.id} style={{ ...(idx % 2 === 0 ? s.rowOdd : s.rowEven), cursor: 'pointer' }}
                  onClick={() => setSelectedLead(lead)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#EBF2FA'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; }}
                >
                  <td style={s.td}>{lead.firstName} {lead.lastName}</td>
                  <td style={s.td}>{lead.email}</td>
                  <td style={s.td}>{lead.phone}</td>
                  <td style={s.td}><span style={{ ...s.badge, backgroundColor: STAGE_COLORS[lead.stage].bg, color: STAGE_COLORS[lead.stage].text }}>{lead.stage}</span></td>
                  <td style={s.td}>{lead.source}</td>
                  <td style={s.td}>{lead.assignedTo || '—'}</td>
                  <td style={s.td}>{lead.createdAt}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={7}>No leads match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedLead && (
        <LeadDetailPanel lead={selectedLead} onClose={() => setSelectedLead(null)} onStageChange={(newStage) => { setSelectedLead({ ...selectedLead, stage: newStage as Stage }); }} />
      )}
      {showFormBuilder && <LeadFormBuilder onClose={() => setShowFormBuilder(false)} />}
    </div>
  );
}
