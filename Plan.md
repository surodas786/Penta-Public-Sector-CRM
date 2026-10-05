# Penta Public Sector CRM — Development Plan

Revision: 2.0 | Updated: 04 October 2026

## 1. Purpose and authority

Build the approved Penta public sector sales CRM for Bangladesh from the existing MagicPatterns export. Reuse the approved interface while replacing demo storage and simulated permissions with persistent data, real authentication, and server-enforced authorization.

This file replaces the previous development plan. The functional source of truth remains `docs/Penta_CRM_Requirements.md`. Locate that document in the repository before implementation; do not invent missing requirements or silently change its rules. Preserve its requirement identifiers in implementation reports.

The approved visual reference is https://project-penta-public-sector-crm-400.magicpatterns.app. Use the exported source and retained screenshots for repeatable comparisons.

The earlier plan describes a Vite, React, TypeScript and Tailwind application, a `CrmContext.tsx` mock service layer, `useScope.ts`, synthetic fixtures and browser-local storage. These are findings reported by Claude Code, not a fresh repository audit in this revision. Verify the current repository, dependencies, scripts and environment before changing them. Do not assume earlier file counts, line numbers, package versions or local database availability are still accurate.

**Immediate scope: implement Milestone 1 only, run its checks, and present the result for review.** Later milestones define the route to full development. Do not deploy to production or load real customer data under this instruction.

## 2. Development rules

- Preserve the approved navigation, layout, colours, typography and screen structure where practical. Reuse components rather than redesigning the application.
- Make necessary changes for API-backed reads, pagination, validation, loading, errors, session expiry and unavailable features. An unchanged component interface is not a requirement.
- Enforce access in the server and database queries. Browser filters and hidden buttons are convenience controls only.
- Use one maintainable application and one relational database. Avoid microservices, Kubernetes and runtime AI features for this release.
- Keep each milestone on a dedicated Git branch with a reviewable commit or pull request. Preserve a demo baseline commit or tag without overwriting an existing tag.
- Use synthetic data in development and tests. Never put secrets, passwords or live commercial data in source control.
- Record actual commands, results and limitations. Do not mark a requirement complete because a related file or table exists.
- Implement validation, audit events, version checks and deduplication when introducing each mutation. M7 verifies completeness; it is not permission to defer these controls.
- Keep unfinished production features disabled with an accurate explanation. Do not populate them with demo records or fabricated totals.

## 3. Roles and authorization

### 3.1 Record visibility

| Role | Commercial record scope | Account administration |
| --- | --- | --- |
| Management | All sections and all opportunities | No account administration by default |
| Section lead | All opportunities in their own section, including their own | No privileged account administration |
| Salesperson | Opportunities they currently own | No privileged account administration |
| System administrator | No commercial records, commercial totals, contacts, documents or commercial audit events | Users, sections, reporting relationships and administrative audit |

A section lead's commercial scope is `opportunity.section_id = actor.section_id`. Do not add an owner-active or direct-report condition. Deactivating an owner does not hide historical section records from the lead or management. A missing `manager_id` does not shrink the lead's section scope.

Separately, enforce the organizational model through account administration: a salesperson belongs to one active section and reports to that section's active lead. Each active section has one active lead. Do not infer recursive access through arbitrary reporting chains. A malformed account with no valid section must fail closed; do not widen its scope.

### 3.2 Ownership and action permissions

- Eligible owners are active salespeople and section leads in the selected section. Management is not an opportunity owner in this release.
- Salespeople create opportunities for themselves. Leads create for eligible owners in their section. Management creates for eligible owners across sections. Administrators cannot create opportunities.
- Visibility alone does not grant every mutation. Enforce each action using the requirements matrix.
- Within-section transfers are available to the appropriate section lead and management. Cross-section transfers are management-only. Salespeople cannot transfer ownership.
- Never accept client-supplied role, user, section or owner fields as evidence of access. Validate proposed associations against the actor and current database state.
- Historical creator, author and prior owner fields do not grant current access.

### 3.3 Enforcement architecture

Create a centralized server policy module for reusable scope predicates and action checks. Routes call services that apply these policies; routes must not implement competing permission rules.

