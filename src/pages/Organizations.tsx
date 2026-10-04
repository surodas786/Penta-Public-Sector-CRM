import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { useScope } from '../hooks/useScope';
import { ORG_TYPES } from '../data/options';
import { orgName } from '../utils/lookup';
import { Button } from '../components/ui/Button';
import { FilterSelect, inputCls } from '../components/ui/FormFields';
import { AccessDenied, EmptyState } from '../components/ui/Feedback';
import { PageContainer, PageHeader, Pagination, Tabs, tdCls, thCls } from '../components/ui/Layout';
import { OrganizationForm } from '../components/organizations/OrganizationForm';
import { ContactForm } from '../components/organizations/ContactForm';

const PAGE_SIZE = 12;

export function Organizations() {
  const scope = useScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [orgFormOpen, setOrgFormOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);

  const tab = (params.get('tab') ?? 'organizations') as 'organizations' | 'contacts';
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const org = params.get('org') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const orgs = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scope.organizations.
    filter((o) => (!term || o.name.toLowerCase().includes(term) || o.location.toLowerCase().includes(term)) && (!type || o.type === type)).
    sort((a, b) => a.name.localeCompare(b.name));
  }, [scope.organizations, q, type]);

  const contacts = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scope.contacts.
    filter((c) => (!term || [c.name, c.designation, c.department, c.email].some((v) => v.toLowerCase().includes(term))) && (!org || c.orgId === org)).
    sort((a, b) => a.name.localeCompare(b.name));
  }, [scope.contacts, q, org]);

  if (!scope.salesAccess) return <AccessDenied message="The System Administrator role does not have access to the organization directory." />;

  const rows = tab === 'organizations' ? orgs : contacts;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;

  return (
    <PageContainer>
      <PageHeader
        title="Organizations & Contacts"
        subtitle={
        tab === 'organizations' ?
        'All sales roles see basic organization details. Counts show only records within your access.' :
        'Contacts are visible when linked to at least one opportunity in your scope.'
        }
        actions={
        tab === 'organizations' ?
        <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setOrgFormOpen(true)}>
              Add Organization
            </Button> :

        <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setContactFormOpen(true)}>
              Add Contact
            </Button>

        } />
      
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4 pt-2">
          <Tabs
            active={tab}
            onChange={(t) => setParams(t === 'organizations' ? {} : { tab: t }, { replace: true })}
            tabs={[
            { id: 'organizations', label: 'Organizations', count: scope.organizations.length },
            { id: 'contacts', label: 'Contacts', count: scope.contacts.length }]
            } />
          
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 px-4 py-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Search</span>
            <span className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => update({ q: e.target.value })} placeholder={tab === 'organizations' ? 'Name or location…' : 'Name, designation, email…'} className={inputCls(undefined, 'h-9 pl-8 text-[13px]')} />
            </span>
          </label>
          {tab === 'organizations' ?
          <FilterSelect label="Type" value={type} onChange={(v) => update({ type: v })} className="w-48">
              <option value="">All types</option>
              {ORG_TYPES.map((t) =>
            <option key={t}>{t}</option>
            )}
            </FilterSelect> :

          <FilterSelect label="Organization" value={org} onChange={(v) => update({ org: v })} className="w-64">
              <option value="">All organizations</option>
              {scope.organizations.map((o) =>
            <option key={o.id} value={o.id}>
                  {o.name}
                </option>
            )}
            </FilterSelect>
          }
        </div>

        {rows.length === 0 ?
        <EmptyState
          title={tab === 'organizations' ? 'No organizations found' : 'No accessible contacts found'}
          description={tab === 'contacts' ? 'Contacts appear here once linked to an opportunity you can access.' : 'Try a different search.'} /> :

        tab === 'organizations' ?
        <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className={`${thCls} pl-4`}>Organization</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Parent</th>
                  <th className={thCls}>Location</th>
                  <th className={thCls}>Website</th>
                  <th className={`${thCls} pr-4 text-right`}>Your opportunities</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orgs.slice(start, start + PAGE_SIZE).map((o) => {
                const mine = scope.opportunities.filter((x) => x.orgId === o.id).length;
                return (
                  <tr key={o.id} onClick={() => navigate(`/organizations/${o.id}`)} className="cursor-pointer transition-colors duration-150 hover:bg-slate-50">
                      <td className={`${tdCls} pl-4 font-semibold text-slate-900`}>{o.name}</td>
                      <td className={tdCls}>{o.type}</td>
                      <td className={`${tdCls} text-slate-600`}>{o.parentId ? orgName(scope.organizations, o.parentId) : '—'}</td>
                      <td className={tdCls}>{o.location}</td>
                      <td className={tdCls}>
                        {o.website ?
                      <a href={o.website} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-brand-dark hover:underline">
                            {o.website.replace(/^https?:\/\//, '')}
                          </a> :

                      '—'
                      }
                      </td>
                      <td className={`${tdCls} pr-4 text-right tabular-nums`}>{mine || <span className="text-slate-400">—</span>}</td>
                    </tr>);

              })}
              </tbody>
            </table>
          </div> :

        <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className={`${thCls} pl-4`}>Name</th>
                  <th className={thCls}>Designation</th>
                  <th className={thCls}>Organization</th>
                  <th className={thCls}>Email</th>
                  <th className={`${thCls} pr-4`}>Phone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contacts.slice(start, start + PAGE_SIZE).map((c) =>
              <tr key={c.id} onClick={() => navigate(`/contacts/${c.id}`)} className="cursor-pointer transition-colors duration-150 hover:bg-slate-50">
                    <td className={`${tdCls} pl-4 font-semibold text-slate-900`}>{c.name}</td>
                    <td className={tdCls}>{c.designation}</td>
                    <td className={`${tdCls} text-slate-600`}>{orgName(scope.organizations, c.orgId)}</td>
                    <td className={`${tdCls} text-slate-600`}>{c.email || '—'}</td>
                    <td className={`${tdCls} pr-4 text-slate-600`}>{c.phone || '—'}</td>
                  </tr>
              )}
              </tbody>
            </table>
          </div>
        }
        <Pagination page={safePage} pageCount={pageCount} total={rows.length} pageSize={PAGE_SIZE} onChange={(pg) => update({ page: String(pg) })} />
      </div>

      <OrganizationForm open={orgFormOpen} onClose={() => setOrgFormOpen(false)} onSaved={(id) => navigate(`/organizations/${id}`)} />
      <ContactForm open={contactFormOpen} onClose={() => setContactFormOpen(false)} defaultOrgId={org || undefined} onSaved={(id) => navigate(`/contacts/${id}`)} />
    </PageContainer>);

}