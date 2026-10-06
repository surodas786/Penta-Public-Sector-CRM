/**
 * The first System Administrator of an empty deployment (FR-001: "initial
 * privileged accounts are established through a controlled deployment
 * process").
 *
 * Works only while no active administrator exists, so it cannot be used to
 * add a second one beside the normal, audited administration screens. The
 * account is created without a password and receives a single-use invitation
 * link (SEC-030), shown once to the operator who ran it. The creation is
 * audited with no acting user — there is none yet — and the operator's
 * request id names the deployment step.
 */
import { and, eq, sql } from 'drizzle-orm';

import { createUserSchema } from '../../shared/validation.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { conflict } from '../http/errors.js';
import { issueAccountLink } from './accountTokens.js';
import { recordAuditEvent } from './audit.js';

export async function bootstrapAdministrator(
  db: Database,
  options: { fullName: string; email: string; appOrigin: string; requestId: string },
): Promise<{ userId: string; invitationUrl: string; expiresAt: string }> {
  const command = createUserSchema.parse({ fullName: options.fullName, email: options.email, role: 'admin' });

  return db.transaction(async (tx) => {
    // Two operators running it at once are serialised; the second sees the first.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('penta-crm-bootstrap-administrator'))`);
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true)))
      .limit(1);
    if (existing) {
      throw conflict('An active System Administrator already exists. Add administrators from the Administration page.');
    }
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, command.email)).limit(1);
    if (taken) throw conflict('Another account already uses this email address.');

    const timestamp = now();
    const [created] = await tx
      .insert(users)
      .values({ fullName: command.fullName, email: command.email, role: 'admin', passwordHash: null, createdAt: timestamp, updatedAt: timestamp })
      .returning({ id: users.id });
    if (!created) throw new Error('Administrator insert returned no row.');

    const link = await issueAccountLink(tx, { userId: created.id, purpose: 'invitation', createdBy: created.id, appOrigin: options.appOrigin });
    await recordAuditEvent(tx, {
      actorId: null,
      entityType: 'user',
      entityId: created.id,
      action: 'account.created',
      domain: 'administrative',
      after: { fullName: command.fullName, email: command.email, role: 'admin', via: 'deployment bootstrap' },
      requestId: options.requestId,
    });
    await recordAuditEvent(tx, {
      actorId: null,
      entityType: 'user',
      entityId: created.id,
      action: 'account.invitation_issued',
      domain: 'administrative',
      after: { expiresAt: link.expiresAt },
      requestId: options.requestId,
    });
    return { userId: created.id, invitationUrl: link.url, expiresAt: link.expiresAt };
  });
}
