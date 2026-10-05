import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BellIcon } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { useClickOutside } from '../../hooks/useClickOutside';

const DOT = { red: 'bg-red-600', amber: 'bg-amber-500', teal: 'bg-brand' };

export function NotificationsMenu() {
  const { items, unreadCount, markAllRead, markRead } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:bg-slate-50">
        
        <BellIcon className="h-4 w-4" />
        {unreadCount > 0 &&
        <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        }
      </button>
      <AnimatePresence>
        {open &&
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: 'top right' }}
          className="absolute right-0 top-11 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <p className="text-sm font-bold text-slate-900">Notifications</p>
              {unreadCount > 0 &&
            <button type="button" onClick={markAllRead} className="text-xs font-semibold text-brand hover:text-brand-dark">
                  Mark all read
                </button>
            }
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">No notifications for your records.</li>}
              {items.map((n) =>
            <li key={n.id}>
                  <button
                type="button"
                onClick={() => {
                  markRead(n.id);
                  setOpen(false);
                  navigate(n.to);
                }}
                className={`flex w-full gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-slate-50 ${n.read ? '' : 'bg-brand-light/40'}`}>
                
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[n.tone]}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className={`block text-[13px] ${n.read ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title}</span>
                      <span className="block text-[11.5px] text-slate-500">{n.detail}</span>
                    </span>
                  </button>
                </li>
            )}
            </ul>
          </motion.div>
        }
      </AnimatePresence>
    </div>);

}