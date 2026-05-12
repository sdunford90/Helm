import React from 'react';
import { Routes, Route } from 'react-router-dom';
import AdminLayout from './components/AdminLayout';
import Dashboard from './pages/Dashboard';
import Tenants from './pages/Tenants';
import TenantDetail from './pages/TenantDetail';
import TenantDeepDive from './pages/TenantDeepDive';
import Trials from './pages/Trials';
import Billing from './pages/Billing';
import Analytics from './pages/Analytics';
import Health from './pages/Health';
import Support from './pages/Support';
import PlatformSettings from './pages/PlatformSettings';
import AdminActivity from './pages/AdminActivity';
import MyProfile from './pages/MyProfile';
import Webhooks from './pages/Webhooks';
import Queues from './pages/Queues';
import Announcements from './pages/Announcements';

const App: React.FC = () => {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tenants" element={<Tenants />} />
        <Route path="/tenants/:id/deep-dive" element={<TenantDeepDive />} />
        <Route path="/tenants/:id" element={<TenantDetail />} />
        <Route path="/trials" element={<Trials />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/health" element={<Health />} />
        <Route path="/support" element={<Support />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/queues" element={<Queues />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/activity" element={<AdminActivity />} />
        <Route path="/settings" element={<PlatformSettings />} />
        <Route path="/me" element={<MyProfile />} />
      </Route>
    </Routes>
  );
};

export default App;
