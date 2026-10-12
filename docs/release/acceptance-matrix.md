# Requirement and acceptance matrix

**As of:** 12 October 2026, branch `cr-change-requests`: Milestone 8 plus change
requests CR1–CR6 (`docs/change-requests.md`). Rows changed by a change
request say so. The change requests' own acceptance criteria are in their
own section below. The release-one figures are as of 06 October 2026, except
where a row was updated.
**Source:** `docs/Penta_CRM_Requirements.md` (every FR, BR, SEC, NFR, AT and D
identifier). **Evidence:** test files under `server/tests/` (backend
integration, real app and database), `e2e/` (browser), scripts and reports
named below.

**Status meanings.** **Complete** — implemented and verified by the cited
automated evidence in development/test; it does not mean production-proven.
**Partial** — part is implemented and verified; the rest is missing or
depends on a decision or environment that does not exist yet (stated).
**Unresolved** — not implemented, or needs a decision, environment or people
before it can be. Nothing is marked complete because a file or table exists.

Summary: **Complete 76 · Partial 18 · Unresolved 1** (95 identifiers; every FR, BR, SEC, NFR, AT and D identifier in the requirements, checked by script). Two of the partial items — SEC-010 and SEC-031 (MFA) — contain release blockers.

Change requests: **39 rows. 36 complete, 3 partial.** That is 37 acceptance
criteria plus two email rows (content and real sending). The partial rows
wait on Penta's mail server (D-EM-1) or on confirming a proposed email
default (D-EM-2, D-EM-4); see "Change requests CR1–CR6".

## Roles and access (§2)

| ID | Requirement (short) | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-001 | One role each; admin ≠ sales visibility; controlled initial privileged accounts | Complete | `scope.test.ts`, `auth.test.ts`; M8 `ops:create-first-administrator` + `m8Operations.test.ts` | — |
| FR-002 | One lead per section; salespeople report to it; management not an owner. **Amended by CR4/CR5**: a lead may lead several sections, a salesperson may belong to several, and every active section has exactly one active lead | Complete | `administration.test.ts`, `sections.test.ts`; migration `0008` (CHECK and deferred triggers) | — |
| BR-001 | Eligible owners; history grants nothing. **Amended by CR5**: the record's section is one the owner works in now | Complete | `create.test.ts`, `transfers.test.ts`, `activities.test.ts`, `sections.test.ts` | — |
| BR-002 | No recursive access. **Amended by CR4**: lead scope = the sections they lead now | Complete | `scope.test.ts`, `sections.test.ts` (backfill scope equivalence) | — |
| SEC-001 | Server-side authz; client ids never grant | Complete | `create.test.ts` (forged owner/section), `edit.test.ts`, every service via `server/policy/scope.ts` | — |
| SEC-002 | Scope before filter/search/sort/count/page/aggregate/export | Complete | `scope.test.ts`, `search.test.ts`, `reports.test.ts`, `dashboard.test.ts` (policy agreement) | — |
| SEC-003 | Missing = inaccessible (identical 404); 401/403 rules | Complete | `childScope.test.ts`, `m7MutationControls.test.ts` (queued writes after transfer → same 404) | — |
| SEC-004 | Children inherit scope; contacts via accessible links only | Complete | `contacts.test.ts`, `childScope.test.ts` | — |
| SEC-005 | Changes take effect next request; re-check at download/export | Complete | `auth.test.ts`, `transfers.test.ts`, `m7MutationControls.test.ts` §6 (every channel), `reports.test.ts` (export delivery) | — |

