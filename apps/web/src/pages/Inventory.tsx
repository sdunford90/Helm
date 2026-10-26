import { Package } from 'lucide-react';
import UnavailablePage from '../components/UnavailablePage';

/**
 * The inventory API (apps/api/src/routes/inventory.ts) keeps products,
 * adjustments, counts and purchase orders in process memory, and the old page
 * was mock data whose Save / Start count / Receive buttons were setTimeout
 * fakes. The previous UI is in git history.
 */
export default function Inventory() {
  return (
    <UnavailablePage title="Inventory" icon={<Package size={28} color="#0A2342" />} heading="Inventory is not available yet">
      <p style={{ marginBottom: 12 }}>
        The inventory service does not store products, stock counts or purchase orders in the database yet, so
        nothing entered here would survive a server restart.
      </p>
      <p style={{ color: '#64748B', fontSize: 13 }}>
        POS products and their on-hand quantities are managed on the POS page.
      </p>
    </UnavailablePage>
  );
}
