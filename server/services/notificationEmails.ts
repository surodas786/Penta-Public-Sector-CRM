/**
 * Notification emails beyond single alerts (CR2, step 6): the administrator's
 * notification timing, the team and management summaries, and the count
 * behind the administrators' delivery-failure notice.
 *
 * Recipients (shared/email.ts has the full list):
 *   - team summary: every current section lead, one email however many
 *     sections they lead (the dedupe key is the person and the day);
 *   - management summary: only the management accounts an administrator
 *     chose, re-checked when saved and when sent;
 *   - salespeople receive no summary, so section membership never shows
 *     them a colleague's records by email.
 *
 * A summary is only counts and a link (D-EM-2), computed when it is sent, in
 * the recipient's scope at that moment, from the metric definitions the
 * dashboard uses (FR-081).
 */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { NotificationTimingDto } from '../../shared/api.js';
import { NOTIFICATION_TIMING_DEFAULTS, type SummaryFrequency } from '../../shared/email.js';
import type { updateNotificationTimingSchema } from '../../shared/validation.js';
import { dhakaDateOf, dhakaHourOf, now, weekdayOf } from '../clock.js';
import type { Database } from '../db/client.js';
import { emailDeliveries, emailNotificationSettings, followUps, opportunities, procurementCycles, sections, tenders, users } from '../db/schema.js';
import { forbidden, validationFailed, versionConflict } from '../http/errors.js';
import { hasCoherentScope, loadActor, type Actor } from '../policy/actor.js';
import { canAdministerAccounts, scopedWhere } from '../policy/scope.js';
import { beginAdministrativeChange } from './admin.js';
import { diffRecords, recordAuditEvent } from './audit.js';
import { configurationEntityId, enabledEmailKeys, isEmailDeliveryOn, queueEmail } from './email.js';
import {
  SEVEN_DAYS_HOURS,
  dueTodayFollowUp,
  overdueFollowUp,
  procurementDueWithin,
  procurementOverdue,
  tenderDueWithin,
} from './metrics.js';

export interface NotificationTiming {
  reminderHour: number;
  tenderReminderHours: number;
  eoiReminderHours: number;
  rfpReminderHours: number;
  summaryFrequency: SummaryFrequency;
  summaryWeekday: number;
  managementSummaryRecipientIds: string[];
}

async function readTimingRow(db: Database, options: { lock?: boolean } = {}) {
  const query = db.select().from(emailNotificationSettings).where(eq(emailNotificationSettings.id, 1)).limit(1);
  const [row] = options.lock ? await query.for('update') : await query;
  return row ?? null;
}

/** The administrator's timing, or the defaults until one is saved. */
export async function readNotificationTiming(db: Database): Promise<NotificationTiming> {
  const row = await readTimingRow(db);
  return {
    reminderHour: row?.reminderHour ?? NOTIFICATION_TIMING_DEFAULTS.reminderHour,
    tenderReminderHours: row?.tenderReminderHours ?? NOTIFICATION_TIMING_DEFAULTS.tenderReminderHours,
    eoiReminderHours: row?.eoiReminderHours ?? NOTIFICATION_TIMING_DEFAULTS.eoiReminderHours,
    rfpReminderHours: row?.rfpReminderHours ?? NOTIFICATION_TIMING_DEFAULTS.rfpReminderHours,
    summaryFrequency: (row?.summaryFrequency as SummaryFrequency | undefined) ?? NOTIFICATION_TIMING_DEFAULTS.summaryFrequency,
    summaryWeekday: row?.summaryWeekday ?? NOTIFICATION_TIMING_DEFAULTS.summaryWeekday,
    managementSummaryRecipientIds: row?.managementSummaryRecipientIds ?? [],
  };
}

function assertAdministrator(actor: Actor): void {
  if (!canAdministerAccounts(actor)) throw forbidden('Email settings are limited to the System Administrator.');
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function getNotificationTiming(db: Database, actor: Actor): Promise<NotificationTimingDto> {
  assertAdministrator(actor);
  const row = await readTimingRow(db);
  const timing = await readNotificationTiming(db);
  const editor = alias(users, 'editor');
  const [updatedBy] = row?.updatedBy
    ? await db.select({ name: editor.fullName }).from(editor).where(eq(editor.id, row.updatedBy)).limit(1)
    : [];
  // Active management accounts can be chosen; one already chosen stays listed
  // after deactivation or a role change, marked, so the list never hides it.
  const candidates = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, active: users.active, role: users.role })
    .from(users)
    .where(
      timing.managementSummaryRecipientIds.length > 0
        ? sql`(${users.role} = 'management' AND ${users.active}) OR ${inArray(users.id, timing.managementSummaryRecipientIds)}`
        : and(eq(users.role, 'management'), eq(users.active, true)),
    )
    .orderBy(asc(users.fullName), asc(users.id));
  return {
    ...timing,
    managementCandidates: candidates.map((candidate) => ({
      id: candidate.id,
      fullName: candidate.fullName,
      email: candidate.email,
      eligible: candidate.active && candidate.role === 'management',
    })),
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedByName: updatedBy?.name ?? null,
  };
}

