import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LockIcon } from 'lucide-react';
import { Button } from './Button';

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact






}: {icon?: React.ReactNode;title: string;description?: string;action?: React.ReactNode;compact?: boolean;}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'px-4 py-6' : 'px-6 py-12'}`}>
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>);

}

export function AccessDenied({ title = 'You do not have access to this page', message }: {title?: string;message?: string;}) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <LockIcon className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {message ?? 'This record or page is outside the access scope of the current demo user. Switch user or return to your dashboard.'}
        </p>
        <Button variant="primary" className="mt-5" onClick={() => navigate('/')}>
          Go to my dashboard
        </Button>
      </div>
    </div>);

}