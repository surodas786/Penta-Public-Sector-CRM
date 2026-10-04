import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3Icon,
  Building2Icon,
  CalendarCheckIcon,
  FileTextIcon,
  KanbanSquareIcon,
  LayoutDashboardIcon,
  UsersIcon,
  XIcon } from
'lucide-react';
import { useCrm } from '../../contexts/CrmContext';
import { canAccessSalesRecords, canViewTeamManagement } from '../../utils/permissions';

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { currentUser } = useCrm();
  const sales = canAccessSalesRecords(currentUser);
  const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, show: true },
  { to: '/opportunities', label: 'Opportunities', icon: KanbanSquareIcon, show: sales },
  { to: '/organizations', label: 'Organizations & Contacts', icon: Building2Icon, show: sales },
  { to: '/activities', label: 'Activities & Follow-ups', icon: CalendarCheckIcon, show: sales },
  { to: '/tenders', label: 'Tender Tracker', icon: FileTextIcon, show: sales },
  { to: '/reports', label: 'Reports', icon: BarChart3Icon, show: sales },
  { to: '/team', label: 'Team Management', icon: UsersIcon, show: canViewTeamManagement(currentUser) }].
  filter((i) => i.show);

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-navy text-slate-300 transition-transform duration-200 ease-out lg:static lg:translate-x-0 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'}`
        }
        aria-label="Main navigation">
        
        <div className="flex items-start justify-between border-b border-white/10 px-5 pb-4 pt-5">
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-white">Penta</span>
            <span className="text-[11px] leading-tight text-navy-muted">Public Sector Sales CRM</span>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-white lg:hidden" aria-label="Close navigation">
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          <ul className="flex flex-col gap-0.5">
            {items.map(({ to, label, icon: Icon }) =>
            <li key={to}>
                <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                isActive ? 'bg-brand text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`

                }>
                
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            )}
          </ul>
        </nav>
        <div className="border-t border-white/10 px-5 py-3 text-[10.5px] leading-relaxed text-[#7489A8]">
          Role-based access is enforced in this prototype UI. Production systems must also enforce access control server-side.
        </div>
      </aside>
    </>);

}