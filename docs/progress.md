# Implementation progress

**Current state (05 October 2026):** Milestone 4 complete on branch
`m4-organizations-contacts-activities`, stacked on `m3-transfers-administration`
(open as PR #2, CI green, not yet reviewed). Nothing is merged or deployed.
Milestone 5 has not been started. Sections, newest first: Milestone 4 ·
Milestone 3 · Milestone 2 · Milestone 1 handover review · Milestone 1.

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
