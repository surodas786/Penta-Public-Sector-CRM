# Change requests CR1–CR6 — assessment and plan

**Branch:** `cr-change-requests`, created from `changemade` at `e9a8e1b`
(Milestone 8 plus the Vite host fix and the Chrome stale-cookie fix)
**Date:** 12 October 2026
**Status:** Steps 1–7 are done. Steps 1–6 implemented CR3; CR4 + CR5 (migration 0008); the
CR2 email foundation (migration 0009); CR1 invitation and reset emails; CR2
alert emails; and CR6, Software Procurement. **CR6 was rebuilt** to Penta's
step 5 instruction (12 October 2026). It now uses separate procurement
cycles in their own area, with milestones distinct from the pipeline
(migration 0011, ADR 0012). This supersedes D-CR6-2 and D-CR6-4 and retires
0010's pipeline stages and tender phases. See `docs/progress.md` and ADRs
0010–0012. Step 7 is complete: the final regression passed, apart from the
aged m5 fixture, and the release documents are updated. **CR2 step 6**
(13 October 2026) connected email to the in-app notifications and the
procurement cycles: configurable events, recipients, timing, summaries and
failure notices (migration 0012, ADR 0011 addendum; see "Changes made in CR2
step 6" below). **Step 7 of the final sequence** (13 October 2026) verified CR1–CR6 as one change set: an
integrated acceptance suite, an upgrade rehearsal from release-one data and
responsive/keyboard checks. Release handover:
`docs/release/cr-release-handover.md`. Still open: D-EM-1, D-EM-2 and
D-EM-4, and the three release blockers. Nothing is deployed.

**Changes made in CR2 step 6 (13 October 2026):**

- **Events.** EOI and RFP proposal deadline reminders (new in-app alerts
  too), a team summary, a management summary and an administrators'
  delivery-failure notice. Security emails can no longer be turned off. The
  two summaries are off until an administrator turns them on.
- **Recipients.** Reminders: the person responsible. Assignment: the new
  owner. Team summary: each current section lead, once. Management summary:
  only the people the administrator chose. Failures: active administrators,
  with a count and a link. Salespeople receive no summary.
- **Timing.** The administrator sets a Bangladesh-time reminder hour,
  deadline reminder hours (1 to 72, never before the in-app alert) and a
  daily or weekly summary. Emails are queued when due, not when the alert is
  created; one older than 24 hours is never sent late.
- **Staleness.** Completion, rescheduling, transfer, any procurement cycle
  change and account or section changes suppress queued reminders; every
  email is re-checked just before sending.
- **Links.** After sign-in the reader returns to the linked page. The API
  checks their access afresh.
- **API.** `GET`/`PUT /api/admin/email/notification-timing` (versioned,
  audited as `email.notification_timing_updated`).

**Changes made when CR6 was rebuilt (step 5 instruction):**

- **Separate cycles.** Software Procurement is a separate cycle record, not
  a workflow of the opportunity. The opportunity keeps the standard
  pipeline, and a matching stage is only offered.
- **Its own milestones.** The cycle ends Awarded, Unsuccessful or Cancelled,
  or Not shortlisted. Not shortlisted offers Lost with the reason Not
  shortlisted (D-CR6-3 kept).
- **Direct RFP.** An RFP without an EOI is now a documented,
  management-only exception (D-CR6-6 and the "RFP without an EOI" change
  below are superseded).
- **Retired 0010 structures.** Goods tenders keep their original workflow:
  the EOI/RFP phase and `closed` state on tenders are retired.

**Changes from this plan made during step 6 (first CR6 design, since superseded):**

- **One current notice.** The EOI notice's new state is `closed`. The plan
  kept a single current notice, and this keeps the existing
  `tenders_one_current_per_opportunity` index unchanged.
- **RFP without an EOI.** An RFP may be recorded without any EOI on the
  record (an opportunity found at the RFP stage). If EOIs exist, one must be
  Shortlisted first.
- **Endpoint path.** The EOI outcome endpoint is
  `POST /api/tenders/:id/eoi-outcome`. No email
has been sent outside the development capture folder, and nothing is
deployed.

**Changes from this plan made during step 3:**

- **Defaults stay in code.** Settings and wording are rows only once an
  administrator saves them; until then the defaults in `shared/email.ts`
  apply. The migration therefore seeds nothing.
- **`email.invitation_queued` is deferred.** It belongs to step 4.

**Changes from this plan made during step 4:**

- **Audit action names.** The queued account emails are audited as
  `account.invitation_queued` and `account.reset_queued`, beside the
  existing `account.invitation_issued` and `account.reset_issued`, rather
  than as `email.invitation_queued`.
- **Invitation state in the user table.** Shown as a status line (email
  queued, emailed, failed, not sent with its reason, or "No active invitation
  link"), rather than a separate badge.

**Changes from this plan made during step 2:**

- **D-CR4-3.** A deactivated section *keeps* its lead pointer as history,
  rather than clearing it. It grants nothing, because scope reads active
  sections only. On reactivation the former lead resumes unless another lead
  is named. The effect is the one proposed: only management sees an inactive
  section's records.
- **Audit actions.** A section move is audited as `opportunity.transferred`
  with the section in its before/after data, not as a separate
  `opportunity.section_moved`. Leads are appointed through `section.created`
  and `section.lead_replaced`, not a separate `section.lead_assigned`.
  `account.manager_changed` is no longer written, because salespeople's
  reporting lines are derived from section leads.
- **Seeds.** The synthetic fixtures are unchanged, so every earlier test keeps
  describing the same data. Multi-section scenarios are built inside
  `server/tests/sections.test.ts` and `e2e/cr45.spec.ts`.

This document records what Penta asked for, what the code does today, what
must change, and the questions only Penta can answer. Requirement IDs refer
to `docs/Penta_CRM_Requirements.md`; file references are to the current
branch.

---

## 1. Change requests and acceptance criteria

### CR1 — Email invitation after user creation

An administrator creates an account; the person receives an email with a
single-use link, chooses a password and can then sign in.

| ID | Acceptance criterion |
| --- | --- |
| CR1-AC1 | Creating a user queues exactly one invitation email to the account's email address, in the same transaction as the account and its audit events. A retried create (same idempotency key) sends no second email. |
| CR1-AC2 | The email contains a link to `/set-password` carrying a 256-bit single-use token. The raw token is never stored in the database, the job queue, logs or audit data. |
| CR1-AC3 | The link expires after the invitation lifetime (today 72 h). An expired, used, superseded or deactivated-account link is refused with the existing single generic message. |
| CR1-AC4 | Setting a password through the link spends the token, and the account can sign in. Until then it cannot. |
| CR1-AC5 | The administrator can resend an invitation. Resending supersedes earlier links. The user table already shows "Invitation pending" (`invitationPending`). It will also show whether the invitation email was sent, failed or expired, without exposing the link. |
| CR1-AC6 | If email delivery is disabled or fails permanently, the administrator sees that state. The account remains usable through the existing manual "copy link" fallback (subject to decision D-CR1-1). |
| CR1-AC7 | The existing reset-link action ("Reset link") uses the same email path for accounts that already have a password. |

### CR2 — Email notifications, with server configuration and content in the Admin portal

| ID | Acceptance criterion |
| --- | --- |
| CR2-AC1 | An administrator configures the SMTP server (host, port, TLS mode, user name, password, sender name and address, reply-to, enabled flag) on the Administration page. The password is write-only: it is encrypted at rest and never returned by the API, written to logs or recorded in audit data. |
| CR2-AC2 | An administrator can send a test email to an address of their choice. The result is reported and audited. |
| CR2-AC3 | An administrator edits the subject and body of each email template (invitation, password reset, password changed, and each notification type). Only allowlisted placeholders are accepted; unknown placeholders fail validation. The preview uses synthetic sample values, never real commercial records. |
| CR2-AC4 | When an in-app alert is created (follow-up due today, overdue follow-up, tender deadline within 72 h, ownership change), an email for it is queued once per alert. In-app deduplication (BR-070) also deduplicates email. |
| CR2-AC5 | Access is checked again at send time. An alert that is obsolete, resolved or no longer visible to the recipient is not sent (same rule as export delivery). |
| CR2-AC6 | Delivery is retried with backoff through the existing job queue. Permanent failure is recorded with a sanitised error and appears in the job health check (NFR-003). |
| CR2-AC7 | Settings and template changes are versioned (409 on a stale save) and audited in the administrative domain. Administrators gain no commercial access: the delivery log shows template, recipient, status and time, never the message body. |
| CR2-AC8 | No development, test or CI run can reach a real mail server. Production refuses the development capture transport, as it refuses the TEST scanner. |

### CR3 — Users change their own password

| ID | Acceptance criterion |
| --- | --- |
| CR3-AC1 | Every signed-in user (all four roles) can open "Change password" from the account controls in the top bar. |
| CR3-AC2 | The request requires the current password and a new password that meets the existing policy (12–256 characters). A wrong current password fails with a field error. The endpoint is CSRF-protected and rate-limited. |
| CR3-AC3 | On success the password hash changes and `session_version` is bumped. All other sessions end on their next request. The current session continues with a regenerated session id (subject to decision D-CR3-1). |
| CR3-AC4 | The change is audited as `account.password_changed` without any password material. If email is enabled, a "your password was changed" email is sent. |
| CR3-AC5 | An administrator still cannot set or see another user's password; they can only issue a reset link. |

### CR4 — A section lead can lead multiple sections

| ID | Acceptance criterion |
| --- | --- |
| CR4-AC1 | One lead account can be the lead of several active sections at once. |
| CR4-AC2 | Every active section has exactly one active lead at all times. This is enforced by a database constraint, not only by services. Creating or activating a section requires a lead. |
| CR4-AC3 | A lead sees and edits opportunities in every section they currently lead, and nothing else. Losing a section removes access on the next request. |
| CR4-AC4 | Replace lead remains atomic. The candidate may be an existing lead (who gains this section) or a salesperson member of the section (who is promoted). The outgoing lead keeps their other sections. |
| CR4-AC5 | A lead cannot be deactivated, or have their role changed, while they are the only lead of any active section. |
| CR4-AC6 | Follow-up eligibility, transfer task review, alert recipients, team view, dashboards, reports, exports, search and owner lookups all use "sections the actor currently leads". |

### CR5 — A salesperson can belong to multiple sections

| ID | Acceptance criterion |
| --- | --- |
| CR5-AC1 | An administrator assigns a salesperson to one or more active sections. Membership changes are audited and keep their history. |
| CR5-AC2 | Every opportunity belongs to exactly one section. At creation and on transfer, the chosen section must be one of the owner's current sections (or a section the owning lead leads). |
| CR5-AC3 | A salesperson sees only opportunities they own, and only in sections where they are currently a member. Former membership or historical authorship grants nothing. |
| CR5-AC4 | Removing a salesperson from a section is blocked while they own opportunities in it (decision D-CR5-2). A transfer or section move is required first. |
| CR5-AC5 | A multi-section salesperson creating an opportunity picks the section from their own sections. A single-section salesperson's section is filled in automatically, as today. |
| CR5-AC6 | Existing users keep their current single section as their first membership, with no change in what anyone can see. |

### CR6 — Separate Software Procurement workflow (EOI → RFP)

Revised to Penta's step 5 instruction (12 October 2026); the first draft
below it is superseded.

| ID | Acceptance criterion |
| --- | --- |
| CR6-AC1 | A separate Software Procurement area, in the Tender Tracker's patterns, lists procurement cycles. Each cycle is linked to an opportunity and inherits its owner, section, permissions and documents. Existing records are not classified or migrated. |
| CR6-AC2 | Several cycles per opportunity, at most one current; a new cycle only after the current one has ended (for example Cancelled). The route is explicit: EOI then RFP, or the direct RFP exception. |
| CR6-AC3 | Milestones: EOI preparation, EOI submitted, Shortlisted or Not shortlisted, RFP received, Proposal preparation, Proposal submitted, Evaluation, then Awarded, Unsuccessful or Cancelled. Forward only. |
| CR6-AC4 | Milestones never move the opportunity pipeline. A matching stage is offered, and an accepted move follows the existing stage rules (Awarded needs value and date, Lost a reason). |
| CR6-AC5 | Fields cover the EOI (publication, deadline, submission, outcome) and RFP (reference, invitation, clarification and proposal deadlines, submission, outcome), plus submission method, participation decision and reason, separate technical and financial submission, contacts and EOI/shortlist/RFP/proposal/decision documents. Later fields are optional while at EOI, required on advancing. |
| CR6-AC6 | Late submissions are recorded with a note; a deadline cannot move once its submission is recorded. Dates and deadlines follow Asia/Dhaka. |
| CR6-AC7 | Shortlisting is required before the RFP, except the documented, management-only direct RFP, which never carries an EOI. |
| CR6-AC8 | Version checks, retry protection, transactions, audit and secure document storage/scanning are reused. |
| CR6-AC9 | Filters, overdue/upcoming deadlines and stage history. The dashboard, report and export are scoped, with EOI/RFP submissions distinguishable from goods tenders. Notifications are left for a later step. |

First draft (superseded):

| ID | Acceptance criterion (draft; depends on D-CR6-1 to D-CR6-6) |
| --- | --- |
| CR6-AC1 | When creating an opportunity, the user chooses its workflow: Standard tender (today's pipeline) or Software Procurement. Existing records are Standard. |
| CR6-AC2 | A Software Procurement opportunity moves through its own stage sequence (EOI phase, then RFP phase, ending at Awarded or Lost). The same stage-move rules apply: skipped or backward moves need an explanation, Awarded needs a value and date, Lost needs a reason, and only management reopens. |
| CR6-AC3 | Tender records on a Software Procurement opportunity carry a phase (EOI or RFP). The EOI outcome (shortlisted or not) is recorded before an RFP notice is created. There is still at most one current notice per opportunity. |
| CR6-AC4 | The Kanban board, stage filter, stage chart and "Pipeline by stage" report show each workflow's own stages. Active-pipeline, overdue, seven-day and quarterly metrics remain the single definitions in `metrics.ts` and cover both workflows. |
| CR6-AC5 | Access rules are unchanged. The workflow never widens or narrows scope. |

---

## 2. Access rules adopted by these changes

These supersede the single-section wording of FR-002, BR-001, BR-002 and the
§2.1 matrix "Own section" cells. Everything else in the requirements stands.

| Role | Commercial scope | New predicate (`server/policy/scope.ts`) |
| --- | --- | --- |
| Management | All | `true` (unchanged) |
| Section lead | Opportunities in sections they currently lead | `opportunities.section_id IN (SELECT id FROM sections WHERE lead_user_id = actor.id AND active)` |
| Salesperson | Opportunities they own, in their current sections | `owner_id = actor.id AND section_id IN (actor's current memberships)` |
| Administrator | None; administration only | `false` (unchanged) |

Today a salesperson's scope is `owner_id = actor.id` alone. The new
membership condition is defence in depth: if a removal ever left a
salesperson owning a record outside their sections, that record fails
closed. The lead predicate reads `sections.lead_user_id` instead of
`users.section_id`, so historical section membership grants nothing.

The actor, which is rebuilt on every request in `sessionGuard.ts`, will carry
`ledSectionIds` and `memberSectionIds` in place of the single
`sectionId`. `hasCoherentScope` fails closed for a lead with no led section
or a salesperson with no current membership.

---

## 3. Current implementation compared with what is required

### 3.1 CR1 and CR2: invitations, email, notifications

| Area | Today | Required |
| --- | --- | --- |
| Invitation and reset tokens | `account_tokens` (migration 0003). 32 random bytes; only the SHA-256 hash is stored; single use; 72 h invitation and 24 h reset lifetimes. `issueAccountLink` supersedes earlier links (`server/services/accountTokens.ts`) | Reuse unchanged |
| Delivery | The link is shown once in `AccountLinkDialog` (`src/app/components/AdminDialogs.tsx:195`) and copied by the administrator, because "release one sends no email" (§1.3) | Email delivery, with the manual copy kept as a fallback (D-CR1-1) |
| Create user | `createUser` (`server/services/admin.ts:351`) issues the link in the transaction and returns it once; a replay returns `link: null` | Also queue an invitation email in the same transaction. Return `{ user, delivery: 'queued' \| 'manual', link? }` |
| Email code | **None.** No SMTP library, transport, outbox or mail settings exist anywhere | New mail module, settings, templates and delivery log |
| Job queue | `background_jobs` with retry, lease, dedupe key and `SKIP LOCKED` (`server/jobs/queue.ts`); kinds: `notifications.scan`, `notifications.refresh`, `report_export`, `housekeeping` | Add kind `email.send`; reuse the retry, failure and health machinery |
| In-app notifications | `notifications` table with a unique trigger key; four types; recipients via `alertRecipientSql`; generated by the jobs (ADR 0007) | Each new alert also creates an email delivery row and job. Access is rechecked at send time |
| Secret encryption | Only in `scripts/ops/backup-common.ts` (AES-256-GCM, `BACKUP_ENCRYPTION_KEY`), not in the server | A server helper that reuses the same construction with a separate key, `EMAIL_SECRET_KEY`, to protect the SMTP password at rest |
| Admin UI | One Administration page: users, sections, audit (`src/app/pages/AdministrationPage.tsx`); no settings screen | Add "Email delivery" and "Email templates" panels to the same page, using its existing card, table and dialog patterns |

**Why the token is not stored in the outbox.** The current design keeps only
token hashes at rest. Instead of putting a raw link into a queued message,
the `email.send` job for an invitation or reset **issues the token when it
sends**: it calls `issueAccountLink` in the worker's own transaction and then
hands the message to the transport. The create-user transaction records only
"an invitation email is due for user X". A retry issues a new link and
supersedes the previous one, so at most one link is ever valid. The expiry
then counts from the moment of sending.

### 3.2 CR3: change own password

| Area | Today | Required |
| --- | --- | --- |
| Hashing | argon2id (`server/auth/password.ts`) | Reuse |
| Policy | `PASSWORD_MIN_LENGTH = 12`, max 256 (`shared/validation.ts:104`) | Reuse in a new `changePasswordSchema` |
| Self-service change | **None.** The top bar has the name, role and Sign out only (`src/app/layout/ApiShell.tsx:176-200`) | `POST /api/auth/password` and a dialog under the account controls |
| Session revocation | The `session_version` bump is enforced by `sessionGuard.ts:91` | Bump the version, then re-stamp and regenerate the current session. **Done in step 1** |

### 3.3 CR4 and CR5: sections, leads and membership

| Area | Today | Required |
| --- | --- | --- |
| User's section | Scalar `users.section_id`: one section per user | New table `section_memberships` for salespeople. A lead's sections come from `sections.lead_user_id` |
| Section lead | `users.role = 'lead'` in the section, plus a denormalised `sections.lead_user_id`. The only database rule is the partial unique index `users_one_active_lead_per_section` (migration 0001) | `sections.lead_user_id` becomes the single source of truth. The constraint changes from "one lead per section" to "active section ⇒ exactly one active lead" |
| Reporting line | `users.manager_id` of a salesperson is set to the lead by `installLead` | Reporting is derived from membership (the lead of each of their sections). `manager_id` is kept only for a lead's management manager (D-CR5-1) |
| Lead scope | `opportunities.section_id = actor.sectionId` | `section_id IN` the sections the actor leads |
| Sales scope | `owner_id = actor.id` | Plus current membership of the record's section |
| SQL restatements | `userSeesOpportunitySql`, `alertRecipientSql`, `followUpAssigneeScope`, `eligibleOwnerScope`, `ownerFilterOptionScope` and `keepsFollowUpAfterTransfer` all compare `users.section_id` | All change to the led-sections and membership relations. The test that `userSeesOpportunitySql` agrees with `opportunityScope` (`dashboard.test.ts:176`) stays the guard |
| Admin service | `createUser`, `updateUser`, `deactivateUser`, `reactivateUser`, `replaceSectionLead`, `setSectionActive` and `installLead` all assume one section and one lead (`server/services/admin.ts`) | Rewritten around memberships and led sections. They keep `beginAdministrativeChange` first and lock in a fixed order (ADR 0004) |
| Create opportunity | Section must equal `owner.sectionId` (`opportunities.ts:432-447`) | Section must be one of the owner's current sections (or a section the owning lead leads) |
| Transfer | Section is set from `newOwner.sectionId` (`transfers.ts:82`) | The request names `newOwnerId` and `newSectionId` (defaulted when the owner has one section). The section is validated against the new owner's current sections. Lead and management limits are in D-CR4-2 |
| Team view, dashboard workload | Join on `users.section_id`; one section per person | Group by the opportunity's section. A person in two sections appears under each |
| DTOs | `CurrentUserDto.section`, `AdminUserDto.sectionId/sectionName/managerId`, `AdminSectionDto.leadId`, `OwnerOptionDto.sectionId`, `TeamDto.workload[].sectionName` | `sections[]` / `memberSections[]` / `ledSections[]`. Owner lookup returns owner-and-section pairs |
| UI | User dialog: one section select. Create dialog: section read-only, "Set by the owner's section". Shell shows one section name | User dialog: a multi-select of sections, using the existing select and chip styles. Create dialog: section becomes a select when the owner has more than one. Shell lists the user's sections |
| Seeds and tests | 10 seed users, each in at most one section; about 40 tests encode the single-section rules (listed in §7) | Seeds gain a multi-section salesperson and a two-section lead. The encoded tests are updated deliberately, not loosened |

### 3.4 CR6: Software Procurement workflow

| Area | Today | Required |
| --- | --- | --- |
| Workflow | One linear pipeline: `OPPORTUNITY_STAGES` (`shared/enums.ts:8`), PostgreSQL enum `opportunity_stage` | A `workflow` discriminator on `opportunities` and a second stage sequence |
| Stage logic | `PIPELINE_STAGES` order drives `classifyStageMove`, `offersBidSubmittedStage`, `stageMismatch`, `BOARD_LANES`, the two SQL `laneExpression`s (`opportunities.ts:936`, `reports.ts:131`), the stage chart and `M1_CREATABLE_STAGES` | Each of these takes a workflow and uses that workflow's ordered stages |
| Terminal rules | CHECK constraints in migration 0002 name only `awarded` and `lost` | Shared by both workflows; unchanged |
| Tenders | Free-text `procurement_method`; one current notice per opportunity (`tenders_one_current_per_opportunity`); RFP and RFQ appear only as text suggestions | A `phase` (`eoi` / `rfp`) on tenders of software opportunities, and an EOI outcome (shortlisted / not shortlisted) |
| Metrics | `metrics.ts` names only terminal stages | Unchanged; both workflows are included |
| Requirements | §1.1: "not … a procurement-submission … system"; §7.1: procurement method is text "with no embedded procurement-law assumptions" | CR6 tracks Penta's **sales pursuit** of software procurements that run EOI then RFP. It does not submit bids or encode procurement law. Flagged in D-CR6-1 |

---

## 4. Schema, API, permission and UI changes

### 4.1 Planned migrations

Each is additive first (expand, then contract). Each will be applied to a
fresh database and to a copy of the seeded database before it is accepted.
Each ships with a reviewed production SQL script. None exists yet.

**0008 — section membership and multi-section leads (CR4, CR5)**

- `section_memberships`:
  - `id`, `user_id` (FK users), `section_id` (FK sections), `started_at`, `started_by`, `ended_at`, `ended_by`, `end_reason`.
  - Partial unique index `(user_id, section_id) WHERE ended_at IS NULL`.
  - Indexes on `(section_id) WHERE ended_at IS NULL` and `(user_id)`.
  - Rows are never deleted; history is kept.
- Backfill: one open membership for every user with `role = 'sales'` and a non-null `section_id`, active or inactive. Inactive users keep their row so historical owner–section pairs stay valid. `started_at` is the user's `created_at`.
- Sections:
  - `CHECK (NOT active OR lead_user_id IS NOT NULL)`.
  - A deferrable constraint trigger checks that `lead_user_id` points to an active user with role `lead`. This is the first trigger in the schema; the reason is in the ADR.
- Drop `users_one_active_lead_per_section`. A lead is no longer tied to one `users.section_id`.
- A **pre-flight check aborts the migration**, without changing anything, when:
  - an active section has no active lead;
  - `sections.lead_user_id` disagrees with the active `role='lead'` user of that section;
  - any opportunity's section differs from its owner's section.

  The administrator fixes these through the application first. The migration never invents a lead.
- `users.section_id` stays readable during the transition. Code stops reading it in this change. A later contract migration (0011) drops it after verification on staging.

**0009 — email (CR1, CR2, CR3)**

- `email_settings`, a single-row table:
  - `host`, `port`, `security` (`none` / `starttls` / `tls`), `username`, `password_ciphertext` (bytea, AES-256-GCM)
  - `from_name`, `from_address`, `reply_to`, `enabled`
  - `updated_by`, `updated_at`, `version`
- `email_templates`:
  - `key` (unique; `invitation`, `password_reset`, `password_changed`, `follow_up_due_today`, `follow_up_overdue`, `tender_deadline`, `ownership_changed`)
  - `subject`, `body_text`, `enabled`, `updated_by`, `updated_at`, `version`
  - Seeded with neutral default wording by the migration.
- `email_deliveries`:
  - `id`, `template_key`, `recipient_user_id`, `recipient_address` (snapshot at send), `notification_id` (nullable FK), `purpose` (nullable: invitation or reset)
  - `status` (`queued` / `sent` / `failed` / `suppressed`), `attempts`, `last_error` (sanitised), `dedupe_key` (unique)
  - `created_at`, `sent_at`
  - No body is stored.
- Add `email.send` to the job kinds. The kinds are code-level text, so no enum change is needed.
- Grants: the runtime role gets SELECT/INSERT/UPDATE on the three tables, following migration 0001's pattern.

**0010 — Software Procurement workflow (CR6, after decisions)**

- `opportunity_workflow` enum (`standard`, `software_procurement`). `opportunities.workflow NOT NULL DEFAULT 'standard'`; all existing rows become `standard`.
- New `opportunity_stage` values, added with `ALTER TYPE … ADD VALUE`. PostgreSQL 18 allows this inside a transaction, but the new values cannot be used until it commits, so the CHECK that ties a stage to its workflow goes in a second migration file.
- `tenders.phase` (`eoi` / `rfp`, nullable for standard), and an EOI outcome with its date.
- A CHECK that a phase is present only on software-procurement opportunities. This needs a service rule, because PostgreSQL CHECKs cannot see the parent table.

### 4.2 API

| Change | Endpoint |
| --- | --- |
| CR3 | `POST /api/auth/password` `{currentPassword, newPassword}`. CSRF, its own rate limiter, 204, and the current session is regenerated |
| CR1 | `POST /api/admin/users` returns delivery state instead of always returning a link. `POST /api/admin/users/:id/link` takes `{delivery: 'email' \| 'manual'}`. `GET /api/admin/users` adds `invitationState`. Added after the step 4 review: `POST /api/auth/link-status` (what an opened link can do, without spending it), `GET /api/auth/recovery` and `POST /api/auth/forgot-password` ("Forgot your password?", same answer for every address); resends limited per account |
| CR2 | `GET`/`PUT /api/admin/email/settings` (the password is write-only: `{password?: string \| null}`, where absent means unchanged). `POST /api/admin/email/test`. `GET /api/admin/email/templates`, `PUT /api/admin/email/templates/:key` (versioned), `POST /api/admin/email/templates/:key/preview` (synthetic values only). `GET /api/admin/email/deliveries` (paginated: status and recipient, no body). Added after the step 3 review: `POST /api/admin/email/verify` (connection check, sends nothing), `GET /api/admin/email/templates/:key/history` (saved versions, from the audit), `POST /api/admin/email/deliveries/:id/retry` (failed emails only, at most three times, audited) |
| CR4/5 | `PATCH /api/admin/users/:id` accepts `sectionIds[]` for salespeople. `POST /api/admin/sections` requires a lead (existing lead or member to promote). `POST /api/admin/sections/:id/replace-lead` accepts an existing lead. `GET /api/auth/me` returns `sections[]`. `GET /api/lookups/opportunity-owners` returns owner-and-section pairs. The transfer request gains an optional `newSectionId` |
| CR6 | Rebuilt (0011): `GET`/`POST /api/opportunities/:id/procurement`; `GET /api/procurement` (filters: milestone, route, owner, section, `deadline=overdue\|72h\|7d`, `cycles=current\|all`, `q`); `GET`/`PATCH /api/procurement/:id`; `POST /api/procurement/:id/milestone` (retry-safe; optional `pipeline` for the offered stage); `POST`/`DELETE /api/procurement/:id/contacts[/:contactId]` and `.../documents[/:documentId]`; report and export kind `procurement_deadlines`. The 0010 endpoints (`workflow`, tender `phase`, `/eoi-outcome`) are removed |

All new mutations carry version checks, idempotency where they create
something, and an audit event inside their transaction. Each joins the
matrices in `server/tests/m7MutationControls.test.ts`.

New audit actions:

- `account.password_changed`
- `account.section_joined`, `account.section_left`
- `section.lead_assigned`
- `email.settings_updated`, `email.template_updated`, `email.test_sent`
- `email.invitation_queued`
- `tender.eoi_outcome_recorded`
- `opportunity.section_moved`

### 4.3 Permissions

- All rules stay in `server/policy/scope.ts`. Routes still call services, and services compose the predicates.
- Email administration: administrators only (`canAdministerAccounts`). Management and sales get no email settings.
- Template preview and the delivery log never read commercial tables. A notification email is rendered only by the worker, after it checks `alertRecipientSql` again for the recipient.
- Change own password: any authenticated, active account. It never accepts a user id.
- Membership and lead changes: administrators only, and they bump the affected users' `session_version` (SEC-005).

### 4.4 Interface (existing patterns only)

- **Top bar:** "Change password" in the existing account controls, opening a dialog built from the existing `FormBits` fields and `Feedback` messages.
- **Administration page:**
  - The user table gains an invitation-state badge (reuses `ApiBadges`). The user dialog gains a section multi-select for salespeople.
  - Section cards show the lead (who may lead several sections) and members. Section create asks for the lead.
  - New "Email delivery" and "Email templates" panels sit in the same card layout, with the delivery log as a paginated table like the audit table.
- **Opportunity create:** a Workflow select (CR6), and a section select when the owner has more than one section.
- **Board and filters:** a workflow switch above the existing board, using the existing filter chip style. The stage chart and reports label which workflow they show.
- **No new design system, navigation section or page layout.** The demo build (`src/demo`, `src/pages`, `src/components`) is not changed.

---

## 5. Migration and backfill for existing users and records

| Data | Treatment |
| --- | --- |
| Salespeople | One open membership per user with a section, active and inactive. No change to what they see, because all their owned records are already in their section (verified by the pre-flight check) |
| Leads | No row change. Their led section comes from `sections.lead_user_id`. The pre-flight check refuses a database where that pointer disagrees with the user's role and section |
| Sections without an active lead | Migration aborts with a list of them. The administrator appoints a lead, or deactivates the section, through the application first. No lead is invented |
| `users.manager_id` | Kept. It stays meaningful for leads (their management manager). For salespeople it is ignored and cleared in the contract migration |
| `users.section_id` | Kept for one release, no longer read. Dropped in a later migration after staging verification |
| Opportunities | Section unchanged. `workflow = 'standard'` for every existing record |
| Tenders | `phase` null (standard workflow). No change in behaviour |
| Email | Settings row created **disabled**, with no host. Templates are seeded with default wording. No email is sent until an administrator configures and enables delivery. Existing outstanding invitation links remain valid; no backlog of emails is generated for old alerts |
| Sessions | Migration 0008 bumps no session. Scope is equivalent for every existing account before and after, and a test proves it |

Rollback: 0008 and 0009 are reversible while the contract step (dropping
`users.section_id`) has not run. Each migration's runbook entry will state
the exact rollback SQL. Rollback after memberships have been edited loses
those edits, so it must be decided before any multi-section assignment is
made.

---

## 6. Implementation sequence and dependencies

| Step | Work | Depends on | Why this order |
| --- | --- | --- | --- |
| 1 | **CR3** change own password | none | Small, independent, no migration; exercises the account controls the later steps reuse |
| 2 | **CR4 + CR5** membership model: migration 0008, actor, policy, admin service, create/transfer, team/dashboard/report joins, seeds, UI | none | It changes the security core, so it lands before anything else depends on the actor shape. CR4 and CR5 share the same tables and predicates, so they are built together |
| 3 | **CR2 foundation**: migration 0009, encrypted settings, transport (capture in development and test, SMTP in production), `email.send` job, templates, admin panels, test email | step 1 (password-changed template) | CR1 needs the delivery path |
| 4 | **CR1** invitation and reset email, invitation state, manual fallback | step 3 | |
| 5 | **CR2 notifications**: alert-to-email with send-time access recheck | steps 2 and 3 | Recipients depend on the new lead and membership scope |
| 6 | **CR6** Software Procurement workflow: migration 0010, stage engine parameterised by workflow, tender phase, board, reports | decisions D-CR6-* | Largest and least specified; it cannot start until Penta confirms the stages |
| 7 | Regression: full `npm test`, smoke, the three-browser run, build, demo exclusion, production-server check; update the acceptance matrix, ADRs (new ADR 0010 for membership, 0011 for email, 0012 for workflows) and the operations runbooks (SMTP configuration, key rotation) | all | |

Each step is a reviewable commit on this branch. Each step stops for review
if a decision below blocks it.

---

## 7. Test coverage

All tests run against the real application and a real database, with no
stubbed policy, sessions or database, as in the existing suites.

| CR | New or changed tests |
| --- | --- |
| CR3 | Wrong current password (field error, nothing changed); policy limits; other sessions rejected on their next request while the current session continues; rate limit; CSRF; audit contains no password material; administrators cannot change another user's password |
| CR4 | A two-section lead sees both sections and no third section (by list, URL, search, contacts, totals, CSV, notification, document); losing a section revokes access immediately; the database rejects an active section without a lead and a lead pointer to an inactive or non-lead user; Replace lead with an existing lead keeps their other section; the last-lead protection holds across sections |
| CR5 | A multi-section salesperson sees only their owned records in current sections; a record in a section they left is inaccessible even though they still own it (fail-closed check); create rejects a section outside the owner's memberships; membership removal is blocked while they own records there; former membership grants nothing; backfill gives the same scope for every seed account as before (scope-equivalence test) |
| CR1 | Create queues one delivery (and one on replay); the token appears in neither the database, the queue nor logs; the link works once, expires and is superseded by a resend; deactivation spends it; failure and fallback states appear in the UI |
| CR2 | Password is never returned or logged; stale settings or template saves return 409; unknown placeholders are rejected; preview uses no commercial data; a notification email is sent once per alert; access is rechecked at send (transferred record → `suppressed`); retry and final failure feed job health; production refuses the capture transport; administrators still get 403/404 on commercial endpoints |
| CR6 | Stage rules per workflow; a standard stage on a software opportunity is rejected (and vice versa); EOI outcome before an RFP notice; one current notice; metrics reconcile across both workflows (AT-12 extension); board and report per workflow |
| All | Every new audit action is added to `m7MutationControls.test.ts` (the matrix test fails otherwise); the Playwright smoke and M8 browser checks are extended for the change-password dialog, the email panels and the multi-section create flow, with screenshots under `docs/evidence/cr/` |

**Existing tests that encode single-section rules and will be rewritten
deliberately:**

- `administration.test.ts` AT-09 block (lines 215–379)
- `scope.test.ts` scenarios 8–11
- `transfers.test.ts` (lead refused across sections)
- `create.test.ts` scenario 12
- `followUps.test.ts` assignee rules
- `notifications.test.ts` recipients
- `dashboard.test.ts` scope agreement
- `auth.test.ts:247`
- `m7MutationControls.test.ts` transfer and administration races

The single-section assertions become multi-section ones. None is deleted
without a replacement that covers the same risk.

---

## 8. Requirements superseded or affected

| Existing text | Effect |
| --- | --- |
| §1.3 "email and SMS sending" excluded | **Superseded for email** by CR1, CR2 and CR3. SMS stays excluded. FR-040 "Email activity means a manual log" is unchanged |
| FR-002 "a salesperson belongs to one active section and reports to that section's lead" | **Superseded** by CR5: one or more sections; reports to the lead of each |
| FR-002, BR-052 "a section has one active lead"; Plan §3.1 "Each active section has one active lead" | **Kept and strengthened** (CR4): exactly one active lead per active section, enforced in the database. A lead may lead several sections |
| BR-001 "the opportunity's section must equal its owner's section" | **Superseded**: the section must be one of the owner's current sections. "Each opportunity belongs to exactly one section" is kept |
| BR-002 "a section lead's team scope is their section" | **Superseded**: the sections they currently lead. The no-recursion rule is kept |
| §2.1 matrix "Own section" (lead) | Read as "sections they currently lead" |
| BR-051 section-change rules | Adapted to membership removal (D-CR5-2) |
| §12 data model `User.section_id` | Replaced by section memberships and `Section.lead_user_id` |
| FR-090 in-app alerts | Extended with email (CR2). Scheduling, deduplication and recipient rules are unchanged |
| SEC-030 invitation and recovery | Satisfied with email delivery. Single-use, expiring, hashed tokens are unchanged |
| FR-020 stages | Unchanged for the Standard workflow; CR6 adds a second sequence |
| §1.1 "not a procurement-submission system"; §7.1 "no embedded procurement-law assumptions" | **Preserved**: CR6 tracks the sales pursuit only (D-CR6-1) |
| AT-02, AT-03, AT-09 | Extended with multi-section cases; their intent is unchanged |

---

## 9. Unresolved business decisions

These are genuine product choices. The proposed default is what will be
built if Penta confirms it. None weakens access control.

**Email (CR1, CR2, CR3)**

| ID | Question | Proposed default |
| --- | --- | --- |
| D-EM-1 | Which mail server will production use (Penta's Exchange or Microsoft 365, Google Workspace, or a relay service), and with which sender address? | Configured by the administrator; none is assumed. **Sending real email is a deployment decision, like storage and scanning** |
| D-EM-2 | May commercial details (project name, deadline, owner) appear in notification emails, which leave the system? | Minimal: alert type, due date and a link. The project name appears only if Penta approves. The record itself is always opened in the app, where access is rechecked |
| D-EM-3 | Can users opt out of notification emails, per type? | No opt-out in this change; administrators can disable a template globally |
| D-EM-4 | Who is emailed about an alert? (Added in step 5.) Leads and management already receive every alert for their scope in the app | Only the person responsible: the task's assignee, the tender's or procurement cycle's owner, the new owner after a transfer. Leads and management keep the in-app alert. **Step 6** adds, as instructed: a team summary to each current section lead (once, however many sections), a management summary to chosen management accounts only, and delivery-failure counts to administrators |
| D-CR1-1 | When email is enabled, should the administrator still be able to see or copy a link manually? | Yes, as an explicit "Copy link instead" action, audited separately, for when delivery fails |
| D-CR1-2 | Should self-service "Forgot password" on the sign-in page be added now that email exists? It is not in CR1–CR6 | Not added; it can be a separate request. **Superseded on 12 October 2026**: the step 4 instruction asks for it, so it was added (ADR 0002 addendum) |
| D-CR3-1 | After a password change, keep the current session or sign out everywhere? | Keep the current session (regenerated id); end every other session |

**Sections and leads (CR4, CR5)**

| ID | Question | Proposed default |
| --- | --- | --- |
| D-CR4-1 | Can a lead also be a salesperson member of a section they do not lead? | No. One primary role (FR-001): a lead's sections are the ones they lead |
| D-CR4-2 | May a lead move a record between two sections they both lead? FR-070 limits cross-section transfer to management | Yes, when the lead leads both the old and new section; anything else stays management-only |
| D-CR4-3 | When a section is deactivated, who sees its closed historical records? | Management only. The lead pointer is kept as history (changed from the proposal to clear it; see above) and grants nothing, because leads see only active sections they lead |
| D-CR4-4 | When a lead is replaced and leads no other section, do they become a salesperson in it (today's behaviour) or keep the lead role with no section? | Today's behaviour: they become a salesperson member of that section |
| D-CR5-1 | With several leads above one salesperson, is a single "primary" reporting line needed for Team Management? | No primary line; Team Management shows the person under each section |
| D-CR5-2 | Can a salesperson leave a section while they own closed (Awarded or Lost) records there? | No, matching today's BR-051: transfer them, or keep the membership. The alternative is to let closed records stay under an inactive membership, visible to the section's lead and management only |

**Software Procurement (CR6)**

| ID | Question | Proposed default |
| --- | --- | --- |
| D-CR6-1 | Confirm the scope is Penta's sales pursuit of software procurements (tracking EOI and RFP notices, shortlisting and proposals), not bid preparation or submission automation | Sales tracking only |
| D-CR6-2 | What exactly are the stages? | **Superseded by the step 5 instruction**: the milestones are a cycle's own, apart from the pipeline (CR6-AC3). Earlier draft: Identified → EOI Published → EOI Submitted → Shortlisted → RFP Issued → Proposal Preparation → Proposal Submitted → Technical Evaluation → Financial Evaluation / Negotiation → Awarded / Lost |
| D-CR6-3 | Is "not shortlisted" a Lost outcome with its own loss reason, or a separate end state? | Lost with a new preset reason, "Not shortlisted" |
| D-CR6-4 | Is it chosen per opportunity (a Workflow field), or does it need its own navigation entry? | **Superseded by the step 5 instruction**: a separate Software Procurement area and an opportunity tab. (Earlier: a Workflow field and a board switch) |
| D-CR6-5 | Can an opportunity change workflow after creation? (No longer applies: there is no workflow field) | No; it is fixed at creation. Management can correct it only while the record is at its first stage |
| D-CR6-6 | Does the EOI notice stay "current" alongside the RFP notice? | Superseded: EOI and RFP are one cycle's milestones; goods tender notices are unchanged |

---

## 10. Production database changes

**This assessment step changed nothing in any database.** The
implementation steps since added migrations 0008–0012; each has a reviewed
production script in `docs/operations/sql/` (instructions in
`sql_instructions.md`). 0012 is CR2 step 6's. Each implementation step that adds a
migration (0008, 0009, 0010 and the later contract step) will ship with:

- the migration file;
- a production upgrade script with its pre-flight checks;
- the rollback statements;
- a runbook entry.

Production deployment and real data remain out of scope until Penta
authorises them in writing.