export async function updateNotificationTiming(options: {
  db: Database;
  actor: Actor;
  command: z.output<typeof updateNotificationTimingSchema>;
  requestId: string;
}): Promise<NotificationTimingDto> {
  const { db, actor, command, requestId } = options;
  assertAdministrator(actor);

  await db.transaction(async (tx) => {
    await beginAdministrativeChange(tx, actor);
    const current = await readTimingRow(tx, { lock: true });
    if ((current?.version ?? 0) !== command.version) throw versionConflict();

    // A client-supplied id grants nothing: each must be an active management
    // account now. It is checked again whenever a summary is sent.
    const chosen = [...new Set(command.managementSummaryRecipientIds)].sort();
    if (chosen.length > 0) {
      const eligible = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, chosen), eq(users.role, 'management'), eq(users.active, true)));
      if (eligible.length !== chosen.length) {
        throw validationFailed({ managementSummaryRecipientIds: 'Choose active management accounts only.' });
      }
    }

    const before = await readNotificationTiming(tx);
    const next = {
      reminderHour: command.reminderHour,
      tenderReminderHours: command.tenderReminderHours,
      eoiReminderHours: command.eoiReminderHours,
      rfpReminderHours: command.rfpReminderHours,
      summaryFrequency: command.summaryFrequency,
      summaryWeekday: command.summaryWeekday,
      managementSummaryRecipientIds: chosen,
    };
    // The recipient list is compared as text; the audit records the lists.
    const listed = (ids: string[]) => [...ids].sort().join(',');
    const diff = diffRecords(
      { ...before, managementSummaryRecipientIds: listed(before.managementSummaryRecipientIds) },
      { ...next, managementSummaryRecipientIds: listed(chosen) },
    );
    if (diff.changed.length === 0) return;
    if (diff.changed.includes('managementSummaryRecipientIds')) {
      diff.before.managementSummaryRecipientIds = [...before.managementSummaryRecipientIds].sort();
      diff.after.managementSummaryRecipientIds = chosen;
    }

    const timestamp = now();
    if (current) {
      const updated = await tx
        .update(emailNotificationSettings)
        .set({ ...next, updatedBy: actor.id, updatedAt: timestamp, version: sql`${emailNotificationSettings.version} + 1` })
        .where(and(eq(emailNotificationSettings.id, 1), eq(emailNotificationSettings.version, command.version)))
        .returning({ id: emailNotificationSettings.id });
      if (updated.length === 0) throw versionConflict();
    } else {
      const inserted = await tx
        .insert(emailNotificationSettings)
        .values({ id: 1, ...next, updatedBy: actor.id, updatedAt: timestamp })
        .onConflictDoNothing()
        .returning({ id: emailNotificationSettings.id });
      if (inserted.length === 0) throw versionConflict();
    }

    await recordAuditEvent(tx, {
      actorId: actor.id,
      entityType: 'email_settings',
      entityId: configurationEntityId('email_notification_settings'),
      action: 'email.notification_timing_updated',
      domain: 'administrative',
      before: diff.before,
      after: diff.after,
      requestId,
    });
  });

  return getNotificationTiming(db, actor);
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

const SUMMARY_KEYS = ['team_summary', 'management_summary'] as const;
type SummaryKey = (typeof SUMMARY_KEYS)[number];

/**
 * Queues today's summaries once the reminder hour has come, on the chosen day
 * (step 6). Called by every hourly scan; the dedupe key (summary, person,
 * Dhaka date) makes later calls the same day queue nothing. A missed day is
 * never caught up.
 */
