/**
 * An opportunity's Contacts tab — the approved contacts table, with each
 * contact's relationship notes for THIS opportunity (BR-020), and the actions
 * to link, add, annotate and unlink.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { UserIcon, UserPlusIcon } from 'lucide-react';

import type { OpportunityContactDto } from '../../../shared/api.js';
import { removeContactLink, type fetchOpportunityContacts } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { tdCls, thCls } from '../../components/ui/Layout';
import type { useApiResource } from '../useApiResource.js';
import { ContactDialog, LinkContactDialog, ReasonDialog, RelationshipNotesDialog } from './DirectoryDialogs.js';
import { ErrorPanel, LoadingPanel } from './Feedback.js';

export function ContactsTab({
  resource,
  opportunityId,
  opportunityName,
  onChanged,
}: {
  resource: ReturnType<typeof useApiResource<Awaited<ReturnType<typeof fetchOpportunityContacts>>>>;
  opportunityId: string;
  opportunityName: string;
  onChanged: () => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notesFor, setNotesFor] = useState<OpportunityContactDto | null>(null);
  const [removeFor, setRemoveFor] = useState<OpportunityContactDto | null>(null);

  if (resource.loading && !resource.data) return <LoadingPanel label="Loading contacts…" />;
  if (resource.error) return <ErrorPanel error={resource.error} onRetry={resource.reload} />;
  const items = resource.data?.items ?? [];

  const done = () => {
    setLinkOpen(false);
    setCreateOpen(false);
    setNotesFor(null);
    onChanged();
  };

  return (
    <>
      {items.length === 0 ? (
        <EmptyState
          icon={<UserIcon className="h-8 w-8" />}
          title="No associated contacts"
          description="Link a government contact you already work with, or add a new one."
          action={
            <Button icon={<UserPlusIcon className="h-4 w-4" />} onClick={() => setLinkOpen(true)}>
              Link a contact
            </Button>
          }
          compact
        />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-y border-slate-200 bg-slate-50">
              <tr>
                <th className={`${thCls} pl-4`}>Name</th>
                <th className={thCls}>Designation</th>
                <th className={thCls}>Email</th>
                <th className={thCls}>Phone</th>
                <th className={thCls}>Relationship notes</th>
                <th className={`${thCls} pr-4`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.linkId}>
                  <td className={`${tdCls} pl-4`}>
                    <Link to={`/contacts/${item.contact.id}`} className="font-semibold text-brand-dark hover:underline">
                      {item.contact.fullName}
                    </Link>
                    <span className="block text-[11px] text-slate-400">{item.contact.organizationName}</span>
                  </td>
                  <td className={tdCls}>
                    {item.contact.designation}
                    {item.contact.department && <span className="block text-[11px] text-slate-400">{item.contact.department}</span>}
                  </td>
                  <td className={`${tdCls} text-slate-600`}>{item.contact.email ?? '—'}</td>
                  <td className={`${tdCls} text-slate-600`}>{item.contact.phone ?? '—'}</td>
                  <td className={`${tdCls} max-w-[260px] whitespace-pre-line text-slate-600`}>{item.relationshipNotes ?? '—'}</td>
                  <td className={`${tdCls} pr-4 text-right`}>
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => setNotesFor(item)}
                        className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        Notes
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoveFor(item)}
                        className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        Unlink
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pt-3">
            <Button size="sm" icon={<UserPlusIcon className="h-3.5 w-3.5" />} onClick={() => setLinkOpen(true)}>
              Link a contact
            </Button>
          </div>
        </div>
      )}

      <LinkContactDialog
        open={linkOpen}
        opportunityId={opportunityId}
        onClose={() => setLinkOpen(false)}
        onDone={done}
        onCreateNew={() => {
          setLinkOpen(false);
          setCreateOpen(true);
        }}
      />
      <ContactDialog open={createOpen} opportunityId={opportunityId} onClose={() => setCreateOpen(false)} onSaved={done} />
      <RelationshipNotesDialog
        link={notesFor}
        title={notesFor ? `${notesFor.contact.fullName} on ${opportunityName}` : ''}
        onClose={() => setNotesFor(null)}
        onDone={done}
      />
      <ReasonDialog
        open={Boolean(removeFor)}
        title="Unlink this contact?"
        message={`${removeFor?.contact.fullName ?? 'The contact'} will no longer be linked to ${opportunityName}. The link and its notes stay in the history. A contact's last link cannot be removed; management can archive the contact instead.`}
        confirmLabel="Unlink"
        reasonRequired={false}
        onClose={() => setRemoveFor(null)}
        onConfirm={async (reason) => {
          if (!removeFor) return;
          await removeContactLink(removeFor.linkId, { version: removeFor.version, reason: reason || null });
          toast.success('Contact unlinked');
          onChanged();
        }}
      />
    </>
  );
}
