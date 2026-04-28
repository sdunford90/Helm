import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
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
  Phone,
  Footprints,
  TrendingUp,
} from 'lucide-react';
import LeadDetailPanel from '../components/LeadDetailPanel';
import LeadFormBuilder from '../components/LeadFormBuilder';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

/* ── Types ─────────────────────────────────────────────── */

type Stage = 'New' | 'Contacted' | 'Qualified' | 'Proposal Sent' | 'Won' | 'Lost';
/** API enum values for `LeadSource` — kept as string so we can pass through
 *  the wire format unchanged.  Use {@link SOURCE_LABELS} for display. */
type SourceEnum =
  | 'WEBSITE'
  | 'REFERRAL'
  | 'WALK_IN'
  | 'PHONE'
  | 'SOCIAL_MEDIA'
  | 'EMAIL'
  | 'OTHER';
type SlipType = 'Annual' | 'Seasonal' | 'Transient' | 'Liveaboard';

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stage: Stage;
  source: SourceEnum;
  sourceDetail?: string | null;
  slipType: SlipType;
  boatLength: number;
  assignedTo: string;
  createdAt: string;
  notes: string;
}

/* ── Constants ─────────────────────────────────────────── */

const STAGES: Stage[] = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];

const SOURCE_OPTIONS: SourceEnum[] = [
  'WEBSITE',
  'REFERRAL',
  'WALK_IN',
  'PHONE',
  'SOCIAL_MEDIA',
  'EMAIL',
  'OTHER',
];

const SOURCE_LABELS: Record<SourceEnum, string> = {
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  WALK_IN: 'Walk-in',
  PHONE: 'Phone call',
  SOCIAL_MEDIA: 'Social media',
  EMAIL: 'Email',
  OTHER: 'Other',
};

function sourceLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return SOURCE_LABELS[value as SourceEnum] ?? value;
}

// Normalize uppercase API stage values → frontend title-case Stage type
const STAGE_API_MAP: Record<string, Stage> = {
  NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified',
  PROPOSAL_SENT: 'Proposal Sent', WON: 'Won', LOST: 'Lost',
};
const STAGE_TO_API: Record<Stage, string> = {
  'New': 'NEW', 'Contacted': 'CONTACTED', 'Qualified': 'QUALIFIED',
  'Proposal Sent': 'PROPOSAL_SENT', 'Won': 'WON', 'Lost': 'LOST',
};
function normalizeStage(s: string): Stage {
  return STAGE_API_MAP[s] ?? (s as Stage);
}

interface SourceStat {
  source: SourceEnum;
  total: number;
  won: number;
  lost: number;
  conversionRate: number;
}

