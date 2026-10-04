import type { Contact, Opportunity, User } from '../types/crm';

/**
 * Centralized permission checks for the Penta CRM prototype.
 *
 * IMPORTANT: These functions only control what this browser prototype renders and allows.
 * A production system MUST enforce the same access rules on the backend (API authorization
 * and scoped database queries). Client-side checks can always be bypassed and are never a
 * security boundary on their own.
 */

export function canAccessSalesRecords(user: User): boolean {
  return user.active && user.role !== 'admin';
}

export function isDirectReport(manager: User, userId: string, users: User[]): boolean {
  return users.some((u) => u.id === userId && u.managerId === manager.id);
}

export function canViewOpportunity(user: User, opp: Opportunity, users: User[]): boolean {
  if (!canAccessSalesRecords(user)) return false;
  switch (user.role) {
    case 'management':
      return true;
    case 'lead':
      return opp.ownerId === user.id || isDirectReport(user, opp.ownerId, users);
    case 'sales':
      return opp.ownerId === user.id;
    default:
      return false;
  }
}

/** Editing follows the same scope as viewing for sales roles. */
export function canEditOpportunity(user: User, opp: Opportunity, users: User[]): boolean {
  return canViewOpportunity(user, opp, users);
}

export function canReassignOpportunity(user: User, opp: Opportunity, users: User[]): boolean {
  if (!canViewOpportunity(user, opp, users)) return false;
  return user.role === 'management' || user.role === 'lead';
}

export function canChangeSection(user: User): boolean {
  return user.active && user.role === 'management';
}

/** Users the current user may set as an opportunity owner. */
export function assignableOwners(user: User, users: User[]): User[] {
  const eligible = users.filter((u) => u.active && (u.role === 'sales' || u.role === 'lead') && u.sectionId);
  switch (user.role) {
    case 'management':
      return eligible;
    case 'lead':
      return eligible.filter((u) => u.id === user.id || u.managerId === user.id);
    case 'sales':
      return eligible.filter((u) => u.id === user.id);
    default:
      return [];
  }
}

/** Users the current user may assign follow-ups / tender ownership to for a given opportunity. */
export function taskAssignees(user: User, opp: Opportunity, users: User[]): User[] {
  const pool = user.role === 'management' ? [user, ...assignableOwners(user, users)] : assignableOwners(user, users);
  return pool.filter((u) => canViewOpportunity(u, opp, users));
}

export function canViewContact(user: User, contact: Contact, opportunities: Opportunity[], users: User[]): boolean {
  if (!canAccessSalesRecords(user)) return false;
  if (user.role === 'management') return true;
  return opportunities.some((o) => o.contactIds.includes(contact.id) && canViewOpportunity(user, o, users));
}

export function canViewOrganizations(user: User): boolean {
  return canAccessSalesRecords(user);
}

export function canViewTeamManagement(user: User): boolean {
  return user.active && (user.role === 'management' || user.role === 'admin');
}

export function canManageUsers(user: User): boolean {
  return user.active && user.role === 'admin';
}

export function canExportReports(user: User): boolean {
  return canAccessSalesRecords(user);
}

/** Team members whose workload the user may see. */
export function visibleTeamMembers(user: User, users: User[]): User[] {
  switch (user.role) {
    case 'management':
      return users.filter((u) => u.role === 'sales' || u.role === 'lead');
    case 'lead':
      return users.filter((u) => u.id === user.id || u.managerId === user.id);
    case 'sales':
      return [user];
    default:
      return [];
  }
}

export function scopeDescription(user: User, sectionLabel: string): string {
  switch (user.role) {
    case 'management':
      return 'Organization-wide';
    case 'lead':
      return `${sectionLabel} section (you and your direct reports)`;
    case 'sales':
      return 'Your own records';
    default:
      return 'No sales record access';
  }
}