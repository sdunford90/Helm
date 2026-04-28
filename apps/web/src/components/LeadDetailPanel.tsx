import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
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
  Edit2,
  Check,
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
  /** Free-form note about the source — e.g. the staffer who took the call,
   *  the referrer's name, or the social-media account that DM'd. */
  sourceDetail?: string | null;
  /** Marketing attribution captured by the embedded lead-capture form. */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** Page URL the form was submitted from. */
  sourceUrl?: string | null;
  /** Referral partner code, if the lead used one. */
  referralCode?: string | null;
  /** ID of the lead form submission that created this lead. */
  sourceFormId?: string | null;
  /** Lead form record (joined by the API), used to show a friendly name. */
  sourceForm?: { id: string; name: string; formType?: string | null } | null;
  slipType: string;
  boatLength: number;
  assignedTo: string;
  createdAt: string;
  notes: string;
}

const SOURCE_OPTIONS: ReadonlyArray<string> = [
  'WEBSITE',
  'REFERRAL',
  'WALK_IN',
  'PHONE',
  'SOCIAL_MEDIA',
  'EMAIL',
  'OTHER',
];

const SOURCE_LABELS: Record<string, string> = {
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
  return SOURCE_LABELS[value] ?? value;
}

interface ActivityEvent {
  id: string;
  type: 'stage_change' | 'note' | 'email' | 'call' | 'other';
  description: string;
  timestamp: string;
  user: string;
}

interface AuditLogEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  recordType: string;
  recordId: string;
  action: string;
  changedFieldsJson: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; email: string; role: string } | null;
}

interface AuditLogResponse {
  data: AuditLogEntry[];
  pagination: { offset: number; limit: number; total: number };
}

const STAGE_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  PROPOSAL_SENT: 'Proposal Sent',
  WON: 'Won',
  LOST: 'Lost',
};

/**
 * Returns the input string if it parses as an http(s) URL, otherwise null.
 * `sourceUrl` originates from public lead-capture form submissions and is
 * therefore attacker-controllable; rendering an unvalidated value in an
 * `<a href>` would allow `javascript:` / `data:` URI XSS against staff users.
 */
