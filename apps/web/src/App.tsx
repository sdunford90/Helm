import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Waitlist from './pages/Waitlist';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Slips from './pages/Slips';
import Contracts from './pages/Contracts';
import Billing from './pages/Billing';
import InvoiceDetail from './pages/InvoiceDetail';
import ARaging from './pages/ARaging';
import ChartOfAccounts from './pages/ChartOfAccounts';
import Rentals from './pages/Rentals';
import POS from './pages/POS';
import DockWalks from './pages/DockWalks';
import Reports from './pages/Reports';
import Announcements from './pages/Announcements';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import Transient from './pages/Transient';
import Ramp from './pages/Ramp';
import Concierge from './pages/Concierge';
import AuditLog from './pages/AuditLog';
import Fuel from './pages/Fuel';
import PortfolioDashboard from './pages/PortfolioDashboard';
import RentRoll from './pages/RentRoll';
import Inventory from './pages/Inventory';
import { ModulesProvider, useModules } from './context/ModulesContext';

function AppRoutes() {
  const { modules } = useModules();

  return (
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/waitlist" element={<Waitlist />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/slips" element={<Slips />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/billing/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/billing/ar-aging" element={<ARaging />} />
        <Route path="/billing/chart-of-accounts" element={<ChartOfAccounts />} />
        <Route
          path="/rentals"
          element={modules.rentals ? <Rentals /> : <Navigate to="/" replace />}
        />
        <Route path="/pos" element={<POS />} />
        <Route path="/fuel" element={<Fuel />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/rent-roll" element={<RentRoll />} />
        <Route path="/dock-walks" element={<DockWalks />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/transient" element={<Transient />} />
        <Route path="/ramp" element={<Ramp />} />
        <Route path="/concierge" element={<Concierge />} />
        <Route path="/audit-log" element={<AuditLog />} />
        <Route path="/email-automation" element={<Navigate to="/announcements" replace />} />
        <Route path="/portfolio" element={<PortfolioDashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ModulesProvider>
      <AppRoutes />
    </ModulesProvider>
  );
}