Apply scope before search, filters, sorting, counts, pagination, aggregates and exports. Lists return only a requested page. Child entities inherit access through their parent opportunity. Contact views expose only accessible links and relationship notes. The shared organization directory contains basic organization information, without private contact details or project notes.

Recheck access on each request, including downloads, export delivery and notification links. Deactivation and material role/section changes revoke sessions; transfers change record access immediately. Client caches must be cleared on logout/account changes and invalidated after relevant mutations.

Use these response rules:

| Situation | Response |
| --- | --- |
| Missing, invalid or expired session | 401 |
| Forbidden action on an accessible record, or forbidden collection | 403 |
| Missing or inaccessible object | 404 |
| Stale version or business conflict | 409 |
| Invalid fields or query parameters | 422 |

Errors use `{code, message, fieldErrors?, requestId}`. Missing and inaccessible objects share the same status, error code, message and response structure. Request IDs remain unique and are excluded from equality comparisons. Do not expose record existence, stack traces or private values.

## 4. Technical architecture

### 4.1 Proposed implementation

Retain the existing React/Vite frontend. Add a TypeScript HTTP server using Express, PostgreSQL, a PostgreSQL driver, Drizzle ORM/migrations and shared Zod validation. Use Vitest and Supertest for backend integration tests. Use a small browser test suite for the critical user flows.

These are implementation choices, not claims that the packages are already installed or approved by Penta. Before installation, check current official documentation for compatibility and supported versions. Commit one lockfile and avoid unnecessary framework upgrades.

Suggested directories:

- `src/api/`: HTTP client and API query adapters.
- `src/contexts/`: authenticated account state and providers.
- `src/pages/`: existing pages plus login/account flows.
- `shared/`: transport types, validation and enum definitions.
- `server/db/`: schema, committed SQL migrations and synthetic seeds.
- `server/auth/`: integration with the chosen authentication solution.
- `server/policy/`: record scope and action authorization.
- `server/services/`: transactional business operations.
- `server/routes/`: HTTP request/response adapters.
- `server/jobs/`: notifications and operational jobs when introduced.
- `server/tests/`: integration tests using a dedicated database.
- `docs/`: requirements, progress, architecture decisions and runbooks.

Keep the existing requirements file if moving it would break references. If moved to `docs/`, update those references in the same commit. Verify the purpose of `src/package.json` before removing it. Remove dependencies only after checking actual imports and build configuration.

### 4.2 Frontend data access

Replace the production `db` snapshot pattern with explicit server-backed reads: paginated opportunity lists, individual details, minimal lookups and later aggregate endpoints. Reuse the context/service layer as an integration point where useful, but change its contract when required.

Do not add `/api/bootstrap` or any equivalent endpoint that returns the entire commercial dataset. Do not repeatedly download every page to rebuild a browser-side snapshot. Server-scoped data must also be bounded and suitable for the screen.

Use request cancellation or stale-response protection when filters or accounts change. Handle 401 centrally, provide clear 403/404 views, display 422 field errors and offer reload/reapply for 409 conflicts. Success feedback appears only after a confirmed server commit. A retry after an uncertain network result must preserve the original idempotency key.

Money is transported as decimal strings and calculated using decimal-safe operations. Use PostgreSQL `NUMERIC(14,2)` for BDT values. Chart conversion to a JavaScript number is allowed only at the display boundary; it must not become the financial source of truth.

### 4.3 Authentication

Follow SEC-030: use Penta's identity provider if one is available and suitable; otherwise use a maintained authentication library with modern password hashing. Do not implement a new custom authentication/session protocol simply to avoid dependencies.

For M1, inspect repository configuration for an existing identity integration. If none is configured, proceed with a documented maintained local authentication solution for development. Keep production identity-provider integration as a recorded deployment decision. Verify the chosen solution's official documentation and document its session/revocation behaviour in an architecture decision record.

Required controls:

