/**
 * The shared organization directory (FR-030, FR-031, FR-033).
 *
 * Every sales role reads and maintains basic organization information. The
 * directory holds no private contact details and no project commentary. The
 * only commercial figure shown — how many opportunities an organization has —
 * is computed through the caller's own scope predicate, so it counts what the
 * caller may see and nothing else.
 */
import { and, asc, count, eq, ilike, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { OrganizationDetailDto, OrganizationListItemDto, Paginated } from '../../shared/api.js';
import type {
  createOrganizationSchema,
  listDirectoryQuerySchema,
  updateOrganizationSchema,
} from '../../shared/validation.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { opportunities, organizations } from '../db/schema.js';
import { ApiError, conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canArchiveDirectory, canEditDirectory, opportunityScope } from '../policy/scope.js';
import { diffRecords, recordAuditEvent } from './audit.js';
import type { CompleteClaimInTransaction } from './idempotency.js';

const parent = alias(organizations, 'parent');

/** Opportunities at this organization that the actor may see — never the total. */
function accessibleCount(actor: Actor) {
  return sql<number>`(
    SELECT count(*)::int FROM ${opportunities}
    WHERE ${opportunities.organizationId} = ${organizations.id} AND ${opportunityScope(actor)}
  )`;
}

const selection = (actor: Actor) => ({
  id: organizations.id,
  name: organizations.name,
  type: organizations.type,
  parentId: organizations.parentId,
  parentName: parent.name,
  location: organizations.location,
  website: organizations.website,
  archivedAt: organizations.archivedAt,
  basicNotes: organizations.basicNotes,
  version: organizations.version,
  accessibleOpportunities: accessibleCount(actor),
});

function toListItem(row: {
  id: string;
  name: string;
  type: OrganizationListItemDto['type'];
  parentId: string | null;
  parentName: string | null;
  location: string | null;
  website: string | null;
  archivedAt: Date | null;
  accessibleOpportunities: number;
}): OrganizationListItemDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    parentId: row.parentId,
    parentName: row.parentName ?? null,
    location: row.location,
    website: row.website,
    archived: row.archivedAt !== null,
    accessibleOpportunities: row.accessibleOpportunities,
  };
}

