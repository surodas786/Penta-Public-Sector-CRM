/**
 * Account and section administration (FR-071, BR-002, BR-051, BR-052,
 * SEC-005, SEC-030).
 *
 * The System Administrator maintains structure, never commercial data: these
 * responses carry no opportunity names, counts or values. Where a commercial
 * fact blocks an action (an account still owns open opportunities) the
 * refusal says so without quantifying it.
 *
 * Invariants kept here, each under row locks inside one transaction:
 *   - a salesperson belongs to one active section and reports to its active
 *     lead; an active section has at most one active lead (BR-002, FR-002);
 *   - owner/section consistency: nobody's role or section changes while they
 *     own opportunities, so no opportunity is left with a mismatched or
 *     ineligible owner (BR-051);
 *   - the only lead of an active section is replaced, never just removed, and
 *     the replacement updates every direct report atomically (BR-052);
 *   - a section with open opportunities or active members stays active;
 *   - the last active administrator stays an active administrator;
 *   - no account changes its own role or deactivates itself;
 *   - material changes bump the session version, revoking live sessions on
 *     their next request (SEC-005).
 */
import { and, asc, count, desc, eq, ilike, inArray, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type {
  AdminAuditEntryDto,
  AdminSectionDto,
  AdminUserDto,
  CreateUserResultDto,
  AccountLinkDto,
  Paginated,
} from '../../shared/api.js';
import type { UserRole } from '../../shared/enums.js';
import type {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from '../../shared/validation.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { auditEvents, opportunities, sections, users } from '../db/schema.js';
import { conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canAdministerAccounts } from '../policy/scope.js';
import { issueAccountLink, revokeAccountLinks } from './accountTokens.js';
import { diffRecords, recordAuditEvent } from './audit.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { presentChanges } from './opportunities.js';

const SECTION_ROLES: readonly UserRole[] = ['sales', 'lead'];

function assertAdministrator(actor: Actor): void {
  // Routes already require it; services refuse independently.
  if (!canAdministerAccounts(actor)) throw forbidden('Account administration is limited to the System Administrator.');
}

const blocked = (message: string) => conflict(message, 'conflict');

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const manager = alias(users, 'manager');

const userSelection = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  role: users.role,
  sectionId: users.sectionId,
  sectionName: sections.name,
  managerId: users.managerId,
  managerName: manager.fullName,
  active: users.active,
  passwordHash: users.passwordHash,
  version: users.version,
} as const;

function userQuery(db: Database) {
  return db
    .select(userSelection)
    .from(users)
    .leftJoin(sections, eq(sections.id, users.sectionId))
    .leftJoin(manager, eq(manager.id, users.managerId));
}

type UserRow = Awaited<ReturnType<ReturnType<typeof userQuery>['execute']>>[number];

/** The hash is read only to answer "invitation pending"; it never leaves this function. */
function toAdminUser(row: UserRow): AdminUserDto {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    sectionId: row.sectionId,
    sectionName: row.sectionName ?? null,
    managerId: row.managerId,
    managerName: row.managerName ?? null,
    active: row.active,
    invitationPending: row.passwordHash === null,
    version: row.version,
  };
}

async function readUser(db: Database, userId: string): Promise<AdminUserDto> {
  const [row] = await userQuery(db).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound(`user ${userId} not found`);
  return toAdminUser(row);
}

export async function listUsers(
  db: Database,
  actor: Actor,
  query: z.output<typeof listUsersQuerySchema>,
): Promise<Paginated<AdminUserDto>> {
  assertAdministrator(actor);
  const where = query.q ? or(ilike(users.fullName, `%${query.q}%`), ilike(users.email, `%${query.q}%`)) : undefined;
  const [total] = await db.select({ value: count() }).from(users).where(where);
  const rows = await userQuery(db)
    .where(where)
    .orderBy(desc(users.active), asc(users.fullName))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return { items: rows.map(toAdminUser), total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function listSections(db: Database, actor: Actor): Promise<AdminSectionDto[]> {
  assertAdministrator(actor);
  const lead = alias(users, 'lead');
  const rows = await db
    .select({
      id: sections.id,
      name: sections.name,
      active: sections.active,
      leadId: lead.id,
      leadName: lead.fullName,
      version: sections.version,
      activeMembers: sql<number>`(SELECT count(*)::int FROM ${users} m WHERE m.section_id = ${sections.id} AND m.active)`,
    })
    .from(sections)
    .leftJoin(lead, and(eq(lead.id, sections.leadUserId), eq(lead.active, true)))
    .orderBy(asc(sections.name));
  return rows.map((row) => ({ ...row, leadId: row.leadId ?? null, leadName: row.leadName ?? null }));
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

async function lockUser(tx: Database, userId: string) {
  const [row] = await tx
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      sectionId: users.sectionId,
      managerId: users.managerId,
      active: users.active,
      version: users.version,
    })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);
  if (!row) throw notFound(`user ${userId} not found`);
  return row;
}