- No public registration and no production demo-password login.
- Secure HttpOnly SameSite cookies in HTTPS environments. Development exceptions must be explicit and cannot carry into production.
- CSRF protection for cookie-authenticated mutations, with trusted-origin validation as an additional control. Do not describe SameSite alone as the complete protection.
- Login rate limiting, generic failure messages and parameterized database access.
- Idle expiry and absolute expiry, with proposed defaults of 30 minutes and 12 hours.
- Revocation on logout, deactivation and material privilege changes.
- No credentials or business notes in logs. No persistent browser-readable authentication tokens.
- Approved invitation and single-use expiring recovery flows before launch; complete these in M3 if not needed for the synthetic M1 accounts.
- Privileged-role MFA where supported by the selected identity solution; resolve before launch.

Use a test identity adapter or synthetic local accounts if external identity services cannot be exercised in CI. This does not replace staging verification of the selected production identity integration.

### 4.4 Environments and configuration

Provide separate development, test, staging and production databases/storage. Use restricted runtime database accounts; use a separate migration account for schema changes. The runtime account must not be a PostgreSQL superuser and must not update/delete audit events.

Include documented placeholders in `.env.example` for `DATABASE_URL`, `TEST_DATABASE_URL`, migration connection configuration if separate, `APP_ORIGIN`, `PORT`, `NODE_ENV`, `VITE_DEMO_MODE` and the chosen authentication configuration. Do not expose secrets through `VITE_*` variables. Document the supported Node version and configure consistent local/CI versions.

The real server clock is used from M1. Store instants as UTC-aware timestamps and date-only values as database dates. Format and calculate business dates in `Asia/Dhaka`. Provide an injectable clock for tests. Fixed demo dates belong only to the isolated demo build.

Demo mode uses synthetic data only. Select it explicitly, preferably through a separate development entry/build. Production builds fail if demo controls or synthetic login/reset entry points can be exposed. Client flags are not a server security boundary: production servers must not register demo endpoints or seed accounts.

## 5. Data model and business foundations

Introduce tables incrementally as features require them. M1 must include identity/session storage required by the chosen auth solution, sections/users, basic organizations, opportunities, follow-ups, audit events and durable idempotency records. Defer contacts/activities/tenders/documents/notifications unless a verified M1 dependency requires a minimal table. Do not create all feature endpoints just because tables exist.

Apply UUID primary keys, foreign keys, unique normalized account emails, unique opportunity references, nonnegative money constraints, UTC timestamps and appropriate indexes. Mutable business entities use `created_at`, `updated_at` and `version`. Append-only audit and operational records use the metadata appropriate to their purpose rather than artificial mutable versions.

Opportunities have separate `stage` and `status` from the first migration:

- Stages: Identified, Initial Engagement, Requirements Discussion, Awaiting Tender, Tender Published, Bid Preparation, Bid Submitted, Evaluation, Awarded, Lost.
- Statuses: Active, On Hold, Cancelled.
- On Hold and Cancelled retain the prior stage. Awarded/Lost are terminal regardless of status. Preserve the visible On Hold/Cancelled Kanban lanes through a display mapping.
- Next action is derived from the earliest due open follow-up, with a stable creation-time tie-breaker. Do not maintain a second independently editable next-action field.

M1 creation supports Active, nonterminal opportunities and requires an initial next action. Stage/status transitions and outcome creation are disabled until M2. Seeded outcome records can be read but not generically edited before the relevant workflow is implemented.

When converting fixtures, map legacy IDs to UUIDs consistently across all relationships. Map held/cancelled records to separate status plus their prior stage; if the fixture lacks that stage, document a synthetic-only mapping and verify it against the demo. Reconcile duplicate next-action/task fixtures without losing meaningful tasks. Retain fixture authors and valid task assignments. Never apply a fixture mapping to live data without a separate reviewed migration.

Generate references with a database-safe sequence or equivalent concurrency-safe mechanism. Do not rely on a browser array length or random prefixed demo identifiers.

All business operations requiring multiple writes use one database transaction. Version checks must be part of the update predicate or equivalent locked operation. Durable idempotency records are scoped by actor and operation, record a request fingerprint and safely handle concurrent requests. Reusing a key with a different payload produces 409. Reauthorize replay requests; never replay sensitive stored responses after access is revoked. Document expiry and cleanup.

## 6. Milestone sequence

