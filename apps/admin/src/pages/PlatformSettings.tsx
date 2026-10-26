import React from 'react';
import { useNavigate } from 'react-router-dom';
import { NotAvailable } from '../components/StateViews';

/**
 * Platform settings are not available yet. There is no platform-settings
 * endpoint (default tier, trial/grace durations, fee rates, feature flags,
 * maintenance mode, email templates); the old screen kept everything in local
 * state with hardcoded values and saved nothing. Per-tier fee rates do exist
 * on GET /api/admin/billing/tiers and are shown on the Billing page.
 */
const PlatformSettings: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <NotAvailable
        title="Platform settings are not available yet"
        message="Default tier, trial and grace periods, feature flags, maintenance mode and email templates have no API yet, so nothing set here could be saved. SaaS tier pricing and fee rates are shown on the Billing page."
      />
      <div>
        <button
          onClick={() => navigate('/billing')}
          style={{ background: '#0A2342', color: '#00D4FF', border: '1px solid #00D4FF', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          View tiers on Billing
        </button>
      </div>
    </div>
  );
};

export default PlatformSettings;
