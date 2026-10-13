# Implementation progress

**Current state (13 October 2026):** Milestone 8 is complete, and change
requests CR1–CR6 are **implemented and regression-tested** on branch
`cr-change-requests` (steps 1–7 below; `docs/change-requests.md`). CR2
step 6 connected email to the in-app notifications and the procurement
cycles (§16). **Step 7 verified CR1–CR6 as one change set (§17):** ready
for staging UAT once a staging environment exists; release handover in
`docs/release/cr-release-handover.md`. The database changes are migrations
0008–0012, each with a production script (0011 rebuilt CR6 as separate
procurement cycles, §15; 0012 is §16).
No email has been sent outside the local capture folder. Nothing is
deployed. **Not production-ready:** production document storage and malware
scanning, the identity provider and MFA, and a staging environment are
unresolved release blockers (Milestone 8, §8). Sections, newest first:
Change requests · Milestone 8 · 7 · 6 · 5 · 4 · 3 · 2 · Milestone 1 handover
review · 1.

---

## Change requests CR1–CR6 — assessment

**Branch:** `cr-change-requests`, created from `changemade` at `e9a8e1b`
**Date:** 12 October 2026
**Status:** Assessment complete; **implementation not started**, by
instruction. No code, migration or database change; no email sent; nothing
deployed.

### 1. Baseline since Milestone 8

