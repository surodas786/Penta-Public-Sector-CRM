/**
 * The approved MagicPatterns prototype, unchanged.
 *
 * Reached only through the explicit synthetic demo build (`npm run dev:demo`
 * / `npm run build:demo`, which set VITE_DEMO_MODE=true). It keeps browser
 * storage, fictional records, the fixed demo date and the user switcher, and
 * it never contacts the API or the database.
 *
 * The production build fails if this mode is enabled — see
 * scripts/check-demo-exclusion.ts (NFR-001).
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { CrmProvider } from '../contexts/CrmContext';
import { AppShell } from '../components/layout/AppShell';
import { Dashboard } from '../pages/Dashboard';
import { Opportunities } from '../pages/Opportunities';
import { OpportunityDetail } from '../pages/OpportunityDetail';
import { Organizations } from '../pages/Organizations';
import { OrganizationDetail } from '../pages/OrganizationDetail';
import { ContactDetail } from '../pages/ContactDetail';
import { Activities } from '../pages/Activities';
import { Tenders } from '../pages/Tenders';
import { TenderDetail } from '../pages/TenderDetail';
import { Reports } from '../pages/Reports';
import { TeamManagement } from '../pages/TeamManagement';

export function DemoApp() {
  return (
    <CrmProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="opportunities" element={<Opportunities />} />
            <Route path="opportunities/:id" element={<OpportunityDetail />} />
            <Route path="organizations" element={<Organizations />} />
            <Route path="organizations/:id" element={<OrganizationDetail />} />
            <Route path="contacts/:id" element={<ContactDetail />} />
            <Route path="activities" element={<Activities />} />
            <Route path="tenders" element={<Tenders />} />
            <Route path="tenders/:id" element={<TenderDetail />} />
            <Route path="reports" element={<Reports />} />
            <Route path="team" element={<TeamManagement />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </CrmProvider>
  );
}
