import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { setAuthTokenGetter } from './lib/api';
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
import ZReports from './pages/ZReports';
import ZReportDetail from './pages/ZReportDetail';
import XReport from './pages/XReport';
import DockWalks from './pages/DockWalks';
import DockWalkRunner from './pages/DockWalkRunner';
import Announcements from './pages/Announcements';
import EmailAutomation from './pages/EmailAutomation';
import Settings from './pages/Settings';
import SettingsBilling from './pages/SettingsBilling';
import SettingsTaxRates from './pages/SettingsTaxRates';
import SettingsProducts from './pages/SettingsProducts';
import SettingsPosDiscounts from './pages/SettingsPosDiscounts';
import QuickBooksSetup from './pages/QuickBooksSetup';
import AccountingHub from './pages/AccountingHub';
import AccountingOverview from './pages/AccountingOverview';
import ReportsSalesTax from './pages/ReportsSalesTax';
import Onboarding from './pages/Onboarding';
import Transient from './pages/Transient';
import Ramp from './pages/Ramp';
import Concierge from './pages/Concierge';
import Fuel from './pages/Fuel';
import PortfolioDashboard from './pages/PortfolioDashboard';
import RentRoll from './pages/RentRoll';
import Insights from './pages/Insights';
import BillingDeferredRevenue from './pages/BillingDeferredRevenue';
import Inventory from './pages/Inventory';
import PurchaseOrders from './pages/PurchaseOrders';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
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
        <Route path="/billing/deferred-revenue" element={<BillingDeferredRevenue />} />
        <Route path="/billing/rent-roll" element={<RentRoll />} />
        <Route
          path="/rentals"
          element={modules.rentals ? <Rentals /> : <Navigate to="/" replace />}
        />
        <Route path="/pos" element={<POS />} />
        <Route path="/pos/z-reports" element={<ZReports />} />
        <Route path="/pos/z-reports/:id" element={<ZReportDetail />} />
        <Route path="/pos/x-report/:shiftId" element={<XReport />} />
        <Route path="/fuel" element={<Fuel />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
        <Route path="/rent-roll" element={<Navigate to="/billing/rent-roll" replace />} />
        <Route path="/dock-walks" element={<DockWalks />} />
        <Route path="/reports" element={<Navigate to="/insights" replace />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/insights/operations" element={<Insights />} />
        <Route path="/insights/financial" element={<Insights />} />
        <Route path="/insights/customers" element={<Insights />} />
        <Route path="/insights/communications" element={<Insights />} />
        <Route path="/insights/compliance" element={<Insights />} />
        <Route path="/insights/scheduled" element={<Insights />} />
        <Route path="/insights/custom-builder" element={<Insights />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/transient" element={<Transient />} />
        <Route path="/ramp" element={<Ramp />} />
        <Route path="/concierge" element={<Concierge />} />
        <Route path="/audit-log" element={<Navigate to="/settings?tab=audit" replace />} />
        <Route path="/email-automation" element={<EmailAutomation />} />
        <Route path="/portfolio" element={<PortfolioDashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/billing" element={<SettingsBilling />} />
        <Route path="/settings/tax-rates" element={<SettingsTaxRates />} />
        <Route path="/settings/products" element={<SettingsProducts />} />
        <Route path="/settings/pos-discounts" element={<SettingsPosDiscounts />} />
        <Route path="/settings/quickbooks" element={<QuickBooksSetup />} />
        <Route path="/settings/accounting" element={<Navigate to="/accounting/setup" replace />} />
        <Route path="/accounting" element={<AccountingOverview />} />
        <Route path="/accounting/setup" element={<AccountingHub />} />
        <Route path="/accounting/periods" element={<AccountingHub />} />
        <Route path="/accounting/sync-health" element={<AccountingHub />} />
        <Route path="/accounting/reconciliation" element={<AccountingHub />} />
        <Route path="/accounting/change-log" element={<AccountingHub />} />
        <Route path="/reports/sales-tax" element={<ReportsSalesTax />} />
      </Route>
    </Routes>
  );
}

function ApiAuthBridge() {
  // Wire Clerk's getToken into the global `api` helper so every panel that
  // calls `api.get(...)` without explicitly passing a token still authenticates
  // correctly. Without this bridge the raw fetch 302-redirects to the SPA
  // shell in production and panels render empty / "save failed" silently.
  const { getToken, isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setAuthTokenGetter(() => getToken());
    } else {
      setAuthTokenGetter(null);
    }
    return () => { setAuthTokenGetter(null); };
  }, [getToken, isLoaded, isSignedIn]);
  return null;
}

export default function App() {
  return (
    <BrandingProvider>
      <ApiAuthBridge />
      <ModulesProvider>
        <AppRoutes />
      </ModulesProvider>
    </BrandingProvider>
  );
}
