import { useState } from 'react';
import {
  X,
  Mail,
  Phone,
  Globe,
  User,
  MessageSquare,
  ChevronRight,
  ArrowRightCircle,
  XCircle,
  Send,
  Clock,
} from 'lucide-react';
import ConversionWizard from './ConversionWizard';

/* ── Types ─────────────────────────────────────────────── */

type Stage = 'New' | 'Contacted' | 'Qualified' | 'Proposal Sent' | 'Won' | 'Lost';

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stage: Stage;
  source: string;
  slipType: string;
  boatLength: number;
  assignedTo: string;
  createdAt: string;
  notes: string;
}

interface ActivityEvent {
  id: string;
  type: 'stage_change' | 'note' | 'email' | 'call';
  description: string;
  timestamp: string;
  user: string;
}

interface LeadDetailPanelProps {
  lead: Lead;
  onClose: () => void;
  onStageChange: (stage: string) => void;
}

/* ── Stage Flow ───────────────────────────────────────── */

const STAGE_ORDER: Stage[] = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];

const STAGE_COLORS: Record<Stage, { bg: string; text: string }> = {
  New: { bg: '#D6E8F4', text: '#0A2342' },
  Contacted: { bg: '#E0F2FE', text: '#0369A1' },
  Qualified: { bg: '#FFF3CD', text: '#856404' },
  'Proposal Sent': { bg: '#E8D5F5', text: '#6B21A8' },
  Won: { bg: '#E8F5E9', text: '#1B5E20' },
  Lost: { bg: '#FDECEA', text: '#B71C1C' },
};

const STAFF = ['Sarah Chen', 'Mike Torres', 'Jessica Park', 'David Liu'];

/* ── Mock Activity ────────────────────────────────────── */

const MOCK_ACTIVITY: ActivityEvent[] = [
  { id: '1', type: 'stage_change', description: 'Lead created — stage set to New', timestamp: '2026-03-20 09:15', user: 'System' },
  { id: '2', type: 'email', description: 'Welcome email sent automatically', timestamp: '2026-03-20 09:16', user: 'System' },
  { id: '3', type: 'note', description: 'Spoke with lead on phone, interested in annual slip for 32ft sailboat.', timestamp: '2026-03-21 14:30', user: 'Sarah Chen' },
  { id: '4', type: 'stage_change', description: 'Stage changed from New to Contacted', timestamp: '2026-03-21 14:32', user: 'Sarah Chen' },
  { id: '5', type: 'call', description: 'Follow-up call — scheduled marina tour for Saturday', timestamp: '2026-03-22 10:00', user: 'Sarah Chen' },
];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.4)',
    zIndex: 1000,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  panel: {
    width: '520px',
    maxWidth: '100vw',
    backgroundColor: '#FFFFFF',
    height: '100vh',
    overflowY: 'auto',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '24px',
    borderBottom: '1px solid #E2E8F0',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
  },
  headerLeft: {
    flex: 1,
  },
  headerName: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#0A2342',
    margin: '0 0 8px 0',
  },
  headerBadgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  badge: {
    display: 'inline-block',
    padding: '3px 12px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: '18px',
  },
  closeBtn: {
    padding: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: '#2E4A6B',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  convertBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 16px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#1B5E20',
    backgroundColor: '#E8F5E9',
    border: '1px solid #A5D6A7',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '0',
  },
  section: {
    padding: '24px',
    borderBottom: '1px solid #F2F4F6',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  fieldLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  fieldValue: {
    fontSize: '14px',
    color: '#0A2342',
    fontWeight: 500,
  },
  fieldValueMono: {
    fontSize: '14px',
    color: '#0A2342',
    fontWeight: 500,
    fontFamily: '"JetBrains Mono", monospace',
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0px',
  },
  timelineItem: {
    display: 'flex',
    gap: '12px',
    padding: '10px 0',
    borderLeft: '2px solid #E2E8F0',
    marginLeft: '8px',
    paddingLeft: '16px',
    position: 'relative' as const,
  },
  timelineDot: {
    position: 'absolute' as const,
    left: '-5px',
    top: '14px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#00D4FF',
    border: '2px solid #FFFFFF',
  },
  timelineContent: {
    flex: 1,
  },
  timelineDesc: {
    fontSize: '14px',
    color: '#0A2342',
    lineHeight: 1.5,
    margin: '0 0 4px 0',
  },
  timelineMeta: {
    fontSize: '12px',
    color: '#64748B',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  noteForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  textarea: {
    width: '100%',
    minHeight: '80px',
    padding: '10px 12px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    resize: 'vertical' as const,
    fontFamily: 'Inter, system-ui, sans-serif',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  noteSubmitRow: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  noteSubmitBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 16px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  assignSelect: {
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
    width: '100%',
  },
  footer: {
    padding: '20px 24px',
    borderTop: '1px solid #E2E8F0',
    display: 'flex',
    gap: '12px',
    backgroundColor: '#F7F9FB',
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    flex: 1,
    justifyContent: 'center',
  },
  destructiveBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#B71C1C',
    backgroundColor: '#FFFFFF',
    border: '1px solid #EF9A9A',
    borderRadius: '6px',
    cursor: 'pointer',
    justifyContent: 'center',
  },
};

/* ── Helpers ───────────────────────────────────────────── */

function getNextStage(current: Stage): Stage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx >= 4) return null; // Won and Lost have no next
  return STAGE_ORDER[idx + 1];
}

