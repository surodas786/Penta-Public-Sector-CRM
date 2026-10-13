# ADR 0011 — Email delivery (CR2, with CR1 and CR3)

Status: accepted for implementation, 12 October 2026. Supersedes the
"no email sending" exclusion of requirements §1.3, for email only.

## Context

CR2 asks for email notifications, with the mail server configuration and the
email content managed in the Admin portal. CR1 and CR3 need the same path
for invitations and "password changed" messages.

Penta has not yet chosen a mail server (decision D-EM-1). Nothing may send
real email until that decision is made and deployment is authorized. Emails
leave the system, so their content is decision D-EM-2. Until Penta decides,
the proposed default applies: no commercial detail, only the recipient's
name, dates and a link into the CRM.

## Decision

### Who decides what

- **The deployment** decides *whether* it may send, with `EMAIL_TRANSPORT`:
  - `none`: nothing is sent. This is the production default.
  - `capture`: development and tests. Each message is written as a JSON file
    and never leaves the machine. Production refuses this value; the
    production-server check verifies it.
  - `smtp`: messages go to the administrator's mail server.
- **The System Administrator** decides *how*: the mail server, sender,
  credentials and wording, on the Administration page.

### Storage (migration 0009)

- **`email_settings`**: at most one row. No row means delivery is off. The
  SMTP password is stored only as AES-256-GCM ciphertext, keyed by
  `EMAIL_SECRET_KEY`, which never enters the database. It uses the backup
  construction with a different key and purpose-bound additional data. The
  API reports whether a password is stored and whether it can still be
  decrypted, never the password itself. The audit records "replaced" or
  "removed", never the value.
- **`email_templates`**: rows exist only for wording an administrator has
  changed. The defaults live once, in `shared/email.ts`, where both the
  server and the "Restore default wording" button use them.
- **`email_deliveries`**: the log of what was meant to be sent and what
  happened. It never holds the message body, which may carry a single-use
  link.
- **No deletion.** The runtime role cannot delete from any of these tables.

### Templates

- Each template has an allowlist of placeholders, and some are required (for
  example, an invitation must contain `{{link}}`).
- An unknown placeholder, an unclosed brace, or a line break in the subject
  is refused. The database also refuses a line break in a stored subject,
  because it would be a header injection.
- **Plain text only.** No HTML is accepted or sent. Placeholders are
  replaced with server-computed text, never markup or code, so there is no
  HTML to escape or sanitise and no template logic to run.
- Previews render with synthetic sample values, never a real record.
- **Version history** is the administrative audit: each save records the
  fields it changed. Replaying them over the default wording rebuilds every
  saved version in full, newest first. An administrator can load an earlier
  wording into the editor and save it; "Restore default wording" does the
  same with the default. No extra table is needed.

### Sending

- **Queueing.** `queueEmail` records a delivery and queues an `email.send` job
  in the caller's transaction, only while delivery is on.
- **The job re-checks everything** when it runs:
  - delivery still on;
  - the transport allows sending;
  - the template is still on;
  - the recipient is still active;
  - the password can still be decrypted.

  Then it renders the current wording and sends.
- **Outcomes.**
  - A suppressed delivery records why.
  - A failure is retried with the queue's backoff. After the last attempt it
    is marked failed, and it shows in the job health check (NFR-003).
- **Error text** in the log is sanitised: the error class, the SMTP code and
  the first line of the reply. It never includes credentials or content.
- **At least once.** The send happens outside any transaction, so a crash
  between sending and recording "sent" can repeat one message. That is
  accepted over the alternative, which is losing a message.
- **Test message.** It is sent synchronously and logged and audited, so an
  administrator learns at once whether the settings work, even while
  delivery is still off.
- **Connection check.** It connects and signs in to the saved server (SMTP
  `verify`) and sends nothing. It is not audited, because it changes
  nothing. With `capture` or `none` it contacts no server and says so.
- **What "sent" means.** The stored status `sent` means the mail server
  accepted the message. The interface says "Accepted by mail server",
  because the CRM cannot know whether the message reached an inbox. A
  message written by the development capture transport shows "Captured, not
  sent".
- **Controlled retry.** An administrator can queue a failed email again:
  - failed emails only, never a test message;
  - at most three times;
  - only while delivery is on;
  - audited as `email.delivery_retried`.

  The job then re-checks everything, exactly as the first time. An account
  link is issued afresh, voiding the earlier one.

### Library

nodemailer 10.0.10 (exact version). It is maintained, ships its own types,
supports Node 22, and added no production audit findings.

## Consequences

- **Real sending needs, in production:**
  - `EMAIL_TRANSPORT=smtp`;
  - an `EMAIL_SECRET_KEY` if the server needs a password;
  - Penta's mail server details, entered by an administrator.

  Until then, production records nothing as sent.
- **Rotating `EMAIL_SECRET_KEY`** makes the stored password unreadable. The
  page says so, and the administrator enters it again.
- **CR1** (step 4, implemented) adds invitation and reset emails through
  `queueEmail`:
  - The token is issued only by the send job. The issue is audited as
    `account.invitation_issued` or `account.reset_issued`, with the
    requesting administrator as actor, and the expiry counts from sending.
  - No readable link rests in the queue, the delivery log or the audit.
  - A retry issues a fresh link that voids the earlier one.
  - The send is skipped if the account was deactivated, or the invitation
    was accepted, in the meantime.
  - "Copy link" (D-CR1-1) still shows a link once. It also cancels any
    account email still queued for that person, which would otherwise issue
    a newer link and void the copied one.
  - While delivery is off, or `EMAIL_TRANSPORT=none`, the copy-the-link path
    is the only one, exactly as in release one.
