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
import { followUps, opportunities, users } from '../db/schema.js';
import { forbidden, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import {
  canTransferOpportunity,
  eligibleOwnerScope,
  keepsFollowUpAfterTransfer,
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

    // The new owner must be an active salesperson or lead the actor may
    // assign: within the lead's own section, or any section for management.
    // One message for every reason, so the field cannot probe for accounts.
    const [newOwner] = await tx
      .select({ id: users.id, sectionId: users.sectionId })
      .from(users)
      .where(and(eligibleOwnerScope(actor), eq(users.id, command.newOwnerId)))
      .for('update')
      .limit(1);
    if (!newOwner?.sectionId) {
      throw validationFailed({ newOwnerId: 'Choose an active owner you are permitted to assign.' });
    }
    if (newOwner.id === current.ownerId) {
      throw validationFailed({ newOwnerId: 'This person already owns the opportunity.' });
    }

    const transfer = {
      previousOwnerId: current.ownerId,
      newOwnerId: newOwner.id,
      newSectionId: newOwner.sectionId,
    };
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
        assigneeSectionId: users.sectionId,
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
          sectionId: task.assigneeSectionId,
          active: task.assigneeActive,
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
