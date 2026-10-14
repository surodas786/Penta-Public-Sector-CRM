# Change requests CR1–CR6 — release handover for staging UAT

**Date:** 13 October 2026 · **Branch:** `cr-change-requests` · **Base:**
Milestone 8 (`e9a8e1b`, release one plus the Chrome cookie fix)
**Status:** verified as one change set in development and test (step 7).
**Not deployed.** No live data was migrated and no real email was sent. Ready
for **staging UAT** once a staging environment exists. **Not** ready for
production: the release blockers in §8 remain.

What changed, and why, is in `docs/change-requests.md` and ADRs 0010–0012.
The evidence is in `docs/progress.md` (step 7) and
`docs/release/acceptance-matrix.md`.

---

## 1. What the change set contains

| CR | Change | Migration |
| --- | --- | --- |
| CR3 | Change your own password; "Forgot your password?" while email is on | none |
| CR4 + CR5 | A lead may lead several sections; a salesperson may belong to several; every active section has exactly one active lead | 0008 |
| CR2 (foundation) | Mail server settings (encrypted password), editable templates, delivery log, test message, connection check, controlled retry | 0009 |
| CR1 | Invitation and reset links by email, issued only when sent; link states; manual copy fallback | (0009) |
| CR6 | Separate Software Procurement cycles: EOI → shortlisting → RFP → proposal → evaluation → outcome | 0010 (superseded), 0011 |
| CR2 (step 6) | EOI/RFP deadline alerts, notification emails with timing, team and management summaries, failure notices; security emails mandatory | 0012 |

---

## 2. Migration

Five migrations: **0008, 0009, 0010, 0011, 0012**, in that order. 0010 is
the first CR6 design; 0011 retires most of it, but 0010 must still be applied
before 0011. Each has:

- a reviewed plain-SQL script in `docs/operations/sql/`;
- pre-flight checks;
- order guards;
- rollback steps in its header.

**How to run them:** `docs/operations/sql/sql_instructions.md`, with
checksums and the expected `created_at` after each script. Use **either**
the scripts (`psql` as `penta_migrator`) **or** `npm run db:migrate`, never
both for the same migration.

### Pre-flight checks that can stop a script

Each script is one transaction, so a refused script changes nothing.

| Script | Stops when | Fix |
| --- | --- | --- |
| 0008 | An active section has no active lead; a lead pointer disagrees with the users table; an opportunity's section is not its owner's | Fix with the release-one application, then rerun |
| 0011 | Anything still uses 0010's workflow, stages or tender phases | Only if 0010's design was used; correct the named records |
| 0012 | A security email (invitation, reset, password changed) is turned off | Turn it on in Administration, then rerun |

### Treatment of existing users and section assignments (0008)

- **Salespeople:** each gets one open membership of the section in
  `users.section_id`, inactive accounts included (their history stays
  explainable). Nobody gains or loses a record.
- **Leads:** leadership comes only from `sections.lead_user_id`, which
  release one already kept. A lead's scope is the sections they lead.
- **`users.section_id`:** stays as legacy data, no longer read. Reporting
  lines (`manager_id`) for salespeople are derived from section leads.
- **Management and administrators:** unchanged.
- **Email:** nothing is sent after the upgrade. No mail server is configured
  and delivery is off until an administrator turns it on. Security templates
  are on; the new summaries are off.
- **Invitations:** links already issued in release one keep working under
  the same rules until they expire, because no change-request migration
  touches the token table. New links are emailed only once delivery is on;
  until then the copy-link path is the only one.

**Rehearsed (13 October 2026).** A database at 0007 was filled with the
release-one synthetic data by the release-one code, including its own
alerts (10 accounts, 23 opportunities, 40 alerts). The five production
scripts were then applied in order:

- **Scope:** every account sees exactly the same records before (release-one
  code) and after (current code): 10 of 10 accounts identical.
- **Data:** row counts are unchanged.
- **Memberships:** created for all seven salespeople, the inactive one
  included.
- **Re-runs:** `db:migrate` afterwards changed nothing.
- **Alerts:** the current notification scan kept all 40 release-one alerts
  (none retired, none duplicated) and queued no email.

The scratch database was then dropped.

---

## 3. Deployment

Follow `docs/operations/deployment-and-migrations.md` §2 (release procedure)
and §3.1–§3.5 (one subsection per migration).

1. **Backup first** (§5 below). Stop the application and any separate worker.
2. **Run the five scripts**, or `npm run db:migrate`, as the schema owner.
3. **Set the new configuration** (§4).
4. **Deploy the code** at the step 7 commit or later on `cr-change-requests`.
   It expects migration 0012.
5. **Start the API and the worker** (§6).
6. **Check:**
   - `GET /api/health/ready` returns ok;
   - `npm run check:production-server` passes against the build;
   - management opens the Dashboard, Opportunities, Software Procurement and
     Reports;
   - the administrator opens Administration: Sections, Email delivery
     ("Off"), Email templates and Notification timing.

---

## 4. Required configuration

