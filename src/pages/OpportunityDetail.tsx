import React, { useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeftIcon, CalendarPlusIcon, MessageSquarePlusIcon, PencilIcon, UserCogIcon } from 'lucide-react';
import type { Stage, Tender } from '../types/crm';
import { useCrm } from '../contexts/CrmContext';
import { useScope } from '../hooks/useScope';
import { ALL_STAGES, sectionName } from '../data/options';
import { canReassignOpportunity } from '../utils/permissions';
import { formatBDT, formatBDTShort } from '../utils/format';
import { orgName, userName } from '../utils/lookup';
import { stageNeedsInput } from '../utils/validation';
import { Button } from '../components/ui/Button';
import { PriorityBadge, StageBadge } from '../components/ui/Badges';
import { AccessDenied, EmptyState } from '../components/ui/Feedback';
import { PageContainer, Tabs } from '../components/ui/Layout';
import { inputCls } from '../components/ui/FormFields';
import { OpportunityForm } from '../components/opportunities/OpportunityForm';
import { StageChangeModal } from '../components/opportunities/StageChangeModal';
import { ReassignModal } from '../components/opportunities/ReassignModal';
import { DocumentsPanel } from '../components/opportunities/DocumentsPanel';
import { ContactsTab, HistoryTab, OverviewTab, TenderTab } from '../components/opportunities/OpportunityTabs';
import { ActivityForm } from '../components/activities/ActivityForm';
import { FollowUpForm } from '../components/activities/FollowUpForm';
import { FollowUpList } from '../components/activities/FollowUpList';
import { ActivityTimeline } from '../components/activities/ActivityTimeline';
import { TenderForm } from '../components/tenders/TenderForm';
import { MarkSubmittedModal } from '../components/tenders/MarkSubmittedModal';

type TabId = 'overview' | 'contacts' | 'activities' | 'tender' | 'documents' | 'history';