## Screens (§3)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-010 | Approved design; English UI; Unicode/Bangla | Partial | Screenshots `docs/evidence/01–47`, `m8/`; Bangla in `m8.spec.ts`, `activities.test.ts` | Formal visual sign-off against the prototype (AT-17) |
| FR-011 | Sales/management/admin navigation | Complete | `e2e/m6.spec.ts`, `m3.spec.ts`, smoke | — |
| FR-012 | Top bar: scoped search, notifications, account; no role switcher in production | Complete | `search.test.ts`, `notifications.test.ts`, `check:production-server`, demo-exclusion build check | — |
| FR-013 | List/detail/edit states, pagination, filters, back preserves filters, success only after commit, values kept on failure, no double submit, field errors | Complete | `m8.spec.ts` (field error, network failure, retry, back link — fixed in M8), `smoke.spec.ts`, `m2.spec.ts` | — |
| FR-014 | Detail tabs; drill-downs to matching lists | Complete | `m6.spec.ts`, `dashboard.test.ts` (AT-12) | — |
| FR-015 | Desktop first; small-screen table scroll; Kanban table alternative; keyboard, focus, labels, text with colours | Partial | `m8.spec.ts` at 1440/768/360 in Chromium, Edge, Firefox; keyboard and focus; tender colours have text legends | Screen-reader and contrast audit not done (`interface-quality.md`) |

## Opportunities (§4)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-020 | Ten stages; may start at Tender Published | Complete | `create.test.ts`, `transitions.test.ts` | — |
| FR-021 | Dropdown and Kanban changes; explanation for skip/back; card restored on cancel | Complete | `transitions.test.ts`, `e2e/m2.spec.ts` | — |
| FR-022 | Search and filters (organization, stage, status, priority, solution, owner, section, expected award); no delete | Partial | API: all filters, `scope.test.ts`; UI: stage, status, priority, solution, expected-award range, text | The list screen has no organization, owner or section selector (owner/section only as dashboard drill-down chips) |
| BR-010 | Stage and status separate; terminal excludes pipeline | Complete | `transitions.test.ts`, `dashboard.test.ts` | — |
| BR-011 | Awarded value/date; Lost reason/date; Other explained; submission never awards | Complete | `transitions.test.ts`, `tenders.test.ts` | — |
| BR-012 | Management-only reopening with reason; return from hold/cancel with next action | Complete | `transitions.test.ts` | — |
| BR-013 | Next action = earliest open follow-up | Complete | `create.test.ts`, `followUps.test.ts` | — |
| BR-014 | First follow-up with creation; last-task rule; closure cancels tasks | Complete | `followUps.test.ts`, `m2Concurrency.test.ts` | — |

## Organizations and contacts (§5)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-030 | Organization fields, types, parent, no cycles | Complete | `directory.test.ts` | — |
| FR-031 | Shared directory; no private data; scoped counts labelled | Complete | `directory.test.ts` | — |
| FR-032 | Contact fields and validation | Complete | `contacts.test.ts` | — |
| FR-033 | Create/update with audit; duplicate warning; management archive rules | Complete | `directory.test.ts`, `contacts.test.ts`, `m7MutationControls.test.ts` | Directory audit has no viewing screen (ADR 0008; Penta to decide who sees it) |
| BR-020 | Contact created with first link; notes on the link | Complete | `contacts.test.ts` | — |
| BR-021 | Identity edits need every link visible | Complete | `contacts.test.ts` | — |

## Activities and follow-ups (§6)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-040 | Activity types and fields; contact must be linked | Complete | `activities.test.ts` | — |
| FR-041 | Chronological; author kept; amend rules; edit history; no deletion | Complete | `activities.test.ts`, `m7MutationControls.test.ts`; paged log in the UI (M7) | — |
| FR-042 | Follow-up fields; assignee eligibility; assignment grants nothing | Partial | `followUps.test.ts` | §13 "edit … reassign within eligibility": a follow-up cannot be edited or reassigned on its own (only with a transfer) |
| FR-043 | Today/Upcoming/Overdue/Completed/Cancelled; list/calendar; quick create, complete, reschedule | Partial | `followUps.test.ts`, `dashboard.test.ts` (Dhaka boundaries) | The Activities & Follow-ups calendar view is not built (stated in the UI) |
| BR-030 | Past due dates show overdue; no duplicate completion history | Complete | `followUps.test.ts`, `m7MutationControls.test.ts` | — |

