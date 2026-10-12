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
- Messages are plain text only.
- Previews render with synthetic sample values, never a real record.

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
- **CR2 notifications** (step 5) add alert emails, with access rechecked at
  send time.
