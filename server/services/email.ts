/**
 * Email delivery (CR2, with CR1 and CR3).
 *
 * The System Administrator configures the mail server and the wording of each
 * email. Nothing here touches commercial data: the delivery log shows which
 * email went to whom and what happened, never a message body, and previews
 * use synthetic sample values only.
 *
 * Sending is a background job (`email.send`), so a slow or failing mail
 * server never holds up the request that caused the email, and failures are
 * retried with backoff and show in the job health check (NFR-003):
 *
 *   1. `queueEmail` records a delivery and queues its job inside the caller's
 *      transaction, but only while delivery is turned on.
 *   2. `deliverEmail` re-checks everything when it runs: delivery still on,
 *      template still on, recipient still active. For an invitation or a
 *      reset (CR1) it issues the single-use link only now, so the readable
 *      token exists only in the message, and its expiry counts from sending.
 *      It renders the current wording and sends. The send happens outside any transaction; a crash
 *      between sending and recording "sent" can repeat one message on retry
 *      (at least once, never silently lost).
 */
import { createHash } from 'node:crypto';

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import {
  EMAIL_MANUAL_RETRY_LIMIT,
  type EmailConnectionCheckDto,
  type EmailDeliveryDto,
  type EmailPreviewDto,
  type EmailSettingsDto,
  type EmailTemplateDto,
  type EmailTemplateVersionDto,
  type Paginated,
} from '../../shared/api.js';
import {
  EMAIL_APP_NAME,
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATES,
  renderTemplate,
  templateProblems,
  type EmailTemplateKey,
} from '../../shared/email.js';
import type { emailTemplateContentSchema, updateEmailSettingsSchema, updateEmailTemplateSchema } from '../../shared/validation.js';
import { now } from '../clock.js';
import type { Database } from '../db/client.js';
import { auditEvents, emailDeliveries, emailSettings, emailTemplates, users } from '../db/schema.js';
import type { EmailRuntime } from '../email/runtime.js';
import { decryptSecret, encryptSecret } from '../email/secretBox.js';
import { describeDeliveryFailure, type MailServer } from '../email/transport.js';
import { conflict, forbidden, notFound, validationFailed, versionConflict } from '../http/errors.js';
import { enqueueJob } from '../jobs/queue.js';
import type { Actor } from '../policy/actor.js';
import { canAdministerAccounts } from '../policy/scope.js';
import { issueAccountLink } from './accountTokens.js';
import { beginAdministrativeChange } from './admin.js';
import { deliverableAlert, formatDate, formatInstant } from './notifications.js';
import { diffRecords, recordAuditEvent } from './audit.js';

function assertAdministrator(actor: Actor): void {
  if (!canAdministerAccounts(actor)) throw forbidden('Email settings are limited to the System Administrator.');
}

const TEST_LABEL = 'Test message';

/** The detail of a message the capture transport wrote to a folder instead of sending. */
const CAPTURED_DETAIL = 'Captured locally (EMAIL_TRANSPORT=capture); not sent.';

/**
 * A stable audit entity id for a piece of configuration that has no UUID of
 * its own (the settings row, a template key), so all of its history shares
 * one id. Name-based, UUIDv5-shaped.
 */
