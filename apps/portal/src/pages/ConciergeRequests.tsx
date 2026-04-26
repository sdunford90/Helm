import { useState, useEffect } from 'react';
import { Bell, Plus, Clock, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Send } from 'lucide-react';
import type { CSSProperties } from 'react';
import { usePortalApi } from '../lib/api';

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

interface ConciergeRequest {
  id: string;
  serviceType: string;
  createdAt: string;
  preferredDate: string | null;
  notes: string | null;
  status: string;
}

const statusStyleMap: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
  SUBMITTED: { bg: '#EFF6FF', text: '#3B82F6', icon: Clock },
  Submitted: { bg: '#EFF6FF', text: '#3B82F6', icon: Clock },
  ACCEPTED: { bg: '#FFF8E6', text: '#D97706', icon: AlertCircle },
  Accepted: { bg: '#FFF8E6', text: '#D97706', icon: AlertCircle },
  IN_PROGRESS: { bg: '#FFF8E6', text: '#D97706', icon: AlertCircle },
  'In Progress': { bg: '#FFF8E6', text: '#D97706', icon: AlertCircle },
  COMPLETED: { bg: '#E6FAF0', text: '#0D9F6E', icon: CheckCircle },
  Completed: { bg: '#E6FAF0', text: '#0D9F6E', icon: CheckCircle },
};

function friendlyStatus(s: string): string {
  const map: Record<string, string> = {
    SUBMITTED: 'Submitted',
    ACCEPTED: 'Accepted',
    IN_PROGRESS: 'In Progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return map[s] ?? s;
}

export default function ConciergeRequests() {
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ serviceType: '', preferredDate: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, execute: refetch } = usePortalApi<ConciergeRequest[]>(
    'get',
    '/api/portal/concierge',
    { immediate: true },
  );

  const { execute: submitRequest } = usePortalApi<ConciergeRequest>(
    'post',
    '/api/portal/concierge',
  );

  const handleSubmit = async () => {
    if (!formData.serviceType) return;
    setSubmitting(true);
    await submitRequest({
      serviceType: formData.serviceType,
      preferredDate: formData.preferredDate || undefined,
      notes: formData.notes || undefined,
    });
    setFormData({ serviceType: '', preferredDate: '', notes: '' });
    setShowForm(false);
    setSubmitting(false);
    await refetch();
  };

  const statusBadge = (rawStatus: string): CSSProperties => {
    const friendly = friendlyStatus(rawStatus);
    const s = statusStyleMap[rawStatus] || statusStyleMap[friendly] || statusStyleMap.Submitted;
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

  const requests = data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Concierge Requests</h1>
          <p style={{ color: '#64748B', fontSize: 14 }}>Request marina services and track their progress.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 8, border: 'none', background: CYAN, color: NAVY, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          <Plus size={16} /> New Request
        </button>
      </div>

      {showForm && (
        <div style={{ ...card, marginBottom: 24, border: `2px solid ${CYAN}` }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Submit New Request</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: 6 }}>Service Type</label>
              <select
                value={formData.serviceType}
                onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 14, color: NAVY, background: '#fff' }}
              >
                <option value="">Select a service...</option>
                {serviceTypes.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: 6 }}>Preferred Date</label>
              <input
                type="date"
                value={formData.preferredDate}
                onChange={(e) => setFormData({ ...formData, preferredDate: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 14, color: NAVY, boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: 6 }}>Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              placeholder="Any special instructions or details..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 14, color: NAVY, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={() => setShowForm(false)}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              disabled={!formData.serviceType || submitting}
              onClick={handleSubmit}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 8, border: 'none', background: NAVY, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (!formData.serviceType || submitting) ? 0.6 : 1 }}
            >
              <Send size={14} /> {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 48, color: '#64748B' }}>Loading requests...</div>}
      {error && <div style={{ ...card, textAlign: 'center', padding: 32, color: '#DC2626' }}>Failed to load requests.</div>}

      {!loading && !error && requests.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <Bell size={40} color="#94A3B8" style={{ marginBottom: 12 }} />
          <p style={{ color: '#64748B', fontSize: 14 }}>No requests yet. Submit your first request above.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {requests.map((req) => {
          const isExpanded = expandedId === req.id;
          const friendly = friendlyStatus(req.status);
          const sInfo = statusStyleMap[req.status] || statusStyleMap[friendly] || statusStyleMap.Submitted;
          const StatusIcon = sInfo.icon;
          const requestDate = req.createdAt ? new Date(req.createdAt).toLocaleDateString('en-US') : '—';
          const preferredDate = req.preferredDate ? new Date(req.preferredDate).toLocaleDateString('en-US') : '—';

          return (
            <div key={req.id} style={card}>
              <div
                onClick={() => setExpandedId(isExpanded ? null : req.id)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: sInfo.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <StatusIcon size={20} color={sInfo.text} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{req.serviceType}</span>
                      <span style={statusBadge(req.status)}>{friendly}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                      Requested {requestDate} &middot; Preferred {preferredDate}
                    </div>
                  </div>
                </div>
                {isExpanded ? <ChevronUp size={18} color="#64748B" /> : <ChevronDown size={18} color="#64748B" />}
              </div>

              {isExpanded && req.notes && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: 13, color: '#334155' }}>
                    <strong>Notes:</strong> {req.notes}
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
