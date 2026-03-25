import React from 'react';

const KPIS = [
  { label: 'Total Tenants', value: '18', sub: '14 active / 3 trial / 1 locked', color: '#FF4444' },
  { label: 'Total MRR', value: '$14,850', sub: '+12% vs last month', color: '#4CAF50' },
  { label: 'Platform GMV This Month', value: '$2.34M', sub: 'Across all marinas', color: '#2196F3' },
  { label: 'Platform Fee Revenue', value: '$68,420', sub: 'Transaction fees collected', color: '#FF9800' },
  { label: 'Total Slips Managed', value: '4,267', sub: 'Across 18 marinas', color: '#9C27B0' },
  { label: 'Support Tickets Open', value: '7', sub: '2 high priority', color: '#F44336' },
];

const TENANT_HEALTH = [
  { status: 'Active', count: 14, color: '#4CAF50' },
  { status: 'Trial', count: 3, color: '#2196F3' },
  { status: 'Grace Period', count: 1, color: '#FF9800' },
  { status: 'Locked', count: 1, color: '#F44336' },
];

const MRR_TREND = [
  { month: 'Oct', value: 9800 },
  { month: 'Nov', value: 10500 },
  { month: 'Dec', value: 11200 },
  { month: 'Jan', value: 12400 },
  { month: 'Feb', value: 13250 },
  { month: 'Mar', value: 14850 },
];

const RECENT_ACTIVITY = [
  { time: '2 hours ago', event: 'New signup', detail: 'Harbor Bay Marina started Professional trial' },
  { time: '6 hours ago', event: 'Upgrade', detail: 'Sunset Cove Marina upgraded Starter → Professional' },
  { time: '1 day ago', event: 'Payment', detail: 'Monthly SaaS invoices generated for 15 tenants' },
  { time: '2 days ago', event: 'Grace Period', detail: 'Old Port Marina payment failed, entered grace period' },
  { time: '3 days ago', event: 'New signup', detail: 'Crystal Waters Yacht Club started Enterprise trial' },
  { time: '5 days ago', event: 'Churn', detail: 'Bayview Docks account locked after grace period' },
  { time: '1 week ago', event: 'Config', detail: 'Pacific Coast Marina enabled custom domain' },
];

const AT_RISK_TENANTS = [
  { name: 'Old Port Marina', reason: 'Payment failed — grace period ends in 5 days', mrr: '$499', tier: 'Professional' },
  { name: 'Lakeside Harbor', reason: 'Usage declining 40% month-over-month', mrr: '$299', tier: 'Starter' },
  { name: 'Fisherman\'s Wharf Marina', reason: 'Support tickets increasing, low NPS', mrr: '$999', tier: 'Enterprise' },
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

const Dashboard: React.FC = () => {
  const maxMRR = Math.max(...MRR_TREND.map((m) => m.value));
  const totalHealth = TENANT_HEALTH.reduce((a, b) => a + b.count, 0);

  return (
    <div>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {KPIS.map((kpi) => (
          <div key={kpi.label} style={card}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{kpi.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: kpi.color, marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Tenant Health */}
        <div style={card}>
          <div style={cardTitle}>Tenant Health</div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            {/* Pie-like visual */}
            <div style={{ position: 'relative', width: 120, height: 120 }}>
              <svg viewBox="0 0 36 36" style={{ width: 120, height: 120, transform: 'rotate(-90deg)' }}>
                {(() => {
                  let offset = 0;
                  return TENANT_HEALTH.map((seg) => {
                    const pct = (seg.count / totalHealth) * 100;
                    const el = (
                      <circle
                        key={seg.status}
                        cx="18" cy="18" r="15.9"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="3.5"
                        strokeDasharray={`${pct} ${100 - pct}`}
                        strokeDashoffset={`${-offset}`}
                      />
                    );
                    offset += pct;
                    return el;
                  });
                })()}
              </svg>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#FFF' }}>{totalHealth}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>TOTAL</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {TENANT_HEALTH.map((seg) => (
                <div key={seg.status} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color }} />
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{seg.status}</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#FFF' }}>{seg.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MRR Trend */}
        <div style={card}>
          <div style={cardTitle}>MRR Trend (Last 6 Months)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140, paddingTop: 10 }}>
            {MRR_TREND.map((m) => (
              <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 11, color: '#4CAF50', fontWeight: 600 }}>${(m.value / 1000).toFixed(1)}k</div>
                <div style={{ width: '100%', height: `${(m.value / maxMRR) * 100}px`, background: 'linear-gradient(180deg, #FF4444 0%, #CC2222 100%)', borderRadius: 4 }} />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{m.month}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Recent Activity */}
        <div style={card}>
          <div style={cardTitle}>Recent Activity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {RECENT_ACTIVITY.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: i < RECENT_ACTIVITY.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', minWidth: 80, paddingTop: 2 }}>{a.time}</div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#FF4444', marginBottom: 2 }}>{a.event}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{a.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* At-Risk Tenants */}
        <div style={card}>
          <div style={cardTitle}>At-Risk Tenants</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {AT_RISK_TENANTS.map((t) => (
              <div key={t.name} style={{ background: 'rgba(244,67,54,0.06)', border: '1px solid rgba(244,67,54,0.15)', borderRadius: 6, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#FFF' }}>{t.name}</span>
                  <span style={{ fontSize: 12, color: '#FF9800' }}>{t.mrr}/mo — {t.tier}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{t.reason}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
