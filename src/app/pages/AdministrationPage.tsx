/**
 * Administrator landing page.
 *
 * Deliberately contains no commercial data and no commercial placeholder: an
 * administrator manages accounts, not sales records (FR-001, plan 3.1, 7.5).
 * The account and section management screens themselves arrive with the
 * administration milestone, so what they will contain is stated plainly rather
 * than mocked up with numbers.
 */
import { ShieldCheckIcon, UsersIcon } from 'lucide-react';

import { ROLE_LABELS } from '../../../shared/enums.js';
import { DetailItem, PageContainer, PageHeader, Panel } from '../../components/ui/Layout';
import { useAuth } from '../AuthContext.js';
import { formatInstant } from '../ui/dates.js';

export function AdministrationPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <PageContainer>
      <PageHeader
        title="Administration"
        subtitle="Accounts, sections and reporting lines. This role has no access to commercial records."
      />

      <Panel title="Your account">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem label="Name">{user.fullName}</DetailItem>
          <DetailItem label="Email">{user.email}</DetailItem>
          <DetailItem label="Role">{ROLE_LABELS[user.role]}</DetailItem>
          <DetailItem label="Signed in">{formatInstant(new Date().toISOString())}</DetailItem>
        </dl>
      </Panel>

      <Panel title="Separation of duties">
        <div className="flex gap-3">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
          <div className="text-[13px] leading-relaxed text-slate-600">
            <p>
              Administrative ability does not imply sales-data visibility. Opportunity lists,
              totals, contacts, documents and commercial audit history are refused for this account
              by the server, not merely hidden from this navigation.
            </p>
            <p className="mt-2">
              Commercial oversight belongs to management. Account administration belongs here. No
              account can grant itself the other.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Account management">
        <div className="flex gap-3">
          <UsersIcon className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="text-[13px] leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-800">Not available yet</p>
            <p className="mt-1">
              Creating and editing users, assigning roles and sections, setting reporting lines,
              activating and deactivating accounts, maintaining sections, and the administrative
              audit trail all arrive with the administration milestone.
            </p>
            <p className="mt-2">
              Until then, the synthetic development accounts are created by the seed script, which
              refuses to run outside development and test.
            </p>
          </div>
        </div>
      </Panel>
    </PageContainer>
  );
}
