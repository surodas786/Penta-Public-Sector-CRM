# Backup and restore (NFR-002, AT-16)

**Status:** implemented and drilled **locally, in an isolated nonproduction
environment** (06 October 2026, evidence in
`docs/evidence/operations/restore-drill.md`). **Not yet scheduled anywhere and
not yet restored on staging** — that drill is required before launch and then
quarterly (NFR-002). Backup storage location, schedule and retention are
Penta's decisions.

## 1. What a backup contains

| Part | Consistency | Protection |
| --- | --- | --- |
| The whole database (`pg_dump`, custom format) | One exported snapshot (`pg_export_snapshot` + `pg_dump --snapshot`) | AES-256-GCM, key from `BACKUP_ENCRYPTION_KEY` |
| Row counts of every table, and every stored document's key and SHA-256 | Read in the **same** snapshot transaction | Encrypted manifest |
| Every stored document file (finalized revisions) | Files are immutable once written; each is checked against the database's SHA-256 while being copied | Encrypted per file |
| `backup-info.json` | — | Plaintext: time, sizes, file counts only |

Not copied, deliberately: unfinalized staged uploads (not records, expire
anyway) and quarantined infected files (recorded in the manifest; they are
never downloadable). Sessions are included in the dump; restored sessions
still expire on their own timers.

## 2. Making a backup

```bash
BACKUP_ENCRYPTION_KEY=<64 hex from the secret store> \
BACKUP_DATABASE_URL=<schema-owner URL> \
DOCUMENT_STORAGE_DIR=<document directory> \
BACKUP_DIR=<backup destination> \
npm run ops:backup
```

- `pg_dump` must match the server's major version (18). Locally,
  `PG_TOOLS_CONTAINER=penta-crm-postgres` runs it inside the database
  container (the host's `pg_dump` 16 cannot dump an 18 server).
- Production sets `BACKUP_ALLOW_PRODUCTION=true` explicitly.
- The command fails — and writes no partial "success" — if any document
  file is missing or its checksum differs from the database.
- Copy the backup directory off the host to storage with its own access
  controls and retention (proposed: daily, 30 days). The key never goes with
  it.

## 3. Restoring

Always into a **new** database and a **new** document directory, then switch
the application to them after verification. The tool refuses to restore over
`penta_crm_dev`, `penta_crm_test`, `penta_crm_capacity` or any existing
database (except `penta_crm_restore*` scratch databases, which a drill
recreates).

```bash
BACKUP_ENCRYPTION_KEY=<key> \
RESTORE_ADMIN_DATABASE_URL=<role allowed to CREATE DATABASE> \
RESTORE_MIGRATION_DATABASE_URL=<schema-owner URL> \
RESTORE_DATABASE_URL=<runtime-role URL> \
RESTORE_TARGET_DATABASE=<new database name> \
RESTORE_STORAGE_DIR=<new document directory> \
npm run ops:restore -- <backup directory>
```

It verifies, and stops at the first failure: decryption/authentication of
every file (a single altered byte is refused); dump and file checksums; every
table's row count against the snapshot; the applied-migration count; every
non-quarantined revision has its file; the runtime role still cannot UPDATE,
DELETE or TRUNCATE audit events.

Then: point `DATABASE_URL` and `DOCUMENT_STORAGE_DIR` at the restored copy,
restart, run the verification of deployment-and-migrations.md §2 step 6, and
record the restore (outside the database: audit events written after the
backup are gone with the rest of that work).

## 4. The drill

`npm run ops:restore-drill` (with `BACKUP_ENCRYPTION_KEY` and
`PG_TOOLS_CONTAINER` set) proves the whole path on the isolated TEST
database: seed, upload real documents through the application (a revision, a
Bangla file name, an infected test file), back up, restore into
`penta_crm_restore_check`, then run the application on the restored copy —
sign in, read records with history, download every document byte-for-byte,
create new work — and show that a tampered backup is refused. It also times a
database-only dump and restore of the capacity database.

Result on 06 October 2026 (laptop, Docker Desktop):

| Step | Time |
| --- | --- |
| Backup (fixtures + 3 files) | 1.1 s |
| Restore with all verification | 2.3 s |
| Capacity database (≈100 MB, 10 000 opportunities, 100 000 activities/follow-ups): encrypted dump 16.7 MB | 4.9 s |
| Capacity database: decrypt and restore | 7.9 s |

These times exclude provisioning a host, fetching backups from remote storage
and DNS/proxy changes, which dominate a real recovery. They support, but do
not prove, the proposed 4-hour recovery time.

## 5. Not covered yet

- Scheduling and off-host copying (hosting decision).
- Point-in-time recovery (WAL archiving) — would bring the RPO below 24 h.
- A restore drill on staging, with production-like volumes and the chosen
  document storage.
- Object storage: when documents move to object storage (ADR 0006), the file
  part of the backup changes to that service's versioning/replication, and the
  manifest check (every revision's key and checksum) stays.
