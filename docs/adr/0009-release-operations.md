# ADR 0009 — Release operations: probes, request log, backups, first administrator

**Status:** Accepted for development (Milestone 8).
**Date:** 06 October 2026
**Requirements:** FR-001, NFR-001, NFR-002, NFR-003, NFR-010, NFR-011, SEC-032, AT-16

## Health: liveness and readiness are separate

`GET /api/health` answers whether the process is up. `GET /api/health/ready`
answers whether it can serve: a `SELECT 1` within 2 seconds, else 503. Neither
says why, names a host or carries a count — they are unauthenticated.
Background-job health is not in the probe (a failed export must not take an
instance out of a load balancer); it is a separate command,
`npm run jobs:run -- --check`, whose exit code a scheduler or uptime tool
alerts on.

## Request log: summaries only

`REQUEST_LOG=errors` (default) writes one JSON line for each 5xx response and
each request slower than 2 s; `all` writes every request; `off` none. A line
holds the request id, method, path without its query string, status and
milliseconds. Query strings are dropped because search terms and filter
values are business data (SEC-032). Bodies, headers and cookies are never
read by the logger.

## Backups: one snapshot, files checked against it, encrypted per file

- The database snapshot is exported (`pg_export_snapshot`) and `pg_dump
  --snapshot` dumps exactly it; the same transaction lists every document
  revision's key and SHA-256 and counts every table. Files are immutable once
  written, so copying them afterwards is consistent with the dump; each is
  checked against the database's own checksum while it is copied, and the
  backup fails rather than records a gap.
- AES-256-GCM per file with a key held apart from the backups. Per-file
  encryption needs no archive format or new dependency and authenticates each
  file, so a single altered byte is detected before anything is restored.
- Restore only into a new database and directory, then verify row counts,
  checksums, migration count and the append-only audit privileges before
  anything points at it.
- `pg_dump`/`pg_restore` must match the server's major version; locally they
  run inside the database container (`PG_TOOLS_CONTAINER`).

Rejected: copying the data directory (not consistent while running, no
encryption); a tar/zip archive (a dependency, and no per-file authentication).
Point-in-time recovery is a hosting decision (RPO), recorded as open.

## The first administrator

FR-001 requires initial privileged accounts to be created through a
controlled deployment process, and the seed refuses production. The command
`npm run ops:create-first-administrator` creates an administrator **only
while no active administrator exists** (serialised by an advisory lock), with
no password and a single-use invitation link printed once. It is audited with
no acting user and a `bootstrap-cli-…` request id. Every later account is
created from the Administration page.

## Capacity tooling is separate from the product

`scripts/capacity/` writes only to a local `penta_crm_capacity` database
(refusing others, and production). Its server is the real application with
two stated differences: a raised sign-in rate limit (all virtual users share
one address) and no in-process job worker. Results are evidence of this
machine, not a promise of staging performance.
