import { Ship, Wrench } from 'lucide-react';
import { useResource } from '../hooks/useApi';

/**
 * Rentals is being rebuilt during Phase 0. The previous screen was driven by
 * generated mock availability, a client-side pricing engine and local-only
 * check-in/out, none of which matched the API. The API returns
 * 503 MODULE_DISABLED for /api/rentals while the module is rebuilt.
 *
 * The old UI (availability grid, pricing calendar, price simulator) is in git
 * history; PricingCalendar.tsx and PriceSimulator.tsx are kept but unused.
 */
export default function Rentals() {
  // Probe the API so the notice states what the server says, not a guess.
  const probe = useResource<unknown>('/rentals/products');
  const disabledByServer = probe.status === 503 || probe.code === 'MODULE_DISABLED';

  return (
    <div style={{ padding: '32px' }}>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 }} className="helm-page-title">
        Rentals
      </h1>
      <hr style={{ height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' }} />
      <div
        role="status"
        style={{
          display: 'flex', gap: 20, alignItems: 'flex-start', background: '#FFFFFF', border: '1px dashed #CBD5E1',
          borderRadius: 12, padding: '28px 32px', maxWidth: 760,
        }}
      >
        <div style={{ background: '#F1F5F9', borderRadius: 12, padding: 14, flexShrink: 0 }}>
          <Ship size={28} color="#0A2342" />
        </div>
        <div>
          <h2 style={{ fontSize: 20, color: '#0A2342', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wrench size={18} /> The Rentals module is being rebuilt
          </h2>
          <p style={{ color: '#2E4A6B', lineHeight: 1.6, marginBottom: 12 }}>
            Rental products, availability, reservations and dynamic pricing are offline while they are rebuilt on the
            real reservation and pricing API. Nothing shown here would have been saved, so the old screen has been
            withdrawn rather than showing sample data.
          </p>
          <p style={{ color: '#64748B', fontSize: 13 }}>
            {probe.loading
              ? 'Checking the server…'
              : disabledByServer
                ? 'Server status: the rentals API is disabled for this phase (503 MODULE_DISABLED).'
                : probe.error
                  ? `Server status: ${probe.error}`
                  : 'Server status: the rentals API responded, but this screen has not been rebuilt yet.'}
          </p>
        </div>
      </div>
    </div>
  );
}
