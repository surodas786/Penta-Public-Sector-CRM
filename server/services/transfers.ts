/**
 * Ownership transfer (FR-070, BR-050, BR-090, BR-091, SEC-005).
 *
 * One transaction: lock the opportunity, change owner and section, review
 * every open follow-up, and audit. The opportunity row is locked before any
 * follow-up — the order every M2 writer uses — so a transfer and a concurrent
 * task completion or creation are serialised and cannot leave an open task
 * with someone who has just lost access.
 *
 * Nothing else is copied or moved: completed and cancelled tasks, history and
 * the original creator stay as they are, and every child record follows the
 * opportunity's new scope because scope is derived from the opportunity on
 * each request.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { OpportunityDetailDto } from '../../shared/api.js';
import type { transferOpportunitySchema } from '../../shared/validation.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { followUps, opportunities, sections, users } from '../db/schema.js';
import { forbidden, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import {
  canTransferOpportunity,
  eligibleOwnerScope,
  keepsFollowUpAfterTransfer,
  leadsSectionSql,
  opportunityScope,
} from '../policy/scope.js';
import { recordAuditEvent } from './audit.js';
import { lockOpportunity } from './followUps.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { alertsChangedInTransaction } from './notifications.js';
import { getOpportunityDetail } from './opportunities.js';
import { signalJobsEnqueued } from '../jobs/queue.js';

type TransferCommand = z.output<typeof transferOpportunitySchema>;

export async function transferOpportunity(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: TransferCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<OpportunityDetailDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;

  await db.transaction(async (tx) => {
    // 404 for anything outside scope, before any other answer.
    const current = await lockOpportunity(tx, actor, opportunityId);

    if (!canTransferOpportunity(actor)) {
      throw forbidden('Salespeople cannot change an opportunity’s owner. Ask your section lead or management.');
    }
    if (current.version !== command.version) throw versionConflict();

    // The new owner and section must be a pair the actor may assign: an
    // active salesperson member of the section or its lead, in a section the
    // lead leads (any section for management). The owner row is locked first
    // and eligibility read in a fresh statement, so a concurrent membership
    // removal (which locks the same row) is either seen or waits for this.
    // One message for every reason, so the field cannot probe for accounts.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, command.newOwnerId)).for('update');
    const candidates = await tx
      .select({ sectionId: sections.id })
      .from(users)
      .innerJoin(sections, eligibleOwnerScope(actor, sections.id))
      .where(eq(users.id, command.newOwnerId));
    const candidateIds = candidates.map((row) => row.sectionId);
    if (candidateIds.length === 0) {
      throw validationFailed({ newOwnerId: 'Choose an active owner you are permitted to assign.' });
    }

    let newSectionId: string;
    if (command.newSectionId) {
      if (!candidateIds.includes(command.newSectionId)) {
        throw validationFailed({ newSectionId: 'Choose a section the new owner works in and you may assign.' });
      }
      newSectionId = command.newSectionId;
    } else if (candidateIds.includes(current.sectionId)) {
      newSectionId = current.sectionId;
    } else if (candidateIds.length === 1) {
      newSectionId = candidateIds[0]!;
    } else {
      throw validationFailed({ newSectionId: 'The new owner works in more than one section. Choose the section.' });
    }
    if (command.newOwnerId === current.ownerId && newSectionId === current.sectionId) {
      throw validationFailed({ newOwnerId: 'This person already owns the opportunity in this section.' });
    }
    const newOwner = { id: command.newOwnerId, sectionId: newSectionId };

    const transfer = { previousOwnerId: current.ownerId, newOwnerId: newOwner.id };
    const timestamp = now();

    const updated = await tx
      .update(opportunities)
      .set({
        ownerId: newOwner.id,
        sectionId: newOwner.sectionId,
        updatedAt: timestamp,
        version: sql`${opportunities.version} + 1`,
      })
      .where(
        and(opportunityScope(actor), eq(opportunities.id, current.id), eq(opportunities.version, command.version)),
      )
      .returning({ id: opportunities.id });
    if (updated.length === 0) throw versionConflict();

    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: current.id,
      entityType: 'opportunity',
      entityId: current.id,
      action: 'opportunity.transferred',
      before: { ownerId: current.ownerId, sectionId: current.sectionId },
      after: { ownerId: newOwner.id, sectionId: newOwner.sectionId },
      reason: command.reason,
      requestId,
    });

    // BR-050: review every open follow-up. Completed and cancelled tasks keep
    // their assignee: that is history.
    const openTasks = await tx
      .select({
        id: followUps.id,
        title: followUps.title,
        assigneeId: followUps.assignedUserId,
        assigneeRole: users.role,
        assigneeLeadsNewSection: sql<boolean>`${leadsSectionSql(users.id, sql`${newSectionId}::uuid`)}`,
        assigneeActive: users.active,
      })
      .from(followUps)
      .innerJoin(users, eq(users.id, followUps.assignedUserId))
      .where(and(eq(followUps.opportunityId, current.id), eq(followUps.state, 'open')))
      .for('update', { of: followUps });

    for (const task of openTasks) {
      const keeps = keepsFollowUpAfterTransfer(
        {
          id: task.assigneeId,
          role: task.assigneeRole,
          active: task.assigneeActive,
          leadsNewSection: task.assigneeLeadsNewSection,
        },
        transfer,
      );
      if (keeps) continue;

      await tx
        .update(followUps)
        .set({ assignedUserId: newOwner.id, updatedAt: timestamp, version: sql`${followUps.version} + 1` })
        .where(and(eq(followUps.id, task.id), eq(followUps.state, 'open')));

      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId: current.id,
        entityType: 'follow_up',
        entityId: task.id,
        action: 'follow_up.reassigned',
        before: { task: task.title, assignedUserId: task.assigneeId },
        after: { task: task.title, assignedUserId: newOwner.id },
        reason: 'Reassigned with the opportunity’s transfer.',
        requestId,
      });
    }

    // BR-070: the previous team's alerts go with their access; the new
    // owner, lead and management are told about the change.
    await alertsChangedInTransaction(tx, { opportunityId: current.id, resolution: 'transferred', ownership: { newOwnerId: newOwner.id, version: command.version + 1, actorId: actor.id } });
    await completeClaim(tx, current.id);
  });

  signalJobsEnqueued();
  return getOpportunityDetail(db, actor, opportunityId);
}