export function OpportunityDetail() {
  const { id } = useParams();
  const { db, changeStage } = useCrm();
  const scope = useScope();
  const { user, users } = scope;
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [tenderForm, setTenderForm] = useState<{open: boolean;tender?: Tender;}>({ open: false });
  const [submitting, setSubmitting] = useState<Tender | null>(null);
  const [stageTarget, setStageTarget] = useState<Stage | null>(null);

  const opp = scope.opportunities.find((o) => o.id === id);
  const from = (location.state as {from?: string;} | null)?.from;

  if (!opp) {
    const exists = db.opportunities.some((o) => o.id === id);
    return exists ?
    <AccessDenied title="Access denied" message="This opportunity is outside your permitted scope. Only its owner, their section lead and management can view it." /> :

    <AccessDenied title="Opportunity not found" message="This record does not exist. It may have been removed by a demo data reset." />;

  }

  const tab = params.get('tab') as TabId || 'overview';
  const setTab = (t: TabId) => {
    const next = new URLSearchParams(params);
    if (t === 'overview') next.delete('tab');else
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  const contacts = scope.contacts.filter((c) => opp.contactIds.includes(c.id));
  const activities = scope.activities.filter((a) => a.oppId === opp.id).sort((a, b) => b.at.localeCompare(a.at));
  const followUps = scope.followUps.filter((f) => f.oppId === opp.id);
  const tender = scope.tenders.find((t) => t.oppId === opp.id);
  const documents = scope.documents.filter((d) => d.oppId === opp.id).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const canReassign = canReassignOpportunity(user, opp, users);

  const requestStage = (stage: Stage) => {
    if (stageNeedsInput(opp, stage)) {
      setStageTarget(stage);
      return;
    }
    const res = changeStage(opp.id, stage);
    if (res.ok) toast.success(`Moved to ${stage}`, { description: opp.name });else
    toast.error(res.error ?? 'Could not change stage.');
  };

  const sortedFollowUps = [...followUps].sort((a, b) => a.status === b.status ? a.due.localeCompare(b.due) : a.status === 'Open' ? -1 : 1);

  return (
    <PageContainer>
      <button
        type="button"
        onClick={() => navigate(from ?? '/opportunities')}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900">
        
        <ArrowLeftIcon className="h-4 w-4" />
        {from?.startsWith('/opportunities') || !from ? 'Back to Opportunities' : 'Back'}
      </button>

      <header className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StageBadge stage={opp.stage} />
              <PriorityBadge priority={opp.priority} />
            </div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">{opp.name}</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              {orgName(scope.organizations, opp.orgId)} · Owner <strong className="font-semibold text-slate-700">{userName(users, opp.ownerId)}</strong> · {sectionName(opp.sectionId)}
            </p>
          </div>
          <div className="shrink-0 lg:text-right">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Estimated value</p>
            <p className="text-2xl font-extrabold tabular-nums text-slate-900">{formatBDTShort(opp.estimatedValue)}</p>
            <p className="text-[11px] tabular-nums text-slate-400">{formatBDT(opp.estimatedValue)}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button icon={<PencilIcon className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button icon={<MessageSquarePlusIcon className="h-4 w-4" />} onClick={() => setActivityOpen(true)}>
            Log Activity
          </Button>
          <Button icon={<CalendarPlusIcon className="h-4 w-4" />} onClick={() => setFollowUpOpen(true)}>
            Add Follow-up
          </Button>
          <label className="flex items-center gap-2">
            <span className="sr-only">Change stage</span>
            <select
              value=""
              onChange={(e) => e.target.value && requestStage(e.target.value as Stage)}
              className={inputCls(undefined, 'h-9 w-auto py-1.5 pr-8 text-sm font-semibold')}
              aria-label="Change stage">
              
              <option value="">Change Stage…</option>
              {ALL_STAGES.filter((s) => s !== opp.stage).map((s) =>
              <option key={s} value={s}>
                  {s}
                </option>
              )}
            </select>
          </label>
          {canReassign &&
          <Button variant="navy" icon={<UserCogIcon className="h-4 w-4" />} onClick={() => setReassignOpen(true)}>
              {user.role === 'management' ? 'Reassign / Transfer' : 'Reassign'}
            </Button>
          }
          <span className="ml-auto text-[11px] text-slate-400">Opportunities cannot be deleted in this version.</span>
        </div>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4 pt-2">
          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'contacts', label: 'Contacts', count: contacts.length },
            { id: 'activities', label: 'Activities', count: activities.length },
            { id: 'tender', label: 'Tender' },
            { id: 'documents', label: 'Documents', count: documents.length },
            { id: 'history', label: 'Change History' }]
            } />
          
        </div>
        <div className="p-4">
          {tab === 'overview' &&
          <OverviewTab opp={opp} organizations={scope.organizations} users={users} followUps={followUps} onAddFollowUp={() => setFollowUpOpen(true)} />
          }
          {tab === 'contacts' && <ContactsTab contacts={contacts} onEdit={() => setEditOpen(true)} />}
          {tab === 'activities' &&
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">Activity log</h2>
                  <Button size="sm" onClick={() => setActivityOpen(true)}>
                    Log Activity
                  </Button>
                </div>
                {activities.length ?
              <ActivityTimeline activities={activities} users={users} contacts={scope.contacts} /> :

              <EmptyState compact title="No activities logged" description="Log meetings, calls and visits to keep a record." />
              }
              </div>
              <div className="lg:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">Follow-ups</h2>
                  <Button size="sm" onClick={() => setFollowUpOpen(true)}>
                    Add Follow-up
                  </Button>
                </div>
                {sortedFollowUps.length ?
              <FollowUpList followUps={sortedFollowUps} opportunities={[opp]} users={users} showOpportunity={false} /> :

              <EmptyState compact title="No follow-ups" />
              }
              </div>
            </div>
          }
          {tab === 'tender' &&
          <TenderTab
            tender={tender}
            users={users}
            onAdd={() => setTenderForm({ open: true })}
            onEdit={() => setTenderForm({ open: true, tender })}
            onMarkSubmitted={() => tender && setSubmitting(tender)} />

          }
          {tab === 'documents' && <DocumentsPanel oppId={opp.id} documents={documents} users={users} />}
          {tab === 'history' && <HistoryTab history={opp.history} users={users} />}
        </div>
      </section>

      <OpportunityForm open={editOpen} onClose={() => setEditOpen(false)} opportunity={opp} />
      <ActivityForm open={activityOpen} onClose={() => setActivityOpen(false)} defaultOppId={opp.id} />
      <FollowUpForm open={followUpOpen} onClose={() => setFollowUpOpen(false)} defaultOppId={opp.id} />
      {reassignOpen && <ReassignModal opportunity={opp} onClose={() => setReassignOpen(false)} />}
      <StageChangeModal opportunity={stageTarget ? opp : null} targetStage={stageTarget} onClose={() => setStageTarget(null)} />
      <TenderForm open={tenderForm.open} tender={tenderForm.tender} defaultOppId={opp.id} onClose={() => setTenderForm({ open: false })} />
      <MarkSubmittedModal tender={submitting} onClose={() => setSubmitting(null)} />
    </PageContainer>);

}