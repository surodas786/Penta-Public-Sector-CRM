/**
 * Account and section administration (FR-071, BR-051, BR-052, CR4, CR5,
 * SEC-005, SEC-030).
 *
 * The System Administrator maintains structure, never commercial data: these
 * responses carry no opportunity names, counts or values. Where a commercial
 * fact blocks an action (an account still owns open opportunities) the
 * refusal says so without quantifying it.
 *
 * Invariants kept here, each under row locks inside one transaction:
 *   - a salesperson belongs to one or more active sections (section
 *     memberships, CR5) and reports to the lead of each; a lead's sections are
 *     the sections that name them as lead (CR4);
 *   - every active section has exactly one active lead. The database enforces
 *     it too (migration 0008); these checks give the readable refusal;
 *   - owner/section consistency: nobody leaves a section, or a role, while
 *     they own opportunities there, so no record is left with an ineligible
 *     owner (BR-051 as amended by CR5);
 *   - a section's lead is replaced, never just removed (BR-052);
 *   - a section with open opportunities or active members stays active;
 *   - the last active administrator stays an active administrator;
 *   - no account changes its own role or deactivates itself;
 *   - a role change or a lost section bumps the session version, revoking
 *     live sessions on their next request (SEC-005). Scope is read fresh on
 *     every request in any case, so a gained section needs no sign-out.
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
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
import { accountTokens, auditEvents, emailDeliveries, opportunities, sectionMemberships, sections, users } from '../db/schema.js';
import { conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canAdministerAccounts } from '../policy/scope.js';
import { issueAccountLink, revokeAccountLinks, type AccountTokenPurpose } from './accountTokens.js';
import { diffRecords, recordAuditEvent } from './audit.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { isEmailDeliveryOn, queueEmail, suppressQueuedAccountEmails } from './email.js';
import { presentChanges } from './opportunities.js';

function assertAdministrator(actor: Actor): void {
  // Routes already require it; services refuse independently.
  if (!canAdministerAccounts(actor)) throw forbidden('Account administration is limited to the System Administrator.');
}

const blocked = (message: string) => conflict(message, 'conflict');

const LEAD_SECTIONS_ARE_APPOINTED =
  'A section lead’s sections are the ones they are appointed to lead. Create the section with them as lead, or use Replace lead.';
const NO_SECTIONS_HERE = 'Management and administrator accounts have no section or reporting line.';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const manager = alias(users, 'manager');

/**
 * A salesperson's open memberships (any section state, so an administrator can
 * see a membership in a section that was later deactivated), or the active
 * sections a lead leads. The users columns are written out in full: in a
 * single-table select Drizzle would render a bare "id", which this subquery
 * would bind to the section's own id.
 */
const accountSections = sql<{ id: string; name: string; active: boolean }[]>`coalesce((
  SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'active', s.active) ORDER BY s.name, s.id)
    FROM ${sections} s
   WHERE ("users"."role" = 'lead' AND s.lead_user_id = "users"."id" AND s.active)
      OR ("users"."role" = 'sales' AND EXISTS (
            SELECT 1 FROM ${sectionMemberships} m
             WHERE m.user_id = "users"."id" AND m.section_id = s.id AND m.ended_at IS NULL))
), '[]'::json)`;

/**
 * The latest invitation or reset email for the account (CR1), for the user
 * table. Status only, never content.
 */
const accountEmailJson = sql<AdminUserDto['accountEmail']>`(
  SELECT json_build_object(
           'purpose', d.template_key, 'status', d.status, 'statusDetail', d.status_detail,
           'at', to_char(coalesce(d.sent_at, d.updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    FROM ${emailDeliveries} d
   WHERE d.recipient_user_id = "users"."id" AND d.template_key IN ('invitation', 'password_reset')
   ORDER BY d.created_at DESC, d.id DESC
   LIMIT 1)`;

/** Built per query: "is a link still active" depends on the current time. */
const userSelection = () => ({
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  role: users.role,
  sections: accountSections,
  managerId: users.managerId,
  managerName: manager.fullName,
  active: users.active,
  passwordHash: users.passwordHash,
  accountEmail: accountEmailJson,
  // A usable link exists: unused and not yet expired (never the link itself).
  linkActive: sql<boolean>`EXISTS (
    SELECT 1 FROM ${accountTokens} t
     WHERE t.user_id = "users"."id" AND t.used_at IS NULL AND t.expires_at > ${now().toISOString()}::timestamptz)`,
  version: users.version,
});

