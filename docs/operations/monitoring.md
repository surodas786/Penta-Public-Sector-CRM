# Monitoring and failure handling (NFR-003)

**Status:** the signals exist and are tested; **no monitoring system is
connected** — that needs the hosting decision. Below: what to watch, how, and
what to do.

## Signals

| Signal | How to read it | Healthy | Alert when | Tested |
| --- | --- | --- | --- | --- |
| Liveness | `GET /api/health` | `200 {"status":"ok"}` | not 200 for 2 consecutive minutes | `check:production-server` |
| Readiness | `GET /api/health/ready` | `200 {"status":"ok","database":"ok"}` | `503` (database unreachable or slower than 2 s) | `m8Operations.test.ts`, `check:production-server` |
| Failed requests | Request log, JSON lines on stderr for 5xx | none | any 5xx; more than 5 in 5 minutes is an incident | `m8Operations.test.ts` |
| Slow requests | Request log, lines with `ms` ≥ 2000 (logged even in `errors` mode) | rare | sustained, or p95 above 2 s (NFR-011) | — |
| Background jobs | `npm run jobs:run -- --check` (exit 1 = unhealthy) | `OK: 0 jobs failed…; 0 due jobs waiting…` | a job failed for good in the last 24 h, or due work waited > 1 h (no worker running) | `m8Operations.test.ts` |
| Job detail | `npm run jobs:run -- --status` | counts by kind and state | to investigate a `--check` alert | — |
| Document scanning | `document_revisions.scan_state`: `pending` older than 1 h; `failed` | none | any `failed`; `pending` > 1 h with a real scanner configured | — (no production scanner yet) |
| Backups | the backup job's exit code and `backup-info.json` time | a backup newer than 26 h | missing or failed backup | restore drill |
| Unhandled errors | stderr lines `[<request id>] Unhandled error: …` (no request data, SEC-032) | none | any | `create.test.ts` |

Log lines carry the request id, which is also returned to the browser in
every response (`X-Request-Id`) and every error body, so a user's report can
be matched to the log without either side seeing the other's data.

## Background-job failure handling

Jobs (notification scans, CSV exports, housekeeping) live in the
`background_jobs` table and are claimed with `FOR UPDATE SKIP LOCKED`, so
several API instances can share them safely.

- A failure is retried with exponential backoff (1, 2, 4, 8 … minutes, at
  most 60) up to 5 attempts (3 for exports), then left `failed` with a
  log-safe error summary (`notifications.test.ts` covers retry, final
  failure, lease recovery and two workers never running one job twice).
- A worker that dies mid-job loses its lease; the job becomes claimable
  again after the lease expires.
- A failed export is shown to its requester as failed; they can request it
  again. A failed notification scan is superseded by the next hourly scan
  (alerts are deduplicated).
- Operator response to a `--check` alert: run `--status`, read the error
  summary, fix the cause (database, configuration), then
  `npm run jobs:run` to process due work. Failed rows older than 30 days are
  pruned by housekeeping.

## Where the worker runs

`JOBS_ENABLED=true` runs it inside each API process (default). For a
deployment that keeps the API stateless, set `JOBS_ENABLED=false` and run
`npm run jobs:run` every 5 minutes from the host's scheduler; notifications
and exports then wait for that schedule.

## Not yet in place

- An external uptime monitor and log platform (hosting decision).
- Alert routing and on-call ownership (support-ownership decision, Penta).
- Metrics beyond logs (request rate, database connections). The capacity
  report shows the 10-connection database pool is where requests queue under
  saturation; watch it once a metrics platform exists.
