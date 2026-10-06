/**
 * In-app notifications (FR-090, BR-070) — the approved bell and menu, backed
 * by the server's persistent alerts. The unread count is the server's, polled
 * while the page is open; the list is loaded when the menu opens. Opening an
 * alert marks it read and navigates to the record, where access is checked
 * again; reading never completes or changes the task. An alert the server no
 * longer lists (obsolete, or access lost) simply disappears.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BellIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { NotificationDto } from '../../../shared/api.js';
import { ApiRequestError } from '../../api/client.js';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/endpoints.js';
import { useAuth } from '../AuthContext.js';

const DOT = { red: 'bg-red-600', amber: 'bg-amber-500', teal: 'bg-brand' };
const POLL_MS = 60_000;

export function NotificationsMenu() {
  const { sessionKey } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async (signal?: AbortSignal) => {
    try {
      setUnread((await fetchUnreadCount(signal)).unreadCount);
    } catch {
      // A failed poll keeps the last known count; the next poll retries.
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const list = await fetchNotifications({ pageSize: 20 });
      setItems(list.items);
      setTotal(list.total);
      setUnread(list.unreadCount);
    } catch (caught) {
      setItems([]);
      toast.error(caught instanceof ApiRequestError ? caught.message : 'Notifications could not be loaded.');
    }
  }, []);

  useEffect(() => {
    setItems(null);
    setUnread(0);
    const controller = new AbortController();
    void refreshCount(controller.signal);
    const timer = setInterval(() => void refreshCount(), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refreshCount, sessionKey]);

  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openItem = async (item: NotificationDto) => {
    setOpen(false);
    try {
      const result = await markNotificationRead(item.id);
      setUnread(result.unreadCount);
      navigate(result.notification.path);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 404) {
        toast.message('That alert no longer applies.', { description: 'It has been resolved, or the record is no longer available to you.' });
        void refreshCount();
        return;
      }
      toast.error(caught instanceof ApiRequestError ? caught.message : 'The alert could not be opened.');
    }
  };

  const markAll = async () => {
    try {
      setUnread((await markAllNotificationsRead()).unreadCount);
      await loadList();
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : 'Could not mark the alerts read.');
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:bg-slate-50"
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 top-11 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
            role="dialog"
            aria-label="Notifications"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <p className="text-sm font-bold text-slate-900">Notifications</p>
              {unread > 0 && (
                <button type="button" onClick={() => void markAll()} className="text-xs font-semibold text-brand hover:text-brand-dark">
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {items === null && (
                <li className="px-4 py-8 text-center text-sm text-slate-500" role="status">
                  Loading…
                </li>
              )}
              {items?.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">No notifications for your records.</li>}
              {items?.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(item)}
                    className={`flex w-full gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-slate-50 ${
                      item.readAt ? '' : 'bg-brand-light/40'
                    }`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[item.tone]}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className={`block text-[13px] ${item.readAt ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'}`}>
                        {item.title}
                        {!item.readAt && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="block text-[11.5px] text-slate-500">{item.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {items !== null && total > items.length && (
              <p className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
                Showing the latest {items.length} of {total}.
              </p>
            )}
            <p className="border-t border-slate-200 px-4 py-2 text-[10.5px] text-slate-500">
              Reading an alert does not complete its task.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