async function lockSection(tx: Database, sectionId: string) {
  const [row] = await tx
    .select({ id: sections.id, name: sections.name, active: sections.active, leadUserId: sections.leadUserId, version: sections.version })
    .from(sections)
    .where(eq(sections.id, sectionId))
    .for('update')
    .limit(1);
  if (!row) throw notFound(`section ${sectionId} not found`);
  return row;
}

/** The section's active lead, locked. */
async function activeLead(tx: Database, sectionId: string) {
  const [row] = await tx
    .select({ id: users.id, managerId: users.managerId })
    .from(users)
    .where(and(eq(users.sectionId, sectionId), eq(users.role, 'lead'), eq(users.active, true)))
    .for('update')
    .limit(1);
  return row ?? null;
}

/** Opportunities the person owns, open or closed. Any of them pins their role and section (BR-051). */
async function ownsAnyOpportunity(tx: Database, userId: string): Promise<boolean> {
  const [row] = await tx.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.ownerId, userId)).limit(1);
  return Boolean(row);
}

/** Open work: not Awarded, not Lost, not Cancelled (Active or On Hold). */
async function ownsOpenOpportunity(tx: Database, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.ownerId, userId),
        notInArray(opportunities.stage, ['awarded', 'lost']),
        ne(opportunities.status, 'cancelled'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Locks every active administrator row, in id order, as the FIRST lock of any
 * account change. Two administrators demoting or deactivating each other at
 * the same moment are then serialised — the second sees the first's commit —
 * and, because every transaction takes these locks before any other and in
 * the same order, they cannot deadlock.
 */
async function lockAdministrators(tx: Database): Promise<string[]> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true)))
    .orderBy(asc(users.id))
    .for('update');
  return admins.map((row) => row.id);
}

function assertNotLastAdministrator(activeAdmins: readonly string[], userId: string): void {
  if (activeAdmins.length <= 1 && activeAdmins.includes(userId)) {
    throw blocked('This is the last active System Administrator. Appoint another administrator first.');
  }
}

async function assertEmailFree(tx: Database, email: string, exceptUserId?: string): Promise<void> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), exceptUserId ? ne(users.id, exceptUserId) : undefined))
    .limit(1);
  if (row) throw validationFailed({ email: 'Another account already uses this email address.' });
}

async function assertActiveSection(tx: Database, sectionId: string | null | undefined, field = 'sectionId') {
  if (!sectionId) throw validationFailed({ [field]: 'Salespeople and section leads belong to a section.' });
  const [row] = await tx.select({ id: sections.id, active: sections.active }).from(sections).where(eq(sections.id, sectionId)).limit(1);
  if (!row || !row.active) throw validationFailed({ [field]: 'Choose an active section.' });
}

/** A lead may report to an active management account, or to nobody. */
async function assertLeadManager(tx: Database, managerId: string | null | undefined): Promise<string | null> {
  if (!managerId) return null;
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, managerId), eq(users.role, 'management'), eq(users.active, true)))
    .limit(1);
  if (!row) throw validationFailed({ managerId: 'A section lead reports to an active management account.' });
  return row.id;
}

/** Makes `leadId` the section's lead and points every salesperson in it at them. */
async function installLead(tx: Database, sectionId: string, leadId: string): Promise<void> {
  const timestamp = now();
  await tx
    .update(sections)
    .set({ leadUserId: leadId, updatedAt: timestamp, version: sql`${sections.version} + 1` })
    .where(eq(sections.id, sectionId));
  await tx
    .update(users)
    .set({ managerId: leadId, updatedAt: timestamp, version: sql`${users.version} + 1` })
    .where(and(eq(users.sectionId, sectionId), eq(users.role, 'sales'), sql`${users.managerId} IS DISTINCT FROM ${leadId}`));
}

