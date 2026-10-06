/**
 * Stage and status transitions (FR-020, FR-021, BR-010, BR-011, BR-012, BR-014).
 *
 * Each operation is one transaction that locks the opportunity row, checks the
 * version, applies the change, maintains the follow-up invariant and writes its
 * audit events. The version is checked again in the UPDATE predicate (BR-090).
 *
 * Error precedence, so responses cannot be used to probe:
 *   404  absent or outside scope (decided before anything else)
 *   403  visible, but this role may not perform the action
 *   409  stale version, or the record's state does not allow the move
 *   422  a field the move requires is missing or invalid
 */
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { OpportunityDetailDto } from '../../shared/api.js';
import {
  STAGE_LABELS,
  STATUS_LABELS,
  classifyStageMove,
  isTerminalStage,
} from '../../shared/enums.js';
import { canonicalMoney } from '../../shared/money.js';
import type {
  changeStageSchema,
  changeStatusSchema,
  reopenOpportunitySchema,
} from '../../shared/validation.js';
import { dhakaToday, now } from '../clock.js';
import type { Database } from '../db/client.js';
import { opportunities } from '../db/schema.js';
import { conflict, forbidden, validationFailed, versionConflict } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { canChangeStageOrStatus, canReopenOpportunity, opportunityScope } from '../policy/scope.js';
import { recordAuditEvent } from './audit.js';
import {
  cancelOpenFollowUps,
  countOpenFollowUps,
  insertFollowUp,
  lockOpportunity,
  type LockedOpportunity,
} from './followUps.js';
import type { CompleteClaimInTransaction } from './idempotency.js';
import { getOpportunityDetail } from './opportunities.js';

type ChangeStageCommand = z.output<typeof changeStageSchema>;
type ChangeStatusCommand = z.output<typeof changeStatusSchema>;
type ReopenCommand = z.output<typeof reopenOpportunitySchema>;

const invalidTransition = (message: string) => conflict(message, 'invalid_transition');

/** Writes the opportunity change with the version in the predicate. */
async function applyOpportunityUpdate(
  tx: Database,
  actor: Actor,
  opportunity: LockedOpportunity,
  expectedVersion: number,
  changes: Partial<typeof opportunities.$inferInsert>,
): Promise<void> {
  const rows = await tx
    .update(opportunities)
    .set({ ...changes, updatedAt: now(), version: sql`${opportunities.version} + 1` })
    .where(
      and(
        opportunityScope(actor),
        eq(opportunities.id, opportunity.id),
        eq(opportunities.version, expectedVersion),
      ),
    )
    .returning({ id: opportunities.id });
  if (rows.length === 0) throw versionConflict();
}

function closureReason(label: string, explanation?: string): string {
  return explanation
    ? `Closed automatically: opportunity ${label}. ${explanation}`
    : `Closed automatically: opportunity ${label}.`;
}

// ---------------------------------------------------------------------------
// Stage change
// ---------------------------------------------------------------------------

