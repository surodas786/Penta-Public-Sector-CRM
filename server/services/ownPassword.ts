/**
 * A signed-in account changing its own password (CR3).
 *
 *  - The current password is required, so a session left open on a shared
 *    desk cannot be turned into a permanent takeover.
 *  - The account is always the session's own: no user id is accepted.
 *  - Success bumps the session version, which ends every other session on
 *    its next request (SEC-005), and spends any outstanding invitation or
 *    reset link, which would otherwise still overwrite the new password.
 *    The route then re-issues the caller's own session (decision D-CR3-1).
 *  - While email delivery is on, the account holder is told by email (CR2),
 *    so a change they did not make does not go unnoticed. The email is
 *    queued in the same transaction and carries no password material.
 */
import { and, eq, sql } from 'drizzle-orm';

import { hashPassword, verifyPassword } from '../auth/password.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { validationFailed, unauthenticated } from '../http/errors.js';
import type { Actor } from '../policy/actor.js';
import { revokeAccountLinks } from './accountTokens.js';
import { recordAuditEvent } from './audit.js';
import { queueEmail } from './email.js';

export const WRONG_CURRENT_PASSWORD = 'Your current password is not correct.';
export const SAME_PASSWORD = 'Choose a password different from your current one.';

/** Returns the account's new session version, for re-stamping the caller's session. */
export async function changeOwnPassword(options: {
  db: Database;
  actor: Actor;
  currentPassword: string;
  newPassword: string;
  requestId: string;
}): Promise<number> {
  const { db, actor, currentPassword, newPassword, requestId } = options;

  const [account] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, actor.id), eq(users.active, true)))
    .limit(1);
  if (!account) throw unauthenticated();

  // Verified outside the transaction: argon2 is deliberately slow and must
  // not hold a row lock.
  const currentMatches = account.passwordHash !== null && (await verifyPassword(account.passwordHash, currentPassword));
  if (!currentMatches) {
    throw validationFailed({ currentPassword: WRONG_CURRENT_PASSWORD }, 'Please correct the highlighted fields.');
  }
  if (await verifyPassword(account.passwordHash!, newPassword)) {
    throw validationFailed({ newPassword: SAME_PASSWORD }, 'Please correct the highlighted fields.');
  }
  const passwordHash = await hashPassword(newPassword);

  return db.transaction(async (tx) => {
    // The hash just verified is part of the predicate: if another request
    // changed the password in between, this one fails instead of silently
    // replacing a password its caller never proved knowledge of.
    const [updated] = await tx
      .update(users)
      .set({
        passwordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: now(),
        version: sql`${users.version} + 1`,
      })
      .where(and(eq(users.id, actor.id), eq(users.active, true), eq(users.passwordHash, account.passwordHash!)))
      .returning({ sessionVersion: users.sessionVersion });
    if (!updated) {
      throw validationFailed({ currentPassword: WRONG_CURRENT_PASSWORD }, 'Please correct the highlighted fields.');
    }

    await revokeAccountLinks(tx, actor.id);

    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'user',
      entityId: actor.id,
      action: 'account.password_changed',
      domain: 'administrative',
      before: null,
      after: null,
      requestId,
    });

    const changedAt = now();
    await queueEmail(tx, {
      templateKey: 'password_changed',
      recipientUserId: actor.id,
      dedupeKey: `password_changed:${requestId}`,
      context: { changedAt: changedAt.toISOString() },
      createdBy: actor.id,
    });

    return updated.sessionVersion;
  });
}
