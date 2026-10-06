/**
 * Application shell for API mode.
 *
 * Keeps the approved navy navigation, light content area and Penta wordmark
 * (FR-010). Features without a server endpoint yet are shown in their approved
 * position but visibly unavailable, with an accurate reason — never populated
 * with demo records or placeholder totals (plan 2, 7.5).
 */
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BarChart3Icon,
  Building2Icon,
  CalendarCheckIcon,
  FileTextIcon,
  KanbanSquareIcon,
  LayoutDashboardIcon,
  LockIcon,
  LogOutIcon,
  MenuIcon,
  ShieldCheckIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';

import { ROLE_LABELS } from '../../../shared/enums.js';
import { useAuth } from '../AuthContext.js';
import { Avatar } from '../ui/ApiBadges.js';
import { BUSINESS_TIME_LABEL } from '../ui/dates.js';
import { GlobalSearch } from './GlobalSearch.js';
import { NotificationsMenu } from './NotificationsMenu.js';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboardIcon;
  available: boolean;
  show: boolean;
  /** Shown as a tooltip and in the unavailable screen. */
  reason?: string;
}

export function ApiShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  const sales = user.capabilities.salesRecords;
  const admin = user.capabilities.accountAdministration;

  const items: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboardIcon, available: true, show: sales },
    { to: '/opportunities', label: 'Opportunities', icon: KanbanSquareIcon, available: true, show: sales },
    {
      to: '/organizations',
      label: 'Organizations & Contacts',
      icon: Building2Icon,
      available: true,
      show: sales,
    },
    {
      to: '/activities',
      label: 'Activities & Follow-ups',
      icon: CalendarCheckIcon,
      available: true,
      show: sales,
    },
    {
      to: '/tenders',
      label: 'Tender Tracker',
      icon: FileTextIcon,
      available: true,
      show: sales,
    },
    { to: '/reports', label: 'Reports', icon: BarChart3Icon, available: true, show: sales },
    {
      to: '/team',
      label: 'Team Management',
      icon: UsersIcon,
      available: true,
      show: user.capabilities.teamView,
    },
    { to: '/administration', label: 'Administration', icon: ShieldCheckIcon, available: true, show: admin },
  ].filter((item) => item.show);

  const handleSignOut = async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
    toast.success('Signed out');
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas text-slate-900">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-navy text-slate-300 transition-transform duration-200 ease-out lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between border-b border-white/10 px-5 pb-4 pt-5">
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-white">Penta</span>
            <span className="text-[11px] leading-tight text-navy-muted">Public Sector Sales CRM</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded p-1 text-slate-400 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* The named landmark is the navigation itself, not the surrounding panel. */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main navigation">
          <ul className="flex flex-col gap-0.5">
            {items.map(({ to, label, icon: Icon, available, reason }) => (
              <li key={to}>
                {available ? (
                  <NavLink
                    to={to}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                        isActive ? 'bg-brand text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {label}
                  </NavLink>
                ) : (
                  <span
                    className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-slate-500"
                    title={reason}
                    aria-disabled="true"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <LockIcon className="h-3 w-3 shrink-0 text-slate-600" aria-hidden="true" />
                    <span className="sr-only">Not available yet. {reason}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-white/10 px-5 py-3 text-[10.5px] leading-relaxed text-[#7489A8]">
          Access is enforced by the server on every request, including dashboards, reports, search,
          exports and notifications.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="flex-1" />
          <span className="hidden whitespace-nowrap text-[11.5px] text-slate-500 xl:inline">
            Times shown in {BUSINESS_TIME_LABEL}
          </span>
          {/* Commercial alerts only: an administrator has none (AT-01). */}
          {sales && <NotificationsMenu />}
          <div className="hidden items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 lg:flex">
            <Avatar name={user.fullName} size="md" tone="navy" />
            <div className="leading-tight">
              <p className="text-[12.5px] font-semibold text-slate-900">{user.fullName}</p>
              <p className="text-[10.5px] text-slate-500">
                {ROLE_LABELS[user.role]}
                {user.section ? ` — ${user.section.name}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md bg-navy px-3 text-xs font-semibold text-white transition-colors duration-150 hover:bg-navy-light"
          >
            <LogOutIcon className="h-3.5 w-3.5" />
            Sign out
          </button>
        </header>

        <main className="flex-1 overflow-y-auto" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