## Tenders (§7)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-050 | Multiple cycles; one current notice (constraint) | Complete | `tenders.test.ts` | — |
| BR-040 | Chronology; late note; Not Participating reason; cancelled/superseded give no alerts | Complete | `tenders.test.ts`, `notifications.test.ts` | — |
| FR-051 | Submitted offers stage change; atomic; mismatch shown | Complete | `tenders.test.ts`, `e2e/m5.spec.ts` | — |
| FR-052 | Deadline table and calendar, filters, colour meanings | Complete | `tenders.test.ts`, `e2e/m5.spec.ts` | — |

## Documents and audit (§8)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-060 | Document fields; upload only with edit rights | Complete | `documents.test.ts` | — |
| SEC-010 | Private storage; types; 25 MB; names; keys; no executables/macros; scan before available | **Partial** | `documents.test.ts` with the TEST scanner; `check:production-server` (test scanner refused) | **No production storage or malware scanner** (ADR 0006) — release blocker |
| SEC-011 | Authenticated, scoped downloads; safe headers; no public URLs | Complete | `documents.test.ts` | — |
| FR-061 | Revisions, metadata, management archive with reason | Complete | `documents.test.ts` | — |
| FR-062 | Audit of create/edit, transitions, tasks, transfers, links, revisions, accounts, exports | Complete | `m7MutationControls.test.ts` (matrix + completeness check) | — |
| SEC-012 | Commercial audit scoped; admin audit admin-only; append-only | Complete | `m7MutationControls.test.ts` §7–8, `operations.test.ts`; preserved through restore (restore drill) | — |

## Ownership and administration (§9)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-070 | Transfers by lead (section) and management (across); reason; salespeople cannot | Complete | `transfers.test.ts`, `e2e/m3.spec.ts` | — |
| BR-050 | One transaction; task review; history kept; old access removed | Complete | `transfers.test.ts`, `m7MutationControls.test.ts` (races, channels) | — |
| FR-071 | Admin account/section maintenance; management read-only team view | Complete | `administration.test.ts`, `e2e/m3.spec.ts` | — |
| BR-051 | Deactivation, or leaving a section, blocked by owned work (**CR5**: per section) | Complete | `administration.test.ts`, `sections.test.ts` | — |
| BR-052 | Lead replacement atomic; last admin protected; no self-promotion (**CR4**: an existing lead may take on a section) | Complete | `administration.test.ts`, `sections.test.ts`, `m7MutationControls.test.ts` (ADR 0004 races) | — |

## Dashboards, reports, notifications, search (§10–11)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-080 | Real clock; Dhaka dates; calendar quarters | Complete | `dashboard.test.ts` | — |
| FR-081 | Charts with populations; one definition everywhere | Complete | `dashboard.test.ts` (AT-12, workload reconciliation strengthened in M8) | — |
| FR-082 | Six reports; filters by role | Complete | `reports.test.ts` | — |
| BR-060 | Named date bases; undated shown | Complete | `reports.test.ts`, `dashboard.test.ts` | — |
| FR-083 | CSV: same rules, all rows, UTF-8, formulas neutralized, audited | Complete | `reports.test.ts` | — |
| FR-090 | Alerts: due today, overdue, 72 h tenders, ownership; schedules; recipients. **Extended by CR2**: each alert is also emailed to the person responsible for it | Partial | `notifications.test.ts`, `notificationEmails.test.ts`; scan timed at the envelope (2.8–5.9 s) | Penta to confirm: management receives every alert; business day starts 00:00 Dhaka; email recipients (D-EM-4) |
| BR-070 | Dedupe; read ≠ complete; transfers/reschedules retire alerts | Complete | `notifications.test.ts`, `m7MutationControls.test.ts` §6 | — |
| FR-091 | Scoped search; safe summaries; paging; admin search | Complete | `search.test.ts`, `e2e/m6.spec.ts` | — |