export async function queueSummaryEmails(db: Database, at: Date = now()): Promise<number> {
  if (!(await isEmailDeliveryOn(db))) return 0;
  const enabled = (await enabledEmailKeys(db)).filter((key): key is SummaryKey => (SUMMARY_KEYS as readonly string[]).includes(key));
  if (enabled.length === 0) return 0;
  const timing = await readNotificationTiming(db);
  const today = dhakaDateOf(at);
  if (timing.summaryFrequency === 'weekly' && weekdayOf(today) !== timing.summaryWeekday) return 0;
  if (dhakaHourOf(at) < timing.reminderHour) return 0;

  const recipients: { key: SummaryKey; userId: string }[] = [];
  if (enabled.includes('team_summary')) {
    // Each current lead once, however many active sections they lead.
    const leads = await db
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(sections, and(eq(sections.leadUserId, users.id), eq(sections.active, true)))
      .where(and(eq(users.role, 'lead'), eq(users.active, true)))
      .orderBy(asc(users.id));
    recipients.push(...leads.map((lead) => ({ key: 'team_summary' as const, userId: lead.id })));
  }
  if (enabled.includes('management_summary') && timing.managementSummaryRecipientIds.length > 0) {
    const chosen = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, timing.managementSummaryRecipientIds), eq(users.role, 'management'), eq(users.active, true)))
      .orderBy(asc(users.id));
    recipients.push(...chosen.map((person) => ({ key: 'management_summary' as const, userId: person.id })));
  }
  if (recipients.length === 0) return 0;

  return db.transaction(async (tx) => {
    let queued = 0;
    for (const { key, userId } of recipients) {
      const id = await queueEmail(tx, {
        templateKey: key,
        recipientUserId: userId,
        dedupeKey: `summary:${key}:${userId}:${today}`,
        context: { summaryDate: today },
      });
      if (id) queued += 1;
    }
    return queued;
  });
}

/**
 * What needs attention in the actor's scope now: counts only, from the
 * dashboard's metric definitions, inside `scopedWhere` (FR-081).
 */
async function attentionCounts(db: Database, actor: Actor, at: Date) {
  const today = dhakaDateOf(at);
  const [tasks] = await db
    .select({
      overdue: sql<number>`count(*) FILTER (WHERE ${overdueFollowUp(today)})::int`,
      dueToday: sql<number>`count(*) FILTER (WHERE ${dueTodayFollowUp(today)})::int`,
    })
    .from(followUps)
    .innerJoin(opportunities, eq(opportunities.id, followUps.opportunityId))
    .where(scopedWhere(actor));
  const [tenderRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenders)
    .innerJoin(opportunities, eq(opportunities.id, tenders.opportunityId))
    .where(scopedWhere(actor, tenderDueWithin(at, SEVEN_DAYS_HOURS)));
  const [procurement] = await db
    .select({
      dueSoon: sql<number>`count(*) FILTER (WHERE ${procurementDueWithin(at, SEVEN_DAYS_HOURS)})::int`,
      missed: sql<number>`count(*) FILTER (WHERE ${procurementOverdue(at)})::int`,
    })
    .from(procurementCycles)
    .innerJoin(opportunities, eq(opportunities.id, procurementCycles.opportunityId))
    .where(scopedWhere(actor));
  return [
    ['Overdue follow-ups', tasks?.overdue ?? 0],
    ['Follow-ups due today', tasks?.dueToday ?? 0],
    ['Tender submissions in the next 7 days', tenderRow?.count ?? 0],
    ['EOI and proposal deadlines in the next 7 days', procurement?.dueSoon ?? 0],
    ['EOI and proposal deadlines passed without a submission', procurement?.missed ?? 0],
  ] as const;
}

/**
 * For the send job: the summary's text for this recipient now, or why it is
 * not sent. The recipient must still be an active lead of an active section
 * (team) or an active management account still chosen (management), and the
 * summary must be for today: a delayed one is not sent a day late.
 */
export async function summaryFor(
  db: Database,
  key: SummaryKey,
  recipientId: string,
  summaryDate: unknown,
): Promise<{ ok: true; text: string; summaryDate: string } | { ok: false; reason: string }> {
  const at = now();
  const today = dhakaDateOf(at);
  if (summaryDate !== today) return { ok: false, reason: 'The summary was for an earlier day.' };

  const actor = await loadActor(db, recipientId);
  if (!actor?.active) return { ok: false, reason: 'The recipient account is inactive.' };
  if (key === 'team_summary' && (actor.role !== 'lead' || !hasCoherentScope(actor))) {
    return { ok: false, reason: 'The recipient no longer leads an active section.' };
  }
  if (key === 'management_summary') {
    const timing = await readNotificationTiming(db);
    if (actor.role !== 'management' || !timing.managementSummaryRecipientIds.includes(actor.id)) {
      return { ok: false, reason: 'The recipient is no longer a chosen management summary recipient.' };
    }
  }

  const counts = await attentionCounts(db, actor, at);
  if (counts.every(([, value]) => value === 0)) return { ok: false, reason: 'Nothing needed attention.' };
  return { ok: true, text: counts.map(([label, value]) => `- ${label}: ${value}`).join('\n'), summaryDate: today };
}

// ---------------------------------------------------------------------------
// Delivery failures
// ---------------------------------------------------------------------------

/** Emails that failed in the last 24 hours, other than the failure notices themselves. */
export async function deliveryFailureCount(db: Database, at: Date = now()): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.status, 'failed'),
        ne(emailDeliveries.templateKey, 'delivery_failures'),
        sql`${emailDeliveries.updatedAt} > ${at.toISOString()}::timestamptz - interval '24 hours'`,
      ),
    );
  return row?.value ?? 0;
}
