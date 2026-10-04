import type { CrmDb, User } from '../types/crm';
import { canAccessSalesRecords, canViewContact, canViewOpportunity, canViewTeamManagement } from './permissions';

/** Used on user switch: decides whether the current route is still accessible to the new user. */
export function isPathAccessible(pathname: string, user: User, db: CrmDb): boolean {
  const [root, id] = pathname.split('/').filter(Boolean);
  if (!root) return true;
  if (root === 'team') return canViewTeamManagement(user);
  if (!canAccessSalesRecords(user)) return false;
  if (root === 'opportunities' && id) {
    const o = db.opportunities.find((x) => x.id === id);
    return !!o && canViewOpportunity(user, o, db.users);
  }
  if (root === 'tenders' && id) {
    const t = db.tenders.find((x) => x.id === id);
    const o = t && db.opportunities.find((x) => x.id === t.oppId);
    return !!o && canViewOpportunity(user, o, db.users);
  }
  if (root === 'contacts' && id) {
    const c = db.contacts.find((x) => x.id === id);
    return !!c && canViewContact(user, c, db.opportunities, db.users);
  }
  return true;
}