## Data model and API (§12–13)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| BR-080 | Constraints and indexes | Complete | migrations `0000`–`0010`, `operations.test.ts`; capacity seed validated against them | — |
| BR-081 | Archive keeps references; no cascades; transaction boundaries | Complete | `m7MutationControls.test.ts` (FK refusals, induced failures) | — |
| SEC-020 | Status codes and error shape | Complete | `childScope.test.ts`, `operations.test.ts` | — |
| BR-090 | Versions; stale = 409; serialized related writes | Complete | `m7MutationControls.test.ts` §3, §5 | — |
| BR-091 | Idempotency on create/transfer/submit/finalize | Complete | `m7MutationControls.test.ts` §2; browser retry in `m8.spec.ts` | — |

## Security and operations (§14)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| SEC-030 | No public registration; IdP or maintained library; recovery tokens; no demo password in production. **CR1**: links emailed, issued only at send time; **CR3**: own password change | Partial | `auth.test.ts`, `administration.test.ts`, `invitations.test.ts`, `ownPassword.test.ts`, `check:production-server`, `security-review.md` | Penta identity provider not decided |
| SEC-031 | Secure cookies, HTTPS, CSRF, rate limits, expiry, revocation, MFA for privileged roles | Partial | `auth.test.ts`, `check:production-server` | **MFA not implemented** (decision: IdP vs local TOTP); HTTPS is a deployment item |
| SEC-032 | Validation, parameterized SQL, CORS, secrets, no sensitive data in logs or storage | Complete | `create.test.ts`, `m8Operations.test.ts` (request log), `security-review.md` §3 | Independent review recommended |
| NFR-001 | Separate dev/staging/prod; no seed/reset in production | Partial | `operations.test.ts`, demo-exclusion check, `check:production-server`, `docs/operations/environments.md` | Staging and production do not exist |
| NFR-002 | Migrations, runbooks, encrypted consistent backups, validated restore | Partial | `ops:backup`/`ops:restore`, `ops:restore-drill` (local, passes), `docs/operations/*` | Targets unconfirmed; no scheduled backups; **restore not yet validated on staging** |
| NFR-003 | Monitoring; retryable deduplicated jobs; failed scans never publish | Partial | `/api/health/ready`, request log, `jobs:run -- --check` (`m8Operations.test.ts`), `notifications.test.ts`, `documents.test.ts` | No monitoring platform connected; log/audit retention undecided |
| NFR-010 | Load envelope with representative data | Partial | `capacity-and-performance.md`: full envelope generated and loaded | Laptop, not staging; Penta to confirm envelope |
| NFR-011 | p95 < 2 s; first page < 3 s | Partial | Laptop: API p95 160 ms paced / 626 ms saturated; page medians 0.3–1.5 s (one 4.7 s cold start) | Repeat on staging |
| NFR-012 | Chrome/Edge/Firefox; 360/768; accessible dialogs; Bangla/BDT; no false success | Partial | `m8.spec.ts` in Chromium, Edge, Firefox | Chrome-branded browser, real devices and an accessibility audit not done |

## Acceptance tests (§16)

