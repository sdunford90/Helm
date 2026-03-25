import { useState } from 'react';
import { Bell, Plus, Clock, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Send } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const serviceTypes = [
  'Fuel Delivery',
  'Pump-Out Service',
  'Bottom Cleaning',
  'Detailing / Wash',
  'Provisioning',
  'Ice Delivery',
  'Dock Line Assistance',
  'Other',
];

const mockRequests = [
  {
    id: 'CR-201',
    serviceType: 'Bottom Cleaning',
    requestDate: '2026-03-22',
    preferredDate: '2026-03-28',
    notes: 'Please clean hull and props. Boat will be in slip C-12.',
    status: 'Submitted',
    statusHistory: [
      { status: 'Submitted', date: '2026-03-22', note: 'Request received.' },
    ],
  },
  {
    id: 'CR-198',
    serviceType: 'Fuel Delivery',
    requestDate: '2026-03-15',
    preferredDate: '2026-03-17',
    notes: '120 gallons diesel please. Key is under the mat by the helm.',
    status: 'In Progress',
    statusHistory: [
      { status: 'Submitted', date: '2026-03-15', note: 'Request received.' },
      { status: 'Accepted', date: '2026-03-15', note: 'Assigned to fuel team.' },
      { status: 'In Progress', date: '2026-03-17', note: 'Delivery scheduled for this afternoon.' },
    ],
  },
  {
    id: 'CR-190',
    serviceType: 'Detailing / Wash',
    requestDate: '2026-03-05',
    preferredDate: '2026-03-10',
    notes: 'Full detail inside and out.',
    status: 'Completed',
    statusHistory: [
      { status: 'Submitted', date: '2026-03-05', note: 'Request received.' },
      { status: 'Accepted', date: '2026-03-06', note: 'Scheduled with Clean Marina Co.' },
      { status: 'In Progress', date: '2026-03-10', note: 'Detail in progress.' },
      { status: 'Completed', date: '2026-03-10', note: 'Detail completed. Invoice INV-1042 updated.' },
    ],
  },
  {
    id: 'CR-185',
    serviceType: 'Provisioning',
    requestDate: '2026-02-28',
    preferredDate: '2026-03-01',
    notes: 'Stock the fridge with water, beer, and sandwich supplies for 6 people.',
    status: 'Completed',
    statusHistory: [
      { status: 'Submitted', date: '2026-02-28', note: 'Request received.' },
      { status: 'Completed', date: '2026-03-01', note: 'Provisions delivered and stocked.' },
    ],
  },
];

const statusStyleMap: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
  Submitted: { bg: '#EFF6FF', text: '#3B82F6', icon: Clock },
  Accepted: { bg: '#FFF8E6', text: '#D97706', icon: AlertCircle },
  'In Progress': { bg: '#FFF8E6', text: '#D97706', icon: AlertCircle },
  Completed: { bg: '#E6FAF0', text: '#0D9F6E', icon: CheckCircle },
};

export default function ConciergeRequests() {
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ serviceType: '', preferredDate: '', notes: '' });

  const statusBadge = (status: string): CSSProperties => {
    const s = statusStyleMap[status] || statusStyleMap.Submitted;
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: s.bg,
      color: s.text,
    };
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Concierge Requests</h1>
          <p style={{ color: '#64748B', fontSize: 14 }}>Request marina services and track their progress.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: CYAN,
            color: NAVY,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus size={16} /> New Request
        </button>
      </div>

      {/* New Request Form */}
      {showForm && (
        <div style={{ ...card, marginBottom: 24, border: `2px solid ${CYAN}` }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Submit New Request</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: 6 }}>
                Service Type
              </label>
              <select
                value={formData.serviceType}
                onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #E2E8F0',
                  fontSize: 14,
                  color: NAVY,
                  background: '#fff',
                }}
              >
                <option value="">Select a service...</option>
                {serviceTypes.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: 6 }}>
                Preferred Date
              </label>
              <input
                type="date"
                value={formData.preferredDate}
                onChange={(e) => setFormData({ ...formData, preferredDate: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #E2E8F0',
                  fontSize: 14,
                  color: NAVY,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: 6 }}>
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              placeholder="Any special instructions or details..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #E2E8F0',
                fontSize: 14,
                color: NAVY,
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #E2E8F0',
                background: '#fff',
                color: '#64748B',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                background: NAVY,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Send size={14} /> Submit Request
            </button>
          </div>
        </div>
      )}

      {/* Requests List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mockRequests.map((req) => {
          const isExpanded = expandedId === req.id;
          const sInfo = statusStyleMap[req.status] || statusStyleMap.Submitted;
          const StatusIcon = sInfo.icon;

          return (
            <div key={req.id} style={card}>
              <div
                onClick={() => setExpandedId(isExpanded ? null : req.id)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: sInfo.bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <StatusIcon size={20} color={sInfo.text} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{req.id}</span>
                      <span style={{ fontSize: 14, color: '#334155' }}>{req.serviceType}</span>
                      <span style={statusBadge(req.status)}>{req.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                      Requested {req.requestDate} &middot; Preferred {req.preferredDate}
                    </div>
                  </div>
                </div>
                {isExpanded ? <ChevronUp size={18} color="#64748B" /> : <ChevronDown size={18} color="#64748B" />}
              </div>

              {isExpanded && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: 13, color: '#334155', marginBottom: 16 }}>
                    <strong>Notes:</strong> {req.notes}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 8 }}>Status Timeline</div>
                  <div style={{ paddingLeft: 12 }}>
                    {req.statusHistory.map((sh, i) => {
                      const si = statusStyleMap[sh.status] || statusStyleMap.Submitted;
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: 12,
                            paddingBottom: 12,
                            borderLeft: i < req.statusHistory.length - 1 ? `2px solid ${si.bg}` : '2px solid transparent',
                            marginLeft: 6,
                            paddingLeft: 16,
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              left: -6,
                              top: 0,
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              background: si.text,
                            }}
                          />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: si.text }}>{sh.status}</div>
                            <div style={{ fontSize: 12, color: '#64748B' }}>{sh.date} - {sh.note}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
