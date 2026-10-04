import { useMemo } from 'react';
import { useCrm } from '../contexts/CrmContext';
import {
  canAccessSalesRecords,
  canViewContact,
  canViewOpportunity,
  canViewOrganizations } from
'../utils/permissions';

/**
 * Returns only the records the current user may see. Every list, dashboard, search,
 * report and export reads from here so access rules are applied consistently.
 */
export function useScope() {
  const { db, currentUser } = useCrm();
  return useMemo(() => {
    const users = db.users;
    const salesAccess = canAccessSalesRecords(currentUser);
    const opportunities = salesAccess ? db.opportunities.filter((o) => canViewOpportunity(currentUser, o, users)) : [];
    const oppIds = new Set(opportunities.map((o) => o.id));
    return {
      user: currentUser,
      users,
      salesAccess,
      opportunities,
      oppIds,
      activities: db.activities.filter((a) => oppIds.has(a.oppId)),
      followUps: db.followUps.filter((f) => oppIds.has(f.oppId)),
      tenders: db.tenders.filter((t) => oppIds.has(t.oppId)),
      documents: db.documents.filter((d) => oppIds.has(d.oppId)),
      contacts: salesAccess ? db.contacts.filter((c) => canViewContact(currentUser, c, db.opportunities, users)) : [],
      organizations: canViewOrganizations(currentUser) ? db.organizations : []
    };
  }, [db, currentUser]);
}

export type Scope = ReturnType<typeof useScope>;