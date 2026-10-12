/**
 * An opportunity's Tender tab — the approved layout for the current notice,
 * followed by every earlier cycle, kept with its bid history (FR-050).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangleIcon, ExternalLinkIcon, FileTextIcon, PlusIcon } from 'lucide-react';

import type { TenderDto } from '../../../shared/api.js';
import { STAGE_LABELS } from '../../../shared/enums.js';
import { ApiRequestError } from '../../api/client.js';
import { designateCurrentTender, type fetchOpportunityTenders } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { DetailItem, Panel, tdCls, thCls } from '../../components/ui/Layout';
import { formatCalendarDate, formatInstant } from '../ui/dates.js';
import { BidStatusBadge, NoticeStateBadge, TenderIndicatorBadge, TenderLegend } from '../ui/TenderBadges.js';
import type { useApiResource } from '../useApiResource.js';
import { ErrorPanel, LoadingPanel } from './Feedback.js';
import { CancelNoticeDialog, MarkSubmittedDialog, TenderFormDialog, type TenderParent } from './TenderDialogs.js';

export function TenderTab({
  resource,
  parent,
  closed,
  onChanged,
}: {
  resource: ReturnType<typeof useApiResource<Awaited<ReturnType<typeof fetchOpportunityTenders>>>>;
  parent: TenderParent;
  /** Awarded, Lost or Cancelled: tender records are kept as history. */
  closed: boolean;
  onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenderDto | null>(null);
  const [submitting, setSubmitting] = useState<TenderDto | null>(null);
  const [cancelling, setCancelling] = useState<TenderDto | null>(null);

  if (resource.loading && !resource.data) return <LoadingPanel label="Loading tenders…" />;
  if (resource.error) return <ErrorPanel error={resource.error} onRetry={resource.reload} />;
  const items = resource.data?.items ?? [];
  const current = items.find((item) => item.isCurrent) ?? null;
  const earlier = items.filter((item) => !item.isCurrent);

  const done = () => {
    setFormOpen(false);
    setEditing(null);
    setSubmitting(null);
    setCancelling(null);
    onChanged();
  };

  const makeCurrent = async (tender: TenderDto) => {
    try {
      await designateCurrentTender(tender.id, tender.version);
      toast.success('Current tender changed', { description: `${tender.reference} is now the current notice.` });
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'The tender could not be changed.');
    }
  };

  const addButton = !closed && (
    <Button size="sm" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={() => setFormOpen(true)}>
      {current ? 'Add re-tender / new notice' : 'Add tender'}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      {current ? (
        <CurrentTender
          tender={current}
          closed={closed}
          onEdit={() => setEditing(current)}
          onSubmit={() => setSubmitting(current)}
          onCancel={() => setCancelling(current)}
          action={addButton}
        />
      ) : (
        <EmptyState
          icon={<FileTextIcon className="h-8 w-8" />}
          title={earlier.length > 0 ? 'No current tender' : 'No tender record yet'}
          description={
            earlier.length > 0
              ? 'Earlier notices are kept below. Add the new notice when it is published.'
              : 'Add the tender once it is published to track deadlines and bid status.'
          }
          action={
            !closed ? (
              <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                Add tender
              </Button>
            ) : undefined
          }
          compact
        />
      )}

      {earlier.length > 0 && (
        <Panel title="Earlier notices" subtitle="Superseded and cancelled notices are kept with their bid history and raise no deadline alerts.">
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-y border-slate-200 bg-slate-50">
                <tr>
                  <th className={`${thCls} pl-4`}>Tender</th>
                  <th className={thCls}>Notice</th>
                  <th className={thCls}>Submission deadline</th>
                  <th className={thCls}>Bid status</th>
                  <th className={`${thCls} pr-4 text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {earlier.map((tender) => (
                  <tr key={tender.id}>
                    <td className={`${tdCls} pl-4`}>
                      <span className="block font-semibold text-slate-900">{tender.reference}</span>
                      <span className="block text-[11.5px] text-slate-500">{tender.title}</span>
                    </td>
                    <td className={tdCls}>
                      <NoticeStateBadge state={tender.noticeState} />
                    </td>
                    <td className={`${tdCls} whitespace-nowrap tabular-nums`}>{formatInstant(tender.submissionDeadline)}</td>
                    <td className={tdCls}>
                      <BidStatusBadge status={tender.bidStatus} />
                    </td>
                    <td className={`${tdCls} pr-4 text-right`}>
                      {!closed && tender.noticeState === 'superseded' && (
                        <Button size="sm" onClick={() => void makeCurrent(tender)}>
                          Make current
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <TenderFormDialog
        open={formOpen || editing !== null}
        parent={parent}
        tender={editing}
        currentReference={editing ? null : (current?.reference ?? null)}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onDone={done}
      />
      <MarkSubmittedDialog tender={submitting} onClose={() => setSubmitting(null)} onDone={done} />
      <CancelNoticeDialog tender={cancelling} onClose={() => setCancelling(null)} onDone={done} />
    </div>
  );
}

function CurrentTender({
  tender,
  closed,
  onEdit,
  onSubmit,
  onCancel,
  action,
}: {
  tender: TenderDto;
  closed: boolean;
  onEdit: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  action: React.ReactNode;
}) {
  const open = tender.bidStatus === 'reviewing' || tender.bidStatus === 'preparing';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-slate-900">{tender.title}</p>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Ref {tender.reference} · {tender.procuringOrganization.name}
            {tender.procuringDiffersFromOpportunity && (
              <span className="ml-1.5 rounded bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800">
                Different from the opportunity’s organization
              </span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <BidStatusBadge status={tender.bidStatus} />
            <TenderIndicatorBadge indicator={tender.indicator} />
            <NoticeStateBadge state={tender.noticeState} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!closed && open && (
            <Button variant="primary" size="sm" onClick={onSubmit}>
              Mark Submitted
            </Button>
          )}
          {tender.canEdit && (
            <Button size="sm" onClick={onEdit}>
              Edit tender
            </Button>
          )}
          {!closed && (
            <Button size="sm" onClick={onCancel}>
              Cancel notice
            </Button>
          )}
          {action}
        </div>
      </div>
      {tender.stageMismatch && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          The bid is recorded as Submitted, but the opportunity is still at {STAGE_LABELS[tender.opportunity.stage]}. Change the stage
          when you are ready.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <DetailItem label="Submission deadline">{formatInstant(tender.submissionDeadline)}</DetailItem>
        <DetailItem label="Publication">{formatCalendarDate(tender.publicationDate)}</DetailItem>
        <DetailItem label="Clarification deadline">{formatInstant(tender.clarificationDeadline)}</DetailItem>
        <DetailItem label="Bid submitted">{formatInstant(tender.submittedAt)}</DetailItem>
        <DetailItem label="Procurement method">{tender.procurementMethod ?? '—'}</DetailItem>
        <DetailItem label="Responsible owner">{tender.responsibleOwner.fullName}</DetailItem>
        <DetailItem label="Notice">
          {tender.noticeUrl ? (
            <a
              href={tender.noticeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-dark hover:underline"
            >
              Open notice <ExternalLinkIcon className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="text-slate-400">No URL entered</span>
          )}
        </DetailItem>
        {tender.bidStatus === 'not_participating' && (
          <DetailItem label="Reason for not participating">{tender.participationReason}</DetailItem>
        )}
      </dl>
      {tender.lateSubmissionNote && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Late submission: {tender.lateSubmissionNote}</p>
      )}
      {tender.notes && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{tender.notes}</p>}
      <TenderLegend />
    </div>
  );
}
