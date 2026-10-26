import { Routes, Route } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import PortalLayout from './components/PortalLayout';
import NotAvailable from './pages/NotAvailable';

// Every portal section is pending a customer-scoped API (see pages/NotAvailable.tsx).
const SECTIONS: { path: string; label: string }[] = [
  { path: '/', label: 'Dashboard' },
  { path: '/invoices', label: 'Invoices' },
  { path: '/invoices/:id', label: 'Invoice' },
  { path: '/payments', label: 'Payment Methods' },
  { path: '/boats', label: 'My Boats' },
  { path: '/insurance', label: 'Insurance' },
  { path: '/concierge', label: 'Concierge' },
  { path: '/waitlist', label: 'Waitlist' },
  { path: '/announcements', label: 'Announcements' },
  { path: '/messages', label: 'Messages' },
];

function NotFound() {
  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0A2342', margin: '0 0 12px' }}>Page not found</h1>
      <p style={{ color: '#2E4A6B' }}>There is no portal page at this address.</p>
    </div>
  );
}

export default function App() {
  return (
    <>
      <SignedIn>
        <Routes>
          <Route element={<PortalLayout />}>
            {SECTIONS.map((s) => (
              <Route key={s.path} path={s.path} element={<NotAvailable section={s.label} />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