function userQuery(db: Database) {
  return db.select(userSelection()).from(users).leftJoin(manager, eq(manager.id, users.managerId));
}

type UserRow = Awaited<ReturnType<ReturnType<typeof userQuery>['execute']>>[number];

/** The hash is read only to answer "invitation pending"; it never leaves this function. */
function toAdminUser(row: UserRow): AdminUserDto {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    sections: row.sections,
    managerId: row.managerId,
    managerName: row.managerName ?? null,
    active: row.active,
    invitationPending: row.passwordHash === null,
    linkActive: row.linkActive,
    accountEmail: row.accountEmail ?? null,
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
      activeMembers: sql<number>`(
        SELECT count(*)::int FROM ${sectionMemberships} m JOIN ${users} mu ON mu.id = m.user_id
         WHERE m.section_id = ${sections.id} AND m.ended_at IS NULL AND mu.active)`,
    })
    .from(sections)
    .leftJoin(lead, and(eq(lead.id, sections.leadUserId), eq(lead.active, true)))
    .orderBy(asc(sections.name));
  // An inactive section keeps its former lead's pointer as history; it grants
  // nothing (scope reads active sections only), so it is not shown as a lead.
  return rows.map((row) => ({
    ...row,
    leadId: row.active ? (row.leadId ?? null) : null,
    leadName: row.active ? (row.leadName ?? null) : null,
  }));
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

/**
 * Locks the chosen sections, in id order, and requires each to exist and be
 * active. Locking serialises a membership change with a concurrent section
 * deactivation, which locks the same row.
 */
async function lockActiveSections(tx: Database, sectionIds: readonly string[], field = 'sectionIds'): Promise<void> {
  if (sectionIds.length === 0) return;
  const rows = await tx
    .select({ id: sections.id, active: sections.active })
    .from(sections)
    .where(inArray(sections.id, [...sectionIds]))
    .orderBy(asc(sections.id))
    .for('update');
  if (rows.length !== sectionIds.length || rows.some((row) => !row.active)) {
    throw validationFailed({ [field]: 'Choose active sections only.' });
  }
}

/** Open memberships, locked. */
async function openMemberships(tx: Database, userId: string) {
  return tx
    .select({ id: sectionMemberships.id, sectionId: sectionMemberships.sectionId })
    .from(sectionMemberships)
    .where(and(eq(sectionMemberships.userId, userId), isNull(sectionMemberships.endedAt)))
    .orderBy(asc(sectionMemberships.sectionId))
    .for('update');
}

/** Active sections the account leads, locked. */
async function ledActiveSections(tx: Database, userId: string) {
  return tx
    .select({ id: sections.id, name: sections.name })
    .from(sections)
    .where(and(eq(sections.leadUserId, userId), eq(sections.active, true)))
    .orderBy(asc(sections.id))
    .for('update');
}

/**
 * Whether the person owns any opportunity, open or closed, outside `sections`
 * (BR-051 as amended by CR5: an owner must work in their record's section).
 * Transfers lock the new owner's row, which the caller already holds, so this
 * sees every committed transfer.
 */
async function ownsOutside(tx: Database, userId: string, sectionIds: readonly string[]): Promise<boolean> {
  const [row] = await tx
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.ownerId, userId),
        sectionIds.length > 0 ? notInArray(opportunities.sectionId, [...sectionIds]) : undefined,
      ),
    )
    .limit(1);
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

/**
 * Brings a salesperson's open memberships to `desired`, ending (never
 * deleting) the ones left and opening the new ones. Each change is its own
 * audit event, so the history names the section. Returns whether any
 * membership ended.
 */
