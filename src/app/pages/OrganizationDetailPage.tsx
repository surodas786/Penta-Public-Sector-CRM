/**
 * Organization detail — the approved layout (FR-030, FR-031). Basic details
 * are shared; opportunities, contacts and activity are each loaded through the
 * viewer's own scope, so the page shows only what the viewer may see.
 */
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArchiveIcon, ArrowLeftIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';

import { ORGANIZATION_TYPE_LABELS } from '../../../shared/enums.js';
import { formatBdtShort } from '../../../shared/money.js';
import {
  archiveOrganization,
  fetchActivities,
  fetchContacts,
  fetchOpportunities,
  fetchOrganization,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { DetailItem, PageContainer, Panel, tdCls, thCls } from '../../components/ui/Layout';
import { ActivityTimeline } from '../components/ActivityTimeline.js';
import { ContactDialog, OrganizationDialog, ReasonDialog } from '../components/DirectoryDialogs.js';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import { StageBadge } from '../ui/ApiBadges.js';
import { useApiResource } from '../useApiResource.js';

export function OrganizationDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const org = useApiResource(useCallback((signal: AbortSignal) => fetchOrganization(id, signal), [id]), [id]);
  const opps = useApiResource(
    useCallback((signal: AbortSignal) => fetchOpportunities({ organizationId: id, pageSize: 50 }, signal), [id]),
    [id],
  );
  const contacts = useApiResource(
    useCallback((signal: AbortSignal) => fetchContacts({ organizationId: id, pageSize: 50 }, signal), [id]),
    [id],
  );
  const activity = useApiResource(
    useCallback((signal: AbortSignal) => fetchActivities({ organizationId: id, pageSize: 10 }, signal), [id]),
    [id],
  );

  if (org.error) {
    return (
      <PageContainer>
        <ErrorPanel error={org.error} onRetry={org.reload} />
      </PageContainer>
    );
  }
  if (!org.data) {
    return (
      <PageContainer>
        <LoadingPanel label="Loading organization…" />
      </PageContainer>
    );
  }
  const detail = org.data;

  return (
    <PageContainer>
      <button
        type="button"
        onClick={() => navigate('/organizations')}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Organizations
      </button>
      <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold text-brand-dark">
            {ORGANIZATION_TYPE_LABELS[detail.type]}
            {detail.archived && <span className="ml-2 text-slate-400">Archived</span>}
          </p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{detail.name}</h1>
          <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4">
            <DetailItem label="Location">{detail.location}</DetailItem>
            <DetailItem label="Parent">
              {detail.parentId ? (
                <Link to={`/organizations/${detail.parentId}`} className="text-brand-dark hover:underline">
                  {detail.parentName}
                </Link>
              ) : (
                '—'
              )}
            </DetailItem>
            <DetailItem label="Website">
              {detail.website ? (
                <a href={detail.website} target="_blank" rel="noopener noreferrer" className="text-brand-dark hover:underline">
                  {detail.website.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                '—'
              )}
            </DetailItem>
            {detail.children.length > 0 && (
              <DetailItem label="Sub-organizations">
                {detail.children.map((child) => (
                  <Link key={child.id} to={`/organizations/${child.id}`} className="block text-brand-dark hover:underline">
                    {child.name}
                  </Link>
                ))}
              </DetailItem>
            )}
          </dl>
          {detail.basicNotes && <p className="mt-3 max-w-2xl text-sm text-slate-600">{detail.basicNotes}</p>}
        </div>
        <div className="flex gap-2">
          {!detail.archived && (
            <Button icon={<PencilIcon className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {detail.canArchive && (
            <Button icon={<ArchiveIcon className="h-4 w-4" />} onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          )}
        </div>
      </header>

      <p className="text-xs text-slate-500">Showing only contacts, opportunities and activity within your access scope.</p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Your opportunities" subtitle={`${detail.accessibleOpportunities} within your access`} className="lg:col-span-2" bodyClassName="p-0">
          {opps.data && opps.data.items.length > 0 ? (
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
                  {opps.data.items.map((item) => (
                    <tr key={item.id} onClick={() => navigate(`/opportunities/${item.id}`)} className="cursor-pointer hover:bg-slate-50">
                      <td className={`${tdCls} pl-4 font-semibold`}>{item.name}</td>
                      <td className={tdCls}>
                        <StageBadge stage={item.stage} status={item.status} />
                      </td>
                      <td className={tdCls}>{item.ownerName}</td>
                      <td className={`${tdCls} pr-4 text-right tabular-nums`}>{formatBdtShort(item.estimatedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState compact title="No opportunities in your scope" description="You have no accessible opportunities with this organization." />
          )}
        </Panel>
        <Panel
          title="Contacts"
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => setContactOpen(true)}
              disabled={detail.archived || !opps.data?.total}
            >
              Add
            </Button>
          }
        >
          {contacts.data && contacts.data.items.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {contacts.data.items.map((contact) => (
                <li key={contact.id} className="py-2">
                  <Link to={`/contacts/${contact.id}`} className="text-[13px] font-semibold text-brand-dark hover:underline">
                    {contact.fullName}
                  </Link>
                  <p className="text-[11.5px] text-slate-500">{contact.designation}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-slate-500">No contacts within your access.</p>
          )}
        </Panel>
      </div>

      <Panel title="Activity history">
        {activity.data && activity.data.items.length > 0 ? (
          <ActivityTimeline activities={activity.data.items} showOpportunity />
        ) : (
          <EmptyState compact title="No activity within your access" />
        )}
      </Panel>

      <OrganizationDialog
        open={editOpen}
        organization={detail}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          org.reload();
        }}
      />
      <ContactDialog
        open={contactOpen}
        defaultOrganizationId={detail.id}
        onClose={() => setContactOpen(false)}
        onSaved={(saved) => navigate(`/contacts/${saved.id}`)}
      />
      <ReasonDialog
        open={archiveOpen}
        title={`Archive ${detail.name}?`}
        message="An archived organization leaves the directory and cannot take new opportunities or contacts. Its history is kept. An organization used by an open opportunity cannot be archived."
        confirmLabel="Archive"
        reasonRequired
        onClose={() => setArchiveOpen(false)}
        onConfirm={async (reason) => {
          await archiveOrganization(detail.id, { version: detail.version, reason });
          toast.success('Organization archived');
          org.reload();
        }}
      />
    </PageContainer>
  );
}