| AT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| AT-01 | Complete | `scope.test.ts`, `documents.test.ts`, `reports.test.ts`, `notifications.test.ts`, `search.test.ts`, `e2e/m6.spec.ts` | Staging repeat |
| AT-02 | Complete | All channels: URL, id, search, contacts, totals, CSV, notification, download | Staging repeat |
| AT-03 | Complete | `scope.test.ts`, `create.test.ts`, `edit.test.ts`, `activities.test.ts` | — |
| AT-04 | Complete | `create.test.ts`, smoke | — |
| AT-05 | Complete | `transitions.test.ts`, `e2e/m2.spec.ts` | — |
| AT-06 | Complete | `followUps.test.ts`, `m2Concurrency.test.ts` | — |
| AT-07 | Complete | `transfers.test.ts`, `e2e/m3.spec.ts` | — |
| AT-08 | Complete | `transfers.test.ts`, `contacts.test.ts`, `m7MutationControls.test.ts` §6 | — |
| AT-09 | Complete | `administration.test.ts` | — |
| AT-10 | Complete | `tenders.test.ts` | — |
| AT-11 | Complete | `dashboard.test.ts`, `followUps.test.ts`, `tenders.test.ts` (frozen clock) | — |
| AT-12 | Complete | `dashboard.test.ts`, `reports.test.ts` | — |
| AT-13 | Partial | `documents.test.ts` with the TEST scanner | Production scanner and storage (ADR 0006) |
| AT-14 | Complete | `notifications.test.ts`, `search.test.ts` | — |
| AT-15 | Complete | `m7MutationControls.test.ts`, `m2Concurrency.test.ts`, smoke (persistence across sessions) | — |
| AT-16 | Partial | Expired/disabled sessions (`auth.test.ts`); no role-switch/reset/seed in production (`check:production-server`); restore brings back relationships and attachments (`ops:restore-drill`, local); failed job retried (`notifications.test.ts`) | Restore and monitoring on staging |
| AT-17 | **Unresolved** | Interface evidence in `interface-quality.md` and screenshots | Penta's visual comparison and role-based UAT (`pilot-handover.md` §4) |

## Demo conflicts resolved (§20.1)

| ID | Status | Evidence |
| --- | --- | --- |
| D-001 | Complete | `transitions.test.ts`, board lanes |
| D-002 | Complete | `dashboard.test.ts` (8 active / BDT 25.85 crore from the demo data, plus the M1 fixture) |
| D-003 | Complete | Seed conversion; `followUps.test.ts` |
| D-004 | Complete | `followUps.test.ts` (management-assigned task) |
| D-005 | Complete | `reports.test.ts` |
| D-006 | Complete | `dashboard.test.ts` |
| D-007 | Partial | Revisions, Cancelled tasks, reopening, concurrency: complete and tested. **Upload scanning, SSO/MFA and backup targets: unresolved production decisions** |

## Change requests CR1–CR6

Acceptance criteria are as written in `docs/change-requests.md` §1. Evidence
is the backend integration suite (real app and database) and the browser
checks named below.

