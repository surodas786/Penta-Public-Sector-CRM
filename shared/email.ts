/**
 * Email notifications and account emails (CR1, CR2, CR3): the templates an
 * administrator can edit, the placeholders each one accepts, and the default
 * wording used until an administrator saves their own.
 *
 * Recipients (D-EM-4 and the step 6 instruction; each template's
 * `recipients` says it to the administrator):
 *   - a reminder goes to the person responsible: the task's assignee, the
 *     owner of a tender or procurement cycle; leads and management keep
 *     their in-app alerts without an email for each;
 *   - an assignment goes to the new owner;
 *   - the team summary goes to each current section lead, once however many
 *     sections they lead, counting only what they can see when it is sent;
 *   - the management summary goes only to the management accounts an
 *     administrator chose;
 *   - delivery failures go to active administrators, as a count and a link,
 *     never a record or a recipient's detail.
 * Salespeople receive no summary: section membership never shows them a
 * colleague's records, in the app or by email.
 *
 * Content decision D-EM-2 (proposed default, awaiting Penta): emails carry no
 * commercial detail — no project names, values, owners or organizations.
 * They say what kind of thing needs attention and link into the CRM, where
 * access is checked again. Placeholders are therefore limited to the
 * recipient's name, dates and a link.
 */

export const EMAIL_TEMPLATE_KEYS = [
  'invitation',
  'password_reset',
  'password_changed',
  'follow_up_due_today',
  'follow_up_overdue',
  'tender_deadline',
  'ownership_changed',
  'eoi_deadline',
  'rfp_deadline',
  'team_summary',
  'management_summary',
  'delivery_failures',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

/**
 * Security messages (step 6): always sent while delivery is on. They cannot be
 * turned off, here or in the database (email_templates_security_enabled).
 */
export const MANDATORY_EMAIL_KEYS: readonly EmailTemplateKey[] = ['invitation', 'password_reset', 'password_changed'];

export function isMandatoryEmail(key: EmailTemplateKey): boolean {
  return MANDATORY_EMAIL_KEYS.includes(key);
}

export const EMAIL_SECURITY_MODES = ['none', 'starttls', 'tls'] as const;
export type EmailSecurityMode = (typeof EMAIL_SECURITY_MODES)[number];

export const EMAIL_SECURITY_LABELS: Record<EmailSecurityMode, string> = {
  none: 'None (plain SMTP)',
  starttls: 'STARTTLS (usually port 587)',
  tls: 'TLS (usually port 465)',
};

export const EMAIL_DELIVERY_STATUSES = ['queued', 'sent', 'failed', 'suppressed'] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

/** How this server sends mail; set by EMAIL_TRANSPORT, never from the browser. */
export const EMAIL_TRANSPORTS = ['none', 'capture', 'smtp'] as const;
export type EmailTransportKind = (typeof EMAIL_TRANSPORTS)[number];

export interface EmailTemplateDefinition {
  label: string;
  /** When it is sent, for the administrator. */
  sentWhen: string;
  /** Who receives it, for the administrator. */
  recipients: string;
  /** On or off until an administrator saves the template. */
  defaultEnabled: boolean;
  placeholders: readonly string[];
  /** Placeholders the template cannot work without. */
  required: readonly string[];
  defaultSubject: string;
  defaultBody: string;
}

const SIGN_OFF = '\n\n— {{appName}}\nThis is an automated message. Please do not reply.';

export const EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateDefinition> = {
  invitation: {
    recipients: 'The person the account is for.',
    defaultEnabled: true,
    label: 'Account invitation',
    sentWhen: 'An administrator creates an account or sends a new invitation.',
    placeholders: ['recipientName', 'link', 'expiresAt', 'appName'],
    required: ['link'],
    defaultSubject: 'Your {{appName}} account',
    defaultBody:
      'Dear {{recipientName}},\n\nAn account has been created for you in {{appName}}. Choose your password using this link:\n\n{{link}}\n\nThe link works once and expires on {{expiresAt}}. If you were not expecting this message, you can ignore it.' +
      SIGN_OFF,
  },
  password_reset: {
    recipients: 'The account holder.',
    defaultEnabled: true,
    label: 'Password reset',
    sentWhen: 'An administrator issues a reset link, or the person asks for one on the sign-in page.',
    placeholders: ['recipientName', 'link', 'expiresAt', 'appName'],
    required: ['link'],
    defaultSubject: 'Reset your {{appName}} password',
    defaultBody:
      'Dear {{recipientName}},\n\nA password reset was requested for your {{appName}} account. Choose a new password using this link:\n\n{{link}}\n\nThe link works once and expires on {{expiresAt}}. If you did not expect this, contact your administrator.' +
      SIGN_OFF,
  },
  password_changed: {
    recipients: 'The account holder.',
    defaultEnabled: true,
    label: 'Password changed',
    sentWhen: 'A person changes their own password.',
    placeholders: ['recipientName', 'changedAt', 'link', 'appName'],
    required: [],
    defaultSubject: 'Your {{appName}} password was changed',
    defaultBody:
      'Dear {{recipientName}},\n\nThe password for your {{appName}} account was changed on {{changedAt}}. Your other sessions have been signed out.\n\nIf you did not make this change, contact your administrator immediately.\n\n{{link}}' +
      SIGN_OFF,
  },
  follow_up_due_today: {
    recipients: "The follow-up's assignee only.",
    defaultEnabled: true,
    label: 'Follow-up due today',
    sentWhen: 'A follow-up you are responsible for is due today.',
    placeholders: ['recipientName', 'dueDate', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'A follow-up is due today',
    defaultBody: 'Dear {{recipientName}},\n\nA follow-up is due today ({{dueDate}}). Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  follow_up_overdue: {
    recipients: "The follow-up's assignee only.",
    defaultEnabled: true,
    label: 'Follow-up overdue',
    sentWhen: 'A follow-up you are responsible for has passed its due date.',
    placeholders: ['recipientName', 'dueDate', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'A follow-up is overdue',
    defaultBody: 'Dear {{recipientName}},\n\nA follow-up due on {{dueDate}} is overdue. Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  tender_deadline: {
    recipients: "The opportunity's owner only.",
    defaultEnabled: true,
    label: 'Tender deadline approaching',
    sentWhen: 'A current tender you are responsible for closes within the reminder time (72 hours unless changed in Notification timing).',
    placeholders: ['recipientName', 'deadline', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'A tender submission deadline is approaching',
    defaultBody: 'Dear {{recipientName}},\n\nA tender submission deadline is approaching: {{deadline}}. Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  ownership_changed: {
    recipients: 'The new owner only.',
    defaultEnabled: true,
    label: 'Ownership changed',
    sentWhen: 'An opportunity is transferred to you.',
    placeholders: ['recipientName', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'An opportunity has been transferred to you',
    defaultBody: 'Dear {{recipientName}},\n\nAn opportunity has been transferred to you. Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  eoi_deadline: {
    recipients: "The opportunity's owner only.",
    defaultEnabled: true,
    label: 'EOI deadline approaching',
    sentWhen: 'An EOI you are preparing is due within the reminder time (72 hours unless changed in Notification timing).',
    placeholders: ['recipientName', 'deadline', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'An EOI submission deadline is approaching',
    defaultBody:
      'Dear {{recipientName}},\n\nAn expression of interest (EOI) is due: {{deadline}}. Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  rfp_deadline: {
    recipients: "The opportunity's owner only.",
    defaultEnabled: true,
    label: 'RFP proposal deadline approaching',
    sentWhen: 'A proposal you are preparing for an RFP is due within the reminder time (72 hours unless changed in Notification timing).',
    placeholders: ['recipientName', 'deadline', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'An RFP proposal deadline is approaching',
    defaultBody:
      'Dear {{recipientName}},\n\nA proposal in response to an RFP is due: {{deadline}}. Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  team_summary: {
    recipients: 'Each current section lead, once however many sections they lead. The counts cover only what they can see when it is sent.',
    // New kinds of email are off until an administrator turns them on.
    defaultEnabled: false,
    label: 'Team summary',
    sentWhen: "On the summary schedule in Notification timing, when something in the lead's sections needs attention.",
    placeholders: ['recipientName', 'summaryDate', 'summary', 'link', 'appName'],
    required: ['summary', 'link'],
    defaultSubject: 'Your team summary for {{summaryDate}}',
    defaultBody:
      'Dear {{recipientName}},\n\nWhat needs attention in your sections on {{summaryDate}}:\n\n{{summary}}\n\nOpen the dashboard in {{appName}}:\n\n{{link}}' +
      SIGN_OFF,
  },
  management_summary: {
    recipients: 'Only the management accounts chosen in Notification timing.',
    defaultEnabled: false,
    label: 'Management summary',
    sentWhen: 'On the summary schedule in Notification timing, when something needs attention.',
    placeholders: ['recipientName', 'summaryDate', 'summary', 'link', 'appName'],
    required: ['summary', 'link'],
    defaultSubject: 'Management summary for {{summaryDate}}',
    defaultBody:
      'Dear {{recipientName}},\n\nWhat needs attention across all sections on {{summaryDate}}:\n\n{{summary}}\n\nOpen the dashboard in {{appName}}:\n\n{{link}}' +
      SIGN_OFF,
  },
  delivery_failures: {
    recipients: 'Active system administrators: a count and a link, never a record, recipient or message.',
    defaultEnabled: true,
    label: 'Email delivery failures',
    sentWhen: 'An email fails after its last attempt. At most one a day for each administrator.',
    placeholders: ['recipientName', 'failedCount', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'Some {{appName}} emails could not be delivered',
    defaultBody:
      'Dear {{recipientName}},\n\nEmails that failed in the last 24 hours: {{failedCount}}. The delivery log in Administration shows which, and allows a controlled retry:\n\n{{link}}' +
      SIGN_OFF,
  },
};

/** The emails that follow an in-app alert: one email per alert, to the person responsible. */
export const ALERT_EMAIL_KEYS: readonly EmailTemplateKey[] = [
  'follow_up_due_today',
  'follow_up_overdue',
  'tender_deadline',
  'ownership_changed',
  'eoi_deadline',
  'rfp_deadline',
];

// ---------------------------------------------------------------------------
// Notification timing (step 6), set by the administrator
// ---------------------------------------------------------------------------

export const SUMMARY_FREQUENCIES = ['daily', 'weekly'] as const;
export type SummaryFrequency = (typeof SUMMARY_FREQUENCIES)[number];

/** Index 0 is Sunday, the first day of the Bangladesh working week. */
export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * A deadline reminder is emailed from its in-app alert, which appears 72 hours
 * before the deadline (FR-090). The email can therefore come later, never
 * earlier.
 */
export const DEADLINE_REMINDER_MAX_HOURS = 72;

/** Used until an administrator saves notification timing. */
export const NOTIFICATION_TIMING_DEFAULTS = {
  /** The Bangladesh-time hour from which follow-up reminders and summaries go out. */
  reminderHour: 9,
  tenderReminderHours: 72,
  eoiReminderHours: 72,
  rfpReminderHours: 72,
  summaryFrequency: 'weekly' as SummaryFrequency,
  summaryWeekday: 0,
};

export const EMAIL_APP_NAME = 'Penta CRM';

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/**
 * Problems with a template's subject or body, by field. Unknown placeholders
 * and stray braces are refused so a typo cannot silently send "{{linkk}}".
 */
export function templateProblems(
  key: EmailTemplateKey,
  content: { subject: string; bodyText: string },
): Record<string, string> {
  const definition = EMAIL_TEMPLATES[key];
  const problems: Record<string, string> = {};
  for (const [field, text] of [
    ['subject', content.subject],
    ['bodyText', content.bodyText],
  ] as const) {
    const unknown = [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!).filter((name) => !definition.placeholders.includes(name));
    if (unknown.length > 0) {
      problems[field] = `Unknown placeholder ${unknown.map((name) => `{{${name}}}`).join(', ')}. Use only: ${definition.placeholders
        .map((name) => `{{${name}}}`)
        .join(', ')}.`;
      continue;
    }
    if (/\{\{|\}\}/.test(text.replace(PLACEHOLDER, ''))) {
      problems[field] = 'A placeholder is not closed. Write placeholders as {{name}}.';
    }
  }
  const used = new Set([...`${content.subject}\n${content.bodyText}`.matchAll(PLACEHOLDER)].map((match) => match[1]!));
  const missing = definition.required.filter((name) => !used.has(name));
  if (missing.length > 0 && !problems.bodyText) {
    problems.bodyText = `This email must include ${missing.map((name) => `{{${name}}}`).join(', ')}.`;
  }
  return problems;
}

/** Fills placeholders with plain text. Values are never interpreted as templates themselves. */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (_whole, name: string) => values[name] ?? '');
}
