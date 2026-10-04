# Penta Public Sector Sales CRM

## Software requirements and development specification

Version 1.0 | 03 October 2026 | Product owner Penta | Intended implementation tool Claude Code

This document defines the first production release of Penta's CRM for public sector project sales in Bangladesh. It converts the agreed demo prompts into functional requirements, permission rules, data definitions, backend behavior and testable acceptance criteria. The goal is to give Penta and its developers a shared implementation baseline.

The central rule is that top management sees all sales records, section leads see their section and direct reports, and salespeople see only opportunities they own. Production must enforce this rule on the server for every operation, including files, search, dashboards and exports.

Reference demo supplied by Penta: https://project-penta-public-sector-crm-400.magicpatterns.app

### Document conventions

- Requirements identified by FR, BR, SEC, NFR and AT are testable release requirements.
- The functional baseline is the original CRM prompt, its seven additional rules and the approved public demo interface. Section 20 identifies observed differences and the implementation treatment. Additional production controls are explicitly described as production requirements.
- Suggested stack choices and numerical capacity targets are implementation recommendations, not claims about the demo or existing Penta infrastructure.
- Before changing the approved visual design, compare the exported MagicPatterns project against this specification. Record differences and obtain a product decision for material changes. UI appearance does not override permissions or backend validation.

## 1 Purpose and release scope

### 1.1 Business outcomes

Penta needs one place to record government project opportunities, track project discussions and tender deadlines, assign responsibility, and review section and individual progress. The CRM ends at award or loss. It is not an accounting, procurement-submission or project-delivery system.

An opportunity represents one potential project or procurement package. A tender represents a procurement notice or bid cycle for that opportunity. A contact represents a person at a government organization. An activity records something that happened; a follow-up records something that must happen next.

### 1.2 Included in release one

Authenticated accounts; sections and reporting lines; organizations and contacts; opportunity table and Kanban views; meetings and activity history; follow-ups and reminders; tender records; document uploads; dashboards; reports and CSV exports; ownership transfers; audit history; deployment, backups and automated permission tests.

### 1.3 Excluded from release one

Live e-GP integration, tender scraping or automatic bid submission; email and SMS sending; email inbox synchronization; outreach campaigns; AI recommendations; finance, invoicing and payment collection; sales commission calculation; contract execution and project delivery; native mobile apps; multi-company SaaS tenancy; multi-level recursive reporting hierarchies; offline synchronization. Excel import can be added later and is not part of this accepted demo baseline.

## 2 Roles and reporting structure

### 2.1 Permission matrix

| Capability | Management | Section lead | Salesperson | System administrator |
| --- | --- | --- | --- | --- |
| View sales opportunities | All | Own section | Owned records | None by default |
| Create opportunities | Any section | Own section | Self as owner | No |
| Edit sales records | All | Own section | Owned records | No |
| Reassign opportunities | Across sections | Within own section | No | No |
| View reports and export | All | Own section | Own records | No |
| View organization basics | All | All | All | No sales directory by default |
| View contacts and documents | All | Associated section records | Associated owned records | No |
| Maintain users and sections | No account administration by default | No | No | Yes |
| View reporting and workload | All | Own section | Own profile only | Account structure only |
| View commercial audit history | All | Permitted opportunities | Permitted opportunities | No |
| View account administration audit | No by default | No | No | Yes |

FR-001: Every user has one primary role. Management and system administration are separate responsibilities. Administrative ability must not imply sales-data visibility or permission to impersonate a salesperson. Initial privileged accounts are established through a controlled deployment process.

FR-002: A section has one active section lead. A salesperson belongs to one active section and reports to that section's lead. A section lead may own opportunities in their own section. Management creates opportunities for an eligible section owner; the management account is not a sales owner in this release.

BR-001: Eligible owners are active salespeople and section leads in the chosen section. The opportunity's section must equal its owner's section. Historical creator and activity-author fields do not grant ongoing access.

BR-002: Within this one-level model, a section lead's team scope is their section. All salespeople in the section must report to its lead. Do not quietly allow unrelated users in a section or recursively grant access through arbitrary reporting lines.

### 2.2 Access enforcement

SEC-001: Authentication and authorization occur on the backend. A client-provided owner, section, role or user identifier never establishes permission. Derive scope from the authenticated account and current database relationships.

SEC-002: Apply scope before filtering, searching, sorting, counting, pagination, aggregation and export. Never fetch all records into the browser and filter there. Inaccessible records must not leak through labels, autocomplete, counts, error text, timelines, file URLs or notifications.

SEC-003: Unauthorized object identifiers return the same not-found response as nonexistent identifiers. Missing sessions return unauthorized. A visible record with a forbidden action returns forbidden. Check both the existing record and proposed new associations during mutations.

SEC-004: Child records inherit opportunity access. Contact visibility requires a link to at least one accessible opportunity. In a contact view, return only accessible opportunity links and relationship notes. Attachments are always attached to one opportunity; generic contact notes must not contain opportunity-specific commercial information.

SEC-005: On reassignment, role change, section change or deactivation, authorization changes take effect on the next request. Invalidate affected server caches and refresh client views. Recheck authorization when opening downloads or executing exports, not merely when the request was initially queued.

## 3 Navigation and screen requirements

FR-010: Preserve the approved demo's visual design when exported source is supplied. Baseline styling is a light content area, navy navigation, restrained teal accents, readable tables and the Penta name. The interface is English; stored names and notes must support Unicode, including Bangla.