- **CR2 notifications** (step 5, implemented) add alert emails:
  - When an alert is created, an email is queued in the same transaction,
    only for the person responsible (D-EM-4, proposed default). That is the
    task's assignee, the tender's owner, or the new owner after a transfer.
    Leads and management keep their in-app alerts without an email for each.
  - One email per alert: the dedupe key is the alert id, so repeated scans
    send nothing new.
  - At send time `deliverableAlert` applies the same `stillValid` definition
    as every inbox read. The alert must still be true, still unread and still
    permitted; otherwise the email is suppressed with the reason.
  - The message gives the kind of alert, the date or deadline and a link to
    the record, where access is checked again. It carries no name, value or
    organization (D-EM-2).
  - Dates use the interface's own format (`notifications.ts`), so
    "29 Sep 2026" reads the same in the app and in an email.

## Addendum: step 6, notification email events (13 October 2026)

Step 6 connects email to the in-app notifications and to the Software
Procurement cycles (CR6). Migration 0012.

### Events

| Event | Template | On by default |
| --- | --- | --- |
| Invitation, password reset, password changed | `invitation`, `password_reset`, `password_changed` | **Always.** Security messages cannot be turned off, in the service or in the database (`email_templates_security_enabled`) |
| Ownership assignment or change | `ownership_changed` | Yes |
| Follow-up due today, overdue | `follow_up_due_today`, `follow_up_overdue` | Yes |
| Tender deadline approaching | `tender_deadline` | Yes |
| EOI deadline approaching | `eoi_deadline` (new) | Yes |
| RFP proposal deadline approaching | `rfp_deadline` (new) | Yes |
| Team summary | `team_summary` (new) | **No**: a new kind of email, turned on by an administrator |
| Management summary | `management_summary` (new) | **No**, and sent only to the people chosen |
| Delivery failures | `delivery_failures` (new) | Yes |

No email was added for any other event.

### Recipients

- **Reminders** go to the person responsible: the task's assignee, the
  owner of the tender's or procurement cycle's opportunity (D-EM-4).
- **Assignment** goes to the new owner.
- **Team summary** goes to each current lead of an active section, once a
  day however many sections they lead (the dedupe key is the person and the
  Dhaka date). It counts what the lead can see when it is sent.
- **Management summary** goes only to the management accounts the
  administrator ticked. The ids are checked when saved (active management
  accounts only) and again when sent.
- **Delivery failures** go to active administrators: a count and a link to
  the delivery log, never a record, a recipient or a message.
- **Salespeople** receive no summary. Their reminders concern only tasks
  assigned to them and records they own, so a shared section never shows
  them a colleague's records by email.

### Content

D-EM-2 is unchanged: no project name, organization, value or reference. A
summary is a list of counts from the dashboard's metric definitions
(`metrics.ts`, inside `scopedWhere`): overdue follow-ups, follow-ups due
today, tender submissions in the next 7 days, EOI and proposal deadlines in
the next 7 days, and missed EOI and proposal deadlines. A summary with
nothing to report is not sent.

### Timing (`email_notification_settings`)

- **Reminder hour**, Bangladesh time (default 09:00): follow-up reminders
  and summaries wait until then.
- **Deadline reminders**: tender, EOI and RFP, each 1 to 72 hours before
  the deadline (default 72). The email follows the in-app alert, which
  appears 72 hours ahead (FR-090), so it can be later, never earlier.
  FR-090's alert window is unchanged.
- **Summaries**: daily, or weekly on a chosen day (default Sunday).

Alert emails are no longer queued in the alert's own transaction.
`queueDueAlertEmails` runs in every scan and refresh and queues each alert's
email once its time has come. The alert's id remains the dedupe key, so
there is still at most one email per alert.

**No flood.** An email whose moment passed more than 24 hours ago is not
sent late. Turning delivery on, or restarting a stopped worker, never
releases a backlog of old reminders. The alerts stay in the app.

### Staleness

An email is re-checked before it is sent, and suppressed with the reason if
anything has changed:

- **Alert emails:** the alert must still be true, unread, permitted and the
  recipient's responsibility.
- **Summaries:** must be for today. The recipient must still lead an active
  section, or still be a chosen, active management account.
- **Failure notices:** the recipient must still be an administrator.

Some changes suppress a queued email at once:

- **Opportunity and cycle changes:** completion, rescheduling, a transfer,
  a stage change, a tender change, and every procurement cycle change
  (created, edited, milestone reached, cancelled). These retire the alert in
  their own transaction, and `retireObsoleteAlerts` marks its queued email
  `suppressed`.
- **Account and section changes** (step 6): a role change, a membership
  ended, a lead replaced, an account or section deactivated. These queue a
  scan in their own transaction, which does the same once they commit.

### Failures and retry

- **Retries:** a failing message is retried with the queue's backoff.
- **Final failure:** after the last attempt it is `failed`, and each active
  administrator is sent one notice that Bangladesh day, however many emails
  fail. A failed notice causes no further notice.
- **Controlled retry:** unchanged. It re-runs every check, creates no new
  delivery and can never send an obsolete reminder.

### Links

- **What they contain:** a path into the application and nothing else, no
  token.
- **Sign-in:** the page that receives a signed-out reader sends them to sign
  in, then back to that path (`returnPath`, same-site paths only).
- **Access:** the record is then loaded through the API, which checks the
  reader's access at that moment. A record they can no longer see is the
  standard 404.

### In-app notifications without email

- **Alerts do not depend on email.** They are created whether or not
  delivery is on, `EMAIL_TRANSPORT=none` or the mail server fails.
- **New alert types:** `eoi_deadline` and `rfp_deadline`, linked to the
  cycle, cover the current cycle's open deadline within 72 hours. They follow
  the same rule as the procurement dashboard metric
  (`workingProcurementCycle`).
