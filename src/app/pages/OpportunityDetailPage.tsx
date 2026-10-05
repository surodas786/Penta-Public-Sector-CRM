/**
 * Opportunity detail — the approved tabbed layout, loaded through scoped
 * endpoints (plan 7.5).
 *
 * Overview, Follow-ups and Change History are live, and so are stage, status
 * and follow-up actions (M2). Contacts, Tender and Documents keep their
 * approved position but are marked unavailable: their tables do not exist
 * yet, so an empty tab would imply "none recorded" rather than "not built".
 */
import { useCallback, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  CheckIcon,
  LockIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-react';

import type { FollowUpDto, HistoryEntryDto, OpportunityDetailDto } from '../../../shared/api.js';
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
import { formatBdt, formatBdtShort } from '../../../shared/money.js';
import { ApiRequestError, newIdempotencyKey } from '../../api/client.js';
import {
  fetchOpportunity,
  fetchOpportunityFollowUps,
  fetchOpportunityHistory,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { inputCls } from '../../components/ui/FormFields';
import { DetailItem, PageContainer, Panel, Tabs, tdCls, thCls } from '../../components/ui/Layout';
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
import { TransitionDialog } from '../components/TransitionDialog.js';
import {
  needsTransitionDialog,
  sendDirectStageChange,
  transitionRequestFor,
  type TransitionRequest,
} from '../transitions.js';
import { DueTag, PriorityBadge, RetainedStageNote, StageBadge } from '../ui/ApiBadges.js';
import { dhakaToday, formatCalendarDate, formatInstant } from '../ui/dates.js';

type TabId = 'overview' | 'contacts' | 'followups' | 'tender' | 'documents' | 'history';

const UNAVAILABLE_TABS: Partial<Record<TabId, string>> = {
  contacts:
    'Contacts and link-scoped relationship notes arrive with the organizations and contacts milestone.',
  tender: 'Tender cycles arrive with the tender and documents milestone.',
  documents: 'Private document storage with authenticated download arrives with the same milestone.',
};

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
  const today = dhakaToday();

  const tab = ((params.get('tab') as TabId) || 'overview') as TabId;
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
  const historyFetcher = useCallback(
    (signal: AbortSignal) => fetchOpportunityHistory(id, { pageSize: 50 }, signal),
    [id],
  );

  const detail = useApiResource(detailFetcher, [id]);
  const followUps = useApiResource(followUpsFetcher, [id]);
  const history = useApiResource(historyFetcher, [id]);

  const reloadAll = () => {
    detail.reload();
    followUps.reload();
    history.reload();
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

          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500">
            <LockIcon className="h-3.5 w-3.5" />
            Activities and transfers arrive in later milestones
          </span>
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
              { id: 'contacts', label: 'Contacts' },
              { id: 'followups', label: 'Follow-ups', count: followUps.data?.total },
              { id: 'tender', label: 'Tender' },
              { id: 'documents', label: 'Documents' },
              { id: 'history', label: 'Change History', count: history.data?.total },
            ]}
          />
        </div>

        <div className="p-4">
          {tab === 'overview' && <OverviewTab opportunity={opportunity} today={today} />}

          {tab === 'followups' && (
            <FollowUpsTab
              resource={followUps}
              today={today}
              canAdd={!closed}
              onAdd={() => setAddFollowUpOpen(true)}
              onAction={setTaskAction}
              onHold={opportunity.status === 'on_hold'}
            />
          )}

          {tab === 'history' && <HistoryTab resource={history} />}

          {UNAVAILABLE_TABS[tab] && (
            <EmptyState
              icon={<LockIcon className="h-8 w-8" />}
              title="Not available yet"
              description={UNAVAILABLE_TABS[tab]}
              compact
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

function HistoryTab({
  resource,
}: {
  resource: ReturnType<typeof useApiResource<Awaited<ReturnType<typeof fetchOpportunityHistory>>>>;
}) {
  if (resource.loading && !resource.data) return <LoadingPanel label="Loading change history…" />;
  if (resource.error) return <ErrorPanel error={resource.error} onRetry={resource.reload} />;
  if (!resource.data || resource.data.items.length === 0) {
    return <EmptyState compact title="No recorded changes" />;
  }

  return (
    <ol className="flex flex-col gap-3">
      {resource.data.items.map((entry) => (
        <HistoryItem key={entry.id} entry={entry} />
      ))}
    </ol>
  );
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
                <span>{change.after ?? '—'}</span>
              ) : (
                <>
                  <span className="text-slate-500 line-through">{change.before ?? '—'}</span>{' '}
                  <span aria-hidden="true">→</span> <span>{change.after ?? '—'}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