FR-011: Sales navigation contains Dashboard, Opportunities, Organizations and Contacts, Activities and Follow-ups, Tender Tracker and Reports. Management also sees Team Management. Administrators see an administration dashboard and account-management pages, not commercial dashboard placeholders.

FR-012: The top bar provides scoped search, in-app notifications and account controls. Production uses real authentication and has no public role switcher or reset-demo button. A nonproduction demo may retain these controls with synthetic data only.

FR-013: Each module has accessible list, detail and edit states, pagination, relevant filters and informative empty states. Back navigation preserves list filters. Saving displays confirmation only after server success. Failed saves preserve entered values. Prevent double submission; show field errors next to the corresponding input.

FR-014: Opportunity details contain Overview, Contacts, Activities, Tender, Documents and Change History tabs. Tables and calendars link to the relevant detail page. Cards and charts drill into a matching scoped list, rather than displaying unrelated totals.

FR-015: Desktop is the primary experience. On small screens tables may scroll horizontally and Kanban must offer a usable table alternative. Keyboard navigation, visible focus, labeled form controls and text labels alongside status colors are required.

## 4 Opportunity management

### 4.1 Fields and validation

| Field | Required | Definition and validation |
| --- | --- | --- |
| Project name | Yes | 3 to 200 characters; trimmed |
| Procuring organization | Yes | Existing organization identifier |
| Department or office | No | Up to 200 characters |
| Solution category | Yes | ERP, Custom Software, Data Platform and Analytics, Cloud and Infrastructure, Cybersecurity, System Integration, Other |
| Description | No | Plain text, up to 10000 characters |
| Estimated value | Yes | Nonnegative BDT amount, up to two decimal places; zero means not yet estimated |
| Funding source | No | Plain text, up to 200 characters |
| Owner and section | Yes | Eligible active owner and matching section |
| Pipeline stage | Yes | One of the stages defined below |
| Project status | Yes | Active, On Hold or Cancelled |
| Expected publication date | No | Calendar date, not a timestamp |
| Expected award date | No | Calendar date; warn if earlier than expected publication |
| Priority | Yes | High, Medium or Low; default Medium |
| Linked contacts | No | Contacts relevant to this organization; links require authorization |
| Next action and due date | Conditional | Required for active nonterminal opportunities; maintained through open follow-ups |
| Awarded value and award date | Conditional | Required when stage is Awarded; value positive and date not in the future |
| Loss reason and closed date | Conditional | Required when stage is Lost; reason selected plus optional explanation |
| Status explanation | Conditional | Required when placing On Hold or Cancelled |

Production validation limits above are proposed defaults and must be consistently implemented on both client and server. Monetary values use decimal database types, never floating-point arithmetic. Expected dates may be past dates on imported or overdue records and should be flagged rather than silently changed.

### 4.2 Stage and status model

FR-020: Stages are Identified, Initial Engagement, Requirements Discussion, Awaiting Tender, Tender Published, Bid Preparation, Bid Submitted, Evaluation, Awarded and Lost. New opportunities may begin at Tender Published when discovered through a notice.

BR-010: Stage and status are separate. On Hold and Cancelled preserve the current stage. Awarded and Lost are terminal stages and are excluded from active pipeline calculations even if the separate status remains Active. Do not offer On Hold or Cancelled on terminal opportunities.

FR-021: Stage changes work through dropdowns and Kanban drag-and-drop. If a stage needs extra information, open a form before saving. On validation failure or cancellation, return the card to its original position. Allow stage skipping and backward movement with a mandatory explanation; preserve the entire stage history.

BR-011: Moving to Awarded requires actual awarded value and award date. Moving to Lost requires a reason and closed date. Preset lost reasons are price, technical eligibility, competitor selected, budget unavailable, no bid, and other. Other requires explanatory text. A bid submission never automatically marks an opportunity Awarded.

BR-012: Proposed production rule: only management can reopen an Awarded or Lost opportunity, with a required reason. Keep the previous outcome in immutable history. Reopening returns to a specified nonterminal stage and requires an open follow-up. Returning from On Hold or Cancelled is allowed within ordinary edit scope with a reason and a next action.

FR-022: Provide opportunity search and filters by organization, stage, status, priority, solution, owner, section and expected award date. Hidden owner and section options must not expose inaccessible teams. No hard deletion endpoint is provided for opportunities.

### 4.3 Next action and follow-up consistency

BR-013: Do not store independently editable next-action text on the opportunity and a conflicting task elsewhere. Use open follow-ups as the source of truth. Display the earliest due open follow-up as the next action, with a stable creation-time tie-breaker.

BR-014: Saving a new active nonterminal opportunity creates its first follow-up in the same transaction. Completing its last open follow-up requires a replacement, or a transition to On Hold, Cancelled, Awarded or Lost. Terminal and Cancelled transitions close outstanding follow-ups as Cancelled with a reason, not falsely Completed. On Hold retains tasks and shows them distinctly; its tender deadlines remain visible because a procurement deadline still exists.

## 5 Organizations and contacts

FR-030: Store organization name, organization type, parent organization, location, website and basic notes. Types are Ministry, Department, Directorate, Authority, Public Corporation, Local Government and Other. Names are required, 3 to 200 characters. Prevent self-parenting and cycles.

