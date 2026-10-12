# Pilot handover

**Date:** 06 October 2026, updated 12 October 2026 for change requests
CR1–CR6 · **Branch:** `cr-change-requests` (from `m8-release-preparation` and
its fixes, nothing merged) · **For:** Penta's project owner, the pilot
users and whoever will host the system.

**Readiness:** ready for a **synthetic-data pilot and user-acceptance testing**
on a developer machine or a staging environment that Penta provides. **Not
ready for production or real sales data**: three release blockers (§6) need
Penta's decisions, and staging verification has not happened because no
staging environment exists.

## 1. Running it locally

Prerequisites: Node 22+ (developed on 24, see `.nvmrc`), Docker Desktop,
Git. Windows: pick ports outside the reserved ranges (`netsh interface ipv4
show excludedportrange protocol=tcp`).

```bash
git clone <repository> && cd Penta-Public-Sector-CRM
git checkout m8-release-preparation
npm ci
cp .env.example .env          # then set SESSION_SECRET and CSRF_SECRET (see the file)
npm run db:up                 # PostgreSQL 18 in docker, roles created on first start
npm run db:migrate && npm run db:migrate:test
npm run db:seed               # synthetic fixtures; refuses production
npm run dev:server            # API on http://localhost:4800 (with the job worker)
npm run dev                   # web on http://localhost:5173
```

Optional: `npm run dev:demo` serves the approved MagicPatterns prototype
(browser-only, synthetic, no API) for side-by-side comparison.

## 2. Running it on staging (when Penta provides one)

Follow `docs/operations/` in order: environments.md (variables, roles,
hosting shape) → deployment-and-migrations.md §1–2 and §5 →
monitoring.md → backup-and-restore.md (schedule backups, run a restore drill
there). Use `NODE_ENV=production`. Create the first administrator with
`npm run ops:create-first-administrator -- --name "…" --email …` and deliver
the printed link out of band; create everyone else from the Administration
page. Load synthetic pilot data only. With no scanner configured, uploaded
documents stay unavailable by design.

## 3. Synthetic accounts (local seed only)

Every account's password is the development value `SEED_DEFAULT_PASSWORD` in
your `.env` (documented in `.env.example`). These accounts exist only in the
development and test databases; production refuses the seed.

| Account | Role | Sees |
| --- | --- | --- |
| `arif.rahman@example.com` | Management | Every section; Team Management; reopening; cross-section transfers |
| `nadia.islam@example.com` | Section lead, Government Applications | Her section, including her own records |
| `farhan.ahmed@example.com` | Section lead, Infrastructure and Security | His section |
| `rafiq.hasan@example.com` | Salesperson, Government Applications | Only the records he owns |
| `tasnia.karim@example.com` | Salesperson, Government Applications | Only hers |
| `imran.hossain@example.com` | Salesperson, Infrastructure and Security | Only his |
| `sadia.akter@example.com` | Salesperson, Infrastructure and Security | Only hers |
| `admin@example.com` | System Administrator | Accounts, sections, administrative audit — no commercial data |
| `shuvo.barua@example.com` | Inactive salesperson | Cannot sign in (historical owner) |
| `mehjabin.chowdhury@example.com` | Salesperson with no manager set | Fixture for the section-scope rule |

The capacity dataset (`npm run capacity:seed`, database `penta_crm_capacity`)
has 100 further synthetic accounts (`cap.*@example.com`) for performance work
only.

## 4. Role-based UAT scenarios (AT-17)

Each scenario: sign in as the account, do the steps, compare with the
expected result, note anything that differs from the approved prototype.
Record pass/fail with the date and the person.

### Salesperson — `rafiq.hasan@example.com`

1. Dashboard shows only your figures; click **Active Opportunities** — the list shows the same number.
2. **Opportunities → New**: create a record with a Bangla name and a value like 12,345,678.90; the first next action is required. Refresh: it is still there; the value reads ৳ 1,23,45,678.90.
3. Open it: move the stage forward on the board; try skipping two stages (an explanation is required); cancel a drag — the card returns.
4. **Log Activity** (a phone call with a contact); add a follow-up; complete your only follow-up — you must add the next one.
5. Upload a PDF on the Documents tab (development scanner); download it.
6. Try to open Tasnia's record by URL (ask the facilitator for the link): "Not available".
7. Search for another section's project name: nothing.
8. Disconnect the network, save an edit: an error, never "saved"; reconnect and save again.

### Section lead — `nadia.islam@example.com`

1. Dashboard and Reports show Government Applications only; team workload lists your people.
2. Reassign one of Rafiq's records to Tasnia with a reason. Rafiq (in another browser) loses it on his next click; Tasnia gains it; open tasks moved.
3. Reports → Export CSV: the file has every matching row, Bangla intact, values unformatted.
4. Notifications bell: open an alert — it does not complete the task.

