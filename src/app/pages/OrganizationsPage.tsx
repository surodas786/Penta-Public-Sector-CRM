/**
 * Organizations & Contacts — the approved directory screen (FR-030–FR-032).
 *
 * The Organizations tab is the shared directory every sales role sees; its
 * opportunity column counts only records the viewer may access, and says so.
 * The Contacts tab lists only contacts linked to an opportunity the viewer can
 * see (SEC-004). Both are paginated and searched on the server.
 */
import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PlusIcon, SearchIcon } from 'lucide-react';

import { ORGANIZATION_TYPES, ORGANIZATION_TYPE_LABELS } from '../../../shared/enums.js';
import { fetchContacts, fetchDirectory } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { FilterSelect, inputCls } from '../../components/ui/FormFields';
import { PageContainer, PageHeader, Pagination, Tabs, tdCls, thCls } from '../../components/ui/Layout';
import { ContactDialog, OrganizationDialog } from '../components/DirectoryDialogs.js';
import { ErrorPanel, LoadingRows } from '../components/Feedback.js';
import { useApiResource } from '../useApiResource.js';

const PAGE_SIZE = 25;

export function OrganizationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [orgFormOpen, setOrgFormOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);

  const tab = params.get('tab') === 'contacts' ? 'contacts' : 'organizations';
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const organizationId = params.get('org') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const orgs = useApiResource(
    useCallback(
      (signal: AbortSignal) =>
        tab === 'organizations'
          ? fetchDirectory({ q: q || undefined, type: type || undefined, page, pageSize: PAGE_SIZE }, signal)
          : Promise.resolve(null),
      [tab, q, type, page],
    ),
    [tab, q, type, page],
  );
  const contacts = useApiResource(
    useCallback(
      (signal: AbortSignal) =>
        tab === 'contacts'
          ? fetchContacts({ q: q || undefined, organizationId: organizationId || undefined, page, pageSize: PAGE_SIZE }, signal)
          : Promise.resolve(null),
      [tab, q, organizationId, page],
    ),
    [tab, q, organizationId, page],
  );
  // For the Contacts tab's organization filter.
  const allOrgs = useApiResource(
    useCallback((signal: AbortSignal) => fetchDirectory({ pageSize: 100 }, signal), []),
    [],
  );

  const resource = tab === 'organizations' ? orgs : contacts;
  const data = resource.data;

  return (
    <PageContainer>
      <PageHeader
        title="Organizations & Contacts"
        subtitle={
          tab === 'organizations'
            ? 'All sales roles see basic organization details. Counts show only records within your access.'
            : 'Contacts are visible when linked to at least one opportunity in your scope.'
        }
        actions={
          tab === 'organizations' ? (
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setOrgFormOpen(true)}>
              Add Organization
            </Button>
          ) : (
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setContactFormOpen(true)}>
              Add Contact
            </Button>
          )
        }
      />

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4 pt-2">
          <Tabs
            active={tab}
            onChange={(next) => setParams(next === 'organizations' ? {} : { tab: next }, { replace: true })}
            tabs={[
              { id: 'organizations', label: 'Organizations', count: tab === 'organizations' ? orgs.data?.total : undefined },
              { id: 'contacts', label: 'Contacts', count: tab === 'contacts' ? contacts.data?.total : undefined },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 px-4 py-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Search</span>
            <span className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={q}
                onChange={(event) => update({ q: event.target.value })}
                placeholder={tab === 'organizations' ? 'Name or location…' : 'Name, designation, email…'}
                className={inputCls(undefined, 'h-9 pl-8 text-[13px]')}
              />
            </span>
          </label>
          {tab === 'organizations' ? (
            <FilterSelect label="Type" value={type} onChange={(value) => update({ type: value })} className="w-48">
              <option value="">All types</option>
              {ORGANIZATION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ORGANIZATION_TYPE_LABELS[value]}
                </option>
              ))}
            </FilterSelect>
          ) : (
            <FilterSelect label="Organization" value={organizationId} onChange={(value) => update({ org: value })} className="w-64">
              <option value="">All organizations</option>
              {allOrgs.data?.items.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </FilterSelect>
          )}
        </div>

        {resource.error ? (
          <div className="p-4">
            <ErrorPanel error={resource.error} onRetry={resource.reload} />
          </div>
        ) : tab === 'organizations' ? (
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
                {orgs.loading && !orgs.data && <LoadingRows columns={6} />}
                {orgs.data?.items.map((org) => (
                  <tr
                    key={org.id}
                    onClick={() => navigate(`/organizations/${org.id}`)}
                    className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  >
                    <td className={`${tdCls} pl-4 font-semibold text-slate-900`}>{org.name}</td>
                    <td className={tdCls}>{ORGANIZATION_TYPE_LABELS[org.type]}</td>
                    <td className={`${tdCls} text-slate-600`}>{org.parentName ?? '—'}</td>
                    <td className={tdCls}>{org.location ?? '—'}</td>
                    <td className={tdCls}>
                      {org.website ? (
                        <a
                          href={org.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="text-brand-dark hover:underline"
                        >
                          {org.website.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={`${tdCls} pr-4 text-right tabular-nums`}>
                      {org.accessibleOpportunities || <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
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
                {contacts.loading && !contacts.data && <LoadingRows columns={5} />}
                {contacts.data?.items.map((contact) => (
                  <tr
                    key={contact.id}
                    onClick={() => navigate(`/contacts/${contact.id}`)}
                    className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  >
                    <td className={`${tdCls} pl-4 font-semibold text-slate-900`}>{contact.fullName}</td>
                    <td className={tdCls}>{contact.designation}</td>
                    <td className={`${tdCls} text-slate-600`}>{contact.organizationName}</td>
                    <td className={`${tdCls} text-slate-600`}>{contact.email ?? '—'}</td>
                    <td className={`${tdCls} pr-4 text-slate-600`}>{contact.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.items.length === 0 && (
          <EmptyState
            title={tab === 'organizations' ? 'No organizations found' : 'No accessible contacts found'}
            description={
              tab === 'contacts'
                ? 'Contacts appear here once linked to an opportunity you can access.'
                : 'Try a different search.'
            }
          />
        )}
        {data && (
          <Pagination
            page={data.page}
            pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))}
            total={data.total}
            pageSize={data.pageSize}
            onChange={(next) => update({ page: String(next) })}
          />
        )}
      </div>

      <OrganizationDialog
        open={orgFormOpen}
        onClose={() => setOrgFormOpen(false)}
        onSaved={(saved) => {
          setOrgFormOpen(false);
          navigate(`/organizations/${saved.id}`);
        }}
      />
      <ContactDialog
        open={contactFormOpen}
        defaultOrganizationId={organizationId || undefined}
        onClose={() => setContactFormOpen(false)}
        onSaved={(saved) => {
          setContactFormOpen(false);
          navigate(`/contacts/${saved.id}`);
        }}
      />
    </PageContainer>
  );
}