function audit(
  tx: Database,
  actor: Actor,
  event: {
    entityType: 'user' | 'section';
    entityId: string;
    action: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reason?: string | null | undefined;
    requestId: string;
  },
) {
  return recordAuditEvent(tx, {
    actorId: actor.id,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    domain: 'administrative',
    before: event.before ?? null,
    after: event.after ?? null,
    reason: event.reason ?? null,
    requestId: event.requestId,
  });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function createUser(options: {
  db: Database;
  actor: Actor;
  command: z.output<typeof createUserSchema>;
  requestId: string;
  appOrigin: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<CreateUserResultDto> {
  const { db, actor, command, requestId, appOrigin, completeClaim } = options;
  assertAdministrator(actor);

  const { userId, link } = await db.transaction(async (tx) => {
    await assertEmailFree(tx, command.email);

    const inSection = SECTION_ROLES.includes(command.role);
    let sectionId: string | null = null;
    let managerId: string | null = null;

    if (inSection) {
      await assertActiveSection(tx, command.sectionId);
      sectionId = command.sectionId as string;
      await lockSection(tx, sectionId);
      const lead = await activeLead(tx, sectionId);

      if (command.role === 'sales') {
        // BR-002: a salesperson reports to the section's lead — derived, not chosen.
        if (!lead) throw blocked('This section has no active lead. Appoint a section lead before adding salespeople.');
        if (command.managerId && command.managerId !== lead.id) {
          throw validationFailed({ managerId: 'Salespeople report to their section’s lead.' });
        }
        managerId = lead.id;
      } else {
        if (lead) throw blocked('This section already has an active lead. Use Replace lead to change it.');
        managerId = await assertLeadManager(tx, command.managerId);
      }
    } else if (command.sectionId || command.managerId) {
      throw validationFailed({ sectionId: 'Management and administrator accounts have no section or reporting line.' });
    }

    const timestamp = now();
    const [created] = await tx
      .insert(users)
      .values({
        fullName: command.fullName,
        email: command.email,
        passwordHash: null,
        role: command.role,
        sectionId,
        managerId,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: users.id });
    if (!created) throw new Error('User insert returned no row.');

    if (command.role === 'lead' && sectionId) await installLead(tx, sectionId, created.id);

    await audit(tx, actor, {
      entityType: 'user',
      entityId: created.id,
      action: 'account.created',
      after: { fullName: command.fullName, email: command.email, role: command.role, sectionId, managerId },
      requestId,
    });

    const issued = await issueAccountLink(tx, { userId: created.id, purpose: 'invitation', createdBy: actor.id, appOrigin });
    await audit(tx, actor, {
      entityType: 'user',
      entityId: created.id,
      action: 'account.invitation_issued',
      after: { expiresAt: issued.expiresAt },
      requestId,
    });

    await completeClaim(tx, created.id);
    return { userId: created.id, link: issued };
  });

  return { user: await readUser(db, userId), link };
}

/** A replayed create: the account, but never the link a second time. */
export async function getCreatedUser(db: Database, actor: Actor, userId: string): Promise<CreateUserResultDto> {
  assertAdministrator(actor);
  return { user: await readUser(db, userId), link: null };
}

export async function updateUser(options: {
  db: Database;
  actor: Actor;
  userId: string;
  command: z.output<typeof updateUserSchema>;
  requestId: string;
}): Promise<AdminUserDto> {
  const { db, actor, userId, command, requestId } = options;
  assertAdministrator(actor);

  await db.transaction(async (tx) => {
    const activeAdmins = await lockAdministrators(tx);
    const target = await lockUser(tx, userId);
    if (target.version !== command.version) throw versionConflict();

    const role = command.role ?? target.role;
    const roleChanged = role !== target.role;
    if (roleChanged && target.id === actor.id) {
      throw forbidden('You cannot change your own role. Another administrator must do it.');
    }

    const inSection = SECTION_ROLES.includes(role);
    const sectionId = inSection ? (command.sectionId !== undefined ? command.sectionId : target.sectionId) : null;
    const sectionChanged = sectionId !== target.sectionId;
    if (!inSection && (command.sectionId || command.managerId)) {
      throw validationFailed({ sectionId: 'Management and administrator accounts have no section or reporting line.' });
    }
    if (inSection && (sectionChanged || roleChanged)) await assertActiveSection(tx, sectionId);

    const changes: Record<string, unknown> = {};
    if (command.fullName !== undefined) changes.fullName = command.fullName;
    if (command.email !== undefined && command.email !== target.email) {
      await assertEmailFree(tx, command.email, target.id);
      changes.email = command.email;
    }

    const material = roleChanged || sectionChanged;
    if (material) {
      // BR-051: an owner's role and section cannot drift from their
      // opportunities. Lead <-> salesperson within the same section keeps
      // them eligible owners in that section, so it is allowed.
      const staysEligibleHere = !sectionChanged && SECTION_ROLES.includes(role) && SECTION_ROLES.includes(target.role);
      if (!staysEligibleHere && (await ownsAnyOpportunity(tx, target.id))) {
        throw blocked(
          'This person still owns opportunities. Management or the section lead must transfer them before the role or section changes.',
        );
      }
      if (target.role === 'lead' && target.active && target.sectionId) {
        const section = await lockSection(tx, target.sectionId);
        if (section.leadUserId === target.id) {
          throw blocked('This person is the section’s lead. Use Replace lead to appoint their successor first.');
        }
      }
      if (target.role === 'admin' && role !== 'admin') assertNotLastAdministrator(activeAdmins, target.id);
      changes.role = role;
      changes.sectionId = sectionId;
    }

    // Reporting line.
    let managerId: string | null = target.managerId;
    if (role === 'sales' && sectionId) {
      await lockSection(tx, sectionId);
      const lead = await activeLead(tx, sectionId);
      if (!lead) throw blocked('This section has no active lead. Appoint a section lead first.');
      if (command.managerId !== undefined && command.managerId !== lead.id) {
        throw validationFailed({ managerId: 'Salespeople report to their section’s lead.' });
      }
      managerId = lead.id;
    } else if (role === 'lead') {
      if (roleChanged || sectionChanged) {
        await lockSection(tx, sectionId as string);
        if (await activeLead(tx, sectionId as string)) {
          throw blocked('This section already has an active lead. Use Replace lead to change it.');
        }
      }
      if (command.managerId !== undefined) managerId = await assertLeadManager(tx, command.managerId);
      else if (roleChanged) managerId = null;
    } else {
      managerId = null;
    }
    if (managerId !== target.managerId) changes.managerId = managerId;

    const diff = diffRecords(target as unknown as Record<string, unknown>, changes);
    if (diff.changed.length === 0) return;

    const updated = await tx
      .update(users)
      .set({
        ...changes,
        updatedAt: now(),
        version: sql`${users.version} + 1`,
        // SEC-005: a role or section change ends live sessions.
        ...(material ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
      })
      .where(and(eq(users.id, target.id), eq(users.version, command.version)))
      .returning({ id: users.id });
    if (updated.length === 0) throw versionConflict();

    if (role === 'lead' && (roleChanged || sectionChanged) && target.active) {
      await installLead(tx, sectionId as string, target.id);
    }

    await audit(tx, actor, {
      entityType: 'user',
      entityId: target.id,
      // Privileged role changes are audited as their own event (BR-052).
      action: roleChanged ? 'account.role_changed' : 'account.updated',
      before: diff.before,
      after: diff.after,
      requestId,
    });
  });

  return readUser(db, userId);
}

export async function deactivateUser(options: {
  db: Database;
  actor: Actor;
  userId: string;
  command: { version: number; reason?: string | undefined };
  requestId: string;
}): Promise<AdminUserDto> {
  const { db, actor, userId, command, requestId } = options;
  assertAdministrator(actor);

  await db.transaction(async (tx) => {
    const activeAdmins = await lockAdministrators(tx);
    const target = await lockUser(tx, userId);
    if (target.version !== command.version) throw versionConflict();
    if (target.id === actor.id) throw forbidden('You cannot deactivate your own account.');
    if (!target.active) throw blocked('This account is already inactive.');
    // The actor may have been deactivated by a transaction that committed
    // while this one waited for the administrator locks.
    if (!activeAdmins.includes(actor.id)) throw forbidden('Your account is no longer an active administrator.');

    if (target.role === 'admin') assertNotLastAdministrator(activeAdmins, target.id);
    if (target.role === 'lead' && target.sectionId) {
      const section = await lockSection(tx, target.sectionId);
      if (section.active && section.leadUserId === target.id) {
        throw blocked('This person is the only lead of an active section. Use Replace lead first (BR-052).');
      }
    }
    // BR-051. The opportunity check sees every committed transfer: transfers
    // lock the new owner's row, which this transaction already holds.
    if (await ownsOpenOpportunity(tx, target.id)) {
      throw blocked(
        'This person owns opportunities that are still open. Management or the section lead must transfer them before the account is deactivated.',
      );
    }

    await tx
      .update(users)
      .set({
        active: false,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: now(),
        version: sql`${users.version} + 1`,
      })
      .where(eq(users.id, target.id));
    await revokeAccountLinks(tx, target.id);

    await audit(tx, actor, {
      entityType: 'user',
      entityId: target.id,
      action: 'account.deactivated',
      before: { active: true },
      after: { active: false },
      reason: command.reason,
      requestId,
    });
  });

  return readUser(db, userId);
}

export async function reactivateUser(options: {
  db: Database;
  actor: Actor;
  userId: string;
  command: { version: number; reason?: string | undefined };
  requestId: string;
}): Promise<AdminUserDto> {
  const { db, actor, userId, command, requestId } = options;
  assertAdministrator(actor);

  await db.transaction(async (tx) => {
    const target = await lockUser(tx, userId);
    if (target.version !== command.version) throw versionConflict();
    if (target.active) throw blocked('This account is already active.');

    const changes: Record<string, unknown> = { active: true };
    if (target.sectionId && SECTION_ROLES.includes(target.role)) {
      const section = await lockSection(tx, target.sectionId);
      if (!section.active) throw blocked('This account’s section is inactive. Reactivate the section or move the account first.');
      const lead = await activeLead(tx, target.sectionId);
      if (target.role === 'lead' && lead) {
        throw blocked('The section already has an active lead. Change this account’s role before reactivating it.');
      }
      if (target.role === 'sales') {
        if (!lead) throw blocked('The section has no active lead. Appoint one before reactivating salespeople.');
        changes.managerId = lead.id;
      }
    }

    await tx
      .update(users)
      .set({ ...changes, updatedAt: now(), version: sql`${users.version} + 1` })
      .where(eq(users.id, target.id));
    if (target.role === 'lead' && target.sectionId) await installLead(tx, target.sectionId, target.id);

    await audit(tx, actor, {
      entityType: 'user',
      entityId: target.id,
      action: 'account.reactivated',
      before: { active: false },
      after: changes,
      reason: command.reason,
      requestId,
    });
  });

  return readUser(db, userId);
}

/** Issues a fresh single-use link: an invitation if no password was ever set, otherwise a reset. */
export async function issueUserLink(options: {
  db: Database;
  actor: Actor;
  userId: string;
  requestId: string;
  appOrigin: string;
}): Promise<AccountLinkDto> {
  const { db, actor, userId, requestId, appOrigin } = options;
  assertAdministrator(actor);

  return db.transaction(async (tx) => {
    const target = await lockUser(tx, userId);
    if (!target.active) throw blocked('Reactivate the account before issuing a sign-in link.');
    const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
    const purpose = row?.passwordHash ? 'password_reset' : 'invitation';

    const link = await issueAccountLink(tx, { userId, purpose, createdBy: actor.id, appOrigin });
    await audit(tx, actor, {
      entityType: 'user',
      entityId: userId,
      action: purpose === 'invitation' ? 'account.invitation_issued' : 'account.reset_issued',
      after: { expiresAt: link.expiresAt },
      requestId,
    });
    return link;
  });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function assertSectionNameFree(tx: Database, name: string, exceptId?: string) {
  const [row] = await tx
    .select({ id: sections.id })
    .from(sections)
    .where(and(sql`lower(${sections.name}) = lower(${name})`, exceptId ? ne(sections.id, exceptId) : undefined))
    .limit(1);
  if (row) throw validationFailed({ name: 'Another section already has this name.' });
}

export async function createSection(options: {
  db: Database;
  actor: Actor;
  name: string;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<AdminSectionDto> {
  const { db, actor, name, requestId, completeClaim } = options;
  assertAdministrator(actor);
  const id = await db.transaction(async (tx) => {
    await assertSectionNameFree(tx, name);
    const timestamp = now();
    const [created] = await tx
      .insert(sections)
      .values({ name, active: true, createdAt: timestamp, updatedAt: timestamp })
      .returning({ id: sections.id });
    if (!created) throw new Error('Section insert returned no row.');
    await audit(tx, actor, { entityType: 'section', entityId: created.id, action: 'section.created', after: { name }, requestId });
    await completeClaim(tx, created.id);
    return created.id;
  });
  return getSection(db, actor, id);
}

export async function getSection(db: Database, actor: Actor, sectionId: string): Promise<AdminSectionDto> {
  const section = (await listSections(db, actor)).find((row) => row.id === sectionId);
  if (!section) throw notFound(`section ${sectionId} not found`);
  return section;
}

export async function renameSection(options: {
  db: Database;
  actor: Actor;
  sectionId: string;
  command: { version: number; name: string };
  requestId: string;
}): Promise<AdminSectionDto> {
  const { db, actor, sectionId, command, requestId } = options;
  assertAdministrator(actor);
  await db.transaction(async (tx) => {
    const section = await lockSection(tx, sectionId);
    if (section.version !== command.version) throw versionConflict();
    if (section.name === command.name) return;
    await assertSectionNameFree(tx, command.name, sectionId);
    await tx
      .update(sections)
      .set({ name: command.name, updatedAt: now(), version: sql`${sections.version} + 1` })
      .where(eq(sections.id, sectionId));
    await audit(tx, actor, {
      entityType: 'section',
      entityId: sectionId,
      action: 'section.renamed',
      before: { name: section.name },
      after: { name: command.name },
      requestId,
    });
  });
  return getSection(db, actor, sectionId);
}

/**
 * BR-052: appoints a salesperson of the section as its lead, in one
 * transaction. The previous lead, if any, becomes a salesperson in the same
 * section — so anything they own stays validly owned — and every salesperson
 * now reports to the new lead. Both accounts' sessions are revoked, because
 * both changed role.
 */
export async function replaceSectionLead(options: {
  db: Database;
  actor: Actor;
  sectionId: string;
  command: { version: number; newLeadId: string; reason: string };
  requestId: string;
}): Promise<AdminSectionDto> {
  const { db, actor, sectionId, command, requestId } = options;
  assertAdministrator(actor);

  await db.transaction(async (tx) => {
    const section = await lockSection(tx, sectionId);
    if (section.version !== command.version) throw versionConflict();
    if (!section.active) throw blocked('Reactivate the section before appointing its lead.');

    const candidate = await lockUser(tx, command.newLeadId);
    if (!candidate.active || candidate.role !== 'sales' || candidate.sectionId !== sectionId) {
      throw validationFailed({ newLeadId: 'Choose an active salesperson in this section.' });
    }

    const previous = await activeLead(tx, sectionId);
    const timestamp = now();

    // Demote first: the one-active-lead-per-section index must never see two.
    if (previous) {
      await tx
        .update(users)
        .set({
          role: 'sales',
          managerId: candidate.id,
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: timestamp,
          version: sql`${users.version} + 1`,
        })
        .where(eq(users.id, previous.id));
      await audit(tx, actor, {
        entityType: 'user',
        entityId: previous.id,
        action: 'account.role_changed',
        before: { role: 'lead' },
        after: { role: 'sales', managerId: candidate.id },
        reason: command.reason,
        requestId,
      });
    }

    await tx
      .update(users)
      .set({
        role: 'lead',
        managerId: previous?.managerId ?? null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: timestamp,
        version: sql`${users.version} + 1`,
      })
      .where(eq(users.id, candidate.id));
    await audit(tx, actor, {
      entityType: 'user',
      entityId: candidate.id,
      action: 'account.role_changed',
      before: { role: 'sales', managerId: candidate.managerId },
      after: { role: 'lead', managerId: previous?.managerId ?? null },
      reason: command.reason,
      requestId,
    });

    await installLead(tx, sectionId, candidate.id);
    await audit(tx, actor, {
      entityType: 'section',
      entityId: sectionId,
      action: 'section.lead_replaced',
      before: { leadUserId: previous?.id ?? null },
      after: { leadUserId: candidate.id },
      reason: command.reason,
      requestId,
    });
  });

  return getSection(db, actor, sectionId);
}

export async function setSectionActive(options: {
  db: Database;
  actor: Actor;
  sectionId: string;
  active: boolean;
  command: { version: number; reason?: string | undefined };
  requestId: string;
}): Promise<AdminSectionDto> {
  const { db, actor, sectionId, active, command, requestId } = options;
  assertAdministrator(actor);

  await db.transaction(async (tx) => {
    const section = await lockSection(tx, sectionId);
    if (section.version !== command.version) throw versionConflict();
    if (section.active === active) throw blocked(`This section is already ${active ? 'active' : 'inactive'}.`);

    if (!active) {
      // BR-052, without revealing what the open work is.
      const [open] = await tx
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.sectionId, sectionId),
            notInArray(opportunities.stage, ['awarded', 'lost']),
            ne(opportunities.status, 'cancelled'),
          ),
        )
        .limit(1);
      if (open) {
        throw blocked('This section still has open opportunities. Management must transfer or close them first.');
      }
      const [member] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.sectionId, sectionId), eq(users.active, true)))
        .limit(1);
      if (member) throw blocked('This section still has active members. Move or deactivate them first.');
    }

    await tx
      .update(sections)
      .set({ active, updatedAt: now(), version: sql`${sections.version} + 1` })
      .where(eq(sections.id, sectionId));
    await audit(tx, actor, {
      entityType: 'section',
      entityId: sectionId,
      action: active ? 'section.reactivated' : 'section.deactivated',
      before: { active: !active },
      after: { active },
      reason: command.reason,
      requestId,
    });
  });

  return getSection(db, actor, sectionId);
}

// ---------------------------------------------------------------------------
// Administrative audit (SEC-012)
// ---------------------------------------------------------------------------

/** Administrative events only. Commercial history is never returned here. */
export async function listAdminAudit(
  db: Database,
  actor: Actor,
  page: number,
  pageSize: number,
): Promise<Paginated<AdminAuditEntryDto>> {
  assertAdministrator(actor);
  const where = eq(auditEvents.domain, 'administrative') as SQL;
  const [total] = await db.select({ value: count() }).from(auditEvents).where(where);
  const actorUser = alias(users, 'actor_user');
  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorName: actorUser.fullName,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      occurredAt: auditEvents.occurredAt,
      reason: auditEvents.reason,
      beforeData: auditEvents.beforeData,
      afterData: auditEvents.afterData,
    })
    .from(auditEvents)
    .leftJoin(actorUser, eq(actorUser.id, auditEvents.actorId))
    .where(where)
    .orderBy(desc(auditEvents.occurredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const userIds = rows.filter((row) => row.entityType === 'user').map((row) => row.entityId);
  const sectionIds = rows.filter((row) => row.entityType === 'section').map((row) => row.entityId);
  const subjects = new Map<string, string>();
  if (userIds.length > 0) {
    for (const row of await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, userIds))) {
      subjects.set(row.id, row.name);
    }
  }
  if (sectionIds.length > 0) {
    for (const row of await db.select({ id: sections.id, name: sections.name }).from(sections).where(inArray(sections.id, sectionIds))) {
      subjects.set(row.id, row.name);
    }
  }

  const changes = await presentChanges(
    db,
    rows.map((row) => ({ before: row.beforeData, after: row.afterData })),
  );

  return {
    items: rows.map((row, index) => ({
      id: row.id,
      action: row.action,
      actorName: row.actorName ?? 'System',
      subject: subjects.get(row.entityId) ?? null,
      occurredAt: row.occurredAt.toISOString(),
      reason: row.reason,
      changes: changes[index] ?? [],
    })),
    total: total?.value ?? 0,
    page,
    pageSize,
  };
}

