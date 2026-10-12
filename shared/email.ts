/**
 * Email notifications and account emails (CR1, CR2, CR3): the templates an
 * administrator can edit, the placeholders each one accepts, and the default
 * wording used until an administrator saves their own.
 *
 * Recipients, decision D-EM-4 (proposed default, awaiting Penta): an alert is
 * emailed only to the person responsible for it (the task's assignee, the
 * record's owner, the new owner after a transfer). Leads and management keep
 * their in-app alerts without an email for each.
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
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

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
  placeholders: readonly string[];
  /** Placeholders the template cannot work without. */
  required: readonly string[];
  defaultSubject: string;
  defaultBody: string;
}

const SIGN_OFF = '\n\n— {{appName}}\nThis is an automated message. Please do not reply.';

export const EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateDefinition> = {
  invitation: {
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
    label: 'Password reset',
    sentWhen: 'An administrator issues a password reset link.',
    placeholders: ['recipientName', 'link', 'expiresAt', 'appName'],
    required: ['link'],
    defaultSubject: 'Reset your {{appName}} password',
    defaultBody:
      'Dear {{recipientName}},\n\nA password reset was requested for your {{appName}} account. Choose a new password using this link:\n\n{{link}}\n\nThe link works once and expires on {{expiresAt}}. If you did not expect this, contact your administrator.' +
      SIGN_OFF,
  },
  password_changed: {
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
    label: 'Follow-up due today',
    sentWhen: 'A follow-up you are responsible for is due today.',
    placeholders: ['recipientName', 'dueDate', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'A follow-up is due today',
    defaultBody: 'Dear {{recipientName}},\n\nA follow-up is due today ({{dueDate}}). Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  follow_up_overdue: {
    label: 'Follow-up overdue',
    sentWhen: 'A follow-up you are responsible for has passed its due date.',
    placeholders: ['recipientName', 'dueDate', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'A follow-up is overdue',
    defaultBody: 'Dear {{recipientName}},\n\nA follow-up due on {{dueDate}} is overdue. Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  tender_deadline: {
    label: 'Tender deadline within 72 hours',
    sentWhen: 'A current tender you are responsible for closes within 72 hours.',
    placeholders: ['recipientName', 'deadline', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'A tender submission deadline is approaching',
    defaultBody: 'Dear {{recipientName}},\n\nA tender submission deadline is approaching: {{deadline}}. Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
  ownership_changed: {
    label: 'Ownership changed',
    sentWhen: 'An opportunity is transferred to you.',
    placeholders: ['recipientName', 'link', 'appName'],
    required: ['link'],
    defaultSubject: 'An opportunity has been transferred to you',
    defaultBody: 'Dear {{recipientName}},\n\nAn opportunity has been transferred to you. Open it in {{appName}}:\n\n{{link}}' + SIGN_OFF,
  },
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
