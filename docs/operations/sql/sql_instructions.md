# Running the change-request SQL scripts on the production database

These scripts upgrade a release-one database (migrations `0000`–`0007`) to
the change-request schema (CR1–CR6). They are the reviewed, plain-SQL
equivalent of `npm run db:migrate`. Use **one** method: these scripts *or*
`db:migrate`, never both for the same migration.

> **Authorization.** No production deployment or real data is authorized
> yet (`CLAUDE.md`). Follow these steps only once Penta has given explicit
> written authorization for the upgrade.

## 1. The scripts, in order

Run each script **once**, in this order:

| # | Script | What it does |
| --- | --- | --- |
| 1 | `0008_section_memberships_and_multi_section_leads.production.sql` | CR4/CR5: salesperson section memberships; a lead may lead several sections; every active section has an active lead |
| 2 | `0009_email_settings_templates_and_deliveries.production.sql` | CR1/CR2/CR3: email settings, templates and delivery log |
| 3 | `0010_software_procurement_workflow.production.sql` | CR6, first design: needed only as the step before 0011 |
| 4 | `0011_software_procurement_cycles.production.sql` | CR6, final design: Software Procurement cycles; retires 0010's workflow column and tender phases |
| 5 | `0012_notification_email_events.production.sql` | CR2, step 6: EOI and RFP deadline alerts, the new notification emails, notification timing; security emails can no longer be turned off |

0010 must be applied before 0011 even though 0011 retires most of it. Each
script checks that the previous migration is the latest one applied.

### File checksums

Check that the files you copied to the server are exactly the reviewed ones:

```bash
sha256sum 00*.production.sql
```

| Script | sha256 |
| --- | --- |
| 0008 | `d317282fba5dac8ddd885344a5da25b384bd98efd40a60a18c0414d50d789fea` |
| 0009 | `a6279e6041f11ce456474bb8df664f3fe7c3a6e4928a64e4e3f7fc5211cba5cd` |
| 0010 | `63ef0b33d4c4fe21113af5d5036e8f47a03802246308313daafbacddfc944a02` |
| 0011 | `500d9a7519a8b37f965dfe1db34008848cbb114948c5f5447260e46153567106` |
| 0012 | `acb2c1c88f800d606dbf6eb73aa2f0d4fed2d1ec004b95d5430abeb124ad4d46` |

If a checksum differs, stop. Do not use copies of 0009 or 0010 taken before
commit `52b0e2a`: those embed outdated migration hashes.

## 2. What you need

- **The `psql` client**, version 18. It must match the PostgreSQL 18
  server.
- **The schema-owner connection** (`penta_migrator`), as
  `MIGRATION_DATABASE_URL`. **Never** run these scripts as the application
  role `penta_app`; the scripts grant that role its rights.
- **A maintenance window.** Stop the application, and the background job
  worker if it runs separately, so nothing writes during the upgrade. The
  old application code does not work against the new schema.
- **A verified backup** (step 3).
- **For 0009 onwards, a new secret:** `EMAIL_SECRET_KEY`, 64 hex
  characters. Generate it with `openssl rand -hex 32` and store it in the
  secret store. It is needed by the application after the upgrade, not by
  the scripts.

## 3. Before you start

1. **Announce the window and stop the application.**

2. **Take a backup and verify it** (`docs/operations/backup-and-restore.md`):

   ```bash
   BACKUP_ENCRYPTION_KEY=<from the secret store> \
   BACKUP_DATABASE_URL="$MIGRATION_DATABASE_URL" \
   DOCUMENT_STORAGE_DIR=<document directory> \
   BACKUP_DIR=<backup destination> \
   BACKUP_ALLOW_PRODUCTION=true \
   npm run ops:backup
   ```

   Copy the backup off the host before continuing.

3. **See which migrations are already applied:**

   ```bash
   psql "$MIGRATION_DATABASE_URL" -c \
     "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;"
   ```

   Match the newest `created_at` to this table:

   | Latest applied | `created_at` | Start with |
   | --- | --- | --- |
   | 0007 (release one) | `1791271242808` | 0008 |
   | 0008 | `1791785742484` | 0009 |
   | 0009 | `1791788309890` | 0010 |
   | 0010 | `1791792829758` | 0011 |
   | 0011 | `1791806810438` | 0012 |
   | 0012 | `1791867164750` | Nothing; already up to date |

   Start at the first script not yet applied, and skip the ones already
   applied. A script run out of order refuses to run and changes nothing.