| Variable | Production value | Notes |
| --- | --- | --- |
| `EMAIL_TRANSPORT` | `none` until D-EM-1 is decided; then `smtp` | `capture` is refused in production (`check:production-server` verifies it). With `none`, queued emails are marked "Not sent" with the reason and in-app alerts still work |
| `EMAIL_SECRET_KEY` | 64 hex characters (`openssl rand -hex 32`), in the secret store | Encrypts the SMTP password at rest (AES-256-GCM). Different from every other key. Without it no SMTP password can be saved. Rotating it makes the saved password unreadable: the page says so, and the administrator enters it again |
| `EMAIL_SEND_TIMEOUT_SECONDS` | 20 (default) | Upper bound for one SMTP conversation |
| `APP_ORIGIN` | The public HTTPS address | Every email link is built from it. Links carry no token except the single-use account link |
| `JOBS_ENABLED`, `JOBS_POLL_SECONDS` | `true`, `15` (defaults) | See §6 |
| `SESSION_SECRET`, `CSRF_SECRET`, `DATABASE_URL`, … | Unchanged from release one | `docs/operations/environments.md` |

**Configured in the application, not the environment**, by the System
Administrator:

- the mail server, sender and reply-to;
- the wording of each email;
- which notification emails are on;
- notification timing (reminder hour in Bangladesh time, deadline reminder
  hours, summary schedule);
- management summary recipients.

**Before delivery is turned on:** send a test message and run the connection
check.

---

## 5. Backup and restore precautions

- **Take and verify a backup** before the scripts:
  `docs/operations/backup-and-restore.md` §2, with
  `BACKUP_ALLOW_PRODUCTION=true`. Copy it off the host.
- **What a backup holds:** the database, including `email_settings` with the
  **encrypted** SMTP password, and the document directory.
- **Restoring:** a restored database needs the **same `EMAIL_SECRET_KEY`** to
  read that password. With a different key, delivery fails with "cannot be
  decrypted" until the password is entered again. Keep the key with the
  backup's secrets, not with the backup.
- **The delivery log:** it never holds a message body or a readable link, so
  a backup contains no usable account link.
- **Enum values:** PostgreSQL cannot drop them. After a rollback the values
  added by 0010–0012 stay in their types, unused.

---

## 6. Background worker

Everything that sends email runs from the durable `background_jobs` table:

- notification scans, every Dhaka hour;
- `notifications.refresh`;
- `email.send`;
- the password-reset request job;
- exports and housekeeping.

| Mode | Setting | Notes |
| --- | --- | --- |
| In the API process (default) | `JOBS_ENABLED=true` | Several API instances share the queue safely through row locks |
| Separate scheduler | `JOBS_ENABLED=false`, and `npm run jobs:run` every few minutes | Alerts, emails and exports wait until it runs |

- **Monitoring:** `npm run jobs:run -- --check` exits 1 when a job failed for
  good in the last 24 hours or due work waited over an hour
  (`docs/operations/monitoring.md`). It is the reliable failure signal.
  Administrators' failure-notice emails also fail when the mail server is
  down.
- **A stopped worker:** reminders more than 24 hours late are not sent
  afterwards, so there is no backlog flood. The alerts remain in the app.
- **Sending is at least once:** a crash between sending and recording can
  repeat one message (ADR 0011).

---

## 7. Rollback

1. **Preferred:** restore the pre-upgrade backup into a **new** database and
   point the release-one application at it (`backup-and-restore.md` §3).
2. **Per migration, newest first:** follow the `Rollback:` steps in each
   script's header. These are clean only before new data exists:
   memberships edited (0008), email rows (0009/0012), procurement cycles
   (0011) or EOI/RFP alerts (0012). Rolling back 0008 after a multi-section
   assignment loses it.
3. **Code and schema go together:** the change-request code needs 0012; the
   release-one code works only before 0008.

---

## 8. Remaining issues

**Release blockers** (unchanged from Milestone 8, not solved by this change
set):

1. Production document storage and malware scanning (SEC-010, AT-13,
   D-007). Server disk and a ClamAV scanner are implemented (ADR 0006
   addendum); open until set up and checked on the production server
   (`docs/operations/document-upload-setup.md`).
2. Identity provider and MFA for privileged roles (SEC-030, SEC-031).
3. A staging environment, and on it: capacity, restore drill and monitoring
   (NFR-001–003, NFR-010/011, AT-16).

**Decisions waiting on Penta:**

- **D-EM-1:** the mail server and sender. Until then, no real email.
- **D-EM-2:** email content. Proposed: no commercial detail; summaries are
  counts.
- **D-EM-4:** recipients, as extended in step 6.
- **Defaults to confirm:** reminder 09:00, 72 hours, weekly summaries on
  Sunday, summaries off.
- **Earlier deadline reminders:** a reminder earlier than 72 hours would need
  FR-090 changed.
- Earlier release-one items: `acceptance-matrix.md`, "Unresolved".

**Checks that could not run here:**

- **Real email:** an SMTP send and connection check against a real server;
  mail delivery and spam handling.
- **Staging:** capacity, the restore drill and monitoring on the staging
  host. The local figures are from Milestone 8 and were not re-measured for
  this change set.
- **Browsers:** Safari or mobile browsers; only Chromium, Edge and Firefox on
  Windows. Screen readers, and AT-17 user acceptance and visual sign-off.
- **Fixture:** the aged m5 tender fixture. The browser check now answers the
  late-submission question the application correctly asks, but the fixture
  itself is still dated 8 October 2026.

---

## 9. Results of the step 7 verification

See `docs/progress.md`, "Step 7 — complete change set verified".
