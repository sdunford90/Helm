import { useState } from 'react';
import { Shield, Upload, FileText, CheckCircle, AlertTriangle, Clock, Download } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const currentPolicy = {
  insurer: 'Progressive Marine Insurance',
  policyNumber: 'PMI-2026-449821',
  coveragePeriod: 'Jan 1, 2026 - Dec 31, 2026',
  status: 'Active' as const,
  boatName: 'Sea Breeze',
  liability: '$500,000',
  hull: '$285,000',
};

const documentHistory = [
  { id: '1', name: 'Certificate of Insurance 2026', uploaded: '2025-12-20', status: 'Approved', file: 'COI-2026.pdf' },
  { id: '2', name: 'Certificate of Insurance 2025', uploaded: '2024-12-18', status: 'Expired', file: 'COI-2025.pdf' },
  { id: '3', name: 'Supplemental Liability Endorsement', uploaded: '2025-06-10', status: 'Approved', file: 'SLE-2025.pdf' },
];

const statusColor: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  Active: { bg: '#E6FAF0', text: '#0D9F6E', icon: CheckCircle },
  Expiring: { bg: '#FFF8E6', text: '#D97706', icon: AlertTriangle },
  Expired: { bg: '#FFE6E6', text: '#DC2626', icon: AlertTriangle },
  Approved: { bg: '#E6FAF0', text: '#0D9F6E', icon: CheckCircle },
  Pending: { bg: '#FFF8E6', text: '#D97706', icon: Clock },
};

export default function Insurance() {
  const [dragOver, setDragOver] = useState(false);

  const statusBadge = (status: string): CSSProperties => {
    const s = statusColor[status] || statusColor.Pending;
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
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Insurance</h1>
        <p style={{ color: '#64748B', fontSize: 14 }}>Manage your vessel insurance certificates and compliance.</p>
      </div>

      {/* Current Policy */}
      <div style={{ ...card, marginBottom: 24, border: '2px solid #E6FAF0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: '#E6FAF0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Shield size={22} color="#0D9F6E" />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 600, color: NAVY, margin: 0 }}>Current Policy</h2>
              <p style={{ color: '#64748B', fontSize: 13, margin: 0 }}>{currentPolicy.boatName}</p>
            </div>
          </div>
          <span style={statusBadge(currentPolicy.status)}>
            <CheckCircle size={12} /> {currentPolicy.status}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            { label: 'Insurer', value: currentPolicy.insurer },
            { label: 'Policy Number', value: currentPolicy.policyNumber },
            { label: 'Coverage Period', value: currentPolicy.coveragePeriod },
            { label: 'Liability Coverage', value: currentPolicy.liability },
            { label: 'Hull Value', value: currentPolicy.hull },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Expiry Alert */}
      <div
        style={{
          ...card,
          marginBottom: 24,
          background: '#FFF8E6',
          border: '1px solid #FDE68A',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <AlertTriangle size={20} color="#D97706" />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#92400E' }}>
            Registration for "Sea Breeze" expires May 15, 2026
          </div>
          <div style={{ fontSize: 13, color: '#92400E', opacity: 0.8 }}>
            Please upload updated registration documents before expiry.
          </div>
        </div>
      </div>

      {/* Upload Area */}
      <div
        style={{
          ...card,
          marginBottom: 24,
          border: dragOver ? `2px dashed ${CYAN}` : '2px dashed #CBD5E1',
          background: dragOver ? 'rgba(0, 212, 255, 0.04)' : '#fff',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
      >
        <Upload size={32} color={dragOver ? CYAN : '#94A3B8'} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 4 }}>
          Upload Insurance Certificate
        </div>
        <div style={{ fontSize: 13, color: '#64748B' }}>
          Drag and drop your file here, or <span style={{ color: CYAN, fontWeight: 500 }}>browse</span>
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>PDF, JPG, or PNG up to 10MB</div>
      </div>

      {/* Document History */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Document History</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #F1F5F9' }}>
              {['Document', 'Uploaded', 'Status', ''].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#64748B',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documentHistory.map((doc) => (
              <tr key={doc.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '12px', fontSize: 14, color: '#334155' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={16} color="#64748B" />
                    {doc.name}
                  </div>
                </td>
                <td style={{ padding: '12px', fontSize: 13, color: '#64748B' }}>{doc.uploaded}</td>
                <td style={{ padding: '12px' }}>
                  <span style={statusBadge(doc.status)}>{doc.status}</span>
                </td>
                <td style={{ padding: '12px' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: 4 }}
                    title="Download"
                  >
                    <Download size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