async function applyMemberships(
  tx: Database,
  userId: string,
  desired: readonly string[],
  context: { actor: Actor; requestId: string; reason?: string | null | undefined },
): Promise<{ joined: number; left: number }> {
  const current = await openMemberships(tx, userId);
  const leaving = current.filter((row) => !desired.includes(row.sectionId));
  const joining = desired.filter((id) => !current.some((row) => row.sectionId === id));
  const timestamp = now();

  for (const row of leaving) {
    await tx
      .update(sectionMemberships)
      .set({ endedAt: timestamp, endedBy: context.actor.id, endReason: context.reason ?? null })
      .where(eq(sectionMemberships.id, row.id));
    await audit(tx, context.actor, {
      entityType: 'user',
      entityId: userId,
      action: 'account.section_left',
      before: { sectionId: row.sectionId },
      after: null,
      reason: context.reason,
      requestId: context.requestId,
    });
  }
  for (const sectionId of [...joining].sort()) {
    await tx.insert(sectionMemberships).values({ userId, sectionId, startedAt: timestamp, startedBy: context.actor.id });
    await audit(tx, context.actor, {
      entityType: 'user',
      entityId: userId,
      action: 'account.section_joined',
      before: null,
      after: { sectionId },
      reason: context.reason,
      requestId: context.requestId,
    });
  }
  return { joined: joining.length, left: leaving.length };
}

/**
 * The first step of every account or section change (ADR 0004): lock the
 * active administrator rows in id order, then confirm the actor is still one
 * of them. The session check ran before these locks; a demotion or
 * deactivation that committed while this transaction waited must still stop
 * the change.
 */
