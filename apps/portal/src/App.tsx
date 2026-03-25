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

export default function App() {
  return (
    <Routes>
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
      </Route>
    </Routes>
  );
}
