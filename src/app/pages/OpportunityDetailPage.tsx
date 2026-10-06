/**
 * Opportunity detail — the approved tabbed layout, loaded through scoped
 * endpoints (plan 7.5). Every tab is live: Overview, Contacts, Activities
 * (with follow-ups), Tender and Documents (M5), and Change History.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  MessageSquarePlusIcon,
  CheckIcon,
  LockIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  UserCogIcon,
  XIcon,
} from 'lucide-react';

import type { ActivityDto, FollowUpDto, HistoryEntryDto, OpportunityDetailDto } from '../../../shared/api.js';
import {
  BOARD_LANES,
  FOLLOW_UP_STATE_LABELS,
  LOSS_REASON_LABELS,
  SOLUTION_CATEGORY_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  boardLane,
  boardLaneTitle,
  isTerminalStage,
  type BoardLane,
} from '../../../shared/enums.js';
import { formatBdt, formatBdtShort, isValidMoneyString } from '../../../shared/money.js';
import { ApiRequestError, newIdempotencyKey } from '../../api/client.js';
import {
  fetchOpportunity,
  fetchOpportunityActivities,
  fetchOpportunityContacts,
  fetchOpportunityDocuments,
  fetchOpportunityFollowUps,
  fetchOpportunityHistory,
  fetchOpportunityTenders,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { inputCls } from '../../components/ui/FormFields';
import { DetailItem, PageContainer, Pagination, Panel, Tabs, tdCls, thCls } from '../../components/ui/Layout';
import { useAuth } from '../AuthContext.js';
import { useApiResource } from '../useApiResource.js';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import {
  AddFollowUpDialog,
  CancelFollowUpDialog,
  CompleteFollowUpDialog,
  RescheduleFollowUpDialog,
} from '../components/FollowUpDialogs.js';
import { OpportunityEditDialog } from '../components/OpportunityEditDialog.js';
import { TransferDialog } from '../components/TransferDialog.js';
import { ActivityDialog } from '../components/ActivityDialog.js';
import { ActivityTimeline } from '../components/ActivityTimeline.js';
import { ContactsTab } from '../components/OpportunityContactsTab.js';
import { DocumentsTab } from '../components/OpportunityDocumentsTab.js';
import { TenderTab } from '../components/OpportunityTenderTab.js';
import { TransitionDialog } from '../components/TransitionDialog.js';
import {
  needsTransitionDialog,
  sendDirectStageChange,
  transitionRequestFor,
  type TransitionRequest,
} from '../transitions.js';
import { DueTag, PriorityBadge, RetainedStageNote, StageBadge } from '../ui/ApiBadges.js';
import { dhakaToday, formatCalendarDate, formatInstant } from '../ui/dates.js';

type TabId = 'overview' | 'contacts' | 'activities' | 'tender' | 'documents' | 'history';

const ACTION_LABELS: Record<string, string> = {
  'opportunity.created': 'Opportunity created',
  'opportunity.updated': 'Opportunity updated',
  'opportunity.stage_changed': 'Stage changed',
  'opportunity.status_changed': 'Status changed',
  'opportunity.reopened': 'Opportunity reopened',
  'follow_up.created': 'Follow-up added',
  'follow_up.completed': 'Follow-up completed',
  'follow_up.rescheduled': 'Follow-up rescheduled',
  'follow_up.cancelled': 'Follow-up cancelled',
  'follow_up.reassigned': 'Follow-up reassigned',
  'opportunity.transferred': 'Ownership transferred',
  'contact.linked': 'Contact linked',
  'contact.unlinked': 'Contact unlinked',
  'contact.notes_updated': 'Relationship notes updated',
  'activity.logged': 'Activity logged',
  'activity.updated': 'Activity edited',
  'tender.created': 'Tender added',
  'tender.updated': 'Tender updated',
  'tender.submitted': 'Bid marked Submitted',
  'tender.superseded': 'Tender notice superseded',
  'tender.designated_current': 'Tender made current',
  'tender.cancelled': 'Tender notice cancelled',
  'document.uploaded': 'Document uploaded',
  'document.revised': 'Document revision uploaded',
  'document.scanned': 'Document scanned',
  'document.updated': 'Document category changed',
  'document.archived': 'Document archived',
};

type TaskAction = { kind: 'complete' | 'reschedule' | 'cancel'; task: FollowUpDto };

export function OpportunityDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [addFollowUpOpen, setAddFollowUpOpen] = useState(false);
  const [transition, setTransition] = useState<TransitionRequest | null>(null);
  const [taskAction, setTaskAction] = useState<TaskAction | null>(null);
  const [moving, setMoving] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const today = dhakaToday();

  // M2 linked follow-ups as ?tab=followups; they now live on the approved Activities tab.
  const requested = params.get('tab');
  const tab = (requested === 'followups' ? 'activities' : requested || 'overview') as TabId;
  const setTab = (next: TabId) => {
    const updated = new URLSearchParams(params);
    if (next === 'overview') updated.delete('tab');
    else updated.set('tab', next);
    setParams(updated, { replace: true });
  };

  const detailFetcher = useCallback((signal: AbortSignal) => fetchOpportunity(id, signal), [id]);
  const followUpsFetcher = useCallback(
    (signal: AbortSignal) => fetchOpportunityFollowUps(id, { pageSize: 50 }, signal),
    [id],
  );
  // Change History and the activity log are paged on the server; nothing
  // beyond the first page is silently dropped.
  const [historyPage, setHistoryPage] = useState(1);
  const [activitiesPage, setActivitiesPage] = useState(1);
  useEffect(() => {
    setHistoryPage(1);
    setActivitiesPage(1);
  }, [id]);
  const historyFetcher = useCallback(
    (signal: AbortSignal) => fetchOpportunityHistory(id, { page: historyPage, pageSize: HISTORY_PAGE_SIZE }, signal),
    [id, historyPage],
  );

  const detail = useApiResource(detailFetcher, [id]);
  const followUps = useApiResource(followUpsFetcher, [id]);
  const history = useApiResource(historyFetcher, [id, historyPage]);
  const contacts = useApiResource(
    useCallback((signal: AbortSignal) => fetchOpportunityContacts(id, signal), [id]),
    [id],
  );
  const activities = useApiResource(
    useCallback(
      (signal: AbortSignal) => fetchOpportunityActivities(id, { page: activitiesPage, pageSize: HISTORY_PAGE_SIZE }, signal),
      [id, activitiesPage],
    ),
    [id, activitiesPage],
  );
  const tenders = useApiResource(
    useCallback((signal: AbortSignal) => fetchOpportunityTenders(id, signal), [id]),
    [id],
  );
  const [showArchived, setShowArchived] = useState(false);
  const documents = useApiResource(
    useCallback((signal: AbortSignal) => fetchOpportunityDocuments(id, showArchived, signal), [id, showArchived]),
    [id, showArchived],
  );
  const [activityDialog, setActivityDialog] = useState<{ open: boolean; activity: ActivityDto | null }>({
    open: false,
    activity: null,
  });

  const reloadAll = () => {
    detail.reload();
    followUps.reload();
    history.reload();
    contacts.reload();
    activities.reload();
    tenders.reload();
    documents.reload();
  };

  if (detail.loading && !detail.data) {
    return (
      <PageContainer>
        <LoadingPanel label="Loading opportunity…" />
      </PageContainer>
    );
  }

  if (detail.error) {
    return (
      <PageContainer>
        <BackLink onClick={() => navigate('/opportunities')} />
        <ErrorPanel error={detail.error} onRetry={detail.reload} />
      </PageContainer>
    );
  }

  const opportunity = detail.data;
  if (!opportunity) return null;

  const terminal = isTerminalStage(opportunity.stage);
  const closed = terminal || opportunity.status === 'cancelled';
  const working = opportunity.status === 'active' && !terminal;
  const isManagement = user?.role === 'management';
  const currentLane = boardLane(opportunity.stage, opportunity.status);

  const openTasks = followUps.data?.items.filter((task) => task.state === 'open') ?? [];
  const allLoaded = followUps.data ? followUps.data.items.length === followUps.data.total : false;
  const isLastOpen = working && allLoaded && openTasks.length === 1;

  /** Change Stage menu: the same lane mapping the board uses. */
  const requestLane = async (lane: BoardLane) => {
    const request = transitionRequestFor(opportunity, lane);
    if (typeof request === 'string') {
      toast.error(request);
      return;
    }
    if (needsTransitionDialog(opportunity, request)) {
      setTransition(request);
      return;
    }
    setMoving(true);
    try {
      const updated = await sendDirectStageChange(opportunity, lane as never, newIdempotencyKey());
      toast.success(`Moved to ${STAGE_LABELS[updated.stage]}`, { description: opportunity.name });
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : 'The stage could not be changed.');
    } finally {
      setMoving(false);
      reloadAll();
    }
  };

  const afterChange = () => {
    setTransition(null);
    setTaskAction(null);
    setAddFollowUpOpen(false);
    reloadAll();
  };

  return (
    <PageContainer>
      <BackLink onClick={() => navigate('/opportunities')} />

      <header className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StageBadge stage={opportunity.stage} status={opportunity.status} />
              <PriorityBadge priority={opportunity.priority} />
              <span className="text-[11px] tabular-nums text-slate-400">{opportunity.reference}</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">{opportunity.name}</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              {opportunity.organization.name} · Owner{' '}
              <strong className="font-semibold text-slate-700">{opportunity.ownerName}</strong> ·{' '}
              {opportunity.sectionName}
            </p>
            <div className="mt-1">
              <RetainedStageNote stage={opportunity.stage} status={opportunity.status} />
            </div>
          </div>
          <div className="shrink-0 lg:text-right">
            {opportunity.stage === 'awarded' && opportunity.awardedValue ? (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Actual awarded value</p>
                <p className="text-2xl font-extrabold tabular-nums text-slate-900">
                  {formatBdtShort(opportunity.awardedValue)}
                </p>
                <p className="text-[11px] tabular-nums text-slate-400">
                  {formatBdt(opportunity.awardedValue)} · estimated {formatBdtShort(opportunity.estimatedValue)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Estimated value</p>
                <p className="text-2xl font-extrabold tabular-nums text-slate-900">
                  {formatBdtShort(opportunity.estimatedValue)}
                </p>
                <p className="text-[11px] tabular-nums text-slate-400">{formatBdt(opportunity.estimatedValue)}</p>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button
            icon={<PencilIcon className="h-4 w-4" />}
            onClick={() => setEditOpen(true)}
            disabled={closed}
            title={closed ? 'Closed records are read-only. Reopen it, or return it to Active, first.' : undefined}
          >
            Edit
          </Button>
          <Button
            icon={<MessageSquarePlusIcon className="h-4 w-4" />}
            onClick={() => setActivityDialog({ open: true, activity: null })}
          >
            Log Activity
          </Button>
          {!closed && (
            <Button icon={<CalendarPlusIcon className="h-4 w-4" />} onClick={() => setAddFollowUpOpen(true)}>
              Add Follow-up
            </Button>
          )}

          {working && (
            <label className="flex items-center gap-2">
              <span className="sr-only">Change stage</span>
              <select
                value=""
                disabled={moving}
                onChange={(event) => event.target.value && void requestLane(event.target.value as BoardLane)}
                className={inputCls(undefined, 'h-9 w-auto py-1.5 pr-8 text-sm font-semibold')}
                aria-label="Change stage"
              >
                <option value="">{moving ? 'Saving…' : 'Change Stage…'}</option>
                {BOARD_LANES.filter((lane) => lane !== currentLane).map((lane) => (
                  <option key={lane} value={lane}>
                    {boardLaneTitle(lane)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!terminal && opportunity.status !== 'active' && (
            <Button
              variant="navy"
              icon={<PlayIcon className="h-4 w-4" />}
              onClick={() => setTransition({ kind: 'status', target: 'active' })}
            >
              Return to Active
            </Button>
          )}
          {opportunity.status === 'on_hold' && (
            <Button
              icon={<XIcon className="h-4 w-4" />}
              onClick={() => setTransition({ kind: 'status', target: 'cancelled' })}
            >
              Cancel opportunity
            </Button>
          )}

          {terminal &&
            (isManagement ? (
              <Button
                variant="navy"
                icon={<RotateCcwIcon className="h-4 w-4" />}
                onClick={() => setTransition({ kind: 'reopen' })}
              >
                Reopen
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500">
                <LockIcon className="h-3.5 w-3.5" />
                Closed as {STAGE_LABELS[opportunity.stage]}. Only management can reopen it.
              </span>
            ))}

          {user?.capabilities.transferOpportunities && (
            <Button variant="navy" icon={<UserCogIcon className="h-4 w-4" />} onClick={() => setTransferOpen(true)}>
              {isManagement ? 'Reassign / Transfer' : 'Reassign'}
            </Button>
          )}
          <span className="ml-auto text-[11px] text-slate-400">Opportunities cannot be deleted.</span>
        </div>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4 pt-2">
          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'contacts', label: 'Contacts', count: contacts.data?.items.length },
              { id: 'activities', label: 'Activities', count: activities.data?.total },
              { id: 'tender', label: 'Tender', count: tenders.data?.items.length },
              { id: 'documents', label: 'Documents', count: documents.data?.items.length },
              { id: 'history', label: 'Change History', count: history.data?.total },
            ]}
          />
        </div>

        <div className="p-4">
          {tab === 'overview' && <OverviewTab opportunity={opportunity} today={today} />}

          {tab === 'contacts' && (
            <ContactsTab
              resource={contacts}
              opportunityId={opportunity.id}
              opportunityName={opportunity.name}
              onChanged={reloadAll}
            />
          )}

          {tab === 'activities' && (
            <div className="flex flex-col gap-4">
              <Panel
                title="Activity log"
                subtitle="Meetings, calls, emails and visits, newest first. The original author is kept after transfers."
                action={
                  <Button size="sm" icon={<MessageSquarePlusIcon className="h-3.5 w-3.5" />} onClick={() => setActivityDialog({ open: true, activity: null })}>
                    Log Activity
                  </Button>
                }
              >
                {activities.error ? (
                  <ErrorPanel error={activities.error} onRetry={activities.reload} />
                ) : activities.data && activities.data.items.length > 0 ? (
                  <>
                    <ActivityTimeline
                      activities={activities.data.items}
                      onEdit={(activity) => setActivityDialog({ open: true, activity })}
                    />
                    <PageControls page={activities.data} onChange={setActivitiesPage} />
                  </>
                ) : (
                  <EmptyState compact title="No activities logged" description="Log meetings, calls and visits to keep a record." />
                )}
              </Panel>
              <FollowUpsTab
              resource={followUps}
              today={today}
              canAdd={!closed}
              onAdd={() => setAddFollowUpOpen(true)}
              onAction={setTaskAction}
              onHold={opportunity.status === 'on_hold'}
            />
            </div>
          )}

          {tab === 'history' && <HistoryTab resource={history} onPageChange={setHistoryPage} />}

          {tab === 'tender' && (
            <TenderTab
              resource={tenders}
              closed={closed}
              parent={{
                id: opportunity.id,
                name: opportunity.name,
                organizationId: opportunity.organization.id,
                organizationName: opportunity.organization.name,
                ownerName: opportunity.ownerName,
              }}
              onChanged={reloadAll}
            />
          )}

          {tab === 'documents' && (
            <DocumentsTab
              resource={documents}
              opportunityId={opportunity.id}
              showArchived={showArchived}
              onShowArchived={setShowArchived}
              onChanged={reloadAll}
            />
          )}
        </div>
      </section>

      <OpportunityEditDialog
        open={editOpen}
        opportunity={opportunity}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          reloadAll();
        }}
        onReload={reloadAll}
      />
      <TransitionDialog
        subject={transition ? opportunity : null}
        request={transition}
        onClose={() => setTransition(null)}
        onDone={afterChange}
        onReload={afterChange}
      />
      <TransferDialog
        subject={transferOpen ? opportunity : null}
        isManagement={isManagement}
        onClose={() => setTransferOpen(false)}
        onDone={() => {
          setTransferOpen(false);
          reloadAll();
        }}
        onReload={() => {
          setTransferOpen(false);
          reloadAll();
        }}
      />
      <ActivityDialog
        open={activityDialog.open}
        opportunityId={opportunity.id}
        activity={activityDialog.activity}
        onClose={() => setActivityDialog({ open: false, activity: null })}
        onDone={() => {
          // A newly logged activity is on the first page, newest first.
          if (!activityDialog.activity) setActivitiesPage(1);
          setActivityDialog({ open: false, activity: null });
          reloadAll();
        }}
      />
      <AddFollowUpDialog
        opportunityId={opportunity.id}
        open={addFollowUpOpen}
        onClose={() => setAddFollowUpOpen(false)}
        onDone={afterChange}
      />
      <CompleteFollowUpDialog
        task={taskAction?.kind === 'complete' ? taskAction.task : null}
        isLastOpen={isLastOpen}
        onClose={() => setTaskAction(null)}
        onDone={afterChange}
        onReload={afterChange}
      />
      <RescheduleFollowUpDialog
        task={taskAction?.kind === 'reschedule' ? taskAction.task : null}
        onClose={() => setTaskAction(null)}
        onDone={afterChange}
        onReload={afterChange}
      />
      <CancelFollowUpDialog
        task={taskAction?.kind === 'cancel' ? taskAction.task : null}
        isLastOpen={isLastOpen}
        onClose={() => setTaskAction(null)}
        onDone={afterChange}
        onReload={afterChange}
      />
    </PageContainer>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900"
    >
      <ArrowLeftIcon className="h-4 w-4" />
      Back to Opportunities
    </button>
  );
}

function OverviewTab({ opportunity, today }: { opportunity: OpportunityDetailDto; today: string }) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <DetailItem label="Procuring organization">{opportunity.organization.name}</DetailItem>
      <DetailItem label="Department / office">{opportunity.department}</DetailItem>
      <DetailItem label="Solution category">{SOLUTION_CATEGORY_LABELS[opportunity.solutionCategory]}</DetailItem>
      <DetailItem label="Pipeline stage">{STAGE_LABELS[opportunity.stage]}</DetailItem>
      <DetailItem label="Status">{STATUS_LABELS[opportunity.status]}</DetailItem>
      <DetailItem label="Funding source">{opportunity.fundingSource}</DetailItem>
      <DetailItem label="Expected tender publication">
        {formatCalendarDate(opportunity.expectedPublicationDate)}
      </DetailItem>
      <DetailItem label="Expected award date">{formatCalendarDate(opportunity.expectedAwardDate)}</DetailItem>
      <DetailItem label="Next action">
        {opportunity.nextAction ? (
          <span className="flex flex-wrap items-center gap-2">
            {opportunity.nextAction.title}
            <span className="text-[11px] tabular-nums text-slate-500">
              {formatCalendarDate(opportunity.nextAction.dueDate)} · {opportunity.nextAction.assigneeName}
            </span>
            {opportunity.status === 'active' && <DueTag dueDate={opportunity.nextAction.dueDate} today={today} />}
          </span>
        ) : (
          'No open follow-up'
        )}
      </DetailItem>

      {opportunity.stage === 'awarded' && (
        <>
          <DetailItem label="Actual awarded value">
            {opportunity.awardedValue ? formatBdt(opportunity.awardedValue) : null}
          </DetailItem>
          <DetailItem label="Award date">{formatCalendarDate(opportunity.awardDate)}</DetailItem>
        </>
      )}
      {opportunity.stage === 'lost' && (
        <>
          <DetailItem label="Lost reason">
            {opportunity.lossReason ? LOSS_REASON_LABELS[opportunity.lossReason] : null}
            {opportunity.lossNote ? ` — ${opportunity.lossNote}` : ''}
          </DetailItem>
          <DetailItem label="Closed date">{formatCalendarDate(opportunity.closedDate)}</DetailItem>
        </>
      )}
      {opportunity.status !== 'active' && (
        <>
          <DetailItem label={`${STATUS_LABELS[opportunity.status]} because`}>{opportunity.statusNote}</DetailItem>
          {opportunity.status === 'cancelled' && (
            <DetailItem label="Cancelled on">{formatCalendarDate(opportunity.closedDate)}</DetailItem>
          )}
        </>
      )}

      <DetailItem label="Created">
        {formatInstant(opportunity.createdAt)} by {opportunity.createdByName}
      </DetailItem>
      <DetailItem label="Last updated">{formatInstant(opportunity.updatedAt)}</DetailItem>
      <div className="sm:col-span-2 lg:col-span-3">
        <DetailItem label="Description">{opportunity.description}</DetailItem>
      </div>
    </dl>
  );
}

