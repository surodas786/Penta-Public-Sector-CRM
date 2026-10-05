/**
 * Contacts and opportunity-contact links (FR-032, FR-033, BR-020, BR-021,
 * SEC-004).
 *
 * A contact is visible only through a live link to an opportunity the caller
 * can see (`contactScope`). Within a visible contact, the caller receives only
 * the links — and the relationship notes on them — whose opportunities they
 * can see. Inaccessible links are never returned, counted or named.
 *
 * Locking: link writes lock the opportunity row first (the order every
 * opportunity writer uses, so they serialise with transfers); removing a link
 * also locks the contact row, so two people removing a contact's last two
 * links at once cannot leave it with none.
 */
import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type {
  ContactDetailDto,
  ContactLinkDto,
  ContactListItemDto,
  OpportunityContactDto,
  Paginated,
} from '../../shared/api.js';
import type {
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from '../../shared/validation.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { contacts, opportunities, opportunityContacts, organizations, sections, users } from '../db/schema.js';
import { conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canArchiveDirectory, canEditDirectory, contactScope, opportunityScope, scopedWhere } from '../policy/scope.js';
import { diffRecords, recordAuditEvent } from './audit.js';
import { lockOpportunity } from './followUps.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { assertOpportunityVisible } from './opportunities.js';

const absent = (what: string, id: string, actor: Actor) =>
  notFound(`${what} ${id} absent or outside scope for actor ${actor.id}`);

/** Live links whose opportunity the actor can see, for the current contact row. */
const visibleLinkCount = (actor: Actor) => sql<number>`(
  SELECT count(*)::int FROM ${opportunityContacts}
  JOIN ${opportunities} ON ${opportunities.id} = ${opportunityContacts.opportunityId}
  WHERE ${opportunityContacts.contactId} = ${contacts.id}
    AND ${opportunityContacts.removedAt} IS NULL
    AND ${opportunityScope(actor)}
)`;

const contactSelection = (actor: Actor) => ({
  id: contacts.id,
  fullName: contacts.fullName,
  designation: contacts.designation,
  department: contacts.department,
  email: contacts.email,
  phone: contacts.phone,
  organizationId: contacts.organizationId,
  organizationName: organizations.name,
  archivedAt: contacts.archivedAt,
  version: contacts.version,
  accessibleLinks: visibleLinkCount(actor),
});

type ContactRow = {
  id: string;
  fullName: string;
  designation: string;
  department: string | null;
  email: string | null;
  phone: string | null;
  organizationId: string;
  organizationName: string;
  archivedAt: Date | null;
  accessibleLinks: number;
};

function toListItem(row: ContactRow): ContactListItemDto {
  return {
    id: row.id,
    fullName: row.fullName,
    designation: row.designation,
    department: row.department,
    email: row.email,
    phone: row.phone,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    archived: row.archivedAt !== null,
    accessibleLinks: row.accessibleLinks,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listContacts(
  db: Database,
  actor: Actor,
  query: z.output<typeof listContactsQuerySchema>,
): Promise<Paginated<ContactListItemDto>> {
  const filters: (SQL | undefined)[] = [contactScope(actor), isNull(contacts.archivedAt)];
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(
        ilike(contacts.fullName, term),
        ilike(contacts.designation, term),
        ilike(contacts.department, term),
        ilike(contacts.email, term),
      ),
    );
  }
  if (query.organizationId) filters.push(eq(contacts.organizationId, query.organizationId));
  const where = and(...filters);

  const [total] = await db.select({ value: count() }).from(contacts).where(where);
  const rows = await db
    .select(contactSelection(actor))
    .from(contacts)
    .innerJoin(organizations, eq(organizations.id, contacts.organizationId))
    .where(where)
    .orderBy(asc(contacts.fullName))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return { items: rows.map(toListItem), total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getContact(db: Database, actor: Actor, contactId: string): Promise<ContactDetailDto> {
  const [row] = await db
    .select(contactSelection(actor))
    .from(contacts)
    .innerJoin(organizations, eq(organizations.id, contacts.organizationId))
    .where(and(contactScope(actor), eq(contacts.id, contactId)))
    .limit(1);
  if (!row) throw absent('contact', contactId, actor);

  const owner = alias(users, 'owner');
  const creator = alias(users, 'link_creator');
  const linkRows = await db
    .select({
      linkId: opportunityContacts.id,
      relationshipNotes: opportunityContacts.relationshipNotes,
      createdAt: opportunityContacts.createdAt,
      version: opportunityContacts.version,
      createdByName: creator.fullName,
      opportunityId: opportunities.id,
      reference: opportunities.reference,
      name: opportunities.name,
      stage: opportunities.stage,
      status: opportunities.status,
      ownerName: owner.fullName,
      sectionName: sections.name,
    })
    .from(opportunityContacts)
    .innerJoin(opportunities, eq(opportunities.id, opportunityContacts.opportunityId))
    .innerJoin(owner, eq(owner.id, opportunities.ownerId))
    .innerJoin(sections, eq(sections.id, opportunities.sectionId))
    .innerJoin(creator, eq(creator.id, opportunityContacts.createdBy))
    // SEC-004: only links on opportunities the actor can see.
    .where(scopedWhere(actor, eq(opportunityContacts.contactId, contactId), isNull(opportunityContacts.removedAt)))
    .orderBy(asc(opportunities.name));

  const links: ContactLinkDto[] = linkRows.map((link) => ({
    linkId: link.linkId,
    relationshipNotes: link.relationshipNotes,
    createdByName: link.createdByName,
    createdAt: link.createdAt.toISOString(),
    version: link.version,
    opportunity: {
      id: link.opportunityId,
      reference: link.reference,
      name: link.name,
      stage: link.stage,
      status: link.status,
      ownerName: link.ownerName,
      sectionName: link.sectionName,
    },
  }));

  return {
    ...toListItem(row),
    version: row.version,
    links,
    canEditIdentity: row.archivedAt === null && (await seesEveryLink(db, actor, contactId)),
    canArchive: canArchiveDirectory(actor) && row.archivedAt === null,
  };
}

/**
 * BR-021: whether every live link's opportunity is visible to the actor.
 * Management always is. The answer is a single yes or no; how many links the
 * actor cannot see is never disclosed.
 */
async function seesEveryLink(db: Database, actor: Actor, contactId: string): Promise<boolean> {
  if (actor.role === 'management') return true;
  const [hidden] = await db
    .select({ value: count() })
    .from(opportunityContacts)
    .innerJoin(opportunities, eq(opportunities.id, opportunityContacts.opportunityId))
    .where(
      and(
        eq(opportunityContacts.contactId, contactId),
        isNull(opportunityContacts.removedAt),
        sql`NOT (${opportunityScope(actor)})`,
      ),
    );
  return (hidden?.value ?? 0) === 0;
}

/** One opportunity's Contacts tab: its live links, with that link's notes. */
export async function listOpportunityContacts(
  db: Database,
  actor: Actor,
  opportunityId: string,
): Promise<OpportunityContactDto[]> {
  await assertOpportunityVisible(db, actor, opportunityId);
  const rows = await db
    .select({
      linkId: opportunityContacts.id,
      relationshipNotes: opportunityContacts.relationshipNotes,
      version: opportunityContacts.version,
      id: contacts.id,
      fullName: contacts.fullName,
      designation: contacts.designation,
      department: contacts.department,
      email: contacts.email,
      phone: contacts.phone,
      organizationName: organizations.name,
      archivedAt: contacts.archivedAt,
    })
    .from(opportunityContacts)
    .innerJoin(contacts, eq(contacts.id, opportunityContacts.contactId))
    .innerJoin(organizations, eq(organizations.id, contacts.organizationId))
    .where(and(eq(opportunityContacts.opportunityId, opportunityId), isNull(opportunityContacts.removedAt)))
    .orderBy(asc(contacts.fullName));

  return rows.map((row) => ({
    linkId: row.linkId,
    relationshipNotes: row.relationshipNotes,
    version: row.version,
    contact: {
      id: row.id,
      fullName: row.fullName,
      designation: row.designation,
      department: row.department,
      email: row.email,
      phone: row.phone,
      organizationName: row.organizationName,
      archived: row.archivedAt !== null,
    },
  }));
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

async function assertCurrentOrganization(tx: Database, organizationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.archivedAt)))
    .for('share')
    .limit(1);
  if (!row) throw validationFailed({ organizationId: 'Choose a current organization.' });
}

function audit(
  tx: Database,
  actor: Actor,
  event: {
    domain: 'commercial' | 'directory';
    opportunityId?: string | null;
    entityType: 'contact' | 'contact_link';
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
    opportunityId: event.opportunityId ?? null,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    domain: event.domain,
    before: event.before ?? null,
    after: event.after ?? null,
    reason: event.reason ?? null,
    requestId: event.requestId,
  });
}

