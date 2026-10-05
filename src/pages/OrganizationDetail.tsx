import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useScope } from '../hooks/useScope';
import { formatBDTShort } from '../utils/format';
import { orgName, userName } from '../utils/lookup';
import { Button } from '../components/ui/Button';
import { StageBadge } from '../components/ui/Badges';
import { AccessDenied, EmptyState } from '../components/ui/Feedback';
import { DetailItem, PageContainer, Panel, tdCls, thCls } from '../components/ui/Layout';
import { OrganizationForm } from '../components/organizations/OrganizationForm';
import { ContactForm } from '../components/organizations/ContactForm';
import { ActivityTimeline } from '../components/activities/ActivityTimeline';

export function OrganizationDetail() {
  const { id } = useParams();
  const scope = useScope();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  if (!scope.salesAccess) return <AccessDenied />;
  const org = scope.organizations.find((o) => o.id === id);
  if (!org) return <AccessDenied title="Organization not found" message="This organization does not exist in the demo data." />;

  // Only records permitted for the current user are shown; no totals of inaccessible records are revealed.
  const opps = scope.opportunities.filter((o) => o.orgId === org.id);
  const oppIds = new Set(opps.map((o) => o.id));
  const contacts = scope.contacts.filter((c) => c.orgId === org.id);
  const activities = scope.activities.filter((a) => oppIds.has(a.oppId)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const children = scope.organizations.filter((o) => o.parentId === org.id);

  return (
    <PageContainer>
      <button type="button" onClick={() => navigate('/organizations')} className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900">
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Organizations
      </button>
      <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold text-brand-dark">{org.type}</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{org.name}</h1>
          <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4">
            <DetailItem label="Location">{org.location}</DetailItem>
            <DetailItem label="Parent">
              {org.parentId ?
              <Link to={`/organizations/${org.parentId}`} className="text-brand-dark hover:underline">
                  {orgName(scope.organizations, org.parentId)}
                </Link> :

              '—'
              }
            </DetailItem>
            <DetailItem label="Website">
              {org.website ?
              <a href={org.website} target="_blank" rel="noopener noreferrer" className="text-brand-dark hover:underline">
                  {org.website.replace(/^https?:\/\//, '')}
                </a> :

              '—'
              }
            </DetailItem>
            {children.length > 0 &&
            <DetailItem label="Sub-organizations">
                {children.map((c) =>
              <Link key={c.id} to={`/organizations/${c.id}`} className="block text-brand-dark hover:underline">
                    {c.name}
                  </Link>
              )}
              </DetailItem>
            }
          </dl>
          {org.notes && <p className="mt-3 max-w-2xl text-sm text-slate-600">{org.notes}</p>}
        </div>
        <Button icon={<PencilIcon className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      </header>

      <p className="text-xs text-slate-500">Showing only contacts, opportunities and activity within your access scope.</p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Your opportunities" className="lg:col-span-2" bodyClassName="p-0">
          {opps.length ?
          <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className={`${thCls} pl-4`}>Opportunity</th>
                    <th className={thCls}>Stage</th>
                    <th className={thCls}>Owner</th>
                    <th className={`${thCls} pr-4 text-right`}>Est. value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {opps.map((o) =>
                <tr key={o.id} onClick={() => navigate(`/opportunities/${o.id}`)} className="cursor-pointer hover:bg-slate-50">
                      <td className={`${tdCls} pl-4 font-semibold`}>{o.name}</td>
                      <td className={tdCls}>
                        <StageBadge stage={o.stage} />
                      </td>
                      <td className={tdCls}>{userName(scope.users, o.ownerId)}</td>
                      <td className={`${tdCls} pr-4 text-right tabular-nums`}>{formatBDTShort(o.estimatedValue)}</td>
                    </tr>
                )}
                </tbody>
              </table>
            </div> :

          <EmptyState compact title="No opportunities in your scope" description="You have no accessible opportunities with this organization." />
          }
        </Panel>
        <Panel
          title="Contacts"
          action={
          <Button size="sm" variant="ghost" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={() => setContactOpen(true)} disabled={!opps.length && scope.user.role !== 'management'}>
              Add
            </Button>
          }>
          
          {contacts.length ?
          <ul className="divide-y divide-slate-100">
              {contacts.map((c) =>
            <li key={c.id} className="py-2">
                  <Link to={`/contacts/${c.id}`} className="text-[13px] font-semibold text-brand-dark hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-[11.5px] text-slate-500">{c.designation}</p>
                </li>
            )}
            </ul> :

          <p className="py-2 text-sm text-slate-500">No contacts within your access.</p>
          }
        </Panel>
      </div>

      <Panel title="Activity history">
        {activities.length ?
        <ActivityTimeline activities={activities} users={scope.users} contacts={scope.contacts} opportunities={scope.opportunities} /> :

        <EmptyState compact title="No activity within your access" />
        }
      </Panel>

      <OrganizationForm open={editOpen} onClose={() => setEditOpen(false)} organization={org} />
      <ContactForm open={contactOpen} onClose={() => setContactOpen(false)} defaultOrgId={org.id} onSaved={(cid) => navigate(`/contacts/${cid}`)} />
    </PageContainer>);

}