| Item | Finding |
| --- | --- |
| Commits after M8 | `88debfb` (allow the `APP_ORIGIN` host in the Vite dev server) and `e9a8e1b` (Chrome fix: stale duplicate `penta.sid`/CSRF cookies are expired at `GET /api/auth/csrf`, `server/http/duplicateCookies.ts`; no database change). `main` has the M8 and `changemade` merges up to `88debfb` (PR #4); `e9a8e1b` is not yet on `main` |
| Working tree | Clean before the branch was created |
| Migrations | `0000`–`0007`; none added since M7 |
| `npm run typecheck` | **Pass** |
| `npm test` | **643 passed, 0 failed**, 22 files (640 after M8 + 3 cookie-recovery tests in `auth.test.ts`) |

### 2. Assessment summary

Full detail, acceptance criteria and decisions are in
[`docs/change-requests.md`](change-requests.md).

| CR | What exists | Gap |
| --- | --- | --- |
| CR1 email invitation | Hashed, single-use, expiring invitation and reset links (`account_tokens`, `accountTokens.ts`), shown once to the administrator | No email code at all. The plan issues the token inside the send job, so no raw token is ever stored |
| CR2 email notifications and admin configuration | Durable job queue with retry and health check; four in-app alert types | No SMTP, settings, templates or delivery log; no server-side secret encryption; no admin settings panel |
| CR3 change own password | argon2id hashing, password policy, `session_version` revocation | No endpoint or UI |
| CR4 multi-section lead | One lead per section via the `users_one_active_lead_per_section` index and `users.section_id` | Lead scope must come from `sections.lead_user_id`. A database rule is needed: an active section must have an active lead |
| CR5 multi-section salesperson | Scalar `users.section_id`; about 40 tests encode one section per user | New `section_memberships` table; policy, admin, create, transfer, team, dashboard and DTO changes |
| CR6 Software Procurement (EOI → RFP) | One linear stage pipeline; free-text procurement method | A workflow discriminator, a second stage sequence, and a tender phase. **The stages are not specified** and need Penta's input |

Superseded requirements: §1.3 (email exclusion, for email only), FR-002,
BR-001, BR-002, the §2.1 lead cells and BR-051, as adapted. The
one-active-lead rule (BR-052) is kept and strengthened. Change-requests §8
lists every effect.

### 3. Planned sequence

1. CR3
2. CR4 + CR5 (migration 0008)
3. CR2 foundation (migration 0009)
4. CR1
5. CR2 notification emails
6. CR6 (migration 0010, after decisions)
7. Full regression and release documents

### 4. Database

None changed. There is **no production SQL** for this step. Each later
migration will ship with a production upgrade script, pre-flight checks and
rollback statements.

### 5. Decisions needed before or during implementation

Change-requests §9 lists 18 decisions with proposed defaults. Three block
work:

- **D-CR6-2:** the Software Procurement stages. Blocks CR6.
- **D-EM-1:** the production mail server. Blocks only real sending; development uses a capture transport.
- **D-EM-2:** whether commercial details may appear in emails. Affects the template content.

### 6. Step 1 — CR3 change own password (implemented 12 October 2026)

**What was built**

| Area | Change |
| --- | --- |
| API | `POST /api/auth/password` `{currentPassword, newPassword}`. It requires a session, a CSRF token and a trusted origin, and has its own rate limiter counted **per account**. It returns a new CSRF token |
| Service | `server/services/ownPassword.ts`: verifies the current password and refuses reuse of the current one. The UPDATE repeats the verified hash in its predicate, so a concurrent change is not overwritten. It bumps `session_version`, spends outstanding invitation and reset links, and audits `account.password_changed` (administrative, no password data) |
| Session | The caller's session is re-issued under a new id and keeps its **original absolute expiry**. All other sessions end on their next request (D-CR3-1 default). `establishSession` is now shared by sign-in and password change |
| Validation | `changePasswordSchema` in `shared/validation.ts` (same 12–256 policy; strict, so no account id is accepted) |
| Interface | A "Change password" button in the top bar opens `ChangePasswordDialog`, built from the existing Modal, Field and DialogAlert and `useSubmission`. The administrative audit label is added. No other screen changed |

**Defects found and fixed during this step**

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **Sign-out did not always end the session** (predates CR3; found by the new browser check). A request still running when "Sign out" was pressed saved its session afterwards, and the store's upsert put the deleted row back | `server/auth/sessionStore.ts`: only the CSRF bootstrap and `establishSession` may insert a session row; every other save is an UPDATE. Regression test in `auth.test.ts`; it fails without the fix |
| 2 | **`check:production-server` 2 of 19 failed** on the Chrome stale-cookie fix (`e9a8e1b`): its cookie-expiry headers had no `Secure`/`SameSite=Strict` | The headers now carry the same attributes as the cookies. The "no session cookie over plain HTTP" check now ignores empty, expired deletion headers, which carry no session id; any session id still fails it. **This changes the check itself, for review** |

**Database:** no migration and no database change. **No production SQL is
needed for this step.**

**Commands and results (final run, on this code)**

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass: 0 errors, the same 5 pre-existing warnings |
| `npm test` | **655 passed, 0 failed**, 23 files (643 + 10 in `ownPassword.test.ts` + 1 logout regression + 1 matrix case) |
| `npm run build` | Pass, including demo exclusion |
| `npm run check:production-server` | **19 passed, 0 failed** (after fix 2) |
| `npm run test:smoke` | smoke+m2 12, m3 2, m4 3, m6 4, m7 1, **cr3 1 (new; 6 of 6 repeated runs pass)** passed. **m5 failed** (see below) |

**Open: m5 browser check fails because a fixture has aged.** The
synthetic tender `DCR/PROC/2026/221` has a fixed submission deadline of
`2026-10-08T15:00+06:00`, and browser checks use the real clock. Since 8
October, "Mark Submitted" correctly treats the bid as late and asks for an
explanation, which the test does not expect. It passed on 6 October (M8),
and no file it touches changed in this step. This was not re-run on the
earlier commit. The fix (dates relative to the seed time, or an updated
fixture) touches shared synthetic data. It is left for a decision rather
than changed silently.

**Evidence:** `docs/evidence/cr/cr3-change-password-error.png`. ADR 0002
has an addendum covering CR3 and the session store.

### 7. Step 2 — CR4 + CR5 multi-section leads and salespeople (implemented 12 October 2026)

Design and reasons: ADR 0010. Proposed defaults D-CR4-1/2/4 and D-CR5-1/2
are applied. D-CR4-3 is applied in effect, with one difference: the lead
pointer is kept as history rather than cleared. The status note at the top of `docs/change-requests.md` records
the changes from the plan.

**What changed**

| Area | Change |
| --- | --- |
| Database (migration 0008) | New `section_memberships` table: history kept; the runtime role has no DELETE. `sections.lead_user_id` is now the source of truth for leads. CHECK: an active section has a lead. Deferred constraint triggers: that lead is an active account with the lead role. The old one-lead-per-section index is dropped. Pre-flight checks refuse inconsistent data and change nothing. Backfill: one membership per salesperson. `users.section_id` is kept, unread and unwritten, for rollback |
| Access (`scope.ts`, `actor.ts`) | Lead: records in the active sections they lead. Salesperson: records they own **and** that are in a current section (fails closed). The actor carries `sections`/`sectionIds`, read fresh on every request. New helpers `leadsSectionSql`, `memberOfSectionSql` and `worksInSectionSql` drive alert recipients, follow-up assignees and eligible owners |
| Create and transfer | Owner and section are checked as a pair. Create now share-locks the owner and re-checks inside the transaction; it did not lock the owner before. Transfer takes an optional `newSectionId`; it is required only when it is ambiguous. A lead may move a record between two sections they lead |
| Administration | Salespeople have `sectionIds` (one or more). Leads are created without sections and appointed through a section. A new section names its lead. Replace lead accepts an existing lead or a member salesperson. Reactivating a section needs a lead. Membership changes are audited as `account.section_joined` and `account.section_left`. Losing a section, or a role change, ends sessions |
| Team, dashboard, search | A person shows every current section. A section filter narrows the records counted, not the people listed |
| Interface | User dialog: a section checklist, and "Reports to" listing the lead of each section. Section dialog: choose the lead when adding or reactivating; Replace lead offers existing leads and member salespeople. Create dialog: a section select when the owner has several. Transfer dialog: the choice is an owner in a section. The shell and dashboards list multiple sections. Existing components only |
| Operations | `scripts/ops/export-migration-sql.ts` writes a reviewed, standalone production script; output in `docs/operations/sql/`. Runbook §3.1 covers applying, checking and rolling back 0008 |

**Defects found and fixed during this step**

1. **Drizzle renders a column inside a raw SQL fragment as a bare `"id"` in a
   single-table select.** Inside a subquery that bound to the subquery's own
   `id`, and Team Management showed zero workload. The users columns in these
   subqueries are now written in full. A comment explains why at each place.
2. **Opportunity create did not lock the owner.** A concurrent role or
   section change could therefore leave a record with an ineligible owner. It
   now share-locks the owner and re-checks.
3. The admin page warned "no reporting line" for every salesperson. That
   warning is meaningless now that reporting lines are derived, so it is
   removed.

**Tests**

- New: `server/tests/sections.test.ts` (13 tests), covering:
  - backfill scope equivalence for every seeded account;
  - a lead of two sections, and losing a section on the next request;
  - a lead moving records between their sections, and only those;
  - the database refusing an active section without a lead, a non-lead
    pointer, and demoting or deactivating a sitting lead (the deferred
    trigger allows a swap inside one transaction);
  - a salesperson gaining a section without signing out, and creating there;
  - wrong-section and other-team refusals;
  - leaving a section only once their records are moved;
  - fail-closed scope when a membership ends;
  - the runtime role unable to delete history;
  - an ambiguous transfer section;
  - assignee and alert-lead resolution.
- Rewritten on purpose, never deleted:
  - the single-section assertions in `administration.test.ts` (AT-09);
  - `auth.test.ts`: section change now means a lost membership;
  - `dashboard.test.ts`;
  - `childScope.test.ts`;
  - the `m7MutationControls.test.ts` matrices: new audit sequences for
    create, role change and lead replacement, plus a membership-join case;
  - `reports.test.ts`: the requester who loses access is now a salesperson,
    because a section's lead can no longer be deactivated directly;
  - `m8Operations.test.ts`.
- New browser check: `e2e/cr45.spec.ts`. `m3` and `evidence-m3` are updated
  for the section checklist.

**Commands and results (final run, on this code)**

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass: 0 errors, the same 5 warnings |
| `npm test` | **669 passed, 0 failed**, 24 files (655 + 13 in `sections.test.ts` + 1 matrix case) |
| Browser checks, run separately | smoke+m2 12, m3 2, m4 3, m6 4, m7 1, cr3 1, **cr45 1** passed; **m5 failed** (the aged-fixture deadline from step 1, not this change) |
| `npm run build` | Pass, demo exclusion included |
| `npm run check:production-server` | **19 passed, 0 failed** |
| Migration on the development database | Applied: 6 memberships backfilled, no active section without a lead, both triggers installed |
| Production upgrade rehearsal (scratch database at 0007, release-one data) | Pre-flight refused an active section without a lead and changed nothing. After the fix, the upgrade succeeded: memberships for active and inactive salespeople, triggers, CHECK, old index dropped, runtime role INSERT but not DELETE. A rerun was refused, and `db:migrate` then skipped it. Scratch database dropped |

**Database: production SQL.** This step changes the database.
`docs/operations/sql/0008_section_memberships_and_multi_section_leads.production.sql`
is the upgrade script (file sha256 `95f4e1f9…b80ae`). Run it as
`penta_migrator` after a verified backup, or use `npm run db:migrate`.

**Evidence:** `docs/evidence/cr/` holds `cr5-user-sections.png`,
`cr4-replace-lead.png` and `cr5-create-section-choice.png`.

**Open:** capacity was not re-measured. Scope now uses `IN` lists and
correlated `EXISTS` subqueries, so staging should repeat NFR-010/011. The
m5 aged fixture remains. A later contract migration drops
`users.section_id`.

### 8. Step 3 — CR2 email foundation (implemented 12 October 2026)

Design and reasons: ADR 0011. Proposed defaults D-EM-2 (no commercial detail
in emails) and D-EM-3 (no per-person opt-out; an administrator can turn each
email off) are applied. **No real email was sent**: development, tests and
browser checks use the capture transport.

**What changed**

| Area | Change |
| --- | --- |
| Database (migration 0009, additive) | `email_settings` (at most one row; the SMTP password stored only as AES-256-GCM ciphertext), `email_templates` (only wording an administrator changed), `email_deliveries` (the delivery log, never message bodies). CHECKs: complete settings when on, one-line subjects, a recipient on every delivery. The runtime role cannot delete from any of them |
| Configuration | `EMAIL_TRANSPORT` (`none` / `capture` / `smtp`; production default `none`, production refuses `capture`), `EMAIL_SECRET_KEY` (64 hex), `EMAIL_CAPTURE_DIR`, `EMAIL_SEND_TIMEOUT_SECONDS`. Documented in `.env.example`; `check:env` passes with 32 variables |
| Server | `server/email/`: secret box, capture and SMTP transports (nodemailer **10.0.10**, exact version), runtime. `server/services/email.ts`: settings, templates with allowlisted placeholders, a synthetic preview, a synchronous test message, the delivery log, `queueEmail`, and the `email.send` job with send-time re-checks, retries and final failure. Routes are under `/api/admin/email`, administrator only |
| CR3 follow-up | Changing one's own password queues a "password changed" email in the same transaction, while delivery is on |
| Interface | Administration page: Email delivery (status, server, sender, a transport note, Edit settings, Send test email), Email templates (edit, preview, restore the default), and the Email delivery log. The password is write-only. Built from the existing Panel, table, Modal and form components |
| Audit | `email.settings_updated` (the password only as "replaced"/"removed"), `email.template_updated`, `email.test_sent`, all in the administrative domain with labels. The audit matrix now also scans `email.*` actions |

**Tests**

- New: `server/tests/email.test.ts` (20 tests), covering:
  - administrator only;
  - defaults when nothing is saved;
  - the encrypted password never returned or audited, and unreadable under
    another key;
  - keeping or removing the password, and refusing a password when no key is
    configured;
  - incomplete, header-injecting and stale settings;
  - no DELETE for the runtime role;
  - templates: defaults, a versioned and audited save, unknown or unclosed
    placeholders, a missing `{{link}}`, multi-line subjects, a synthetic
    preview;
  - the test message: captured, then SMTP failure without credentials;
  - the "password changed" email: queued with the change and sent by the job
    with no password material; not queued while off; suppressed when its
    template is off, when the transport is `none`, or when the recipient is
    inactive;
  - retry, then final failure;
  - production refusing `capture`.
- Audit matrix: three new cases.
- Browser check: `e2e/cr2.spec.ts` (settings, test message, template preview,
  and a password change appearing as Sent in the log).
- `check:production-server` gained "refuses EMAIL_TRANSPORT=capture in
  production".

**Commands and results (final run, on this code)**

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **692 passed, 0 failed**, 25 files |
| Browser checks, run separately | smoke+m2 12, m3 2, m4 3, m6 4, m7 1, cr3 1, cr45 1, **cr2 1** passed. m5 was not rerun: the aged-fixture deadline from step 1 |
| `npm run build` | Pass, demo exclusion included |
| `npm run check:production-server` | **20 passed, 0 failed** |
| `npm audit --omit=dev` | Unchanged: 2 moderate (React Router); nodemailer adds none |
| 0009 rehearsal (scratch database at 0008) | Applied, runtime role INSERT but not DELETE, a rerun refused, `db:migrate` then skipped it; scratch database dropped |

**Database: production SQL.** This step changes the database.
`docs/operations/sql/0009_email_settings_templates_and_deliveries.production.sql`
(file sha256 `646a7eb4…e56320`). Apply it after 0008. Runbook §3.2 covers
turning email on afterwards.

**Evidence:** `docs/evidence/cr/` holds `cr2-email-settings.png`,
`cr2-template-preview.png` and `cr2-delivery-log.png`.

**Open:** real sending waits for D-EM-1 (Penta's mail server) and for
deployment authorization. Invitation and notification emails come in steps 4
and 5.

### 9. Step 4 — CR1 invitation and reset links by email (implemented 12 October 2026)

Decision D-CR1-1 (keep a manual "copy link" fallback) is applied. **No
database change and no production SQL in this step.**

**What changed**

| Area | Change |
| --- | --- |
| Account links | While email delivery is on and the server may send (`EMAIL_TRANSPORT` is not `none`), creating an account or asking for a new link **queues an email** (`account.invitation_queued` / `account.reset_queued`). The single-use link is issued **only by the send job**, audited as `account.invitation_issued` / `account.reset_issued` with the requesting administrator as actor, and expires 72 h / 24 h **after sending**. No readable token rests in the queue, the delivery log or the audit |
| Send-time checks | The send is skipped, with the reason recorded, if the account was deactivated or the invitation accepted in the meantime. A retry issues a fresh link that voids the earlier one |
| Manual fallback | `POST /api/admin/users/:id/link` takes `{delivery: 'email' \| 'manual'}`. "Copy link" shows the link once, as before, and cancels any account email still queued for that person. Asking for an email while delivery is off returns 409 with guidance. While delivery is off, everything works exactly as in release one |
| API | `AccountLinkDto` gains `delivery` (with `url`/`expiresAt` null when emailed). `CreateUserResultDto` gains `delivery`. `AdminUserDto` gains `linkActive` and `accountEmail` (the latest invitation or reset email status) |
| Interface | User table: while email is on the action reads "Email invitation" / "Email reset link", plus an icon-only "Copy link". A status line shows the email queued, emailed, failed (use Copy link) or not sent with its reason, or "No active invitation link". Adding a user confirms "Invitation emailed" instead of showing a link. Dialog text updated |

**Tests**

- New: `server/tests/invitations.test.ts` (9 tests), covering:
  - the email-off path unchanged, and email refused while off;
  - an emailed invitation: no token until sent; the captured message holds
    the link, whose hash is the stored one; the token appears in no delivery,
    job or audit row; the audit attributes the issue to the administrator;
    the user-table state; single use;
  - expiry counted from sending (injected clock);
  - a resend voiding the earlier link;
  - "Copy link" cancelling the queued email, and the copied link working;
  - an emailed reset ending sessions;
  - no link for a deactivated account or an accepted invitation;
  - fallback after a failed delivery;
  - `EMAIL_TRANSPORT=none` falling back to the shown link.
- Audit matrix: two new cases (`account.invitation_queued`,
  `account.reset_queued`).
- Browser check: `e2e/cr1.spec.ts`. Email is turned on, a person is added,
  "Invitation emailed" is shown, and the person opens the captured link,
  chooses a password and signs in.

**Commands and results (final run, on this code)**

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **703 passed, 0 failed**, 26 files |
| Browser checks, run separately | smoke+m2 12, m3 2, m4 3, m6 4, m7 1, cr3 1, cr45 1, cr2 1, **cr1 1** passed. m5 not rerun (aged fixture, step 1) |
| `npm run build` | Pass, demo exclusion included |
| `npm run check:production-server` | **20 passed, 0 failed** |

**Evidence:** `docs/evidence/cr/cr1-invitation-emailed.png`.

### 10. Step 5 — CR2 alert emails (implemented 12 October 2026)

**No database change and no production SQL in this step.** Decisions D-EM-2
(no commercial detail) and the new **D-EM-4** (proposed default: email only
the person responsible for an alert) are applied and await Penta's
confirmation.

**What changed**

| Area | Change |
| --- | --- |
| Generation | When an in-app alert is created (follow-up due today, overdue, tender deadline within 72 h, ownership change), its email is queued **in the same transaction**, only for the responsible person: the task's assignee, the tender's owner, or the new owner after a transfer. Leads and management keep their in-app alerts without an email for each. Alert batches are now inserted in a transaction with their emails. One email per alert (dedupe key = alert id), so a repeated scan sends nothing new |
| Send time | `deliverableAlert` re-applies the same `stillValid` definition as every inbox read. An alert that is no longer true, no longer permitted, or already **read in the app** is suppressed with its reason |
| Content | The kind of alert, the date or deadline (in the interface's own format, `DD Mon YYYY, HH:MM Bangladesh time (UTC+6)`) and a link to the record, where access is checked again. No project name, reference, value or organization |
| Wording | The ownership email now reads "An opportunity has been transferred to you", since only the new owner receives it |

**Defect found and fixed:** the first email date formatter used `Intl` month
names, which in Node's `en-GB` locale write September as "Sept". Emails now
use the formatter the in-app alerts already use, so a date reads the same
in the app and in a message.

**Tests**

- New: `server/tests/notificationEmails.test.ts` (8 tests), covering:
  - emailed only to the responsible person, with the lead's alerts not
    emailed;
  - no duplicate on a rescan;
  - content holds a link and dates only: no opportunity name, reference,
    organization or amount;
  - nothing queued while email is off, with alerts still in the app;
  - suppressed when already read, when no longer true (rescheduled), or when
    the recipient lost access (transfer);
  - the transfer email going only to the new owner;
  - a tender deadline in Bangladesh time;
  - no endpoint for posting an alert email.
- The existing notification tests pass unchanged.

**Commands and results (final run, on this code)**

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **711 passed, 0 failed**, 27 files |
| Browser checks, run separately | smoke+m2 12, m3 2, m4 3, m6 4, m7 1, cr3 1, cr45 1, cr2 1, cr1 1 passed. m5 not rerun (aged fixture, step 1) |
| `npm run build` | Pass, demo exclusion included |
| `npm run check:production-server` | **20 passed, 0 failed** |

### 11. Step 6 — CR6 Software Procurement workflow, EOI → RFP (implemented 12 October 2026)

**Decisions.** Penta confirmed four decisions on 12 October 2026:

- the draft stage list (D-CR6-2);
- not shortlisted ends as Lost, with reason "Not shortlisted" (D-CR6-3);
- a Workflow field on Opportunities, no new navigation (D-CR6-4);
- recording the EOI outcome closes the EOI notice (D-CR6-6).

D-CR6-1 (sales pursuit only) and D-CR6-5 (fixed at creation) use the proposed
defaults. Design and reasons: ADR 0012.

**What changed**

| Area | Change |
| --- | --- |
| Database (migration 0010, additive) | `opportunities.workflow` (default `standard`). Eight new stage values, placed before Awarded. CHECK: a record's stage belongs to its workflow (compared as text, so it can be created in the same transaction). Lost reason `not_shortlisted`, Software Procurement only. `tenders.phase` (`eoi`/`rfp`), `eoi_outcome` and its date, notice state `closed`, with CHECKs. Existing records become Standard, unchanged |
| Stage rules | `WORKFLOW_STAGES` defines each workflow's order. Skip and backward moves are measured within the workflow. A stage from the other workflow, or a reopening to one, is refused. Every other stage and status rule is unchanged |
| Tenders | A Software Procurement notice must have a phase. Mark Submitted offers EOI Submitted / Proposal Submitted (Bid Submitted for standard). **Record EOI outcome** (`POST /api/tenders/:id/eoi-outcome`, idempotent) closes the EOI and records the outcome. With the user's choice, Shortlisted moves the record on, and Not shortlisted closes it as Lost (reason Not shortlisted, follow-ups cancelled), through the same audited `applyStageMove`. An RFP needs a Shortlisted EOI (unless there was no EOI). An EOI cannot follow an RFP. A closed EOI cannot become current again |
| Views | One board per workflow, with a Workflow filter on Opportunities that is also the board switch. The stage chart and "Pipeline by stage" add Software Procurement stages only once such records exist. Shared metrics unchanged and cover both. CSV export gains a Workflow column. History labels for workflow, phase and outcome |
| Interface | Create dialog: Workflow choice, with stages following it. Opportunity page: Workflow shown, stage menu per workflow. Transition dialog: stages and lost reasons per workflow. Tender tab: phase tag, EOI outcome line, "Record EOI outcome" dialog. Mark Submitted names the offered stage. Existing components only |

**Tests**

- New: `server/tests/workflow.test.ts` (8 tests), covering:
  - creation at the workflow's own stages only;
  - moves within the workflow's order, refusing the other workflow's
    stages;
  - "Not shortlisted" refused on standard records, by the service and the
    database (both CHECKs proven with the runtime role);
  - the full EOI → submitted → Shortlisted → RFP → Proposal Submitted path,
    with an RFP refused before shortlisting, an EOI refused after the RFP,
    and a closed EOI not made current;
  - Not shortlisted → Lost with follow-ups cancelled, plus an idempotent
    retry;
  - an outcome without moving the stage, and only after submission;
  - one board per workflow;
  - metrics and the report including Software Procurement once present.
- Audit matrix: the EOI outcome case (`tender.eoi_outcome_recorded` with the
  stage change).
- Browser check: `e2e/cr6.spec.ts`.
- Every existing test passes unchanged.

**Commands and results (final run, on this code)**

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **720 passed, 0 failed**, 28 files |
| Browser checks, run separately | smoke+m2 12, m3 2, m4 3, m6 4, m7 1, cr3 1, cr45 1, cr2 1, cr1 1, **cr6 1** passed. **m5 failed**: re-checked, still only the aged fixture (deadline 8 Oct now past, so the late-submission note is asked for). The parts of m5 that use the Mark Submitted wording changed here pass |
| `npm run build` | Pass, demo exclusion included |
| `npm run check:production-server` | **20 passed, 0 failed** |
| 0010 rehearsal (release-one records → 0008 → 0009 → script) | Applied; existing records Standard and unchanged; stage order correct; five rules created; a rerun refused; `db:migrate` skipped it; scratch database dropped |

**Database: production SQL.** This step changes the database.
`docs/operations/sql/0010_software_procurement_workflow.production.sql`
(file sha256 `41d2ac92…ba377c`). Apply it after 0009. Runbook §3.3 covers it.

**Evidence:** `docs/evidence/cr/` holds
`cr6-create-software-procurement.png`, `cr6-eoi-outcome.png`,
`cr6-tender-tab.png` and `cr6-board.png`.

### 12. Step 7 — final regression and release documents (12 October 2026)

**No code or database change.** This step ran every gate, one after another
on the same machine, and updated the release documents for CR1–CR6.

**Commands and results (final run)**

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass, 0 errors |
| `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm run check:env` | Pass (32 variables) |
| `npm test` | **720 passed, 0 failed**, 28 files |
| Browser checks, each in its own run | Passed: smoke+m2 12, m3 2, m4 3, m6 4, m7 1, cr3 1, cr45 1, cr2 1, cr1 1, cr6 1 |
| m5 browser check | **Failed.** Rerun alone and inspected. The only cause is the aged fixture: tender `DCR/PROC/2026/221` has a fixed deadline of 08 Oct 2026, now past, so Mark Submitted correctly asks for a late-submission explanation that the test does not give. The other two m5 tests pass |
| `npm run build` | Pass, demo exclusion included |
| `npm run check:production-server` | **20 passed, 0 failed** |
| `npm audit --omit=dev` | The same 2 moderate `react-router` advisories as Milestone 8; nothing from `nodemailer` |
| `npm run test:browsers` | **Chromium, Edge and Firefox: 5/5 each** |
| `npm run capacity:seed` + `capacity:load` | 0 server errors. Paced p95 92 ms; saturation p95 658 ms, max 1 719 ms. Target (p95 < 2 s) met; `docs/evidence/capacity/load-after-change-requests.md` |

**Documents updated**

- `docs/release/acceptance-matrix.md`: the amended release-one rows, and a CR1–CR6
  section (39 rows: 36 complete, 3 partial pending D-EM-1, D-EM-2 and D-EM-4).
- `docs/release/security-review.md` §7 (change-request addendum, and two new
  items for the independent reviewer).
- `docs/release/capacity-and-performance.md` (re-run).
- `docs/release/interface-quality.md` (three browsers, new screens).
- `docs/release/pilot-handover.md`: CR UAT scenarios, the upgrade order, the
  mail-server blocker, new limitations and checklist items.
- `README.md` (email settings, eleven smoke runs, the migration SQL export).
- A pointer to the change requests at the top of
  `docs/Penta_CRM_Requirements.md`.
- `CLAUDE.md` current state.

**Database: production SQL.** Step 7 changes nothing. For the whole branch,
apply in this order, once each, after a backup:

1. `docs/operations/sql/0008_section_memberships_and_multi_section_leads.production.sql`
2. `docs/operations/sql/0009_email_settings_templates_and_deliveries.production.sql`
3. `docs/operations/sql/0010_software_procurement_workflow.production.sql`

### 13. Step 3 reviewed against the full CR2 instruction (12 October 2026)

The step 3 instruction was checked again, point by point, against the code.
Four gaps were found and closed. **No database change**: everything uses the
existing tables and the audit.

**Gaps closed**

| Instruction | Before | Now |
| --- | --- | --- |
| Connection validation | Only a test email exercised the connection | **Check connection** (`POST /api/admin/email/verify`) connects and signs in without sending. It reports a failure without credentials, and with `capture` or `none` says that no server is contacted. Not audited, because it changes nothing |
| Template version history | Edits were audited, but not shown per template | **History** in the template editor (`GET /api/admin/email/templates/:key/history`). It rebuilds every saved version in full from the audit, newest first, with who and when. **Use this wording** loads one into the editor; Restore default wording is unchanged |
| Controlled retry | None | **Retry** on a failed delivery (`POST /api/admin/email/deliveries/:id/retry`): failed emails only, never a test message, at most three times, only while delivery is on. Audited as `email.delivery_retried` (labelled in the administrative audit). The job re-checks everything before sending, as the first time |
| SMTP acceptance is not inbox delivery | The log said "Sent" | **"Accepted by mail server"**, and the test email says acceptance does not confirm inbox delivery. Development captures read **"Captured, not sent"** (a new `captured` flag on the delivery DTO). The stored status value `sent` is unchanged |

**Already met, confirmed in the code:**

- delivery on/off;
- host, port, TLS mode, credentials, sender and reply-to;
- the write-only, encrypted password;
- refusal of incomplete settings and line breaks;
- allowlisted placeholders and a synthetic preview;
- the outbox in the same transaction, with bounded retries and a dedupe key;
- re-checks at send time;
- a log with no message bodies or tokens;
- the required templates (the procurement deadline reminder is "Tender deadline within 72 hours");
- the capture transport for verification.

**HTML.** Email is plain text only, so there is no HTML to escape or
sanitise and no template code can run. That meets "sanitize permitted HTML"
by permitting none (ADR 0011).

**Tests added**

- `email.test.ts`: 8 new tests, and the existing role test extended:
  - the new endpoints refused for every non-administrator;
  - the connection check: before settings; with capture and none; against a closed port, without credentials and recording nothing;
  - template history: full versions, newest first, per template, an unknown key returning 404;
  - retry: only when failed, re-sent once, attempts counted, audited;
  - retry: the limit of three;
  - retry: the recipient re-checked, so a deactivated recipient's email is suppressed;
  - retry: a test message, delivery turned off, and unknown and malformed ids (an identical 404) all refused;
  - **job restart**: a worker stops after claiming; nothing is sent while the lease holds; after it, another worker sends once; a duplicate job sends nothing.
- The audit matrix gained a case for `email.delivery_retried`.
- `e2e/cr2.spec.ts` now covers the connection check, the history (new screenshot `cr2-template-history.png`) and the new wording.

**Results**

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **729 passed, 0 failed** (720 + 9 new) |
| `e2e/cr2.spec.ts`, `e2e/cr1.spec.ts` | Passed |
| `npm run build`, `npm run check:production-server` | Pass; 20 passed, 0 failed |

**Configuration and startup (unchanged).** Run `npm run db:migrate`, then set
`EMAIL_TRANSPORT`:

- `capture` in development: files in `EMAIL_CAPTURE_DIR`;
- `none` in production until the mail server is decided.

Set `EMAIL_SECRET_KEY` (64 hex, `openssl rand -hex 32`) before saving an SMTP
password. Then, as administrator:

1. **Email delivery → Edit settings.**
2. **Check connection.**
3. **Send test email.**
4. Turn delivery on.

**Unresolved deployment settings:**

- D-EM-1, the mail server: host, port and TLS, credentials, sender and
  reply-to, IP allowlisting, SPF/DKIM/DMARC;
- custody and rotation of `EMAIL_SECRET_KEY`;
- D-EM-2 (content) and D-EM-4 (recipients).

The retry button was not driven in the browser, because capture mode cannot
produce a failure. The backend tests cover it.

### 14. Steps 1 and 4 reviewed against the full CR1/CR3 instruction (12 October 2026)

CR1 (step 4) and CR3 (step 1) were checked again, point by point, against the
fuller step 4 instruction. Five gaps were closed. **No database change**:
the token purposes, job kinds and audit actions are all text values in
existing tables.

**Gaps closed**

| Instruction | Before | Now |
| --- | --- | --- |
| Opening a link must not consume it; clear expired/used states | Every failure read the same, and only on submit | `POST /api/auth/link-status` (token in the body, rate limited with redemption) says `valid`, `expired`, `used` (or replaced) or `invalid`, and never spends the link. The set-password page explains each state when opened. It is titled **Activate your account** or **Choose a new password**. A link pasted into the same tab is now picked up and checked again (found by the browser check) |
| Purpose-bound tokens; disabled accounts cannot activate | Any unexpired link set a password | An invitation works only while the account is pending activation (no password), a reset only once it is activated. Neither works for a disabled account, and a reset never reactivates one. Enforced in the redemption predicate under the token lock |
| Forgot Password with generic responses | Not offered (D-CR1-2) | **Forgot your password?** on the sign-in page, only while this server sends email (`GET /api/auth/recovery`). `POST /api/auth/forgot-password` always answers the same 202. The job carries only a SHA-256 digest of the address, so timing and the job table reveal nothing. Only an active, activated account is emailed, at most once per 15 minutes, as a system event `account.reset_requested`. The reset ends every session |
| Rate-limit validation and resend | Redemption only | Link checks share the redemption limit. `forgot-password`: 5 per 15 minutes per address. Resending a link: 5 per 15 minutes per account |
| Wording | "Invitation pending" | **Pending activation** in the user table |

**Also added**

- `<meta name="referrer" content="no-referrer">` on the page, as well as the
  existing `Referrer-Policy` header and the fragment-only token.
- A three-browser check, `e2e/accountAccess.spec.ts`, now part of
  `test:smoke` and `test:browsers`. It covers:
  - sign-in through stale duplicate session and CSRF cookies (the
    stale-token recovery), and a fresh session;
  - Forgot password to reset;
  - the used-link page;
  - a wrong current password;
  - the other session ending after a reset and after a change.

**Already met, confirmed in the code:**

- **Accounts and links:**
  - the administrator creates a user with role and sections;
  - the account stays pending until a link is redeemed;
  - redemption is one transaction: token spent, password set, sessions revoked, audit;
  - tokens are 256-bit, store only a hash, expire and are single-use;
  - the raw token is issued only when the email is sent, so no payload holds it;
  - links are built from `APP_ORIGIN`, and the token is in the URL fragment, never logged;
  - a resend revokes the earlier link, and there is an Admin resend and a copy-link action.
- **Passwords and sessions:**
  - administrators never see or set passwords;
  - change password needs the current one, with the policy, argon2id, other sessions ended, this one rotated, and a confirmation email without credentials;
  - existing activated accounts are untouched.

**Placement.** The instruction says the account menu. The approved layout has
no profile menu: Change password stays a button beside the profile chip in
the top bar. A menu would be a redesign.

**Tests added**

- `server/tests/accountRecovery.test.ts` (10 tests):
  - opening a link three times then using it, then `used`;
  - expired after 72 hours, and replaced by a resend;
  - an unknown token, and a disabled account: invalid; it cannot activate and stays inactive;
  - **two simultaneous submissions**: exactly one 204, one audit, one working password;
  - purpose binding both ways;
  - forgot password: the same answer for unknown, pending, disabled and active (mixed-case) addresses, the job holding no address, exactly one email to the active account, a system audit event;
  - one email per window; the reset ends the old session and the old password; a new window allows another;
  - a disabled account is never reactivated;
  - offered only while email is sent;
  - rate limits: per address for forgot password and link checks, and per account for resends, with another account unaffected.
- Audit matrix: `account.reset_requested` and the job kind registered.
- `e2e/cr1.spec.ts`, `m3.spec.ts` and `evidence-m3.spec.ts` follow the new wording.

**Results**

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **739 passed, 0 failed**, 29 files (729 + 10 new) |
| Browser checks, each in its own run | smoke+m2 12, m3 2, m4 3, m6 4, m7 1, cr3 1, cr45 1, cr2 1, cr1 1, cr6 1, **accountAccess 1** passed. m5 fails only on the aged fixture (§12) |
| `npm run test:browsers` | Chromium: m8 5/5, accountAccess passed. Edge: m8 5/5, accountAccess passed. Firefox: m8 5/5. The first Firefox accountAccess run timed out: the "Edit settings" click was lost while the panel re-rendered. The test now retries the click as a person would, and has a 2-minute limit. It then passed 3 times in a row in Firefox |
| `npm run build`, `npm run check:production-server` | Pass; 20 passed, 0 failed |

Evidence: `docs/evidence/cr/cr3-forgot-password.png` and `cr1-link-used.png`.

**Synthetic test instructions (local, nothing leaves the machine)**

1. `npm run db:up && npm run db:migrate && npm run db:seed`, then
   `npm run dev:server` and `npm run dev`, with `EMAIL_TRANSPORT=capture`
   (the development default). Messages land in `EMAIL_CAPTURE_DIR`.
2. Sign in as `admin@example.com`. In **Email delivery → Edit settings**,
   enter any host (for example `smtp.example.test`), port 587, a sender, and
   tick "Send email from the CRM".
3. **Activation:**
   1. Add a user. The table shows **Pending activation**.
   2. Open the link from the newest file in the capture folder. It reads
      **Activate your account**.
   3. Set a password, then open the link again: **This link has already been
      used**.
4. **Forgot password:**
   1. Sign out. Choose **Forgot your password?** and enter `rafiq.hasan@example.com`.
   2. Also try an unknown address: the message is the same.
   3. Open the captured link, choose a new password, and confirm that a
      browser signed in as Rafiq is signed out.
5. **Change password:**
   1. Signed in, use **Change password** in the top bar.
   2. A wrong current password is refused beside its field.
   3. A correct change signs out the other session and sends the "Password
      changed" email to the capture folder.
6. **Disabled account:** deactivate a pending user, then open their link:
   **This link does not work**. It cannot be used.

### 15. CR6 rebuilt to the step 5 instruction: Software Procurement cycles (12 October 2026)

**Why.** The step 5 instruction conflicts with the first CR6 design: it
asks for a separate area and for milestones kept distinct from the pipeline.
Penta chose to rebuild to the instruction. This supersedes D-CR6-2 and
D-CR6-4 (ADR 0012, revised).

**Database: migration 0011** (production script, rehearsed).

- **Adds:** `procurement_cycles`, `procurement_cycle_contacts`,
  `procurement_cycle_documents` and the `procurement_deadlines` export
  kind.
- **Retires 0010:** drops `opportunities.workflow`, `tenders.phase` and the
  tender EOI-outcome columns, and adds CHECKs refusing the retired enum
  values.
- **Pre-flight:** refuses, naming the records, if anything still uses 0010's
  structures.

**What changed**

| Area | Change |
| --- | --- |
| Removed (step 6) | Workflow field, filter and board switch; eight pipeline stages; tender EOI/RFP phase and the EOI-outcome endpoint; `workflow.test.ts`. Files changed only by step 6 were restored from `1fca633`. `applyStageMove` was replaced by `changeStageInTransaction` (below) |
| Server | `services/procurement.ts`, `routes/procurement.ts`. The stage-change rules moved into `changeStageInTransaction` (transitions.ts), shared by the stage endpoint and accepted procurement offers. New permission rules `canManageProcurement` and `canApproveDirectRfp` (management). New `procurement*` metrics in `metrics.ts`; the "Software procurement deadlines" report and CSV export; a dashboard `procurement` block; history labels |
| Interface | **Software Procurement** in the menu (Tender Tracker layout and filters). A **Software Procurement** tab on the opportunity: the current cycle, Record milestone (asks about the matching stage, like Mark Submitted), Edit, document and contact links, stage history, earlier cycles. A dashboard panel, shown only where cycles are in progress |
| Rules | Forward-only milestones. Required facts on advancing. Late submissions need a note, and a recorded submission freezes its deadline. Shortlisting before the RFP, except a documented direct RFP that only management can record. One current cycle; a reissue only after the current one ends. A closed opportunity's cycle can only reach its ending |

**Tests**

- **`procurement.test.ts`** (12):
  - the normal flow, including pipeline offers under the stage rules;
  - Not shortlisted, with Lost only when accepted;
  - the direct RFP, and the database refusing an invented EOI or an RFP
    without shortlisting;
  - cancellation and reissue;
  - a stale version and a retried milestone;
  - deadline boundaries (exactly 72 hours is Upcoming), late submissions
    and Dhaka dates;
  - separate technical and financial submissions;
  - transfers and every role's scope;
  - forged cycle, contact and document ids (identical 404s);
  - dashboard, report and export, scoped and apart from tenders.
- **M7 matrices:** five audit cases, two retry cases, two stale-version
  cases, one atomicity case (failure at the stage change leaves the cycle
  untouched) and two queued previous-owner writes. The audit coverage guard
  now scans `procurement.*` actions.
- **`e2e/cr6.spec.ts`** rewritten for the new screens. Evidence:
  `cr6-add-procurement.png`, `cr6-milestone-offer.png`,
  `cr6-procurement-tab.png` and `cr6-procurement-area.png`. The four step 6
  screenshots were removed.

**Results**

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **756 passed, 0 failed**, 29 files. The first run had one failure: the reports test listing every report's date basis did not yet include the new report. It was updated and the reports tests rerun: 19 of 19 |
| `procurement.test.ts`, M7 matrices | 12 of 12; 175 of 175 |
| Browser checks, each in its own run | smoke+m2 12, m3 2, m4 3, m6 4, m7 1, cr3 1, cr45 1, cr2 1, cr1 1, **cr6 1**, accountAccess 1 passed. m5 fails only on the aged fixture (re-checked: the late-submission note) |
| `npm run build`, `npm run check:production-server` | Pass; 20 passed, 0 failed |
| `drizzle-kit generate` after 0011 | "No schema changes": schema and snapshot agree |
| 0011 rehearsal (0010 + synthetic data → script) | Pre-flight refused a planted 0010 record, naming it, with nothing changed. Then the script applied: counts kept, columns retired, tables and grants created, a retired stage refused. A rerun was refused and `db:migrate` skipped it |

**Production SQL:** `docs/operations/sql/0011_software_procurement_cycles.production.sql`
(file sha256 `500d9a75…567106`; migration sha256 `d98971e6…4708be`). Apply
it after 0010 (runbook §3.4).

**Incident during the rehearsal (resolved).** A first rehearsal attempt
linked a temporary worktree to the repository's `node_modules` with a
junction. Removing the worktree followed the junction and deleted part of
`node_modules`.

- **Restored:** `npm install` from the unchanged `package-lock.json` restored
  it. `npm ls` reports nothing missing or invalid, and the typecheck and
  tests pass.
- **Not touched:** your running dev servers.
- **Later rehearsals:** the worktree is placed inside `.git`, with no links.

### 16. CR2 step 6: notification email events (13 October 2026)

**Instruction.** Connect email to the in-app notifications and the
procurement workflow: configurable events, recipients, timing, send-time
re-checks, stale-reminder suppression, failures and controlled retry.
Decisions are in the ADR 0011 step 6 addendum.

**Database: migration 0012** (production script, rehearsed).

- **Adds:**
  - notification types `eoi_deadline` and `rfp_deadline`, and
    `notifications.procurement_cycle_id`;
  - five email templates;
  - `email_notification_settings` (one row at most; no DELETE for the
    runtime role);
  - `email_templates_security_enabled`.
- **Pre-flight:** refuses, naming it, if a security email was turned off.
- **Existing rows:** unchanged.

**What was built**

| Area | Change |
| --- | --- |
| Events | Security emails (invitation, reset, password changed) are **mandatory**: refused by the service (422) and the database. New: EOI deadline and RFP proposal deadline reminders (on), team summary and management summary (**off** until an administrator turns them on), delivery-failure notice to administrators (on). Existing: ownership, follow-up due today and overdue, tender deadline. No other event emails |
| In-app | New `eoi_deadline` and `rfp_deadline` alerts for a working cycle's open deadline within 72 hours (the dashboard's procurement rule), with the owner, the section lead and management as recipients, linking to the opportunity's Software Procurement tab. Alerts never depend on email |
| Recipients | Reminders: the person responsible only. Assignment: the new owner. Team summary: each current section lead, **one email however many sections** (dedupe key: person and Dhaka date). Management summary: only the accounts ticked by the administrator, validated as active management when saved and when sent. Failures: active administrators, a count and a link. Salespeople get no summary |
| Timing | Administration > **Notification timing** (`GET`/`PUT /api/admin/email/notification-timing`, versioned, audited as `email.notification_timing_updated`): reminder hour in Bangladesh time (default 09:00), tender/EOI/RFP reminder hours (1–72, default 72), daily or weekly summaries (default Sunday). Alert emails are queued when due by `queueDueAlertEmails` (every scan and refresh), no longer at alert creation. A reminder more than 24 hours late is never sent, so turning delivery on cannot release a backlog |
| Staleness | Retiring an alert now suppresses its queued email in the same transaction. Procurement create, edit and milestone (including cancellation) now retire and refresh alerts. Role changes, ended memberships, replaced leads and deactivated accounts or sections queue a scan in their transaction. At send: alert still true, unread, permitted **and the recipient's responsibility**; summary for today, recipient still a lead / still chosen management; notice recipient still an administrator |
| Summaries | Counts only, from `metrics.ts` inside `scopedWhere`, computed at send in the recipient's scope then: overdue follow-ups, due today, tenders in 7 days, EOI/proposal deadlines in 7 days, missed EOI/proposal deadlines. Nothing to report: not sent |
| Failures | After the last attempt: `failed`, plus at most one notice per administrator per Dhaka day; a failed notice causes no further notice. Controlled retry unchanged; it re-checks everything and adds no delivery row |
| Links | A path only, no token. Signed out, the app sends the reader to sign in and **back to the linked page** (`src/app/returnPath.ts`, same-site paths only); the API then checks access, so a lost record shows "Not available" |
| Interface | Email templates show who receives each email and "Always on (security)"; the editor has no on/off for security emails. New Notification timing panel and dialog (`NotificationTimingPanel.tsx`) |

**Tests**

- **`notificationEmailEvents.test.ts` (17, new):**
  - **Timing:** reminders held until the reminder hour in Dhaka time, then
    sent once; the administrator's hour and deadline hours (72-hour cap,
    stale save); no backlog when delivery is turned on two days later.
  - **EOI/RFP:** the EOI reminder at 24 hours with link and Dhaka date only;
    a moved deadline suppresses the queued email at once and the new
    deadline is reminded once; a cancelled cycle suppresses it; the RFP
    proposal reminder.
  - **Recipients:** after a transfer the previous owner's queued reminder is
    suppressed and only the new owner is told; a salesperson in two sections
    is emailed only about their own records and never a summary; a lead of
    two sections gets one team summary whose counts equal their dashboard; a
    lead replaced before sending is suppressed; management summary
    recipients validated (salesperson, absent id and administrator refused)
    and re-checked at send.
  - **Stale and failing:** completion suppresses at once; a disabled account
    is suppressed at send; failures produce one administrator notice (count
    and link, no names), a retry of a reminder read meanwhile is suppressed
    without a new row, and a later scan adds no second notice.
  - **Without email:** delivery off, and `EMAIL_TRANSPORT=none`, both keep
    in-app alerts.
  - **Links:** 401 signed out; for someone without access, the 404 is
    identical to an absent record's; no token in the link.
- **Changed:**
  - `email.test.ts`: the default-state list, the security emails refused
    when turned off (API 422, database CHECK `23514`), and the retry tests
    reading their delivery by id (a failure now adds a notice row).
  - `notificationEmails.test.ts`: the tender message is found by recipient,
    not by file order.
  - The M7 audit matrix gains the timing case.
- **`e2e/cr2-step6.spec.ts` (new, in `test:smoke`):** the timing dialog
  (72-hour refusal, daily summaries, a management recipient) and security
  emails always on. An email-style link signed out goes to sign-in and back
  to the Software Procurement tab; for Imran it shows "Not available".
  Evidence: `docs/evidence/cr/cr2-step6-timing-dialog.png`,
  `cr2-step6-timing.png` and `cr2-step6-link-no-access.png`.

**Results**

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **774 passed, 0 failed**, 30 files. Before the full run, the targeted suites first failed in 6 tests in `email.test.ts` and 1 in `notificationEmails.test.ts`. These were expected consequences, updated as above: default-off summaries, mandatory security emails, a second delivery row from the failure notice, and capture file order. The new suite's first run had 7 failures. Six were in the tests: running jobs where a queued state was expected, `sentAt` on a re-queued row, a fixed clock against the database clock, a response's `requestId`, and a missing `await`. One was in the code: array comparison in the audit diff, which is fixed |
| M7 matrices | 176 of 176 |
| Browser checks | `cr2.spec.ts` 1 passed. `cr2-step6.spec.ts` 2 passed, after fixing an ambiguous label in the test. The rest of `test:smoke` was not rerun in this step |
| `npm run build`, `npm run check:production-server` | Pass, including demo exclusion; 20 passed, 0 failed |
| `drizzle-kit generate` after 0012 | "No schema changes" |
| 0012 rehearsal | The scratch database was migrated to 0011. With "Password changed" turned off, the pre-flight refused, naming it, and nothing changed. After turning it on, the script applied: grants correct (no DELETE), a turned-off reminder kept its setting, the security CHECK enforced, an EOI alert without its cycle refused. A rerun was refused, and `db:migrate` skipped it with the same hash. The database was dropped |

**Production SQL:** `docs/operations/sql/0012_notification_email_events.production.sql`
(file sha256 `acb2c1c8…ad4d46`; migration sha256 `970f51f2…57875ab`;
journal `1791867164750`). Apply it after 0011 (runbook §3.5,
`sql_instructions.md`).

**Limitations, stated plainly**

- **Delivery:** no mail server is configured (D-EM-1). All sending was to
  the capture folder.
- **Pending Penta confirmation:**
  - D-EM-2 (content);
  - D-EM-4 as extended (recipients);
  - the defaults (09:00, 72 hours, weekly on Sunday, summaries off).
- **Deadline reminders:** they cannot be earlier than 72 hours, because the
  email follows the FR-090 in-app alert. An earlier reminder would need a
  change to FR-090.
- **A stopped worker:** reminders more than 24 hours late are dropped by
  design, and the alerts remain in the app.
- **Failure notices:** if the mail server is down, the administrators'
  notice fails too. The job health check (NFR-003) remains the reliable
  signal.

### 17. Step 7 — complete change set verified (13 October 2026)

**Instruction.** Verify CR1–CR6 as one integrated change set, fix the
remaining gaps without redesigning the interface, rehearse the upgrade, and
prepare the release handover. No deployment, no live data, no real email.

**Recorded completion compared with code and tests.** A read-only audit of
the tests behind each of the nine demonstrations found these gaps:

- **Lead of two sections:** never tested against a third section, and not
  at all on search, export or documents.
- **Salesperson in two sections:** the absence of colleagues' records was
  not asserted.
- **Queued email:** no test after a membership ends or an account is
  deactivated through Administration.
- **Refused links:** not compared for sameness, and not shown to leave
  nothing changed.
- **Email administration:** three endpoints had no test that other roles
  are refused (notification timing, template save and preview, test
  message).
- **Changed screens:** no responsive or keyboard checks.
- **Acceptance matrix:** still said procurement deadline notifications were
  not built (true until step 6).

All were closed as below.

**Added**

- **`server/tests/crAcceptance.test.ts` (10 tests):** the nine
  demonstrations end to end.
  1. Activation by an emailed invitation.
  2. Expired, replaced, used and unknown links give identical refusals; the
     password hash, session version and audit are unchanged.
  3. A lead of Government Applications and a new Health Systems section
     reaches both, and nothing of Infrastructure, on list, record (identical
     404), search, dashboard, CSV export, documents (list and upload) and
     in-app alerts.
  4. A salesperson in two sections sees exactly her own records; every
     colleague's record in either section is a 404 and absent from search.
  5. Leaving a section and a lead replacement apply on the next request.
  6. A queued reminder is not sent after the membership ends or after a
     transfer. A queued management summary is not sent after deactivation
     through Administration.
  7. EOI → shortlisting → RFP → proposal preparation → proposal submitted,
     the pipeline untouched.
  8. A goods tender is submitted beside a procurement cycle; each stays in
     its own list.
  9. The SMTP password is absent from responses, the stored value and the
     audit. Previews are synthetic. The administrator gets 403 on commercial
     endpoints, and management, a lead and a salesperson get 403 on every
     email administration endpoint, including the step 6 ones.
- **`e2e/crInterface.spec.ts`:** the changed screens at 1440, 768 and
  360 px (Software Procurement area and tab, change password,
  Administration with sections, email delivery, templates and timing).
  Three dialogs are driven from the keyboard. Added to
  `npm run test:browsers`.

**Fixed**

- **Defect: email administration at 360 px** (found by the new interface
  check). The Email delivery panel's actions sat beside the title on one
  line; the title collapsed and the last button was cut off. The shared
  `Panel` header (`src/components/ui/Layout.tsx`) now wraps its actions
  below the title only when they do not fit. The M8 checks were re-run in
  three browsers: no other screen changed.
- **`e2e/m5.spec.ts`, failing since 8 October:** it now answers the
  late-submission question the application correctly asks after the fixed
  seed deadline. The fixture is unchanged.
- **`e2e/accountAccess.spec.ts`:** step 6's sign-in return path made it fail
  in Chromium and Edge. The second browser had been sent to sign-in from
  `/opportunities`, and those browsers keep that across a reload of
  `/sign-in`, so it rightly returned there. The helper now accepts the
  returned page. The application is unchanged.
- **First-run failures in the new acceptance suite:** all three were in the
  test itself (the create response's id path, and a membership end without
  `endedBy`). None was a product defect.

**Upgrade rehearsal from release-one data**

- **Setup:**
  - A worktree of `e9a8e1b` (release one with the cookie fix) was placed
    inside `.git`, with no links.
  - The release-one code migrated a fresh database to 0007 and seeded it:
    2 sections, 10 users, 23 opportunities, 17 open follow-ups, 22
    contacts, 34 activities, 8 tenders.
  - The release-one job runner then created its own 40 alerts.
  - Every account's visible records were recorded with **release one's own
    policy code**.
- **Upgrade:** the five production scripts, 0008–0012, were applied in
  order with `psql` as `penta_migrator`. Each ended with COMMIT.
- **Results:**
  - **Scope:** every account's visible records, recorded with the current
    policy code, match the release-one record exactly. 10 of 10 accounts
    identical (admin 0, management 23, Nadia 13, Farhan 10, Rafiq 5, Tasnia
    4, Imran 4, Sadia 4, Mehjabin 1, inactive Shuvo 0).
  - **Data:** every row count is unchanged.
  - **Memberships:** one open membership for each of the 7 salespeople, the
    inactive one included. Leads come only from `sections.lead_user_id`.
  - **Migrator:** `db:migrate` afterwards was a no-op (13 recorded
    migrations, latest `1791867164750`).
  - **Alerts:** the current notification scan kept all 40 release-one
    alerts (none retired, none duplicated) and queued no email, since
    delivery is off.
- **Clean-up:** the rehearsal database and worktree were removed, and the
  real test database was restored. `node_modules` is intact.

**Results**

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | Baseline at the step 6 commit: **774 passed**, 30 files. Final, with the acceptance suite: **784 passed, 0 failed**, 31 files |
| `crAcceptance.test.ts` | 10 of 10 (after fixing the test's own mistakes, above) |
| `npm run test:smoke` | Every spec passed (smoke+m2 12, m3 2, m4 3, **m5 3**, m6 4, m7 1, cr3 1, cr45 1, cr2 1, cr2-step6 2, cr1 1, cr6 1), except `accountAccess` in the first run. After the helper fix it passed: Chromium 1 of 1 |
| `npm run test:browsers` | m8: Chromium, Edge and Firefox passed. crInterface: Chromium, Edge and Firefox passed. accountAccess: Firefox passed; Chromium and Edge failed as above, then passed when re-run (1 of 1 each) |
| `npm run build` | Pass, with demo exclusion |
| `npm run check:production-server` | 20 passed, 0 failed |
| Upgrade rehearsal 0007 → 0012 | As above: 10 of 10 accounts identical |

**Browser checks covering the demonstrations:**

- **Activation:** `cr1.spec.ts`, `m3.spec.ts`.
- **Link states:** `accountAccess.spec.ts`, in three browsers.
- **Password change:** `cr3.spec.ts`, `accountAccess.spec.ts`.
- **The earlier Chrome session-token problem** (stale duplicate `penta.sid`
  and CSRF cookies injected, then sign-in): `accountAccess.spec.ts`, in three
  browsers.
- **Multi-section administration:** `cr45.spec.ts`.
- **Procurement:** `cr6.spec.ts`.
- **Email administration:** `cr2.spec.ts`, `cr2-step6.spec.ts`.

**Documents updated**

- **Requirements:** `docs/Penta_CRM_Requirements.md`. The single-section
  rules are amended in place: the central rule, the permission matrix,
  FR-002, BR-001, BR-002, BR-051, BR-052, FR-090, SEC-030, the data model,
  AT-02, AT-03 and AT-09. The original wording is kept beside each
  amendment.
- **Plan:** `Plan.md` §3.1 (scope is `section_id IN actor.sectionIds`, read
  fresh), §3.2, and a change-request entry in §6.
- **Release documents:**
  - `docs/release/acceptance-matrix.md`: 47 change-request rows, 43
    complete and 4 partial;
  - `docs/release/interface-quality.md`;
  - new `docs/release/cr-release-handover.md`: migration, configuration,
    worker, backup, rollback and remaining issues.
- **Project notes:** `CLAUDE.md`.

**Database.** No schema change in step 7, so there is no new production
script. The five existing scripts (0008–0012) are the complete set. Their
order, checksums and instructions are in
`docs/operations/sql/sql_instructions.md`.

**Readiness.**

- **Ready for staging UAT,** on synthetic data, with `EMAIL_TRANSPORT=none`
  or, once D-EM-1 is decided, `smtp`.
- **Not ready for production.** The three release blockers remain:
  document storage and scanning, the identity provider and MFA, and a
  staging environment.
- **Not run here:** real email, staging capacity, the restore drill and
  monitoring on staging, Safari and mobile browsers, screen readers, and
  AT-17 sign-off.

### 18. Settings → Mail Server screen (13 October 2026)

**Instruction.** Rather than hard-coding the mail server, give the
administrator a screen under **Settings → Mail Server**, in the application
theme, saving the values in the database. Change no other feature.

**Finding.** The mail server was already not hard-coded. Since CR2 step 3,
its values have been saved in the `email_settings` table (migration 0009)
through the Email delivery panel's dialog on the Administration page. This
step therefore adds the dedicated screen and **no table**: the existing
table, endpoint, validation, encryption, version check and audit are reused
unchanged.

**What was built**

| Area | Change |
| --- | --- |
| Navigation | The administrator's sidebar gains a **Settings** heading with **Mail Server** (`/settings/mail-server`). Only the System Administrator sees it; the route sits inside the existing administrator-only guard, and other roles see the standard "No access to account administration" panel |
| Screen (`src/app/pages/MailServerSettingsPage.tsx`) | Uses the existing page header, panels, fields, buttons and the navy/teal theme tokens. **Delivery** (on/off). **Server** (host, port, connection security). **Sign-in** (user name, write-only password, remove the stored password). **Sender** (name, address, reply-to). Save and Discard changes, with an unsaved-changes note. A side column shows delivery on/off, this server's `EMAIL_TRANSPORT` mode, whether a password is stored and readable, and who last changed it. It also has **Check connection** and **Send test email** (the existing test dialog, now exported from `EmailAdministration.tsx`). Stacks to one column on narrow screens |
| Server | No change: `GET`/`PUT /api/admin/email/settings`, `POST /api/admin/email/verify` and `POST /api/admin/email/test` are reused, with their administrator checks, validation (delivery needs host, port and sender), stale-save conflict (409), AES-256-GCM password storage and audit (`email.settings_updated`, password recorded only as "replaced" or "removed") |
| Unchanged | The Email delivery panel on the Administration page still works as before; both edit the same saved settings. `EMAIL_TRANSPORT` and `EMAIL_SECRET_KEY` stay in the server environment on purpose: the first is the deployment's permission to send at all, and the second is the key that protects the stored password, which must never sit in the database it protects |

**Database.** No schema change and **no production SQL script** is needed:
`email_settings` already exists in production once
`0009_email_settings_templates_and_deliveries.production.sql` is applied
(`docs/operations/sql/sql_instructions.md`).

**Tests**

- **`e2e/mailServerSettings.spec.ts` (new, added to `test:smoke`):**
  - the administrator opens Settings → Mail Server from the sidebar;
  - turning delivery on without a server is refused next to the field;
  - the settings save, and a reload shows them, with the password field
    empty, the page never containing the typed password, and "Stored,
    encrypted" shown;
  - the connection check reports capture mode;
  - a test message is captured;
  - at 360 px there is no horizontal scroll;
  - management has no Mail Server link and sees the access-denied panel at
    the address.

  Evidence: `docs/evidence/cr/mail-server-settings-1440.png` and
  `mail-server-settings-360.png`.
- **First run:** 2 failures, both in the new test: a sign-in field label,
  and an assertion spanning two elements. Both fixed; then 2 of 2.

**Results**

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `e2e/mailServerSettings.spec.ts` | 2 passed |
| Regression browser checks | `cr2` 1, `cr2-step6` 2, `crInterface` 2 and `m3` 2 passed |
| `npm run build` | Pass, with demo exclusion |
| `npm test` | Not rerun: no server, shared or database code changed |

### 19. Invitation not emailed in production: investigated (13 October 2026)

**Report.** On the production server the mail server was set and a test
message reached `milton@pentabd.com`. Creating the user "Milton" sent no
invitation email; the "Invitation link" copy dialog appeared instead.

**Cause: configuration, not code.** An invitation (or reset link) is
emailed only while **both** hold (`deliverAccountLink`,
`server/services/admin.ts`):

1. this server may send (`EMAIL_TRANSPORT=smtp`); and
2. **"Send email from the CRM"** is on (Settings → Mail Server, Delivery;
   `email_settings.enabled`).

Otherwise the link is shown to copy (D-CR1-1). A **test message is sent
even while delivery is off**, by design (ADR 0011), so a successful test
does not show that switch 2 is on.

**The screenshot confirms it.** Milton's row shows **"New invitation"** with
a key icon. The page shows "Email invitation" with a mail icon only while
both switches are on. So production had delivery off, and no invitation
email was queued. Since the test message was sent, switch 1 (smtp) is set;
switch 2 is the one that is off.

**What changed (wording only; no server, rule or database change)**

- **The copy-link dialog says why the link was not emailed** when the
  administrator did not choose to copy it. With delivery off: "Not emailed:
  email delivery is off. To email invitations and reset links, turn on
  'Send email from the CRM' under Settings → Mail Server." With
  `EMAIL_TRANSPORT=none` it names that instead. A link copied on purpose
  ("Copy link") shows no such note. Files: `AdminDialogs.tsx`,
  `AdministrationPage.tsx`.
- **The Mail Server page, while delivery is off,** says that invitations,
  password emails and notifications are not emailed, and that a test
  message is still sent, so a successful test does not mean delivery is on
  (`MailServerSettingsPage.tsx`).

**Database.** No change and no SQL script.

**Tests**

- **`server/tests/invitationSmtp.test.ts` (new, 2):** runs the real SMTP
  transport against a local SMTP sink on 127.0.0.1, so nothing leaves the
  machine.
  - **Delivery on:** creating a user returns no link; the job sends one
    message over SMTP to the user's address, from the configured sender,
    subject "Your Penta CRM account"; the delivery is `sent`; and the link
    in the message activates the account.
  - **Delivery off:** a test message is sent, but creating a user returns a
    link to copy and queues no invitation. This reproduces the production
    symptom.

  Both passed on the first run, which confirms the code path.
- **Browser checks:** `e2e/m3.spec.ts` now also checks the dialog's
  explanation, and `e2e/mailServerSettings.spec.ts` the Mail Server note.

**Results**

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 errors, the same 5 warnings) |
| `npm test` | **786 passed, 0 failed**, 32 files |
| Browser checks | `m3` 2, `mailServerSettings` 2, `cr1` 1 and `cr2` 1 passed |
| `npm run build` | Pass, with demo exclusion |

**To fix production (no deployment needed):**

1. Sign in as the administrator and open Settings → Mail Server.
2. Tick "Send email from the CRM" and save. The SMTP password must show
   "Stored, encrypted".
3. On Administration, Milton's row now shows "Email invitation". Click it,
   or create the next user; the invitation is emailed when the worker
   runs, within seconds.

The earlier copied link stays valid until it expires or a new invitation
replaces it. Deploying this commit adds only the explanations above.

### 20. Maintenance script: remove an unused user account (13 October 2026)

**Request.** A script to remove a particular user from the database, kept
with the other SQL scripts.

**Added:** `docs/operations/sql/remove_unused_user.sql`, documented in
`sql_instructions.md` §7. It is a psql script run by the database
administrator as `penta_migrator`; it is not a migration, and no
application code changed.

**Why it removes only unused accounts.** The CRM keeps history on purpose:
every foreign key to `users` refuses deletion, and the audit is
append-only. An account that owns or created records, or performed any
audited action, cannot be deleted without destroying that history. For such
an account the script refuses, lists what refers to it, and points to
**Administration → Deactivate**, which ends access at once.

**What it does**

- **Inputs:** `-v email=…` (matched without regard to case) and
  `-v reason=…` are required.
- **Dry run by default:** it shows the account and what would be removed,
  then rolls back. `-v apply=true` commits.
- **Refuses, changing nothing:**
  - an unknown address;
  - any account that something else refers to. This is found from the
    database's own foreign-key catalog, so future tables are covered
    automatically;
  - a section lead;
  - the manager of a section lead;
  - the last active System Administrator.
- **Removes**, for that account only:
  - its invitation and reset links;
  - its section memberships;
  - its email delivery log rows;
  - its in-app alerts;
  - its retry-protection records;
  - its sessions;
  - the account itself.
- **Audit:** it records `account.removed` (administrative, no actor, with
  name, email, role and the reason) and keeps the earlier audit events.
- **One transaction:** a refusal or any error leaves the database
  unchanged.

**Tested** on the seeded test database, with a never-activated invited
account (membership, invitation link, delivery-log row and
`account.created` audit) built as the application builds one:

| Case | Result |
| --- | --- |
| No arguments | Usage message, nothing run |
| Unknown address | Refused: "No account has the email address …" |
| Salesperson with history (Rafiq; address given in mixed case) | Refused, listing 10 activities, 7 contacts, 4 + 4 follow-up references, 5 opportunities created, … |
| Section lead (Nadia) | Refused: "leads 1 section(s): use Replace lead first" |
| Dry run on the unused account | Listed 1 link, 1 membership, 1 delivery row, 0 alerts, 0 retry records, 0 sessions; ROLLBACK; the account still present |
| `apply=true` | COMMIT. The account and its rows are gone, with no orphaned links. `account.created` is kept, and `account.removed` is added with reason "Created by mistake" and no actor |
| Rerun | Refused: the address no longer exists |

**Database.** No schema change.

### 21. Next task

**Staging UAT** (`docs/release/cr-release-handover.md`, `pilot-handover.md` §4):

1. Provision staging.
2. Apply 0008–0012 with the production scripts.
3. Run the UAT scenarios with management, a lead and a salesperson.

Penta's decisions:

- **D-EM-1:** the mail server. Then a test email on staging.
- **D-EM-2:** email content.
- **D-EM-4:** recipients, as extended in step 6.
- **Defaults to confirm:** reminder 09:00, 72 hours, weekly summaries on
  Sunday, summaries off.
- **The aged m5 fixture:** the browser check now copes, but making seeded
  dates relative is still open.
- **Review** of the check-production-server rule for empty expired cookie
  headers (step 1).

The three release blockers are unchanged: document storage and scanning,
identity provider and MFA, and staging. No production deployment or real
data without explicit written authorization.

---

## Milestone 8 — release preparation

**Branch:** `m8-release-preparation`, created from `m7-audit-mutation-controls` at `1ce9c79`
**Commit:** the Milestone 8 commit that contains this section
**Date:** 06 October 2026
**Status:** Complete as release *preparation*. **Not production-ready**: three
release blockers need Penta (§8). Nothing merged, pushed or deployed; no live
infrastructure touched, no paid service created, no real data used.

Release documents: `docs/release/` — [acceptance matrix](release/acceptance-matrix.md),
[security review](release/security-review.md),
[capacity and performance](release/capacity-and-performance.md),
[interface quality](release/interface-quality.md),
[pilot handover](release/pilot-handover.md). Runbooks: `docs/operations/`.
Decisions: ADR 0009.

### 1. Milestone 7 check before starting

| Handover claim | Finding |
| --- | --- |
| `1ce9c79` on `m7-audit-mutation-controls`, clean tree | **Confirmed** |
| Migration `0007` applied | **Confirmed**; repeat run no-op |
| typecheck, lint | **Pass**; lint 0 errors, 5 pre-existing warnings |
| `npm test` 632 passed | **Rerun on the M8 branch: 632 passed**, 21 files |
| `npm run test:smoke` 25 passed in six runs | **Rerun: 25 passed** (12 + 2 + 3 + 3 + 4 + 1) |
| `npm run build` | **Pass** |

No M7 blocker. M7's open items (follow-up edit/reassign; who sees directory
and export audit) are product decisions and stay recorded (§8).