interface LeadStatsResponse {
  totalLeads: number;
  conversionRate: number;
  avgDaysToConvert: number | null;
  bySource: SourceStat[];
}

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
  const { getToken } = useAuth();
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [stageFilter, setStageFilter] = useState<string>('All');
  const [sourceFilter, setSourceFilter] = useState<'All' | SourceEnum>('All');
  const [search, setSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [localLeads, setLocalLeads] = useState<Lead[]>([]);

  // API calls
  const { data: apiLeadsResp, loading, execute: refetchLeads } = useApi<{ data: Lead[] }>('get', '/api/leads', { immediate: true });
  const { data: stats, execute: refetchStats } = useApi<LeadStatsResponse>('get', '/api/leads/stats', { immediate: true });
  const createLeadApi = useApi<Lead>('post', '/api/leads');

  // PUT path needs the lead id baked in (route is `/api/leads/:id`), so we
  // call api.put directly rather than going through useApi which captures a
  // static path. `stage` is intentionally stripped — pipeline transitions
  // must go through `persistStageChange` so the API's transition rules
  // (one-step advance, lostReason gating, audit log, conversion side-effects)
  // are honored.
  const persistUpdate = async (lead: Lead): Promise<void> => {
    if (!lead.id) return;
    const token = await getToken();
    const { id, createdAt: _createdAt, stage: _stage, ...rest } = lead;
    void _createdAt;
    void _stage;
    try {
      await api.put<Lead>(`/api/leads/${id}`, rest, token);
    } catch (err) {
      console.error('Failed to update lead', err);
      window.alert(`Couldn't save lead: ${err instanceof Error ? err.message : 'unknown error'}`);
      // Re-sync from server so the optimistic local state is reverted.
      refetchLeads();
    }
  };

  // Stage transitions go through the dedicated /:id/stage endpoint which
  // enforces the pipeline rules and triggers the WON→Customer conversion.
  const persistStageChange = async (
    leadId: string,
    newStage: Stage,
    lostReason?: string,
  ): Promise<boolean> => {
    const token = await getToken();
    const apiStage = STAGE_TO_API[newStage];
    const body: { stage: string; lostReason?: string } = { stage: apiStage };
    if (newStage === 'Lost' && lostReason) body.lostReason = lostReason;
    try {
      await api.put<Lead>(`/api/leads/${leadId}/stage`, body, token);
      return true;
    } catch (err) {
      console.error('Failed to change lead stage', err);
      window.alert(`Couldn't update stage: ${err instanceof Error ? err.message : 'unknown error'}`);
      refetchLeads();
      return false;
    }
  };

  useEffect(() => {
    if (apiLeadsResp?.data) {
      setLocalLeads(
        apiLeadsResp.data.map((l) => ({ ...l, stage: normalizeStage(l.stage as string) }))
      );
    }
  }, [apiLeadsResp]);

  const leads = localLeads;

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

  /** Open the detail panel pre-populated for a quick-add walk-in / phone-call. */
  const startQuickAdd = (source: SourceEnum) => {
    setSelectedLead({
      id: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      stage: 'New',
      source,
      sourceDetail: '',
      slipType: 'Annual',
      boatLength: 0,
      assignedTo: '',
      createdAt: new Date().toISOString().slice(0, 10),
      notes: '',
    });
  };

  return (
    <div style={s.page}>
      <h1 style={s.title} className="helm-page-title">Leads</h1>
      <hr style={s.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>Loading...</div>}

      {/* Filter Bar */}
      <div style={s.filterBar} className="helm-filter-bar">
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
          onChange={(e) => setSourceFilter(e.target.value as 'All' | SourceEnum)}
        >
          <option value="All">All Sources</option>
          {SOURCE_OPTIONS.map((src) => (
            <option key={src} value={src}>{SOURCE_LABELS[src]}</option>
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

        <button
          style={s.secondaryBtn}
          onClick={() => startQuickAdd('WALK_IN')}
          title="Log a walk-in lead"
        >
          <Footprints size={16} />
          Log walk-in
        </button>

        <button
          style={s.secondaryBtn}
          onClick={() => startQuickAdd('PHONE')}
          title="Log a phone-call lead"
        >
          <Phone size={16} />
          Log phone call
        </button>

        <button style={s.secondaryBtn} onClick={() => setShowFormBuilder(true)}>
          <Globe size={16} />
          Lead Form
        </button>

        <button style={s.primaryBtn} onClick={() => startQuickAdd('WEBSITE')}>
          <UserPlus size={16} />
          Add Lead
        </button>
      </div>

      {/* Conversion by Source */}
      {stats?.bySource && stats.bySource.some((b) => b.total > 0) && (
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#2E4A6B',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <TrendingUp size={14} />
            Conversion by source
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px',
            }}
          >
            {stats.bySource
              .filter((b) => b.total > 0)
              .map((b) => (
                <div
                  key={b.source}
                  style={{
                    padding: '10px 12px',
                    border: '1px solid #E2E8F0',
                    borderRadius: '6px',
                    background: '#F7F9FB',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>
                    {SOURCE_LABELS[b.source]}
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: '#0A2342',
                      marginTop: '2px',
                    }}
                  >
                    {b.conversionRate.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
                    {b.won}/{b.won + b.lost} closed &middot; {b.total} total
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

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
                        <Globe size={12} /> {sourceLabel(lead.source)}
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
                  <td style={s.td}>{sourceLabel(lead.source)}</td>
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
              setLocalLeads((prev) => prev.map((l) => l.id === updated.id ? updated as Lead : l));
              persistUpdate(updated as Lead).then(() => {
                refetchLeads();
                refetchStats();
              });
            } else {
              // For walk-ins / phone calls, the API generates the id; we
              // optimistically add a placeholder, then refetch to pick up the
              // real one from the server.
              const newLead = { ...updated, id: String(Date.now()) } as Lead;
              setLocalLeads((prev) => [newLead, ...prev]);
              createLeadApi.execute(newLead).then(() => {
                refetchLeads();
                refetchStats();
              });
            }
            setSelectedLead(null);
          }}
          onStageChange={async (newStage) => {
            const stage = newStage as Stage;
            if (!selectedLead.id) return;
            // The /:id/stage endpoint requires lostReason when transitioning to Lost.
            let lostReason: string | undefined;
            if (stage === 'Lost') {
              const r = window.prompt('Why is this lead lost?');
              if (r === null) return; // user cancelled
              lostReason = r.trim() || 'No reason provided';
            }
            const updated = { ...selectedLead, stage };
            setSelectedLead(updated);
            setLocalLeads((prev) => prev.map((l) => l.id === selectedLead.id ? updated : l));
            const ok = await persistStageChange(selectedLead.id, stage, lostReason);
            if (ok) {
              refetchLeads();
              refetchStats();
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
