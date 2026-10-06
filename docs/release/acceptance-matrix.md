# Requirement and acceptance matrix

**As of:** 06 October 2026, branch `m8-release-preparation`, end of Milestone 8.
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

## Roles and access (§2)

| ID | Requirement (short) | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-001 | One role each; admin ≠ sales visibility; controlled initial privileged accounts | Complete | `scope.test.ts`, `auth.test.ts`; M8 `ops:create-first-administrator` + `m8Operations.test.ts` | — |
| FR-002 | One lead per section; salespeople report to it; management not an owner | Complete | `administration.test.ts`, migration `0001` unique index | — |
| BR-001 | Eligible owners; section = owner's section; history grants nothing | Complete | `create.test.ts`, `transfers.test.ts`, `activities.test.ts` | — |
| BR-002 | Lead scope = section; no recursive access | Complete | `scope.test.ts` (inactive owner, missing manager) | — |
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
| BR-051 | Deactivation/section change blocked by owned work | Complete | `administration.test.ts` | — |
| BR-052 | Lead replacement atomic; last admin protected; no self-promotion | Complete | `administration.test.ts`, `m7MutationControls.test.ts` (ADR 0004 races) | — |

## Dashboards, reports, notifications, search (§10–11)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| FR-080 | Real clock; Dhaka dates; calendar quarters | Complete | `dashboard.test.ts` | — |
| FR-081 | Charts with populations; one definition everywhere | Complete | `dashboard.test.ts` (AT-12, workload reconciliation strengthened in M8) | — |
| FR-082 | Six reports; filters by role | Complete | `reports.test.ts` | — |
| BR-060 | Named date bases; undated shown | Complete | `reports.test.ts`, `dashboard.test.ts` | — |
| FR-083 | CSV: same rules, all rows, UTF-8, formulas neutralized, audited | Complete | `reports.test.ts` | — |
| FR-090 | Alerts: due today, overdue, 72 h tenders, ownership; schedules; recipients | Partial | `notifications.test.ts`; scan timed at the envelope (2.8–5.9 s) | Penta to confirm: management receives every alert; business day starts 00:00 Dhaka |
| BR-070 | Dedupe; read ≠ complete; transfers/reschedules retire alerts | Complete | `notifications.test.ts`, `m7MutationControls.test.ts` §6 | — |
| FR-091 | Scoped search; safe summaries; paging; admin search | Complete | `search.test.ts`, `e2e/m6.spec.ts` | — |

## Data model and API (§12–13)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| BR-080 | Constraints and indexes | Complete | migrations `0000`–`0007`, `operations.test.ts`; capacity seed validated against them | — |
| BR-081 | Archive keeps references; no cascades; transaction boundaries | Complete | `m7MutationControls.test.ts` (FK refusals, induced failures) | — |
| SEC-020 | Status codes and error shape | Complete | `childScope.test.ts`, `operations.test.ts` | — |
| BR-090 | Versions; stale = 409; serialized related writes | Complete | `m7MutationControls.test.ts` §3, §5 | — |
| BR-091 | Idempotency on create/transfer/submit/finalize | Complete | `m7MutationControls.test.ts` §2; browser retry in `m8.spec.ts` | — |

## Security and operations (§14)

| ID | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| SEC-030 | No public registration; IdP or maintained library; recovery tokens; no demo password in production | Partial | `auth.test.ts`, `administration.test.ts`, `check:production-server`, `security-review.md` | Penta identity provider not decided |
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

## Unresolved, in one list

1. **Production document storage and malware scanning** (SEC-010, AT-13, D-007) — release blocker.
2. **Identity provider and MFA for privileged roles** (SEC-030, SEC-031) — release blocker.
3. **AT-17** user acceptance and visual sign-off — needs Penta's people.
4. Staging environment, and on it: capacity, restore drill, monitoring (NFR-001–003, NFR-010/011, AT-16).
5. Product decisions: follow-up edit/reassign (FR-042); calendar view (FR-043); owner/section/organization selectors on the list (FR-022); who sees directory and export audit (FR-033); alert recipients and business-day start (FR-090); operational targets and retention (NFR-002/003).