| ID | Criterion (short) | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| CR1-AC1 | Creating a user queues one invitation email, in the same transaction; a replay sends none | Complete | `invitations.test.ts`; audit matrix (`account.invitation_queued`) | — |
| CR1-AC2 | Single-use 256-bit link; the raw token is in no table, queue, log or audit | Complete | `invitations.test.ts` (token hash matches; token absent from deliveries, jobs and audit) | — |
| CR1-AC3 | Expires after 72 h, counted from sending; expired, used, superseded or deactivated links refused alike | Complete | `invitations.test.ts` (injected clock), `administration.test.ts` | — |
| CR1-AC4 | Setting the password activates sign-in | Complete | `invitations.test.ts`, `e2e/cr1.spec.ts` | — |
| CR1-AC5 | Resend supersedes; the user table shows invitation state | Complete | `invitations.test.ts`, `e2e/cr1.spec.ts` | — |
| CR1-AC6 | Disabled or failed delivery is visible; manual "copy link" fallback | Complete | `invitations.test.ts` (failure, then fallback) | — |
| CR1-AC7 | Reset links use the same email path | Complete | `invitations.test.ts` (reset ends sessions) | — |
| CR1 link states | Opening a link never spends it; expired, used (or replaced) and invalid links are explained on opening; "Activate your account" for an invitation | Complete | `accountRecovery.test.ts`; `e2e/accountAccess.spec.ts` (three browsers) | — |
| CR1 purpose and concurrency | An invitation only activates a pending account, a reset only resets an activated one; a disabled account can do neither; two simultaneous uses give one success | Complete | `accountRecovery.test.ts` | — |
| CR1 rate limits | Link checks share the redemption limit; resends limited per account | Complete | `accountRecovery.test.ts` | — |
| CR2-AC1 | SMTP settings managed by the administrator; password encrypted at rest, never returned, logged or audited | Complete | `email.test.ts`, `e2e/cr2.spec.ts` | — |
| CR2-AC2 | Test email, with its result reported and audited | Complete | `email.test.ts`, `e2e/cr2.spec.ts` | Real mail server not yet configured (D-EM-1) |
| CR2-AC3 | Template wording edited; placeholders allowlisted; synthetic preview | Complete | `email.test.ts`, `e2e/cr2.spec.ts` | — |
| CR2-AC4 | Each new alert queues an email once | Partial | `notificationEmails.test.ts` | Recipients follow the proposed D-EM-4 (responsible person only), not yet confirmed |
| CR2-AC5 | Access and validity re-checked at send time | Complete | `notificationEmails.test.ts` (read, rescheduled, transferred → suppressed) | — |
| CR2-AC6 | Retries with backoff; permanent failure recorded and visible in job health | Complete | `email.test.ts`, `invitations.test.ts` | — |
| CR2-AC7 | Settings and wording versioned and audited; administrators gain no commercial access; no message bodies stored | Complete | `email.test.ts`, audit matrix | — |
| CR2-AC8 | No development, test or CI run reaches a real mail server; production refuses capture | Complete | test harness capture folders; `email.test.ts`; `check:production-server` | — |
| CR2 connection check | Connects and signs in without sending; failures reported without credentials | Complete | `email.test.ts` (closed port; capture and none contact nothing); `e2e/cr2.spec.ts` | Against a real server once D-EM-1 is settled |
| CR2 template history | Every saved version in full, newest first; earlier wording can be reused; restore to default | Complete | `email.test.ts`; `e2e/cr2.spec.ts` (`cr2-template-history.png`) | — |
| CR2 delivery states | Queued, accepted by the mail server (never called "delivered"), failed with a sanitised reason, not sent | Complete | `email.test.ts`; `e2e/cr2.spec.ts` | — |
| CR2 controlled retry | A failed email queued again by an administrator, at most three times, re-checked before sending, audited | Complete | `email.test.ts`, audit matrix | Not driven in the browser: a failure cannot be produced in capture mode |
| CR2 job restart | A job left by a stopped worker is taken over after its lease and sends once; a duplicate job sends nothing | Complete | `email.test.ts` | At least once by design: a crash after sending but before recording can repeat one message (ADR 0011) |
| CR2 content | Alert emails carry no commercial detail (D-EM-2) | Partial | `notificationEmails.test.ts` (no names, references, organizations or amounts) | Proposed default, not yet confirmed |
| CR2 real sending | Email reaches real inboxes | Partial | — | **D-EM-1**: Penta's mail server, then `EMAIL_TRANSPORT=smtp` and a test email |
| CR3-AC1 | Every role can change their own password from the top bar | Complete | `ownPassword.test.ts`, `e2e/cr3.spec.ts` | — |
| CR3-AC2 | Current password required; policy; CSRF; per-account rate limit | Complete | `ownPassword.test.ts` | — |
| CR3-AC3 | Other sessions end; this one continues without extending its limit | Complete | `ownPassword.test.ts` | — |
| CR3-AC4 | Audited without password material; "password changed" email while email is on | Complete | `ownPassword.test.ts`, `email.test.ts` | — |
| CR3-AC5 | Administrators still cannot set another user's password | Complete | `ownPassword.test.ts` | — |
| CR3 forgot password | Offered only while email is sent; the same answer for every address; only active, activated accounts emailed, at most once per 15 minutes; the reset ends every session and never reactivates a disabled account; limited per address | Complete | `accountRecovery.test.ts`; `e2e/accountAccess.spec.ts` (three browsers) | Supersedes D-CR1-2 |
| CR3 placement | Change password beside the profile chip in the top bar | Complete | `e2e/cr3.spec.ts` | There is no profile menu in the approved layout; a menu would be a redesign |
| CR4-AC1 | One lead can lead several active sections | Complete | `sections.test.ts`, `e2e/cr45.spec.ts` | — |
| CR4-AC2 | Every active section has exactly one active lead, in the database too | Complete | `sections.test.ts` (CHECK and deferred triggers, runtime role) | — |
| CR4-AC3 | A lead sees the sections they lead now; a lost section is gone on the next request | Complete | `sections.test.ts` | — |
| CR4-AC4 | Replace lead is atomic; an existing lead or a member salesperson | Complete | `sections.test.ts`, `administration.test.ts`, audit matrix | — |
| CR4-AC5 | The only lead of an active section cannot be deactivated or demoted | Complete | `sections.test.ts` | — |
| CR4-AC6 | Assignees, transfer task review, alerts, team, dashboard, search and lookups all use current sections | Complete | `sections.test.ts`, `dashboard.test.ts` (policy agreement), `notifications.test.ts` | — |
| CR5-AC1 | A salesperson is assigned one or more sections; changes audited with history | Complete | `administration.test.ts`, `sections.test.ts`, audit matrix (`account.section_joined`/`left`) | — |
| CR5-AC2 | Each opportunity has exactly one section, one the owner works in | Complete | `sections.test.ts`, `create.test.ts` | — |
| CR5-AC3 | A salesperson sees only own records in current sections; former membership grants nothing | Complete | `sections.test.ts` (fail-closed) | — |
| CR5-AC4 | Leaving a section is blocked while owning records there | Complete | `sections.test.ts`, `administration.test.ts` | — |
| CR5-AC5 | Section chosen at creation when the owner has several | Complete | `sections.test.ts`, `e2e/cr45.spec.ts` | — |
| CR5-AC6 | Existing users keep exactly their current scope | Complete | `sections.test.ts` (backfill scope equivalence); 0008 rehearsal | — |
| CR6-AC1 | Workflow chosen at creation; existing records Standard | Complete | `workflow.test.ts`, `e2e/cr6.spec.ts`; 0010 rehearsal | — |
| CR6-AC2 | Its own stage sequence with the same stage rules | Complete | `workflow.test.ts` (and the database CHECK) | — |
| CR6-AC3 | EOI/RFP phases; EOI outcome before the RFP; one current notice | Complete | `workflow.test.ts`, `e2e/cr6.spec.ts`, audit matrix | — |
| CR6-AC4 | Board, stage chart and pipeline report per workflow; shared metrics cover both | Complete | `workflow.test.ts`, `e2e/cr6.spec.ts` | — |
| CR6-AC5 | Access unchanged by workflow | Complete | Scope is unchanged; `workflow.test.ts` runs under the existing scope rules | — |

## Unresolved, in one list

1. **Production document storage and malware scanning** (SEC-010, AT-13, D-007) — release blocker.
2. **Identity provider and MFA for privileged roles** (SEC-030, SEC-031) — release blocker.
3. **AT-17** user acceptance and visual sign-off — needs Penta's people.
4. Staging environment, and on it: capacity, restore drill, monitoring (NFR-001–003, NFR-010/011, AT-16).
5. Product decisions: follow-up edit/reassign (FR-042); calendar view (FR-043); owner/section/organization selectors on the list (FR-022); who sees directory and export audit (FR-033); alert recipients and business-day start (FR-090); operational targets and retention (NFR-002/003).
6. **Change requests:**
   - Penta's mail server (D-EM-1); real email is off until it is configured.
   - Confirming the email content (D-EM-2) and recipient (D-EM-4) defaults.
7. **Test fixture:** the synthetic tender `DCR/PROC/2026/221` has a fixed
   deadline of 8 October 2026. The `e2e/m5.spec.ts` browser check has failed
   since that date (the application correctly asks for a late-submission
   note). It waits on Penta's choice: dates relative to seeding, or an
   updated fixture.