function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function humanizeStage(value: unknown): string {
  if (typeof value !== 'string') return String(value ?? '');
  return STAGE_LABELS[value] ?? value;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function mapAuditEntryToActivity(entry: AuditLogEntry): ActivityEvent {
  const changed = (entry.changedFieldsJson ?? {}) as Record<string, unknown>;
  let type: ActivityEvent['type'] = 'other';
  let description = '';

  switch (entry.action) {
    case 'STAGE_CHANGED': {
      type = 'stage_change';
      const from = humanizeStage(changed.from);
      const to = humanizeStage(changed.to);
      description = from && to
        ? `Stage changed from ${from} to ${to}`
        : 'Stage changed';
      if (typeof changed.lostReason === 'string' && changed.lostReason) {
        description += ` (${changed.lostReason})`;
      }
      break;
    }
    case 'CREATED':
      description = 'Lead created';
      break;
    case 'UPDATED': {
      const fields = Object.keys(changed);
      description = fields.length > 0
        ? `Updated ${fields.join(', ')}`
        : 'Lead updated';
      break;
    }
    case 'NOTE_ADDED':
      type = 'note';
      description = 'Note added';
      break;
    case 'SOFT_DELETED': {
      const reason = typeof changed.lostReason === 'string' ? changed.lostReason : null;
      description = reason ? `Lead deleted (${reason})` : 'Lead deleted';
      break;
    }
    case 'CONVERTED':
      description = 'Lead converted to customer';
      break;
    default:
      description = entry.action.replace(/_/g, ' ').toLowerCase();
      description = description.charAt(0).toUpperCase() + description.slice(1);
  }

  return {
    id: entry.id,
    type,
    description,
    timestamp: formatTimestamp(entry.createdAt),
    user: entry.user?.email ?? entry.userName ?? 'System',
  };
}

interface LeadDetailPanelProps {
  lead: Lead;
  onClose: () => void;
  onStageChange: (stage: string) => void;
  onSave?: (lead: Lead) => void;
  /** When set on a new-lead create flow, the Source field is locked to this enum value. */
  lockSource?: string | null;
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

const STAGES: Stage[] = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];
const SLIP_TYPES = ['Annual', 'Seasonal', 'Transient', 'Liveaboard'];
const STAFF = ['Sarah Chen', 'Mike Torres', 'Jessica Park', 'David Liu'];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
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
  headerLeft: { flex: 1 },
  headerName: { fontSize: '22px', fontWeight: 700, color: '#0A2342', margin: '0 0 8px 0' },
  headerBadgeRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const },
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
  editBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#0A2342',
    backgroundColor: '#F0F4F8',
    border: '1px solid #CBD5E1',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  saveBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  cancelEditBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#64748B',
    backgroundColor: '#FFFFFF',
    border: '1px solid #CBD5E1',
    borderRadius: '6px',
    cursor: 'pointer',
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
  body: { flex: 1, overflowY: 'auto', padding: '0' },
  section: { padding: '24px', borderBottom: '1px solid #F2F4F6' },
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
  fieldGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  fieldLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  fieldValue: { fontSize: '14px', color: '#0A2342', fontWeight: 500 },
  fieldInput: {
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CBD5E1',
    borderRadius: '6px',
    padding: '7px 10px',
    backgroundColor: '#FAFCFE',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  fieldSelect: {
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CBD5E1',
    borderRadius: '6px',
    padding: '7px 10px',
    backgroundColor: '#FAFCFE',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    cursor: 'pointer',
  },
  timeline: { display: 'flex', flexDirection: 'column' as const, gap: '0px' },
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
  timelineContent: { flex: 1 },
  timelineDesc: { fontSize: '14px', color: '#0A2342', lineHeight: 1.5, margin: '0 0 4px 0' },
  timelineMeta: { fontSize: '12px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '8px' },
  noteForm: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
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
  noteSubmitRow: { display: 'flex', justifyContent: 'flex-end' },
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
  if (idx === -1 || idx >= 4) return null;
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

export default function LeadDetailPanel({ lead, onClose, onStageChange, onSave, lockSource }: LeadDetailPanelProps) {
  const [noteText, setNoteText] = useState('');
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const { data: apiActivity } = useApi<AuditLogResponse>(
    'get',
    lead.id
      ? `/api/audit-log?recordType=Lead&recordId=${lead.id}`
      : '/api/audit-log',
    { immediate: !!lead.id }
  );
  useEffect(() => {
    const entries = Array.isArray(apiActivity?.data) ? apiActivity!.data : [];
    setActivities(entries.map(mapAuditEntryToActivity));
  }, [apiActivity]);
  const [showConversion, setShowConversion] = useState(false);
  const [isEditing, setIsEditing] = useState(!lead.id); // auto-edit for new leads
  const [editData, setEditData] = useState<Lead>({ ...lead });

  const isNew = !lead.id;
  const stageColor = STAGE_COLORS[editData.stage];
  const nextStage = getNextStage(lead.stage);

  const handleEdit = (field: keyof Lead, value: string | number | null) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave?.(editData);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditData({ ...lead });
    setIsEditing(false);
  };

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
      <div
        style={s.overlay}
        onClick={(e) => {
          // Backdrop dismiss — only when viewing an existing lead. While
          // editing or filling out a new walk-in / phone-call form, ignore
          // backdrop clicks so an accidental click outside the panel can't
          // wipe in-progress input. Use the X / Cancel buttons instead.
          if (e.target !== e.currentTarget) return;
          if (isEditing || isNew) return;
          onClose();
        }}
      >
        <div style={s.panel} className="helm-detail-panel" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div style={s.header}>
            <div style={s.headerLeft}>
              <h2 style={s.headerName}>
                {isNew ? 'New Lead' : `${lead.firstName} ${lead.lastName}`}
              </h2>
              <div style={s.headerBadgeRow}>
                <span style={{ ...s.badge, backgroundColor: stageColor.bg, color: stageColor.text }}>
                  {isEditing ? editData.stage : lead.stage}
                </span>
                {!isEditing && lead.stage === 'Won' && (
                  <button style={s.convertBtn} onClick={() => setShowConversion(true)}>
                    <ArrowRightCircle size={14} />
                    Convert to Customer
                  </button>
                )}
                {!isEditing && (
                  <button style={s.editBtn} onClick={() => setIsEditing(true)}>
                    <Edit2 size={13} />
                    Edit
                  </button>
                )}
                {isEditing && (
                  <>
                    <button style={s.saveBtn} onClick={handleSave}>
                      <Check size={13} />
                      Save
                    </button>
                    {!isNew && (
                      <button style={s.cancelEditBtn} onClick={handleCancelEdit}>
                        Cancel
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <button style={s.closeBtn} onClick={onClose}>
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div style={s.body}>
            {/* Contact Information */}
            <div style={s.section}>
              <div style={s.sectionTitle}>
                <User size={14} />
                Contact Information
              </div>
              <div style={s.fieldGrid}>
                {/* First Name */}
                <div style={s.field}>
                  <span style={s.fieldLabel}>First Name</span>
                  {isEditing ? (
                    <input
                      style={s.fieldInput}
                      value={editData.firstName}
                      onChange={(e) => handleEdit('firstName', e.target.value)}
                      placeholder="First name"
                    />
                  ) : (
                    <span style={s.fieldValue}>{lead.firstName || '—'}</span>
                  )}
                </div>
                {/* Last Name */}
                <div style={s.field}>
                  <span style={s.fieldLabel}>Last Name</span>
                  {isEditing ? (
                    <input
                      style={s.fieldInput}
                      value={editData.lastName}
                      onChange={(e) => handleEdit('lastName', e.target.value)}
                      placeholder="Last name"
                    />
                  ) : (
                    <span style={s.fieldValue}>{lead.lastName || '—'}</span>
                  )}
                </div>
                {/* Email */}
                <div style={s.field}>
                  <span style={s.fieldLabel}>Email</span>
                  {isEditing ? (
                    <input
                      style={s.fieldInput}
                      type="email"
                      value={editData.email}
                      onChange={(e) => handleEdit('email', e.target.value)}
                      placeholder="email@example.com"
                    />
                  ) : (
                    <span style={s.fieldValue}>{lead.email || '—'}</span>
                  )}
                </div>
                {/* Phone */}
                <div style={s.field}>
                  <span style={s.fieldLabel}>Phone</span>
                  {isEditing ? (
                    <input
                      style={s.fieldInput}
                      type="tel"
                      value={editData.phone}
                      onChange={(e) => handleEdit('phone', e.target.value)}
                      placeholder="(555) 000-0000"
                    />
                  ) : (
                    <span style={s.fieldValue}>{lead.phone || '—'}</span>
                  )}
                </div>
                {/* Boat Length */}
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat Length</span>
                  {isEditing ? (
                    <input
                      style={s.fieldInput}
                      type="number"
                      value={editData.boatLength || ''}
                      onChange={(e) => handleEdit('boatLength', Number(e.target.value))}
                      placeholder="ft"
                    />
                  ) : (
                    <span style={s.fieldValue}>{lead.boatLength ? `${lead.boatLength} ft` : '—'}</span>
                  )}
                </div>
                {/* Slip Type */}
                <div style={s.field}>
                  <span style={s.fieldLabel}>Slip Type</span>
                  {isEditing ? (
                    <select
                      style={s.fieldSelect}
                      value={editData.slipType}
                      onChange={(e) => handleEdit('slipType', e.target.value)}
                    >
                      {SLIP_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  ) : (
                    <span style={s.fieldValue}>{lead.slipType || '—'}</span>
                  )}
                </div>
                {/* Source — locked for quick-add walk-in / phone create flows. */}
                <div style={s.field}>
                  <span style={s.fieldLabel}>Source</span>
                  {isEditing && !(isNew && lockSource) ? (
                    <select
                      style={s.fieldSelect}
                      value={editData.source || 'OTHER'}
                      onChange={(e) => handleEdit('source', e.target.value)}
                    >
                      {SOURCE_OPTIONS.map((src) => (
                        <option key={src} value={src}>{SOURCE_LABELS[src]}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={s.fieldValue}>
                      {sourceLabel(isNew && lockSource ? lockSource : (isEditing ? editData.source : lead.source))}
                      {isNew && lockSource && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: '#64748B' }}>(locked)</span>
                      )}
                    </span>
                  )}
                </div>
                {/* Source Detail — free-form context. Only shown for sources where
                    a human-entered detail is meaningful (walk-in, phone, referral, other). */}
                {(() => {
                  const effectiveSource = isNew && lockSource
                    ? lockSource
                    : (isEditing ? editData.source : lead.source);
                  const showDetail =
                    effectiveSource === 'WALK_IN' ||
                    effectiveSource === 'PHONE' ||
                    effectiveSource === 'REFERRAL' ||
                    effectiveSource === 'OTHER';
                  if (!showDetail) return null;
                  return (
                    <div style={s.field}>
                      <span style={s.fieldLabel}>Source Detail</span>
                      {isEditing ? (
                        <input
                          style={s.fieldInput}
                          value={editData.sourceDetail ?? ''}
                          onChange={(e) =>
                            handleEdit('sourceDetail', e.target.value || null)
                          }
                          placeholder="e.g. taken by Sarah, referred by Ava"
                        />
                      ) : (
                        <span style={s.fieldValue}>{lead.sourceDetail || '—'}</span>
                      )}
                    </div>
                  );
                })()}
                {/* Stage — read-only in the edit form. Stage transitions
                    must go through the dedicated stage buttons below so the
                    API enforces pipeline rules (one-step advance, lostReason
                    on Lost, conversion side-effects on Won). */}
                <div style={s.field}>
                  <span style={s.fieldLabel}>Stage</span>
                  <span style={s.fieldValue}>
                    {lead.stage}
                    {isEditing && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#64748B' }}>
                        (use the stage buttons to advance)
                      </span>
                    )}
                  </span>
                </div>
                {/* Assigned To */}
                <div style={{ ...s.field, gridColumn: '1 / -1' }}>
                  <span style={s.fieldLabel}>Assigned To</span>
                  {isEditing ? (
                    <select
                      style={s.fieldSelect}
                      value={editData.assignedTo}
                      onChange={(e) => handleEdit('assignedTo', e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {STAFF.map((name) => <option key={name}>{name}</option>)}
                    </select>
                  ) : (
                    <span style={s.fieldValue}>{lead.assignedTo || '—'}</span>
                  )}
                </div>
                {/* Notes */}
                <div style={{ ...s.field, gridColumn: '1 / -1' }}>
                  <span style={s.fieldLabel}>Notes</span>
                  {isEditing ? (
                    <textarea
                      style={{ ...s.textarea, minHeight: '60px' }}
                      value={editData.notes}
                      onChange={(e) => handleEdit('notes', e.target.value)}
                      placeholder="Add notes about this lead..."
                    />
                  ) : (
                    <span style={{ ...s.fieldValue, fontWeight: 400, color: '#2E4A6B' }}>
                      {lead.notes || '—'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Source Details — shows real attribution captured by the embedded
                lead-capture form (UTM tags, source URL, referral code, originating
                form). Each row is hidden when its field is empty, and the entire
                section collapses for leads with no attribution data (e.g. walk-in
                or phone leads). The free-form Source Detail note already lives in
                the field grid above. */}
            {(() => {
              const formName = lead.sourceForm?.name ?? null;
              const attributionRows: Array<{ label: string; value: React.ReactNode }> = [];
              if (lead.utmSource) {
                attributionRows.push({ label: 'UTM Source', value: lead.utmSource });
              }
              if (lead.utmMedium) {
                attributionRows.push({ label: 'UTM Medium', value: lead.utmMedium });
              }
              if (lead.utmCampaign) {
                attributionRows.push({ label: 'UTM Campaign', value: lead.utmCampaign });
              }
              if (lead.sourceUrl) {
                const safeUrl = safeExternalUrl(lead.sourceUrl);
                attributionRows.push({
                  label: 'Source URL',
                  value: safeUrl ? (
                    <a
                      href={safeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#0A2342', textDecoration: 'underline', wordBreak: 'break-all' }}
                    >
                      {safeUrl}
                    </a>
                  ) : (
                    // Unsafe scheme (e.g. `javascript:`) — render as inert text
                    // so staff can still see what was submitted without it being
                    // clickable.
                    <span style={{ wordBreak: 'break-all', color: '#64748B' }}>
                      {lead.sourceUrl}
                    </span>
                  ),
                });
              }
              if (lead.referralCode) {
                attributionRows.push({ label: 'Referral Code', value: lead.referralCode });
              }
              if (formName || lead.sourceFormId) {
                attributionRows.push({
                  label: 'Lead Form',
                  value: formName ?? lead.sourceFormId,
                });
              }
              if (attributionRows.length === 0) return null;
              return (
                <div style={s.section}>
                  <div style={s.sectionTitle}>
                    <Globe size={14} />
                    Source Details
                  </div>
                  <div style={s.fieldGrid}>
                    {attributionRows.map((row) => (
                      <div key={row.label} style={s.field}>
                        <span style={s.fieldLabel}>{row.label}</span>
                        <span style={s.fieldValue}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

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
                  <div style={{ fontSize: '13px', color: '#64748B', padding: '8px 0' }}>No activity yet.</div>
                )}
              </div>
            </div>

            {/* Add Note */}
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
          </div>

          {/* Footer Actions */}
          <div style={s.footer}>
            {!isEditing && lead.stage !== 'Won' && lead.stage !== 'Lost' && nextStage && (
              <button style={s.primaryBtn} onClick={() => onStageChange(nextStage)}>
                <ChevronRight size={16} />
                Move to {nextStage}
              </button>
            )}
            {!isEditing && lead.stage !== 'Lost' && (
              <button style={s.destructiveBtn} onClick={() => onStageChange('Lost')}>
                <XCircle size={16} />
                Mark as Lost
              </button>
            )}
            {!isEditing && lead.stage === 'Lost' && (
              <button style={s.primaryBtn} onClick={() => onStageChange('New')}>
                <ArrowRightCircle size={16} />
                Reopen Lead
              </button>
            )}
            {isEditing && (
              <>
                <button style={s.primaryBtn} onClick={handleSave}>
                  <Check size={16} />
                  Save Changes
                </button>
                {!isNew && (
                  <button style={s.destructiveBtn} onClick={handleCancelEdit}>
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showConversion && (
        <ConversionWizard
          lead={lead}
          onClose={() => setShowConversion(false)}
          onConvert={() => { setShowConversion(false); onClose(); }}
        />
      )}
    </>
  );
}