function configurationEntityId(name: string): string {
  const bytes = createHash('sha1').update(`penta-crm-configuration:${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function readSettingsRow(db: Database, options: { lock?: boolean } = {}) {
  const query = db.select().from(emailSettings).where(eq(emailSettings.id, 1)).limit(1);
  const [row] = options.lock ? await query.for('update') : await query;
  return row ?? null;
}

type SettingsRow = NonNullable<Awaited<ReturnType<typeof readSettingsRow>>>;

export async function getEmailSettings(db: Database, actor: Actor, runtime: EmailRuntime): Promise<EmailSettingsDto> {
  assertAdministrator(actor);
  const row = await readSettingsRow(db);
  let updatedByName: string | null = null;
  if (row?.updatedBy) {
    const [person] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, row.updatedBy)).limit(1);
    updatedByName = person?.name ?? null;
  }
  const key = runtime.config.secretKey;
  return {
    enabled: row?.enabled ?? false,
    host: row?.host ?? null,
    port: row?.port ?? null,
    security: row?.security ?? 'starttls',
    username: row?.username ?? null,
    passwordSet: Boolean(row?.passwordCiphertext),
    passwordReadable: !row?.passwordCiphertext || (key !== null && decryptSecret(key, row.passwordCiphertext) !== null),
    fromName: row?.fromName ?? null,
    fromAddress: row?.fromAddress ?? null,
    replyTo: row?.replyTo ?? null,
    transport: runtime.config.transport,
    canStorePassword: key !== null,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedByName,
  };
}

/** The non-secret settings, as audited. The password appears only as "replaced" or "removed". */
function auditableSettings(row: Partial<SettingsRow> | null): Record<string, unknown> {
  return {
    enabled: row?.enabled ?? false,
    host: row?.host ?? null,
    port: row?.port ?? null,
    security: row?.security ?? 'starttls',
    username: row?.username ?? null,
    fromName: row?.fromName ?? null,
    fromAddress: row?.fromAddress ?? null,
    replyTo: row?.replyTo ?? null,
  };
}

export async function updateEmailSettings(options: {
  db: Database;
  actor: Actor;
  runtime: EmailRuntime;
  command: z.output<typeof updateEmailSettingsSchema>;
  requestId: string;
}): Promise<EmailSettingsDto> {
  const { db, actor, runtime, command, requestId } = options;
  assertAdministrator(actor);

  if (command.enabled) {
    const missing: Record<string, string> = {};
    if (!command.host) missing.host = 'Enter the mail server to turn delivery on.';
    if (!command.port) missing.port = 'Enter the port to turn delivery on.';
    if (!command.fromAddress) missing.fromAddress = 'Enter the sender address to turn delivery on.';
    if (Object.keys(missing).length > 0) throw validationFailed(missing);
  }
  const key = runtime.config.secretKey;
  if (command.password && !key) {
    throw validationFailed({
      password: 'This server has no EMAIL_SECRET_KEY, so a password cannot be stored safely. Ask whoever runs the server to set one.',
    });
  }

  await db.transaction(async (tx) => {
    await beginAdministrativeChange(tx, actor);
    const current = await readSettingsRow(tx, { lock: true });
    if ((current?.version ?? 0) !== command.version) throw versionConflict();

    const next = {
      enabled: command.enabled,
      host: command.host,
      port: command.port,
      security: command.security,
      username: command.username,
      fromName: command.fromName,
      fromAddress: command.fromAddress,
      replyTo: command.replyTo,
    };
    const passwordCiphertext =
      command.password === undefined
        ? (current?.passwordCiphertext ?? null)
        : command.password === null || command.password === ''
          ? null
          : encryptSecret(key!, command.password);
    const credential =
      command.password === undefined ? null : passwordCiphertext ? 'replaced' : current?.passwordCiphertext ? 'removed' : null;

    const diff = diffRecords(auditableSettings(current), next);
    if (diff.changed.length === 0 && !credential && current) return;

    const timestamp = now();
    if (current) {
      const updated = await tx
        .update(emailSettings)
        .set({ ...next, passwordCiphertext, updatedBy: actor.id, updatedAt: timestamp, version: sql`${emailSettings.version} + 1` })
        .where(and(eq(emailSettings.id, 1), eq(emailSettings.version, command.version)))
        .returning({ id: emailSettings.id });
      if (updated.length === 0) throw versionConflict();
    } else {
      const inserted = await tx
        .insert(emailSettings)
        .values({ id: 1, ...next, passwordCiphertext, updatedBy: actor.id, updatedAt: timestamp })
        .onConflictDoNothing()
        .returning({ id: emailSettings.id });
      if (inserted.length === 0) throw versionConflict();
    }

    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'email_settings',
      entityId: configurationEntityId('email_settings'),
      action: 'email.settings_updated',
      domain: 'administrative',
      before: { ...diff.before, ...(credential ? { smtpCredential: current?.passwordCiphertext ? 'stored' : 'none' } : {}) },
      after: { ...diff.after, ...(credential ? { smtpCredential: credential } : {}) },
      requestId,
    });
  });

  return getEmailSettings(db, actor, runtime);
}

/** The settings as a transport needs them. Throws when a stored password can no longer be read. */
function toMailServer(row: SettingsRow, key: Buffer | null): MailServer | { unreadablePassword: true } {
  let password: string | null = null;
  if (row.passwordCiphertext) {
    password = key ? decryptSecret(key, row.passwordCiphertext) : null;
    if (password === null) return { unreadablePassword: true };
  }
  return {
    host: row.host ?? '',
    port: row.port ?? 25,
    security: row.security,
    username: row.username,
    password,
    fromName: row.fromName,
    fromAddress: row.fromAddress ?? '',
    replyTo: row.replyTo,
  };
}

const UNREADABLE_PASSWORD = 'The stored SMTP password cannot be decrypted with the current EMAIL_SECRET_KEY. Enter it again.';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

async function readTemplateRows(db: Database) {
  return db.select().from(emailTemplates);
}

function toTemplateDto(key: EmailTemplateKey, row: (typeof emailTemplates.$inferSelect) | undefined): EmailTemplateDto {
  const definition = EMAIL_TEMPLATES[key];
  return {
    key,
    label: definition.label,
    sentWhen: definition.sentWhen,
    placeholders: [...definition.placeholders],
    required: [...definition.required],
    subject: row?.subject ?? definition.defaultSubject,
    bodyText: row?.bodyText ?? definition.defaultBody,
    enabled: row?.enabled ?? true,
    customized: Boolean(row),
    defaultSubject: definition.defaultSubject,
    defaultBody: definition.defaultBody,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

async function readTemplate(db: Database, key: EmailTemplateKey): Promise<EmailTemplateDto> {
  const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.key, key)).limit(1);
  return toTemplateDto(key, row);
}

export async function listEmailTemplates(db: Database, actor: Actor): Promise<EmailTemplateDto[]> {
  assertAdministrator(actor);
  const rows = await readTemplateRows(db);
  return EMAIL_TEMPLATE_KEYS.map((key) => toTemplateDto(key, rows.find((row) => row.key === key)));
}

function assertTemplateContent(key: EmailTemplateKey, content: { subject: string; bodyText: string }): void {
  const problems = templateProblems(key, content);
  if (Object.keys(problems).length > 0) throw validationFailed(problems);
}

export async function updateEmailTemplate(options: {
  db: Database;
  actor: Actor;
  key: EmailTemplateKey;
  command: z.output<typeof updateEmailTemplateSchema>;
  requestId: string;
}): Promise<EmailTemplateDto> {
  const { db, actor, key, command, requestId } = options;
  assertAdministrator(actor);
  assertTemplateContent(key, command);

  await db.transaction(async (tx) => {
    await beginAdministrativeChange(tx, actor);
    const [current] = await tx.select().from(emailTemplates).where(eq(emailTemplates.key, key)).for('update').limit(1);
    if ((current?.version ?? 0) !== command.version) throw versionConflict();

    const before = toTemplateDto(key, current);
    const next = { subject: command.subject, bodyText: command.bodyText, enabled: command.enabled };
    const diff = diffRecords({ subject: before.subject, bodyText: before.bodyText, enabled: before.enabled }, next);
    if (diff.changed.length === 0) return;

    const timestamp = now();
    if (current) {
      const updated = await tx
        .update(emailTemplates)
        .set({ ...next, updatedBy: actor.id, updatedAt: timestamp, version: sql`${emailTemplates.version} + 1` })
        .where(and(eq(emailTemplates.key, key), eq(emailTemplates.version, command.version)))
        .returning({ key: emailTemplates.key });
      if (updated.length === 0) throw versionConflict();
    } else {
      const inserted = await tx
        .insert(emailTemplates)
        .values({ key, ...next, updatedBy: actor.id, updatedAt: timestamp })
        .onConflictDoNothing()
        .returning({ key: emailTemplates.key });
      if (inserted.length === 0) throw versionConflict();
    }

    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'email_template',
      entityId: configurationEntityId(`email_template:${key}`),
      action: 'email.template_updated',
      domain: 'administrative',
      // The template name travels as context so the audit view can say which.
      before: { template: EMAIL_TEMPLATES[key].label, ...diff.before },
      after: { template: EMAIL_TEMPLATES[key].label, ...diff.after },
      requestId,
    });
  });

  return readTemplate(db, key);
}

/**
 * Every saved version of one email's wording, newest first. The history is the
 * administrative audit itself: each save records the fields it changed, so
 * replaying them over the default wording gives each version in full.
 */
export async function listEmailTemplateHistory(db: Database, actor: Actor, key: EmailTemplateKey): Promise<EmailTemplateVersionDto[]> {
  assertAdministrator(actor);
  const editor = alias(users, 'editor');
  const rows = await db
    .select({ occurredAt: auditEvents.occurredAt, actorName: editor.fullName, after: auditEvents.afterData })
    .from(auditEvents)
    .leftJoin(editor, eq(editor.id, auditEvents.actorId))
    .where(
      and(
        eq(auditEvents.entityType, 'email_template'),
        eq(auditEvents.entityId, configurationEntityId(`email_template:${key}`)),
        eq(auditEvents.action, 'email.template_updated'),
      ),
    )
    .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.sequence));

  const definition = EMAIL_TEMPLATES[key];
  let state = { subject: definition.defaultSubject, bodyText: definition.defaultBody, enabled: true };
  const versions: EmailTemplateVersionDto[] = [];
  for (const row of rows) {
    const after = (row.after ?? {}) as Record<string, unknown>;
    state = {
      subject: typeof after.subject === 'string' ? after.subject : state.subject,
      bodyText: typeof after.bodyText === 'string' ? after.bodyText : state.bodyText,
      enabled: typeof after.enabled === 'boolean' ? after.enabled : state.enabled,
    };
    versions.push({
      ...state,
      changed: (['subject', 'bodyText', 'enabled'] as const).filter((field) => field in after),
      occurredAt: row.occurredAt.toISOString(),
      actorName: row.actorName ?? null,
    });
  }
  return versions.reverse();
}

const SAMPLE_INSTANT = new Date('2026-10-15T09:30:00Z');

/** Synthetic values for a preview. Never a real person, record or link. */
function sampleValues(appOrigin: string): Record<string, string> {
  return {
    appName: EMAIL_APP_NAME,
    recipientName: 'Sample Person',
    link: `${appOrigin}/sample-link`,
    expiresAt: formatDhakaInstant(SAMPLE_INSTANT),
    changedAt: formatDhakaInstant(SAMPLE_INSTANT),
    dueDate: '15 Oct 2026',
    deadline: formatDhakaInstant(SAMPLE_INSTANT),
  };
}

export function previewEmailTemplate(
  actor: Actor,
  key: EmailTemplateKey,
  content: z.output<typeof emailTemplateContentSchema>,
  appOrigin: string,
): EmailPreviewDto {
  assertAdministrator(actor);
  assertTemplateContent(key, content);
  const values = sampleValues(appOrigin);
  return { subject: renderTemplate(content.subject, values), text: renderTemplate(content.bodyText, values) };
}

// ---------------------------------------------------------------------------
// Delivery log
// ---------------------------------------------------------------------------

function deliveryLabel(templateKey: string): string {
  return (EMAIL_TEMPLATES as Record<string, { label: string } | undefined>)[templateKey]?.label ?? TEST_LABEL;
}

async function readDeliveries(db: Database, where: ReturnType<typeof eq> | undefined, page: number, pageSize: number) {
  const recipient = alias(users, 'recipient');
  return db
    .select({
      id: emailDeliveries.id,
      templateKey: emailDeliveries.templateKey,
      recipientName: recipient.fullName,
      recipientAddress: emailDeliveries.recipientAddress,
      status: emailDeliveries.status,
      statusDetail: emailDeliveries.statusDetail,
      attempts: emailDeliveries.attempts,
      createdAt: emailDeliveries.createdAt,
      sentAt: emailDeliveries.sentAt,
    })
    .from(emailDeliveries)
    .leftJoin(recipient, eq(recipient.id, emailDeliveries.recipientUserId))
    .where(where)
    .orderBy(desc(emailDeliveries.createdAt), desc(emailDeliveries.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

function toDeliveryDto(row: Awaited<ReturnType<typeof readDeliveries>>[number]): EmailDeliveryDto {
  return {
    id: row.id,
    templateKey: row.templateKey,
    label: deliveryLabel(row.templateKey),
    recipientName: row.recipientName ?? null,
    recipientAddress: row.recipientAddress,
    status: row.status,
    statusDetail: row.statusDetail,
    captured: row.status === 'sent' && row.statusDetail === CAPTURED_DETAIL,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}

export async function listEmailDeliveries(
  db: Database,
  actor: Actor,
  page: number,
  pageSize: number,
): Promise<Paginated<EmailDeliveryDto>> {
  assertAdministrator(actor);
  const [total] = await db.select({ value: count() }).from(emailDeliveries);
  const rows = await readDeliveries(db, undefined, page, pageSize);
  return { items: rows.map(toDeliveryDto), total: total?.value ?? 0, page, pageSize };
}

async function readDelivery(db: Database, id: string): Promise<EmailDeliveryDto> {
  const [row] = await readDeliveries(db, eq(emailDeliveries.id, id), 1, 1);
  if (!row) throw notFound(`email delivery ${id} not found`);
  return toDeliveryDto(row);
}

// ---------------------------------------------------------------------------
// Test message
// ---------------------------------------------------------------------------

/**
 * Sends a fixed test message now, so an administrator learns at once whether
 * the settings work. It is sent even while delivery is turned off, which is
 * when it is most useful. Recorded in the delivery log and audited.
 */
export async function sendTestEmail(options: {
  db: Database;
  actor: Actor;
  runtime: EmailRuntime;
  to: string;
  requestId: string;
}): Promise<EmailDeliveryDto> {
  const { db, actor, runtime, to, requestId } = options;
  assertAdministrator(actor);

  const settings = await readSettingsRow(db);
  if (!settings?.host || !settings.port || !settings.fromAddress) {
    throw validationFailed({ to: 'Save the mail server, port and sender address before sending a test message.' });
  }

  const [delivery] = await db
    .insert(emailDeliveries)
    .values({ templateKey: 'test', recipientAddress: to, createdBy: actor.id, attempts: 1 })
    .returning({ id: emailDeliveries.id });
  if (!delivery) throw new Error('Delivery insert returned no row.');

  let outcome: { status: 'sent' | 'failed' | 'suppressed'; detail: string | null };
  const server = toMailServer(settings, runtime.config.secretKey);
  if (!runtime.transport) {
    outcome = { status: 'suppressed', detail: 'This server is not configured to send email (EMAIL_TRANSPORT=none).' };
  } else if ('unreadablePassword' in server) {
    outcome = { status: 'failed', detail: UNREADABLE_PASSWORD };
  } else {
    try {
      await runtime.transport.send(server, {
        to,
        subject: `${EMAIL_APP_NAME} test message`,
        text: `This is a test message from ${EMAIL_APP_NAME}, sent by ${actor.fullName} to check the email settings.\n\nNo action is needed.`,
      });
      outcome = { status: 'sent', detail: runtime.transport.kind === 'capture' ? CAPTURED_DETAIL : null };
    } catch (error) {
      outcome = { status: 'failed', detail: describeDeliveryFailure(error) };
    }
  }

  await db.transaction(async (tx) => {
    const timestamp = now();
    await tx
      .update(emailDeliveries)
      .set({ status: outcome.status, statusDetail: outcome.detail, updatedAt: timestamp, sentAt: outcome.status === 'sent' ? timestamp : null })
      .where(eq(emailDeliveries.id, delivery.id));
    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'email_delivery',
      entityId: delivery.id,
      action: 'email.test_sent',
      domain: 'administrative',
      before: null,
      after: { recipientAddress: to, status: outcome.status },
      requestId,
    });
  });

  return readDelivery(db, delivery.id);
}

/**
 * Connects to the saved mail server and signs in, sending nothing, so an
 * administrator can check the settings without a message. Not audited: it
 * changes nothing. It works while delivery is turned off.
 */
export async function checkEmailConnection(options: { db: Database; actor: Actor; runtime: EmailRuntime }): Promise<EmailConnectionCheckDto> {
  const { db, actor, runtime } = options;
  assertAdministrator(actor);
  const settings = await readSettingsRow(db);
  if (!settings?.host || !settings.port || !settings.fromAddress) {
    throw validationFailed({ host: 'Save the mail server, port and sender address before checking the connection.' });
  }
  if (!runtime.transport) {
    return { status: 'not_sending', detail: 'This server is not configured to send email (EMAIL_TRANSPORT=none).' };
  }
  const server = toMailServer(settings, runtime.config.secretKey);
  if ('unreadablePassword' in server) return { status: 'failed', detail: UNREADABLE_PASSWORD };
  if (runtime.transport.kind === 'capture') {
    return { status: 'not_sending', detail: 'Messages are captured locally (EMAIL_TRANSPORT=capture); no mail server is contacted.' };
  }
  try {
    await runtime.transport.verify(server);
    return { status: 'ok', detail: 'The mail server answered and accepted the connection settings. Nothing was sent.' };
  } catch (error) {
    return { status: 'failed', detail: describeDeliveryFailure(error) };
  }
}

/**
 * Queues a failed email again (CR2, controlled retry): only a failed email,
 * never a test message, at most EMAIL_MANUAL_RETRY_LIMIT times, and only while
 * delivery is on. The job re-checks everything before sending, as the first
 * time: the recipient still active, an alert still true and permitted, an
 * invitation still unaccepted; an account link is issued afresh.
 */
export async function retryEmailDelivery(options: {
  db: Database;
  actor: Actor;
  deliveryId: string;
  requestId: string;
}): Promise<EmailDeliveryDto> {
  const { db, actor, deliveryId, requestId } = options;
  assertAdministrator(actor);

  await db.transaction(async (tx) => {
    await beginAdministrativeChange(tx, actor);
    const [delivery] = await tx
      .select({ id: emailDeliveries.id, status: emailDeliveries.status, templateKey: emailDeliveries.templateKey })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, deliveryId))
      .for('update')
      .limit(1);
    if (!delivery) throw notFound(`email delivery ${deliveryId} not found`);
    if (delivery.templateKey === 'test') throw conflict('A test message is not retried. Send a new test message instead.');
    if (delivery.status !== 'failed') throw conflict('Only a failed email can be retried.');

    const [previous] = await tx
      .select({ value: count() })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, 'email_delivery'),
          eq(auditEvents.entityId, delivery.id),
          eq(auditEvents.action, 'email.delivery_retried'),
        ),
      );
    const retries = previous?.value ?? 0;
    if (retries >= EMAIL_MANUAL_RETRY_LIMIT) {
      throw conflict(
        `This email has already been retried ${EMAIL_MANUAL_RETRY_LIMIT} times. Fix the mail server settings, then send a new email from where it started.`,
      );
    }
    if (!(await isEmailDeliveryOn(tx))) throw conflict('Turn email delivery on before retrying.');

    await tx
      .update(emailDeliveries)
      .set({ status: 'queued', statusDetail: null, updatedAt: now() })
      .where(eq(emailDeliveries.id, delivery.id));
    await enqueueJob(tx, {
      kind: 'email.send',
      payload: { deliveryId: delivery.id },
      dedupeKey: `email.send:${delivery.id}:retry:${retries + 1}`,
    });
    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'email_delivery',
      entityId: delivery.id,
      action: 'email.delivery_retried',
      domain: 'administrative',
      before: { status: 'failed' },
      after: { status: 'queued', retry: retries + 1 },
      requestId,
    });
  });

  return readDelivery(db, deliveryId);
}

// ---------------------------------------------------------------------------
// Queueing and sending
// ---------------------------------------------------------------------------

/** Delivery is turned on by an administrator. */
export async function isEmailDeliveryOn(db: Database): Promise<boolean> {
  return (await readSettingsRow(db))?.enabled ?? false;
}

const ACCOUNT_EMAILS: readonly EmailTemplateKey[] = ['invitation', 'password_reset'];

/**
 * Cancels any invitation or reset email still waiting to be sent to a person,
 * e.g. when an administrator copies a link instead: sending it would issue a
 * newer link and silently void the copied one.
 */
export async function suppressQueuedAccountEmails(tx: Database, userId: string, detail: string): Promise<void> {
  await tx
    .update(emailDeliveries)
    .set({ status: 'suppressed', statusDetail: detail, updatedAt: now() })
    .where(
      and(
        eq(emailDeliveries.recipientUserId, userId),
        inArray(emailDeliveries.templateKey, [...ACCOUNT_EMAILS]),
        eq(emailDeliveries.status, 'queued'),
      ),
    );
}

const ALERT_EMAILS: readonly EmailTemplateKey[] = ['follow_up_due_today', 'follow_up_overdue', 'tender_deadline', 'ownership_changed'];

/**
 * Emails for newly created alerts (CR2), in the alert generator's
 * transaction. Nothing while delivery is turned off. One email per alert:
 * the dedupe key is the alert's id.
 */
export async function queueAlertEmails(tx: Database, alerts: { id: string; recipientId: string; type: string }[]): Promise<void> {
  if (alerts.length === 0 || !(await isEmailDeliveryOn(tx))) return;
  const rows = await tx
    .insert(emailDeliveries)
    .values(
      alerts.map((alert) => ({
        templateKey: alert.type,
        recipientUserId: alert.recipientId,
        dedupeKey: `alert:${alert.id}`,
        context: { notificationId: alert.id },
      })),
    )
    .onConflictDoNothing()
    .returning({ id: emailDeliveries.id });
  for (const row of rows) {
    await enqueueJob(tx, { kind: 'email.send', payload: { deliveryId: row.id }, dedupeKey: `email.send:${row.id}` });
  }
}

/**
 * Records an email to send and queues its job, in the caller's transaction,
 * so it exists if and only if the change that caused it commits. Does
 * nothing while delivery is turned off. Returns the delivery id, or null.
 * The caller signals the job queue after commit.
 */
export async function queueEmail(
  tx: Database,
  email: {
    templateKey: EmailTemplateKey;
    recipientUserId: string;
    dedupeKey: string;
    context?: Record<string, unknown>;
    createdBy?: string | null;
  },
): Promise<string | null> {
  const settings = await readSettingsRow(tx);
  if (!settings?.enabled) return null;

  const [row] = await tx
    .insert(emailDeliveries)
    .values({
      templateKey: email.templateKey,
      recipientUserId: email.recipientUserId,
      dedupeKey: email.dedupeKey,
      context: email.context ?? {},
      createdBy: email.createdBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: emailDeliveries.id });
  if (!row) return null;
  await enqueueJob(tx, { kind: 'email.send', payload: { deliveryId: row.id }, dedupeKey: `email.send:${row.id}` });
  return row.id;
}

/** Dates and times as the interface writes them: "04 Oct 2026, 15:00 Bangladesh time (UTC+6)". */
const formatDhakaInstant = formatInstant;
const formatDhakaDate = formatDate;

/** The placeholder values for one delivery, from its context and the recipient. */
function renderValues(
  key: EmailTemplateKey,
  context: Record<string, unknown>,
  recipient: { fullName: string },
  appOrigin: string,
): Record<string, string> {
  const values: Record<string, string> = { appName: EMAIL_APP_NAME, recipientName: recipient.fullName, link: `${appOrigin}/` };
  if (key === 'password_changed' && typeof context.changedAt === 'string') {
    values.changedAt = formatDhakaInstant(new Date(context.changedAt));
  }
  return values;
}

async function settle(db: Database, deliveryId: string, change: { status: 'sent' | 'failed' | 'suppressed' | 'queued'; detail: string | null }) {
  const timestamp = now();
  await db
    .update(emailDeliveries)
    .set({
      status: change.status,
      statusDetail: change.detail,
      updatedAt: timestamp,
      sentAt: change.status === 'sent' ? timestamp : null,
    })
    .where(eq(emailDeliveries.id, deliveryId));
}

/** The `email.send` job. Throws on a sending failure so the queue retries it. */
export async function deliverEmail(db: Database, runtime: EmailRuntime, deliveryId: string, requestId: string): Promise<void> {
  const prepared = await db.transaction(async (tx) => {
    const [delivery] = await tx.select().from(emailDeliveries).where(eq(emailDeliveries.id, deliveryId)).for('update').limit(1);
    if (!delivery || delivery.status !== 'queued') return null;
    const suppress = async (detail: string) => {
      await settle(tx, delivery.id, { status: 'suppressed', detail });
      return null;
    };

    const settings = await readSettingsRow(tx);
    if (!settings?.enabled) return suppress('Email delivery is turned off.');
    if (!runtime.transport) return suppress('This server is not configured to send email (EMAIL_TRANSPORT=none).');
    if (!EMAIL_TEMPLATE_KEYS.includes(delivery.templateKey as EmailTemplateKey)) return suppress('Unknown email.');
    const key = delivery.templateKey as EmailTemplateKey;
    const template = await readTemplate(tx, key);
    if (!template.enabled) return suppress('This email is turned off in Email templates.');

    const [recipient] = delivery.recipientUserId
      ? await tx
          .select({ id: users.id, fullName: users.fullName, email: users.email, active: users.active, passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.id, delivery.recipientUserId))
          .limit(1)
      : [];
    if (!recipient || !recipient.active) return suppress('The recipient account is inactive.');

    const server = toMailServer(settings, runtime.config.secretKey);
    if ('unreadablePassword' in server) {
      await settle(tx, delivery.id, { status: 'failed', detail: UNREADABLE_PASSWORD });
      return null;
    }

    const values = renderValues(key, delivery.context as Record<string, unknown>, recipient, runtime.appOrigin);

    // CR2: an alert email goes only while the alert is still true, unread
    // and permitted; it links to the record, where access is checked again.
    if (ALERT_EMAILS.includes(key)) {
      const notificationId = (delivery.context as { notificationId?: unknown }).notificationId;
      const alert = typeof notificationId === 'string' ? await deliverableAlert(tx, notificationId) : null;
      if (!alert || !alert.ok) return suppress(alert && !alert.ok ? alert.reason : 'The alert no longer exists.');
      values.link = `${runtime.appOrigin}/opportunities/${alert.opportunityId}`;
      if (alert.triggerDate) values.dueDate = formatDhakaDate(alert.triggerDate);
      if (alert.triggerAt) values.deadline = formatDhakaInstant(alert.triggerAt);
    }

    // CR1: the link is issued now, inside this transaction, and exists in
    // readable form only in the message below. Issuing spends any earlier
    // link of the same purpose, so a retry leaves only the newest working.
    if (key === 'invitation' || key === 'password_reset') {
      if (key === 'invitation' && recipient.passwordHash) return suppress('The invitation was already accepted.');
      const issued = await issueAccountLink(tx, {
        userId: recipient.id,
        purpose: key,
        createdBy: delivery.createdBy ?? recipient.id,
        appOrigin: runtime.appOrigin,
      });
      await recordAuditEvent(tx, {
        actorId: delivery.createdBy,
        entityType: 'user',
        entityId: recipient.id,
        action: key === 'invitation' ? 'account.invitation_issued' : 'account.reset_issued',
        domain: 'administrative',
        after: { expiresAt: issued.expiresAt, delivery: 'email' },
        requestId,
      });
      values.link = issued.url;
      values.expiresAt = formatDhakaInstant(new Date(issued.expiresAt));
    }
    await tx
      .update(emailDeliveries)
      .set({ attempts: sql`${emailDeliveries.attempts} + 1`, recipientAddress: recipient.email, updatedAt: now() })
      .where(eq(emailDeliveries.id, delivery.id));
    return {
      server,
      message: {
        to: recipient.email,
        subject: renderTemplate(template.subject, values),
        text: renderTemplate(template.bodyText, values),
      },
    };
  });
  if (!prepared || !runtime.transport) return;

  try {
    await runtime.transport.send(prepared.server, prepared.message);
  } catch (error) {
    // Still queued: the job is retried with backoff, and marked failed after its last attempt.
    await settle(db, deliveryId, { status: 'queued', detail: describeDeliveryFailure(error) });
    throw error;
  }
  await settle(db, deliveryId, {
    status: 'sent',
    detail: runtime.transport.kind === 'capture' ? CAPTURED_DETAIL : null,
  });
}

/** After the job's last attempt: the delivery is failed, keeping its last error. */
export async function failEmailAfterRetries(db: Database, deliveryId: string): Promise<void> {
  await db
    .update(emailDeliveries)
    .set({ status: 'failed', updatedAt: now() })
    .where(and(eq(emailDeliveries.id, deliveryId), eq(emailDeliveries.status, 'queued')));
}
