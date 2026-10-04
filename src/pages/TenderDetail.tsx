import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, ExternalLinkIcon, PencilIcon } from 'lucide-react';
import { useCrm } from '../contexts/CrmContext';
import { useScope } from '../hooks/useScope';
import { sectionName } from '../data/options';
import { isTenderOpen } from '../utils/metrics';
import { DEMO_DATE_LABEL } from '../utils/demoClock';
import { formatDate, formatDateTime } from '../utils/format';
import { userName } from '../utils/lookup';
import { Button } from '../components/ui/Button';
import { AccessDenied } from '../components/ui/Feedback';
import { BidStatusBadge, StageBadge, TenderIndicator } from '../components/ui/Badges';
import { DetailItem, PageContainer, Panel } from '../components/ui/Layout';
import { TenderForm } from '../components/tenders/TenderForm';
import { MarkSubmittedModal } from '../components/tenders/MarkSubmittedModal';

export function TenderDetail() {
  const { id } = useParams();
  const { db } = useCrm();
  const scope = useScope();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);

  const tender = scope.tenders.find((t) => t.id === id);
  if (!tender) {
    const exists = db.tenders.some((t) => t.id === id);
    return <AccessDenied title={exists ? 'Access denied' : 'Tender not found'} message={exists ? 'This tender belongs to an opportunity outside your permitted scope.' : undefined} />;
  }
  const opp = scope.opportunities.find((o) => o.id === tender.oppId);

  return (
    <PageContainer>
      <button type="button" onClick={() => navigate(-1)} className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900">
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>
      <header className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <BidStatusBadge status={tender.bidStatus} />
              <TenderIndicator tender={tender} />
            </div>
            <h1 className="mt-2 text-xl font-bold text-slate-900">{tender.title}</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Ref {tender.reference} · {tender.procuringEntity}
            </p>
          </div>
          <div className="lg:text-right">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Submission deadline</p>
            <p className="text-lg font-bold tabular-nums text-slate-900">{formatDateTime(tender.submissionDeadline)}</p>
            <p className="text-[11px] text-slate-400">Indicator vs demo date {DEMO_DATE_LABEL}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {isTenderOpen(tender) &&
          <Button variant="primary" onClick={() => setSubmitOpen(true)}>
              Mark Submitted
            </Button>
          }
          <Button icon={<PencilIcon className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
            Edit tender
          </Button>
          {tender.noticeUrl &&
          <a
            href={tender.noticeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            
              Open notice URL <ExternalLinkIcon className="h-4 w-4" />
            </a>
          }
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Tender details" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
            <DetailItem label="Procurement method">{tender.method}</DetailItem>
            <DetailItem label="Publication date">{formatDate(tender.publicationDate)}</DetailItem>
            <DetailItem label="Clarification deadline">{formatDate(tender.clarificationDeadline)}</DetailItem>
            <DetailItem label="Bid status">{tender.bidStatus}</DetailItem>
            <DetailItem label="Bid submission date">{formatDate(tender.submissionDate)}</DetailItem>
            <DetailItem label="Responsible owner">{userName(scope.users, tender.ownerId)}</DetailItem>
            <DetailItem label="Notice URL">{tender.noticeUrl ? <span className="break-all">{tender.noticeUrl}</span> : <span className="text-slate-400">Not entered</span>}</DetailItem>
          </dl>
          {tender.notes && <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{tender.notes}</p>}
        </Panel>
        {opp &&
        <Panel title="Linked opportunity">
            <Link to={`/opportunities/${opp.id}?tab=tender`} className="text-[14px] font-semibold text-brand-dark hover:underline">
              {opp.name}
            </Link>
            <div className="mt-2">
              <StageBadge stage={opp.stage} />
            </div>
            <dl className="mt-3 grid gap-3">
              <DetailItem label="Owner">{userName(scope.users, opp.ownerId)}</DetailItem>
              <DetailItem label="Section">{sectionName(opp.sectionId)}</DetailItem>
            </dl>
          </Panel>
        }
      </div>

      <TenderForm open={editOpen} tender={tender} onClose={() => setEditOpen(false)} />
      <MarkSubmittedModal tender={submitOpen ? tender : null} onClose={() => setSubmitOpen(false)} />
    </PageContainer>);

}