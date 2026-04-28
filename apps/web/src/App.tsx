import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Waitlist from './pages/Waitlist';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Boats from './pages/Boats';
import Slips from './pages/Slips';
import Contracts from './pages/Contracts';
import Billing from './pages/Billing';
import InvoiceDetail from './pages/InvoiceDetail';
import ARaging from './pages/ARaging';
import ChartOfAccounts from './pages/ChartOfAccounts';
import Disputes from './pages/Disputes';
import Rentals from './pages/Rentals';
import POS from './pages/POS';
import DockWalks from './pages/DockWalks';
import DockWalkRunner from './pages/DockWalkRunner';
import Reports from './pages/Reports';
import Announcements from './pages/Announcements';
import Settings from './pages/Settings';
import SettingsBilling from './pages/SettingsBilling';
import SettingsTaxRates from './pages/SettingsTaxRates';
import SettingsProducts from './pages/SettingsProducts';
import ReportsSalesTax from './pages/ReportsSalesTax';
import Onboarding from './pages/Onboarding';
import Transient from './pages/Transient';
import Ramp from './pages/Ramp';
import Concierge from './pages/Concierge';
import AuditLog from './pages/AuditLog';
import Fuel from './pages/Fuel';
import PortfolioDashboard from './pages/PortfolioDashboard';
import RentRoll from './pages/RentRoll';
import Inventory from './pages/Inventory';
import ESignPage from './pages/ESignPage';
import OAuthComplete from './pages/OAuthComplete';
import { ModulesProvider, useModules } from './context/ModulesContext';
import { BrandingProvider } from './context/BrandingContext';

function AppRoutes() {
  const { modules } = useModules();

  return (
    <Routes>
      <Route path="/signup" element={<Navigate to="/onboarding" replace />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/oauth-complete" element={<OAuthComplete />} />
      <Route path="/esign/:requestId" element={<ESignPage />} />
      {/* Mobile-first dock walk runner — full screen, no AppLayout chrome. */}
      <Route path="/dock-walks/:id/walk" element={<DockWalkRunner />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/waitlist" element={<Waitlist />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/boats" element={<Boats />} />
        <Route path="/slips" element={<Slips />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/billing/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/billing/ar-aging" element={<ARaging />} />
        <Route path="/billing/chart-of-accounts" element={<ChartOfAccounts />} />
        <Route path="/billing/disputes" element={<Disputes />} />
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
        <Route path="/settings/billing" element={<SettingsBilling />} />
        <Route path="/settings/tax-rates" element={<SettingsTaxRates />} />
        <Route path="/settings/products" element={<SettingsProducts />} />
        <Route path="/reports/sales-tax" element={<ReportsSalesTax />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrandingProvider>
      <ModulesProvider>
        <AppRoutes />
      </ModulesProvider>
    </BrandingProvider>
  );
}