### 2. What was done, by area

| Area | Work | Evidence |
| --- | --- | --- |
| 1. Requirements and regression | Requirement-to-evidence matrix for **all 95** identifiers (checked by script against the requirements): **76 complete, 18 partial, 1 unresolved**, each with its test evidence and gap. Full regression across all roles (§5) | `docs/release/acceptance-matrix.md` |
| 2. Security | Review of authentication, sessions, CSRF, permissions, uploads/downloads, exports, secrets, logging; dependency audit and fixes; Git-history secret scan; **the compiled server started in production mode** and probed (19 checks); bundle scanned for seed/demo content; storage/scanning behaviour and MFA readiness written down; items for independent review listed | `docs/release/security-review.md`, `scripts/check-production-server.ts` |
| 3. Interface quality | `e2e/m8.spec.ts` in **Chromium, Microsoft Edge and Firefox**: 5 screens × 1440/768/360 px without page-level horizontal scroll, navigation reachable, keyboard-only sign-in, visible focus, dialog focus and Escape, readable sign-in and field errors, Bangla, BDT grouping, network failure, uncertain-failure retry with the same idempotency key, back navigation keeping filters; screenshots | `docs/release/interface-quality.md`, `docs/evidence/m8/` |
| 4. Capacity and performance | Synthetic envelope generator (100 users, 10 000 opportunities, 60 000 activities + 40 000 follow-ups, 110 000 audit events), 30-user load test (paced and saturation), first-usable-page timing of the production build with emulated office broadband; one bottleneck found by query profiling and fixed; controlled before/after | `docs/release/capacity-and-performance.md`, `docs/evidence/capacity/` |
| 5. Operations | Readiness probe; request log; job health check for monitoring; environment, deployment/migration/rollback, monitoring and backup/restore runbooks; **consistent encrypted backup and verified restore, drilled end to end** (the application run on the restored copy); first-administrator bootstrap | `docs/operations/`, `docs/evidence/operations/restore-drill.md` |
| 6. Pilot handover | Local and staging startup, synthetic accounts, role-based UAT scenarios, known limitations, blockers with owners, release checklist | `docs/release/pilot-handover.md` |