FR-031: Sales roles may search the shared organization directory. Basic organization information must contain no private contact details or project commentary. Any opportunity counts on an organization page count only accessible records and must be labeled accordingly.

FR-032: Contacts store full name, designation, organization, department or office, optional email and phone. Store phone numbers as strings. Validate email and HTTP or HTTPS website URLs when provided. Support up to 200 characters for names/designations and 50 for phone strings; do not require a phone number or email to create a contact.

BR-020: A contact is linked to one or more opportunities. Initial creation and the first link occur together. Relationship notes belong on the opportunity-contact link, not on the shared contact. A user who can access one linked opportunity must not see the other inaccessible links or notes.

BR-021: Editing shared contact identity fields affects all linked opportunities. Proposed production rule: require visibility of all linked opportunities to edit shared identity fields; otherwise allow the user to edit only their accessible relationship notes and refer identity corrections to management through existing internal communication. No separate correction-request module is required in release one. This prevents a salesperson from altering another team's shared contact unexpectedly. Management resolves duplicate contacts manually; automated merge is excluded.

FR-033: Allow sales users to add organizations and update ordinary shared directory details with an audit trail. Offer duplicate-name warnings. Management may archive an unused organization or contact; do not archive an organization used by an active opportunity, and do not remove a contact's last link without an explicit management archive action.

## 6 Activities and follow-ups

FR-040: Activity types are Meeting, Phone Call, Email, Office Visit, Internal Discussion and Other. Record opportunity, occurrence time, type, subject, notes, optional contact, author and creation time. Subject and occurrence time are required. An optional contact must be linked to the same opportunity. Email activity means a manual log, not a sent email.

FR-041: Activity history is chronological and retains the original author after transfers. Salespeople may amend activities they authored while they still have opportunity access. Section leads and management may amend activities in scope. Store edit history; no destructive deletion of activity history.

FR-042: Follow-ups contain opportunity, title, assignee, due date, priority, state, creator, completion time and optional completion note. States are Open, Completed and Cancelled. Cancelled is a production addition to preserve truthful outcomes. Default the assignee to the current opportunity owner. Preserve the approved demo workflow that also permits tasks for management or the relevant section lead. Eligible assignees must already have opportunity access; assignment never grants record access. A salesperson can assign only to self; a lead can assign to the opportunity owner or self; management can assign to any eligible owner, relevant lead or management account. Task visibility still follows the opportunity scope, with an additional Assigned to filter.

FR-043: Provide Today, Upcoming, Overdue, Completed and Cancelled filters, list/calendar views, quick creation, completion and rescheduling. Due dates for tasks are date-only: an open task is overdue when its due date is earlier than today's date in Asia/Dhaka. Rescheduling records old date, new date, actor and reason.

BR-030: Historical tasks can be entered with a past due date but immediately appear overdue. Completion updates cards and reports after the server commits. Double-clicking completion must not create duplicate history. Completed task author and assignee history are preserved.

## 7 Tender management

### 7.1 Tender fields

| Field | Required | Rule |
| --- | --- | --- |
| Opportunity | Yes | Accessible parent record |
| Tender title and reference | Yes | Title 3 to 200 characters; reference up to 200 |
| Procuring entity | Yes | Organization, with a clear label if different from opportunity organization |
| Procurement method | No | Text; no embedded procurement-law assumptions |
| Notice URL | No | HTTP or HTTPS only; never invent a live notice |
| Publication date | Yes | Date only |
| Clarification deadline | No | Bangladesh timestamp; cannot be later than submission deadline |
| Submission deadline | Yes | Date and time in Bangladesh time |
| Bid status | Yes | Reviewing, Preparing, Submitted or Not Participating |
| Submission time | Conditional | Required for Submitted; future time rejected |
| Current tender flag | Yes | At most one current tender per opportunity |
| Notice state | Yes | Current, Superseded or Cancelled; production addition |
| Responsible owner | Derived | Always the current opportunity owner |
| Notes | No | Plain text |

FR-050: An opportunity may contain multiple tender records for re-tendering or replaced notices. Retain the earlier record and its bid history. Enforce at most one current notice using a database constraint. An opportunity with no active notice may have no current tender.

BR-040: Submission deadline must not precede publication. A claimed submission after the recorded deadline requires a warning and explanatory note; the CRM records facts and does not decide whether a bid was legally accepted. Not Participating requires a reason. Cancelled or superseded notices do not appear in active deadline alerts.

FR-051: When marking the current tender Submitted, offer to move the opportunity to Bid Submitted. If accepted, save both changes atomically. If declined, record the bid status and keep the opportunity stage, with a visible mismatch indicator. Changing a stage to Bid Submitted does not fabricate a tender or submission timestamp.

FR-052: Provide deadline-sorted table, calendar, filters by owner, section, bid status and deadline, and links to opportunity details. Deadline severity for current participating bids is red after deadline, amber within 72 hours, neutral later, and green when Submitted. Not Participating is gray. Text must explain the meaning of each color.

## 8 Documents and audit history

FR-060: Documents belong to one opportunity and have a filename, category, MIME type, size, upload time and uploader. Categories are Tender Document, Requirements, Meeting Notes, Proposal, Correspondence and Other. A user may upload only while authorized to edit that opportunity.

SEC-010: Use private server or object storage. Allow PDF, DOCX, XLSX, PPTX, TXT, CSV, PNG and JPEG by default, up to 25 MB each. Validate extension and content type, sanitize names, use generated storage keys, reject executable and macro-enabled files, and scan before making files available. Limits are configurable production defaults.