export async function changeStage(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: ChangeStageCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<OpportunityDetailDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;

  await db.transaction(async (tx) => {
    const current = await lockOpportunity(tx, actor, opportunityId);
    if (!canChangeStageOrStatus(actor)) throw forbidden();
    if (current.version !== command.version) throw versionConflict();

    if (isTerminalStage(current.stage)) {
      // BR-012: leaving Awarded or Lost is a reopening, with its own rules.
      throw canReopenOpportunity(actor)
        ? invalidTransition('This opportunity is closed. Use Reopen to return it to a working stage.')
        : forbidden('Only management can reopen an Awarded or Lost opportunity.');
    }
    if (current.status !== 'active') {
      // D-001: a held or cancelled record keeps its stage; it returns to work
      // through the status change, which restores that stage.
      throw invalidTransition(
        `This opportunity is ${STATUS_LABELS[current.status]}. Return it to Active before changing its stage.`,
      );
    }

    const move = classifyStageMove(current.stage, command.stage);
    if (move === 'same') {
      throw validationFailed({ stage: `The opportunity is already at ${STAGE_LABELS[current.stage]}.` });
    }

    const errors: Record<string, string> = {};
    if ((move === 'skip' || move === 'backward') && !command.explanation) {
      errors.explanation =
        move === 'skip'
          ? 'Explain why stages are being skipped.'
          : 'Explain why the opportunity is moving back to an earlier stage.';
    }

    const today = dhakaToday();
    const changes: Partial<typeof opportunities.$inferInsert> = { stage: command.stage };
    const after: Record<string, unknown> = { stage: command.stage };

    if (command.stage === 'awarded') {
      // BR-011: actual value (positive) and award date (not in the future).
      if (!command.awardedValue) errors.awardedValue = 'Enter the actual awarded value.';
      if (!command.awardDate) errors.awardDate = 'Enter the award date.';
      else if (command.awardDate > today) errors.awardDate = 'The award date cannot be in the future.';
      if (command.awardedValue && command.awardDate) {
        changes.awardedValue = canonicalMoney(command.awardedValue);
        changes.awardDate = command.awardDate;
        changes.closedDate = command.awardDate;
        Object.assign(after, { awardedValue: changes.awardedValue, awardDate: command.awardDate });
      }
    } else if (command.stage === 'lost') {
      // BR-011: a preset reason and a closed date; "Other" must be explained.
      if (!command.lossReason) errors.lossReason = 'Choose the reason the opportunity was lost.';
      if (command.lossReason === 'other' && !command.lossNote) {
        errors.lossNote = 'Explain the reason when choosing Other.';
      }
      if (!command.closedDate) errors.closedDate = 'Enter the date the opportunity was lost.';
      else if (command.closedDate > today) errors.closedDate = 'The closed date cannot be in the future.';
      changes.lossReason = command.lossReason ?? null;
      changes.lossNote = command.lossNote ?? null;
      changes.closedDate = command.closedDate ?? null;
      Object.assign(after, {
        lossReason: command.lossReason,
        lossNote: command.lossNote ?? null,
        closedDate: command.closedDate,
      });
    } else if (
      !command.nextFollowUp &&
      (await countOpenFollowUps(tx, current.id)) === 0
    ) {
      // A working stage must leave the record with a next action (BR-013).
      errors['nextFollowUp.title'] = 'Add the next action for this opportunity.';
    }

    if (Object.keys(errors).length > 0) throw validationFailed(errors);

    await applyOpportunityUpdate(tx, actor, current, command.version, changes);
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: current.id,
      entityType: 'opportunity',
      entityId: current.id,
      action: 'opportunity.stage_changed',
      before: { stage: current.stage },
      after,
      reason: command.explanation ?? null,
      requestId,
    });

    if (isTerminalStage(command.stage)) {
      // BR-014: terminal closure cancels open tasks, never marks them done.
      await cancelOpenFollowUps(tx, {
        actor,
        opportunityId: current.id,
        reason: closureReason(`marked ${STAGE_LABELS[command.stage]}`),
        requestId,
      });
    } else if (command.nextFollowUp) {
      await insertFollowUp(tx, {
        actor,
        opportunity: current,
        draft: command.nextFollowUp,
        requestId,
        fieldPrefix: 'nextFollowUp',
        context: 'transition',
      });
    }

    await completeClaim(tx, current.id);
  });

  return getOpportunityDetail(db, actor, opportunityId);
}

// ---------------------------------------------------------------------------
// Status change: On Hold, Cancelled, and returning to Active
// ---------------------------------------------------------------------------