### Management — `arif.rahman@example.com`

1. Dashboard across both sections; filter one section; values match the list.
2. Transfer a Government Applications record to Imran (Infrastructure and Security). Nadia loses it at once; the shared contact shows only permitted links.
3. Reopen an Awarded record with a reason and a new next action.
4. Team Management: structure and workload, no passwords or role controls.
5. Archive a document with a reason; it remains readable.

### System Administrator — `admin@example.com`

1. Administration only; no Dashboard, Reports or commercial search results.
2. Add a salesperson (invitation link shown once); open the link in a private window, set a password, sign in.
3. Try to deactivate someone who owns open opportunities: refused with the reason.
4. Replace a section lead; the administrative audit lists the role changes and each "Reporting line changed".
5. Type an opportunity URL: "Not available".

### Change requests CR1–CR6

Run these after the role scenarios above. Set `EMAIL_TRANSPORT=capture` on the
local server, so emails are written as files to `EMAIL_CAPTURE_DIR`
(`./var/mail-outbox` in `.env.example`) and never sent.

1. **CR3. Change your own password** (any account).
   1. In the top bar, choose **Change password**.
   2. A wrong current password is refused.
   3. A correct change keeps you signed in.
   4. Another browser signed in as the same person is signed out on its next
      click.
   5. A "Password changed" email is captured.
2. **CR4. A lead leads two sections** (administrator, then lead).
   1. In **Administration → Sections and reporting lines**, use **Replace lead** to make Nadia the
      lead of Infrastructure and Security as well.
   2. Nadia now sees both sections' records, dashboards and reports.
   3. The previous lead loses that section's records on their next click.
   4. Deactivating a section's only lead is refused.
3. **CR5. A salesperson in two sections** (administrator, then salesperson).
   1. Add Infrastructure and Security to Rafiq's sections.
   2. Rafiq's **New opportunity** form now asks for the section.
   3. Create a record for him in that section, then try to remove him from it:
      refused while he owns records there, open or closed (D-CR5-2).
      Transfer the record first; then the removal succeeds and nothing moves
      with it.
4. **CR1/CR3. Links and "Forgot your password?"** (any account, email on).
   1. On the sign-in page, choose **Forgot your password?** and enter your
      address. The same message appears for any address.
   2. The captured email holds a link. Opening it shows "Choose a new
      password"; opening it again after saving shows "This link has already
      been used".
   3. Any other session you had is signed out.
5. **CR1. Invitation by email** (administrator).
   1. Turn email delivery on in **Administration → Email delivery**.
   2. Add a user. The status line says the invitation was emailed.
   3. The captured email holds the link, and the link works once.
   4. **Copy link** instead gives a manual link and cancels the queued email.
6. **CR2. Email settings, templates and alerts** (administrator, then
   salesperson).
   1. Send a test email.
   2. Edit the "Follow-up due" wording, preview it, then restore the default.
   3. Run `npm run jobs:run` after a follow-up falls due. The owner, and only
      the owner, receives one email: a link and a date, no commercial detail.
   4. The delivery log lists it without the message body.
7. **CR6. Software Procurement** (salesperson).
   1. Create an opportunity with **Workflow: Software Procurement**.
   2. Record an EOI notice and mark it submitted (the stage offered is EOI
      Submitted).
   3. Record the EOI outcome as Shortlisted and move the stage.
   4. Record the RFP and continue to Proposal Submitted.
   5. On a second record, record "Not shortlisted": it closes as Lost, with
      the reason Not shortlisted.
   6. The board's Workflow switch shows the software lanes.

### Everyone

- Use the keyboard only for one full task; focus is always visible.
- Use a phone-width window (360 px) and a tablet width (768 px): no sideways page scrolling; menu behind the menu button.
- Leave the browser idle for 30 minutes: you are signed out on the next action.

## 5. Known limitations (pilot)

| Limitation | Effect | Reference |
| --- | --- | --- |
| Documents use a development TEST scanner and local storage | Fine for a synthetic pilot; **not** for real files | ADR 0006 |
| No MFA; local accounts only | Privileged accounts protected by password only | security-review.md §5 |
| Follow-ups cannot be edited or reassigned individually | Reassignment happens only with an ownership transfer | FR-042 |
| No calendar view for Activities & Follow-ups | The Tender Tracker calendar exists | FR-043 |
| No organization, owner or section selector on the Opportunities list | Owner/section filters reachable from dashboard drill-downs and reports | FR-022 |
| No screen for directory or export audit | Recorded, not viewable | ADR 0008 |
| Alert emails go only to the responsible person and carry a link and dates, no commercial detail | Management still receives every alert in the app; no per-person opt-out | D-EM-2, D-EM-3, D-EM-4 (change-requests.md) |
| No SMS | Excluded | §1.3 |
| Email is sent only once Penta's mail server is configured | Until then `EMAIL_TRANSPORT=none` (nothing sent) or `capture` (local files, refused in production) | D-EM-1, ADR 0011 |
| Management receives every alert in the app; business day starts 00:00 Dhaka | May be noisy | M6 decisions |
| The Software Procurement workflow is fixed when the record is created | To change it, close the record and create a new one | D-CR6-5, ADR 0012 |
| At 360 px the search box shows only "Se…" | Cosmetic | interface-quality.md |
| Performance measured on a laptop | Staging figures pending | capacity-and-performance.md |