SEC-011: Authenticate every preview/download. Prefer streaming through an authorized endpoint; never expose permanent public file URLs. Serve with safe content-disposition and MIME headers. Preview safe formats; other formats use download. No local browser storage is the authoritative file store.

FR-061: Never overwrite documents silently. A replacement creates a new revision linked to the original and retains version history. Authorized sales users can upload revisions; removal is a management soft-archive action with reason. Archived content remains under the same access scope. Destructive purge is outside ordinary application permissions.

FR-062: Audit important create/edit operations, stage/status transitions, task assignment/completion/rescheduling, transfers, contact-link changes, document revisions, account changes and exports. Capture actor, event type, affected entity, timestamp, request identifier and appropriate before/after values. Do not log passwords, tokens or document binaries.

SEC-012: Commercial audit events inherit opportunity scope; administrative audit events are restricted to administrators. Transfer history must preserve prior authors without exposing unrelated section data. Audit entries are append-only; the runtime database role cannot modify or delete them through normal endpoints.

## 9 Ownership and team administration

FR-070: Management may transfer an opportunity across sections; section leads may transfer within their own section. The confirmation shows current and new owner/section and requires a reason. Salespeople cannot change owner or section, including through forged requests. If an Edit form exposes an owner selector to management or a lead, an owner change must invoke the same transfer confirmation, reason, authorization and transaction rules; it cannot bypass the transfer service.

BR-050: Transfer opportunity ownership and review all open follow-up assignments in one transaction. Tasks assigned to the previous owner transfer to the new owner. Tasks assigned to management remain assigned if access continues. Tasks assigned to an old section lead transfer to the new owner if that lead loses access. Preserve completed-task assignment history. Tender ownership is derived. Activities, files and historical task records remain linked to the opportunity, so visibility follows the new scope without copying data. The previous owner loses access unless separately entitled as management or section lead. Shared contacts continue to follow their remaining links.

FR-071: Administrator forms create/edit users, assign roles and sections, set reporting lines, activate/deactivate accounts and maintain sections. Management's Team Management view shows structure and commercial workload, not password or role administration.

BR-051: Block deactivation of a user who owns active nonterminal opportunities. Before changing a salesperson's section, require transfer or reassignment of those opportunities. To preserve all historical section-owner invariants, any remaining historical ownership must also be transferred or the old user record retained as an inactive historical owner without changing its section. Do not simply rewrite the user's section and leave mismatched opportunities.

BR-052: Do not deactivate the only lead of an active section without selecting a replacement. Update the section lead and direct reports in one transaction. A section cannot be deactivated while it has active opportunities. Protect the last active administrator. No account can promote its own role through profile editing; privileged role changes are separately audited.

## 10 Dashboard calculations and reports

### 10.1 Metric definitions

| Metric | Exact calculation |
| --- | --- |
| Active opportunities | Count of accessible opportunities with status Active and stage neither Awarded nor Lost |
| Estimated active pipeline | Sum estimated BDT value for the same active population; not a revenue forecast |
| Overdue follow-ups | Accessible Open tasks with due date before today's Dhaka date; show On Hold separately |
| Tender submissions next seven days | Current noncancelled notices with bid status Reviewing or Preparing and deadlines from now up to but excluding now plus seven days |
| Awarded value this quarter | Sum latest actual awarded value of accessible currently Awarded opportunities whose award date falls in the current Dhaka calendar quarter |
| Team workload | Active opportunities and open tasks grouped by current owner within scope |

FR-080: Default dashboards use the current production clock, not the demo's fixed date. Quarter boundaries are calendar quarters. Store timestamps in UTC and render them in Asia/Dhaka. All date-only calculations use Dhaka calendar dates.

FR-081: Charts show count by stage, value by section for management, team workload for leads/management, next actions, tender deadlines and recent activity. Each chart labels its population; On Hold and Cancelled are separated from active pipeline. Use identical backend query definitions for cards, charts, lists and exports.

FR-082: Reports include pipeline by stage, opportunities by section/owner, overdue follow-ups, upcoming tender submissions, awarded/lost opportunities and lost reasons. Only management receives cross-section filters. Salespeople receive no other-user selector.

BR-060: Date filters have a named basis. Pipeline reports use opportunity created date, matching the demo; the Opportunities screen retains a separately labeled expected-award-date filter; activity reports use occurrence date; follow-ups use due date; tenders use submission deadline; outcomes use award or lost date. Undated opportunities are shown separately rather than silently disappearing. Blank date filters mean all relevant dates, except explicitly labeled current-quarter/seven-day cards.

FR-083: CSV export uses the same access and filter rules as the visible report, exports all matching records rather than only the current page, and includes column headings. Use UTF-8 with spreadsheet-compatible encoding, ISO timestamps plus timezone labels where needed, and unformatted decimal BDT values. Neutralize spreadsheet formula injection in user-entered cells. Audit who exported which report and record count.

## 11 Notifications and search

FR-090: In-app alerts cover follow-ups due today, overdue follow-ups, tender deadlines within 72 hours and ownership changes. A scheduler checks dates at least hourly for tenders and daily at the start of the Dhaka business day for tasks. Leads see their section alerts and management sees all permitted alerts.

