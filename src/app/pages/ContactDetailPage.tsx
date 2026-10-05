/**
 * Contact detail — the approved layout, with relationship notes moved from
 * the contact onto each opportunity link (BR-020). The viewer sees only the
 * links, notes and interactions on opportunities they can access (SEC-004).
 * Shared identity details are editable only by someone who sees every link
 * (BR-021); otherwise the page says who can correct them.
 */
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArchiveIcon, ArrowLeftIcon, LockIcon, MailIcon, PencilIcon, PhoneIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { ContactLinkDto } from '../../../shared/api.js';
import { archiveContact, fetchActivities, fetchContact, removeContactLink } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { DetailItem, PageContainer, Panel } from '../../components/ui/Layout';
import { ActivityTimeline } from '../components/ActivityTimeline.js';
import { ContactDialog, ReasonDialog, RelationshipNotesDialog } from '../components/DirectoryDialogs.js';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import { StageBadge } from '../ui/ApiBadges.js';
import { useApiResource } from '../useApiResource.js';

export function ContactDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [notesFor, setNotesFor] = useState<ContactLinkDto | null>(null);
  const [removeFor, setRemoveFor] = useState<ContactLinkDto | null>(null);

  const contact = useApiResource(useCallback((signal: AbortSignal) => fetchContact(id, signal), [id]), [id]);
  const activity = useApiResource(
    useCallback((signal: AbortSignal) => fetchActivities({ contactId: id, pageSize: 25 }, signal), [id]),
    [id],
  );

  if (contact.error) {
    return (
      <PageContainer>
        <ErrorPanel error={contact.error} onRetry={contact.reload} />
      </PageContainer>
    );
  }
  if (!contact.data) {
    return (
      <PageContainer>
        <LoadingPanel label="Loading contact…" />
      </PageContainer>
    );
  }
  const detail = contact.data;

  return (
    <PageContainer>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>
      <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {detail.fullName}
            {detail.archived && <span className="ml-2 align-middle text-[12px] font-semibold text-slate-400">Archived</span>}
          </h1>
          <p className="mt-0.5 text-[13px] text-slate-600">
            {detail.designation} ·{' '}
            <Link to={`/organizations/${detail.organizationId}`} className="font-medium text-brand-dark hover:underline">
              {detail.organizationName}
            </Link>
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
            <DetailItem label="Department / office">{detail.department}</DetailItem>
            <DetailItem label="Email">
              {detail.email ? (
                <span className="inline-flex items-center gap-1.5">
                  <MailIcon className="h-3.5 w-3.5 text-slate-400" />
                  {detail.email}
                </span>
              ) : null}
            </DetailItem>
            <DetailItem label="Phone">
              {detail.phone ? (
                <span className="inline-flex items-center gap-1.5">
                  <PhoneIcon className="h-3.5 w-3.5 text-slate-400" />
                  {detail.phone}
                </span>
              ) : null}
            </DetailItem>
          </dl>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {detail.canEditIdentity ? (
            <Button icon={<PencilIcon className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          ) : (
            !detail.archived && (
              <span className="inline-flex max-w-xs items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500">
                <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Shared with opportunities outside your access. Ask management to correct these details; you can edit your
                relationship notes below.
              </span>
            )
          )}
          {detail.canArchive && (
            <Button icon={<ArchiveIcon className="h-4 w-4" />} onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Linked opportunities" subtitle="Only those within your access, each with its own relationship notes">
          {detail.links.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {detail.links.map((link) => (
                <li key={link.linkId} className="py-2.5">
                  <Link to={`/opportunities/${link.opportunity.id}?tab=contacts`} className="text-[13px] font-semibold text-brand-dark hover:underline">
                    {link.opportunity.name}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-[11.5px] text-slate-500">
                    <StageBadge stage={link.opportunity.stage} status={link.opportunity.status} />
                    {link.opportunity.ownerName}
                  </div>
                  <p className="mt-1.5 whitespace-pre-line text-[12.5px] text-slate-700">
                    {link.relationshipNotes ?? <span className="text-slate-400">No relationship notes.</span>}
                  </p>
                  {!detail.archived && (
                    <span className="mt-1 flex gap-1">
                      <button
                        type="button"
                        onClick={() => setNotesFor(link)}
                        className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        Edit notes
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoveFor(link)}
                        className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        Unlink
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No linked opportunities within your access.</p>
          )}
        </Panel>
        <Panel title="Interactions" className="lg:col-span-2">
          {activity.data && activity.data.items.length > 0 ? (
            <ActivityTimeline activities={activity.data.items} showOpportunity />
          ) : (
            <EmptyState compact title="No logged interactions" description="Activities that involve this contact will appear here." />
          )}
        </Panel>
      </div>

      <ContactDialog
        open={editOpen}
        contact={detail}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          contact.reload();
        }}
      />
      <RelationshipNotesDialog
        link={notesFor}
        title={notesFor ? `${detail.fullName} on ${notesFor.opportunity.name}` : ''}
        onClose={() => setNotesFor(null)}
        onDone={() => {
          setNotesFor(null);
          contact.reload();
        }}
      />
      <ReasonDialog
        open={Boolean(removeFor)}
        title="Unlink this contact?"
        message={`${detail.fullName} will no longer be linked to ${removeFor?.opportunity.name ?? 'this opportunity'}. The link and its notes stay in the history. A contact's last link cannot be removed; management can archive the contact instead.`}
        confirmLabel="Unlink"
        reasonRequired={false}
        onClose={() => setRemoveFor(null)}
        onConfirm={async (reason) => {
          if (!removeFor) return;
          await removeContactLink(removeFor.linkId, { version: removeFor.version, reason: reason || null });
          toast.success('Contact unlinked');
          contact.reload();
        }}
      />
      <ReasonDialog
        open={archiveOpen}
        title={`Archive ${detail.fullName}?`}
        message="An archived contact leaves contact lists and cannot be linked again. Existing links, notes and interactions are kept."
        confirmLabel="Archive"
        reasonRequired
        onClose={() => setArchiveOpen(false)}
        onConfirm={async (reason) => {
          await archiveContact(detail.id, { version: detail.version, reason });
          toast.success('Contact archived');
          contact.reload();
        }}
      />
    </PageContainer>
  );
}
