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
