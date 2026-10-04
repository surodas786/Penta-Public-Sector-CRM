import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useCrm } from '../../contexts/CrmContext';
import { isPathAccessible } from '../../utils/routeAccess';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const { db, currentUser } = useCrm();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const prevUser = useRef(currentUser.id);

  // On user switch: if the open page/record is outside the new user's scope, return to their dashboard.
  useEffect(() => {
    if (prevUser.current === currentUser.id) return;
    prevUser.current = currentUser.id;
    if (!isPathAccessible(location.pathname, currentUser, db)) {
      navigate('/', { replace: true });
      toast.info(`Returned to ${currentUser.name}'s dashboard`, {
        description: 'The page you were viewing is not accessible to this user.'
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas text-slate-900">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto" id="main-content">
          <Outlet />
          <p className="pb-4 text-center text-[10.5px] text-slate-400">
            All data shown is fictional and synthetic. No project represents a real Penta contract or actual government procurement.
          </p>
        </main>
      </div>
    </div>);

}