### 3. Defects found and fixed

| # | Defect | Fix | Evidence |
| --- | --- | --- | --- |
| 1 | **High-severity runtime advisory** in React Router (`@remix-run/router` open redirect → XSS) | `react-router-dom` 6.30.2 → 6.30.6 (patch); also `postcss` 8.5.29 and `@typescript-eslint` 8.71.1 | `npm audit --omit=dev`: high → 2 moderate (not reachable; see security review §2) |
| 2 | **Dashboard team workload rescanned every open follow-up per person** — 269 of 332 ms of a management dashboard at the envelope; dashboard requests over 2 s under load | Aggregated once per owner using the shared metric fragments | Query 269 → 16 ms; saturation dashboard p95 1 758 → 872 ms, max 2 527 → 1 854 ms (controlled before/after) |
| 3 | **The workload's task columns were untested**: a deliberately broken variant (counting closed tasks as open) passed every test, because the fixtures have no closed tasks | New test completes a task first and reconciles open/overdue per owner with the follow-up lists | Mutation now detected |
| 4 | **No way to create the first administrator** of an empty deployment (FR-001; the seed rightly refuses production) — a deployment blocker | `npm run ops:create-first-administrator`: only while no active administrator exists, invitation link once, audited | `m8Operations.test.ts` (refused when one exists; creates, link works once, second run refused) |
| 5 | **"Back to Opportunities" dropped the list filters** (FR-013) | The list passes its own address to the record page | `m8.spec.ts` in three browsers |
| 6 | **Edit dialog said stage/status/ownership changes were "not available in this release"** — untrue since M2/M3 | Accurate wording | `m8.spec.ts` snapshot |
| 7 | **The navigation landmark was unnamed** (the label sat on the surrounding panel) | `aria-label` on the `<nav>` | `m8.spec.ts` |
| 8 | No readiness probe or failure log for monitoring (NFR-003) | `/api/health/ready`, `REQUEST_LOG`, `jobs:run -- --check` | `m8Operations.test.ts`, `check:production-server` |

Tooling defects of my own, found and fixed during the work: the page-load
script waited forever on Vite's coloured URL and on a Windows-reserved port
(4173); a regular expression in my first M8 browser test matched the page's
"Last updated" label; Sonner keeps a success toast while focused, so the test
now dismisses it before asserting none.

### 4. Database

No application migration in M8. New local databases created by tooling only:
`penta_crm_capacity` (capacity dataset) and scratch `penta_crm_restore_*`
databases that the drill drops again.

### 5. Commands run and results (final run, on the commit's code)

| Command | Result |
| --- | --- |
| `npm run typecheck` | **Pass** (web, server and scripts, e2e) |
| `npm run lint` | **Pass** — 0 errors, the same 5 pre-existing warnings |
| `npm run check:env` | **Pass** — 28 variables |
| `npm test` | **640 passed, 0 failed**, 22 files (632 after M7 + 7 in `m8Operations.test.ts` + 1 dashboard reconciliation) |
| `npm run test:smoke` | **25 passed** in six isolated runs (12 + 2 + 3 + 3 + 4 + 1) |
| `npm run test:browsers` | **5 passed in each of Chromium, Microsoft Edge and Firefox** (the Edge run took 18 min end to end, almost all of it browser start-up; its tests took about a minute) |
| `npm run build` | **Pass**, demo-exclusion before and after bundling |
| `npm run check:production-server` | **19 passed, 0 failed** |
| `npm audit --omit=dev` | 2 moderate (React Router 6; not reachable from user input; fix needs v7) |
| `npm run capacity:seed`, `capacity:load`, `capacity:pages` | As in §6 and `docs/release/capacity-and-performance.md` |
| `npm run ops:restore-drill` | **Pass**: every verification, the app on the restored copy, tampering refused |
| `npm run jobs:run -- --check` | `OK` on the development database |

Capacity, page-load and restore-drill results are in their reports
(numbers summarised in §6). New test files: `server/tests/m8Operations.test.ts`
(7 tests: readiness 200/503, job health verdicts, request log content and
quiet mode, first-administrator bootstrap) and `e2e/m8.spec.ts` (5 tests × 3
browsers); `server/tests/dashboard.test.ts` gained the workload reconciliation
test.

### 6. Key measurements (laptop: i5-8365U, 16 GB, Docker Desktop; not staging)

| Measure | Result | Proposed target |
| --- | --- | --- |
| API p95, 30 users at reading pace | 160 ms (0 errors in 2 575 requests) | < 2 s |
| API p95, 30 requests always in flight | 626 ms; no request over 2 s (0 errors in 8 736) | < 2 s |
| First usable page, medians (loopback / emulated office broadband) | 0.3–1.2 s / 0.4–1.5 s; one cold-start outlier 4.7 s | < 3 s |
| Notification scan of the whole dataset | 2.8–5.9 s | hourly job |
| Backup / verified restore (fixtures + files) | 1.1 s / 2.3 s | — |
| Capacity database dump / restore (≈100 MB) | 4.9 s / 7.9 s | RTO 4 h (unconfirmed) |

### 7. Requirement and acceptance coverage