export async function beginAdministrativeChange(tx: Database, actor: Actor): Promise<string[]> {
  const activeAdmins = await lockAdministrators(tx);
  if (!activeAdmins.includes(actor.id)) throw forbidden('Your account is no longer an active administrator.');
  return activeAdmins;
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

/** Rejects section and reporting-line fields a role cannot carry. */
function assertFieldsFitRole(role: UserRole, sectionIds: readonly string[] | undefined, managerId: string | null | undefined) {
  if (role === 'sales') {
    if (managerId) throw validationFailed({ managerId: 'Salespeople report to the lead of each of their sections.' });
    return;
  }
  if (role === 'lead') {
    if (sectionIds && sectionIds.length > 0) throw validationFailed({ sectionIds: LEAD_SECTIONS_ARE_APPOINTED });
    return;
  }
  if ((sectionIds && sectionIds.length > 0) || managerId) throw validationFailed({ sectionIds: NO_SECTIONS_HERE });
}

// ---------------------------------------------------------------------------
// Invitation and reset links (SEC-030, CR1)
// ---------------------------------------------------------------------------

/** What the route knows about this deployment's email. */
export interface LinkDeliveryContext {
  appOrigin: string;
  /** This deployment may send email (EMAIL_TRANSPORT is not `none`). */
  emailAvailable: boolean;
}

const EMAIL_OFF =
  'Email delivery is turned off, so the link cannot be emailed. Copy the link instead, or turn email on under Email delivery.';

/**
 * Delivers an invitation or reset link, inside the caller's transaction.
 *
 *   email   while email delivery is on (the default then): an email is queued
 *           and the link is created only when it is sent, so neither the
 *           administrator nor the database ever holds a readable link.
 *   manual  the link is shown once, to deliver by hand (D-CR1-1). Any account
 *           email still queued for the person is cancelled: sending it would
 *           issue a newer link and silently void this one.
 */
async function deliverAccountLink(
  tx: Database,
  context: LinkDeliveryContext & { actor: Actor; requestId: string },
  userId: string,
  purpose: AccountTokenPurpose,
  requested: 'email' | 'manual' | undefined,
): Promise<AccountLinkDto> {
  const { actor, requestId } = context;
  const emailOn = context.emailAvailable && (await isEmailDeliveryOn(tx));
  const delivery = requested ?? (emailOn ? 'email' : 'manual');

  if (delivery === 'email') {
    if (!emailOn) throw blocked(EMAIL_OFF);
    const queued = await queueEmail(tx, {
      templateKey: purpose,
      recipientUserId: userId,
      dedupeKey: `${purpose}:${userId}:${requestId}`,
      createdBy: actor.id,
    });
    if (!queued) throw blocked(EMAIL_OFF);
    await audit(tx, actor, {
      entityType: 'user',
      entityId: userId,
      action: purpose === 'invitation' ? 'account.invitation_queued' : 'account.reset_queued',
      after: { delivery: 'email' },
      requestId,
    });
    return { purpose, delivery: 'email', url: null, expiresAt: null };
  }

  await suppressQueuedAccountEmails(tx, userId, 'Replaced by a link an administrator copied instead.');
  const issued = await issueAccountLink(tx, { userId, purpose, createdBy: actor.id, appOrigin: context.appOrigin });
  await audit(tx, actor, {
    entityType: 'user',
    entityId: userId,
    action: purpose === 'invitation' ? 'account.invitation_issued' : 'account.reset_issued',
    after: { expiresAt: issued.expiresAt },
    requestId,
  });
  return { ...issued, delivery: 'manual' };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function createUser(options: {
  db: Database;
  actor: Actor;
  command: z.output<typeof createUserSchema>;
  requestId: string;
  links: LinkDeliveryContext;
  completeClaim: CompleteClaimInTransaction;
}): Promise<CreateUserResultDto> {
  const { db, actor, command, requestId, links, completeClaim } = options;
  assertAdministrator(actor);

  const { userId, link } = await db.transaction(async (tx) => {
    await beginAdministrativeChange(tx, actor);
    await assertEmailFree(tx, command.email);
    assertFieldsFitRole(command.role, command.sectionIds, command.managerId);

    const sectionIds = command.role === 'sales' ? [...(command.sectionIds ?? [])].sort() : [];
    if (command.role === 'sales' && sectionIds.length === 0) {
      throw validationFailed({ sectionIds: 'Choose at least one section for a salesperson.' });
    }
    await lockActiveSections(tx, sectionIds);
    const managerId = command.role === 'lead' ? await assertLeadManager(tx, command.managerId) : null;

    const timestamp = now();
    const [created] = await tx
      .insert(users)
      .values({
        fullName: command.fullName,
        email: command.email,
        passwordHash: null,
        role: command.role,
        managerId,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: users.id });
    if (!created) throw new Error('User insert returned no row.');

    await audit(tx, actor, {
      entityType: 'user',
      entityId: created.id,
      action: 'account.created',
      after: { fullName: command.fullName, email: command.email, role: command.role, managerId },
      requestId,
    });
    await applyMemberships(tx, created.id, sectionIds, { actor, requestId });

    const link = await deliverAccountLink(tx, { ...links, actor, requestId }, created.id, 'invitation', undefined);

    await completeClaim(tx, created.id);
    return { userId: created.id, link };
  });

  return {
    user: await readUser(db, userId),
    delivery: link.delivery,
    link: link.delivery === 'manual' ? link : null,
  };
}

/** A replayed create: the account, but never the link a second time. */
export async function getCreatedUser(db: Database, actor: Actor, userId: string): Promise<CreateUserResultDto> {
  assertAdministrator(actor);
  const user = await readUser(db, userId);
  return { user, delivery: user.accountEmail?.purpose === 'invitation' ? 'email' : 'manual', link: null };
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
    const activeAdmins = await beginAdministrativeChange(tx, actor);
    const target = await lockUser(tx, userId);
    if (target.version !== command.version) throw versionConflict();

    const role = command.role ?? target.role;
    const roleChanged = role !== target.role;
    if (roleChanged && target.id === actor.id) {
      throw forbidden('You cannot change your own role. Another administrator must do it.');
    }
    assertFieldsFitRole(role, command.sectionIds, command.managerId);

    // The sections the person will work in afterwards.
    const memberships = await openMemberships(tx, target.id);
    let desiredSections: string[] = [];
    if (role === 'sales') {
      desiredSections = [
        ...(command.sectionIds ?? (target.role === 'sales' ? memberships.map((row) => row.sectionId) : [])),
      ].sort();
      if (desiredSections.length === 0) throw validationFailed({ sectionIds: 'Choose at least one section for a salesperson.' });
      const added = desiredSections.filter((id) => !memberships.some((row) => row.sectionId === id));
      await lockActiveSections(tx, added);
    }
    const led = target.role === 'lead' ? await ledActiveSections(tx, target.id) : [];
    if (roleChanged && led.length > 0) {
      throw blocked('This person leads an active section. Use Replace lead to appoint a successor for each of their sections first.');
    }
    const worksIn = role === 'sales' ? desiredSections : role === 'lead' ? led.map((row) => row.id) : [];
    const membershipsChange =
      role === 'sales'
        ? desiredSections.join() !== memberships.map((row) => row.sectionId).join()
        : memberships.length > 0;

    if ((roleChanged || membershipsChange) && (await ownsOutside(tx, target.id, worksIn))) {
      throw blocked(
        'This person still owns opportunities in a section they would no longer work in. Management or the section lead must transfer them first.',
      );
    }
    if (roleChanged && target.role === 'admin') assertNotLastAdministrator(activeAdmins, target.id);

    const changes: Record<string, unknown> = {};
    if (command.fullName !== undefined) changes.fullName = command.fullName;
    if (command.email !== undefined && command.email !== target.email) {
      await assertEmailFree(tx, command.email, target.id);
      changes.email = command.email;
    }
    if (roleChanged) changes.role = role;
    const managerId =
      role === 'lead'
        ? command.managerId !== undefined
          ? await assertLeadManager(tx, command.managerId)
          : roleChanged
            ? null
            : target.managerId
        : null;
    if (managerId !== target.managerId) changes.managerId = managerId;

    const diff = diffRecords(target as unknown as Record<string, unknown>, changes);
    if (diff.changed.length === 0 && !membershipsChange) return;

    const moved = await applyMemberships(tx, target.id, role === 'sales' ? desiredSections : [], {
      actor,
      requestId,
      reason: command.reason,
    });
    // SEC-005: a role change or a lost section ends live sessions.
    const material = roleChanged || moved.left > 0;

    const updated = await tx
      .update(users)
      .set({
        ...changes,
        updatedAt: now(),
        version: sql`${users.version} + 1`,
        ...(material ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
      })
      .where(and(eq(users.id, target.id), eq(users.version, command.version)))
      .returning({ id: users.id });
    if (updated.length === 0) throw versionConflict();

    if (diff.changed.length > 0) {
      await audit(tx, actor, {
        entityType: 'user',
        entityId: target.id,
        // Privileged role changes are audited as their own event (BR-052).
        action: roleChanged ? 'account.role_changed' : 'account.updated',
        before: diff.before,
        after: diff.after,
        reason: command.reason,
        requestId,
      });
    }
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
    const activeAdmins = await beginAdministrativeChange(tx, actor);
    const target = await lockUser(tx, userId);
    if (target.version !== command.version) throw versionConflict();
    if (target.id === actor.id) throw forbidden('You cannot deactivate your own account.');
    if (!target.active) throw blocked('This account is already inactive.');

    if (target.role === 'admin') assertNotLastAdministrator(activeAdmins, target.id);
    if (target.role === 'lead' && (await ledActiveSections(tx, target.id)).length > 0) {
      throw blocked('This person is the lead of an active section. Use Replace lead for each of their sections first (BR-052).');
    }
    // BR-051. The opportunity check sees every committed transfer: transfers
    // lock the new owner's row, which this transaction already holds.
    if (await ownsOpenOpportunity(tx, target.id)) {
      throw blocked(
        'This person owns opportunities that are still open. Management or the section lead must transfer them before the account is deactivated.',
      );
    }

    // Memberships stay open: they keep historical owner-section pairs valid,
    // and an inactive account sees nothing whatever its memberships.
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
    await beginAdministrativeChange(tx, actor);
    const target = await lockUser(tx, userId);
    if (target.version !== command.version) throw versionConflict();
    if (target.active) throw blocked('This account is already active.');

    if (target.role === 'sales') {
      const memberships = await openMemberships(tx, target.id);
      const [inActiveSection] = memberships.length
        ? await tx
            .select({ id: sections.id })
            .from(sections)
            .where(and(inArray(sections.id, memberships.map((row) => row.sectionId)), eq(sections.active, true)))
            .limit(1)
        : [];
      if (!inActiveSection) {
        throw blocked('This salesperson belongs to no active section. Edit the account to choose a section, then reactivate it.');
      }
    }

    await tx
      .update(users)
      .set({ active: true, updatedAt: now(), version: sql`${users.version} + 1` })
      .where(eq(users.id, target.id));

    await audit(tx, actor, {
      entityType: 'user',
      entityId: target.id,
      action: 'account.reactivated',
      before: { active: false },
      after: { active: true },
      reason: command.reason,
      requestId,
    });
  });

  return readUser(db, userId);
}

/**
 * A fresh single-use link: an invitation if no password was ever set,
 * otherwise a reset. Emailed while email delivery is on, unless the
 * administrator asks to copy it (CR1, D-CR1-1).
 */
export async function issueUserLink(options: {
  db: Database;
  actor: Actor;
  userId: string;
  delivery: 'email' | 'manual' | undefined;
  requestId: string;
  links: LinkDeliveryContext;
}): Promise<AccountLinkDto> {
  const { db, actor, userId, delivery, requestId, links } = options;
  assertAdministrator(actor);

  return db.transaction(async (tx) => {
    await beginAdministrativeChange(tx, actor);
    const target = await lockUser(tx, userId);
    if (!target.active) throw blocked('Reactivate the account before issuing a sign-in link.');
    const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
    const purpose: AccountTokenPurpose = row?.passwordHash ? 'password_reset' : 'invitation';
    return deliverAccountLink(tx, { ...links, actor, requestId }, userId, purpose, delivery);
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

/** An existing, active account with the lead role, locked. */
async function lockExistingLead(tx: Database, userId: string, field: string) {
  const [row] = await tx
    .select({ id: users.id, role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);
  if (!row || !row.active || row.role !== 'lead') {
    throw validationFailed({ [field]: 'Choose an active section lead. To promote a salesperson, use Replace lead on one of their sections.' });
  }
  return row;
}

/** CR4: a section is created with its lead, an existing section lead who may already lead others. */
export async function createSection(options: {
  db: Database;
  actor: Actor;
  name: string;
  leadId: string;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<AdminSectionDto> {
  const { db, actor, name, leadId, requestId, completeClaim } = options;
  assertAdministrator(actor);
  const id = await db.transaction(async (tx) => {
    await beginAdministrativeChange(tx, actor);
    await assertSectionNameFree(tx, name);
    await lockExistingLead(tx, leadId, 'leadId');
    const timestamp = now();
    const [created] = await tx
      .insert(sections)
      .values({ name, leadUserId: leadId, active: true, createdAt: timestamp, updatedAt: timestamp })
      .returning({ id: sections.id });
    if (!created) throw new Error('Section insert returned no row.');
    await audit(tx, actor, {
      entityType: 'section',
      entityId: created.id,
      action: 'section.created',
      after: { name, leadUserId: leadId },
      requestId,
    });
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
    await beginAdministrativeChange(tx, actor);
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
 * BR-052 / CR4: appoints the section's lead in one transaction.
 *
 * The candidate is either an existing lead, who gains this section, or a
 * salesperson member of it, who is promoted: their memberships end, so they
 * must own nothing outside this section. The outgoing lead keeps any other
 * section they lead; if this was their only one they become a salesperson
 * member of it (D-CR4-4), so anything they own here stays validly owned. An
 * outgoing lead who keeps other sections must own nothing here.
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
    await beginAdministrativeChange(tx, actor);
    const section = await lockSection(tx, sectionId);
    if (section.version !== command.version) throw versionConflict();
    if (!section.active) throw blocked('Reactivate the section before appointing its lead.');
    if (section.leadUserId === command.newLeadId) throw blocked('This person already leads the section.');

    const candidate = await lockUser(tx, command.newLeadId);
    const candidateMemberships = candidate.role === 'sales' ? await openMemberships(tx, candidate.id) : [];
    const promoting = candidate.role === 'sales' && candidateMemberships.some((row) => row.sectionId === sectionId);
    if (!candidate.active || !(candidate.role === 'lead' || promoting)) {
      throw validationFailed({ newLeadId: 'Choose an active section lead, or an active salesperson in this section.' });
    }

    const previous = section.leadUserId ? await lockUser(tx, section.leadUserId) : null;
    const timestamp = now();
    const context = { actor, requestId, reason: command.reason };

    if (promoting) {
      if (await ownsOutside(tx, candidate.id, [sectionId])) {
        throw blocked(
          'This salesperson owns opportunities in another section. Transfer them before appointing them lead, because a lead works only in the sections they lead.',
        );
      }
      await applyMemberships(tx, candidate.id, [], context);
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
    }

    if (previous) {
      const othersLed = (await ledActiveSections(tx, previous.id)).filter((row) => row.id !== sectionId);
      if (othersLed.length === 0 && previous.active) {
        // Their only section: they stay in it, as a salesperson.
        await tx
          .update(users)
          .set({
            role: 'sales',
            managerId: null,
            sessionVersion: sql`${users.sessionVersion} + 1`,
            updatedAt: timestamp,
            version: sql`${users.version} + 1`,
          })
          .where(eq(users.id, previous.id));
        await audit(tx, actor, {
          entityType: 'user',
          entityId: previous.id,
          action: 'account.role_changed',
          before: { role: 'lead', managerId: previous.managerId },
          after: { role: 'sales', managerId: null },
          reason: command.reason,
          requestId,
        });
        await applyMemberships(tx, previous.id, [sectionId], context);
      } else if (await ownsOutside(tx, previous.id, othersLed.map((row) => row.id))) {
        throw blocked(
          'The current lead owns opportunities in this section and leads other sections. Transfer those records before replacing them here.',
        );
      }
    }

    await tx
      .update(sections)
      .set({ leadUserId: candidate.id, updatedAt: timestamp, version: sql`${sections.version} + 1` })
      .where(eq(sections.id, sectionId));
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
  command: { version: number; reason?: string | undefined; leadId?: string | undefined };
  requestId: string;
}): Promise<AdminSectionDto> {
  const { db, actor, sectionId, active, command, requestId } = options;
  assertAdministrator(actor);

  await db.transaction(async (tx) => {
    await beginAdministrativeChange(tx, actor);
    const section = await lockSection(tx, sectionId);
    if (section.version !== command.version) throw versionConflict();
    if (section.active === active) throw blocked(`This section is already ${active ? 'active' : 'inactive'}.`);

    const changes: Record<string, unknown> = { active };
    if (!active) {
      if (command.leadId) throw validationFailed({ leadId: 'A lead is chosen only when reactivating a section.' });
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
        .select({ id: sectionMemberships.id })
        .from(sectionMemberships)
        .innerJoin(users, eq(users.id, sectionMemberships.userId))
        .where(and(eq(sectionMemberships.sectionId, sectionId), isNull(sectionMemberships.endedAt), eq(users.active, true)))
        .limit(1);
      if (member) throw blocked('This section still has active members. Move or deactivate them first.');
      // The lead pointer stays as history. An inactive section grants its
      // former lead nothing (scope reads active sections only).
    } else {
      // CR4: an active section has a lead. The former lead resumes unless
      // another is named; either way it must be an active lead account now.
      const leadId = command.leadId ?? section.leadUserId;
      if (!leadId) throw validationFailed({ leadId: 'Choose the section’s lead.' });
      await lockExistingLead(tx, leadId, 'leadId');
      if (leadId !== section.leadUserId) changes.leadUserId = leadId;
    }

    await tx
      .update(sections)
      .set({ ...changes, updatedAt: now(), version: sql`${sections.version} + 1` })
      .where(eq(sections.id, sectionId));
    await audit(tx, actor, {
      entityType: 'section',
      entityId: sectionId,
      action: active ? 'section.reactivated' : 'section.deactivated',
      before: { active: !active, ...('leadUserId' in changes ? { leadUserId: section.leadUserId } : {}) },
      after: changes,
      reason: command.reason,
      requestId,
    });
  });

  return getSection(db, actor, sectionId);
}

// ---------------------------------------------------------------------------
// Administrative audit (SEC-012)
// ---------------------------------------------------------------------------

/** What an email configuration event is about, for the audit list (CR2). */
function configurationSubject(row: { entityType: string; afterData: unknown }): string | null {
  const after = (row.afterData ?? {}) as Record<string, unknown>;
  if (row.entityType === 'email_template' && typeof after.template === 'string') return after.template;
  if (row.entityType === 'email_settings') return 'Mail server';
  if (row.entityType === 'email_delivery' && typeof after.recipientAddress === 'string') return after.recipientAddress;
  return null;
}

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
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.sequence))
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
      subject: subjects.get(row.entityId) ?? configurationSubject(row) ?? null,
      occurredAt: row.occurredAt.toISOString(),
      reason: row.reason,
      changes: changes[index] ?? [],
    })),
    total: total?.value ?? 0,
    page,
    pageSize,
  };
}
