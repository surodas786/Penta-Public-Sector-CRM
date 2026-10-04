import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, MailIcon, PencilIcon, PhoneIcon } from 'lucide-react';
import { useCrm } from '../contexts/CrmContext';
import { useScope } from '../hooks/useScope';
import { orgName, userName } from '../utils/lookup';
import { Button } from '../components/ui/Button';
import { StageBadge } from '../components/ui/Badges';
import { AccessDenied, EmptyState } from '../components/ui/Feedback';
import { DetailItem, PageContainer, Panel } from '../components/ui/Layout';
import { ContactForm } from '../components/organizations/ContactForm';
import { ActivityTimeline } from '../components/activities/ActivityTimeline';

export function ContactDetail() {
  const { id } = useParams();
  const { db } = useCrm();
  const scope = useScope();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  const contact = scope.contacts.find((c) => c.id === id);
  if (!contact) {
    const exists = db.contacts.some((c) => c.id === id);
    return (
      <AccessDenied
        title={exists ? 'Access denied' : 'Contact not found'}
        message={exists ? 'This contact is not linked to any opportunity within your access scope.' : undefined} />);


  }

  // Show only linked opportunities and activities permitted for the current user.
  const linked = scope.opportunities.filter((o) => o.contactIds.includes(contact.id));
  const activities = scope.activities.filter((a) => a.contactId === contact.id).sort((a, b) => b.at.localeCompare(a.at));

  return (
    <PageContainer>
      <button type="button" onClick={() => navigate(-1)} className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900">
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>
      <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{contact.name}</h1>
          <p className="mt-0.5 text-[13px] text-slate-600">
            {contact.designation} ·{' '}
            <Link to={`/organizations/${contact.orgId}`} className="font-medium text-brand-dark hover:underline">
              {orgName(scope.organizations, contact.orgId)}
            </Link>
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
            <DetailItem label="Department / office">{contact.department}</DetailItem>
            <DetailItem label="Email">
              {contact.email ?
              <span className="inline-flex items-center gap-1.5">
                  <MailIcon className="h-3.5 w-3.5 text-slate-400" />
                  {contact.email}
                </span> :
              null}
            </DetailItem>
            <DetailItem label="Phone">
              {contact.phone ?
              <span className="inline-flex items-center gap-1.5">
                  <PhoneIcon className="h-3.5 w-3.5 text-slate-400" />
                  {contact.phone}
                </span> :
              null}
            </DetailItem>
          </dl>
          {contact.notes &&
          <div className="mt-4 max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Relationship notes</p>
              <p className="mt-0.5 text-sm text-slate-700">{contact.notes}</p>
            </div>
          }
        </div>
        <Button icon={<PencilIcon className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Linked opportunities" subtitle="Only those within your access">
          {linked.length ?
          <ul className="divide-y divide-slate-100">
              {linked.map((o) =>
            <li key={o.id} className="py-2">
                  <Link to={`/opportunities/${o.id}`} className="text-[13px] font-semibold text-brand-dark hover:underline">
                    {o.name}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-[11.5px] text-slate-500">
                    <StageBadge stage={o.stage} />
                    {userName(scope.users, o.ownerId)}
                  </div>
                </li>
            )}
            </ul> :

          <p className="text-sm text-slate-500">No linked opportunities within your access.</p>
          }
        </Panel>
        <Panel title="Interactions" className="lg:col-span-2">
          {activities.length ?
          <ActivityTimeline activities={activities} users={scope.users} contacts={scope.contacts} opportunities={scope.opportunities} /> :

          <EmptyState compact title="No logged interactions" description="Activities that involve this contact will appear here." />
          }
        </Panel>
      </div>

      <ContactForm open={editOpen} onClose={() => setEditOpen(false)} contact={contact} />
    </PageContainer>);

}