## 4. Running the scripts

Run each script with `ON_ERROR_STOP`, so the first error stops it:

```bash
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f 0008_section_memberships_and_multi_section_leads.production.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f 0009_email_settings_templates_and_deliveries.production.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f 0010_software_procurement_workflow.production.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f 0011_software_procurement_cycles.production.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f 0012_notification_email_events.production.sql
```

Run them one at a time and read the output before the next. A successful
script ends with `COMMIT`.

**Each script is one transaction.** If anything fails, including a
pre-flight check, the database is left exactly as it was. Fix the cause,
then rerun the same script. A script that already ran refuses to run again
(`Migration … is already applied`), which is harmless.

### Pre-flight checks that can stop a script

| Script | Stops when | What to do |
| --- | --- | --- |
| 0008 | An active section has no active lead; a section's lead pointer disagrees with the users table; or an opportunity's section is not its owner's section | Fix it with the release-one application (appoint a lead, deactivate the section, or transfer the opportunity), then rerun. The error names each record. No lead is ever invented |
| 0011 | An opportunity still uses 0010's Software Procurement workflow or one of its stages, or a tender still has an EOI/RFP phase or the `closed` state | This only happens if 0010's design was used in production. Close or correct the named records, then rerun. Nothing is converted automatically |
| 0012 | A security email (invitation, password reset or password changed) was turned off in Administration | Turn it back on in Administration > Email templates (the change is audited), then rerun. Nothing is changed silently |

0009 and 0010 have no data pre-flight. They only check the order.

## 5. After the scripts

1. **Confirm the database is at 0012:**

   ```bash
   psql "$MIGRATION_DATABASE_URL" -c "SELECT max(created_at) FROM drizzle.__drizzle_migrations;"
   ```

   Expected: `1791867164750`.

2. **Spot-check the new tables and the runtime role's rights:**

   ```bash
   psql "$MIGRATION_DATABASE_URL" -c "
     SELECT to_regclass('section_memberships')  IS NOT NULL AS memberships,
            to_regclass('email_settings')       IS NOT NULL AS email,
            to_regclass('procurement_cycles')   IS NOT NULL AS procurement,
            to_regclass('email_notification_settings') IS NOT NULL AS timing,
            has_table_privilege('penta_app', 'procurement_cycles', 'DELETE') AS app_can_delete_cycles,
            has_table_privilege('penta_app', 'email_notification_settings', 'DELETE') AS app_can_delete_timing;"
   ```

   Expected: `t | t | t | t | f | f`.

3. **Set the application environment**, then deploy the change-request code
   (branch `cr-change-requests`, at or after the step 6 commit, "CR2 step 6:
   notification email events"; that code expects 0012):
   - `EMAIL_SECRET_KEY`: the new 64-hex secret.
   - `EMAIL_TRANSPORT=none` until Penta's mail server is decided (D-EM-1).
     `capture` is refused in production.

4. **Start the application** and run the production checks:
   - `GET /api/health/ready` returns `ok`.
   - Sign in as management and open the Dashboard, Opportunities,
     **Software Procurement** and Reports.
   - Sign in as the administrator and open Administration, including Email
     delivery.

5. **Keep the backup** until the release is accepted.

## 6. If something goes wrong

- **A script failed.** Nothing was changed (one transaction). Read the
  message, fix the cause, and rerun that script.
- **The application misbehaves after the upgrade.** Stop it, and either:
  - restore the backup into a **new** database and point the release-one
    application at it (`docs/operations/backup-and-restore.md` §3); or
  - roll back individual migrations with the `Rollback:` steps in each
    script's header. These are clean only before new data (memberships,
    email rows, procurement cycles) has been written.

  PostgreSQL cannot drop enum values, so values added by 0010, 0011 and 0012
  stay in their types, unused.

More detail: `docs/operations/deployment-and-migrations.md` §3.1–§3.5 and
ADRs 0010–0012.
