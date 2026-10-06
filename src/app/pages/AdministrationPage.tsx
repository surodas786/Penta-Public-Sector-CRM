/**
 * Administration (FR-071) — the approved administration dashboard and user
 * table, connected to the server.
 *
 * Accounts, sections, reporting lines and the administrative audit trail.
 * Deliberately no commercial data and no commercial placeholder: an
 * administrator manages accounts, not sales records (FR-001, plan 3.1).
 */
import { useCallback, useMemo, useState } from 'react';
import { KeyRoundIcon, PencilIcon, PlusIcon, SearchIcon, ShieldIcon, UserPlusIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { AccountLinkDto, AdminSectionDto, AdminUserDto } from '../../../shared/api.js';
import { ROLE_LABELS, USER_ROLES } from '../../../shared/enums.js';
import { ApiRequestError } from '../../api/client.js';
import { fetchAdminAudit, fetchAdminSections, fetchAdminUsers, issueAccountLink } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { inputCls } from '../../components/ui/FormFields';
import { PageContainer, PageHeader, Pagination, Panel, tdCls, thCls } from '../../components/ui/Layout';
import { useAuth } from '../AuthContext.js';
import {
  AccountLinkDialog,
  AccountStateDialog,
  SectionDialog,
  UserDialog,
  type SectionAction,
} from '../components/AdminDialogs.js';
import { ErrorPanel, LoadingPanel } from '../components/Feedback.js';
import { Avatar } from '../ui/ApiBadges.js';
import { formatInstant } from '../ui/dates.js';
import { useApiResource } from '../useApiResource.js';

const ROLE_PLURALS: Record<string, string> = {
  management: 'Management',
  lead: 'Section leads',
  sales: 'Salespeople',
};

const AUDIT_LABELS: Record<string, string> = {
  'account.created': 'Account created',
  'account.updated': 'Account updated',
  'account.role_changed': 'Role changed',
  'account.deactivated': 'Account deactivated',
  'account.reactivated': 'Account reactivated',
  'account.invitation_issued': 'Invitation link issued',
  'account.invitation_accepted': 'Invitation accepted',
  'account.reset_issued': 'Password reset link issued',
  'account.password_reset': 'Password reset',
  'section.created': 'Section created',
  'section.renamed': 'Section renamed',
  'section.lead_replaced': 'Section lead replaced',
  'section.deactivated': 'Section deactivated',
  'section.reactivated': 'Section reactivated',
};

export function AdministrationPage() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [userDialog, setUserDialog] = useState<{ open: boolean; user: AdminUserDto | null }>({ open: false, user: null });
  const [stateTarget, setStateTarget] = useState<AdminUserDto | null>(null);
  const [link, setLink] = useState<{ link: AccountLinkDto; person: string } | null>(null);
  const [sectionAction, setSectionAction] = useState<SectionAction | null>(null);

  const users = useApiResource(
    useCallback((signal: AbortSignal) => fetchAdminUsers({ q: q || undefined, page, pageSize: 50 }, signal), [q, page]),
    [q, page],
  );
  // Every account, for the summary, reporting-line and lead pickers. Bounded:
  // the proposed envelope is 100 users (NFR-010).
  const everyone = useApiResource(
    useCallback((signal: AbortSignal) => fetchAdminUsers({ pageSize: 100 }, signal), []),
    [],
  );
  const sections = useApiResource(useCallback((signal: AbortSignal) => fetchAdminSections(signal), []), []);
  const audit = useApiResource(
    useCallback((signal: AbortSignal) => fetchAdminAudit({ page: auditPage, pageSize: 15 }, signal), [auditPage]),
    [auditPage],
  );

  const all = useMemo(() => everyone.data?.items ?? [], [everyone.data]);
  const management = all.filter((person) => person.role === 'management' && person.active);

  const refresh = () => {
    users.reload();
    everyone.reload();
    sections.reload();
    audit.reload();
  };

  const issueLink = async (person: AdminUserDto) => {
    try {
      const issued = await issueAccountLink(person.id);
      setLink({ link: issued, person: person.fullName });
      audit.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : 'The link could not be issued.');
    }
  };

  if (!me) return null;
  if (users.error || sections.error) {
    return (
      <PageContainer>
        <ErrorPanel error={(users.error ?? sections.error)!} onRetry={refresh} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Administration"
        subtitle="Accounts, roles, sections and reporting lines. Administrators do not receive sales-record access."
        actions={
          <Button variant="primary" icon={<UserPlusIcon className="h-4 w-4" />} onClick={() => setUserDialog({ open: true, user: null })}>
            Add user
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <p className="text-[13px] text-slate-600">
          The System Administrator role manages accounts and reporting lines only. Opportunities, contacts, tenders,
          documents and sales reports are refused for this account by the server, not merely hidden.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg bg-navy px-4 py-3.5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#9FB4D1]">Active accounts</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums">{all.filter((person) => person.active).length}</p>
        </div>
        {USER_ROLES.slice(0, 3).map((role) => (
          <div key={role} className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{ROLE_PLURALS[role]}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {all.filter((person) => person.active && person.role === role).length}
            </p>
          </div>
        ))}
      </div>

      <Panel
        title="User accounts"
        action={
          <label className="relative block">
            <span className="sr-only">Search accounts</span>
            <SearchIcon className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
              placeholder="Name or email…"
              className={inputCls(undefined, 'h-8 w-56 pl-8 text-[13px]')}
            />
          </label>
        }
        bodyClassName="p-0"
      >
        {!users.data ? (
          <LoadingPanel label="Loading accounts…" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className={`${thCls} pl-4`}>User</th>
                    <th className={thCls}>Role</th>
                    <th className={thCls}>Section</th>
                    <th className={thCls}>Reports to</th>
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} pr-4 text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.data.items.map((person) => (
                    <tr key={person.id}>
                      <td className={`${tdCls} pl-4`}>
                        <span className="block font-semibold text-slate-900">{person.fullName}</span>
                        <span className="block text-[11.5px] text-slate-500">{person.email}</span>
                      </td>
                      <td className={tdCls}>{ROLE_LABELS[person.role]}</td>
                      <td className={tdCls}>{person.sectionName ?? '—'}</td>
                      <td className={tdCls}>{person.managerName ?? '—'}</td>
                      <td className={tdCls}>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                            !person.active
                              ? 'bg-slate-100 text-slate-500 ring-slate-400/20'
                              : person.invitationPending
                                ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
                                : 'bg-green-50 text-green-700 ring-green-600/20'
                          }`}
                        >
                          {!person.active ? 'Inactive' : person.invitationPending ? 'Invitation pending' : 'Active'}
                        </span>
                      </td>
                      <td className={`${tdCls} pr-4 text-right`}>
                        <span className="inline-flex gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<PencilIcon className="h-3.5 w-3.5" />}
                            onClick={() => setUserDialog({ open: true, user: person })}
                          >
                            Edit
                          </Button>
                          {person.active && (
                            <Button size="sm" variant="ghost" icon={<KeyRoundIcon className="h-3.5 w-3.5" />} onClick={() => void issueLink(person)}>
                              {person.invitationPending ? 'New invitation' : 'Reset link'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={person.active ? 'secondary' : 'primary'}
                            onClick={() => setStateTarget(person)}
                            disabled={person.id === me.id}
                          >
                            {person.active ? 'Deactivate' : 'Activate'}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={users.data.page}
              pageCount={Math.max(1, Math.ceil(users.data.total / users.data.pageSize))}
              total={users.data.total}
              pageSize={users.data.pageSize}
              onChange={setPage}
            />
          </>
        )}
      </Panel>

      <Panel
        title="Sections and reporting lines"
        action={
          <Button size="sm" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={() => setSectionAction({ kind: 'create' })}>
            Add section
          </Button>
        }
      >
        {!sections.data ? (
          <LoadingPanel label="Loading sections…" />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sections.data.items.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                members={all.filter((person) => person.sectionId === section.id && person.role === 'sales')}
                onAction={setSectionAction}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Administrative audit" subtitle="Account and section changes. Commercial history is never shown here." bodyClassName="p-0">
        {!audit.data ? (
          <LoadingPanel label="Loading audit…" />
        ) : audit.data.items.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-500">No administrative changes recorded yet.</p>
        ) : (
          <>
            <ol className="divide-y divide-slate-100">
              {audit.data.items.map((entry) => (
                <li key={entry.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-semibold text-slate-900">
                      {AUDIT_LABELS[entry.action] ?? entry.action}
                      {entry.subject && <span className="font-normal text-slate-600"> · {entry.subject}</span>}
                    </p>
                    <p className="text-[11px] tabular-nums text-slate-500">
                      {entry.actorName} · {formatInstant(entry.occurredAt)}
                    </p>
                  </div>
                  {entry.reason && <p className="mt-0.5 text-[12.5px] text-slate-600">Reason: {entry.reason}</p>}
                  {entry.changes.length > 0 && (
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      {entry.changes
                        .filter((change) => change.field !== 'expiresAt')
                        .map((change) =>
                          change.before === null
                            ? `${change.label}: ${change.after ?? '—'}`
                            : `${change.label}: ${change.before} → ${change.after ?? '—'}`,
                        )
                        .join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            <Pagination
              page={audit.data.page}
              pageCount={Math.max(1, Math.ceil(audit.data.total / audit.data.pageSize))}
              total={audit.data.total}
              pageSize={audit.data.pageSize}
              onChange={setAuditPage}
            />
          </>
        )}
      </Panel>

      <UserDialog
        open={userDialog.open}
        user={userDialog.user}
        sections={sections.data?.items ?? []}
        managementAccounts={management}
        isSelf={userDialog.user?.id === me.id}
        onClose={() => setUserDialog({ open: false, user: null })}
        onSaved={(result) => {
          setUserDialog({ open: false, user: null });
          if (result.link) setLink({ link: result.link, person: result.user.fullName });
          refresh();
        }}
      />
      <AccountStateDialog
        user={stateTarget}
        onClose={() => setStateTarget(null)}
        onDone={() => {
          setStateTarget(null);
          refresh();
        }}
      />
      <AccountLinkDialog link={link?.link ?? null} person={link?.person ?? ''} onClose={() => setLink(null)} />
      <SectionDialog
        action={sectionAction}
        users={all}
        onClose={() => setSectionAction(null)}
        onDone={() => {
          setSectionAction(null);
          refresh();
        }}
      />
    </PageContainer>
  );
}

function SectionCard({
  section,
  members,
  onAction,
}: {
  section: AdminSectionDto;
  members: AdminUserDto[];
  onAction: (action: SectionAction) => void;
}) {
  return (
    <div className={`rounded-md border border-slate-200 p-3 ${section.active ? '' : 'bg-slate-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-bold text-slate-900">
          {section.name}
          {!section.active && <span className="ml-2 text-[11px] font-semibold text-slate-400">Inactive</span>}
        </p>
        <span className="text-[11px] tabular-nums text-slate-500">{section.activeMembers} active</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[13px]">
        <Avatar name={section.leadName ?? '?'} tone="navy" />
        <span className="font-semibold text-slate-800">{section.leadName ?? 'No active lead'}</span>
        <span className="text-slate-400">Section Lead</span>
      </div>
      <ul className="ml-3 mt-2 border-l border-slate-200 pl-4">
        {members.map((person) => (
          <li key={person.id} className="flex items-center gap-2 py-1 text-[13px]">
            <Avatar name={person.fullName} />
            <span className={person.active ? 'text-slate-700' : 'text-slate-400 line-through'}>{person.fullName}</span>
            {!person.active && <span className="text-[11px] text-slate-400">Inactive</span>}
            {person.active && person.managerId === null && (
              <span className="text-[11px] text-amber-700">no reporting line</span>
            )}
          </li>
        ))}
        {members.length === 0 && <li className="py-1 text-[13px] text-slate-400">No salespeople</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {section.active && (
          <Button size="sm" onClick={() => onAction({ kind: 'lead', section })}>
            {section.leadName ? 'Replace lead' : 'Appoint lead'}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'rename', section })}>
          Rename
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'state', section })}>
          {section.active ? 'Deactivate' : 'Reactivate'}
        </Button>
      </div>
    </div>
  );
}