The original requirements use a broader milestone grouping. The following eight milestones are implementation increments; use requirement and acceptance-test IDs for traceability. An acceptance test may span several increments and remains partial until every relevant scenario passes.

| Milestone | Working result | Main requirement/acceptance coverage |
| --- | --- | --- |
| M1 | Persistent login, permissions, opportunity creation/list/detail/basic edit | FR-001/002/013/020; SEC-001/002/003/005/020/030/031; BR-001/002/013/014/080/090/091; M1 portions of AT-01–AT-04 |
| M2 | Persistent stage/status changes and complete follow-up lifecycle | FR-020/021/042/043; BR-010–014/030; D-001/003; AT-05/06 |
| M3 | Ownership transfers and team/account administration | FR-070/071; BR-050–052; SEC-005/030/031; AT-07/09 and transfer portion of AT-08 |
| M4 | Organizations, contacts, relationship notes and activities | FR-030–033/040/041; BR-020/021; SEC-004; contact portion of AT-08 |
| M5 | Tender cycles and secure documents | FR-050–052/060/061; BR-040; SEC-010/011; AT-10/13 |
| M6 | Server-computed dashboards/reports, CSV, search and notifications | FR-080–083/090/091; BR-060/070; D-002/005/006; AT-11/12/14 plus remaining access-channel scenarios |
| M7 | Complete audit and mutation-control verification | FR-062; SEC-012; BR-090/091; AT-15 |
| M8 | Operational readiness, security, accessibility, capacity and pilot evidence | SEC-030–032; NFR-001–003/010–012; AT-16/17 and complete release regression |

### M2 — Stages, statuses and follow-ups

Implement dropdown and Kanban transitions, required explanations for skipped/backward stages, Awarded value/date, Lost reason/date, management-only reopening with a reason, and return from On Hold/Cancelled with a next action. Use the six lost-reason presets; Other requires explanatory text.

Implement complete/reschedule/cancel follow-up operations. Completing the last open task on an active nonterminal opportunity requires a replacement or valid status/stage transition. Terminal/Cancelled closure cancels open tasks with a reason; On Hold retains tasks distinctly. Persist changes and audit atomically. Failed/cancelled drag operations restore the prior card position. Test concurrent transitions and task completion.

### M3 — Transfers and administration

Transfer opportunities in one transaction with a reason, version and idempotency control. Transfer owner-assigned open tasks appropriately while retaining eligible management-assigned tasks. Preserve original creators/authors. Immediately revoke old commercial scope across records, child data and caches.

Build administrator account/section/reporting controls and management's read-only structure/workload view with the correct commercial scope. Protect the last active administrator, replace a section lead atomically and reject section deactivation while active opportunities remain. Prevent self-promotion through profile edits. Complete invitations/recovery and test revocation. Credentials never appear in management views.

### M4 — Organizations, contacts and activities

Complete the shared basic organization directory, duplicate warnings, archive and parent-cycle guards. Implement contact links to opportunities with uniqueness and link-scoped relationship notes. Contact responses never include inaccessible links or notes. Support a new-contact-and-link operation without exposing unrelated contacts.

Build calls/meetings/email/notes and versioned edits. Historical authors do not grant access. Test shared contacts across sections, transfer effects, Unicode/Bangla storage/search and scoped organization counts.

### M5 — Tenders and documents

Support multiple tender cycles with at most one current tender per opportunity, enforced by a partial unique index. Validate deadline chronology and required fields/reasons. Bid submission may offer a stage change; it must not silently advance or award the project. Deduplicate repeated submissions.

Store documents privately with authenticated, scoped access. Default limit is 25 MB; permitted types are PDF, DOCX, XLSX, PPTX, TXT, CSV, PNG and JPEG. Validate extension/content type, sanitize names, generate storage keys and reject executables/macro-enabled files. Scan before availability; pending/failed/rejected scans cannot be downloaded. Implement revisions, metadata and archival. Test revoked access, forged child IDs and retries during upload finalization. Select storage/scanning infrastructure before enabling the feature; a test scanner is not production scanning.

### M6 — Dashboards, reports, search and notifications

Compute scoped aggregates on the server. Active pipeline excludes On Hold, Cancelled, Awarded and Lost. Preserve the approved reporting names and intentional distinctions between estimated and actual awarded values.

