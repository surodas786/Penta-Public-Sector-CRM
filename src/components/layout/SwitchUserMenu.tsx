import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarIcon, CheckIcon, ChevronDownIcon, RotateCcwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useCrm } from '../../contexts/CrmContext';
import { useClickOutside } from '../../hooks/useClickOutside';
import { ROLE_LABELS, sectionName } from '../../data/options';
import { DEMO_DATE_LABEL } from '../../utils/demoClock';
import { Avatar } from '../ui/Badges';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { Role } from '../../types/crm';

const GROUPS: {role: Role;label: string;}[] = [
{ role: 'management', label: 'Top Management' },
{ role: 'lead', label: 'Section Leads' },
{ role: 'sales', label: 'Salespeople' },
{ role: 'admin', label: 'System Administration' }];


export function SwitchUserMenu() {
  const { db, currentUser, switchUser, resetDemo } = useCrm();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const choose = (id: string) => {
    setOpen(false);
    if (id === currentUser.id) return;
    switchUser(id);
    const u = db.users.find((x) => x.id === id);
    if (u) toast.success(`Now viewing as ${u.name}`, { description: ROLE_LABELS[u.role] });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md bg-navy px-3 text-xs font-semibold text-white transition-colors duration-150 hover:bg-navy-light">
        
        Demo: Switch User
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>
      <AnimatePresence>
        {open &&
        <motion.div
          role="menu"
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: 'top right' }}
          className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              <CalendarIcon className="h-3.5 w-3.5 text-slate-500" />
              <span>
                Fixed demo date: <strong className="text-slate-800">{DEMO_DATE_LABEL}</strong> · Bangladesh time (UTC+6)
              </span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {GROUPS.map((g) => {
              const users = db.users.filter((u) => u.role === g.role);
              if (!users.length) return null;
              return (
                <div key={g.role} className="py-1">
                    <p className="px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{g.label}</p>
                    {users.map((u) =>
                  <button
                    key={u.id}
                    type="button"
                    role="menuitem"
                    disabled={!u.active}
                    onClick={() => choose(u.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                    
                        <Avatar name={u.name} tone={u.id === currentUser.id ? 'navy' : 'teal'} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-slate-800">{u.name}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {ROLE_LABELS[u.role]}
                            {u.sectionId ? ` · ${sectionName(u.sectionId)}` : ''}
                            {!u.active ? ' · Inactive' : ''}
                          </span>
                        </span>
                        {u.id === currentUser.id && <CheckIcon className="h-4 w-4 text-brand" aria-label="Current user" />}
                      </button>
                  )}
                  </div>);

            })}
            </div>
            <div className="border-t border-slate-200 p-2">
              <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmReset(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-semibold text-red-700 transition-colors duration-150 hover:bg-red-50">
              
                <RotateCcwIcon className="h-4 w-4" />
                Reset Demo Data
              </button>
            </div>
          </motion.div>
        }
      </AnimatePresence>
      <ConfirmDialog
        open={confirmReset}
        title="Reset demo data?"
        message="All changes made in this browser — new records, edits, stage changes, uploads and user changes — will be discarded and the original synthetic sample data restored."
        confirmLabel="Reset demo data"
        tone="danger"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          resetDemo();
          setConfirmReset(false);
          navigate('/');
          toast.success('Demo data restored to the original sample records.');
        }} />
      
    </div>);

}