import React, { useState } from 'react';

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 24,
};

const cardTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 20,
};

const fieldRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 0',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const fieldLabel: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.6)' };

const inputStyle: React.CSSProperties = {
  background: '#070E18',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#FFF',
  fontSize: 13,
  outline: 'none',
  width: 200,
  textAlign: 'right',
};

const toggleStyle = (on: boolean): React.CSSProperties => ({
  width: 44,
  height: 24,
  borderRadius: 12,
  background: on ? '#00D4FF' : 'rgba(255,255,255,0.1)',
  position: 'relative',
  cursor: 'pointer',
  transition: 'background 0.2s',
  border: 'none',
  padding: 0,
});

const toggleKnob = (on: boolean): React.CSSProperties => ({
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: '#FFF',
  position: 'absolute',
  top: 3,
  left: on ? 23 : 3,
  transition: 'left 0.2s',
});

const PlatformSettings: React.FC = () => {
  const [defaultTier, setDefaultTier] = useState('Professional');
  const [achRate, setAchRate] = useState('0.8');
  const [cardRate, setCardRate] = useState('2.9');
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  const [features, setFeatures] = useState({
    multiCurrency: false,
    advancedAnalytics: true,
    apiAccess: true,
    whiteLabel: true,
    waitlistManagement: true,
    mobileApp: false,
    ssoIntegration: false,
    bulkOperations: true,
  });

  const [emailTemplates] = useState([
    { name: 'Welcome Email', subject: 'Welcome to Helm!', lastEdited: '2026-02-15', status: 'active' },
    { name: 'Trial Expiring', subject: 'Your trial ends in 3 days', lastEdited: '2026-02-20', status: 'active' },
    { name: 'Payment Failed', subject: 'Action required: Payment failed', lastEdited: '2026-01-10', status: 'active' },
    { name: 'Account Locked', subject: 'Your account has been suspended', lastEdited: '2026-01-10', status: 'active' },
    { name: 'Monthly Summary', subject: 'Your monthly Helm summary', lastEdited: '2026-03-01', status: 'active' },
    { name: 'Feature Update', subject: 'New features available in Helm', lastEdited: '2026-03-15', status: 'draft' },
  ]);

  const toggleFeature = (key: string) => {
    setFeatures((prev) => ({ ...prev, [key]: !(prev as any)[key] }));
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Default Tier */}
        <div style={card}>
          <div style={cardTitle}>Default SaaS Tier Configuration</div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Default tier for new signups</span>
            <select
              value={defaultTier}
              onChange={(e) => setDefaultTier(e.target.value)}
              style={inputStyle}
            >
              <option value="Starter">Starter — $299/mo</option>
              <option value="Professional">Professional — $499/mo</option>
              <option value="Enterprise">Enterprise — $999/mo</option>
            </select>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Trial duration</span>
            <input type="text" defaultValue="14 days" style={inputStyle} />
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Grace period</span>
            <input type="text" defaultValue="7 days" style={inputStyle} />
          </div>
          <div style={{ ...fieldRow, borderBottom: 'none' }}>
            <span style={fieldLabel}>Auto-lock after grace period</span>
            <button style={toggleStyle(true)} disabled>
              <div style={toggleKnob(true)} />
            </button>
          </div>
        </div>

        {/* Platform Fee Rates */}
        <div style={card}>
          <div style={cardTitle}>Platform Fee Rates</div>
          <div style={fieldRow}>
            <div>
              <div style={fieldLabel}>Default ACH Fee Rate</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Applied to bank transfer payments</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input value={achRate} onChange={(e) => setAchRate(e.target.value)} style={{ ...inputStyle, width: 80 }} />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>%</span>
            </div>
          </div>
          <div style={fieldRow}>
            <div>
              <div style={fieldLabel}>Default Card Fee Rate</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Applied to credit/debit card payments</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input value={cardRate} onChange={(e) => setCardRate(e.target.value)} style={{ ...inputStyle, width: 80 }} />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>%</span>
            </div>
          </div>
          <div style={fieldRow}>
            <div>
              <div style={fieldLabel}>Stripe Connect Fee</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Platform application fee</div>
            </div>
            <input type="text" defaultValue="0.5" style={{ ...inputStyle, width: 80 }} />
          </div>
          <div style={{ ...fieldRow, borderBottom: 'none' }}>
            <div>
              <div style={fieldLabel}>Fee Cap per Transaction</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Maximum fee amount</div>
            </div>
            <input type="text" defaultValue="$50.00" style={{ ...inputStyle, width: 100 }} />
          </div>
        </div>
      </div>

      {/* Email Templates */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={cardTitle}>Email Templates</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Template Name', 'Subject Line', 'Last Edited', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {emailTemplates.map((t) => (
              <tr key={t.name}>
                <td style={{ padding: '12px', fontSize: 13, fontWeight: 500, color: '#FFF', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.name}</td>
                <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.subject}</td>
                <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t.lastEdited}</td>
                <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{
                    background: t.status === 'active' ? 'rgba(76,175,80,0.15)' : 'rgba(255,152,0,0.15)',
                    color: t.status === 'active' ? '#4CAF50' : '#FF9800',
                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                  }}>{t.status}</span>
                </td>
                <td style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'right' }}>
                  <button style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '4px 12px', color: 'rgba(255,255,255,0.5)', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Maintenance Mode */}
        <div style={card}>
          <div style={cardTitle}>Maintenance Mode</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#FFF' }}>Platform Maintenance Mode</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                When enabled, all tenant apps show a maintenance page. Admin portal remains accessible.
              </div>
            </div>
            <button style={toggleStyle(maintenanceMode)} onClick={() => setMaintenanceMode(!maintenanceMode)}>
              <div style={toggleKnob(maintenanceMode)} />
            </button>
          </div>
          {maintenanceMode && (
            <div style={{ background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.2)', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F44336', marginBottom: 4 }}>Maintenance Mode Active</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>All tenant-facing applications are currently showing the maintenance page.</div>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Maintenance Message</label>
            <textarea
              defaultValue="We're performing scheduled maintenance. We'll be back shortly. Thank you for your patience."
              style={{ width: '100%', background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '10px 12px', color: '#FFF', fontSize: 13, outline: 'none', resize: 'vertical', minHeight: 80, boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Feature Flags */}
        <div style={card}>
          <div style={cardTitle}>Feature Flags</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>Global feature toggles that affect all tenants</div>
          {Object.entries(features).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
              </span>
              <button style={toggleStyle(val)} onClick={() => toggleFeature(key)}>
                <div style={toggleKnob(val)} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        <button style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '10px 24px', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Reset to Defaults</button>
        <button style={{ background: '#0A2342', border: '1px solid #00D4FF', borderRadius: 6, padding: '10px 24px', color: '#00D4FF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save All Changes</button>
      </div>
    </div>
  );
};

export default PlatformSettings;