Label date-filter bases: pipeline created date, opportunity expected-award date, activity occurrence date, follow-up due date, tender submission deadline and award/lost outcome date. Handle undated records explicitly. Verify Dhaka midnight/overdue/seven-day/current-quarter behaviour with an injected clock.

Add bounded scoped search, paginated report rows and audited CSV exports with formula-injection neutralization. Large export delivery rechecks access. Notifications deduplicate by recipient, record, type and relevant deadline/date; read state does not complete a task. Transfers/rescheduling invalidate obsolete alerts and unread counts. Jobs are retryable with documented failure handling.

### M7 — Audit and mutation-control sweep

Verify every implemented commercial/admin mutation has the correct append-only audit, actor, request ID, before/after values and reason where required. Separate commercial and administrative audit views. Add pagination and scope checks to history endpoints.

Verify optimistic concurrency and idempotency across create, stage/status, tasks, transfers, activities, tender submission and upload finalization. Test transfer/task races with genuinely concurrent database connections. Check that errors and retries cannot leave partial records or duplicate audit events.

### M8 — Release preparation

Complete security review, production demo exclusion, accessibility, responsive checks, supported desktop browsers, network-failure handling and the full requirement/acceptance matrix. Use representative synthetic capacity data: proposed 100 users, 30 concurrent users, 10,000 opportunities and 100,000 activities/follow-ups. Measure the proposed p95 API target below 2 seconds and first usable page below 3 seconds; report measured conditions rather than guarantees.

Prepare separate staging/production configuration, monitoring, migrations/rollback runbooks, encrypted consistent database/file backups and a demonstrated full restore. Record Penta's confirmation of proposed daily backups, 30-day retention, 24-hour recovery point and 4-hour recovery time. Resolve identity, MFA, hosting, storage/scanning, retention and support ownership before launch. Present pilot evidence for approval before production deployment or live-data migration.

## 7. Milestone 1 — implement now

### 7.1 Repository preparation

1. Read repository instructions and the requirements. Inspect the current branch/status. Preserve unrelated work and the approved demo baseline.
2. Record verified repository/framework/dependency findings in `docs/progress.md`. Correct stale assumptions in this plan without changing product scope.
3. Create a dedicated M1 branch. Add concise project instructions in `CLAUDE.md` referencing the requirements, plan and verification commands.
4. Add shared types/validation, server entry, database connection handling and authentication integration. Document architecture/auth decisions in `docs/adr/`.
5. Provide a committed lockfile, environment example, supported runtime and executable scripts. Use an existing package manager if the repository already has one.

### 7.2 Database and seeds

Create ordered migrations for the M1 tables described in section 5. Apply them to empty development and test databases and verify repeat runs are safe. Configure runtime/migration privileges and append-only audit restrictions.

Seed at least two sections, a lead and two salespeople in each, management and administration. Reuse the demo's fictional names where available. Include opportunities across owners/sections and basic organizations. Seed passwords come from development configuration, never production defaults. The seed/reset command refuses production and checks the target environment/database explicitly.

### 7.3 M1 endpoints

Paths can be adjusted to fit the selected auth solution, but preserve these behaviours and document final paths.

| Method | Endpoint | Behaviour |
| --- | --- | --- |
| POST | `/api/auth/login` | Rate-limited authenticated session establishment, or documented identity-provider flow |
| POST | `/api/auth/logout` | Session revocation; CSRF-protected |
| GET | `/api/auth/me` | Current account, role and allowed account/section metadata |
| GET | `/api/opportunities` | Server-scoped list; page size default 25, maximum 100; allowed filters/sorts; scoped total |
| POST | `/api/opportunities` | Active nonterminal creation, first follow-up and audit in one transaction; idempotency key |
| GET | `/api/opportunities/:id` | Scoped detail plus bounded next-action/history data needed by the implemented view |
| PATCH | `/api/opportunities/:id` | Versioned basic edit with explicit field allowlist and audited changes |
| GET | `/api/organizations` | Paginated/searchable basic directory for sales roles; no commercial/private contact data |
| GET | `/api/lookups/opportunity-owners` | Minimal eligible owners for creation, scoped to the actor's permitted section(s); salesperson sees only self |
| GET | `/api/opportunities/:id/follow-ups` | Scoped, bounded/paginated read needed to display the initial next action |
| GET | `/api/opportunities/:id/history` | Paginated commercial history for accessible opportunities |

