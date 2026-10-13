/**
 * Invitation and password-reset links (SEC-030, SEC-031).
 *
 *  - The token is 256 random bits. Only its SHA-256 hash is stored, so a copy
 *    of the database does not yield usable links.
 *  - It is single-use and expires. Issuing a new link of the same purpose
 *    spends any earlier one.
 *  - Redeeming it sets the password and bumps the account's session version,
 *    which revokes every existing session (SEC-005).
 *  - Its purpose is bound to the account's state: an invitation works only
 *    while the account has no password (pending activation), a reset only
 *    once it has one. Neither works for, or reactivates, a disabled account.
 *  - Opening a link only inspects it (`inspectAccountLink`); it is spent only
 *    when a password is successfully set.
 *  - Every failure produces the same message, so a link cannot be used to
 *    learn whether an account exists or why the link failed.
 *
 * Delivery (CR1): while email delivery is on, a link is issued only when its
 * email is sent (services/email.ts), so the readable token exists only in
 * that message. Otherwise, or when an administrator asks to copy it, the
 * link is shown once to the administrator to deliver by hand. If Penta adopts
 * its identity provider, this module is replaced rather than extended.
 */
import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { hashPassword } from '../auth/password.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { accountTokens, users } from '../db/schema.js';
import type { AccountLinkStatusDto } from '../../shared/api.js';
import { ApiError } from '../http/errors.js';
import { recordAuditEvent } from './audit.js';

/** Proposed defaults, for Penta to confirm. */
export const INVITATION_LIFETIME_HOURS = 72;
export const RESET_LIFETIME_HOURS = 24;

export const INVALID_LINK_MESSAGE =
  'This link is invalid, has already been used, or has expired. Ask your administrator for a new one.';

export type AccountTokenPurpose = 'invitation' | 'password_reset';

/** A freshly issued link: the only readable copy of its token. */
export interface IssuedLink {
  purpose: AccountTokenPurpose;
  url: string;
  expiresAt: string;
}

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
): Promise<IssuedLink> {
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

/** An invitation needs a pending account; a reset needs an activated one. */
const purposeFitsAccount = or(
  and(eq(accountTokens.purpose, 'invitation'), isNull(users.passwordHash)),
  and(eq(accountTokens.purpose, 'password_reset'), isNotNull(users.passwordHash)),
);

/**
 * What an opened link can do, without spending it (CR1). The token is 256
 * random bits, so its state tells nothing to someone who does not hold it.
 * A disabled account's link reads as invalid.
 */
export async function inspectAccountLink(db: Database, token: string): Promise<AccountLinkStatusDto> {
  const [row] = await db
    .select({
      purpose: accountTokens.purpose,
      usedAt: accountTokens.usedAt,
      expiresAt: accountTokens.expiresAt,
      active: users.active,
      activated: sql<boolean>`${users.passwordHash} IS NOT NULL`,
    })
    .from(accountTokens)
    .innerJoin(users, eq(users.id, accountTokens.userId))
    .where(eq(accountTokens.tokenHash, digest(token)))
    .limit(1);
  if (!row || !row.active) return { state: 'invalid', purpose: null };
  const purpose = row.purpose as AccountTokenPurpose;
  if (row.usedAt) return { state: 'used', purpose };
  // An invitation for an account that is already activated has served its purpose.
  if (purpose === 'invitation' && row.activated) return { state: 'used', purpose };
  if (purpose === 'password_reset' && !row.activated) return { state: 'invalid', purpose: null };
  if (row.expiresAt <= now()) return { state: 'expired', purpose };
  return { state: 'valid', purpose };
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
          purposeFitsAccount,
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
