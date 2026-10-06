# Penta Public Sector Sales CRM

A CRM for tracking public sector project opportunities in Bangladesh: pipeline
stages, follow-ups, tender cycles and section-based ownership.

**Status: Milestone 6.** Persistent accounts and sessions, server-enforced
access control, opportunity creation and editing, persistent stage and status
changes (Pipeline board and dropdown), Awarded/Lost outcomes with
management-only reopening, the complete follow-up lifecycle, ownership
transfers, management's team view, and account and section administration with
single-use invitation and reset links, the shared organization directory,
contacts with opportunity-specific relationship notes, activities, tender
cycles with the Tender Tracker, and private opportunity documents with
revisions and scanning before download (development storage and a test
scanner only — production infrastructure is undecided), server-computed
dashboards and reports with scoped totals, audited CSV exports, scoped
search, and persistent in-app notifications from retryable background jobs.
See [`docs/progress.md`](docs/progress.md) for what remains.

> All data in this repository is synthetic. No real Penta contract or
> government procurement is represented, and the application has not been
> deployed to production.

## Requirements

- **Node 22 or newer** (developed and verified on Node 24 — see `.nvmrc`)
- **Docker** for the local PostgreSQL 18 instance, or your own PostgreSQL 16+

## Setup

```bash
git clone <repository>
cd Penta-Public-Sector-CRM
npm install

cp .env.example .env
```

Generate the two secrets `.env` asks for:

```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('CSRF_SECRET='    + require('crypto').randomBytes(32).toString('hex'))"
```

Start the database, create the schema, and load the synthetic fixtures:

```bash
npm run db:up            # PostgreSQL 18 on host port 55432
npm run db:migrate       # development database
npm run db:migrate:test  # test database
npm run db:seed          # synthetic fixtures (development)
npm run db:seed:test     # synthetic fixtures (test)
```

`db:up` creates two databases (`penta_crm_dev`, `penta_crm_test`) and two
non-superuser roles: `penta_migrator` owns the schema and runs migrations;
`penta_app` is the restricted runtime account, which has no DDL rights and
cannot modify or delete audit rows.

### Running

Two terminals:

```bash
npm run dev:server   # API    http://localhost:4800
npm run dev          # web    http://localhost:5173
```

Open <http://localhost:5173> and sign in with a synthetic account (below).

### Documents in development

Uploaded files are stored privately on the server in `DOCUMENT_STORAGE_DIR`
(default `./var/documents`, git-ignored) — never in the browser. A file can be
downloaded only after a clean scan:

| `DOCUMENT_SCANNER` | Effect |
| --- | --- |
| `none` (default if unset) | Files are stored but stay **pending** and cannot be downloaded |
| `test` (as in `.env.example`) | Development **test** scanner: it flags the harmless EICAR test string and nothing else. It is not malware scanning, and the server refuses to start with it when `NODE_ENV=production` |

`DOCUMENT_MAX_UPLOAD_MB` (default 25) and `DOCUMENT_UPLOAD_TTL_MINUTES`
(default 60) are configurable. The API removes abandoned uploads every 15
minutes; `npm run documents:maintain` does it once and retries pending scans.
Production storage and scanning have **not** been chosen — see
[`docs/adr/0006-tenders-and-documents.md`](docs/adr/0006-tenders-and-documents.md).

### Background jobs: notifications and exports

Notifications (follow-ups due today and overdue, tender deadlines within 72
hours, ownership changes), queued CSV exports and daily housekeeping run from
a durable job table. By default the API process runs the worker
(`JOBS_ENABLED=true`, polling every `JOBS_POLL_SECONDS`, default 15): it
queues one notification scan per Bangladesh clock hour and one housekeeping
run per day, and starts work immediately when a request queues an export or
changes an alert. Failed jobs are retried with backoff and then left `failed`.

| Command | What it does |
| --- | --- |
| `npm run jobs:run` | Queue the scheduled jobs and run everything due, once (for `JOBS_ENABLED=false` deployments, run it from a scheduler) |
| `npm run jobs:run -- --status` | Job counts by state and the latest failures |

`REPORT_EXPORT_TTL_HOURS` (default 24) and `REPORT_EXPORT_MAX_ROWS` (default
50 000) bound exports. See
[`docs/adr/0007-dashboards-reports-search-notifications.md`](docs/adr/0007-dashboards-reports-search-notifications.md).

> **Windows note.** Hyper-V, WSL and Docker Desktop reserve blocks of TCP
> ports, and binding one fails with `EACCES` even though it looks free. The
> default `PORT=4800` sits outside the usual blocks; if it still fails, run
> `netsh interface ipv4 show excludedportrange protocol=tcp` and pick another.

