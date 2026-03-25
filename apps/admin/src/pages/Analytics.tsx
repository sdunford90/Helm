import React from 'react';

const GMV_TREND = [
  { month: 'Oct', value: 1520000 },
  { month: 'Nov', value: 1680000 },
  { month: 'Dec', value: 1890000 },
  { month: 'Jan', value: 2010000 },
  { month: 'Feb', value: 2180000 },
  { month: 'Mar', value: 2340000 },
];

const TIER_DISTRIBUTION = [
  { tier: 'Starter', count: 4, color: '#2196F3', pct: 33 },
  { tier: 'Professional', count: 5, color: '#FF9800', pct: 42 },
  { tier: 'Enterprise', count: 3, color: '#9C27B0', pct: 25 },
];

const TOP_TENANTS = [
  { name: 'Coral Reef Marina', gmv: 385000, tier: 'Enterprise' },
  { name: 'Pacific Coast Marina', gmv: 342000, tier: 'Enterprise' },
  { name: 'Fisherman\'s Wharf Marina', gmv: 298000, tier: 'Enterprise' },
  { name: 'Blue Horizon Marina', gmv: 245000, tier: 'Professional' },
  { name: 'Sunset Cove Marina', gmv: 218000, tier: 'Professional' },
  { name: 'Windward Yacht Harbor', gmv: 196000, tier: 'Professional' },
  { name: 'Seabreeze Marina', gmv: 172000, tier: 'Professional' },
  { name: 'Old Port Marina', gmv: 148000, tier: 'Professional' },
  { name: 'Anchor Point Marina', gmv: 98000, tier: 'Starter' },
  { name: 'North Shore Docks', gmv: 85000, tier: 'Starter' },
];

const FEATURE_ADOPTION = [
  { feature: 'Online Payments', pct: 94 },
  { feature: 'Automated Invoicing', pct: 88 },
  { feature: 'Waitlist Management', pct: 72 },
  { feature: 'Customer Portal', pct: 67 },
  { feature: 'Custom Domain', pct: 42 },
  { feature: 'API Integration', pct: 25 },
  { feature: 'White Label', pct: 17 },
];

const GROWTH = [
  { month: 'Oct', newTenants: 2, churned: 0, net: 2 },
  { month: 'Nov', newTenants: 3, churned: 1, net: 2 },
  { month: 'Dec', newTenants: 1, churned: 0, net: 1 },
  { month: 'Jan', newTenants: 2, churned: 0, net: 2 },
  { month: 'Feb', newTenants: 1, churned: 0, net: 1 },
  { month: 'Mar', newTenants: 3, churned: 1, net: 2 },
];

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const cardTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 16,
};

const Analytics: React.FC = () => {
  const maxGMV = Math.max(...GMV_TREND.map((m) => m.value));
  const maxTopGMV = TOP_TENANTS[0]?.gmv || 1;

  return (
    <div>
      {/* GMV Over Time */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={cardTitle}>Platform GMV Over Time</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 160, paddingTop: 10 }}>
          {GMV_TREND.map((m) => (
            <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#4CAF50', fontWeight: 600 }}>${(m.value / 1000000).toFixed(2)}M</div>
              <div style={{ width: '100%', height: `${(m.value / maxGMV) * 130}px`, background: 'linear-gradient(180deg, #FF4444 0%, #991111 100%)', borderRadius: 4 }} />
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{m.month}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Tier Distribution */}
        <div style={card}>
          <div style={cardTitle}>Tenant Distribution by Tier</div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <div style={{ position: 'relative', width: 120, height: 120 }}>
              <svg viewBox="0 0 36 36" style={{ width: 120, height: 120, transform: 'rotate(-90deg)' }}>
                {(() => {
                  let offset = 0;
                  return TIER_DISTRIBUTION.map((seg) => {
                    const el = (
                      <circle
                        key={seg.tier}
                        cx="18" cy="18" r="15.9"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="3.5"
                        strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                        strokeDashoffset={`${-offset}`}
                      />
                    );
                    offset += seg.pct;
                    return el;
                  });
                })()}
              </svg>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#FFF' }}>12</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>ACTIVE</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {TIER_DISTRIBUTION.map((seg) => (
                <div key={seg.tier} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: seg.color }} />
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{seg.tier}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#FFF' }}>{seg.count}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>{seg.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Growth Metrics */}
        <div style={card}>
          <div style={cardTitle}>Growth Metrics</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Month', 'New', 'Churned', 'Net'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROWTH.map((g) => (
                <tr key={g.month}>
                  <td style={{ padding: '8px 10px', fontSize: 13, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{g.month}</td>
                  <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: '#4CAF50', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>+{g.newTenants}</td>
                  <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: g.churned > 0 ? '#F44336' : 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{g.churned > 0 ? `-${g.churned}` : '0'}</td>
                  <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 700, color: g.net > 0 ? '#4CAF50' : '#F44336', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>+{g.net}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Top Tenants by GMV */}
        <div style={card}>
          <div style={cardTitle}>Top Tenants by GMV (This Month)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TOP_TENANTS.map((t, i) => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 22, fontSize: 12, fontWeight: 700, color: i < 3 ? '#FF4444' : 'rgba(255,255,255,0.3)', textAlign: 'right' }}>#{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: '#FFF', fontWeight: 500 }}>{t.name}</span>
                    <span style={{ fontSize: 12, color: '#4CAF50', fontWeight: 600 }}>${(t.gmv / 1000).toFixed(0)}k</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(t.gmv / maxTopGMV) * 100}%`, background: i < 3 ? '#FF4444' : 'rgba(255,68,68,0.4)', borderRadius: 2 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature Adoption */}
        <div style={card}>
          <div style={cardTitle}>Feature Adoption Rates</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {FEATURE_ADOPTION.map((f) => (
              <div key={f.feature}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{f.feature}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#FFF' }}>{f.pct}%</span>
                </div>
                <div style={{ height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${f.pct}%`, background: f.pct > 75 ? '#4CAF50' : f.pct > 40 ? '#FF9800' : '#FF4444', borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
