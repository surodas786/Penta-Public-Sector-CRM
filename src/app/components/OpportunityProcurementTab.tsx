/**
 * An opportunity's Software Procurement tab (CR6): the current EOI → RFP
 * cycle with its milestones, documents, contacts and stage history, then
 * earlier cycles kept as history. Same layout as the Tender tab.
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { FileTextIcon, LinkIcon, PlusIcon, XIcon } from 'lucide-react';

import type { DocumentDto, OpportunityContactDto, ProcurementCycleDto } from '../../../shared/api.js';
import {
  PARTICIPATION_DECISION_LABELS,
  PROCUREMENT_DOCUMENT_ROLES,
  PROCUREMENT_DOCUMENT_ROLE_LABELS,
  PROCUREMENT_MILESTONE_LABELS,
  PROPOSAL_FORMAT_LABELS,
  type ProcurementDocumentRole,
} from '../../../shared/enums.js';
import { ApiRequestError } from '../../api/client.js';
import {
  fetchProcurementCycle,
  linkProcurementContact,
  linkProcurementDocument,
  unlinkProcurementContact,
  unlinkProcurementDocument,
  type fetchOpportunityProcurement,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { inputCls } from '../../components/ui/FormFields';
import { DetailItem, Panel, tdCls, thCls } from '../../components/ui/Layout';
import { formatCalendarDate, formatInstant } from '../ui/dates.js';
import { MilestoneBadge, ProcurementIndicatorBadge, ProcurementLegend, RouteBadge } from '../ui/ProcurementBadges.js';
import { useApiResource } from '../useApiResource.js';
import { ErrorPanel, LoadingPanel } from './Feedback.js';
import { MilestoneDialog, ProcurementCycleFormDialog } from './ProcurementDialogs.js';
import type { TenderParent } from './TenderDialogs.js';

export function ProcurementTab({
  resource,
  parent,
  closed,
  contacts,
  documents,
  onChanged,
}: {
  resource: ReturnType<typeof useApiResource<Awaited<ReturnType<typeof fetchOpportunityProcurement>>>>;
  parent: TenderParent;
  /** Awarded, Lost or Cancelled: no new cycle; the current one can only be brought to its ending. */
  closed: boolean;
  contacts: OpportunityContactDto[];
  documents: DocumentDto[];
  onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProcurementCycleDto | null>(null);
  const [advancing, setAdvancing] = useState<ProcurementCycleDto | null>(null);

  if (resource.loading && !resource.data) return <LoadingPanel label="Loading procurement…" />;
  if (resource.error) return <ErrorPanel error={resource.error} onRetry={resource.reload} />;
  const items = resource.data?.items ?? [];
  const current = items.find((item) => item.isCurrent) ?? null;
  const earlier = items.filter((item) => !item.isCurrent);
  const currentOpen = current !== null && current.nextMilestones.length > 0 && !['awarded', 'unsuccessful', 'not_shortlisted', 'cancelled'].includes(current.milestone);

  const done = () => {
    setFormOpen(false);
    setEditing(null);
    setAdvancing(null);
    onChanged();
  };

  const addButton = !closed && !currentOpen && (
    <Button size="sm" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={() => setFormOpen(true)}>
      {current ? 'Add a new cycle' : 'Add procurement'}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      {current ? (
        <CurrentCycle
          cycle={current}
          contacts={contacts}
          documents={documents}
          onEdit={() => setEditing(current)}
          onAdvance={() => setAdvancing(current)}
          onChanged={onChanged}
          action={addButton}
        />
      ) : (
        <EmptyState
          icon={<FileTextIcon className="h-8 w-8" />}
          title="No Software Procurement cycle"
          description="Record an EOI → RFP procurement to track its EOI, shortlisting, RFP and proposal. Goods tenders stay on the Tender tab."
          action={
            !closed ? (
              <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                Add procurement
              </Button>
            ) : undefined
          }
          compact
        />
      )}

      {earlier.length > 0 && (
        <Panel title="Earlier cycles" subtitle="Ended or replaced cycles are kept with their history and raise no deadline alerts.">
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-y border-slate-200 bg-slate-50">
                <tr>
                  <th className={`${thCls} pl-4`}>Procurement</th>
                  <th className={thCls}>Route</th>
                  <th className={thCls}>Ended at</th>
                  <th className={`${thCls} pr-4`}>Outcome date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {earlier.map((cycle) => (
                  <tr key={cycle.id}>
                    <td className={`${tdCls} pl-4`}>
                      <span className="block font-semibold text-slate-900">{cycle.reference}</span>
                      <span className="block text-[11.5px] text-slate-500">{cycle.title}</span>
                    </td>
                    <td className={tdCls}>
                      <RouteBadge route={cycle.route} />
                    </td>
                    <td className={tdCls}>
                      <MilestoneBadge milestone={cycle.milestone} />
                    </td>
                    <td className={`${tdCls} pr-4 tabular-nums`}>{formatCalendarDate(cycle.outcomeDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <ProcurementCycleFormDialog
        open={formOpen || editing !== null}
        parent={parent}
        cycle={editing}
        currentReference={editing ? null : (current?.reference ?? null)}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onDone={done}
      />
      <MilestoneDialog cycle={advancing} onClose={() => setAdvancing(null)} onDone={done} />
    </div>
  );
}

function CurrentCycle({
  cycle,
  contacts,
  documents,
  onEdit,
  onAdvance,
  onChanged,
  action,
}: {
  cycle: ProcurementCycleDto;
  contacts: OpportunityContactDto[];
  documents: DocumentDto[];
  onEdit: () => void;
  onAdvance: () => void;
  onChanged: () => void;
  action: React.ReactNode;
}) {
  const detail = useApiResource(
    useCallback((signal: AbortSignal) => fetchProcurementCycle(cycle.id, signal), [cycle.id]),
    [cycle.id, cycle.version],
  );
  const [contactId, setContactId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [role, setRole] = useState<ProcurementDocumentRole>('eoi');
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      toast.success(success);
      detail.reload();
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const linkedContacts = detail.data?.contacts ?? [];
  const linkedDocuments = detail.data?.documents ?? [];
  const contactOptions = contacts.filter((item) => !linkedContacts.some((linked) => linked.id === item.contact.id));
  const documentOptions = documents.filter((item) => !item.archivedAt && !linkedDocuments.some((linked) => linked.id === item.id));
  // Contacts while the cycle is open; documents also after its ending (the decision arrives then).
  const canLink = cycle.isCurrent && cycle.nextMilestones.length > 0;
  const canLinkDocuments = cycle.isCurrent;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-slate-900">{cycle.title}</p>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Ref {cycle.reference}
            {cycle.rfpReference ? ` · RFP ${cycle.rfpReference}` : ''} · {cycle.procuringOrganization.name}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <MilestoneBadge milestone={cycle.milestone} />
            <ProcurementIndicatorBadge indicator={cycle.indicator} />
            <RouteBadge route={cycle.route} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {cycle.nextMilestones.length > 0 && (
            <Button variant="primary" size="sm" onClick={onAdvance}>
              Record milestone
            </Button>
          )}
          {cycle.canEdit && (
            <Button size="sm" onClick={onEdit}>
              Edit procurement
            </Button>
          )}
          {action}
        </div>
      </div>
      {cycle.route === 'direct_rfp' && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          Direct RFP without an EOI, approved by {cycle.directRfpApprovedByName ?? 'management'}: {cycle.directRfpReason}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        {cycle.route === 'eoi_rfp' && (
          <>
            <DetailItem label="EOI published">{formatCalendarDate(cycle.eoiPublicationDate)}</DetailItem>
            <DetailItem label="EOI deadline">{formatInstant(cycle.eoiDeadline)}</DetailItem>
            <DetailItem label="EOI submitted">{formatInstant(cycle.eoiSubmittedAt)}</DetailItem>
            <DetailItem label="Shortlisting">
              {cycle.eoiOutcome ? `${PROCUREMENT_MILESTONE_LABELS[cycle.eoiOutcome]}, ${formatCalendarDate(cycle.eoiOutcomeDate)}` : '—'}
            </DetailItem>
          </>
        )}
        <DetailItem label="RFP invitation">{formatCalendarDate(cycle.rfpInvitationDate)}</DetailItem>
        <DetailItem label="Clarification deadline">{formatInstant(cycle.clarificationDeadline)}</DetailItem>
        <DetailItem label="Proposal deadline">{formatInstant(cycle.proposalDeadline)}</DetailItem>
        <DetailItem label={PROPOSAL_FORMAT_LABELS[cycle.proposalFormat]}>
          {cycle.proposalFormat === 'single'
            ? formatInstant(cycle.proposalSubmittedAt)
            : `Technical ${formatInstant(cycle.technicalSubmittedAt)} · Financial ${formatInstant(cycle.financialSubmittedAt)}`}
        </DetailItem>
        <DetailItem label="Submission method">{cycle.submissionMethod ?? '—'}</DetailItem>
        <DetailItem label="Participation">
          {PARTICIPATION_DECISION_LABELS[cycle.participation]}
          {cycle.participationReason ? `: ${cycle.participationReason}` : ''}
        </DetailItem>
        <DetailItem label="Responsible owner">{cycle.responsibleOwner.fullName}</DetailItem>
        {cycle.outcomeDate && <DetailItem label="Outcome date">{formatCalendarDate(cycle.outcomeDate)}</DetailItem>}
      </dl>
      {cycle.eoiLateNote && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Late EOI: {cycle.eoiLateNote}</p>}
      {cycle.proposalLateNote && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Late proposal: {cycle.proposalLateNote}</p>}
      {cycle.outcomeNote && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">Outcome: {cycle.outcomeNote}</p>}
      {cycle.notes && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{cycle.notes}</p>}
      <ProcurementLegend />

      {detail.error ? (
        <ErrorPanel error={detail.error} onRetry={detail.reload} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Documents" subtitle="EOI, shortlist, RFP, proposal and decision documents, from this opportunity’s Documents tab.">
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {linkedDocuments.length === 0 && <li className="text-slate-500">No documents linked.</li>}
              {linkedDocuments.map((document) => (
                <li key={document.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold text-slate-800">{PROCUREMENT_DOCUMENT_ROLE_LABELS[document.role]}</span> · {document.fileName}
                    {document.archived && <span className="ml-1 text-[11px] text-slate-400">(archived)</span>}
                  </span>
                  {canLinkDocuments && (
                    <button
                      type="button"
                      aria-label={`Unlink ${document.fileName}`}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => void run(() => unlinkProcurementDocument(cycle.id, document.id), 'Document unlinked')}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canLinkDocuments && documentOptions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <select aria-label="Document to link" className={inputCls(undefined, 'flex-1')} value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
                  <option value="">Choose a document…</option>
                  {documentOptions.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.latest.fileName}
                    </option>
                  ))}
                </select>
                <select aria-label="Document role" className={inputCls(undefined, 'w-32')} value={role} onChange={(event) => setRole(event.target.value as ProcurementDocumentRole)}>
                  {PROCUREMENT_DOCUMENT_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {PROCUREMENT_DOCUMENT_ROLE_LABELS[option]}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  icon={<LinkIcon className="h-3.5 w-3.5" />}
                  disabled={!documentId || busy}
                  onClick={() => void run(async () => {
                    await linkProcurementDocument(cycle.id, documentId, role);
                    setDocumentId('');
                  }, 'Document linked')}
                >
                  Link
                </Button>
              </div>
            )}
          </Panel>

          <Panel title="Contacts" subtitle="People relevant to this procurement, from this opportunity’s Contacts tab.">
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {linkedContacts.length === 0 && <li className="text-slate-500">No contacts linked.</li>}
              {linkedContacts.map((contact) => (
                <li key={contact.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold text-slate-800">{contact.fullName}</span>
                    {contact.designation ? ` · ${contact.designation}` : ''}
                  </span>
                  {canLink && (
                    <button
                      type="button"
                      aria-label={`Unlink ${contact.fullName}`}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => void run(() => unlinkProcurementContact(cycle.id, contact.id), 'Contact unlinked')}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canLink && contactOptions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <select aria-label="Contact to link" className={inputCls(undefined, 'flex-1')} value={contactId} onChange={(event) => setContactId(event.target.value)}>
                  <option value="">Choose a contact…</option>
                  {contactOptions.map((item) => (
                    <option key={item.contact.id} value={item.contact.id}>
                      {item.contact.fullName}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  icon={<LinkIcon className="h-3.5 w-3.5" />}
                  disabled={!contactId || busy}
                  onClick={() => void run(async () => {
                    await linkProcurementContact(cycle.id, contactId);
                    setContactId('');
                  }, 'Contact linked')}
                >
                  Link
                </Button>
              </div>
            )}
          </Panel>

          <Panel title="Stage history" subtitle="Every milestone and change of this cycle, oldest first." className="lg:col-span-2">
            {detail.data ? (
              <ol className="flex flex-col gap-1.5 text-[13px]">
                {detail.data.history.map((entry, index) => (
                  <li key={`${entry.occurredAt}-${index}`} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums text-slate-500">{formatInstant(entry.occurredAt)}</span>
                    <span className="font-semibold text-slate-800">{entry.summary}</span>
                    {entry.actorName && <span className="text-slate-500">by {entry.actorName}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <LoadingPanel label="Loading history…" />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
