import React from 'react';
import { twMerge } from 'tailwind-merge';

export const inputBase =
'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50 disabled:text-slate-500';

export function inputCls(error?: string, extra?: string): string {
  return twMerge(inputBase, error && 'border-red-400 focus:border-red-500 focus:ring-red-100', extra);
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, required, error, hint, className, children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {error ?
      <p className="mt-1 text-xs font-medium text-red-600" role="alert">
          {error}
        </p> :
      hint ?
      <p className="mt-1 text-xs text-slate-500">{hint}</p> :
      null}
    </div>);

}

export function FormSection({ title, children }: {title: string;children: React.ReactNode;}) {
  return (
    <fieldset className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
      <legend className="mb-3 text-[13px] font-bold text-slate-900">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>);

}

export function FilterSelect({
  label,
  value,
  onChange,
  children,
  className






}: {label: string;value: string;onChange: (v: string) => void;children: React.ReactNode;className?: string;}) {
  return (
    <label className={twMerge('flex flex-col gap-1', className)}>
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls(undefined, 'h-9 py-1.5 pr-8 text-[13px]')}>
        {children}
      </select>
    </label>);

}