### Synthetic development accounts

Every account uses the password in `SEED_DEFAULT_PASSWORD` (`.env`). These are
development fixtures; the seed script refuses to run when `NODE_ENV=production`,
and these accounts never exist in a production database.

| Email | Role | Section |
| --- | --- | --- |
| `arif.rahman@example.com` | Management | — (sees all sections) |
| `nadia.islam@example.com` | Section lead | Government Applications |
| `farhan.ahmed@example.com` | Section lead | Infrastructure & Security |
| `rafiq.hasan@example.com` | Salesperson | Government Applications |
| `tasnia.karim@example.com` | Salesperson | Government Applications |
| `imran.hossain@example.com` | Salesperson | Infrastructure & Security |
| `sadia.akter@example.com` | Salesperson | Infrastructure & Security |
| `admin@example.com` | System administrator | — (no commercial access) |

### The approved prototype

The original MagicPatterns demo is preserved unchanged and runs as a separate
build with browser-local storage and fictional data. It never contacts the API
or the database:

```bash
npm run dev:demo     # http://localhost:5173
```

A production build fails if demo code, fixtures or seed accounts can reach the
bundle (`npm run check:demo-exclusion`).

## Checks

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript for the web, server and e2e projects |
| `npm run lint` | ESLint across all source |
| `npm test` | Backend integration suite against the test database — **the milestone gate** |
| `npm run test:smoke` | Playwright browser checks, as six isolated runs (smoke + M2, M3, M4, M5, M6, M7), each starting its own servers on freshly seeded test data |
| `npm run evidence` | Recaptures the screenshots in `docs/evidence/`, as five Playwright runs so none exceeds the login rate limit (10 per 15 minutes) |
| `npm run build` | Production web bundle (with demo-exclusion checks) and compiled server |
| `npm run check:demo-exclusion` | Production-safety guard, also run by the build |

`npm test` applies the committed migrations first and refuses to run if
`TEST_DATABASE_URL` is missing, points at the development database, or
`NODE_ENV=production`.

### Database commands

| Command | What it does |
| --- | --- |
| `npm run db:up` / `npm run db:down` | Start / stop the local PostgreSQL container |
| `npm run db:generate` | Generate a migration from `server/db/schema.ts` |
| `npm run db:migrate` / `npm run db:migrate:test` | Apply migrations as the schema owner |
| `npm run db:seed` / `npm run db:seed:test` | Load synthetic fixtures |
| `npm run db:reset` | Truncate and reload the fixtures |
| `npm run documents:maintain` | Remove abandoned uploads and orphaned files; retry pending scans |
| `npm run jobs:run` | Run due background jobs once (notifications, exports, housekeeping) |

Creating databases and roles is an administrator action, done once by
`npm run db:up`. The application itself always connects as the restricted
`penta_app` role.

## Architecture

One deployable application: a React frontend and an Express API over
PostgreSQL.

```
shared/   types, enums and Zod validation shared by both sides
server/   Express API
  db/       Drizzle schema, committed SQL migrations, synthetic seeds
  policy/   the single source of record scope and action permissions
  services/ transactional business operations
  routes/   thin HTTP adapters
  auth/     passport + express-session, argon2id, PostgreSQL session store
  http/     error model, CSRF, request context, validation
  jobs/     durable background job queue, schedule and worker
src/      React app — app/ is API mode, demo/ is the approved prototype
e2e/      Playwright
docs/     requirements, progress, ADRs, screenshot evidence
```

Access control is enforced in the database query, not in the browser. See
[`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md) and
[`docs/adr/0002-authentication-and-sessions.md`](docs/adr/0002-authentication-and-sessions.md) and
[`docs/adr/0003-stage-status-and-follow-up-lifecycle.md`](docs/adr/0003-stage-status-and-follow-up-lifecycle.md) and
[`docs/adr/0004-transfers-and-administration.md`](docs/adr/0004-transfers-and-administration.md) and
[`docs/adr/0005-directory-contacts-and-activities.md`](docs/adr/0005-directory-contacts-and-activities.md) and
[`docs/adr/0006-tenders-and-documents.md`](docs/adr/0006-tenders-and-documents.md) and
[`docs/adr/0007-dashboards-reports-search-notifications.md`](docs/adr/0007-dashboards-reports-search-notifications.md).

## Not in this milestone

The complete audit and mutation-control sweep (M7) and release preparation
(M8). Production document storage and malware scanning are undecided. The
Activities & Follow-ups calendar view is still visibly unavailable.
[`docs/progress.md`](docs/progress.md) has the full list and the next task.
