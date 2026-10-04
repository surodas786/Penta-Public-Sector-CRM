import { Link } from 'react-router-dom';
import { ExternalLinkIcon, FileTextIcon, PlusIcon, UserIcon } from 'lucide-react';
import type { ChangeEntry, Contact, FollowUp, Opportunity, Organization, Tender, User } from '../../types/crm';
import { sectionName } from '../../data/options';
import { formatBDT, formatDate, formatDateTime } from '../../utils/format';
import { isActiveOpp } from '../../utils/metrics';
import { orgName, userName } from '../../utils/lookup';
import { BidStatusBadge, DueTag, TenderIndicator } from '../ui/Badges';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Feedback';
import { DetailItem, tdCls, thCls } from '../ui/Layout';
import { FollowUpList } from '../activities/FollowUpList';

export function OverviewTab({
  opp,
  organizations,
  users,
  followUps,
  onAddFollowUp






}: {opp: Opportunity;organizations: Organization[];users: User[];followUps: FollowUp[];onAddFollowUp: () => void;}) {
  const open = followUps.filter((f) => f.status === 'Open').sort((a, b) => a.due.localeCompare(b.due));
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        {opp.description && <p className="text-sm leading-relaxed text-slate-700">{opp.description}</p>}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
          <DetailItem label="Procuring organization">
            <Link to={`/organizations/${opp.orgId}`} className="font-medium text-brand-dark hover:underline">
              {orgName(organizations, opp.orgId)}
            </Link>
          </DetailItem>
          <DetailItem label="Department / office">{opp.department}</DetailItem>
          <DetailItem label="Solution category">{opp.category}</DetailItem>
          <DetailItem label="Estimated value">{formatBDT(opp.estimatedValue)}</DetailItem>
          <DetailItem label="Funding source">{opp.fundingSource}</DetailItem>
          <DetailItem label="Priority">{opp.priority}</DetailItem>
          <DetailItem label="Expected tender publication">{formatDate(opp.expectedTenderDate)}</DetailItem>
          <DetailItem label="Expected award">{formatDate(opp.expectedAwardDate)}</DetailItem>
          <DetailItem label="Section">{sectionName(opp.sectionId)}</DetailItem>
          <DetailItem label="Created">
            {formatDate(opp.createdAt)} by {userName(users, opp.createdBy)}
          </DetailItem>
          {opp.stage === 'Awarded' &&
          <>
              <DetailItem label="Actual awarded value">
                <span className="font-semibold text-green-700">{formatBDT(opp.awardedValue)}</span>
              </DetailItem>
              <DetailItem label="Award date">{formatDate(opp.awardDate)}</DetailItem>
            </>
          }
        </dl>
        {opp.stage === 'Lost' && opp.lostReason &&
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <strong>Lost reason:</strong> {opp.lostReason}
          </div>
        }
        {(opp.stage === 'On Hold' || opp.stage === 'Cancelled') && opp.statusNote &&
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>{opp.stage} note:</strong> {opp.statusNote}
          </div>
        }
      </div>
      <div className="flex flex-col gap-3">
        {isActiveOpp(opp) &&
        <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Next action</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{opp.nextAction || '—'}</p>
            {opp.nextActionDue &&
          <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                Due {formatDate(opp.nextActionDue)} <DueTag date={opp.nextActionDue} />
              </p>
          }
          </div>
        }
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Open follow-ups ({open.length})</p>
            <button type="button" onClick={onAddFollowUp} className="text-xs font-semibold text-brand hover:text-brand-dark">
              + Add
            </button>
          </div>
          {open.length ?
          <FollowUpList followUps={open} opportunities={[opp]} users={users} showOpportunity={false} /> :

          <p className="py-3 text-sm text-slate-500">No open follow-ups.</p>
          }
        </div>
      </div>
    </div>);

}

