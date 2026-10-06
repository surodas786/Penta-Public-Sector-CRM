# ADR 0007 — Dashboards, reports, exports, search and notifications

**Status:** Accepted for development (Milestone 6).
**Date:** 06 October 2026
**Requirements:** FR-080–FR-083, FR-090, FR-091, BR-060, BR-070, D-002, D-005, D-006, SEC-002, SEC-005, NFR-003, NFR-011, AT-11, AT-12, AT-14 (and the job-retry part of AT-16)

## One definition per metric

§10.1's populations are SQL fragments in `server/services/metrics.ts`:
`activePipeline` (status Active, stage neither Awarded nor Lost),
`overdueFollowUp(today)`, `tenderDueWithin(at, hours)`,
`participatingCurrentNotice`, `awardedInQuarter(today)`. The dashboard, the
reports, the opportunity / follow-up / tender list filters behind every
drill-down and the CSV exports compose these fragments; none restates them.
The follow-up list's Overdue and Today buckets were switched to the same
fragments. Each is applied inside `scopedWhere`, never instead of it, so scope
comes first for every count, sum, sort and page (SEC-002).

Reconciliation is tested per role (AT-12): the Active Opportunities card
equals the `pipeline=active` list total and the opportunities CSV row count,
and their values sum to the card's value; the overdue card equals the
overdue follow-up list with On Hold excluded; the tender card equals the
tracker's `window=7d` list; the awarded card equals the awarded list for the
quarter's dates, summing actual awarded values; workload rows sum to the
totals.

## Decisions within the requirements

| Topic | Decision | Reason |
| --- | --- | --- |
| Overdue card | Counts overdue open follow-ups on records that are **not On Hold**; the On Hold count is shown beside it and in the overdue report | §10.1 "show On Hold separately"; BR-014 keeps On Hold tasks distinct |
| Seven-day tender card | An instant window: deadline ≥ now and < now + 7 × 24 h; current notice, Reviewing or Preparing, record not Cancelled / Awarded / Lost | §10.1 wording; the same rule as the M5 tracker indicator. On Hold keeps its deadlines (BR-014) |
| Awarded this quarter | Currently Awarded, award date within the Dhaka calendar quarter of today, summing **actual** awarded value | §10.1, D-006 |
| Team workload | Active pipeline and open follow-ups grouped by the **current opportunity owner** within scope (not by assignee); inactive owners are listed while they own open records, so rows add up to the totals | §10.1 "grouped by current owner within scope" |
| Stage chart | Working stages: active records and estimates. Awarded: count and actual awarded value; Lost: count and estimate, both limited by the date range on award / lost date | Approved chart; D-006 |
| Date range filter | Applies to Awarded / Lost columns and recent activity, as in the prototype; the KPI cards keep their own fixed definitions | Approved dashboard behaviour; BR-060's explicitly labelled cards |
| Filters | Section filter: management only; owner filter: leads and management. Anything else is **403**, not ignored, so a forged filter is visible as such; permitted filters only narrow scope | FR-082 |
| Pipeline report | One row per board lane (eight stages, Awarded, Lost, On Hold, Cancelled), counts and **estimated** values by **opportunity created date**; summary repeats the active-pipeline figures and shows On Hold separately | D-005, D-006, D-002 |
| Undated records | Every report states its date basis. Where the basis column may be empty (outcome and lost dates are guarded by CHECKs, so the count is 0 in practice) the report returns the count of matching undated records and says whether they are included. The opportunity list returns the number of records an expected-award range hides and offers "Show undated" | BR-060 |
| Sorting | Allowlisted per report column; anything else is 422 | Plan 3.3 |
| Landing page | Sales roles now land on the Dashboard, as in the approved prototype; administrators still land on Administration | §20, FR-011 |

## Exports

Exports are **queued**: `POST /api/exports` validates the filters with the
schema of the screen they came from (report or opportunity list), checks the
FR-082 filter rules, and in one transaction records the export, its job and a
`report.export_requested` audit event (idempotency key required, BR-091). The
job re-reads the requester's account — never the queued request — refuses if
access is gone, runs the report under the **current** scope over every
matching row, and stores the CSV, the row count and the ids of every
opportunity it drew on, auditing `report.exported` with the record count.

Delivery (`GET /api/exports/:id/download`) is for the requester only (anyone
else gets the standard 404). Before sending the file the server re-checks
that the filters are still permitted and that **every** opportunity in the
file is still in the requester's scope; otherwise it answers 409
`export_unavailable` and the export must be run again (SEC-005, NFR-011).
Each download is audited. Files expire after `REPORT_EXPORT_TTL_HOURS`
(default 24) and are removed by housekeeping.

CSV encoding: UTF-8 with BOM, CRLF, a heading row, money as unformatted
decimal strings, dates as YYYY-MM-DD, instants as ISO 8601 with `+06:00` and
the heading labelled "(Bangladesh time, UTC+6)". **Formula injection:** every
text cell that starts with `=`, `+`, `-` or `@` (also after leading spaces,
and their full-width forms) or with a tab, CR or LF is prefixed with an
apostrophe. Generated numbers are not touched. An export that would exceed
`REPORT_EXPORT_MAX_ROWS` (default 50 000) fails with a message; it is never
silently truncated (FR-083 "all matching records").