async function insertLink(
  tx: Database,
  actor: Actor,
  options: { opportunityId: string; contactId: string; fullName: string; relationshipNotes?: string | undefined; requestId: string },
): Promise<string> {
  const timestamp = now();
  // The partial unique index decides duplicates, including concurrent ones.
  const inserted = await tx
    .insert(opportunityContacts)
    .values({
      opportunityId: options.opportunityId,
      contactId: options.contactId,
      relationshipNotes: options.relationshipNotes ?? null,
      createdBy: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .returning({ id: opportunityContacts.id });
  const link = inserted[0];
  if (!link) throw conflict('This contact is already linked to the opportunity.');

  await audit(tx, actor, {
    domain: 'commercial',
    opportunityId: options.opportunityId,
    entityType: 'contact_link',
    entityId: link.id,
    action: 'contact.linked',
    after: { about: options.fullName, contactId: options.contactId, relationshipNotes: options.relationshipNotes ?? null },
    requestId: options.requestId,
  });
  return link.id;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * BR-020: the contact and its first link are created together. The actor must
 * be able to edit the opportunity; nothing about other contacts is consulted,
 * so creating a contact never reveals an existing one the actor cannot see.
 */
export async function createContact(options: {
  db: Database;
  actor: Actor;
  command: z.output<typeof createContactSchema>;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<ContactDetailDto> {
  const { db, actor, command, requestId, completeClaim } = options;
  if (!canEditDirectory(actor)) throw forbidden();

  const contactId = await db.transaction(async (tx) => {
    await lockOpportunity(tx, actor, command.opportunityId);
    await assertCurrentOrganization(tx, command.organizationId);

    const timestamp = now();
    const [created] = await tx
      .insert(contacts)
      .values({
        organizationId: command.organizationId,
        fullName: command.fullName,
        designation: command.designation,
        department: command.department ?? null,
        email: command.email ?? null,
        phone: command.phone ?? null,
        createdBy: actor.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: contacts.id });
    if (!created) throw new Error('Contact insert returned no row.');

    await audit(tx, actor, {
      domain: 'directory',
      entityType: 'contact',
      entityId: created.id,
      action: 'contact.created',
      after: {
        fullName: command.fullName,
        designation: command.designation,
        organizationId: command.organizationId,
        department: command.department ?? null,
        email: command.email ?? null,
        phone: command.phone ?? null,
      },
      requestId,
    });
    await insertLink(tx, actor, {
      opportunityId: command.opportunityId,
      contactId: created.id,
      fullName: command.fullName,
      relationshipNotes: command.relationshipNotes,
      requestId,
    });
    await completeClaim(tx, created.id);
    return created.id;
  });

  return getContact(db, actor, contactId);
}

/** Links an existing contact the actor can already see. */
export async function linkContact(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: { contactId: string; relationshipNotes?: string | undefined };
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<OpportunityContactDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;
  if (!canEditDirectory(actor)) throw forbidden();

  const linkId = await db.transaction(async (tx) => {
    await lockOpportunity(tx, actor, opportunityId);

    // A contact the actor cannot see is the same 404 as one that does not
    // exist: linking is not a way to discover contacts.
    const [contact] = await tx
      .select({ id: contacts.id, fullName: contacts.fullName, archivedAt: contacts.archivedAt })
      .from(contacts)
      .where(and(contactScope(actor), eq(contacts.id, command.contactId)))
      .limit(1);
    if (!contact) throw absent('contact', command.contactId, actor);
    if (contact.archivedAt) throw conflict('This contact is archived and cannot be linked.');

    const id = await insertLink(tx, actor, {
      opportunityId,
      contactId: contact.id,
      fullName: contact.fullName,
      relationshipNotes: command.relationshipNotes,
      requestId,
    });
    await completeClaim(tx, id);
    return id;
  });

  const all = await listOpportunityContacts(db, actor, opportunityId);
  const link = all.find((row) => row.linkId === linkId);
  if (!link) throw absent('contact link', linkId, actor);
  return link;
}

/** The link plus its contact and opportunity, through the actor's scope. */
async function findVisibleLink(tx: Database, actor: Actor, linkId: string) {
  const [row] = await tx
    .select({
      id: opportunityContacts.id,
      opportunityId: opportunityContacts.opportunityId,
      contactId: opportunityContacts.contactId,
      relationshipNotes: opportunityContacts.relationshipNotes,
      version: opportunityContacts.version,
      fullName: contacts.fullName,
    })
    .from(opportunityContacts)
    .innerJoin(opportunities, eq(opportunities.id, opportunityContacts.opportunityId))
    .innerJoin(contacts, eq(contacts.id, opportunityContacts.contactId))
    .where(scopedWhere(actor, eq(opportunityContacts.id, linkId), isNull(opportunityContacts.removedAt)))
    .limit(1);
  if (!row) throw absent('contact link', linkId, actor);
  return row;
}

/** Relationship notes belong to one link; editing them needs only that opportunity (BR-021). */
export async function updateLinkNotes(options: {
  db: Database;
  actor: Actor;
  linkId: string;
  command: { version: number; relationshipNotes: string | null };
  requestId: string;
}): Promise<OpportunityContactDto> {
  const { db, actor, linkId, command, requestId } = options;
  if (!canEditDirectory(actor)) throw forbidden();
  const notes = command.relationshipNotes?.trim() ? command.relationshipNotes.trim() : null;

  const opportunityId = await db.transaction(async (tx) => {
    const found = await findVisibleLink(tx, actor, linkId);
    await lockOpportunity(tx, actor, found.opportunityId);
    const updated = await tx
      .update(opportunityContacts)
      .set({ relationshipNotes: notes, updatedAt: now(), version: sql`${opportunityContacts.version} + 1` })
      .where(
        and(
          eq(opportunityContacts.id, linkId),
          eq(opportunityContacts.version, command.version),
          isNull(opportunityContacts.removedAt),
        ),
      )
      .returning({ id: opportunityContacts.id });
    if (updated.length === 0) throw versionConflict();

    if (found.relationshipNotes !== notes) {
      await audit(tx, actor, {
        domain: 'commercial',
        opportunityId: found.opportunityId,
        entityType: 'contact_link',
        entityId: linkId,
        action: 'contact.notes_updated',
        before: { about: found.fullName, relationshipNotes: found.relationshipNotes },
        after: { about: found.fullName, relationshipNotes: notes },
        requestId,
      });
    }
    return found.opportunityId;
  });

  const link = (await listOpportunityContacts(db, actor, opportunityId)).find((row) => row.linkId === linkId);
  if (!link) throw absent('contact link', linkId, actor);
  return link;
}

/**
 * FR-033: a link can be removed, but never a contact's last one — that is
 * management's explicit archive decision. The link is kept, marked removed,
 * with its notes.
 */
export async function removeLink(options: {
  db: Database;
  actor: Actor;
  linkId: string;
  command: { version: number; reason?: string | undefined };
  requestId: string;
}): Promise<void> {
  const { db, actor, linkId, command, requestId } = options;
  if (!canEditDirectory(actor)) throw forbidden();

  await db.transaction(async (tx) => {
    const found = await findVisibleLink(tx, actor, linkId);
    await lockOpportunity(tx, actor, found.opportunityId);
    // Serialises removals of the same contact's links.
    await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, found.contactId)).for('update');

    const [live] = await tx
      .select({ value: count() })
      .from(opportunityContacts)
      .where(and(eq(opportunityContacts.contactId, found.contactId), isNull(opportunityContacts.removedAt)));
    if ((live?.value ?? 0) <= 1) {
      throw conflict(
        'This is the contact’s only link. A contact must stay linked to at least one opportunity; management can archive the contact instead.',
      );
    }

    const timestamp = now();
    const updated = await tx
      .update(opportunityContacts)
      .set({ removedAt: timestamp, removedBy: actor.id, updatedAt: timestamp, version: sql`${opportunityContacts.version} + 1` })
      .where(
        and(
          eq(opportunityContacts.id, linkId),
          eq(opportunityContacts.version, command.version),
          isNull(opportunityContacts.removedAt),
        ),
      )
      .returning({ id: opportunityContacts.id });
    if (updated.length === 0) throw versionConflict();

    await audit(tx, actor, {
      domain: 'commercial',
      opportunityId: found.opportunityId,
      entityType: 'contact_link',
      entityId: linkId,
      action: 'contact.unlinked',
      before: { about: found.fullName, contactId: found.contactId },
      after: null,
      reason: command.reason,
      requestId,
    });
  });
}

/** BR-021: shared identity fields, editable only by someone who sees every link. */
export async function updateContact(options: {
  db: Database;
  actor: Actor;
  contactId: string;
  command: z.output<typeof updateContactSchema>;
  requestId: string;
}): Promise<ContactDetailDto> {
  const { db, actor, contactId, command, requestId } = options;
  if (!canEditDirectory(actor)) throw forbidden();

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: contacts.id,
        organizationId: contacts.organizationId,
        fullName: contacts.fullName,
        designation: contacts.designation,
        department: contacts.department,
        email: contacts.email,
        phone: contacts.phone,
        archivedAt: contacts.archivedAt,
        version: contacts.version,
      })
      .from(contacts)
      .where(and(contactScope(actor), eq(contacts.id, contactId)))
      .for('update')
      .limit(1);
    if (!current) throw absent('contact', contactId, actor);

    if (!(await seesEveryLink(tx, actor, contactId))) {
      throw forbidden(
        'This contact is shared with opportunities outside your access, so its name and details can only be corrected by management. You can still edit your relationship notes.',
      );
    }
    if (current.version !== command.version) throw versionConflict();
    if (current.archivedAt) throw conflict('Archived contacts are read-only.');

    const changes: Record<string, unknown> = {};
    for (const key of ['organizationId', 'fullName', 'designation'] as const) {
      if (command[key] !== undefined) changes[key] = command[key];
    }
    for (const key of ['department', 'email', 'phone'] as const) {
      if (key in command) changes[key] = command[key] ?? null;
    }
    if (typeof changes.organizationId === 'string' && changes.organizationId !== current.organizationId) {
      await assertCurrentOrganization(tx, changes.organizationId);
    }

    const diff = diffRecords(current as unknown as Record<string, unknown>, changes);
    if (diff.changed.length === 0) return;

    await tx
      .update(contacts)
      .set({ ...changes, updatedAt: now(), version: sql`${contacts.version} + 1` })
      .where(and(eq(contacts.id, contactId), eq(contacts.version, command.version)));
    await audit(tx, actor, {
      domain: 'directory',
      entityType: 'contact',
      entityId: contactId,
      action: 'contact.updated',
      before: diff.before,
      after: diff.after,
      requestId,
    });
  });

  return getContact(db, actor, contactId);
}

