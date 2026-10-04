/**
 * Opportunity detail — the approved tabbed layout, loaded through scoped
 * endpoints (plan 7.5).
 *
 * Overview, Follow-ups and Change History are live. Contacts, Tender and
 * Documents keep their approved position but are marked unavailable: their
 * tables do not exist yet, so showing an empty tab would imply "none recorded"
 * rather than "not implemented".
 */
import { useCallback, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftIcon, LockIcon, PencilIcon } from 'lucide-react';

import { SOLUTION_CATEGORY_LABELS, STAGE_LABELS } from '../../../shared/enums.js';
import { formatBdt, formatBdtShort } from '../../../shared/money.js';
import {
  fetchOpportunity,
  fetchOpportunityFollowUps,
  fetchOpportunityHistory,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { DetailItem, PageContainer, Panel, Tabs, tdCls, thCls } from '../../components/ui/Layout';
import { useApiResource } from '../useApiResource.js';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import { OpportunityEditDialog } from '../components/OpportunityEditDialog.js';
import { DueTag, PriorityBadge, RetainedStageNote, StageBadge } from '../ui/ApiBadges.js';
import { dhakaToday, formatCalendarDate, formatInstant } from '../ui/dates.js';

type TabId = 'overview' | 'contacts' | 'followups' | 'tender' | 'documents' | 'history';

const UNAVAILABLE_TABS: Partial<Record<TabId, string>> = {
  contacts:
    'Contacts and link-scoped relationship notes arrive with the organizations and contacts milestone.',
  tender: 'Tender cycles arrive with the tender and documents milestone.',
  documents: 'Private document storage with authenticated download arrives with the same milestone.',
};

export function OpportunityDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
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
    (signal: AbortSignal) => fetchOpportunityFollowUps(id, { pageSize: 25 }, signal),
    [id],
  );
  const historyFetcher = useCallback(
    (signal: AbortSignal) => fetchOpportunityHistory(id, { pageSize: 25 }, signal),
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
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Estimated value</p>
            <p className="text-2xl font-extrabold tabular-nums text-slate-900">
              {formatBdtShort(opportunity.estimatedValue)}
            </p>
            <p className="text-[11px] tabular-nums text-slate-400">{formatBdt(opportunity.estimatedValue)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button icon={<PencilIcon className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500">
            <LockIcon className="h-3.5 w-3.5" />
            Stage changes, activities, follow-up actions and transfers arrive in later milestones
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
          {tab === 'overview' && (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailItem label="Procuring organization">{opportunity.organization.name}</DetailItem>
              <DetailItem label="Department / office">{opportunity.department}</DetailItem>
              <DetailItem label="Solution category">
                {SOLUTION_CATEGORY_LABELS[opportunity.solutionCategory]}
              </DetailItem>
              <DetailItem label="Pipeline stage">{STAGE_LABELS[opportunity.stage]}</DetailItem>
              <DetailItem label="Funding source">{opportunity.fundingSource}</DetailItem>
              <DetailItem label="Expected tender publication">
                {formatCalendarDate(opportunity.expectedPublicationDate)}
              </DetailItem>
              <DetailItem label="Expected award date">
                {formatCalendarDate(opportunity.expectedAwardDate)}
              </DetailItem>
              <DetailItem label="Next action">
                {opportunity.nextAction ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {opportunity.nextAction.title}
                    <span className="text-[11px] tabular-nums text-slate-500">
                      {formatCalendarDate(opportunity.nextAction.dueDate)}
                    </span>
                    <DueTag dueDate={opportunity.nextAction.dueDate} today={today} />
                  </span>
                ) : (
                  'No open follow-up'
                )}
              </DetailItem>
              <DetailItem label="Created">
                {formatInstant(opportunity.createdAt)} by {opportunity.createdByName}
              </DetailItem>
              <DetailItem label="Last updated">{formatInstant(opportunity.updatedAt)}</DetailItem>
              <div className="sm:col-span-2 lg:col-span-3">
                <DetailItem label="Description">{opportunity.description}</DetailItem>
              </div>
            </dl>
          )}

          {tab === 'followups' && (
            <FollowUpsTab resource={followUps} today={today} />
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

function FollowUpsTab({
  resource,
  today,
}: {
  resource: ReturnType<typeof useApiResource<Awaited<ReturnType<typeof fetchOpportunityFollowUps>>>>;
  today: string;
}) {
  if (resource.loading && !resource.data) return <LoadingPanel label="Loading follow-ups…" />;
  if (resource.error) return <ErrorPanel error={resource.error} onRetry={resource.reload} />;
  if (!resource.data || resource.data.items.length === 0) {
    return <EmptyState compact title="No follow-ups" />;
  }

  return (
    <Panel
      subtitle="The earliest due open follow-up is the opportunity's next action. Completing and rescheduling arrive in the next milestone."
      bodyClassName="px-0 py-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className={`${thCls} pl-4`}>Task</th>
              <th className={thCls}>Assigned to</th>
              <th className={thCls}>Due</th>
              <th className={`${thCls} pr-4`}>State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {resource.data.items.map((task) => (
              <tr key={task.id}>
                <td className={`${tdCls} pl-4 font-medium`}>{task.title}</td>
                <td className={tdCls}>{task.assigneeName}</td>
                <td className={`${tdCls} whitespace-nowrap tabular-nums`}>
                  {formatCalendarDate(task.dueDate)}{' '}
                  {task.state === 'open' && <DueTag dueDate={task.dueDate} today={today} />}
                </td>
                <td className={`${tdCls} pr-4 capitalize`}>{task.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        <li key={entry.id} className="rounded-md border border-slate-200 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold text-slate-900">
              {entry.action === 'opportunity.created' ? 'Opportunity created' : 'Opportunity updated'}
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
                  {entry.action === 'opportunity.created' ? (
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
      ))}
    </ol>
  );
}
