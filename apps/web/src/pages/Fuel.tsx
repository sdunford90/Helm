import { Fuel as FuelIcon } from 'lucide-react';
import UnavailablePage from '../components/UnavailablePage';

/**
 * The fuel API (apps/api/src/routes/fuel.ts) keeps fuel types, prices, sales
 * and deliveries in a process-memory array seeded with sample prices: data is
 * shared across tenants and lost on every restart. Showing it would present
 * sample numbers as real, so the page explains instead. The previous UI is in
 * git history.
 */
export default function Fuel() {
  return (
    <UnavailablePage title="Fuel Management" icon={<FuelIcon size={28} color="#0A2342" />} heading="Fuel management is not available yet">
      <p style={{ marginBottom: 12 }}>
        The fuel service does not store data in the database yet: prices, sales, deliveries and tank levels live in
        server memory, are seeded with sample values and reset whenever the server restarts.
      </p>
      <p style={{ color: '#64748B', fontSize: 13 }}>
        Record fuel sales through POS in the meantime. This page returns once fuel data is persisted per marina.
      </p>
    </UnavailablePage>
  );
}