BR-070: Deduplicate by recipient, related record, alert type and applicable deadline/date. A read notification does not mark a task complete. Rescheduling or transfer must update relevant alerts and invalidate old access. A notification link rechecks permission; inaccessible or obsolete alerts disappear from the inbox and unread count.

FR-091: Search spans accessible opportunity names, permitted contacts, basic organization names and permitted tender references. Return result type and a safe summary. No attachment full-text indexing is required in release one. Debounce typing; paginate results; require at least two characters. Administrative search is restricted to accounts and sections.

## 12 Logical data model

Use stable internal identifiers such as UUIDs. Foreign keys enforce relationships. Every mutable business entity has created_at, updated_at and a version integer. Timestamp columns are UTC-aware; date fields remain dates. Avoid duplicating derived owner/section values across children.

| Entity | Core fields and relationships |
| --- | --- |
| User | id, full_name, email unique, role, section_id optional, manager_id optional, active, identity_provider_subject or password hash, session version |
| Section | id, name unique, lead_user_id, active |
| Organization | id, name, type, parent_id optional, location, website, basic_notes, archived_at |
| Contact | id, organization_id, name, designation, department, email, phone, archived_at |
| Opportunity | id, reference unique, organization_id, department, solution_category, description, estimated_value numeric, owner_id, section_id, stage, status, priority, funding_source, expected_publication_date, expected_award_date, awarded_value, award_date, loss_reason, loss_note, closed_date, status_note |
| OpportunityContact | opportunity_id and contact_id unique pair, relationship_notes, created_by |
| Activity | id, opportunity_id, occurred_at, type, subject, notes, contact_id optional, author_id |
| FollowUp | id, opportunity_id, title, assigned_user_id, due_date, priority, state, completed_at, completed_by, completion_note, cancelled_at, cancellation_reason |
| Tender | id, opportunity_id, procuring_organization_id, title, reference, procurement_method, notice_url, publication_date, clarification_deadline, submission_deadline, bid_status, submitted_at, is_current, notice_state, notes |
| Document | id, opportunity_id, category, filename, storage_key, MIME type, byte_size, checksum, uploaded_by, scan_state, previous_revision_id, archived_at |
| Notification | id, recipient_id, opportunity_id, optional task/tender id, type, trigger_key unique, message, created_at, read_at, resolved_at |
| AuditEvent | id, actor_id, opportunity_id optional, entity_type, entity_id, action, before_data, after_data, reason, occurred_at, request_id |
| Session | id or token hash, user_id, issued_at, expires_at, revoked_at |

BR-080: Database migrations must enforce unique account emails, valid enum values, nonnegative monetary estimates, unique opportunity-contact pairs and one current tender per opportunity. Guard owner-section consistency in transactional service validation and, where supported, database constraints. Use indexes on section/owner/stage/status, due dates, submission deadlines, foreign keys and audit entity/time columns.

BR-081: Archive fields preserve references. Records associated with historical events must not be cascade-deleted. Model logical document revisions separately from storage bytes. Use transaction boundaries for opportunity plus first task, transfer, bid plus optional stage change, team restructuring and terminal closure.

## 13 Backend and API contract

The developer may choose framework-specific routing, but these operations and behaviors are required. List responses provide items, total permitted count, page and page size. Use a default page size of 25 and maximum 100. Filters and sort keys are allowlisted; unknown or malformed input fails validation.

| Resource | Required operations |
| --- | --- |
| Authentication | Login or SSO callback, logout, current account, session revocation, controlled password recovery where applicable |
| Dashboard | Scoped summaries, charts, next actions and drill-down filters |
| Opportunities | List, create, detail, edit, change stage/status, transfer ownership, contact links and audit history |
| Organizations and contacts | List, detail, create/edit, controlled archive |
| Activities | List by scope/opportunity, create and audited amend |
| Follow-ups | List, create, edit, complete, cancel, reassign within eligibility and reschedule |
| Tenders | List, detail, create/edit, submit, designate current and cancel/supersede notice |
| Documents | Initiate upload, finalize metadata, scan status, list, preview/download, revision and archive |
| Reports | Scoped report data and filtered CSV export |
| Notifications | List, unread count, mark read; no arbitrary recipient posting endpoint |
| Administration | User/section lists and create/edit, role/reporting changes, deactivate/reactivate, admin audit |

SEC-020: Use HTTP 401 for unauthenticated requests, 403 for forbidden actions on visible records, 404 for missing/inaccessible objects, 409 for stale versions or business conflicts, and 422 for field validation. Return a structured error with code, message, field errors where applicable and a request identifier. Do not expose stack traces.

BR-090: Updates include the last-read version. Reject stale writes with 409 and offer reload/reapply. An opportunity transfer and simultaneous task completion must not produce tasks assigned to the old owner. Lock or otherwise serialize related writes inside the transaction.

BR-091: Create/transfer/submit/upload-finalization operations accept an idempotency token or provide equivalent deduplication. A retry after a network failure cannot create duplicate opportunities, documents or audit actions. All successful mutations return canonical stored data and the new version.

## 14 Production security and operations

### 14.1 Authentication and account controls

SEC-030: No public registration. Use Penta's identity provider if available; otherwise use a maintained authentication library and a modern password-hashing algorithm. Invite accounts through an approved process. Password recovery uses single-use expiring tokens and does not disclose account existence. Never implement demo-password authentication in production.

