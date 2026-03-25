import React from 'react';
import { X, Edit, UserPlus, Wrench, QrCode, Printer } from 'lucide-react';

interface SlipInfo {
  id: string;
  number: string;
  dock: string;
  length: number;
  width: number;
  depth: number;
  power: string;
  type: string;
  electricityMode: string;
  status: 'Vacant' | 'Occupied' | 'Maintenance' | 'Reserved';
  occupant?: {
    name: string;
    boat: string;
    contractStart: string;
    contractEnd: string;
  };
  meterReadings: Array<{
    date: string;
    kWh: number;
    amount: number;
  }>;
}

interface SlipDetailPanelProps {
  slip: SlipInfo;
  onClose: () => void;
  onEdit: () => void;
  onAssign: () => void;
  onMaintenance: () => void;
}

const statusColors: Record<string, { bg: string; color: string; border?: string }> = {
  Vacant: { bg: '#FFFFFF', color: '#64748B', border: '#CCC' },
  Occupied: { bg: '#D6E8F4', color: '#0A2342' },
  Maintenance: { bg: '#FFF3CD', color: '#856404' },
  Reserved: { bg: '#E0F7FF', color: '#0A2342', border: '#00D4FF' },
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    width: '420px',
    height: '100vh',
    background: '#FFFFFF',
    boxShadow: '-4px 0 12px rgba(0,0,0,0.12)',
    zIndex: 1000,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    borderBottom: '2px solid #00D4FF',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#2E4A6B',
    padding: '4px',
  },
  body: {
    padding: '24px',
    flex: 1,
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '12px',
    marginTop: '24px',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  infoLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  infoValue: {
    fontSize: '14px',
    color: '#0A2342',
    marginTop: '2px',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '9999px',
  },
  card: {
    background: '#F7F9FB',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '12px',
  },
  tableWrap: {
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    overflow: 'hidden',
    marginTop: '12px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '8px 12px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
  },
  td: {
    padding: '8px 12px',
    color: '#0A2342',
    borderBottom: '1px solid #E2E8F0',
  },
  mono: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '13px',
  },
  qrSection: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#F7F9FB',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '12px',
  },
  qrPlaceholder: {
    width: '80px',
    height: '80px',
    border: '2px dashed #CCC',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748B',
  },
  printBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    background: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    padding: '24px',
    borderTop: '1px solid #E2E8F0',
  },
  actionBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '8px 12px',
    fontSize: '13px',
    fontWeight: 600,
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid #CCC',
    background: '#FFFFFF',
    color: '#0A2342',
  },
};

export default function SlipDetailPanel({ slip, onClose, onEdit, onAssign, onMaintenance }: SlipDetailPanelProps) {
  const sts = statusColors[slip.status];

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.title}>Slip {slip.number}</h2>
        <button style={styles.closeBtn} onClick={onClose}><X size={20} /></button>
      </div>

      <div style={styles.body}>
        {/* Slip Info */}
        <div style={{ ...styles.sectionTitle, marginTop: 0 }}>Slip Information</div>
        <div style={styles.infoGrid}>
          <div>
            <div style={styles.infoLabel}>Slip #</div>
            <div style={styles.infoValue}>{slip.number}</div>
          </div>
          <div>
            <div style={styles.infoLabel}>Dock</div>
            <div style={styles.infoValue}>{slip.dock}</div>
          </div>
          <div>
            <div style={styles.infoLabel}>Dimensions</div>
            <div style={styles.infoValue}>{slip.length}' x {slip.width}' x {slip.depth}'</div>
          </div>
          <div>
            <div style={styles.infoLabel}>Power</div>
            <div style={styles.infoValue}>{slip.power}</div>
          </div>
          <div>
            <div style={styles.infoLabel}>Type</div>
            <div style={styles.infoValue}>{slip.type}</div>
          </div>
          <div>
            <div style={styles.infoLabel}>Status</div>
            <div style={{ marginTop: '2px' }}>
              <span
                style={{
                  ...styles.badge,
                  backgroundColor: sts.bg,
                  color: sts.color,
                  border: sts.border ? `1px solid ${sts.border}` : 'none',
                }}
              >
                {slip.status}
              </span>
            </div>
          </div>
        </div>

        {/* Current Occupant */}
        {slip.occupant && (
          <>
            <div style={styles.sectionTitle}>Current Occupant</div>
            <div style={styles.card}>
              <div style={{ fontWeight: 600, color: '#0A2342', marginBottom: '4px' }}>{slip.occupant.name}</div>
              <div style={{ fontSize: '13px', color: '#2E4A6B', marginBottom: '8px' }}>{slip.occupant.boat}</div>
              <div style={{ display: 'flex', gap: '24px' }}>
                <div>
                  <div style={styles.infoLabel}>Contract Start</div>
                  <div style={{ fontSize: '13px', color: '#0A2342' }}>{slip.occupant.contractStart}</div>
                </div>
                <div>
                  <div style={styles.infoLabel}>Contract End</div>
                  <div style={{ fontSize: '13px', color: '#0A2342' }}>{slip.occupant.contractEnd}</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Meter Readings */}
        <div style={styles.sectionTitle}>Meter Readings</div>
        {slip.meterReadings.length > 0 ? (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>kWh</th>
                  <th style={styles.th}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {slip.meterReadings.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...styles.td, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#D6E8F4' }}>{r.date}</td>
                    <td style={{ ...styles.td, ...styles.mono, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#D6E8F4' }}>
                      {r.kWh.toLocaleString()}
                    </td>
                    <td style={{ ...styles.td, ...styles.mono, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#D6E8F4' }}>
                      ${r.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: '#64748B', fontStyle: 'italic' }}>No meter readings recorded.</div>
        )}

        {/* QR Code */}
        <div style={styles.sectionTitle}>QR Code</div>
        <div style={styles.qrSection}>
          <div style={styles.qrPlaceholder}>
            <QrCode size={32} />
          </div>
          <div style={{ flex: 1, marginLeft: '16px' }}>
            <div style={{ fontSize: '13px', color: '#2E4A6B', marginBottom: '8px' }}>
              Scan to view slip details or submit meter readings.
            </div>
            <button style={styles.printBtn}>
              <Printer size={14} />
              Print QR
            </button>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={styles.actions}>
        <button style={styles.actionBtn} onClick={onEdit}>
          <Edit size={14} /> Edit
        </button>
        <button style={styles.actionBtn} onClick={onAssign}>
          <UserPlus size={14} /> Assign
        </button>
        <button style={{ ...styles.actionBtn, color: '#856404', borderColor: '#F0E68C', background: '#FFFBE6' }} onClick={onMaintenance}>
          <Wrench size={14} /> Maintenance
        </button>
      </div>
    </div>
  );
}