function getActivityIcon(type: string) {
  switch (type) {
    case 'stage_change': return <ArrowRightCircle size={14} style={{ color: '#00D4FF' }} />;
    case 'note': return <MessageSquare size={14} style={{ color: '#2E4A6B' }} />;
    case 'email': return <Mail size={14} style={{ color: '#0369A1' }} />;
    case 'call': return <Phone size={14} style={{ color: '#1B5E20' }} />;
    default: return <Clock size={14} style={{ color: '#64748B' }} />;
  }
}

/* ── Component ─────────────────────────────────────────── */

export default function LeadDetailPanel({ lead, onClose, onStageChange }: LeadDetailPanelProps) {
  const [noteText, setNoteText] = useState('');
  const [assignedTo, setAssignedTo] = useState(lead.assignedTo);
  const [activities, setActivities] = useState<ActivityEvent[]>(MOCK_ACTIVITY);
  const [showConversion, setShowConversion] = useState(false);

  const nextStage = getNextStage(lead.stage);
  const isNew = !lead.id;
  const stageColor = STAGE_COLORS[lead.stage];

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    const newEvent: ActivityEvent = {
      id: String(Date.now()),
      type: 'note',
      description: noteText.trim(),
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
      user: 'You',
    };
    setActivities([newEvent, ...activities]);
    setNoteText('');
  };

  return (
    <>
      <div style={s.overlay} onClick={onClose}>
        <div style={s.panel} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div style={s.header}>
            <div style={s.headerLeft}>
              <h2 style={s.headerName}>
                {isNew ? 'New Lead' : `${lead.firstName} ${lead.lastName}`}
              </h2>
              <div style={s.headerBadgeRow}>
                <span
                  style={{
                    ...s.badge,
                    backgroundColor: stageColor.bg,
                    color: stageColor.text,
                  }}
                >
                  {lead.stage}
                </span>
                {lead.stage === 'Won' && (
                  <button
                    style={s.convertBtn}
                    onClick={() => setShowConversion(true)}
                  >
                    <ArrowRightCircle size={14} />
                    Convert to Customer
                  </button>
                )}
              </div>
            </div>
            <button style={s.closeBtn} onClick={onClose}>
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div style={s.body}>
            {/* Contact Info */}
            <div style={s.section}>
              <div style={s.sectionTitle}>
                <User size={14} />
                Contact Information
              </div>
              <div style={s.fieldGrid}>
                <div style={s.field}>
                  <span style={s.fieldLabel}>First Name</span>
                  <span style={s.fieldValue}>{lead.firstName || '—'}</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Last Name</span>
                  <span style={s.fieldValue}>{lead.lastName || '—'}</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Email</span>
                  <span style={s.fieldValue}>{lead.email || '—'}</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Phone</span>
                  <span style={s.fieldValue}>{lead.phone || '—'}</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat Length</span>
                  <span style={s.fieldValueMono}>{lead.boatLength ? `${lead.boatLength} ft` : '—'}</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Slip Type</span>
                  <span style={s.fieldValue}>{lead.slipType || '—'}</span>
                </div>
              </div>
            </div>

            {/* Source Info */}
            <div style={s.section}>
              <div style={s.sectionTitle}>
                <Globe size={14} />
                Source
              </div>
              <div style={s.fieldGrid}>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Source</span>
                  <span style={s.fieldValue}>{lead.source}</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Form</span>
                  <span style={s.fieldValue}>Slip Inquiry Form</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Landing URL</span>
                  <span style={{ ...s.fieldValue, color: '#0369A1', fontSize: '13px' }}>
                    /marina/slips
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>UTM Source</span>
                  <span style={s.fieldValue}>google</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>UTM Campaign</span>
                  <span style={s.fieldValue}>spring_promo</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Referral Code</span>
                  <span style={s.fieldValueMono}>{lead.source === 'Referral' ? 'REF-412' : '—'}</span>
                </div>
              </div>
            </div>

            {/* Activity Timeline */}
            <div style={s.section}>
              <div style={s.sectionTitle}>
                <Clock size={14} />
                Activity Timeline
              </div>
              <div style={s.timeline}>
                {activities.map((event) => (
                  <div key={event.id} style={s.timelineItem}>
                    <div style={s.timelineDot} />
                    <div style={s.timelineContent}>
                      <p style={s.timelineDesc}>
                        {getActivityIcon(event.type)}{' '}
                        {event.description}
                      </p>
                      <div style={s.timelineMeta}>
                        <span>{event.user}</span>
                        <span>&middot;</span>
                        <span>{event.timestamp}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {activities.length === 0 && (
                  <div style={{ fontSize: '13px', color: '#64748B', padding: '8px 0' }}>
                    No activity yet.
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            <div style={s.section}>
              <div style={s.sectionTitle}>
                <MessageSquare size={14} />
                Add Note
              </div>
              <div style={s.noteForm}>
                <textarea
                  style={s.textarea}
                  placeholder="Type a note..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <div style={s.noteSubmitRow}>
                  <button style={s.noteSubmitBtn} onClick={handleAddNote}>
                    <Send size={14} />
                    Add Note
                  </button>
                </div>
              </div>
            </div>

            {/* Assignment */}
            <div style={s.section}>
              <div style={s.sectionTitle}>
                <User size={14} />
                Assignment
              </div>
              <select
                style={s.assignSelect}
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                <option value="">Unassigned</option>
                {STAFF.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer Actions */}
          <div style={s.footer}>
            {lead.stage !== 'Won' && lead.stage !== 'Lost' && nextStage && (
              <button
                style={s.primaryBtn}
                onClick={() => onStageChange(nextStage)}
              >
                <ChevronRight size={16} />
                Move to {nextStage}
              </button>
            )}
            {lead.stage !== 'Lost' && (
              <button
                style={s.destructiveBtn}
                onClick={() => onStageChange('Lost')}
              >
                <XCircle size={16} />
                Mark as Lost
              </button>
            )}
            {lead.stage === 'Lost' && (
              <button
                style={s.primaryBtn}
                onClick={() => onStageChange('New')}
              >
                <ArrowRightCircle size={16} />
                Reopen Lead
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Conversion Wizard */}
      {showConversion && (
        <ConversionWizard
          lead={lead}
          onClose={() => setShowConversion(false)}
          onConvert={() => {
            setShowConversion(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