SEC-031: Prefer secure HttpOnly SameSite cookies over browser-readable persistent tokens. Enforce HTTPS, CSRF protection for cookie-authenticated mutations, rate limits on login/recovery and idle/session expiry. Proposed defaults are 30-minute inactivity and 12-hour absolute expiry. Revoke sessions on deactivation or material role changes. Require MFA for privileged roles where the chosen identity service supports it.

SEC-032: Validate and encode user input, use parameterized database access, restrict cross-origin access and keep secrets outside source control. Protect uploads and downloads. Do not store sensitive business data in browser localStorage. Logs may contain request IDs and event summaries but not contact notes, credentials or file contents.

### 14.2 Environments and continuity

NFR-001: Provide development, staging and production configurations with separate databases and file storage. Synthetic seed/reset and user switching are development/staging features only. Automated checks must fail a production build that exposes these controls or seed accounts.

NFR-002: Run versioned migrations and maintain a deployment rollback/runbook. Back up the database and attachments consistently, encrypt backups, and restrict restore access. Proposed initial targets are daily backups, 30-day backup retention, recovery point within 24 hours and recovery time within 4 hours. Validate one full restore before launch and repeat quarterly. Penta must confirm these operational targets.

NFR-003: Monitor uptime, failed requests, background job failures, upload scans and backup completion. Health endpoints must not expose secrets. Notification jobs are retryable and deduplicated; failed scans cannot publish files. Establish log and audit retention settings before launch; do not invent a statutory retention period.

### 14.3 Suggested capacity and quality targets

NFR-010: Proposed first-release test envelope: 100 users, 30 concurrent users, 10000 opportunities and 100000 activities/follow-ups combined. Validate with a representative seeded database rather than promising performance from the UI demo.

NFR-011: Under that envelope, ordinary list/detail/dashboard API responses should achieve p95 below 2 seconds, excluding file transfer and external identity-provider time. First usable page on ordinary office broadband should load within 3 seconds. Larger exports may be queued with progress; authorization must be checked again before delivery.

NFR-012: Support current desktop Chrome, Edge and Firefox, with responsive behavior at 360 px and 768 px. Use keyboard-accessible dialogs, descriptive errors, readable contrast and text status indicators. Test Bangla text storage/search and BDT formatting. A short network outage must not show an unsaved action as successful.

## 15 Recommended implementation approach

This is a proposed architecture to be reviewed against the exported demo and Penta's hosting environment. Prefer a single maintainable application with clear service boundaries over independent microservices for this first release.

- Frontend: reuse the exported MagicPatterns React components where practical. Keep its approved design and replace mock data access through an API adapter.
- Backend: a maintained server framework with centralized authentication, policy checks, validation and transactional services.
- Database: PostgreSQL or another relational database that supports the required constraints and transactions.
- Files: private object storage or a managed private file service, with authenticated downloads and scanning.
- Background worker: scheduled reminders, scans and optional queued exports, with shared database-backed job state.
- Delivery: containerized application where suitable, environment-managed secrets and a CI pipeline for tests and migrations.

An example TypeScript path is React plus a Node server framework, PostgreSQL and a private S3-compatible store. If the exported project already uses another maintained stack, assess reuse first. Select exact versions during implementation from current official documentation and record them in the repository; this document does not prescribe unverified package versions.

## 16 Acceptance tests and traceability

The following scenarios are minimum release gates. Each must be automated where feasible and exercised in staging with at least two sections, two salespeople per section, two leads, management and administration accounts.

### AT 01 Management and administrator separation

Given opportunities in both sections, management sees all sales totals, details and exports. The administrator sees account structure but no commercial data. A direct administrator request for an opportunity or document is denied. Traces FR-001, SEC-001 and SEC-002.

### AT 02 Section isolation

Given Nadia leads Government Applications, she can see her own and Rafiq/Tasnia's opportunities. She cannot obtain Infrastructure and Security records by URL, API ID, search, contacts, totals, CSV, notification or document download. Traces FR-002 and SEC-002 through SEC-004.

### AT 03 Individual isolation

Rafiq can access his own records and cannot access Tasnia's despite sharing a section. Creator status alone does not grant visibility after reassignment. Test forbidden updates and forged owner/section fields, not just hidden UI buttons. Traces BR-001 and SEC-001.

### AT 04 Opportunity creation and next action

Rafiq creates an opportunity and initial follow-up in one save. Missing owner, organization, stage or next action fails with field errors and no partial database records. Nadia and management see the result; Imran does not. Traces FR-020 and BR-013/014.

### AT 05 Stage and status changes

Kanban changes persist. Awarded fails without actual value/date; Lost fails without reason. On Hold preserves stage and leaves the active-value total. A cancelled dialog restores the original card. Only management can reopen terminal opportunities. Traces BR-010 through BR-012.

### AT 06 Follow-up lifecycle

Completing the last open task on an active opportunity requires a replacement or valid status transition. Rescheduling changes overdue calculations on the correct Dhaka date. Terminal closure marks remaining tasks Cancelled. Repeated requests do not duplicate events. Traces BR-013/014 and FR-042/043.

### AT 07 Within-section transfer

Nadia reassigns Rafiq's opportunity to Tasnia. Tasnia gains access, Rafiq loses it, owner-assigned open tasks transfer, eligible management tasks remain assigned and original authors remain. Historical documents and tenders follow scope. A salesperson attempting the same operation receives a forbidden result. Traces FR-070 and BR-050.

