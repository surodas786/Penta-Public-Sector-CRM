import React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export function PageHeader({ title, subtitle, actions }: {title: string;subtitle?: React.ReactNode;actions?: React.ReactNode;}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>);

}

export function PageContainer({ children, className }: {children: React.ReactNode;className?: string;}) {
  return <div className={twMerge('mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-5 sm:px-6', className)}>{children}</div>;
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName







}: {title?: React.ReactNode;subtitle?: React.ReactNode;action?: React.ReactNode;children: React.ReactNode;className?: string;bodyClassName?: string;}) {
  return (
    <section className={twMerge('overflow-hidden rounded-lg border border-slate-200 bg-white', className)}>
      {(title || action) &&
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-bold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-px text-[11px] font-medium text-slate-500">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      }
      <div className={twMerge('px-4 py-3', bodyClassName)}>{children}</div>
    </section>);

}

export function PanelLink({ children, onClick }: {children: React.ReactNode;onClick: () => void;}) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-semibold text-brand transition-colors duration-150 hover:text-brand-dark">
      {children}
    </button>);

}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange




}: {tabs: {id: T;label: string;count?: number;}[];active: T;onChange: (id: T) => void;}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(t.id)}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
            isActive ? 'border-brand text-brand-dark' : 'border-transparent text-slate-500 hover:text-slate-800'}`
            }>
            
            {t.label}
            {t.count != null &&
            <span className={`rounded-full px-1.5 text-[11px] ${isActive ? 'bg-brand-light text-brand-dark' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span>
            }
          </button>);

      })}
    </div>);

}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label





}: {options: {id: T;label: string;icon?: React.ReactNode;}[];value: T;onChange: (v: T) => void;label: string;}) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5" role="group" aria-label={label}>
      {options.map((o) =>
      <button
        key={o.id}
        type="button"
        aria-pressed={value === o.id}
        onClick={() => onChange(o.id)}
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
        value === o.id ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`
        }>
        
          {o.icon}
          {o.label}
        </button>
      )}
    </div>);

}

export function Pagination({ page, pageCount, total, pageSize, onChange }: {page: number;pageCount: number;total: number;pageSize: number;onChange: (p: number) => void;}) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
      <span>
        Showing <span className="font-semibold text-slate-700">{start}–{end}</span> of <span className="font-semibold text-slate-700">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-md border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          aria-label="Previous page">
          
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span className="px-2 font-semibold text-slate-700">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
          className="rounded-md border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          aria-label="Next page">
          
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </div>);

}

export function DetailItem({ label, children }: {label: string;children: React.ReactNode;}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children || '—'}</dd>
    </div>);

}

export function SortHeader({
  label,
  active,
  dir,
  onClick,
  className






}: {label: string;active: boolean;dir: 'asc' | 'desc';onClick: () => void;className?: string;}) {
  return (
    <th scope="col" className={twMerge('px-3 py-2 text-left', className)} aria-sort={active ? dir === 'asc' ? 'ascending' : 'descending' : 'none'}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-800">
        {label}
        <span className={active ? 'text-brand' : 'text-slate-300'}>{active ? dir === 'asc' ? '▲' : '▼' : '↕'}</span>
      </button>
    </th>);

}

export const thCls = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500';
export const tdCls = 'px-3 py-2.5 text-[13px] text-slate-800';