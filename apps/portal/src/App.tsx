import { Routes, Route } from 'react-router-dom';
import PortalLayout from './components/PortalLayout';
import Dashboard from './pages/Dashboard';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import PaymentMethods from './pages/PaymentMethods';
import MyBoats from './pages/MyBoats';
import Insurance from './pages/Insurance';
import ConciergeRequests from './pages/ConciergeRequests';
import WaitlistStatus from './pages/WaitlistStatus';
import Announcements from './pages/Announcements';
import Messages from './pages/Messages';
import AccountProfile from './pages/AccountProfile';
import AccountNotifications from './pages/AccountNotifications';
import AccountSecurity from './pages/AccountSecurity';
import AccountHelp from './pages/AccountHelp';
import ThankYou from './pages/ThankYou';

export default function App() {
  return (
    <Routes>
      {/* Thank-you page is outside PortalLayout so it renders standalone
          after a Stripe Checkout redirect. */}
      <Route path="/thank-you" element={<ThankYou />} />
      <Route element={<PortalLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/payments" element={<PaymentMethods />} />
        <Route path="/boats" element={<MyBoats />} />
        <Route path="/insurance" element={<Insurance />} />
        <Route path="/concierge" element={<ConciergeRequests />} />
        <Route path="/waitlist" element={<WaitlistStatus />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/account/profile" element={<AccountProfile />} />
        <Route path="/account/notifications" element={<AccountNotifications />} />
        <Route path="/account/security" element={<AccountSecurity />} />
        <Route path="/account/help" element={<AccountHelp />} />
      </Route>
    </Routes>
  );
}