/** FR-033: management's explicit archive. Links and history are kept. */
export async function archiveContact(options: {
  db: Database;
  actor: Actor;
  contactId: string;
  command: { version: number; reason: string };
  requestId: string;
}): Promise<ContactDetailDto> {
  const { db, actor, contactId, command, requestId } = options;
  if (!canArchiveDirectory(actor)) throw forbidden('Only management can archive a contact.');

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: contacts.id, archivedAt: contacts.archivedAt, version: contacts.version })
      .from(contacts)
      .where(and(contactScope(actor), eq(contacts.id, contactId)))
      .for('update')
      .limit(1);
    if (!current) throw absent('contact', contactId, actor);
    if (current.version !== command.version) throw versionConflict();
    if (current.archivedAt) throw conflict('This contact is already archived.');

    const timestamp = now();
    await tx
      .update(contacts)
      .set({ archivedAt: timestamp, archivedBy: actor.id, updatedAt: timestamp, version: sql`${contacts.version} + 1` })
      .where(eq(contacts.id, contactId));
    await audit(tx, actor, {
      domain: 'directory',
      entityType: 'contact',
      entityId: contactId,
      action: 'contact.archived',
      before: { archived: false },
      after: { archived: true },
      reason: command.reason,
      requestId,
    });
  });

  return getContact(db, actor, contactId);
}


