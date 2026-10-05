/**
 * API-mode application: real sessions, real persistence, server-enforced
 * access. This is the production path; the synthetic demo lives in
 * src/demo/DemoApp.tsx and is reachable only through `npm run dev:demo`.
 */
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { AuthProvider, useAuth } from './AuthContext.js';
import { AccessDeniedPanel } from './components/Feedback.js';
import { ApiShell } from './layout/ApiShell.js';
import { UnavailableFeature } from './components/Feedback.js';
import { AdministrationPage } from './pages/AdministrationPage.js';
import { FollowUpsPage } from './pages/FollowUpsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { OpportunitiesPage } from './pages/OpportunitiesPage.js';
import { OpportunityDetailPage } from './pages/OpportunityDetailPage.js';

export function ApiApp() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-sm text-slate-500" role="status">
          Loading…
        </p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/sign-in" element={<SignInRoute />} />

      <Route element={<RequireSession />}>
        <Route element={<ApiShell />}>
          <Route index element={<HomeRedirect />} />

          {/* Commercial screens. The server refuses these for an account
              without sales access; the client refuses to render them too, so
              an administrator following a bookmark gets a plain explanation
              instead of a view that can never load. */}
          <Route element={<RequireSalesAccess />}>
            <Route path="opportunities" element={<OpportunitiesPage />} />
            <Route path="opportunities/:id" element={<OpportunityDetailPage />} />
          </Route>

          <Route element={<RequireAdministration />}>
            <Route path="administration" element={<AdministrationPage />} />
          </Route>

          {/* Approved screens whose server endpoints arrive in later
              milestones. Kept addressable so a bookmark explains itself
              instead of silently redirecting. */}
          <Route
            element={<RequireSalesAccess />}
          >
          <Route
            path="dashboard"
            element={
              <UnavailableFeature
                title="Dashboard"
                reason="Dashboard figures must come from scoped server-side aggregates so that cards, charts, lists and exports always agree. Those shared queries arrive in the reporting milestone."
              />
            }
          />
          <Route
            path="organizations"
            element={
              <UnavailableFeature
                title="Organizations & Contacts"
                reason="Contacts, opportunity links and link-scoped relationship notes arrive with the organizations and contacts milestone."
              />
            }
          />
          <Route path="activities" element={<FollowUpsPage />} />
          <Route
            path="tenders"
            element={
              <UnavailableFeature
                title="Tender Tracker"
                reason="Tender cycles, current-notice rules and deadline tracking arrive with the tender and documents milestone."
              />
            }
          />
          <Route
            path="reports"
            element={
              <UnavailableFeature
                title="Reports"
                reason="Reports and CSV export must reuse the same scoped server queries as the dashboards, which arrive in the reporting milestone."
              />
            }
          />
          <Route
            path="team"
            element={
              <UnavailableFeature
                title="Team Management"
                reason="Structure and workload views arrive with the transfers and administration milestone."
              />
            }
          />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function SignInRoute() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <LoginPage />;
}

function RequireSession() {
  const { status } = useAuth();
  const location = useLocation();

  if (status !== 'authenticated') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }
  // Rendered by the parent Route element; children come from the nested routes.
  return <Outlet />;
}

function RequireSalesAccess() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/sign-in" replace />;
  if (!user.capabilities.salesRecords) {
    return (
      <AccessDeniedPanel
        title="No access to commercial records"
        message="The System Administrator role manages accounts, sections and reporting lines. Opportunities, contacts, documents and commercial reports are refused for this account by the server."
        actionLabel="Go to Administration"
        actionTo="/administration"
      />
    );
  }
  return <Outlet />;
}

function RequireAdministration() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/sign-in" replace />;
  if (!user.capabilities.accountAdministration) {
    return (
      <AccessDeniedPanel
        title="No access to account administration"
        message="Accounts, sections and reporting lines are maintained by the System Administrator role."
        actionLabel="Go to Opportunities"
        actionTo="/opportunities"
      />
    );
  }
  return <Outlet />;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/sign-in" replace />;
  return <Navigate to={user.capabilities.salesRecords ? '/opportunities' : '/administration'} replace />;
}
