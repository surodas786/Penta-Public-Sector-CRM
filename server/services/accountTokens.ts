/**
 * Invitation and password-reset links (SEC-030, SEC-031).
 *
 *  - The token is 256 random bits. Only its SHA-256 hash is stored, so a copy
 *    of the database does not yield usable links.
 *  - It is single-use and expires. Issuing a new link of the same purpose
 *    spends any earlier one.
 *  - Redeeming it sets the password and bumps the account's session version,
 *    which revokes every existing session (SEC-005).
 *  - Every failure produces the same message, so a link cannot be used to
 *    learn whether an account exists or why the link failed.
 *
 * Release one sends no email (requirements §1.3), so the administrator
 * receives the link once and delivers it out of band. If Penta adopts its
 * identity provider, this module is replaced rather than extended.
 */
import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import type { AccountLinkDto } from '../../shared/api.js';
import { hashPassword } from '../auth/password.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { accountTokens, users } from '../db/schema.js';
import { ApiError } from '../http/errors.js';
import { recordAuditEvent } from './audit.js';

/** Proposed defaults, for Penta to confirm. */
export const INVITATION_LIFETIME_HOURS = 72;
export const RESET_LIFETIME_HOURS = 24;

export const INVALID_LINK_MESSAGE =
  'This link is invalid, has already been used, or has expired. Ask your administrator for a new one.';

export type AccountTokenPurpose = 'invitation' | 'password_reset';

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a link inside the caller's transaction. Returns the only readable
 * copy of the token, embedded in a URL whose fragment never reaches a server
 * log or a Referer header.
 */
export async function issueAccountLink(
  tx: Database,
  options: { userId: string; purpose: AccountTokenPurpose; createdBy: string; appOrigin: string },
): Promise<AccountLinkDto> {
  const { userId, purpose, createdBy, appOrigin } = options;
  const issuedAt = now();
  const hours = purpose === 'invitation' ? INVITATION_LIFETIME_HOURS : RESET_LIFETIME_HOURS;
  const expiresAt = new Date(issuedAt.getTime() + hours * 3_600_000);

  // Spend earlier unused links of the same purpose: only the newest works.
  await tx
    .update(accountTokens)
    .set({ usedAt: issuedAt })
    .where(and(eq(accountTokens.userId, userId), eq(accountTokens.purpose, purpose), isNull(accountTokens.usedAt)));

  const token = randomBytes(32).toString('base64url');
  await tx.insert(accountTokens).values({
    userId,
    purpose,
    tokenHash: digest(token),
    expiresAt,
    createdBy,
    createdAt: issuedAt,
  });

  return {
    purpose,
    url: `${appOrigin.replace(/\/$/, '')}/set-password#token=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Spends every outstanding link for an account, e.g. on deactivation. */
export async function revokeAccountLinks(tx: Database, userId: string): Promise<void> {
  await tx
    .update(accountTokens)
    .set({ usedAt: now() })
    .where(and(eq(accountTokens.userId, userId), isNull(accountTokens.usedAt)));
}

/**
 * Redeems a link: sets the password, spends the token and revokes sessions,
 * in one transaction. The new password is hashed before the transaction so
 * the row lock is held only briefly.
 */
export async function redeemAccountLink(options: {
  db: Database;
  token: string;
  password: string;
  requestId: string;
}): Promise<void> {
  const { db, token, password, requestId } = options;
  const passwordHash = await hashPassword(password);
  const invalid = () => new ApiError(422, 'validation_failed', INVALID_LINK_MESSAGE);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: accountTokens.id, userId: accountTokens.userId, purpose: accountTokens.purpose })
      .from(accountTokens)
      .innerJoin(users, eq(users.id, accountTokens.userId))
      .where(
        and(
          eq(accountTokens.tokenHash, digest(token)),
          isNull(accountTokens.usedAt),
          gt(accountTokens.expiresAt, now()),
          eq(users.active, true),
        ),
      )
      .for('update', { of: accountTokens })
      .limit(1);
    if (!row) throw invalid();

    const timestamp = now();
    const spent = await tx
      .update(accountTokens)
      .set({ usedAt: timestamp })
      .where(and(eq(accountTokens.id, row.id), isNull(accountTokens.usedAt)))
      .returning({ id: accountTokens.id });
    if (spent.length === 0) throw invalid();

    // A new password ends every session the account had (SEC-005).
    await tx
      .update(users)
      .set({
        passwordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: timestamp,
        version: sql`${users.version} + 1`,
      })
      .where(eq(users.id, row.userId));

    await recordAuditEvent(tx, {
      actorId: row.userId,
      entityType: 'user',
      entityId: row.userId,
      action: row.purpose === 'invitation' ? 'account.invitation_accepted' : 'account.password_reset',
      domain: 'administrative',
      before: null,
      after: null,
      requestId,
    });
  });
}