Do not expose a general user directory to sales roles. No unrestricted contacts lookup is needed in M1. Use DTOs that omit hashes, sessions and private account fields.

### 7.4 Creation and editing contracts

Creation validates the required opportunity fields against the requirements, including owner, section, organization, category/solution, estimated value, stage and initial follow-up text/due date. Assign the first follow-up to the validated eligible owner for M1.

The opportunity, first follow-up, creation audit and idempotency result commit together. A failed write rolls everything back. Return canonical values, the opportunity ID/reference and version.

Basic PATCH supports only a documented allowlist, such as name, description, category/solution, estimated value, expected award date and priority, subject to actual requirement fields. Never mass-assign a request body. Reject role/owner/section changes as forbidden actions on a visible record; reject unsupported or unknown editable fields with validation errors. Stage/status/outcome/task lifecycle changes use dedicated M2 services and are unavailable in M1. Do not edit next-action text through the opportunity record.

Use row version checks and scoped update predicates. No hard deletion endpoint. Restrict terminal/Cancelled fixture edits until the relevant business workflow exists.

### 7.5 Frontend integration

- Add login/logout and session handling in the approved visual style.
- Implement opportunity list, creation, detail, basic edit, initial follow-up display and creation history through real endpoints.
- Add query pagination, loading/empty/error states and field errors. Clear sensitive caches on logout/session expiry.
- Use minimal organization/owner lookup responses. Do not load full datasets into context.
- Disable not-yet-supported mutations and pages in API mode with a clear unavailable state. Preserve their approved design in the separate synthetic demo.
- Leave production dashboards/reports/notifications unavailable until real server endpoints exist. An administrator gets an administration-only landing page with no commercial placeholders.
- Update misleading prototype security text and use `Bangladesh time (UTC+6)` labels. Record material visual deviations.

### 7.6 Automated M1 gate

Run real integration tests against a separate test database using the restricted runtime role where appropriate. Apply committed migrations before tests. The test harness must reject production execution, missing test configuration and a test URL pointing to the development database. Use dedicated test databases or isolated schemas/workers and documented cleanup.

Do not assume a test's outer transaction rolls back requests using unrelated pool connections. If transaction isolation is used, all participating requests must share the intended connection. Race tests need separate concurrent connections and proper cleanup.

Required scenarios:

1. Failed login does not create a session or disclose account existence; repeated attempts hit the configured rate limit.
2. Every implemented commercial endpoint rejects unauthenticated requests with 401.
3. Logout invalidates the old session. Idle and absolute expiry are verified with the test clock.
4. Deactivation and material role/section changes invalidate affected sessions on the next request.
5. Cookie and CSRF controls are tested; forged-origin/missing-invalid CSRF mutations fail without writes.
6. Management lists both sections and receives the correct scoped total.
7. Administrator commercial collections return 403 and commercial object requests return 404, without commercial values.
8. A lead lists their section only; another section's object is inaccessible.
9. Lead scope includes section records with an inactive owner or missing owner `manager_id`. These fixtures do not legitimize malformed new account creation.
10. A salesperson lists only owned records; another owner's record in the same section is inaccessible.
11. Owner/section lookup labels and values reveal no disallowed teams or private account fields.
12. Forged creation owner/section fields fail with no business writes.
13. PATCH of an inaccessible object returns 404. Owner/section escalation on a visible object returns 403; unsupported fields are rejected.
14. Missing and inaccessible object errors match status/code/message/structure, excluding unique request IDs.
15. Page size above 100, invalid filters/sorts and malformed paging parameters fail with 422; totals never include inaccessible rows.
16. Valid create commits one opportunity, one first follow-up and the required creation audit, with canonical decimal values/reference/version.
17. Missing required fields and an induced transactional failure leave no partial business writes.
18. Sequential and concurrent retries with the same key/payload create one opportunity and one follow-up, without duplicate creation audit.
19. Reusing the same idempotency key with another payload returns 409. Keys are scoped by actor/operation and replay checks current authorization.
20. After salesperson creation, their lead and management can read it; another section cannot.
21. Two edits from the same version cannot both succeed; the stale edit returns 409 and preserves committed values.
22. Money precision/nonnegative rules and Bangla input round-trip correctly. Parameterized search does not bypass authorization.
23. Follow-up/history child IDs cannot bypass parent scope. Response DTOs omit credentials/session fields.
24. Clean migrations/seeds succeed; production seed/reset fails; production build/server checks reject exposed demo controls/endpoints.
25. The runtime database role cannot update/delete audit rows. Secrets and business notes do not appear in error output.

