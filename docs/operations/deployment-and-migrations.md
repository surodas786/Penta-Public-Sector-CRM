# Deployment, migrations and rollback (NFR-002)

**Status:** procedure written and its steps exercised locally (build,
production-mode start, migrations on clean and existing databases, backup,
restore). **Never run against staging or production** — neither exists yet.
No production deployment is authorized.

## 1. Build (in CI, never on the production host)

```bash
npm ci                         # exact versions from package-lock.json
npm run typecheck && npm run lint
npm test                       # integration suite, isolated test database
npm run test:smoke             # browser checks
npm run build                  # web (with demo-exclusion checks) + server
npm run check:production-server   # the compiled server, in production mode
```

GitHub Actions (`.github/workflows/ci.yml`) runs the same gate on every pull
request with a throwaway PostgreSQL service and synthetic credentials.

Release artefact: `dist/` (static web build), `dist-server/` (compiled API),
`package.json`, `package-lock.json`, `server/db/migrations/`. On the host:
`npm ci --omit=dev` — the runtime then contains no build or test tooling (see
the dependency notes in `docs/release/security-review.md` §2).

## 2. Release procedure

1. **Announce** the window; releases that include a migration should be
   outside working hours (Asia/Dhaka).
2. **Back up** (backup-and-restore.md §2) and confirm it completed. This is
   the rollback point for the database.
3. **Stop the job worker** if it runs separately (`JOBS_ENABLED=false`
   deployments): jobs are retryable, so stopping mid-run is safe.
4. **Migrate** as the schema owner: `npm run db:migrate` with
   `MIGRATION_DATABASE_URL`. Migrations are applied in order inside
   transactions and recorded in `drizzle.__drizzle_migrations`; an applied
   migration is never re-run (tested: `operations.test.ts`, repeat runs).
5. **Deploy** the new `dist/` and `dist-server/`, restart the API.
6. **Verify:** `GET /api/health` → 200; `GET /api/health/ready` → 200;
   `npm run jobs:run -- --check` → OK; sign in as a pilot account and open
   the dashboard; check the request log for 5xx.
7. **Restart the job worker** if separate.

## 3. Migrations

| Migration | Reversible by | Notes |
| --- | --- | --- |
| `0000`, `0001` | Restore (baseline schema, roles' grants, reference sequence) | First deployment only |
| `0002`–`0007` | The `Rollback:` steps in each file's header, or restore | All additive (columns, tables, constraints, indexes) |

Rules for future migrations (unchanged from earlier milestones): additive
first; a destructive change ships in a later release after the code no
longer needs the old shape; every new table gets explicit runtime-role grants;
`audit_events` stays INSERT/SELECT only for the runtime role.

## 4. Rollback

| Situation | Action |
| --- | --- |
| New code misbehaves, migration was additive | Redeploy the previous `dist/` and `dist-server/`. Additive migrations are compatible with the previous code; leave them in place |
| A migration failed part-way | It ran in a transaction and rolled back; fix and re-run. Nothing to undo |
| A migration must be undone | Apply its header's `Rollback:` statements as the schema owner, then delete its row from `drizzle.__drizzle_migrations` — **only** if no data written since depends on it |
| Data is wrong or lost | Restore the pre-release backup into a **new** database, verify, then switch `DATABASE_URL` (backup-and-restore.md §3). Work done after the backup is lost — the RPO |

Audit events are append-only: a rollback by restore also removes audit events
written after the backup, so the release record (who, when, which backup)
must be kept outside the database.

## 5. First deployment checklist (staging, then production)

- [ ] Host, TLS certificate and reverse proxy (environments.md, hosting shape)
- [ ] PostgreSQL 18 with `penta_migrator` and `penta_app` roles, locked-down `public` schema
- [ ] Secret store populated (session, CSRF, backup key, database passwords)
- [ ] Private document storage and a real scanner — **blocked on ADR 0006**
- [ ] Identity provider / MFA decision — **blocked** (security-review.md §5)
- [ ] `npm run db:migrate`, then create the first administrator through the controlled process (FR-001), not the seed
- [ ] Monitoring wired (monitoring.md), backups scheduled and a restore drill passed on that environment