## 6. Deployment blockers — need Penta's decision or approval

| # | Blocker | Owner | What unblocks it |
| --- | --- | --- | --- |
| 1 | **Production document storage and malware scanning** | Penta (IT / security) | Choose private object storage and a scanning service; then integration, tests and review (ADR 0006) |
| 2 | **Identity provider and MFA for privileged roles** | Penta (IT) | Penta SSO with MFA, or approval to build and review local TOTP for administrators and management |
| 3 | **Hosting and a staging environment** | Penta (IT) | Hosts, TLS, PostgreSQL 18, secret store, backups location; then the staging checklist in deployment-and-migrations.md §5 |
| 4 | **Independent security review / penetration test** | Penta | security-review.md §6 |
| 5 | **User acceptance and visual sign-off (AT-17)** | Penta's management, a lead, a salesperson | §4 above, on staging |
| 6 | **Operational targets and retention** | Penta | Confirm daily backups, 30-day retention, 24 h RPO, 4 h RTO; define sales, audit, document and log retention (docs/operations/README.md) |
| 7 | **Support ownership and on-call** | Penta | Who receives monitoring alerts and user reports |
| 8 | **Mail server and email decisions (CR1, CR2)** | Penta (IT, product owner) | D-EM-1: SMTP host, port/TLS, sender, credentials (entered only on the Administration page), SPF/DKIM/DMARC, IP allowlisting, `EMAIL_SECRET_KEY` in the secret store. Confirm D-EM-2 (content) and D-EM-4 (recipients). Then send a test email on staging |
| 9 | Product decisions (not blocking a pilot) | Penta product owner | FR-042 follow-up edit/reassign; FR-043 calendar; FR-022 list selectors; FR-090 alert recipients and start of day; who sees export/directory audit |

## 7. Upgrading an existing database (change requests)

An existing release-one database is upgraded in this order, each script once,
by the schema-owner role. Every script is one transaction with pre-flight
checks, and stops without changing anything if a check fails:

1. `docs/operations/sql/0008_section_memberships_and_multi_section_leads.production.sql`
2. `docs/operations/sql/0009_email_settings_templates_and_deliveries.production.sql`
3. `docs/operations/sql/0010_software_procurement_workflow.production.sql`

`npm run db:migrate` applies the same migrations. Use one method, not both.
Take a backup first (`docs/operations/backup-and-restore.md`). After 0009, set
`EMAIL_SECRET_KEY` and `EMAIL_TRANSPORT` before an administrator saves an SMTP
password. Details and rollback notes are in
`docs/operations/deployment-and-migrations.md` and ADRs 0010–0012.

## 8. Release checklist

Production deployment and live data are **not authorized**. Before asking for
that authorization, every box must be ticked with evidence:

- [x] Requirement matrix with evidence (`acceptance-matrix.md`)
- [x] Automated gates pass: typecheck, lint, `npm test`, `npm run test:smoke`, `npm run test:browsers`, `npm run build`, `npm run check:production-server` (results in `docs/progress.md`, Milestone 8)
- [x] Production build and server exclude demo controls, reset/seed endpoints, synthetic accounts and mock authentication
- [x] Backup and restore implemented and drilled locally
- [x] Capacity measured at the proposed envelope (laptop)
- [x] Change requests CR1–CR6 implemented with tests and evidence (`docs/change-requests.md`, acceptance-matrix.md)
- [ ] Blockers 1–3 resolved and their integrations tested
- [ ] Mail server configured (D-EM-1) and a test email received on staging
- [ ] Staging deployed from the runbooks; first administrator created by the bootstrap command
- [ ] On staging: capacity repeated, restore drill passed, monitoring wired and an alert test received
- [ ] Independent security review done; findings closed or accepted by Penta
- [ ] UAT (§4) passed and signed by Penta; visual deviations approved
- [ ] Operational targets, retention and support ownership confirmed in writing
- [ ] Real-data onboarding plan approved (controlled manual entry first, requirements §18)
- [ ] Explicit written authorization for production deployment