### AT 08 Cross-section transfer and shared contacts

Management transfers a project to Imran in Infrastructure and Security. Old team scope is revoked immediately. A contact linked to another Government Applications project shows only the new user's permitted link and relationship notes. Traces SEC-004/005 and BR-050.

### AT 09 Team restructuring and deactivation

Deactivation is blocked when a user owns active opportunities. Moving a salesperson cannot leave owner-section mismatches. Replacing a lead updates direct reports atomically. The last administrator cannot be removed. Traces BR-051/052.

### AT 10 Tender cycles and submission

Re-tendering preserves old notices and permits one current tender. Invalid chronology fails. Submitted requires time and optionally updates the project stage atomically. It never awards the project. Nonparticipating, superseded and cancelled notices produce no deadline warning. Traces FR-050 through FR-052.

### AT 11 Deadline boundaries

Freeze time in tests at Dhaka midnight and around tender deadlines. Verify task date-only overdue logic, 72-hour tender amber logic and the exclusive seven-day window. Production always uses actual time; synthetic demo time is environment-isolated. Traces FR-043, FR-052 and FR-080.

### AT 12 Dashboard and export reconciliation

For every role, dashboard active counts and value equal the corresponding filtered list and export population. Verify quarterly awarded totals use actual awarded values and Dhaka quarter dates. CSV includes all matching pages, excludes inaccessible data and neutralizes malicious formula cells. Traces FR-080 through FR-083.

### AT 13 Upload and download protection

Allowed files upload, scan and download. Oversized, prohibited or unsafe files are rejected or quarantined. A transferred or inaccessible document cannot be obtained by an old link. Revision history preserves the earlier file. Traces SEC-010/011 and FR-061.

### AT 14 Notifications and scoped search

Repeated jobs create one alert per trigger. Read status persists. Rescheduling and transfers remove obsolete alerts and counts. Search never reveals unauthorized record names or contacts. Traces FR-090/091 and BR-070.

### AT 15 Concurrency and persistence

Two users edit the same record; the stale save receives 409 rather than overwriting newer values. Simultaneous transfer/task updates remain consistent. Retried creates produce one record. Reload/login on another device preserves committed server data. Traces BR-090/091.

### AT 16 Production controls and recovery

Expired sessions and disabled accounts lose access. Production contains no role-switch/reset controls or seed credentials. Backup restore brings back record relationships and attachment access. Monitor a failed reminder job and verify retry. Traces SEC-031 and NFR-001 through NFR-003.

### AT 17 Interface and user acceptance

Compare approved demo screens with staging at desktop/tablet/mobile sizes. Every visible control works; unsupported actions are removed or clearly unavailable. Management, one lead and one salesperson complete their daily workflows. Traces FR-010 through FR-015.

## 17 Development sequence and completion evidence

### Milestone 1 Baseline and architecture

Obtain the exported MagicPatterns repository and screenshots of the approved roles/screens. Inventory actual pages, reusable components, mock data and dependencies. Produce a gap list against this specification, architecture decision record and schema/migration plan. Confirm the decisions below; do not rebuild the UI before understanding the export.

### Milestone 2 Authentication and permission foundation

Implement accounts, sections, sessions and central scope policies. Seed synthetic staging users. Deliver passing management/lead/sales/admin isolation tests at API level before connecting all screens.

### Milestone 3 Core sales workflow

Implement organizations, contacts, opportunities, stage/status changes, activities and follow-ups with real persistence and audit. Deliver creation, last-task completion, within-section and cross-section transfer flows.

### Milestone 4 Tender and document workflow

Implement multiple tender cycles, current-notice rules, deadlines, submission, file storage/scanning and protected downloads. Test shared-contact visibility and file revocation after transfers.

### Milestone 5 Reporting and reminders

Connect dashboards, scoped search, reports, CSV exports and notification jobs to shared query definitions. Reconcile all totals and test Dhaka time boundaries.

### Milestone 6 Hardening and release

Run end-to-end, concurrency, permission, capacity and accessibility checks. Complete staging review against the demo, restore testing, deployment/runbook and staff training. Record defects and resolve release blockers before using real sales data.

Completion evidence must include a repository with source and lockfiles; migration scripts; environment-variable example without secrets; synthetic seed script; automated test results; API contract; installation and deployment instructions; backup/restore procedure; account/permission guide; user guide; and a signed-off acceptance checklist. A working UI connected to mock services is not a production release.

## 18 Decisions to confirm before production launch

The defaults in this document allow development to start. Penta should confirm the following before release, and material changes should update the requirements and tests together.

| Decision | Proposed baseline |
| --- | --- |
| Actual sections and reporting lines | One lead per section; direct reports only |
| Privileged responsibilities | Management edits all sales records; administrator manages accounts without commercial access |
| Identity and access | Existing Penta SSO preferred; otherwise maintained local authentication |
| Follow-up responsibility | Demo permits management-assigned tasks; preserve eligible assignment while enforcing opportunity scope |
| Shared contact corrections | Full-link visibility for identity edits; management handles correction requests |
| Reopening terminal projects | Management only with reason |
| Initial hosting and storage | Confirm Penta server/cloud, private storage and scanning service |
| Capacity and recovery | Confirm proposed load envelope and daily backup targets |
| Record retention | Penta defines sales, audit, archived document and backup retention |
| Real-data onboarding | Controlled manual entry first; later import assessed separately |
| Visual implementation baseline | Compare exported demo with this specification before accepting UI changes |