Add a small browser smoke test for login, creation, refresh persistence and logout. Do not duplicate every backend test in the browser. Use measured passing results as the gate; a claimed fixed test count is not evidence.

### 7.7 CI and scripts

Create and verify scripts for development frontend/server, server/frontend build, typecheck, lint, integration tests, browser smoke tests, migrations and development seeds. Document exact names and requirements in the README. The overall build must include server TypeScript compilation, not just Vite assets.

GitHub CI uses the committed lockfile, the documented Node version and a separate PostgreSQL test service. Run clean installation, migrations, typecheck, lint, integration tests, browser smoke tests and production build/demo-exclusion checks. CI secrets must not use production credentials.

Any commands in the README must refer to scripts that actually exist and were exercised. Do not instruct the user to run the previous plan's commands before implementing their scripts. Database creation is an administrator setup action; normal application execution uses a restricted account.

### 7.8 Manual review and completion

With API mode enabled:

1. Log in as a salesperson, create an opportunity and see the committed detail and initial follow-up.
2. Refresh the browser and restart the application server. The data remains in PostgreSQL.
3. Log in as management and the correct lead; confirm access. Log in as another salesperson in the same section and another section's user; confirm denial through both URL and API.
4. Log in as administrator; confirm the administration-only landing page and denied commercial API access.
5. Rapidly retry creation and simulate an uncertain network response; verify deduplication and no false success.
6. Edit with an outdated version; verify 409 and a usable reload/reapply flow.
7. Confirm logout/session expiry clears the prior account's cached data.
8. Compare the implemented screens at 1440 px, 768 px and 360 px against the approved design. Validate keyboard use and readable validation errors.
9. Open the explicit synthetic demo build; confirm the approved demo remains available without connecting it to production data.

M1 is complete only when the implemented flow works, the automated checks pass, the manual results are recorded, no full-data snapshot endpoint exists, and all incomplete features are accurately identified. Full AT-01/02/03 coverage of exports, documents, search and notifications remains pending until those features exist.

## 8. Reporting, review and next step

At each milestone, update `docs/progress.md` with:

- Branch/commit and files changed.
- Implemented behaviour and requirement IDs, separating partial from complete coverage.
- Commands actually run, pass/fail summaries and unresolved failures.
- Local startup steps and synthetic accounts, with passwords supplied outside committed reports.
- Database migrations and rollback implications.
- Screenshots or browser evidence for implemented flows and relevant visual changes.
- Known limitations, pending production decisions and the next scoped task.

If a check cannot run, state the reason and leave it incomplete. Do not fabricate output or silently lower the gate. Continue fixing implementation failures within the authorized milestone. Ask only when a missing decision prevents meaningful progress or changes agreed product scope.

After M1, present the result and stop before implementing M2. Review the working flow, permission tests and remaining gaps. Once instructed to continue, build M2 on top of the reviewed implementation.

## 9. Instruction to Claude Code

Read repository instructions, this Plan.md and docs/Penta_CRM_Requirements.md. Verify the current repository and environment, preserve unrelated work and the approved demo, and create a dedicated branch. Implement Milestone 1 only according to section 7. Follow the server-side permissions, maintained authentication, bounded API reads, transactional creation, concurrency, idempotency and audit rules in this plan. Run the required checks and fix failures. Update the README, architecture decisions and progress report with actual results and startup instructions. Report the commit, implemented behaviour, test evidence and limitations. Stop after M1 for review. Do not deploy to production or use real sales data.
