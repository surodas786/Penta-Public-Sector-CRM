import { CalendarIcon, MenuIcon } from 'lucide-react';
import { useCrm } from '../../contexts/CrmContext';
import { ROLE_LABELS, sectionName } from '../../data/options';
import { DEMO_DATE_LABEL } from '../../utils/demoClock';
import { Avatar } from '../ui/Badges';
import { GlobalSearch } from './GlobalSearch';
import { NotificationsMenu } from './NotificationsMenu';
import { SwitchUserMenu } from './SwitchUserMenu';

export function TopBar({ onMenu }: {onMenu: () => void;}) {
  const { currentUser } = useCrm();
  const roleLine = `${ROLE_LABELS[currentUser.role]}${currentUser.sectionId ? ` — ${sectionName(currentUser.sectionId)}` : ''}`;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
      <button type="button" onClick={onMenu} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open navigation">
        <MenuIcon className="h-5 w-5" />
      </button>
      <GlobalSearch />
      <div className="flex-1" />
      <div className="hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-600 xl:flex">
        <CalendarIcon className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        Demo date: {DEMO_DATE_LABEL} (UTC+6)
      </div>
      <span className="hidden whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 md:inline-block">
        Synthetic demo data
      </span>
      <NotificationsMenu />
      <div className="hidden items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 lg:flex" aria-label="Current user">
        <Avatar name={currentUser.name} size="md" tone="navy" />
        <div className="leading-tight">
          <p className="text-[12.5px] font-semibold text-slate-900">{currentUser.name}</p>
          <p className="text-[10.5px] text-slate-500">{roleLine}</p>
        </div>
      </div>
      <SwitchUserMenu />
    </header>);

}