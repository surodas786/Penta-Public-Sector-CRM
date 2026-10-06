# Operations

Runbooks for running the Penta CRM outside a developer's machine. Written in
Milestone 8. **Nothing here has been carried out on staging or production
infrastructure**: no such environment exists yet, and none was created
(no live infrastructure was changed and no paid service was used). Every
procedure was exercised locally where that was possible; each page says what
was and was not.

| Runbook | Covers |
| --- | --- |
| [environments.md](environments.md) | Development, test, staging and production configuration; every variable; secrets |
| [deployment-and-migrations.md](deployment-and-migrations.md) | Build, release, database migrations, rollback |
| [monitoring.md](monitoring.md) | Health and readiness probes, request log, background-job checks, what to alert on |
| [backup-and-restore.md](backup-and-restore.md) | Consistent encrypted backup of database and documents; restore; the drill |

## Proposed operational targets — for Penta to confirm

From the requirements (NFR-002, NFR-010, NFR-011). None is confirmed; none is
a promise. Measured local evidence is in `docs/release/capacity-and-performance.md`
and `docs/evidence/operations/restore-drill.md`.

| Target | Proposed | Evidence so far | Status |
| --- | --- | --- | --- |
| Backup frequency | Daily | `npm run ops:backup` produces a consistent encrypted backup; scheduling is a deployment task | **Penta to confirm** |
| Backup retention | 30 days | Not automated: retention is set where backups are stored (object-store lifecycle or a scheduled prune) | **Penta to confirm** |
| Recovery point (RPO) | ≤ 24 hours | Follows from daily backups. Point-in-time recovery (WAL archiving) would shorten it; not configured | **Penta to confirm** |
| Recovery time (RTO) | ≤ 4 hours | Local drill: restore and verification of the capacity-size database in under 10 s, excluding provisioning. A real restore is dominated by provisioning a host and fetching backups | **Penta to confirm; staging restore needed** |
| Full restore validation | Before launch, then quarterly | Local drill passes (`npm run ops:restore-drill`). **Not yet done on staging** | **Open** |
| Load envelope | 100 users, 30 concurrent, 10 000 opportunities, 100 000 activities/follow-ups | Measured on a laptop: see the capacity report | **Penta to confirm; repeat on staging** |
| API p95 | < 2 s | 92–226 ms (30 paced users), 520–698 ms (saturation) on a laptop | Met locally; **staging pending** |
| First usable page | < 3 s | Medians 0.3–1.5 s; one cold-start outlier of 4.7 s | Met at median locally; **staging pending** |
| Log and audit retention | Penta defines (requirements §18) | Audit is append-only and never pruned; job records pruned after 30 days; exports after 24 h; idempotency records after 24 h | **Penta to decide** |

## Decisions that block production

Recorded in full in `docs/release/pilot-handover.md` §6. In short: hosting;
production document storage and malware scanning (ADR 0006); identity
provider and MFA; backup storage location, schedule and retention; support
ownership and on-call; log and audit retention.
