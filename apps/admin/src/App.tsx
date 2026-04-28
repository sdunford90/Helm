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
        <Route path="/settings" element={<PlatformSettings />} />
      </Route>
    </Routes>
  );
};

export default App;
