import type { Opportunity, Organization, User } from '../../types/crm';
import { sectionName } from '../../data/options';
import { formatBDTShort, formatDate } from '../../utils/format';
import { isActiveOpp } from '../../utils/metrics';
import { orgName, userName } from '../../utils/lookup';
import { DueTag, PriorityBadge, StageBadge } from '../ui/Badges';
import { SortHeader, tdCls } from '../ui/Layout';

export type OppSortKey = 'name' | 'org' | 'stage' | 'owner' | 'value' | 'award' | 'due' | 'priority';

interface OpportunityTableProps {
  rows: Opportunity[];
  organizations: Organization[];
  users: User[];
  sort: OppSortKey;
  dir: 'asc' | 'desc';
  onSort: (key: OppSortKey) => void;
  onOpen: (id: string) => void;
  showSection: boolean;
}

export function OpportunityTable({ rows, organizations, users, sort, dir, onSort, onOpen, showSection }: OpportunityTableProps) {
  const H = ({ k, label, className }: {k: OppSortKey;label: string;className?: string;}) =>
  <SortHeader label={label} active={sort === k} dir={dir} onClick={() => onSort(k)} className={className} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px]">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <H k="name" label="Opportunity" />
            <H k="org" label="Organization" />
            <H k="stage" label="Stage" />
            <H k="owner" label="Owner" />
            <H k="value" label="Est. value" className="text-right" />
            <H k="award" label="Exp. award" />
            <H k="due" label="Next action due" />
            <H k="priority" label="Priority" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((o) =>
          <tr key={o.id} onClick={() => onOpen(o.id)} className="cursor-pointer transition-colors duration-150 hover:bg-slate-50">
              <td className={`${tdCls} max-w-[260px]`}>
                <button type="button" onClick={(e) => {e.stopPropagation();onOpen(o.id);}} className="text-left font-semibold text-slate-900 hover:text-brand-dark">
                  {o.name}
                </button>
                <span className="block text-[11.5px] text-slate-500">
                  {o.category}
                  {showSection ? ` · ${sectionName(o.sectionId)}` : ''}
                </span>
              </td>
              <td className={`${tdCls} max-w-[220px] text-slate-600`}>{orgName(organizations, o.orgId)}</td>
              <td className={tdCls}>
                <StageBadge stage={o.stage} />
              </td>
              <td className={`${tdCls} whitespace-nowrap`}>{userName(users, o.ownerId)}</td>
              <td className={`${tdCls} whitespace-nowrap text-right font-semibold tabular-nums`}>{formatBDTShort(o.estimatedValue)}</td>
              <td className={`${tdCls} whitespace-nowrap tabular-nums text-slate-600`}>{formatDate(o.expectedAwardDate)}</td>
              <td className={`${tdCls} whitespace-nowrap`}>
                {isActiveOpp(o) && o.nextActionDue ?
              <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatDate(o.nextActionDue)}</span>
                    <DueTag date={o.nextActionDue} />
                  </span> :

              <span className="text-slate-400">Closed</span>
              }
              </td>
              <td className={tdCls}>
                <PriorityBadge priority={o.priority} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>);

}