See the matrix. Changes in M8: FR-001 (bootstrap), FR-013 (back
navigation), NFR-003 (probes, request log, job check), NFR-002 (backup,
restore, drill), NFR-010/011 (measured, laptop), NFR-012 (three browsers),
SEC-032 (request log never records query strings) — each still **partial**
where it depends on staging or a Penta decision. AT-16 partial (restore drilled
locally, not on staging); AT-17 unresolved (needs Penta's people).

### 8. Remaining blockers and limitations

**Release blockers (Penta decisions):**

1. **Production document storage and malware scanning** (SEC-010, AT-13). Only
   a local directory and a development TEST scanner exist; production refuses
   the TEST scanner and, with none, keeps every upload unavailable.
2. **Identity provider and MFA for privileged roles** (SEC-030/031). No MFA
   exists.
3. **Hosting and a staging environment**, on which capacity, restore,
   monitoring and UAT must be repeated.

**Also before production:** independent security review / penetration test;
UAT and visual sign-off (AT-17); operational targets, retention and support
ownership confirmed; the tooling upgrades (Vite, Vitest, Tailwind,
drizzle-kit majors) and React Router 7.

**Product decisions (not blocking a synthetic pilot):** follow-up
edit/reassign (FR-042); Activities & Follow-ups calendar (FR-043); owner,
section and organization selectors on the list (FR-022); who sees directory
and export audit; alert recipients and business-day start (FR-090).

**Limits of the evidence:** a laptop, not staging; one API process; emulated
bandwidth; Chromium/Edge/Firefox on Windows only, no real mobile devices; no
screen-reader or contrast audit; the security review is a developer
self-review.

### 9. Readiness recommendation

- **Synthetic-data pilot and UAT: ready**, locally or on a staging
  environment Penta provides, following `docs/release/pilot-handover.md`.
- **Production deployment and real sales data: not ready, and not
  recommended** until blockers 1–3 are resolved and the release checklist
  (pilot handover §7) is complete with evidence from staging.

### 10. Next task

Development stops at the end of Milestone 8. Next, in order and only when
instructed: Penta's decisions on the blockers and product questions in §8; a
staging environment; then the staging items of the release checklist.

---

## Milestone 7 — audit and mutation-control sweep

**Branch:** `m7-audit-mutation-controls`, created from `m6-dashboards-reports-notifications` at `029c560`
**Commit:** the Milestone 7 commit that contains this section
**Date:** 06 October 2026
**Status:** Complete for development and ready for review. Not merged, not
pushed, not deployed. **Production document storage and malware scanning
remain unresolved** (Milestone 5, §8; ADR 0006). Milestone 8 not started.

### 1. Milestone 6 check before starting

| Handover claim | Finding |
| --- | --- |
| Branch `m6-dashboards-reports-notifications` at `029c560` | **Confirmed.** The M7 branch already existed at that commit (created in an earlier session) with **one uncommitted change** in `server/services/admin.ts`. It was stashed, M6 was verified without it, then it was restored, reviewed and kept (§3, fixes 4 and 5) |
| Migration `0006` applied | **Confirmed**; `db:migrate` / `:test` no-ops |
| `npm run typecheck`, `npm run lint` | **Pass**; lint 0 errors, the same 5 pre-existing warnings |
| `npm test` — 479 passed | **Rerun: 479 passed, 0 failed**, 20 files |
| `npm run test:smoke` — 24 passed in five runs | **Rerun: 24 passed** (12 + 2 + 3 + 3 + 4) |
| `npm run build` with demo exclusion | **Rerun: pass** |

No blocker for Milestone 7.

### 2. What was audited

Every implemented mutation endpoint was read against FR-062, SEC-012,
BR-090 and BR-091, then exercised through the real app in
`server/tests/m7MutationControls.test.ts`:

| Area | Mutations |
| --- | --- |
| Opportunities | create; basic edit; stage (forward, skipped/backward with explanation, Awarded, Lost); status (On Hold, Cancelled, return to Active); management reopening; transfer |
| Follow-ups | create; complete (with replacement); reschedule; cancel (with replacement); closure on Lost/Cancelled; reassignment on transfer |
| Directory | organization create / edit / archive; contact create-and-link / identity edit / archive |
| Relationship links | link; notes; remove |
| Activities | log (with next follow-up); amend |
| Tenders | create (superseding); edit; submit (with and without the stage change); designate current; cancel notice |
| Documents | finalize (new document, revision); category; archive; system scan verdict |
| Administration | account create (with invitation) / edit / role change / deactivate / reactivate / sign-in link; section create / rename / replace lead / deactivate |
| Reporting | CSV export request (job and download events covered in `reports.test.ts`) |

### 3. Findings and fixes

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| 1 | **The basic edit answered 409 to someone who had just lost access.** `patchOpportunity` read the record outside its transaction and relied on the version predicate. A previous owner's edit queued behind a transfer got `409 version_conflict` — revealing that the record exists and changed — instead of the standard 404 (SEC-003, SEC-005). The audit's before-values also came from that unlocked read | Access / disclosure | The record is read and locked through scope (`FOR UPDATE`) inside the transaction; version checked after the lock and in the UPDATE predicate. Detected by the race test (old code: 409) |
| 2 | **Activity amendment did not lock the opportunity.** It locked only the activity, so a transfer could commit between the scope check and the update and the previous owner's edit landed after their access ended (SEC-005, lock order of ADR 0003) | Access | Locks the parent opportunity through scope first, like every other writer. Detected by the race test (old code does not queue behind the transfer) |
| 3 | **A retried activity creation could answer 404.** The replay searched only the first 100 activities of the record; a back-dated activity on a busy record was not found, so a successful creation's retry reported "not found" (BR-091) | Retry correctness | Replay reads the one activity through scope (`getActivity`). Regression test inserts 100 later activities; old code fails it |
| 4 | **Re-pointed reporting lines were not audited.** Installing a section lead (create, role/section change, reactivation, replacement) changed every salesperson's `manager_id` with no event of its own (FR-062 account changes) | Audit gap | Each re-pointed person gets `account.manager_changed` with before/after manager, actor, request id and the reason, in the same transaction. *(Found as uncommitted work in the tree; reviewed, completed and tested here.)* The demoted lead's `account.role_changed` now also records their previous manager |
| 5 | **Some account and section changes skipped the administrator lock.** Account creation, reactivation, sign-in links and all section changes did not lock the active administrator rows first, so an administrator deactivated while such a request waited could still complete it, and two administrative transactions could lock users and sections in different orders (ADR 0004) | Authorization / deadlock | Every account and section change starts with `beginAdministrativeChange` (lock administrators in id order, then require the actor still to be one; 403 otherwise). *(Also found as uncommitted work; reviewed and tested.)* Three race tests; old code fails all three |
| 6 | **History pages had no defined order.** Events of one transaction share a timestamp (all of them under the test clock); ordering by time alone left page boundaries undefined, so an entry could appear on two pages or none | History correctness | Migration `0007`: `audit_events.sequence` (identity). Commercial and administrative history order by `(occurred_at, sequence)` |
| 7 | **The Change History tab showed only the first 50 entries**, and the activity log likewise, with no way to page | Bounded views | Both tabs page at 25 with the existing `Pagination` control; the API was already paginated |
| 8 | `document.archived` recorded no before/after state, only the reason | Audit detail | Records `archived: false → true` (labelled "Archived" in history) |

**Checked and found correct** (each with tests in the new file): every other
mutation writes exactly the events listed in the matrix, by the acting
person, under the request's own server-generated id, with the opportunity set
for commercial events and unset otherwise; reasons are stored where the
requirements ask for one (transfer, reschedule, cancel, status changes,
skipped/backward stages, reopening, archives, lead replacement, notice
cancellation); refused and invalid mutations (403/404/409/422) write no audit;
no password, token or file content appears in any audit payload.

**Files changed.** Services: `opportunities.ts` (basic edit), `activities.ts`
(lock order, `getActivity`), `admin.ts` (administrator lock, reporting-line
audit), `documents.ts` and `audit.ts` (archive values, label). Route:
`routes/opportunities.ts` (activity replay). Schema and migration `0007`.
UI: `OpportunityDetailPage.tsx` (paged Change History and activity log),
`AdministrationPage.tsx` (audit label). Tests: `server/tests/m7MutationControls.test.ts`,
`e2e/m7.spec.ts`. Docs: ADR 0008, this report, README and CLAUDE.md (six
smoke runs, lock order). `package.json`: the M7 browser run.

### 4. Database

| Migration | Contents |
| --- | --- |
| `0007_audit_event_sequence.sql` | `audit_events.sequence bigint GENERATED ALWAYS AS IDENTITY`. Existing rows numbered in physical order. Runtime role unchanged: SELECT and INSERT only; the identity cannot be set on insert or changed |

Additive; rollback in the header. Applied to the development and test
databases; a repeat run is a no-op.

### 5. Commands run and results

| Command | Result |
| --- | --- |
| `npm run db:migrate` / `:test` | `0007` applied to both; repeat run no-op |
| `npm run typecheck` | **Pass** (web, server, e2e) |
| `npm run lint` | **Pass** — 0 errors, the same 5 pre-existing warnings |
| `npm test` | **632 passed, 0 failed**, 21 files (479 after M6 + 153 new) |
| `npm run test:smoke` | **25 passed** in six isolated runs: 12 (smoke + M2), 2 (M3), 3 (M4), 3 (M5), 4 (M6), 1 (M7). The first M7 attempt failed on two locators of my own (board view instead of table; a revision text shown twice on page 2); corrected and rerun |
| `npm run build` | **Pass**, demo-exclusion before and after bundling; server compiled |

`npm run test:smoke` is now **six** isolated Playwright runs; `e2e/m7.spec.ts`
makes 27 audited edits through the API and pages the Change History tab
(1–25 of 27, then 26–27 with the oldest edit).

**`server/tests/m7MutationControls.test.ts` — 153 tests**

| Section | Tests | What it proves |
| --- | --- | --- |
| FR-062 audit matrix | 45 | One test per mutation (42) checks the exact event list, actor, the response's `X-Request-Id`, domain, opportunity link, timestamp, changed keys and required reason; system events (scan verdicts) separately. A **completeness check scans the services for audit action names** and fails if a new one is not in the matrix or explicitly listed as tested elsewhere. Refused/invalid mutations write nothing |
| BR-091 retries | 19 + 3 + 14 | For all 19 keyed operations: a retry returns the same entity and changes **no table at all** (whole-database digest); the same key with another payload is `409 idempotency_key_reuse` and changes nothing; after a transfer removes access the replay is the standard 404 (14 commercial operations). Keys are scoped by actor and by operation. For the 14 operations that lock an opportunity, a **duplicate sent while the first is held mid-transaction** is `409 idempotency_in_progress`, the first completes, and a later retry replays it with nothing new. Busy-record activity replay |
| BR-090 stale versions | 27 + 1 | For every versioned mutation (27): a commit after the client's read makes the client's write a `409 version_conflict` with **the whole database unchanged**; the same write at the current version then succeeds (control). Two edits from one version, genuinely concurrent: one 200, one 409, one audit event, winner's value kept |
| Atomicity | 14 | A trigger fails the **last** audit insert of each multi-write operation (transfer after the owner change, Lost while cancelling tasks, completion at its replacement, tender at creation after superseding, submission at its stage change, finalization after the revision row, lead replacement after both role changes, …). Response 500 with no internal text; **every table identical**, the idempotency claim included; the same key then succeeds once |
| Transfer races | 3 + 11 | A separate connection holds the opportunity row while two requests queue (`pg_locks` confirms both waiting), so the order is certain. Transfer → old owner's completion: 404, every open task with the new owner. Completion → transfer: both apply, the completed task keeps its assignee and completer. Transfer → lead's completion of the reassigned task: 409, task untouched. **Eleven old-owner writes queued behind a transfer** (edit, stage, follow-up, activity log and amendment, notes, link, document category and finalization, tender edit, submission): each the standard 404, no audit |
| ADR 0004 | 3 | An administrator deactivated while their change waits gets 403, nothing written (section, account, sign-in link) |
| SEC-005 channels | 1 | After a cross-section transfer, the previous owner **and** lead lose: detail, follow-ups, history, activities, contacts tab, documents, tenders, assignees, the only-linked contact, the shared contact, document metadata and download, list, contacts list, follow-up list, search, alerts (and unread count), activity/follow-up/document writes, and the export prepared before the transfer (409, no content). The new owner gains them; history keeps the earlier authors |
| SEC-012 history | 8 | Commercial history pages completely and in append order with equal timestamps; 422 for page size > 100, page 0, non-numeric and unknown parameters (both views); others and the administrator get the standard 404; directory, reporting and administrative events never appear in commercial history; administrative audit is 403 for management, lead and sales and pages completely |
| SEC-012 role | 4 | Runtime role: SELECT and INSERT on `audit_events` only (UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES and column-level UPDATE all false); not superuser, no CREATEROLE/CREATEDB/BYPASSRLS, not a member of the owner role, cannot disable triggers; deleting an audited opportunity or user is refused by the foreign keys and the audit count is unchanged; the append order cannot be set or rewritten |

**Mutation checks** — each fix was reverted and the tests re-run: old
`patchOpportunity` (the basic-edit race test fails with 409), activity
amendment without the opportunity lock (its race test fails), paged activity
replay (busy-record test fails), M6 `admin.ts` (three administrator races and
the lead-replacement audit test fail). **Not detected:** removing the
`sequence` tie-break from history ordering — PostgreSQL happened to return a
consistent order in the test; the guarantee rests on the explicit `ORDER BY`,
not on a test that can tell the difference.

### 6. Requirement and acceptance coverage

| Requirement | Status |
| --- | --- |
| FR-062 | **Complete for implemented features.** Every implemented create/edit, transition, task assignment/completion/rescheduling, transfer, contact-link change, document revision, account change and export is audited with actor, event type, entity, time, request id, before/after values and reason where required; no passwords, tokens or file content. Verified mutation by mutation, with a completeness check |
| SEC-012 | **Complete.** Commercial events carry their opportunity and are read only through its scope; administrative audit is administrator-only; directory and reporting events appear in neither view; append-only for the runtime role, verified at privilege level; history of a transferred record keeps earlier authors |
| BR-090 | **Complete.** Every versioned write checks the version after its lock and in its UPDATE predicate; stale writes are 409 with nothing changed; every writer of an opportunity's data locks the opportunity first; transfer/task races verified both ways on real concurrent connections |
| BR-091 | **Complete** for create, transfer, submit and upload finalization, and for every other create-style or transition operation (19 keyed operations). Versioned edits deduplicate through their version (ADR 0008) |
| AT-15 | **Covered**: stale save 409 without overwriting; simultaneous transfer/task updates consistent; retried creates produce one record; committed data persists across sessions (M1/M2 browser checks) |
| Plan §6 M7 | Commercial and administrative audit views separate, paginated and scope-checked; optimistic concurrency and idempotency verified across create, stage/status, tasks, transfers, activities, tender submission and upload finalization; errors and retries leave no partial records or duplicate audit |

### 7. Unresolved issues and limitations

**Unresolved production decisions — unchanged, not claimed ready:**
production document storage and malware scanning (ADR 0006); identity
provider and MFA; job execution and monitoring in production (M8).

**Found during the audit, not fixed (outside M7's scope):**

- **Follow-ups cannot be edited or reassigned individually.** §13 lists
  "edit … reassign within eligibility" for follow-ups; only create, complete,
  reschedule and cancel exist (reassignment happens only with a transfer).
  This is a missing feature from Milestone 2, not a control gap; it needs a
  product decision before it is built.
- **No screen shows directory or reporting audit.** Organization/contact
  identity edits and CSV exports are audited (FR-033, FR-083) but shown
  nowhere. The requirements ask for the audit, not a view; who may see an
  export log is a question for Penta (ADR 0008).

**Other limitations:**

- Versioned edits (PATCH, archive, deactivate, …) carry no idempotency key: a
  retry after a lost response is a 409 and the browser offers reload. No
  duplicate change or audit is possible.
- The ordering guarantee for history pages is not proved by a failing test
  (§5, mutation checks).
- From earlier milestones, unchanged: account-link token cleanup is
  unscheduled; the Activities & Follow-ups calendar view is unavailable; five
  pre-existing fast-refresh lint warnings; management receives every alert
  and the business day starts at 00:00 Dhaka (M6 decisions for review).

### 8. Configuration and local startup

Nothing new to configure. After pulling:

```bash
npm run db:migrate && npm run db:migrate:test   # 0000–0007
npm test                                       # 632 tests
npm run test:smoke                             # six Playwright runs
```

To see M7: as `rafiq.hasan@example.com`, open *Municipal Service Portal* →
Change History; after more than 25 changes it pages. As `admin@example.com`,
replace a section lead and read the Administrative audit: each re-pointed
salesperson appears as "Reporting line changed".

### 9. Next task

Feature development stops at the end of Milestone 7. Next session, in order:

1. **Verify Milestone 7** against this section: branch and commit, clean
   tree, migration `0007` applied; re-run `npm run typecheck`, `npm run lint`,
   `npm test` (expect 632 passed), `npm run test:smoke` (expect 25 passed in
   six runs) and `npm run build`.
2. Take Penta's decisions on the two audit findings in §7 (follow-up
   edit/reassign; who sees directory and export audit).
3. **Begin Milestone 8 — release preparation** (`Plan.md` §6) **only when
   instructed**.

---

## Milestone 6 — dashboards, reports, CSV export, search and notifications

**Branch:** `m6-dashboards-reports-notifications`, created from `m5-tenders-documents` at `f656f7e`
**Commit:** the Milestone 6 commit that contains this section
**Date:** 06 October 2026
**Status:** Complete for development and ready for review. Not merged, not
pushed, not deployed. **Production document storage and malware scanning
remain unresolved** (Milestone 5, §8; ADR 0006). Milestone 7 not started.

### 1. Milestone 5 handover review

Checked against the repository before any change:

| Handover claim | Finding |
| --- | --- |
| Branch `m5-tenders-documents`, commits `1e6fe5a` + `f656f7e`, clean tree | **Confirmed**; nothing uncommitted or unrelated to preserve |
| Migration `0005` applied to both databases | **Confirmed**; `npm run db:migrate` / `:test` are no-ops |
| `npm run typecheck`, `npm run lint` | **Pass**; lint 0 errors, the same 5 pre-existing warnings |
| `npm test` — 412 passed | **Rerun: 412 passed, 0 failed**, 16 files |
| `npm run test:smoke` — 20 passed in four runs | **Rerun: 20 passed** (12 + 2 + 3 + 3) |
| `npm run build` with demo exclusion | **Rerun: pass** |
| Production storage and scanning unresolved | Still true; nothing in M6 depends on them, and they stay recorded as unresolved below |

No blocker for Milestone 6. One handover item became M6 work: idempotency
records had no scheduled cleanup; the new housekeeping job now prunes them.

### 2. What was built

| Requirement | Where | What it does |
| --- | --- | --- |
| §10.1, FR-081 | `server/services/metrics.ts` | Each metric defined **once** as an SQL fragment: active pipeline (status Active, stage neither Awarded nor Lost), overdue (open, due before today's Dhaka date), the seven-day tender window (current, Reviewing/Preparing, record open, deadline ≥ now and < now + 7 days), awarded this quarter (Awarded, award date in the Dhaka calendar quarter, actual value). Dashboard, reports, list drill-downs and exports compose them inside `scopedWhere` |
| FR-080, FR-081, D-002, D-006 | `server/services/dashboard.ts`; `GET /api/dashboard` | One scoped aggregate: KPI cards, stage chart (working stages: active records and estimates; Awarded: actual awarded value; Lost: estimate), On Hold and Cancelled shown separately, team workload by current owner (leads, management), pipeline by section (management), next actions, open tender deadlines, recent activity. Real clock; Dhaka dates; date-range filter on Awarded/Lost and activity |
| FR-082 | dashboard + reports | Section filter for management only, owner filter for leads and management; anything else is **403**; permitted filters only narrow scope |
| FR-082, BR-060, D-005 | `server/services/reports.ts`; `GET /api/reports/:report` | The six approved reports: pipeline by stage and by section/owner (opportunity created date), overdue follow-ups (due date), upcoming tender submissions (submission deadline), awarded and lost (award / lost date), lost reasons (lost date). Scope first; server-side filters, allowlisted sorting, pagination (≤ 100); summaries over all matching rows; each names its date basis; undated records counted and stated |
| BR-060 | `server/services/opportunities.ts` | The Opportunities screen keeps a separately labelled **expected award date** filter; when a range is set the response says how many otherwise-matching records have no expected award date, and "Show undated" lists them |
| FR-083, SEC-005, NFR-011 | `server/services/exports.ts`, `csv.ts`; `/api/exports` | **Queued, audited CSV exports** of every matching row (reports and the opportunity list), validated with the source screen's own schema and filter rules, idempotent. The job re-reads the requester and runs under their **current** scope. Download re-checks the filters and that **every** exported record is still visible (else 409); requester only (else 404). UTF-8 BOM, unformatted decimals, ISO instants with +06:00, **formula injection neutralized**, row limit refused rather than truncated. Audit: `report.export_requested`, `report.exported` (with record count), `report.export_downloaded` |
| FR-091, SEC-002 | `server/services/search.ts`; `GET /api/search` | Scoped search over accessible opportunities, permitted tender references, permitted contacts and organization basics; 2–100 characters; literal matching; five per type with true accessible totals, or one paged type; safe summaries (no email, phone or notes). Administrators: accounts and sections only |
| FR-090, BR-070 | `server/services/notifications.ts`; `/api/notifications` | Persistent alerts: follow-up due today, overdue follow-up, tender deadline within 72 hours, ownership change. Recipients: responsible person, section lead, management — each only while in scope (`alertRecipientSql`). Deduplicated by a unique trigger key (recipient, record, type, date/deadline). Read state persists; **reading never touches the task**. Obsolete or no-longer-permitted alerts are excluded by a read-time check and retired (`resolved_at`) by the services that change them; unread counts follow at once |
| NFR-003, FR-090 | `server/jobs/`; migration `0006` | Durable, retryable job queue: `FOR UPDATE SKIP LOCKED` claims, exponential backoff, max attempts, lease recovery, log-safe errors, final-failure handling. Hourly notification scan per Dhaka hour, daily housekeeping (expired exports, expired idempotency records, old jobs); in-process worker or `npm run jobs:run` |
| SEC-031 | `server/auth/sessionGuard.ts` | The notification-count poll is marked as a background request and **does not extend the idle window** (found during M6: a polling tab would otherwise never idle out) |
| §20 | API-mode UI | Dashboard is live and is the sales landing page; Reports live; the top bar has scoped search and the notification bell; Opportunities has Export CSV |

**Interface.** The approved Dashboard (`DashboardPage`, widgets in
`src/app/components/dashboard/` — same markup as `src/components/dashboard`,
fed by the server), Reports (`ReportsPage`), the top-bar search
(`GlobalSearch`) and bell (`NotificationsMenu`) are live. Every card, stage
column, workload figure and section bar drills into the matching list, which
shows the applied population as removable chips. Nothing in `src/demo`,
`src/components` or `src/pages` was changed.

**Interface deviations, for product sign-off.**

| Change | Reason |
| --- | --- |
| The pipeline card says "excludes On Hold / Cancelled / Awarded / Lost" (prototype: "Awarded / Lost / Cancelled") | D-002: On Hold is out of the active pipeline |
| Overdue card counts records not On Hold and shows "+N on On Hold records" | §10.1 "show On Hold separately" |
| "Awarded value this quarter" shows the real current Dhaka quarter (prototype: fixed "Q4 2026") | FR-080 |
| Tender card note "From now, current open bids"; the 7-day window is an instant window, listed by the tracker under a "dashboard card" chip | §10.1 exclusive seven-day window |
| Team workload groups open tasks by **opportunity owner** (prototype: by assignee); the overdue count opens that owner's overdue tasks | §10.1 "grouped by current owner" |
| Next Actions lists only open follow-ups (the prototype also listed separate "next action" fields) | BR-013, D-003 |
| Stage chart subtitle states the value basis of each column; columns have accessible names with the basis | D-006 |
| Reports: Section and Owner filters by role, sortable column headers, server pagination, a sentence naming the date basis and undated records, exact value on hover | FR-082, BR-060 |
| Pipeline report lists the On Hold and Cancelled lanes and estimated values for every lane, Awarded included | D-001, D-006 |
| Export CSV shows "Preparing CSV…" while the server builds the file | FR-083, NFR-011 (queued) |
| Notification menu adds "Reading an alert does not complete its task." | BR-070 |
| Opportunities table adds the expected award date range and "Show undated" | BR-060 |
| Search results show "n of N" when a type has more matches | FR-091 bounded results |

### 3. Implementation decisions

In `docs/adr/0007-dashboards-reports-search-notifications.md`, with reasons.
**For review with Penta:**

- **Management receives every alert** in the organization, implementing
  FR-090's "management sees all permitted alerts" literally. Noisy; a narrower
  rule would be a requirements change.
- **Start of the Dhaka business day = 00:00 Asia/Dhaka.** Task alerts come
  from the first hourly scan of the day. A later start (e.g. 09:00) is a
  one-line change.
- Seven-day tender window, overdue and workload definitions as in §2 and the
  ADR; tenders on Cancelled/Awarded/Lost records never count (as in M5's
  tracker indicator); On Hold keeps its deadlines.
- Forbidden report filters are refused (403), not ignored.
- Exports are kept for 24 hours and capped at 50 000 rows (configurable).
- Alert *generation* runs only in background jobs; business transactions
  only *retire* alerts (avoids a lock cycle between a scan and a transfer).

### 4. Database

| Migration | Contents |
| --- | --- |
| `0006_reports_exports_notifications_jobs.sql` | `notifications` (unique trigger key; CHECK tying each type to its record and date; resolution recorded with resolved time), `report_exports` (CHECK: a ready export has content, row count, covered opportunity ids and expiry), `background_jobs` (unique dedupe key, bounded attempts); enums `notification_type`, `report_export_kind`, `report_export_status`, `background_job_status`; indexes on award date, closed date and activity time. Runtime role: SELECT/INSERT/UPDATE on notifications (**no DELETE**, tested); SELECT/INSERT/UPDATE/DELETE on exports and jobs (housekeeping) |

Additive; rollback in the header. The seed clears the three tables and seeds
no notifications or jobs (they are generated). Applied to the development and
test databases; a repeat run is a no-op.

### 5. Commands run and results

| Command | Result |
| --- | --- |
| `npm run db:migrate` / `:test` | `0006` applied to both; repeat run no-op |
| `npm run typecheck` | **Pass** (web, server, e2e) |
| `npm run lint` | **Pass** — 0 errors, the same 5 pre-existing warnings |
| `npm run check:env` | **Pass** — 24 variables (4 new) |
| `npm test` | **479 passed, 0 failed**, 20 files (412 after M5 + 67 new) |
| `npm run test:smoke` | **24 passed** in five isolated runs: 12 (smoke + M2), 2 (M3), 3 (M4), 3 (M5), 4 (M6). The first attempt failed in the M1 smoke spec: a second sign-in in one test still expected the old Opportunities landing page; corrected and rerun |
| `npm run build` | **Pass**, demo-exclusion before and after bundling; main chunk 444 kB; Dashboard and Reports load on demand |
| `npm run evidence` | **Pass**, five runs; 12 new screenshots `37`–`47` (dashboard at 1440/768/360, active-pipeline drill-down, pipeline and outcome reports, export done, lead dashboard, scoped search, notifications, overdue drill-down, administrator search). The earlier screenshots were recaptured and now show the top-bar search and bell. The M2 capture needed one change for the new landing page |
| `npm run jobs:run`, `-- --status` | Ran against the development database: second run finds nothing due (deduplicated schedule); status lists succeeded scans and housekeeping |

`npm run test:smoke` is now **five** isolated Playwright runs (smoke + M2,
M3, M4, M5, M6). The earlier specs' sign-in helpers now expect the Dashboard
landing page and then open Opportunities; nothing else in them changed.

| New test file | Tests | Covers |
| --- | --- | --- |
| `dashboard.test.ts` | 20 | Dhaka quarter/day helpers; per-role totals, section totals add up; D-002 (GA: 9 active / 275 750 000.50 = the demo's corrected 8 / BDT 25.85 crore plus the M1 fixture; On Hold 14 500 000.00 shown separately); administrator 403 with no figures; 401; FR-082 filter rules; **policy agreement: `userSeesOpportunitySql` equals `opportunityScope` for every account**; **AT-12 for management, both leads and a salesperson: card = `pipeline=active` list (all pages, summed) = stage columns = workload rows; overdue card = overdue list; tender card = `window=7d` list; awarded card = awarded list for the quarter, actual values**; D-006 values; date-range scope; **Dhaka midnight (23:59:59 → 00:00:00 overdue 1 → 2), exclusive seven-day window (now + 7 days excluded, +1 s included, deadline instant included, +1 s after excluded), quarter switch at Dhaka not UTC midnight (Q3 56 500 000.00 → Q4 23 500 000.00)**; On Hold overdue separate; On Hold leaves the pipeline; transfer reflected next request; undated expected-award records counted and listable |
| `reports.test.ts` | 19 | Named date bases; scope before counts and sums for four roles (sections partition the organization; no cross-section names); pipeline summary = dashboard; D-006 in the outcome report; filtering on each basis; server paging/sorting and 422s; FR-082 403s; administrator 403; **CSV: every row not one page, AT-12 population and value equal to the dashboard, headers, ISO +06:00, decimals, Bangla; report CSV = screen columns; no inaccessible data; formula injection neutralized (unit cases and a real `=cmd…` opportunity name); audit trail with record count; delivery refused after a transfer (SEC-005); export failed when the requester lost access; requester-only (404 identical to missing); filter validation and CSRF with nothing written; idempotent retry (one export, one audit); row limit refused; expiry** |
| `notifications.test.ts` | 19 | Recipients per role within scope; **one alert per trigger across repeated and concurrent scans**; runtime role cannot delete alerts; due-today → overdue at Dhaka midnight (stale alert hidden before the scan); no alert for cancelled/submitted notices with a positive control; **read persists, first read time kept, task untouched**; mark-all per reader; 404 for others' and missing alerts, identical; administrator 403/404, no recipient endpoint; **reschedule and completion retire alerts and counts, refresh adds the new date; transfer removes the old team's alerts at once and writes the retirement, alerts the new owner and lead, not the actor; read-time check hides alerts after an out-of-band access change; tender deadline change**; **jobs: retry with backoff then success, max attempts → failed with a log-safe error and final handler, lease recovery, two workers never run a job twice, housekeeping prunes idempotency records**; **the background poll does not extend the idle window (control included)** |
| `search.test.ts` | 9 | Accessible totals per role; bounded preview; another salesperson's and section's names and tender references never returned; contact search limited by links, safe summary; transfer removes results; directory; Bangla; literal `%`/`_`; type paging; validation and 401; administrator accounts/sections only, commercial type 403 |
| `operations.test.ts` (updated) | — | Expects the three M6 tables |
| `e2e/m6.spec.ts` | 4 | Management: dashboard, Active card → identical list count, section filter, reports with named bases, CSV download content. Lead: section-only dashboard and workload, scoped search (own found, other section not, 2-character minimum), overdue card → list. Salesperson: no owner filter, bell count from the job worker, opening an alert lowers the count and the task stays open, no other salesperson's record in search, no selectors on reports. Administrator: no Dashboard/Reports/bell, direct URLs refused, search finds accounts only |

**Mutation checks** — each protection was removed and its tests re-run; all
were detected: seven-day window end made inclusive (1 failed); overdue made
`<= today` (1 — after strengthening the midnight test to absolute counts);
On Hold counted as active (5); report scope dropped (5); export delivery
re-check skipped (1); formula neutralization disabled (1); alert validity
ignoring recipient access (1 — after adding the retirement assertion); a
non-deterministic trigger key (1); no job retry (2); search contact scope
dropped (2); background poll extending the idle window (1). All restored.

### 6. Defects found and fixed

1. **A polling tab would never idle out (SEC-031).** Every authenticated
   request slid the 30-minute idle window, so the new 60-second unread-count
   poll would have kept an unattended session alive indefinitely. The poll is
   now marked as a background request and does not slide the window; tested
   with a control.
2. **Three tests did not discriminate** (found by the mutation checks): the
   Dhaka-midnight test compared before/after only, the transfer test did not
   assert the retirement was written, and the first dedupe mutation was too
   weak. Strengthened as described above.
3. **An export with an unknown sort column was accepted and failed later in
   the job.** It is now refused at request time (422).
4. A flaky assertion in my own administrator test matched digits in the
   random request id; it now inspects the body without it.
5. Presentation, from the screenshots: report header crowded with the role
   filters; "has a award date (awarded)…" wording; notification dates said
   "Sept" instead of the app's "Sep"; a long stage-chart subtitle at 360 px.
6. Tooling: the tool input decoded `\u` escapes into literal invisible
   characters (a BOM and full-width forms) in `csv.ts`; restored as escapes
   and the source tree was checked for invisible characters.

### 7. Acceptance coverage

| Test | Status |
| --- | --- |
| AT-11 | **Covered**: Dhaka-midnight overdue (follow-ups and alerts), 72-hour tender boundary (M5), exclusive seven-day window, quarter boundary — all with the injected clock |
| AT-12 | **Covered** for every role: dashboard active count and value = filtered list = export population; quarterly awarded totals use actual values and Dhaka quarter dates; CSV includes all pages, excludes inaccessible data, neutralizes formulas |
| AT-14 | **Covered**: repeated jobs create one alert per trigger; read status persists; rescheduling and transfers remove obsolete alerts and counts; search never reveals unauthorized names or contacts |
| AT-01 | **Covered**: the administrator has no commercial dashboard, report, export, search result or notification, by API and in the browser |
| AT-02 | **Covered** across all listed channels: URL, API id, search, contacts, totals, CSV, notification, document download |
| AT-16 | Job-retry portion covered (a failed reminder job is retried and recorded). Monitoring and restore remain M8 |
| AT-15 | Partial: concurrent scans and concurrent job workers added |

### 8. Remaining issues and limitations

**Unresolved production decisions — not claimed ready:**

- **Document storage and malware scanning** (unchanged from M5): only a
  private local directory and a development TEST scanner exist; production
  uploads with `DOCUMENT_SCANNER=none` would never become downloadable.
- **Job execution in production**: in-process by default; a separate worker
  or scheduler running `npm run jobs:run` is supported. Monitoring and
  alerting on failed jobs (NFR-003) is M8.

**Other limitations:**

- For review: management receives every alert; the business day starts at
  00:00 Dhaka (§3).
- Notifications are in-app only; email/SMS are excluded from release one.
- Export audit events (`reporting` domain) are recorded but not shown in any
  screen yet (M7 audit views).
- The Reports owner filter lists active owners (from the owner lookup);
  inactive historical owners appear in workload rows and the
  section/owner report but cannot be chosen as a filter there.
- On the Pipeline (board) view the `pipeline=active` chip does not change the
  lanes; the drill-down opens the Table view, where it applies.
- Dashboard and report query times are not yet measured against the NFR-010
  envelope (M8).
- From earlier milestones, unchanged: PATCH routes have no idempotency key;
  account-link token cleanup is unscheduled; the Activities & Follow-ups
  calendar view is unavailable; five pre-existing fast-refresh lint
  warnings; identity provider and MFA undecided.
- Local note: the developer's own `npm run dev:server` and `npm run dev` were
  running during this session; tsx watch reloaded the new code and its
  in-process worker ran notification scans on the development database.
  They were not stopped.

### 9. Configuration and local startup

New environment variables (in `.env.example`; `npm run check:env` passes):

| Variable | Default | Meaning |
| --- | --- | --- |
| `JOBS_ENABLED` | `true` | Run the job worker in the API process; `false` to run `npm run jobs:run` from a scheduler instead |
| `JOBS_POLL_SECONDS` | `15` | Worker poll interval (requests that queue work wake it immediately) |
| `REPORT_EXPORT_TTL_HOURS` | `24` | How long a prepared CSV can be downloaded |
| `REPORT_EXPORT_MAX_ROWS` | `50000` | Exports reaching this are refused, never truncated |

An existing `.env` needs nothing new: the defaults apply.

```bash
npm run db:up
npm run db:migrate && npm run db:migrate:test   # 0000–0006
npm run db:seed  && npm run db:seed:test
npm run dev:server        # API http://localhost:4800, with the job worker
npm run dev               # web http://localhost:5173
npm run jobs:run          # optional: run due jobs once; -- --status for counts and failures
```

Job schedule: one notification scan per Bangladesh clock hour (the first
after 00:00 is the start-of-day task scan), one housekeeping run per day.
Failed attempts retry after 1, 2, 4, 8 … minutes (at most 60), up to 5
attempts (3 for exports), then stay `failed`.

To see M6: as `arif.rahman@example.com`, the Dashboard (change Section and
Date range; click Active Opportunities), Reports → Export CSV. As
`nadia.islam@example.com`, the section dashboard, the bell and search
("Portal"). As `rafiq.hasan@example.com`, open an alert from the bell — the
task stays open. As `admin@example.com`, search finds accounts and sections
only.

### 10. Next task

Feature development stops at the end of Milestone 6. Next session, in order:

1. **Verify Milestone 6** against this section: branch and commit, clean
   tree, migration `0006` applied; re-run `npm run typecheck`, `npm run
   lint`, `npm test` (expect 479 passed), `npm run test:smoke` (expect
   24 passed in five runs) and `npm run build`. Review the interface deviations (§2) and
   the decisions for Penta (§3).
2. **Begin Milestone 7 — audit and mutation-control sweep** (`Plan.md` §6)
   **only when instructed**.

Separately, before documents are enabled anywhere beyond development, Penta
must choose the production file storage and scanning service.

---

## Milestone 5 — tender cycles and private documents

**Branch:** `m5-tenders-documents`, created from `m4-organizations-contacts-activities` at `8f77d27`
**Commit:** the Milestone 5 commit that contains this section
**Date:** 05 October 2026
**Status:** Complete for development and ready for review. Not merged, not
pushed. **Production document storage and malware scanning are unresolved**
(§8). Milestone 6 not started.

### 1. Milestone 4 check before starting

M4 (`8f77d27`) was checked against the repository and its recorded results:
committed with a clean tree (the only change was this milestone's own start),
migrations `0000`–`0004` applied to both databases, the M4 routes, tests and
screens present as described. Every M4 test runs again in this milestone's
gate (§5) and passes. M4 is committed locally but not pushed, so it has no CI
run; PR #2 (M3) is still open. No blockers.

**Storage and scanner configuration inspected:** none existed — no storage
location, upload limit, scanner or related environment variable anywhere in
the code, `.env.example`, Docker Compose or CI. The demo kept files in browser
storage (≤ 1 MB). As instructed, a private local development storage and a
scanner adapter were implemented, and the production decisions are recorded
as unresolved.

### 2. What was built

| Requirement | Where | What it does |
| --- | --- | --- |
| FR-050, BR-080 | `server/services/tenders.ts`; migration `0005` | Multiple tender cycles per opportunity. **At most one current notice, enforced by a partial unique index**; a new notice supersedes the previous current one in the same transaction; earlier notices are kept with their bid history and are read-only; a superseded notice can be made current again; a notice can be cancelled with a reason, leaving no current tender |
| §7.1 | same | Required title (3–200), reference (≤ 200), procuring entity (an organization from the directory, labelled when it differs from the opportunity's), publication date and submission deadline; optional procurement method (free text), http/https notice URL, clarification deadline, notes. **Responsible owner is derived** from the opportunity owner, never stored |
| BR-040 | service + CHECK constraints | Deadline (as a Dhaka date) not before publication; clarification not after submission; Not Participating needs a reason; Submitted ⇔ submission time; a time after the deadline needs an explanatory note (a warning, recorded as fact) |
| FR-051 | `POST /api/tenders/:id/submit` | Mark Submitted records the time and requires an **explicit yes/no** on moving the opportunity to Bid Submitted (no default). Yes: both changes in one transaction with two audit events. No: stage kept, mismatch indicator shown. Offered only for an Active opportunity at an earlier stage; **never Awarded**. Retries deduplicated by Idempotency-Key; a second submission is 409 |
| FR-052, AT-11 | `listTenders`, `/api/tenders`; Tender Tracker | Deadline-sorted table (either direction) and month calendar; filters by owner, section (management), bid status, deadline date range (Dhaka dates) and notice state; server-computed indicator against the real clock: red past deadline, amber within 72 hours, neutral later, green Submitted, grey Not Participating / superseded / cancelled / closed opportunity; legend text on every screen; rows open the opportunity's Tender tab |
| FR-060, SEC-010 | `server/services/documents.ts`, `server/documents/*`; `/api/opportunities/:id/document-uploads`, `/api/document-uploads/:id/finalize` | Private server storage under **generated keys**; raw-body upload streamed with the **25 MB default limit enforced while writing** (configurable); extension allow-list; **content must match the extension** (magic numbers, OOXML structure); executables refused under any name; **macro-enabled** extensions and renamed macro documents (VBA part or macroEnabled content type) refused; UTF-8 text only; filename sanitization (path parts, control, reserved, zero-width and bidi-override characters) |
| SEC-010 | scanner adapter | Scan before availability. `pending`, `failed` and `infected` cannot be downloaded (409 `document_unavailable`). Scanner `none` keeps files pending; scanner `test` is a labelled development scanner refused in production; a throwing scanner gives `failed`, never clean; infected files move to quarantine |
| SEC-011 | `GET /api/document-revisions/:id/download` | Scope through the parent opportunity re-checked on **every** upload, finalize, metadata read and download; streamed with attachment disposition (UTF-8 filename), stored MIME type, `nosniff`, `no-store`, sandbox CSP; images may preview inline; no public or permanent URL |
| FR-061 | same | Revisions never overwrite; earlier revisions stay downloadable; metadata (category, size, SHA-256, uploader, time, scan verdict and scanner); category change with version check; **management-only archive with a reason**, still readable in scope; no DELETE on documents or revisions for the runtime role |
| BR-091, idempotency | finalize | Idempotent by key **and** by the staged upload (one revision per upload, row lock + unique index): retries with the same or a new key, and two simultaneous finalizes, give one document |
| Abandoned uploads | `cleanupAbandonedUploads`; `npm run documents:maintain` | Staged uploads expire after 60 minutes (configurable) and are removed with their files; stored files with no upload record are removed; runs every 15 minutes in the API server; the same job retries pending scans when a scanner is available |
| FR-062 | audit | `tender.created`, `.updated`, `.submitted`, `.superseded`, `.designated_current`, `.cancelled`; `document.uploaded`, `.revised`, `.scanned` (system actor), `.updated`, `.archived` — all in the opportunity's Change History with readable labels; no file content in audit |

**Interface.** The Tender Tracker (table and calendar) and the opportunity
page's **Tender** and **Documents** tabs are live, built from the approved
layouts and primitives. Nothing in `src/demo`, `src/components` or `src/pages`
was changed. The demo's `MonthCalendar` is tied to the demo date, so API mode
has its own copy with the same layout (`DeadlineCalendar`).

**Interface deviations, for product sign-off.**

| Change | Reason |
| --- | --- |
| Mark Submitted asks "Move the opportunity to Bid Submitted?" (required yes/no) and records date **and time**; the prototype moved the stage automatically | FR-051 |
| Responsible owner is read-only, always the opportunity owner | §7.1, BR-050 |
| Procuring entity is chosen from the organization directory, not typed | §7.1 |
| Procurement method is free text with suggestions instead of a fixed list | §7.1: no procurement-law assumptions |
| Clarification deadline is a date and time | §7.1 |
| No separate tender detail page: tracker rows open the opportunity's Tender tab, which shows the current notice, earlier notices and every action | FR-052 links to opportunity details; one place for the cycle history |
| Tender tab adds "Add re-tender / new notice", "Cancel notice", "Make current" and an earlier-notices table | FR-050 |
| Documents table adds a Scan column, a Download link per revision, a revision dialog and "Show archived" | SEC-010, FR-061 |
| Upload hint says files are stored on the server and names the scanner; the prototype's "stored in this browser (1 MB)" is gone | SEC-010/011 |
| The demo's placeholder documents are not seeded | They were browser-stored text stand-ins; production files come only through the validated upload path |
| Deadline filter offers today-based date ranges ("Within 3/7/30 days", "Before today") over the submission deadline; the prototype's "Missed" filter is the red indicator plus "Before today" | BR-060: one named date basis |
| Table times omit the "Bangladesh time (UTC+6)" suffix; the column heading carries it | Readability; the zone is still stated |

### 3. Implementation decisions

In `docs/adr/0006-tenders-and-documents.md`. For review:

- Submitted bids are not reversed by editing; a mistaken submission needs a
  later correction workflow (not built).
- Superseded and cancelled notices are read-only; a cancelled notice cannot
  become current again (record a re-issued notice as a new tender).
- Tenders take no changes on Awarded, Lost or Cancelled opportunities; On
  Hold keeps its deadline alerts (BR-014).
- A `failed` scan is final for that revision: upload it again as a new
  revision. Only `pending` revisions are retried.
- PDFs are downloaded, not previewed inline: browser PDF viewers do not run
  under the sandbox CSP applied to every served file.
- The browser-declared content type is ignored; the stored type comes from
  the server's table.
- Uploading a document or revision is open to every role that can edit the
  opportunity; only management archives.

### 4. Database and fixtures

| Migration | Contents |
| --- | --- |
| `0005_tenders_and_documents.sql` | `tenders` (one-current partial unique index; CHECKs for title/reference length, http(s) URL, current ⇔ current notice, Submitted ⇔ time, Not Participating reason, Dhaka-date chronology, clarification ≤ submission, late note); `documents`, `document_revisions` (unique revision number per document, unique upload, verdict recorded), `document_uploads` (expiry); enums `bid_status`, `notice_state`, `document_category`, `scan_state`. Runtime role: SELECT/INSERT/UPDATE on tenders, documents and revisions (no DELETE/TRUNCATE, tested); SELECT/INSERT/UPDATE/DELETE on staged uploads |

Additive; rollback in the header. The seed loads the demo's **8 tenders**
(`server/db/seedTenders.ts`, documented conversion: organization records for
procuring entities, submission dates become 16:00 Dhaka time, owner derived).
No documents are seeded.

### 5. Commands run and results

| Command | Result |
| --- | --- |
| `npm run db:migrate` / `:test` | `0005` applied to both databases; a repeat run is a no-op (tested) |
| `npm run db:seed` / `:test` | 2 sections, 10 users, 11 organizations, 23 opportunities, 17 open follow-ups, 22 contacts, 35 links, 34 activities, **8 tenders** |
| `npm run typecheck` | **Pass** (web, server, e2e) |
| `npm run lint` | **Pass** — 0 errors, the same 5 pre-existing warnings |
| `npm run check:env` | **Pass** — 20 variables (4 new) |
| `npm test` | **412 passed, 0 failed**, 16 files (321 after M4 + 46 tenders + 45 documents; two operational tests updated, §6) |
| `npm run test:smoke` | **20 passed** in four isolated runs: 12 (smoke + M2), 2 (M3), 3 (M4), 3 (M5) |
| `npm run build` | **Pass**, demo-exclusion before and after bundling. Main chunk 417 kB; the Tender Tracker and tender dialogs load on demand |
| `npm run evidence` (M5 run) | 7 new screenshots, `30`–`36`: tracker, calendar, Mark Submitted with the explicit stage choice, Tender tab with the mismatch notice, re-tender form, Documents tab with clean and rejected scans, revision dialog. Now four Playwright runs |

`npm run test:smoke` is now **four** isolated Playwright runs, each on freshly
seeded fixtures, keeping every run under the login rate limit without
loosening it. The browser runs use their own file directory
(`./var/e2e-documents`) and the test scanner.

| New test file | Tests | Covers |
| --- | --- | --- |
| `tenders.test.ts` | 46 | Tracker scoped per role (2 / 4 / 8 tenders) and administrator refused; tracker sort and Dhaka-date deadline filter; **forged tender ids identical to missing ones for read, edit, submit, cancel, designate, create and list**; **transfer moves tender visibility and responsibility**; indicator boundaries under a frozen clock (72h ± 1s, the deadline instant, past deadline); no alert for Not Participating / superseded / cancelled; **re-tender keeps one current notice, retry creates once**; **two simultaneous re-tenders leave one current**; **database refuses a second current notice**; designate current; history read-only; no DELETE; closed opportunity refused; stale version; nine field/chronology refusals and the Dhaka-date boundary; differing procuring entity labelled; archived entity refused; **seven CHECK constraints proved from the application role**; **explicit stage answer required; decline keeps stage with mismatch; accept moves atomically, never Awarded, once on retry; simultaneous retries apply once**; refusal leaves nothing changed when the stage is already past or On Hold; late submission needs a note; future and pre-publication times refused; only the current, participating notice can be submitted; no reversal by edit; Change History labels |
| `documents.test.ts` | 45 | Seven accepted types round-trip byte-for-byte with safe headers; metadata, uploader and audit without file content; generated storage key and hostile filename; Bangla filename on download; image-only inline preview; **fourteen refusals** (executable by extension, renamed to .pdf, disguised by a right-to-left override, double extension, macro extension, renamed macro document, declared macros, disallowed type, no extension, content mismatches, non-UTF-8, empty) with nothing kept; **size limit enforced while streaming, exact limit accepted**; 25 MB default; CSRF required; **EICAR rejected and quarantined; scanner failure ⇒ failed; no scanner ⇒ pending and unavailable, scanned once a scanner exists; throwing scanner ⇒ failed; test scanner refused in production**; **finalize retries (same key, new key, simultaneous) give one document**; expired upload refused and cleaned up with its file; orphaned files removed, finalized kept; DELETE refused on documents and revisions; revision keeps the earlier file; management-only archive with reason, archived still downloadable, no revision of an archived document; category change with version check; **forged upload, finalize, metadata, revision-of-another-opportunity and download ids identical to missing ones**; administrator refused; **old download link revoked by a transfer, staged upload unusable after it, new owner served**; lead and management within scope, other section refused |
| `e2e/m5.spec.ts` | 3 | Salesperson: tracker shows only own tenders with the legend; Mark Submitted refuses without a stage answer, "keep" leaves the stage and shows the mismatch; uploads a Bangla-named file, sees "Scanned (test scanner)", downloads it; EICAR file shows "Rejected by scan" and no download; `.exe` refused with the message; uploads a revision; cannot archive. Lead: re-tender supersedes the earlier notice; late submission needs an explanation and moves the stage only on "Yes". Management: archives with a reason; visible under Show archived; Change History shows the events |

**Mutation checks** — each protection was removed and its tests re-run:
allowing a `pending` file to download (1 test failed); dropping the scope
predicate from the download query (4 failed); skipping the supersede step on
a re-tender (8 failed, including the database refusal). All restored.

### 6. Defects found and fixed

1. **A test-file string was silently altered by a shell heredoc** (`\\`
   became `\`), so the evidence spec's EICAR file did not contain the EICAR
   string and was scanned clean. The scanner was correct; the spec now
   defines the string once, like the browser spec. Found by reviewing the
   screenshot, not by a failing test.
2. **Two operational tests needed updating for M5**: the table-presence
   check now expects the four M5 tables (only `notifications` remains
   deferred), and the production-configuration test sets
   `DOCUMENT_SCANNER=none`, because a development `.env` enables the test
   scanner, which production correctly refuses.
3. Test-only: a frozen clock moved days ahead ended the test session on its
   idle limit, and a shared storage directory carried files between tests;
   the specs now sign in at each instant and clear storage with the fixtures.
4. Stale Vite dev servers from earlier in this session held ports 5173/5174;
   they were stopped before the browser runs.

### 7. Acceptance coverage

| Test | Status |
| --- | --- |
| AT-10 | **Covered**: re-tendering preserves old notices with one current; invalid chronology fails; Submitted requires a time and updates the stage only atomically and on request; never Awarded; Not Participating, superseded and cancelled notices give no deadline warning |
| AT-11 | Tender part **covered** with a frozen clock around the 72-hour boundary and the deadline instant. The seven-day dashboard window remains for M6 |
| AT-13 | **Covered** with the test scanner: allowed files upload, scan and download; oversized, prohibited and unsafe files rejected or quarantined; a transferred or inaccessible document cannot be obtained by an old link; revision history keeps the earlier file. Real-scanner behaviour is not covered (none chosen) |
| AT-07 | Tender and document portions added: documents and tenders follow scope after a transfer |
| AT-02 | Documents and tenders channels added: no cross-section file, metadata or tender access |
| AT-15 | Partial: simultaneous re-tenders, simultaneous submission retries and simultaneous finalizes added |

### 8. Remaining issues and limitations

**Unresolved production decisions — not claimed ready:**

- **Document storage**: only a private local directory exists. Object
  storage vs server disk, encryption at rest, backup/restore of files with
  the database, retention, capacity and multi-instance access are undecided.
  Local disk does not work behind more than one API instance.
- **Malware scanning**: no production scanner. The `test` scanner is refused
  in production; with `none`, production uploads would be stored but never
  downloadable. Scanner product, signature updates, timeouts, retry policy
  and the handling of `failed` files are undecided.
- PDF active content and embedded OLE objects are not inspected (left to the
  real scanner).

**Other limitations:**

- No correction workflow for a mistakenly recorded submission.
- No tender search in global search (FR-091, M6) and no deadline
  notifications (FR-090, M6).
- The tracker calendar shows the loaded page (up to 50 tenders); the page
  says so when more match.
- Document categories can be changed but revisions cannot be renamed.
- No per-opportunity storage quota.
- From earlier milestones, unchanged: PATCH routes have no idempotency key;
  idempotency and link-token cleanup are unscheduled; five pre-existing
  fast-refresh lint warnings; identity provider and MFA undecided.

### 9. Configuration and local startup

New environment variables (all in `.env.example`; `npm run check:env`
passes):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOCUMENT_STORAGE_DIR` | `./var/documents` | Private file directory, git-ignored (`var/`) |
| `DOCUMENT_SCANNER` | `none` if unset; `test` in `.env.example` | `none` keeps files unavailable; `test` is the development scanner, refused in production |
| `DOCUMENT_MAX_UPLOAD_MB` | `25` | Per-file limit |
| `DOCUMENT_UPLOAD_TTL_MINUTES` | `60` | Unfinalized uploads are removed after this |

An existing `.env` needs `DOCUMENT_SCANNER=test` added to see downloads work
locally; without it, uploads stay "Awaiting scan". The integration suite and
the browser runs set their own storage directory and the test scanner.

```bash
npm run db:up
npm run db:migrate && npm run db:migrate:test   # 0000–0005
npm run db:seed  && npm run db:seed:test        # now with 8 tenders
npm run dev:server                              # API  http://localhost:4800
npm run dev                                     # web  http://localhost:5173
npm run documents:maintain                      # optional: cleanup + pending scans
```

To see M5: as `rafiq.hasan@example.com`, open **Tender Tracker** (two
tenders), Mark Submitted on DCR/PROC/2026/221 and choose either answer; open
Municipal Service Portal → **Documents** and upload a PDF or text file. As
`nadia.islam@example.com`, the tracker shows the section's four tenders. As
`arif.rahman@example.com`, open a document and Archive it.

### 10. Next task

Feature development is paused at the end of Milestone 5 (handover,
05 October 2026). Next session, in order:

1. **Verify Milestone 5** against this section: confirm the branch and
   commit, a clean tree, migration `0005` applied, then re-run
   `npm run typecheck`, `npm run lint`, `npm test` (expect 412 passed),
   `npm run test:smoke` (expect 20 passed in four runs) and `npm run build`.
   Review the interface deviations (§2) and decisions (§3).
2. **Begin Milestone 6 — dashboards, reports, search and notifications**
   (`Plan.md` §6) **only when instructed.**

Separately, before documents are enabled anywhere beyond development, Penta
must choose the production file storage and scanning service (§8).

---

## Milestone 4 — organizations, contacts, relationship notes and activities

**Branch:** `m4-organizations-contacts-activities`, created from `m3-transfers-administration` at `ca21a7e`
**Commit:** the Milestone 4 commit that contains this section
**Date:** 05 October 2026
**Status:** Complete and ready for review. Not merged. Milestone 5 not started.

### 1. Milestone 3 check before starting

M3 was verified against the repository and GitHub: PR #2 open with no review
comments, CI run 37318264686 green on every step, clean working tree, all four
migrations applied. No blockers.

### 2. What was built

| Requirement | Where | What it does |
| --- | --- | --- |
| FR-030, FR-033 | `server/services/directory.ts`; `/api/organizations` | Shared directory: search (Unicode, including Bangla), type filter, pagination; create and edit basic details with version checks; parent organization with **self-parent and cycle prevention** (serialised by an advisory lock); management-only **archive**, refused while an open opportunity uses the organization |
| FR-033 | same | **Duplicate-name warning**: names compared ignoring case, spacing and punctuation; 409 `possible_duplicate` naming the similar organizations; the user may confirm and save anyway |
| FR-031 | same | "Your opportunities" counts through the caller's own scope; no private contact details or project commentary in the directory; the administrator gets 403 |
| FR-032, BR-020 | `server/services/contacts.ts`; `/api/contacts`, `/api/opportunities/:id/contacts`, `/api/contact-links` | Contacts with full name, designation, organization, department, optional email and phone (a string); **created together with their first opportunity link**; link an existing visible contact; **relationship notes stored on the link**; unlink (kept, marked removed) but never the last link; management-only archive |
| SEC-004 | `contactScope` in `server/policy/scope.ts` | A contact is visible only through a live link to an accessible opportunity; a contact view returns only accessible links and their notes, never the others or their count; invisible contacts are the same 404 as missing ones |
| BR-021 | contacts service | Notes editable by anyone who sees that link; shared identity editable only by someone who sees **every** link (management always); otherwise 403 pointing to management |
| FR-040 | `server/services/activities.ts`; `/api/opportunities/:id/activities`, `/api/activities` | Meeting, Phone Call, Email (a manual log), Office Visit, Internal Discussion, Other; time entered in Bangladesh time; optional contact, which must be linked to the same opportunity; the approved form's optional next action becomes a follow-up **in the same transaction** |
| FR-041 | same | Chronological, newest first; salespeople amend only their own, leads and management any in scope; each edit versioned and audited before/after; **no deletion** — the runtime role has no DELETE on activities, contacts or links |
| AT-03, FR-041 | scope through the opportunity | Historical authorship grants no access: an author whose record was transferred away gets 404 on its activities and cannot amend them; the author stays named for the new owner |
| FR-062 | `server/services/audit.ts` | `contact.linked`, `.unlinked`, `.notes_updated`, `activity.logged`, `.updated` in the opportunity's commercial history; organization and contact identity changes in a new `directory` domain |
| BR-091, BR-090 | routes | Idempotency keys on organization, contact, link and activity creation; version checks on every edit; link writes lock the opportunity row first, like every other opportunity writer |

**Interface.** Organizations & Contacts, organization detail and contact
detail are the approved screens, connected to the server. The opportunity
page's Contacts tab is live (link, add, notes, unlink), and the approved
**Activities** tab returns, holding the activity log and the M2 follow-ups;
old `?tab=followups` links open it. Log Activity is on the opportunity header
and on the Activity Log tab, which is now live. Nothing in `src/demo`,
`src/components` or `src/pages` was changed.

**Interface deviations, for product sign-off.**

| Change | Reason |
| --- | --- |
| Contact detail shows relationship notes per linked opportunity, not one note per contact | BR-020 |
| The demo's "Edit associated contacts" multi-select is replaced by Link a contact / Add a new contact / Unlink per row | Links carry their own notes and audit; one contact never exposes another team's links |
| Contact identity Edit is replaced by a notice when the contact is shared outside the viewer's access | BR-021 |
| Duplicate organization names warn and allow "Save anyway" instead of blocking | FR-033 says warning |
| The Activities tab stacks the activity log above the follow-ups table instead of side by side | The M2 follow-up table needs the width |
| The Activities & Follow-ups calendar view is still not available | Not built; stated on the page |

### 3. Implementation decisions

In `docs/adr/0005-directory-contacts-and-activities.md`. For review:
future-dated activities are refused (5-minute allowance); an archived contact
stays readable through its links but leaves lists and cannot be relinked, and
there is no unarchive yet; anyone who can edit an opportunity may unlink a
contact from it; an activity keeps showing its contact's name after that
contact is unlinked.

### 4. Database and fixtures

| Migration | Contents |
| --- | --- |
| `0004_contacts_links_and_activities.sql` | `contacts` (no notes field), `opportunity_contacts` (notes, soft removal, one live link per pair), `activities` (versioned, edited-by), `activity_type` enum; the runtime role gets SELECT/INSERT/UPDATE only (verified) |

Additive; rollback in the header. The seed now loads **22 contacts, 35 links
and 34 activities** converted from the demo (`server/db/seedDirectory.ts`,
generated once and committed so the seed never imports demo code). The seed
refuses an activity whose contact is not linked to its opportunity. Each demo
contact note is placed on that contact's first link only — a documented
synthetic mapping, because copying it to every link would show one team's note
to another.

### 5. Commands run and results

| Command | Result |
| --- | --- |
| `npm run db:migrate` / `:test` | `0004` applied; repeat run is a no-op |
| `npm run db:seed` / `:test` | 2 sections, 10 users, 11 organizations, 23 opportunities, 17 open follow-ups, 22 contacts, 35 links, 34 activities |
| `npm run typecheck` | **Pass** (web, server, e2e) |
| `npm run lint` | **Pass** — 0 errors, the same 5 pre-existing warnings |
| `npm run check:env` | **Pass** |
| `npm test` | **321 passed, 0 failed**, 14 files (279 after M3 + 18 contacts + 9 directory + 15 activities) |
| `npm run test:smoke` | **17 passed** in three isolated runs: 12 (smoke + M2), 2 (M3), 3 (M4) |
| `npm run build` | **Pass**, demo-exclusion before and after bundling. Main chunk 412 kB: the opportunity detail, Activities & Follow-ups and directory screens now load on demand, after the new screens had pushed it to 590 kB |
| `npm run evidence` | 37 screenshots (8 new for M4: `22`–`29`); now three Playwright runs |

**`npm run test:smoke` is now three isolated Playwright runs** (smoke + M2,
M3, M4), each on freshly seeded fixtures. That keeps every run under the login
rate limit without loosening it, and stops one milestone's spec from changing
another's fixtures.

| New test file | Tests | Covers |
| --- | --- | --- |
| `contacts.test.ts` | 18 | Contact list scoped to own records; a contact shared within a section shows each salesperson only their own link and note; shared across sections shows each lead only their section's links; management sees all; invisible = missing 404; administrator refused; Bangla create, round-trip and search; retry creates once; no contact on someone else's record; link visible / invisible / duplicate; field validation; BR-021 identity vs notes; editing an invisible link is 404; last link protected; **concurrent removal of the last two links**; management-only archive; **AT-08: transfers move contact visibility and notes with the record**; audit domains |
| `directory.test.ts` | 9 | Same directory for every role with **scoped counts** (1/1/1/2); no private details; administrator refused; **Bangla storage and search**; duplicate warning and confirmation; self-parent and cycle refused; **concurrent cross-parenting**; validation, versions and directory audit; management-only archive refused while used; archived organization takes no new opportunity |
| `activities.test.ts` | 15 | Chronological list with authors; Bangla activity with linked contact, created once on retry, found by Bangla search; unlinked contact, future time, missing subject, unknown type and offset-less time refused; next action created atomically, and refused with no activity saved on a closed record; inaccessible = missing; administrator refused; author amends, edit audited, stale version refused; salesperson amends only own, lead any, author kept; **runtime role cannot DELETE**; **historical author loses access after transfer**; Activity Log scoped and filtered |
| `e2e/m4.spec.ts` | 3 | Salesperson: scoped directory counts, organization page shows only own records, shared contact shows only own link with the "ask management" notice, edit own notes, add a Bangla contact from the opportunity, log a Bangla activity with a next action; lead sees every section link and can edit identity; another section sees a shared contact only through its own record |

**Mutation checks** — each protection was removed and its test re-run:
link scoping on the contact view (test failed: 2–3 links returned instead of
1); the contact-row lock on link removal (both removals succeeded, leaving no
link); the organization-hierarchy lock (a deadlock 500 instead of a clean
422). All restored.

### 6. Defects found and fixed

1. **An opportunity could be created against an organization in the instant
   it was being archived.** M1 creation read the organization without a lock.
   Creation now share-locks it inside its transaction, so the archive's check
   and a creation are serialised.
2. **The main bundle grew to 590 kB** with the new screens; the detail,
   follow-up and directory screens are now loaded on demand (412 kB).
3. Test-only: two browser dialogs briefly coexist while one animates out, and
   names repeated across panels made locators ambiguous; the specs now scope
   by dialog heading and panel.

### 7. Acceptance coverage

| Test | Status |
| --- | --- |
| AT-08 | **Covered** now that contacts exist: a cross-section transfer revokes the old team at once, and a contact linked to another project shows the new owner only their permitted link and notes |
| AT-02 | Contacts channel added: a lead cannot obtain another section's contact links or notes. CSV, documents and notifications remain |
| AT-03 | Historical authorship of activities grants no access after transfer |
| AT-15 | Partial: last-link and parent-cycle races added |

### 8. Remaining issues and limitations

- **Directory and contact identity audit events are recorded but not shown**
  anywhere yet (M7 audit views).
- **No unarchive** for organizations or contacts.
- **Contact identity edits are all-or-nothing per BR-021**; a salesperson who
  shares a contact cannot fix a typo and must ask management.
- **Activities & Follow-ups calendar view** is not built.
- **Organization pickers load at most 100 organizations**; beyond that they
  need search (the directory page itself is paginated).
- From earlier milestones, unchanged: PATCH routes have no idempotency key;
  idempotency and link-token cleanup are unscheduled; five pre-existing
  fast-refresh lint warnings; identity provider and MFA undecided.

### 9. Local startup

```bash
npm run db:up
npm run db:migrate && npm run db:migrate:test   # 0000–0004
npm run db:seed  && npm run db:seed:test        # now with contacts and activities
npm run dev:server                              # API  http://localhost:4800
npm run dev                                     # web  http://localhost:5173
```

To see M4: as `rafiq.hasan@example.com`, open **Organizations & Contacts**,
then Farzana Yasmin (shared with Tasnia: only your link and notes show); open
Municipal Service Portal → Contacts and Activities tabs. As
`nadia.islam@example.com`, the same contact shows both links and can be
edited. As `imran.hossain@example.com`, Golam Mostafa shows only City Wi-Fi.

### 10. Next task

**Milestone 5 — tender cycles and secure documents** (`Plan.md` §6), not to
be started until this milestone is reviewed. It needs Penta's decision on
private file storage and the scanning service before upload can be enabled.

---

## Milestone 3 — ownership transfers and team administration

**Branch:** `m3-transfers-administration`, created from `m2-stages-status-follow-ups` at `27ed8b8` (M2 plus its review)
**Commits:** `22507ed` (Milestone 3), `ca21a7e` (CI note)
**Date:** 05 October 2026
**Status:** Complete. Open for review as **PR #2** into `main`, which carries
the M1 handover review, M2, the M2 review and M3. GitHub CI run 37318264686
passed every step on a clean runner, which is also M2's first CI run. Not
merged.

### 1. Milestone 2 review, before starting

The five requested review flows were run in a real browser against the real
API (the Chrome extension was not connected, so Playwright drove Chromium)
and all passed; they are now permanent browser tests. Details in the
Milestone 2 section §7 below, committed as `27ed8b8`.

### 2. What was built

| Requirement | Where | What it does |
| --- | --- | --- |
| FR-070 | `server/services/transfers.ts`; `POST /api/opportunities/:id/transfer` | Leads transfer within their section, management across sections, salespeople never (403). Reason, version and idempotency key required. The basic-edit PATCH still refuses owner/section with 403 |
| BR-050 | same; `keepsFollowUpAfterTransfer` in `server/policy/scope.ts` | One transaction: owner and section change, and every open follow-up is reviewed — the previous owner's tasks move to the new owner, management's stay, an old lead's move only if that lead loses access. Completed tasks, history and the original creator are untouched. Each move is audited |
| SEC-005 | scope is derived per request | The previous owner and, on a cross-section move, the previous section's lead lose access on their next request; the new owner and lead gain it. Replay of a stored transfer after access is lost returns 404 |
| BR-090 | lock order | The transfer locks the opportunity row first, like every M2 writer, then the new owner, then the open tasks. A transfer racing a task completion never leaves an open task with the previous owner (tested over 4 concurrent rounds) |
| FR-071 | `server/services/admin.ts`; `/api/admin/*` | Administrator-only: account list/search, create, edit, deactivate/reactivate, sign-in links; sections create/rename/deactivate/reactivate; Replace lead; administrative audit. No commercial data in any response |
| BR-002, FR-002 | admin service | A salesperson's reporting line is derived from the section's active lead. One active lead per section |
| BR-051 | admin service | Deactivation refused while the person owns open work; role or section change refused while they own any opportunity. Closed records stay with an inactive owner as history |
| BR-052 | admin service | The only lead of an active section cannot be removed; Replace lead promotes a salesperson, demotes the old lead in the same section and re-points every salesperson atomically. A section with open opportunities or active members cannot be deactivated. The last active administrator is protected. No one changes their own role |
| SEC-030 | `server/services/accountTokens.ts`; `POST /api/auth/set-password` | Invitation and reset links: 256-bit, hashed at rest, single use, expiring, shown once, delivered out of band; redeeming revokes all sessions. Invited accounts have no password and cannot sign in until they choose one |
| SEC-031 | `server/app.ts` | Link redemption has its own rate limiter and CSRF protection |
| SEC-012 | `GET /api/admin/audit` | Administrative events only, administrator only; commercial history never includes them |
| FR-011, FR-071 | `server/services/team.ts`; `GET /api/team`; Team Management page | Management's read-only structure and workload: active opportunities, estimated pipeline, open and overdue tasks per active owner, computed in SQL; no emails or account fields. Rows drill down to that owner's opportunities |
| SEC-032 | `server/http/errors.ts` | Unexpected errors are logged without request data (see defect 1) |

**Interface.** Reassign (lead) / Reassign / Transfer (management) on the
opportunity page, using the approved two-step ReassignModal with From → To,
the cross-section warning and a required reason. Team Management is live for
management, with the approved workload table, transfer panel and reporting
structure. Administration is the approved administration dashboard plus the
user table (Add user, Edit, Reset link / New invitation, Deactivate/Activate),
sections with Replace lead, and the administrative audit. A new
`/set-password` page in the sign-in style. Nothing in `src/demo`,
`src/components` or `src/pages` was changed.

**Interface deviations, for product sign-off.**

| Change | Reason |
| --- | --- |
| Add user creates the account without a password and shows a single-use invitation link | SEC-030; the demo had no authentication. No email sending in release one |
| "Reset link" / "New invitation" per account | SEC-030 recovery without email |
| Transfer confirmation requires a reason | FR-070 |
| Replace lead is a section action, not a role dropdown | BR-052: atomic replacement |
| Team Management is management-only; the administrator's account screens are on Administration | FR-011 / FR-071 separation |
| Summary cards say "Section leads" and "Salespeople" (the demo said "Section Leads" + "s") | Wording |

### 3. Implementation decisions

In `docs/adr/0004-transfers-and-administration.md`, with reasons. Flagged for
review: open work blocking deactivation includes On Hold records; any owned
opportunity, open or closed, blocks a role or section change (except lead ↔
salesperson in the same section); a section with active members cannot be
deactivated; invitation links last 72 h and reset links 24 h; the minimum
password length is 12; there is no self-service "forgot password" without
email delivery; Team Management is not offered to section leads in this
release.

### 4. Database

| Migration | Contents |
| --- | --- |
| `0003_accounts_invitations_and_recovery.sql` | `account_tokens` (hashed, single-use, expiring) and its enum; `users.password_hash` becomes nullable for invited accounts |

Additive. The runtime role received exactly SELECT/INSERT/UPDATE/DELETE on the
new table through the default privileges from `0001` (verified). The seed now
clears `account_tokens` too. **Rollback** is in the migration header; restoring
NOT NULL on `password_hash` is only possible while no invitation is pending.

### 5. Commands run and results

All on 05 October 2026, against PostgreSQL 18 in Docker.

| Command | Result |
| --- | --- |
| `npm run db:migrate` / `db:migrate:test` | `0003` applied; repeat run is a no-op |
| `npm run typecheck` | **Pass** (web, server, e2e) |
| `npm run lint` | **Pass** — 0 errors, the same 5 pre-existing warnings |
| `npm run check:env` | **Pass** — 16 variables |
| `npm test` | **279 passed, 0 failed**, 11 files (240 after M2 + 16 transfers + 22 administration + 1 log safety) |
| `npm run test:smoke` | **14 passed** — 2 M1 smoke, 10 M2, 2 M3 |
| `npm run build` | **Pass** — demo-exclusion before and after bundling (it caught one real problem, defect 5); main chunk 488 kB, below Vite's warning after the administration, team and set-password screens were split out |
| `npm run evidence` | 29 screenshots (the 22 earlier ones recaptured, 7 new for M3: `15`–`21`); now two Playwright runs so neither exceeds the login rate limit |

| New test file | Tests | Covers |
| --- | --- | --- |
| `transfers.test.ts` | 16 | AT-07: lead transfer, access gained and lost by URL, list and child routes; task rules for owner, lead and management tasks; completed tasks, creator and history authors kept; salesperson 403; lead cross-section refused; ineligible owners; AT-08 transfer portion: cross-section revokes the old lead and owner, gives the new lead and owner access, moves the old lead's task, keeps management's; closed records transferable; 404 for other sections and the administrator; PATCH still 403; reason and stale version; idempotent replay; replay after access loss is 404; transfer racing completion |
| `administration.test.ts` | 22 | Administrator-only access; no credential fields; administrative audit separation; invitation → set password → sign in; single use; link never shown twice on retry; identical answers for unknown and expired links (injected clock); reset revokes sessions and spends earlier links; short password refused without spending the link; AT-09: deactivation blocked by open work, allowed after transfers with session revocation; owner move/promotion blocked; movable person re-pointed to the new lead with sessions ended; reporting line enforced; Replace lead atomic with direct reports, sessions and scope; lead and outsider protections; section deactivation rules; new section → first lead → salespeople; duplicate email; no self role change or self deactivation; two administrators deactivating each other concurrently leave exactly one; team view values match the database, no emails; team view refused to other roles |
| `create.test.ts` (+1) | — | SEC-032: an induced query failure logs nothing from the request |
| `e2e/m3.spec.ts` | 2 | Administrator invites a person who sets a password from the link and signs in; the link cannot be reused; deactivating an owner of open work is blocked with the reason; a lead reassigns a record from the detail page and the previous owner gets "Not available" |

**Mutation checks.** Restoring the old error logger makes the SEC-032 test
fail (it found the follow-up text in the log). Removing the administrator row
lock did **not** make the two-administrators race test fail: in-process
timing almost always lets one request's session check see the other's commit.
The lock is correct by construction and the outcome is still checked, but that
test is not evidence that the lock is needed — unlike the M2 completion race,
which does fail without its lock.

### 6. Defects found and fixed

1. **Unexpected-error logging leaked request data (M1 defect, SEC-032).** The
   fallback logger printed the whole error; a failed query's error includes
   its bound parameters. Demonstrated with a test that found a follow-up's
   text in the log; fixed by logging type, SQLSTATE, constraint and the
   statement opening only.
2. **Two administrators acting on each other could deadlock.** Each locked its
   target and then all administrators, in opposite orders. Now every account
   change locks the administrator rows first, in id order.
3. **The set-password page could lose its token in development.** It removed
   the token from the URL inside a state initialiser, which React may run
   twice; the read is now pure and the URL is cleaned in an effect.
4. Test-harness only: an `async` helper hid supertest's `.expect`, and the
   resulting in-flight request deadlocked the next test's fixture reset.
5. **The production build failed the demo-exclusion check**: the add-user
   form's placeholder `name@example.com` uses the synthetic seed domain. The
   guard from M1 worked as intended; the placeholder now reads "Work email
   address".
6. **The main bundle crossed 500 kB** with the new screens. Administration,
   Team Management and set-password now load on demand (488 kB main chunk).
7. Presentation: "Managements"/"Salespersons" card labels, and "— →" on
   newly created values in the administrative audit.

### 7. Acceptance coverage

| Test | Status |
| --- | --- |
| AT-07 | **Covered** (API and browser): Tasnia gains, Rafiq loses, owner tasks transfer, management tasks stay, authors remain, salesperson forbidden. Historical documents and tenders do not exist yet; they will follow scope because scope is derived from the opportunity |
| AT-08 | **Transfer portion covered**: old team scope revoked at once. The shared-contact portion needs contacts (M4) |
| AT-09 | **Covered**: deactivation blocked by open work, moving an owner cannot leave mismatches, lead replacement updates direct reports atomically, the last administrator cannot be removed |
| AT-15 | Partial: transfer/task race added. Remaining channels arrive with their features |

### 8. Remaining issues and limitations

- **Open follow-ups assigned to an account being deactivated** (for example a
  management task) are not reassigned; the account cannot be deactivated
  while it owns open work, but tasks it was merely assigned stay open with an
  inactive assignee. To review with Penta.
- **Section leads have no workload view** (see decisions).
- **Two-administrators race test does not discriminate** (see mutation checks).
- **Account list for pickers is bounded at 100** — the proposed envelope
  (NFR-010). Beyond that the pickers need search.
- **MFA and the identity provider** remain open decisions (ADR 0002/0004).
- From earlier milestones, unchanged: PATCH has no idempotency key; idempotency
  and token cleanup are unscheduled; five pre-existing fast-refresh lint
  warnings.

### 9. Local startup

As in the Milestone 2 section §9 below, with `0000`–`0003` applied by
`npm run db:migrate && npm run db:migrate:test`. To see M3:

- `nadia.islam@example.com` (lead): open a record, **Reassign**.
- `arif.rahman@example.com` (management): **Team Management**; **Reassign / Transfer** across sections.
- `admin@example.com` (administrator): **Administration** → Add user, copy the
  link, open it in a private window to set the password; try Deactivate on an
  owner of open work; Replace lead on a section.

### 10. Next task

**Milestone 4 — organizations, contacts, relationship notes and activities**
(`Plan.md` §6), not to be started until this milestone is reviewed. Contact
visibility must follow opportunity scope through links (SEC-004), and the
shared-contact part of AT-08 then becomes testable against the transfer
service built here.

---

## Milestone 2 — stages, statuses and follow-ups

**Branch:** `m2-stages-status-follow-ups`, created from `origin/main` at `94fae7f` (merged M1)
**Commits:** `1f59c0b` (M1 handover review), then the Milestone 2 commit that contains this section
**Date:** 05 October 2026
**Status:** Complete and ready for review. Not merged. Milestone 3 not started.

### 1. What was built

| Requirement | Where | What it does |
| --- | --- | --- |
| FR-020, FR-021 | `server/services/transitions.ts` `changeStage`; `POST /api/opportunities/:id/stage` | Stage changes from the board and the detail page's dropdown. The next stage needs nothing extra; skipping forward or moving back requires an explanation (stored as the audit reason). Each change is its own history entry |
| BR-011 | same | Awarded requires a positive actual value (decimal string) and an award date not in the future. Lost requires one of the six preset reasons and a closed date; "Other" requires explanatory text |
| BR-010, D-001 | `changeStatus`; `POST …/status` | On Hold and Cancelled keep the stored stage, require an explanation, and are refused on Awarded/Lost. A held or cancelled record appears only in its status lane; returning to Active restores the retained stage |
| BR-012 | `reopenOpportunity`; `POST …/reopen` | Management only (403 for leads and salespeople on a visible record). Requires a reason, a working stage and a new next action; clears the outcome fields, and the previous outcome is kept in the reopening event's before-values |
| BR-014 | `transitions.ts`, `followUps.ts` | Awarded, Lost and Cancelled close every open follow-up as **Cancelled** with a reason, never Completed, one audit event each. On Hold keeps tasks open and the UI marks them "On Hold". Returning to Active requires a next action when none is open |
| FR-042, D-004 | `server/services/followUps.ts`; `POST /api/opportunities/:id/follow-ups`, `GET …/follow-up-assignees` | Quick creation with server-checked assignees: salesperson → self; lead → owner or self; management → owner, the section's lead or a management account. All must be active and already able to see the record; assignment never grants access |
| BR-013, BR-014 | `POST /api/follow-ups/:id/complete`, `/cancel` | Closing the last open follow-up of an Active, nonterminal opportunity requires a replacement in the same request (422 `replacement` otherwise); the replacement becomes the next action |
| FR-043 | `POST /api/follow-ups/:id/reschedule` | Records old date, new date, actor and reason. A same-date reschedule is refused |
| FR-043, BR-030 | `GET /api/follow-ups` | Scoped cross-opportunity list with Open / Overdue / Today / Upcoming / Completed / Cancelled / All and an "Assigned to me" filter. Buckets and counts are computed in SQL against today's Dhaka date. Past due dates are accepted and show as overdue at once |
| BR-090 | all M2 services | Every writer locks the opportunity row (`FOR UPDATE`, through the scope predicate) before any follow-up, and checks the version both after the lock and in the UPDATE predicate |
| BR-091 | `runIdempotent` in `server/services/idempotency.ts` | Every M2 mutation requires an `Idempotency-Key`; the fingerprint covers the record id and body; the claim is completed inside the business transaction; replay re-reads through scope (404 after access is lost) |
| FR-062, SEC-012 | `server/services/audit.ts` | `opportunity.stage_changed`, `.status_changed`, `.reopened`, `follow_up.created`, `.completed`, `.rescheduled`, `.cancelled` — all in the same transaction, with actor, request id, before/after and reason. Change History shows names and labels, not ids or storage values |
| SEC-001–003 | `server/policy/scope.ts` | New permissions (`canChangeStageOrStatus`, `canManageFollowUps`, `canReopenOpportunity`, `followUpAssigneeScope`) live in the policy module only. Missing and inaccessible records and follow-ups return the identical 404 |
| FR-021, D-006 | `GET /api/opportunities/board`; `src/app/components/PipelineBoard.tsx` | The approved Pipeline board restored in API mode, bounded to 50 cards per lane with server-computed counts and values. The Awarded lane sums actual awarded value; the others sum estimates, and each header says which |

**Interface.** The Opportunities page has the approved Pipeline/Table toggle
again, Pipeline by default as in the demo. A dropped card shows in the target
lane marked "Not saved yet" until the server confirms; a cancelled dialog or a
refused move returns it to its original lane and position. The detail page
gains the approved "Change Stage…" menu, Return to Active, Cancel opportunity,
Reopen (management), Add Follow-up and per-task Complete / Reschedule / Cancel.
The Activities & Follow-ups screen is live for follow-ups. Dialogs reuse the
approved `Modal`, `Field` and button primitives; nothing in `src/demo`,
`src/components` or `src/pages` was changed.

**Interface deviations, for product sign-off.**

| Change | Reason |
| --- | --- |
| Lost reason is a six-option select plus explanation, not free text | BR-011 presets |
| Skip/backward moves ask "why"; Awarded/Lost/Cancelled dialogs state that open follow-ups will be closed as Cancelled | FR-021, BR-014 |
| Completing a follow-up may require a replacement next action | BR-014 |
| Rescheduling requires a reason; follow-ups can be cancelled | FR-043, FR-042 (Cancelled is a production addition, D-007) |
| Reopen button for management on closed records; Edit disabled on closed records | BR-012 |
| Board lane headers carry an "estimated / actual awarded value" label for screen readers and as a tooltip | D-006 |
| Activities & Follow-ups: the Activity Log tab, the calendar view and "Quick Add" (which needs an opportunity picker) are not yet available; follow-ups are added from the opportunity page | Activities arrive in M4 |

### 2. Implementation decisions

Recorded in `docs/adr/0003-stage-status-and-follow-up-lifecycle.md`, with the
reasoning. In short: moves to Awarded/Lost are not "skips"; a held or cancelled
record changes stage only by returning to Active; Cancelled → On Hold is
refused; a closed date cannot be in the future; cancelling records today as the
closed date; closed records stay read-only for basic edits until reopened or
returned; creation stays nonterminal; follow-ups may be added while On Hold but
not once closed. None of these relaxes a requirement; each fills a gap the
requirements leave open and is flagged here for review.

### 3. Database

| Migration | Contents |
| --- | --- |
| `0002_stage_status_follow_up_integrity.sql` | `follow_ups.cancelled_by`; CHECK constraints for outcome consistency (Awarded value and date; Lost preset reason, date and "Other" explanation; outcome fields only on the matching stage; terminal records always Active; On Hold/Cancelled explained) and follow-up state consistency (Completed records who and when; Cancelled records who, when and why; never both) |

Additive only. Existing rows were checked against every constraint before it
was written. No table was added: stage history is the append-only audit trail.
**Rollback** statements are in the migration header and were exercised on both
local databases during development (see defect 1 below). Applied to the
development and test databases; re-running is a no-op.

### 4. Commands run and results

All on 05 October 2026, against PostgreSQL 18 in Docker (port 55432).

| Command | Result |
| --- | --- |
| `npm run db:migrate` / `db:migrate:test` | `0002` applied; repeat run is a no-op |
| `npm run typecheck` | **Pass** (web, server, e2e) |
| `npm run lint` | **Pass** — 0 errors, 5 warnings (the same pre-existing five; the M2 helpers were moved out of component files rather than adding new ones) |
| `npm run check:env` | **Pass** — 16 variables |
| `npm test` | **240 passed, 0 failed**, 9 files (168 M1 + 72 M2) |
| `npm run test:smoke` | **12 passed** — 2 M1 smoke + 10 M2 browser checks (rerun after the review fixes below) |
| `npm run build` | **Pass** — demo-exclusion check passes before and after bundling; server compiles |
| `npm run evidence` | 22 screenshots in `docs/evidence/` (14 M1 recaptured on the current UI, 8 new) |

| New test file | Tests | Covers |
| --- | --- | --- |
| `transitions.test.ts` | 44 | AT-05: forward/skip/backward, history, Awarded and Lost validation and closure, On Hold/Cancelled/return, reopening permissions and history, active-pipeline value, 404 equality, forged fields, idempotent replay and key reuse, replay after access loss, seven database CHECK constraints from the application role |
| `followUps.test.ts` | 23 | AT-06: last-task replacement rule (complete and cancel), On Hold exemption, double-click and repeated requests, reschedule audit, **Dhaka-midnight overdue boundary with the injected clock**, overdue → upcoming after rescheduling, historical past-due entries, assignee eligibility for every role including inactive owners, closed-record refusal, scope and 404 equality, list scoping and counts, history wording |
| `m2Concurrency.test.ts` | 5 | Genuinely concurrent connections, 4 rounds each: two completions of the last two tasks; two stage changes from one version; completion racing a Lost outcome; one key sent twice at once; a mixed burst checked against the next-action invariant across the whole database |
| `e2e/m2.spec.ts` | 10 | Real drag-and-drop: cancelled dialog restores lane and position; a refused (409) move restores the card and shows why; plus the five review flows in §7 |

**Mutation check.** With the opportunity row lock removed, the
concurrent-completion test fails (both requests succeed and the record is left
with no next action). The lock is restored; the test is evidence, not
decoration.

**Server restart (plan 7.8 step 2, M1 and M2).** On the development stack, an
opportunity was created and moved to Initial Engagement through the API; the
API process was stopped (port confirmed closed) and started again; the record
read back with the same stage, version 2, the exact value `1234567.89`, its
next action and both history events.

### 5. Defects found and fixed during this milestone

1. **An Awarded record without an awarded value passed the database check.**
   The first version of the constraint was `stage <> 'awarded' OR
   (awarded_value > 0 AND award_date IS NOT NULL)`. For a NULL value,
   `awarded_value > 0` is NULL, and a CHECK that evaluates to NULL passes. The
   new database-guarantee test caught it. Fixed with `IS NOT NULL` first; the
   unpublished migration was rolled back with its documented statements on both
   databases and regenerated.
2. **The Pipeline board widened the whole page.** The lane headers' screen-reader
   labels are absolutely positioned and had no positioned ancestor inside the
   scrolling board, so the far-right lanes stretched the document to 3236 px at
   a 1440 px viewport. Found by measuring the evidence screenshots. Fixed by
   making the board's scroll container the containing block; every capture is
   now exactly the viewport width, including 360 px.
3. **A Playwright drag could start on the wrong card.** `dragTo` scrolled the
   horizontally scrolling board between mouse-down and the drag starting.
   Test-only; the spec now starts the drag on the source before moving.
4. **The evidence capture tripped the login rate limit** (10 per 15 minutes).
   The limit was left as it is; the capture now reuses sessions and signs in 9
   times.
5. The M1 issues from the handover review: idempotency completion moved inside
   the transaction; create replay finds the first follow-up by creation order.

### 6. Acceptance coverage

| Test | Status |
| --- | --- |
| AT-05 | **Covered.** Board changes persist; Awarded fails without value/date; Lost fails without reason; On Hold keeps the stage and leaves the active-pipeline value; a cancelled dialog restores the card; only management reopens |
| AT-06 | **Covered.** Last-task rule; rescheduling moves the overdue calculation on the correct Dhaka date; terminal closure marks remaining tasks Cancelled; repeated requests do not duplicate events |
| AT-15 | Partial, as planned: concurrency and retries for M2 operations. Transfer/task races need M3 |
| AT-11 | Partial: the Dhaka-midnight task boundary is tested. Tender 72-hour and seven-day windows arrive with M5/M6 |

### 7. Milestone 2 review flows

Requested before Milestone 3. The Chrome extension was not connected, so the
flows were run in a real Chromium browser through Playwright, against the real
API and a freshly seeded test database. They are now permanent tests in
`e2e/m2.spec.ts` (run with `npm run test:smoke`; set `REVIEW_SHOTS=<dir>` to
save a screenshot of each outcome).

| Review flow | Result |
| --- | --- |
| Move a Kanban card, refresh, the change persists | **Pass** — card moved to Awaiting Tender, still there after reload |
| Awarded without value/date fails | **Pass** — both field errors shown, nothing saved, card returns to Tender Published |
| Lost without a reason fails | **Pass** — "Choose the reason the opportunity was lost.", card returns to Bid Submitted |
| On Hold keeps the previous stage | **Pass** — On Hold lane; detail shows "stage retained as Tender Published" and the note |
| Completing the last open follow-up needs a replacement or a closing/hold transition | **Pass** — dialog requires the next follow-up and names On Hold / cancel / outcome as the alternatives; submitting without it is refused; with it, it saves and becomes the next action. On an On Hold record the last task closes without a replacement |
| Salesperson cannot reopen; management can with a reason | **Pass** — salesperson: card not draggable, no Reopen button or stage menu, "Only management can reopen it"; management: refused without a reason and next action, then reopened at Evaluation with the reason and previous outcome in Change History |

**Found and fixed during the review:** the reopening entry in Change History
listed fields that were empty before and after (e.g. "Lost reason: —") and
showed raw `2026-10-01` dates and `23500000.00` amounts. Unchanged fields are
now omitted and dates and money are formatted like the rest of the page. The
browser suite also now shares one salesperson session, so the full run signs
in 5 times instead of brushing against the 10-per-15-minutes login limit.

### 8. Remaining issues and limitations

- **Board beyond 50 cards per lane** shows "N more — use the Table view"; the
  lane count and value still include them.
- **Keyboard users** change stage from the detail page's menu; drag-and-drop
  itself is mouse/touch only (FR-015 asks for a usable alternative, which the
  menu and the Table view provide).
- **No dashboard reflects M2 yet.** Active-pipeline totals are verified through
  the board's lane values; the dashboard cards are M6.
- **Follow-up list filters** are Assigned to: everyone / me. Filtering by a
  named colleague or by owner/section needs a scoped people lookup that does
  not exist yet; the demo's richer filters arrive with M3's team views.
- **Basic edit (PATCH) still has no idempotency key**; its version check
  already prevents a double apply, and M7 reviews it.
- **Idempotency record cleanup** is still unscheduled (background jobs).
- **Pre-existing**: five fast-refresh lint warnings; the local `main` branch
  is behind `origin/main`.

### 9. Local startup

```bash
npm install
cp .env.example .env     # then generate SESSION_SECRET and CSRF_SECRET (see README)
npm run db:up            # PostgreSQL 18 on localhost:55432
npm run db:migrate && npm run db:migrate:test   # applies 0000–0002
npm run db:seed  && npm run db:seed:test
npm run dev:server       # API  http://localhost:4800
npm run dev              # web  http://localhost:5173
npm run dev:demo         # the approved synthetic prototype (no API)
```

Sign in with the synthetic accounts listed in M1 §6 below; the password is
`SEED_DEFAULT_PASSWORD` in your `.env`. To see M2: as
`rafiq.hasan@example.com`, drag a card on the Pipeline board, or open a record
and use Change Stage… and the Follow-ups tab; as `arif.rahman@example.com`,
open an Awarded record and use Reopen. `npm run db:reset` restores the
fixtures.

### 10. Next task

**Milestone 3 — transfers and administration** (`Plan.md` §6), not to be
started until this milestone is reviewed. The transfer service must take the
opportunity row lock first, like every M2 writer, so a transfer and a
simultaneous task completion cannot leave tasks with the old owner (BR-090).

---

## Milestone 1 handover review — 05 October 2026

Performed before starting Milestone 2, on branch `m2-stages-status-follow-ups`
created from `origin/main` at `94fae7f`.

### Recorded status checked against the repository

| Claim in this report | Finding |
| --- | --- |
| M1 complete, "ready for review" | **Reviewed and merged**: PR #1 merged into `main` as `94fae7f` on 05 Oct 2026. Its tree is identical to the M1 branch head `19b86ed`. The local `main` branch was still at `ceb5e74` (not fast-forwarded); it was left untouched |
| CI passes | **Confirmed on GitHub**: run 37278089500 (PR) and 37278146987 (`main` push) both succeeded — clean install, migrations, typecheck, lint, env check, integration tests, browser smoke test, production build |
| Working tree | Clean. No unrelated or uncommitted work to preserve |
| 168 integration tests | **Rerun locally: 168 passed**, 6 files |
| Typecheck, lint, env check | **Rerun: pass**; lint 0 errors, 5 warnings |
| Browser smoke test | **Rerun: 2 passed** |
| Production build with demo exclusion | **Rerun: pass** |

### Issues found

1. **`npm run evidence` did not work as documented.** The Playwright config
   ignores `evidence.spec.ts` unless `CAPTURE_EVIDENCE=true`, and the script
   never set it, so the README command reported "No tests found". The 14 M1
   screenshots must have been captured with the variable set by hand. *Fixed:*
   the config now includes the spec whenever it is named on the command line.
2. **Idempotency claim completed outside the business transaction.** The
   claim was marked complete after the create transaction committed. A crash
   between the two would leave the record saved but its key stuck "in
   progress", so every retry for 24 hours got a 409 instead of the original
   result. *Fix in the Milestone 2 commit*, because the M2 services share the
   same helper: the claim is now completed inside the business transaction.
3. **Create replay returned "the first open follow-up", not the first
   follow-up.** Harmless while follow-ups could not change state, but wrong as
   soon as M2 lets the first one be completed. *Fix in the Milestone 2 commit*:
   replay finds it by creation order.
4. **Manual step 2 was not fully evidenced.** It asks for persistence across an
   application *server restart*; the recorded evidence was a browser reload.
   *Now verified* (see the Milestone 2 section): a record created and moved
   through the API on the development stack read back identically after the
   API process was stopped and restarted.
5. **Report inaccuracies, corrected below.** One of the five lint warnings is
   in M1's own `src/app/AuthContext.tsx` (it exports the `useAuth` hook beside
   the provider), not in an approved demo file. The CI paragraph says 167 tests
   where the suite has 168 (the 168th was added by the password fix).

No M1 blocker remained that prevented Milestone 2. None of the issues above
weakened access control.

---

## Milestone 1 — persistence, authentication, server-side permissions, opportunity workflow

**Branch:** `m1-persistence-auth-permissions` (merged into `main` as `94fae7f`)
**Baseline tag:** `demo-baseline` (the approved MagicPatterns export, commit `ceb5e74`)
**Date:** 04 October 2026
**Status:** Complete, reviewed and merged.

---

## 1. Verified repository and environment findings

`Plan.md` §1 asks for the repository and environment to be verified rather than
assumed. Several assumptions in the earlier plan were wrong; these are the
measured facts.

| Checked | Result |
| --- | --- |
| Framework | Vite 5.4.21, React 18.3.1, TypeScript, Tailwind 3.4.17 — confirmed |
| Mock service layer | `src/contexts/CrmContext.tsx`, 545 lines, 17 actions — confirmed |
| Browser storage | Exactly two call sites, both in `CrmContext.tsx` (key `penta-crm-demo-v1`) — confirmed |
| Lockfile | **Absent.** `package-lock.json` now committed |
| `src/package.json` | A MagicPatterns artefact. Unreferenced, and its pinned versions contradicted the root manifest. **Removed** after verifying nothing imports it and the build still passes |
| Unused dependencies | `@emotion/react`, `date-fns`, `@radix-ui/react-icons` — zero imports. Removed |
| Node | v24.13.0; npm 11.6.2. `.nvmrc` pins 24 |
| **Local PostgreSQL** | **None.** `C:\Program Files\PostgreSQL\18` holds a data directory but no server binaries |
| **Port 5432** | **An SSH tunnel** (MobaXterm) to a remote host — *not* a local database. Deliberately left untouched; no database was created on it |
| Database used instead | PostgreSQL 18 via `docker-compose.yml`, host port **55432** (chosen so it cannot collide with that tunnel) |
| Reserved TCP ports | Ports **3592–4691 are reserved** on this machine by Hyper-V/WSL. Binding one fails with `EACCES`. The planned API port 4000 was inside that range; the project default is now **4800** |

The earlier plan's claim that a local PostgreSQL was available on 5432 was
incorrect and is corrected here.

---

## 2. Implemented behaviour, by requirement

### Complete

| Requirement | Where | Note |
| --- | --- | --- |
| SEC-001 | `server/policy/scope.ts`, `server/auth/sessionGuard.ts` | Scope derives from the session's account id plus a fresh database read. A client-supplied owner, section, role or id never grants anything |
| SEC-002 | `server/services/opportunities.ts` | `opportunityScope(actor)` is a SQL predicate composed into every query. Filtering, counting, sorting and pagination all run over permitted rows inside the database |
| SEC-003 | `server/http/errors.ts` | One `NOT_FOUND_MESSAGE`. A missing and an inaccessible object return byte-identical bodies apart from `requestId` |
| SEC-005 | `server/auth/sessionGuard.ts` | Deactivation and `session_version` bumps invalidate a live session on its next request |
| SEC-020 | `server/http/errors.ts`, `server/http/validate.ts` | 401 / 403 / 404 / 409 / 422 with `{code, message, fieldErrors?, requestId}`. No stack traces, no private values |
| SEC-030 | `server/auth/` | passport + express-session + connect-pg-simple + argon2id. No public registration, no demo-password path, generic failure message, constant-work verification for unknown accounts |
| SEC-031 | `server/app.ts`, `server/http/csrf.ts` | HttpOnly `SameSite=Strict` cookie, signed double-submit CSRF token, trusted-origin validation, login rate limiting, 30-minute idle and 12-hour absolute expiry, revocation on logout |
| FR-001, FR-002 | `server/policy/` | Four roles with separated responsibilities. Administrative ability grants no commercial visibility |
| FR-013 | `src/app/` | Loading, empty and error states; field errors next to inputs; double submission prevented; success only after a confirmed commit; entered values preserved on failure |
| FR-020 (creation) | `server/services/opportunities.ts` | Active, nonterminal creation with full field validation |
| BR-001 | same | Owner must be an active eligible owner the actor may assign; the opportunity's section must equal the owner's section |
| BR-002 | migration `0001`, `server/policy/scope.ts` | Lead scope is `section_id = actor.section_id` with no owner-active or reporting-line condition. One active lead per section enforced by a partial unique index |
| BR-013 | `server/services/opportunities.ts` | Next action is derived from the earliest due open follow-up with a creation-time tie-breaker. There is no second editable next-action field, and the basic edit refuses one |
| BR-014 | same | Opportunity + first follow-up + audit commit in one transaction |
| BR-080 | `server/db/` | UUID keys, foreign keys, unique normalised emails, unique references from a sequence, non-negative money checks, UTC timestamps, indexes |
| BR-090 | `server/services/opportunities.ts` | Version check inside the UPDATE predicate; stale writes get 409 |
| BR-091 | `server/services/idempotency.ts` | Durable records scoped by actor and operation, request fingerprint, concurrency-safe claim, replay re-authorised |
| FR-062 (M1 scope) | `server/services/audit.ts` | Append-only audit for create and update, with actor, request id and before/after values |
| SEC-012 (M1 scope) | migration `0001` | The runtime role has `INSERT`/`SELECT` only on `audit_events`; `UPDATE`, `DELETE` and `TRUNCATE` are revoked |
| D-001 | `server/db/schema.ts`, `shared/enums.ts` | `stage` and `status` separate from the first migration; `boardLaneLabel` keeps one visible lane and the retained stage is shown |
| D-003 | `server/db/seedData.ts` | The demo's separate next-action text was converted into the single open follow-up. No distinct action was dropped |
| NFR-001 | `scripts/check-demo-exclusion.ts` | Production build fails on demo flags, unsafe production config, demo-shaped endpoints, or demo fingerprints in the built bundle |

### Partial, by design

| Requirement | Done | Not done |
| --- | --- | --- |
| AT-01 | Administrator is refused commercial collections (403) and objects (404) at API and UI level | Export, document and notification channels do not exist yet |
| AT-02 | Section isolation through list, detail, filters, search, child records and direct URL | Contacts, CSV, documents, notifications |
| AT-03 | Individual isolation including same-section colleagues, forged owner/section fields and forged updates | Reassignment-related visibility (needs transfers, M3) |
| AT-04 | Creation with the first follow-up in one transaction; field errors with no partial writes; correct cross-role visibility | — |
| FR-010 | Approved layout, palette, typography and screen structure preserved; `BST` replaced with `Bangladesh time (UTC+6)` per §20 | Full visual comparison of unimplemented screens |
| FR-062 | Create and update audited | Stage, task, transfer, contact-link and document events arrive with their features |

### Not started

Stage and status transitions (M2), follow-up lifecycle (M2), ownership
transfers and account administration (M3), organizations/contacts/activities
(M4), tenders and documents (M5), dashboards, reports, CSV, search and
notifications (M6).

Each is visibly unavailable in the application with a stated reason. None is
populated with demo records or fabricated totals.

---

## 3. Commands actually run, and their results

All run on 04 October 2026 against PostgreSQL 18 in Docker.

| Command | Result |
| --- | --- |
| `npm ci` equivalent (`npm install`) | 454 packages, lockfile committed |
| `npm run db:up` | PostgreSQL 18 healthy on 55432; two roles and two databases created |
| `npm run db:migrate` / `:test` | Applied; re-running is a verified no-op |
| `npm run db:seed` / `:test` | 2 sections, 10 users, 11 organizations, 23 opportunities, 17 open follow-ups |
| `npm run check:env` | **Pass** — 16 variables parse exactly as written |
| `npm run typecheck` | **Pass** (web, server and e2e projects) |
| `npm run lint` | **Pass** — 0 errors, 5 warnings |
| `npm test` | **168 passed, 0 failed**, 6 files, ~40s |
| `npm run test:smoke` | **2 passed**, ~21s |
| `npm run build` | **Pass** — demo-exclusion check passes before and after the bundle is produced |
| `npm run evidence` | 14 screenshots written to `docs/evidence/` *(the script as committed found no tests; see the handover review above)* |

### Integration suite composition

| File | Tests | Plan §7.6 scenarios |
| --- | --- | --- |
| `auth.test.ts` | 22 | 1–5 |
| `scope.test.ts` | 46 | 6–11, 14, 15 |
| `create.test.ts` | 38 | 12, 16–20, 22 |
| `edit.test.ts` | 25 | 13, 21 |
| `childScope.test.ts` | 11 | 23 |
| `operations.test.ts` | 26 | 24, 25 |
| **Total** | **168** | all 25 |

The five lint warnings are `react-refresh/only-export-components`: four in
approved demo files (`Badges.tsx`, `FormFields.tsx`, `CrmContext.tsx` twice)
and one in M1's `src/app/AuthContext.tsx`, which exports the `useAuth` hook
beside its provider. *(Corrected 05 Oct 2026; the original text attributed all
five to demo files.)* They affect fast refresh only.

### CI-equivalent run

Verified locally with `.env` removed and configuration supplied purely through
environment variables, as GitHub Actions will do: migrations applied and all
167 tests passed. *(That run predates the password-fix test; the suite now has
168, and GitHub CI has since passed with all of them.)* The workflow in `.github/workflows/ci.yml` creates the same
two database roles from `docker/initdb/01-roles-and-databases.sql`, so the
append-only audit and no-DDL assertions are exercised in CI, not skipped.

### Manual review (`Plan.md` §7.8)

| Step | Result |
| --- | --- |
| 1. Salesperson signs in, creates, sees the committed detail and first follow-up | Pass — automated in `e2e/smoke.spec.ts`; `docs/evidence/02–04` |
| 2. Reload and server restart; data persists in PostgreSQL | Pass — reload asserted in the smoke test, which also asserts `localStorage` and `sessionStorage` are empty |
| 3. Management and the correct lead have access; another salesperson and another section are denied by URL and API | Pass — smoke test plus `scope.test.ts`; `docs/evidence/05–06` |
| 4. Administrator sees an administration-only landing page and is denied commercial API access | Pass — `docs/evidence/07–08` |
| 5. Rapid retry and uncertain network response deduplicate with no false success | Pass — `create.test.ts` sequential and concurrent retry tests |
| 6. Edit with an outdated version returns 409 with a usable reload/reapply flow | Pass — `edit.test.ts`; the dialog keeps typed values and offers "Reload current values" |
| 7. Logout and session expiry clear the previous account's cached data | Pass — `AuthContext` clears state and bumps a session key that discards every screen's fetched data |
| 8. Screens compared at 1440 px, 768 px and 360 px | Captured in `docs/evidence/`. Keyboard use and labelled validation errors use the approved `Field` primitive |
| 9. The synthetic demo build remains available and is not connected to production data | Pass — `npm run dev:demo`; the production bundle contains none of it |

---

## 4. Defects found and fixed during this milestone

Recorded because each was a genuine fault, not a test adjustment.

1. **`sameDatabase` treated `localhost` and `127.0.0.1` as different hosts**, so
   the guard protecting the development database from the test suite could be
   bypassed by spelling one URL differently. Loopback aliases are now
   normalised (`server/env.ts`).
2. **Administrator object requests returned 403 instead of 404.** Guard
   placement now distinguishes collections (403 before any lookup) from object
   routes (404 from the scope predicate), so object addressing never discloses
   existence.
3. **Unknown query parameters and unsupported edit fields produced an
   unattributed error.** Zod's `unrecognized_keys` issue is now mapped to the
   offending field names.
4. **The login screen hard-coded `/opportunities`**, so an administrator landed
   on a page they can never load. Sign-in now routes through the role-aware
   landing redirect.
5. **An administrator could reach commercial routes in the UI** and saw a
   skeleton that never resolved. Capability route guards now render a plain
   refusal.
6. **The production bundle contained synthetic fixtures and the fixed demo
   clock.** The entry point now branches on a build-time literal so only one
   application is bundled, and `check-demo-exclusion.ts --bundle` scans the
   built assets. Verified in both directions: the guard passes on the real
   bundle and fails when a demo chunk is introduced.

### Found after the milestone commit

7. **The documented development password did not work.** `.env.example` set
   `SEED_DEFAULT_PASSWORD=Synthetic#Dev1`, but Node's `--env-file` parser treats
   an unquoted `#` as the start of an inline comment, so the seed script
   received `Synthetic` and both databases were seeded with that. Every
   document and hand-off message stated the full value.

   *Why 167 tests missed it.* The seeding side and the asserting side always
   read the same truncated value, so each run was internally consistent: the
   integration harness set the password in JavaScript, bypassing the parser;
   the Playwright config and spec both read it through `loadEnvFile`. Nothing
   compared **what the documentation says** with **what actually
   authenticates**.

   *Fixed by* quoting the value and removing special characters from the
   default (`"Synthetic-Dev-2026"`); a new `npm run check:env` that fails when
   any `.env.example` value does not survive Node's parser; a new integration
   test that seeds with the parsed value and signs in with the literal one; and
   deriving `TEST_PASSWORD` from configuration instead of a hard-coded
   constant. Both the guard and the test were verified to fail against the
   original defect and pass after the fix.

---

## 5. Database and migrations

| Migration | Contents |
| --- | --- |
| `0000_modern_spacker_dave.sql` | Enum types and the eight M1 tables with constraints and indexes |
| `0001_privileges_and_reference_sequence.sql` | `opportunity_reference_seq`; the circular `sections.lead_user_id` foreign key; the one-active-lead-per-section partial unique index; runtime-role grants including append-only `audit_events` |

Tables: `sections`, `users`, `organizations`, `opportunities`, `follow_ups`,
`audit_events`, `idempotency_records`, `session`. Contacts, activities,
tenders, documents and notifications are deliberately absent — asserted by a
test — and arrive with the features that use them.

**Rollback.** Migration `0000` creates everything, so rolling back M1 means
dropping the schema and re-migrating; there is no production data to preserve.
From M2 onward, migrations must be additive and reversible. `0001` is written
to be re-runnable: every statement is guarded.

**Fixture conversion.** Legacy demo ids map to deterministic UUIDv5-style
identifiers (`legacyUuid`), so relationships stay consistent across reseeds and
tests can address known records. Two demo records recorded only "On Hold" or
"Cancelled" with no prior stage; their stage is a documented synthetic mapping,
marked `syntheticStageMapping` in `server/db/seedData.ts`, and must never be
applied to live data without a separately reviewed migration.

---

## 6. Local startup

Full instructions are in `README.md`. In short:

```bash
npm install
cp .env.example .env     # then generate SESSION_SECRET and CSRF_SECRET
npm run db:up
npm run db:migrate && npm run db:migrate:test
npm run db:seed  && npm run db:seed:test
npm run dev:server       # API  http://localhost:4800
npm run dev              # web  http://localhost:5173
```

**Synthetic accounts** (development and test only; the seed refuses
`NODE_ENV=production`): `arif.rahman@example.com` (management),
`nadia.islam@example.com` and `farhan.ahmed@example.com` (section leads),
`rafiq.hasan@example.com`, `tasnia.karim@example.com`,
`imran.hossain@example.com`, `sadia.akter@example.com` (salespeople),
`admin@example.com` (administrator).

The shared password is `SEED_DEFAULT_PASSWORD` in your local `.env`. It is not
recorded in this report or anywhere else in the repository.

---

## 7. Known limitations and open decisions

### Limitations of this milestone

- Opportunities are created **Active and nonterminal only**. Awarded and Lost
  need the outcome capture rules, which arrive with M2. Terminal and cancelled
  fixtures are readable but refuse basic edits.
- The **Pipeline (Kanban) view is absent in API mode**. Drag-and-drop changes a
  stage, and the stage service does not exist yet; a board that cannot persist a
  move would be misleading. The approved board is intact in the demo build.
- **No dashboards, reports, CSV, search or notifications.** Each would need the
  scoped aggregate queries that arrive with M6.
- The organization list endpoint returns **basic directory information only**,
  with no opportunity counts — a count must be scoped, and scoped aggregates
  arrive with M6.
- **Idempotency record cleanup is not scheduled.** The pruning function exists
  and is tested; the scheduler arrives with background jobs.
- **AT-01/02/03 are not fully covered** and cannot be until exports, documents,
  search and notifications exist.

### Open decisions for Penta (requirements §18)

1. **Identity provider.** No SSO configuration exists in the repository, so
   local authentication was implemented for development. If Penta has suitable
   SSO it replaces the login path; the policy layer is unaffected. See
   `docs/adr/0002-authentication-and-sessions.md`.
2. **MFA for privileged roles**, where the chosen identity service supports it.
3. **Invitation and password recovery flows** — not implemented; planned for M3.
4. **Session lifetimes** — 30-minute idle and 12-hour absolute are the proposed
   SEC-031 defaults.
5. **Hosting, private file storage and the scanning service** — needed before
   M5 can be enabled.
6. **Retention periods** for sales records, audit events and backups.

### Approved-interface deviations

Each is required by the specification and is listed for product sign-off.

| Change | Reason |
| --- | --- |
| New sign-in screen | The demo had no authentication, only a role switcher (SEC-030). Built in the approved palette |
| `BST` → `Bangladesh time (UTC+6)` | §20 requires the unambiguous form |
| Sidebar footer rewritten | The prototype text implied the browser enforced access |
| Demo-only controls removed from the production build | NFR-001 |
| Unimplemented screens show a stated reason | `Plan.md` §2: unfinished features stay disabled with an accurate explanation, never populated with demo data |
| Creation form labels the next action as the first follow-up | BR-013/BR-014: it is saved as one, in the same transaction |

### Repository note

A `docs/evidence` entry appeared in `.gitignore` during this work and was
removed, because this report and the README reference those screenshots as
committed evidence (`Plan.md` §8). If that entry was deliberate, say so and the
screenshots can be dropped from version control instead.

---

## 8. Next task

**Milestone 2 — stages, statuses and follow-ups.** Per `Plan.md` §6, and not to
be started until this milestone has been reviewed:

1. Stage transitions through dropdown and Kanban, with required explanations for
   skipped and backward movement, preserving full stage history.
2. Awarded value and date; Lost reason from the six presets with explanatory
   text for "Other"; management-only reopening with a reason.
3. On Hold and Cancelled as status changes that retain the stored stage, and
   return from hold with a next action.
4. Complete, reschedule and cancel follow-ups. Completing the last open task on
   an active nonterminal opportunity requires a replacement or a valid
   transition. Terminal closure cancels open tasks with a reason, never falsely
   marking them complete.
5. Restore the Pipeline board in API mode once moves can persist, with failed
   or cancelled drags restoring the original card position.
6. Audit, version checks and idempotency on every new mutation as it is added —
   M7 verifies completeness; it is not permission to defer them.

Acceptance coverage to target: AT-05 and AT-06.