export async function listDirectory(
  db: Database,
  actor: Actor,
  query: z.output<typeof listDirectoryQuerySchema>,
): Promise<Paginated<OrganizationListItemDto>> {
  const filters: (SQL | undefined)[] = [];
  if (query.includeArchived !== 'true') filters.push(isNull(organizations.archivedAt));
  if (query.q) {
    // Parameterised and Unicode-safe: Bangla names match by substring.
    const term = `%${query.q}%`;
    filters.push(or(ilike(organizations.name, term), ilike(organizations.location, term)));
  }
  if (query.type) filters.push(eq(organizations.type, query.type));
  const where = and(...filters);

  const [total] = await db.select({ value: count() }).from(organizations).where(where);
  const rows = await db
    .select(selection(actor))
    .from(organizations)
    .leftJoin(parent, eq(parent.id, organizations.parentId))
    .where(where)
    .orderBy(asc(organizations.name))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return { items: rows.map(toListItem), total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getOrganization(db: Database, actor: Actor, organizationId: string): Promise<OrganizationDetailDto> {
  const [row] = await db
    .select(selection(actor))
    .from(organizations)
    .leftJoin(parent, eq(parent.id, organizations.parentId))
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!row) throw notFound(`organization ${organizationId} not found`);

  const children = await db
    .select({ id: organizations.id, name: organizations.name, archivedAt: organizations.archivedAt })
    .from(organizations)
    .where(eq(organizations.parentId, organizationId))
    .orderBy(asc(organizations.name));

  return {
    ...toListItem(row),
    basicNotes: row.basicNotes,
    version: row.version,
    children: children.map((child) => ({ id: child.id, name: child.name, archived: child.archivedAt !== null })),
    canArchive: canArchiveDirectory(actor) && row.archivedAt === null,
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * FR-033 duplicate-name warning. Names are compared ignoring case, spacing and
 * punctuation, so "Ministry of ICT" and "ministry of  I.C.T." collide.
 */
const normalisedName = (value: SQL | string) =>
  sql`lower(regexp_replace(${value}, '[[:space:][:punct:]]+', '', 'g'))`;

async function assertNotDuplicate(
  tx: Database,
  name: string,
  acknowledged: boolean | undefined,
  exceptId?: string,
): Promise<void> {
  if (acknowledged) return;
  const matches = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(
      and(
        sql`${normalisedName(sql`${organizations.name}`)} = ${normalisedName(name)}`,
        exceptId ? ne(organizations.id, exceptId) : undefined,
      ),
    )
    .limit(5);
  if (matches.length === 0) return;

  const names = matches.map((row) => `“${row.name}”`).join(', ');
  throw new ApiError(409, 'possible_duplicate', `A similar organization already exists: ${names}.`, {
    fieldErrors: { name: `Similar to ${names}. Check it is not the same organization, then confirm to save anyway.` },
  });
}

async function assertValidParent(tx: Database, parentId: string | null | undefined, selfId?: string): Promise<void> {
  if (!parentId) return;
  if (parentId === selfId) throw validationFailed({ parentId: 'An organization cannot be its own parent.' });

  const [row] = await tx
    .select({ id: organizations.id, archivedAt: organizations.archivedAt })
    .from(organizations)
    .where(eq(organizations.id, parentId))
    .limit(1);
  if (!row || row.archivedAt) throw validationFailed({ parentId: 'Choose a current organization as the parent.' });

  if (!selfId) return;
  // FR-030: walk up from the proposed parent; reaching this organization
  // would close a cycle.
  const chain = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE ancestors(id, parent_id, depth) AS (
      SELECT id, parent_id, 1 FROM ${organizations} WHERE id = ${parentId}
      UNION ALL
      SELECT o.id, o.parent_id, a.depth + 1
      FROM ${organizations} o JOIN ancestors a ON o.id = a.parent_id
      WHERE a.depth < 100
    )
    SELECT id FROM ancestors WHERE id = ${selfId}
  `);
  if (chain.rows.length > 0) {
    throw validationFailed({ parentId: 'That parent is already beneath this organization, which would make a cycle.' });
  }
}

/**
 * Parent changes are serialised with one transaction-scoped advisory lock, so
 * two concurrent edits (A under B, B under A) cannot both pass the cycle
 * check. Name-only edits do not take it.
 */
async function lockHierarchy(tx: Database): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('penta:organization-hierarchy'))`);
}

function directoryAudit(
  tx: Database,
  actor: Actor,
  event: { entityId: string; action: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; reason?: string | null; requestId: string },
) {
  // Directory events concern no single opportunity, so they carry none and
  // never appear in an opportunity's commercial history.
  return recordAuditEvent(tx, {
    actorId: actor.id,
    entityType: 'organization',
    entityId: event.entityId,
    action: event.action,
    domain: 'directory',
    before: event.before ?? null,
    after: event.after ?? null,
    reason: event.reason ?? null,
    requestId: event.requestId,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createOrganization(options: {
  db: Database;
  actor: Actor;
  command: z.output<typeof createOrganizationSchema>;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<OrganizationDetailDto> {
  const { db, actor, command, requestId, completeClaim } = options;
  if (!canEditDirectory(actor)) throw forbidden();

  const id = await db.transaction(async (tx) => {
    await assertNotDuplicate(tx, command.name, command.acknowledgeDuplicates);
    if (command.parentId) await assertValidParent(tx, command.parentId);

    const timestamp = now();
    const [created] = await tx
      .insert(organizations)
      .values({
        name: command.name,
        type: command.type,
        parentId: command.parentId ?? null,
        location: command.location ?? null,
        website: command.website ?? null,
        basicNotes: command.basicNotes ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: organizations.id });
    if (!created) throw new Error('Organization insert returned no row.');

    await directoryAudit(tx, actor, {
      entityId: created.id,
      action: 'organization.created',
      after: {
        name: command.name,
        type: command.type,
        parentId: command.parentId ?? null,
        location: command.location ?? null,
        website: command.website ?? null,
      },
      requestId,
    });
    await completeClaim(tx, created.id);
    return created.id;
  });

  return getOrganization(db, actor, id);
}

export async function updateOrganization(options: {
  db: Database;
  actor: Actor;
  organizationId: string;
  command: z.output<typeof updateOrganizationSchema>;
  requestId: string;
}): Promise<OrganizationDetailDto> {
  const { db, actor, organizationId, command, requestId } = options;
  if (!canEditDirectory(actor)) throw forbidden();

  await db.transaction(async (tx) => {
    const parentChanging = command.parentId !== undefined;
    if (parentChanging) await lockHierarchy(tx);

    const [current] = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        type: organizations.type,
        parentId: organizations.parentId,
        location: organizations.location,
        website: organizations.website,
        basicNotes: organizations.basicNotes,
        archivedAt: organizations.archivedAt,
        version: organizations.version,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for('update')
      .limit(1);
    if (!current) throw notFound(`organization ${organizationId} not found`);
    if (current.version !== command.version) throw versionConflict();
    if (current.archivedAt) throw conflict('Archived organizations are read-only.');

    const changes: Record<string, unknown> = {};
    for (const key of ['name', 'type', 'location', 'website', 'basicNotes'] as const) {
      if (command[key] !== undefined) changes[key] = command[key];
    }
    // Optional text fields: an explicit null or empty string clears them.
    for (const key of ['location', 'website', 'basicNotes'] as const) {
      if (key in command && command[key] === undefined) changes[key] = null;
    }
    if (parentChanging) {
      await assertValidParent(tx, command.parentId, organizationId);
      changes.parentId = command.parentId ?? null;
    }
    if (typeof changes.name === 'string' && changes.name !== current.name) {
      await assertNotDuplicate(tx, changes.name, command.acknowledgeDuplicates, organizationId);
    }

    const diff = diffRecords(current as unknown as Record<string, unknown>, changes);
    if (diff.changed.length === 0) return;

    await tx
      .update(organizations)
      .set({ ...changes, updatedAt: now(), version: sql`${organizations.version} + 1` })
      .where(and(eq(organizations.id, organizationId), eq(organizations.version, command.version)));
    await directoryAudit(tx, actor, {
      entityId: organizationId,
      action: 'organization.updated',
      before: diff.before,
      after: diff.after,
      requestId,
    });
  });

  return getOrganization(db, actor, organizationId);
}

/** FR-033: management archives an organization no open opportunity uses. */
export async function archiveOrganization(options: {
  db: Database;
  actor: Actor;
  organizationId: string;
  command: { version: number; reason: string };
  requestId: string;
}): Promise<OrganizationDetailDto> {
  const { db, actor, organizationId, command, requestId } = options;
  if (!canArchiveDirectory(actor)) throw forbidden('Only management can archive an organization.');

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: organizations.id, archivedAt: organizations.archivedAt, version: organizations.version })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for('update')
      .limit(1);
    if (!current) throw notFound(`organization ${organizationId} not found`);
    if (current.version !== command.version) throw versionConflict();
    if (current.archivedAt) throw conflict('This organization is already archived.');

    // This row lock also blocks opportunity creation, which takes a share lock
    // on its organization, so no new record can slip in after this check.
    const [open] = await tx
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.organizationId, organizationId),
          notInArray(opportunities.stage, ['awarded', 'lost']),
          ne(opportunities.status, 'cancelled'),
        ),
      )
      .limit(1);
    if (open) {
      throw conflict('This organization is used by an open opportunity, so it cannot be archived.');
    }

    await tx
      .update(organizations)
      .set({ archivedAt: now(), updatedAt: now(), version: sql`${organizations.version} + 1` })
      .where(eq(organizations.id, organizationId));
    await directoryAudit(tx, actor, {
      entityId: organizationId,
      action: 'organization.archived',
      before: { archived: false },
      after: { archived: true },
      reason: command.reason,
      requestId,
    });
  });

  return getOrganization(db, actor, organizationId);
}