Export audit events use a new `reporting` domain. They have no opportunity
id, so they never appear in an opportunity's Change History; an audit view
for them is part of M7.

## Search

`GET /api/search` requires 2–100 characters. Each type is filtered by its
own scope **before** matching, counting and limiting: opportunities by
`opportunityScope`; tenders through their opportunity; contacts by
`contactScope` (archived excluded); organizations from the shared directory
(archived excluded). The term is matched literally (`%`, `_`, `\` escaped).
Without `type`, five results per type plus each type's accessible total;
with `type`, one paged type. Summaries contain only what the reader could
open: reference, organization and stage for opportunities; title and
opportunity for tenders; designation and organization for contacts — never
email, phone or notes. Administrators get accounts and sections only
(FR-091); asking an administrator search for a commercial type is 403.

## Notifications

**Types and recipients (FR-090).** Follow-up due today, overdue follow-up,
tender deadline within 72 hours (current, Reviewing / Preparing, record not
closed, deadline still ahead), and ownership change. Recipients are chosen by
`alertRecipientSql` in the policy module: the responsible person (assignee,
or owner for tenders and transfers), the section's lead and management — each
only while they can see the record (`userSeesOpportunitySql`, tested to agree
with `opportunityScope` for every account). The person who made a transfer is
not told about it. Administrators never receive alerts.

> **For review with Penta:** FR-090 says "management sees all permitted
> alerts", which we implemented literally: every management account receives
> every alert in the organization. With 30 concurrent users this is
> manageable but noisy; a narrower rule (e.g. management only for
> management-assigned tasks and ownership changes) would be a requirements
> change.

**Deduplication (BR-070).** `trigger_key` is unique: type, recipient, record
and the due date or the exact deadline instant (or, for ownership, the
opportunity version after the transfer). A repeated or concurrent job inserts
nothing new; generators also skip existing keys and insert in key order.

**Obsolete alerts.** Two mechanisms:

1. *Read-time validity.* Every list, count and mark-read re-checks, in SQL,
   that the alert is unresolved, the recipient still sees the record, and the
   facts still hold (task open with the same due date, still due today or
   overdue; notice still current and participating with the same deadline,
   still ahead; owner unchanged). An obsolete or no-longer-permitted alert is
   therefore never shown or counted, even before anything else runs.
2. *Retirement written down.* Completing, cancelling or rescheduling a task,
   a transfer, any tender change and any stage / status change call
   `alertsChangedInTransaction` inside their own transaction, after the
   opportunity lock: obsolete alerts get `resolved_at` and a resolution, and a
   `notifications.refresh` job is queued to add replacements (e.g. the
   rescheduled date, the new owner's alerts, the ownership alert). The scan
   also retires anything obsolete.

Generation is deliberately **not** done inside business transactions: a scan
inserting alerts takes key-share locks on the referenced rows, and doing both
in one transaction could deadlock with a transfer. Retirement only updates
existing notification rows, so it is safe there.

**Reading.** `POST /api/notifications/:id/read` sets `read_at` (first read
time kept) and touches nothing else — the task, tender and opportunity are
unchanged (tested). An alert that is not the reader's, is obsolete or
concerns a record they can no longer see is the standard 404. There is no
endpoint that creates an alert or chooses a recipient. The runtime role
cannot delete alerts.

## Background jobs

A durable `background_jobs` table (NFR-003). Workers claim the oldest due
job with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`, counting the
attempt as they claim, so several API instances can share the queue. A
failure is retried with exponential backoff (1, 2, 4, 8 … minutes, at most
60); after `max_attempts` (5; 3 for exports) the job stays `failed` with a
log-safe error summary (`describeForLog`, never request data — SEC-032) and
the handler's final-failure step runs (an export is marked failed). A job
left `running` by a crashed worker is reclaimed after a 10-minute lease.

Schedule: `enqueueScheduledJobs` queues one `notifications.scan` per Dhaka
clock hour and one `housekeeping` per Dhaka day, deduplicated by key, so it is
safe from any number of instances. The hourly scan satisfies "tenders at
least hourly"; the first scan after 00:00 Asia/Dhaka is the start-of-day task
scan ("daily at the start of the Dhaka business day"), and later scans pick up
tasks created during the day. **For review:** if Penta's business day should
start later (e.g. 09:00), alerts are already hidden at midnight by the
read-time check and the overdue alert appears at the first scan after it.

Housekeeping removes expired exports, expired idempotency records (closing
the "idempotency cleanup is unscheduled" item from M1–M5) and finished jobs
older than 30 days.

Where it runs: by default inside the API process (`JOBS_ENABLED=true`,
polling every `JOBS_POLL_SECONDS`, and woken immediately after a request
queues work). `JOBS_ENABLED=false` plus `npm run jobs:run` from a scheduler
moves the work elsewhere; `npm run jobs:run -- --status` lists counts and the
latest failures. Monitoring and alerting on failed jobs belong to M8 (NFR-003).

## Not done here

- Notification delivery outside the application (email, SMS) is excluded
  from release one (§1.3).
- An audit view for `reporting` events, and the commercial/administrative
  audit sweep, are M7.
- Capacity measurement of the dashboard and report queries against the
  NFR-010 envelope is M8.
