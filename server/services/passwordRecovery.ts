/**
 * "Forgot your password?" on the sign-in page (CR3, completing SEC-030 now
 * that email exists).
 *
 *  - The public answer is always the same, whether or not the address belongs
 *    to an account, so the page cannot be used to learn who has one.
 *  - The request only queues a job carrying a SHA-256 digest of the address;
 *    the lookup happens in the background, so the response takes the same
 *    time either way, and no typed address is kept in the job table.
 *  - A reset email goes only to an active, activated account. A pending
 *    account needs its invitation resent by an administrator; a disabled one
 *    gets nothing, and a reset never reactivates it (accountTokens.ts).
 *  - At most one reset email per account per window, however often it is
 *    asked for, on top of the per-address rate limit on the endpoint.
 *  - The link itself is the ordinary reset link, issued when the email is
 *    sent; using it ends every session the account had.
 */
import { createHash } from 'node:crypto';

import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import type { EmailRuntime } from '../email/runtime.js';
import { enqueueJob } from '../jobs/queue.js';
import { recordAuditEvent } from './audit.js';
import { isEmailDeliveryOn, queueEmail } from './email.js';

/** At most one self-service reset email per account in this many minutes. */
export const RESET_REQUEST_WINDOW_MINUTES = 15;

export const RESET_REQUESTED_MESSAGE =
  'If an active account uses that address, a link to choose a new password is on its way. It works once and expires in 24 hours.';

function addressDigest(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/** Offered only while this deployment can and may send email. */
export async function isSelfServiceResetAvailable(db: Database, email: EmailRuntime): Promise<boolean> {
  return email.transport !== null && (await isEmailDeliveryOn(db));
}

/** The public request. Queues the lookup; says nothing about the outcome. */
export async function requestPasswordReset(db: Database, email: EmailRuntime, address: string): Promise<{ queued: boolean }> {
  if (!(await isSelfServiceResetAvailable(db, email))) return { queued: false };
  await enqueueJob(db, { kind: 'account.reset_request', payload: { addressDigest: addressDigest(address) } });
  return { queued: true };
}

/** The `account.reset_request` job: finds the account, if any, and queues its reset email. */
export async function processPasswordResetRequest(db: Database, digest: string, requestId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          sql`encode(sha256(convert_to(lower(${users.email}), 'UTF8')), 'hex') = ${digest}`,
          eq(users.active, true),
          isNotNull(users.passwordHash),
        ),
      )
      .limit(1);
    if (!user) return;

    const window = Math.floor(now().getTime() / (RESET_REQUEST_WINDOW_MINUTES * 60_000));
    const deliveryId = await queueEmail(tx, {
      templateKey: 'password_reset',
      recipientUserId: user.id,
      dedupeKey: `self-reset:${user.id}:${window}`,
      createdBy: null,
    });
    if (!deliveryId) return;

    await recordAuditEvent(tx, {
      actorId: null,
      entityType: 'user',
      entityId: user.id,
      action: 'account.reset_requested',
      domain: 'administrative',
      before: null,
      after: { delivery: 'email' },
      requestId,
    });
  });
}