export function ContactsTab({ contacts, onEdit }: {contacts: Contact[];onEdit: () => void;}) {
  if (!contacts.length)
  return (
    <EmptyState
      icon={<UserIcon className="h-8 w-8" />}
      title="No associated contacts"
      description="Link government contacts by editing the opportunity, or add a new contact from Organizations & Contacts."
      action={<Button onClick={onEdit}>Edit associated contacts</Button>}
      compact />);


  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="border-y border-slate-200 bg-slate-50">
          <tr>
            <th className={`${thCls} pl-4`}>Name</th>
            <th className={thCls}>Designation</th>
            <th className={thCls}>Department / office</th>
            <th className={thCls}>Email</th>
            <th className={`${thCls} pr-4`}>Phone</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {contacts.map((c) =>
          <tr key={c.id}>
              <td className={`${tdCls} pl-4`}>
                <Link to={`/contacts/${c.id}`} className="font-semibold text-brand-dark hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className={tdCls}>{c.designation}</td>
              <td className={`${tdCls} text-slate-600`}>{c.department || '—'}</td>
              <td className={`${tdCls} text-slate-600`}>{c.email || '—'}</td>
              <td className={`${tdCls} pr-4 text-slate-600`}>{c.phone || '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="px-4 pt-3">
        <Button size="sm" onClick={onEdit}>
          Edit associated contacts
        </Button>
      </div>
    </div>);

}

export function TenderTab({
  tender,
  users,
  onAdd,
  onEdit,
  onMarkSubmitted






}: {tender?: Tender;users: User[];onAdd: () => void;onEdit: () => void;onMarkSubmitted: () => void;}) {
  if (!tender)
  return (
    <EmptyState
      icon={<FileTextIcon className="h-8 w-8" />}
      title="No tender record yet"
      description="Add the tender once it is published to track deadlines and bid status."
      action={
      <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={onAdd}>
            Add tender
          </Button>
      }
      compact />);


  const open = tender.bidStatus === 'Reviewing' || tender.bidStatus === 'Preparing';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/tenders/${tender.id}`} className="text-[15px] font-bold text-slate-900 hover:text-brand-dark">
            {tender.title}
          </Link>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Ref {tender.reference} · {tender.procuringEntity}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <BidStatusBadge status={tender.bidStatus} />
            <TenderIndicator tender={tender} />
          </div>
        </div>
        <div className="flex gap-2">
          {open &&
          <Button variant="primary" size="sm" onClick={onMarkSubmitted}>
              Mark Submitted
            </Button>
          }
          <Button size="sm" onClick={onEdit}>
            Edit tender
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <DetailItem label="Submission deadline">{formatDateTime(tender.submissionDeadline)}</DetailItem>
        <DetailItem label="Publication">{formatDate(tender.publicationDate)}</DetailItem>
        <DetailItem label="Clarification deadline">{formatDate(tender.clarificationDeadline)}</DetailItem>
        <DetailItem label="Bid submitted">{formatDate(tender.submissionDate)}</DetailItem>
        <DetailItem label="Procurement method">{tender.method}</DetailItem>
        <DetailItem label="Responsible owner">{userName(users, tender.ownerId)}</DetailItem>
        <DetailItem label="Notice">
          {tender.noticeUrl ?
          <a href={tender.noticeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-dark hover:underline">
              Open notice <ExternalLinkIcon className="h-3.5 w-3.5" />
            </a> :

          <span className="text-slate-400">No URL entered</span>
          }
        </DetailItem>
      </dl>
      {tender.notes && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{tender.notes}</p>}
    </div>);

}

export function HistoryTab({ history, users }: {history: ChangeEntry[];users: User[];}) {
  const rows = [...history].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead className="border-y border-slate-200 bg-slate-50">
          <tr>
            <th className={`${thCls} pl-4`}>When</th>
            <th className={thCls}>User</th>
            <th className={thCls}>Field</th>
            <th className={thCls}>Old value</th>
            <th className={`${thCls} pr-4`}>New value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((h) =>
          <tr key={h.id}>
              <td className={`${tdCls} whitespace-nowrap pl-4 tabular-nums text-slate-600`}>{formatDateTime(h.at)}</td>
              <td className={`${tdCls} whitespace-nowrap`}>{userName(users, h.userId)}</td>
              <td className={`${tdCls} font-semibold`}>{h.field}</td>
              <td className={`${tdCls} max-w-[240px] text-slate-500`}>{h.oldValue}</td>
              <td className={`${tdCls} max-w-[240px] pr-4`}>{h.newValue}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>);

}