Do not interpret the absence of confirmation as permission to weaken access controls or silently enlarge scope. Record choices as implementation decisions. Unresolved hosting or retention choices do not prevent building core functionality with safe configurable defaults.

## 19 Claude Code implementation instruction

Use the following instruction with this Markdown document and the exported demo repository.

Read Penta_CRM_Requirements.md and inspect the existing MagicPatterns export before changing code. Preserve the approved UI and implement the production backend and persistence described in the requirements. First create a requirement-to-code/test checklist, list gaps between the export and the specification, and propose a short implementation plan. Distinguish functional requirements from recommended stack defaults. Do not infer security permissions from hidden buttons or demo role switching. Start with database migrations, authentication and centralized permission policies, then implement the milestones in order. Enforce permissions on every API, aggregation, search, export and file download. Use server-side transactions for transfers, stage outcomes, initial follow-ups and related tender updates. Write meaningful tests for all acceptance scenarios. Keep synthetic users and reset controls outside production. Do not add AI features, inbox synchronization, procurement automation, finance or commissions. Do not deploy to production, change live permissions or import real customer data without an explicit deployment instruction. Report completed requirements, test results, remaining gaps and commands needed to run the current implementation at the end of each milestone. If an exported design conflicts with the required access model, follow the specification and flag the difference for review.


## 20 Demo screen mapping and implementation differences

The public demo interface was reviewed on 03 October 2026 in management, section lead, salesperson and administrator views. The following mapping records visible functionality and specifies production treatment. It is an interface baseline; the acceptance tests still need to be run against the developed backend.

| Demo screen or behavior | Production requirement |
| --- | --- |
| Dashboard with five metrics, stage cards, workload, recent activity and next actions | Preserve layout and drill-downs; calculate using authorized server queries |
| Opportunities Pipeline and Table, search, filters, CSV and add/edit forms | Preserve; use separate stage/status fields internally and audited server writes |
| Opportunity Overview, Contacts, Activities, Tender, Documents and Change History | Preserve tabs and scoped counts; load only authorized child records |
| Activities List and Calendar, Follow-ups and Activity Log tabs | Preserve; include assigned-user and opportunity-owner filters independently |
| Organization directory with ten fictional organizations and Contacts tab | Preserve shared organization basics and scope-aware counts; do not copy synthetic people into production |
| Tender Table and Calendar with bid/deadline filters and Mark Submitted | Preserve; add tender-cycle integrity, accurate timestamps and private documents |
| Six report options and CSV export | Preserve names and creation-date basis of pipeline report |
| Management Team Management shows workload, reporting structure and transfer flow | Preserve commercial oversight without account-administration rights |
| Administrator dashboard and account table | Preserve sales-data separation, role/section/reporting edits and deactivation checks |
| User switcher, fixed 02 October 2026 date, synthetic labels and reset control | Nonproduction only; replace with real sessions and actual clock |
| Browser-local uploads limited to 1 MB | Replace with private server storage; proposed production limit 25 MB and scanning |
| BDT amounts displayed in full and crore shorthand | Preserve both, with exact decimal values in storage and exports; display timezone as Bangladesh time or UTC+6 rather than ambiguous BST |

### 20.1 Conflicts resolved for implementation

D-001: The demo places On Hold and Cancelled in the stage dropdown and Kanban columns. The later agreed prompt requires separate status. Keep the visible hold/cancel columns as status lanes, but store the prior pipeline stage independently. A card appears in exactly one lane. Returning from hold restores its stage. Do not import an On Hold record without either its prior stage or an explicit mapping decision.

D-002: The observed section dashboard shows nine active opportunities and BDT 27.3 crore, including an On Hold project of BDT 1.45 crore. The later prompt says held opportunities are excluded. The production baseline follows that rule: the same unchanged synthetic section data should show eight active opportunities and BDT 25.85 crore. This is a calculation correction; show held value separately and test the exclusion. Do not hardcode demo totals.

D-003: The demo exposes next-action fields separately from follow-up tasks, and its My Next Actions panel can list both for the same opportunity with slightly different wording. Preserve the form and panel appearance but implement one task source of truth under BR-013. During migration, matching text/date entries can be explicitly linked; distinct entries become separate tasks. Never drop a distinct action automatically. Every active opportunity retains a dated next action without duplicate display of the same task.

D-004: The demo includes a follow-up assigned to management, titled Approve ERP bid submission. Preserve this assignment capability through FR-042 eligibility rules rather than forcing every task to the project owner. Assignment cannot expand visibility. Treat the management task as a task, not a separate approval/signature engine.

D-005: Pipeline report date filtering is labeled Opportunity created date in the demo. Preserve that basis. Expected award filters on the opportunity list remain separate; do not make one unlabeled date filter mean different things.

D-006: Dashboard stage cards use actual awarded value for the Awarded lane, while the pipeline report has a column labeled Estimated value. Preserve the distinction: estimated values in an estimate-labeled report and actual values in awarded-value metrics. Add explicit labels/tooltips rather than forcing the two figures to agree. Scope/population must reconcile; differently defined values need not be identical.

D-007: Document revisions, Cancelled task state, terminal reopening controls, upload scanning, SSO/MFA, concurrency protection and backup targets are production additions. They are not claims about implemented demo behavior. Record implementation choices and test them separately from visual matching.