const actionButton =
  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-150';

function FollowUpsTab({
  resource,
  today,
  canAdd,
  onAdd,
  onAction,
  onHold,
}: {
  resource: ReturnType<typeof useApiResource<Awaited<ReturnType<typeof fetchOpportunityFollowUps>>>>;
  today: string;
  canAdd: boolean;
  onAdd: () => void;
  onAction: (action: TaskAction) => void;
  onHold: boolean;
}) {
  if (resource.loading && !resource.data) return <LoadingPanel label="Loading follow-ups…" />;
  if (resource.error) return <ErrorPanel error={resource.error} onRetry={resource.reload} />;

  const items = resource.data?.items ?? [];

  return (
    <Panel
      title="Follow-ups"
      subtitle={
        onHold
          ? 'On Hold: these follow-ups are kept open but paused with the opportunity.'
          : 'The earliest due open follow-up is the opportunity’s next action.'
      }
      action={
        canAdd ? (
          <Button size="sm" icon={<CalendarPlusIcon className="h-3.5 w-3.5" />} onClick={onAdd}>
            Add Follow-up
          </Button>
        ) : undefined
      }
      bodyClassName="px-0 py-0"
    >
      {items.length === 0 ? (
        <EmptyState compact title="No follow-ups" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={`${thCls} pl-4`}>Task</th>
                <th className={thCls}>Assigned to</th>
                <th className={thCls}>Due</th>
                <th className={thCls}>State</th>
                <th className={`${thCls} pr-4 text-right`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((task) => (
                <tr key={task.id} className={onHold && task.state === 'open' ? 'bg-amber-50/40' : undefined}>
                  <td className={`${tdCls} pl-4`}>
                    <span className={`font-medium ${task.state !== 'open' ? 'text-slate-500' : ''}`}>{task.title}</span>
                    {task.state === 'completed' && (
                      <span className="mt-0.5 block text-[11.5px] text-slate-500">
                        Completed {formatInstant(task.completedAt)} by {task.completedByName}
                        {task.completionNote ? ` — “${task.completionNote}”` : ''}
                      </span>
                    )}
                    {task.state === 'cancelled' && (
                      <span className="mt-0.5 block text-[11.5px] text-slate-500">
                        Cancelled {formatInstant(task.cancelledAt)} by {task.cancelledByName}
                        {task.cancellationReason ? ` — ${task.cancellationReason}` : ''}
                      </span>
                    )}
                  </td>
                  <td className={tdCls}>{task.assigneeName}</td>
                  <td className={`${tdCls} whitespace-nowrap tabular-nums`}>
                    {formatCalendarDate(task.dueDate)}{' '}
                    {task.state === 'open' &&
                      (onHold ? (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                          On Hold
                        </span>
                      ) : (
                        <DueTag dueDate={task.dueDate} today={today} />
                      ))}
                  </td>
                  <td className={tdCls}>{FOLLOW_UP_STATE_LABELS[task.state]}</td>
                  <td className={`${tdCls} pr-4`}>
                    {task.state === 'open' && (
                      <span className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onAction({ kind: 'reschedule', task })}
                          className={`${actionButton} text-slate-600 hover:bg-slate-100`}
                        >
                          <CalendarClockIcon className="h-3.5 w-3.5" />
                          Reschedule
                        </button>
                        <button
                          type="button"
                          onClick={() => onAction({ kind: 'cancel', task })}
                          className={`${actionButton} text-slate-600 hover:bg-slate-100`}
                        >
                          <XIcon className="h-3.5 w-3.5" />
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => onAction({ kind: 'complete', task })}
                          className={`${actionButton} text-brand-dark hover:bg-brand-light`}
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                          Complete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const HISTORY_PAGE_SIZE = 25;

/** Shown only when there is more than one page. */
function PageControls({
  page,
  onChange,
}: {
  page: { page: number; pageSize: number; total: number };
  onChange: (page: number) => void;
}) {
  if (page.total <= page.pageSize) return null;
  return (
    <div className="mt-3">
      <Pagination
        page={page.page}
        pageCount={Math.max(1, Math.ceil(page.total / page.pageSize))}
        total={page.total}
        pageSize={page.pageSize}
        onChange={onChange}
      />
    </div>
  );
}

function HistoryTab({
  resource,
  onPageChange,
}: {
  resource: ReturnType<typeof useApiResource<Awaited<ReturnType<typeof fetchOpportunityHistory>>>>;
  onPageChange: (page: number) => void;
}) {
  if (resource.loading && !resource.data) return <LoadingPanel label="Loading change history…" />;
  if (resource.error) return <ErrorPanel error={resource.error} onRetry={resource.reload} />;
  if (!resource.data || resource.data.items.length === 0) {
    return <EmptyState compact title="No recorded changes" />;
  }

  return (
    <div>
      <ol className="flex flex-col gap-3">
        {resource.data.items.map((entry) => (
          <HistoryItem key={entry.id} entry={entry} />
        ))}
      </ol>
      <PageControls page={resource.data} onChange={onPageChange} />
    </div>
  );
}

const MONEY_FIELDS = new Set(['estimatedValue', 'awardedValue']);

/** History carries storage values for dates and money; show them as the rest of the page does. */
function displayChange(field: string, value: string | null): string {
  if (value === null) return '—';
  if (MONEY_FIELDS.has(field) && isValidMoneyString(value)) return formatBdt(value);
  if (/Date$/.test(field) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatCalendarDate(value);
  return value;
}

function HistoryItem({ entry }: { entry: HistoryEntryDto }) {
  const creation = entry.action === 'opportunity.created' || entry.action === 'follow_up.created';
  return (
    <li className="rounded-md border border-slate-200 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-900">
          {ACTION_LABELS[entry.action] ?? entry.action}
          {entry.subject && <span className="font-normal text-slate-600"> · {entry.subject}</span>}
        </p>
        <p className="text-[11px] tabular-nums text-slate-500">
          {entry.actorName} · {formatInstant(entry.occurredAt)}
        </p>
      </div>
      {entry.reason && <p className="mt-1 text-[12.5px] text-slate-600">Reason: {entry.reason}</p>}
      {entry.changes.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {entry.changes.map((change) => (
            <li key={change.field} className="text-[12.5px] text-slate-600">
              <span className="font-medium text-slate-700">{change.label}</span>:{' '}
              {creation || change.before === null ? (
                <span>{displayChange(change.field, change.after)}</span>
              ) : (
                <>
                  <span className="text-slate-500 line-through">{displayChange(change.field, change.before)}</span>{' '}
                  <span aria-hidden="true">→</span> <span>{displayChange(change.field, change.after)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