export async function changeStatus(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: ChangeStatusCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<OpportunityDetailDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;

  await db.transaction(async (tx) => {
    const current = await lockOpportunity(tx, actor, opportunityId);
    if (!canChangeStageOrStatus(actor)) throw forbidden();
    if (current.version !== command.version) throw versionConflict();

    // BR-010: On Hold and Cancelled are not offered on terminal records, and
    // a terminal record is never anything but Active.
    if (isTerminalStage(current.stage)) {
      throw invalidTransition(
        `${STAGE_LABELS[current.stage]} opportunities are closed; their status cannot change.`,
      );
    }
    if (current.status === command.status) {
      throw validationFailed({ status: `The opportunity is already ${STATUS_LABELS[current.status]}.` });
    }
    if (current.status === 'cancelled' && command.status === 'on_hold') {
      throw invalidTransition('Return a cancelled opportunity to Active before putting it On Hold.');
    }

    if (command.status === 'active') {
      // BR-012: returning from On Hold or Cancelled needs a reason and a next
      // action. On Hold kept its tasks, which may already provide one;
      // Cancelled closed them, so a new one is required.
      if (!command.nextFollowUp && (await countOpenFollowUps(tx, current.id)) === 0) {
        throw validationFailed({ 'nextFollowUp.title': 'Add the next action for the returning opportunity.' });
      }

      await applyOpportunityUpdate(tx, actor, current, command.version, {
        status: 'active',
        statusNote: null,
        closedDate: null,
      });
      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId: current.id,
        entityType: 'opportunity',
        entityId: current.id,
        action: 'opportunity.status_changed',
        before: { status: current.status, statusNote: current.statusNote, closedDate: current.closedDate },
        // D-001: the retained stage is restored by doing nothing to it.
        after: { status: 'active', stage: current.stage },
        reason: command.reason,
        requestId,
      });
      if (command.nextFollowUp) {
        await insertFollowUp(tx, {
          actor,
          opportunity: current,
          draft: command.nextFollowUp,
          requestId,
          fieldPrefix: 'nextFollowUp',
          context: 'transition',
        });
      }
    } else {
      if (command.nextFollowUp) {
        throw validationFailed({
          nextFollowUp: `A next action is not recorded when moving to ${STATUS_LABELS[command.status]}.`,
        });
      }

      const changes: Partial<typeof opportunities.$inferInsert> = {
        status: command.status,
        statusNote: command.reason,
      };
      if (command.status === 'cancelled') changes.closedDate = dhakaToday();

      await applyOpportunityUpdate(tx, actor, current, command.version, changes);
      await recordAuditEvent(tx, {
        actorId: actor.id,
        opportunityId: current.id,
        entityType: 'opportunity',
        entityId: current.id,
        action: 'opportunity.status_changed',
        before: { status: current.status },
        after: { status: command.status, statusNote: command.reason, stage: current.stage },
        reason: command.reason,
        requestId,
      });

      // BR-014: Cancelled closes open tasks as Cancelled. On Hold keeps them.
      if (command.status === 'cancelled') {
        await cancelOpenFollowUps(tx, {
          actor,
          opportunityId: current.id,
          reason: closureReason('cancelled', command.reason),
          requestId,
        });
      }
    }

    await completeClaim(tx, current.id);
  });

  return getOpportunityDetail(db, actor, opportunityId);
}

// ---------------------------------------------------------------------------
// Reopening (BR-012)
// ---------------------------------------------------------------------------

export async function reopenOpportunity(options: {
  db: Database;
  actor: Actor;
  opportunityId: string;
  command: ReopenCommand;
  requestId: string;
  completeClaim: CompleteClaimInTransaction;
}): Promise<OpportunityDetailDto> {
  const { db, actor, opportunityId, command, requestId, completeClaim } = options;

  await db.transaction(async (tx) => {
    const current = await lockOpportunity(tx, actor, opportunityId);
    if (!canReopenOpportunity(actor)) {
      throw forbidden('Only management can reopen an Awarded or Lost opportunity.');
    }
    if (current.version !== command.version) throw versionConflict();
    if (!isTerminalStage(current.stage)) {
      throw invalidTransition('Only Awarded or Lost opportunities can be reopened.');
    }

    await applyOpportunityUpdate(tx, actor, current, command.version, {
      stage: command.stage,
      status: 'active',
      awardedValue: null,
      awardDate: null,
      lossReason: null,
      lossNote: null,
      closedDate: null,
    });

    // The previous outcome is kept, immutably, in this event's before-values.
    await recordAuditEvent(tx, {
      actorId: actor.id,
      opportunityId: current.id,
      entityType: 'opportunity',
      entityId: current.id,
      action: 'opportunity.reopened',
      before: {
        stage: current.stage,
        awardedValue: current.awardedValue,
        awardDate: current.awardDate,
        lossReason: current.lossReason,
        lossNote: current.lossNote,
        closedDate: current.closedDate,
      },
      after: { stage: command.stage },
      reason: command.reason,
      requestId,
    });

    await insertFollowUp(tx, {
      actor,
      opportunity: current,
      draft: command.nextFollowUp,
      requestId,
      fieldPrefix: 'nextFollowUp',
      context: 'transition',
    });

    await completeClaim(tx, current.id);
  });

  return getOpportunityDetail(db, actor, opportunityId);
}
