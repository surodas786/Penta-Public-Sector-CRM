# Environments and configuration (NFR-001)

Four environments, each with its **own database and its own document
storage**. Nothing is shared between them, and synthetic seed accounts exist
only in development and test.

| | Development | Test / CI | Staging | Production |
| --- | --- | --- | --- | --- |
| Purpose | A developer's machine | Automated suites | Pilot and UAT on synthetic data, restore drills, performance repeat | Live use, after approval |
| Database | `penta_crm_dev` (docker) | `penta_crm_test` (docker / CI service) | Separate PostgreSQL 18 | Separate PostgreSQL 18 |
| Data | Synthetic fixtures (`npm run db:seed`) | Synthetic fixtures, reseeded per test | Synthetic only until Penta approves otherwise | Real data, only after approval |
| `NODE_ENV` | `development` | `test` | `production` | `production` |
| Document scanner | `test` | `test` | **unresolved** (`none` keeps uploads unavailable) | **unresolved** — blocker |
| Exists today | Yes | Yes (local + GitHub Actions) | **No** | **No** |

Staging must run with `NODE_ENV=production` so it exercises every production
guard (secure cookies, refused test scanner, placeholder-secret refusal). Seed
and reset commands refuse `NODE_ENV=production` and any database outside
`penta_crm_dev`/`penta_crm_test`, so staging cannot be seeded with the
development fixtures by accident; staging synthetic data is loaded by an
explicit, reviewed procedure (for example the capacity generator, which only
writes to `penta_crm_capacity` unless `CAPACITY_ALLOW_REMOTE=true` is set for
an isolated staging host).

## Server variables

All read by `server/env.ts`; the server refuses to start when a required value
is missing or unsafe. `.env.example` documents each one for development
(`npm run check:env` verifies it parses as written).

| Variable | Staging / production value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Enables secure cookies, `trust proxy`, the production guards |
| `DATABASE_URL` | the **runtime** role (`penta_app`) | Not a superuser; no DDL; INSERT/SELECT only on `audit_events` |
| `MIGRATION_DATABASE_URL` | the **schema owner** (`penta_migrator`) | Used only by `npm run db:migrate`; never by the running server |
| `APP_ORIGIN` | `https://<crm host>` | The exact browser origin; CSRF origin checks compare against it |
| `PORT`, `HOST` | e.g. `4800`, `127.0.0.1` | The API listens behind the reverse proxy; `HOST` defaults to `0.0.0.0` in production |
| `SESSION_SECRET`, `CSRF_SECRET` | 64 random hex characters each, different | From the secret store. Placeholders and values under 32 characters are refused |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_MINUTES` | `30`, `720` | SEC-031 defaults |
| `DOCUMENT_STORAGE_DIR` | private directory outside the web root | Local storage only until ADR 0006 is resolved |
| `DOCUMENT_SCANNER` | `none` until a real scanner exists | `test` is refused in production |
| `DOCUMENT_MAX_UPLOAD_MB`, `DOCUMENT_UPLOAD_TTL_MINUTES` | `25`, `60` | SEC-010 defaults |
| `JOBS_ENABLED`, `JOBS_POLL_SECONDS` | `true`, `15` — or `false` with a scheduler running `npm run jobs:run` | See monitoring.md |
| `REPORT_EXPORT_TTL_HOURS`, `REPORT_EXPORT_MAX_ROWS` | `24`, `50000` | |
| `REQUEST_LOG` | `errors` (or `all` if the log platform can take the volume) | Never logs query strings, bodies, headers or cookies |
| `FORCE_SECURE_COOKIES` | unset | Only for testing secure cookies outside production mode |
| `VITE_DEMO_MODE`, `ALLOW_DEMO_ENDPOINTS` | **must be unset/false** | The server refuses to start in production otherwise |
| `SEED_DEFAULT_PASSWORD`, `TEST_*` | **must not be set** | Development and test only |

Operations-only variables (never needed by the running server):
`BACKUP_ENCRYPTION_KEY`, `BACKUP_DATABASE_URL`, `BACKUP_DIR`,
`PG_TOOLS_CONTAINER`, `RESTORE_*` — see backup-and-restore.md.

### Template (placeholders only — never commit real values)

```dotenv
NODE_ENV=production
DATABASE_URL=postgres://penta_app:<from secret store>@<db host>:5432/penta_crm
MIGRATION_DATABASE_URL=postgres://penta_migrator:<from secret store>@<db host>:5432/penta_crm
APP_ORIGIN=https://<crm host>
PORT=4800
HOST=127.0.0.1
SESSION_SECRET=<64 hex, from secret store>
CSRF_SECRET=<64 hex, from secret store>
SESSION_IDLE_MINUTES=30
SESSION_ABSOLUTE_MINUTES=720
DOCUMENT_STORAGE_DIR=/var/lib/penta-crm/documents
DOCUMENT_SCANNER=none
DOCUMENT_MAX_UPLOAD_MB=25
DOCUMENT_UPLOAD_TTL_MINUTES=60
JOBS_ENABLED=true
JOBS_POLL_SECONDS=15
REPORT_EXPORT_TTL_HOURS=24
REPORT_EXPORT_MAX_ROWS=50000
REQUEST_LOG=errors
```

## Web build

The browser application is a static build (`npm run build:web` → `dist/`). It
contains no secret: `VITE_*` values are public by design and only
`VITE_DEMO_MODE=false` is used. The build fails if demo mode, demo routes or
seed accounts would reach it.

## Hosting shape (proposed; hosting is not decided)

```
browser ──HTTPS──▶ reverse proxy (TLS, static dist/, CSP, /api → API)
                         │
                         └──▶ Node API (dist-server) ──▶ PostgreSQL 18
                                   └──▶ private document storage
```

- One origin: the proxy serves `dist/` and forwards `/api/*` to the API, so
  session cookies stay first-party (`SameSite=Strict`).
- The proxy terminates TLS, redirects HTTP to HTTPS, and sets the static
  site's Content-Security-Policy; the API sets its own JSON-only headers.
- The API trusts exactly one proxy hop (`trust proxy` = 1 in production) for
  secure cookies and per-client rate limiting.
- Database roles and the locked-down `public` schema as in
  `docker/initdb/01-roles-and-databases.sql` (created by a database
  administrator; the application never needs superuser rights).

## Secrets

Session, CSRF and backup encryption keys, and the two database passwords,
belong in the host's secret store (or environment injected by it), never in
the repository, the image, or beside the backups. Rotating `SESSION_SECRET`
signs everyone out; rotating `CSRF_SECRET` invalidates open forms (users
reload). Rotating `BACKUP_ENCRYPTION_KEY` needs the old key kept for as long as
older backups are retained.
