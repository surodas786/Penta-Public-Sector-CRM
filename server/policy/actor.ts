import type { UserRole } from '../../shared/enums.js';

/**
 * The authenticated account as the policy layer sees it.
 *
 * Always built from the session's user id plus a fresh database read — never
 * from anything the client sent (SEC-001).
 */
export interface Actor {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  /** Null for management and administrators; required for leads and salespeople. */
  sectionId: string | null;
  sectionName: string | null;
  active: boolean;
  sessionVersion: number;
}

/**
 * A lead or salesperson with no section is malformed. Plan 3.1 requires such an
 * account to fail closed rather than widen its scope, so this is checked
 * wherever scope is derived.
 */
export function hasCoherentScope(actor: Actor): boolean {
  if (!actor.active) return false;
  if (actor.role === 'lead' || actor.role === 'sales') return actor.sectionId !== null;
  return true;
}
