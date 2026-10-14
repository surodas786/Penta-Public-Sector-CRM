-- Maintenance script: remove one user account that was never used for any
-- work, for example an account created by mistake or an invitation never
-- accepted. Not a migration: it records nothing in drizzle.__drizzle_migrations.
--
-- WHAT IT REMOVES, for that one account only:
--   the account row; its invitation and reset links (account_tokens); its
--   section memberships; its rows in the email delivery log; its in-app
--   alerts; its retry-protection records; its signed-in sessions.
--
-- WHAT IT REFUSES. The CRM keeps history on purpose: foreign keys refuse to
-- delete a user that anything refers to, and the audit is append-only. So
-- the script stops, changing nothing, and names the reasons, if the account:
--   * is referenced anywhere else in the database: it owns or created an
--     opportunity, follow-up, activity, contact, document, tender or
--     procurement cycle; performed any audited action; changed accounts,
--     sections or email settings; and so on (found from the database's own
--     foreign-key catalog, so tables added later are covered too);
--   * leads a section (use Replace lead first);
--   * is the manager of a section lead (change that reporting line first);
--   * is the last active System Administrator.
-- For such an account use Administration > Deactivate instead: it ends
-- access at once and keeps the history explainable.
--
-- AUDIT. The removal is recorded in audit_events as `account.removed`
-- (administrative domain, no actor: it was done in the database), with the
-- account's name, email and role and the reason you give. Earlier audit
-- events about the account (for example `account.created`) are kept.
--
-- HOW TO RUN. As the schema owner (penta_migrator), never the application
-- role: that role cannot delete section memberships or the email delivery
-- log, so the script would stop and change nothing. Take a backup first
-- (docs/operations/backup-and-restore.md).
--
--   Dry run (default; shows what would be removed, then changes nothing):
--     psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -v email=person@pentabd.com -v reason='Created by mistake' \
--       -f remove_unused_user.sql
--
--   Remove (the same command plus -v apply=true):
--     psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -v email=person@pentabd.com -v reason='Created by mistake' \
--       -v apply=true -f remove_unused_user.sql
--
-- Everything runs in one transaction: a refusal or any error leaves the
-- database exactly as it was.

\set ON_ERROR_STOP on

\if :{?email}
\else
  \echo 'Give the account''s email address: -v email=person@pentabd.com'
  \quit
\endif
\if :{?reason}
\else
  \echo 'Give a reason for the audit trail: -v reason=''Created by mistake'''
  \quit
\endif
\if :{?apply}
\else
  \set apply false
\endif

BEGIN;

SELECT set_config('penta.remove_email', lower(btrim(:'email')), true) AS "Account to remove";
SELECT set_config('penta.remove_reason', btrim(:'reason'), true) AS "Reason";

-- 1. Find the account and check that nothing refers to it -------------------
DO $remove$
DECLARE
  target users%ROWTYPE;
  problems text[] := '{}';
  reference record;
  referenced bigint;
  -- References this script removes with the account, never history.
  removable constant text[] := ARRAY[
    'account_tokens.user_id',
    'section_memberships.user_id',
    'email_deliveries.recipient_user_id',
    'notifications.recipient_id',
    'idempotency_records.actor_id',
    'users.manager_id'
  ];
BEGIN
  IF current_setting('penta.remove_reason') = '' THEN
    RAISE EXCEPTION 'Give a non-empty reason. Nothing was changed.';
  END IF;

  SELECT * INTO target FROM users WHERE lower(email) = current_setting('penta.remove_email') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No account has the email address %. Nothing was changed.', current_setting('penta.remove_email');
  END IF;
  PERFORM set_config('penta.remove_id', target.id::text, true);

  -- Every foreign key that points at users, except the ones removed above.
  FOR reference IN
    SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
     ORDER BY 1, 2
  LOOP
    CONTINUE WHEN reference.table_name || '.' || reference.column_name = ANY (removable);
    EXECUTE format('SELECT count(*) FROM %I WHERE %I = $1', reference.table_name, reference.column_name)
      INTO referenced USING target.id;
    IF referenced > 0 THEN
      problems := problems || format('%s row(s) in %s.%s', referenced, reference.table_name, reference.column_name);
    END IF;
  END LOOP;

  SELECT count(*) INTO referenced FROM sections WHERE lead_user_id = target.id;
  IF referenced > 0 THEN
    problems := problems || format('leads %s section(s): use Replace lead first', referenced);
  END IF;
  SELECT count(*) INTO referenced FROM users WHERE manager_id = target.id AND id <> target.id;
  IF referenced > 0 THEN
    problems := problems || format('is the manager of %s account(s): change their reporting line first', referenced);
  END IF;
  IF target.role = 'admin' AND target.active
     AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND active AND id <> target.id) THEN
    problems := problems || 'is the last active System Administrator'::text;
  END IF;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION E'The account % (%) cannot be removed: the CRM must keep its history.\n  - %\nDeactivate it in Administration instead. Nothing was changed.',
      target.full_name, target.email, array_to_string(problems, E'\n  - ');
  END IF;

  RAISE NOTICE 'Account: % <%>, role %, %, %.',
    target.full_name, target.email, target.role,
    CASE WHEN target.active THEN 'active' ELSE 'inactive' END,
    CASE WHEN target.password_hash IS NULL THEN 'never activated' ELSE 'has a password' END;
END
$remove$;

-- 2. What will be removed with it -------------------------------------------
SELECT 'account_tokens (links)' AS "Removed with the account", count(*) AS rows FROM account_tokens WHERE user_id = current_setting('penta.remove_id')::uuid
UNION ALL SELECT 'section_memberships', count(*) FROM section_memberships WHERE user_id = current_setting('penta.remove_id')::uuid
UNION ALL SELECT 'email_deliveries (log)', count(*) FROM email_deliveries WHERE recipient_user_id = current_setting('penta.remove_id')::uuid
UNION ALL SELECT 'notifications (alerts)', count(*) FROM notifications WHERE recipient_id = current_setting('penta.remove_id')::uuid
UNION ALL SELECT 'idempotency_records', count(*) FROM idempotency_records WHERE actor_id = current_setting('penta.remove_id')::uuid
UNION ALL SELECT 'session (signed in)', count(*) FROM session WHERE sess -> 'passport' ->> 'user' = current_setting('penta.remove_id');

-- 3. Remove, record, and remove the account ----------------------------------
DELETE FROM session WHERE sess -> 'passport' ->> 'user' = current_setting('penta.remove_id');
DELETE FROM notifications WHERE recipient_id = current_setting('penta.remove_id')::uuid;
DELETE FROM email_deliveries WHERE recipient_user_id = current_setting('penta.remove_id')::uuid;
DELETE FROM account_tokens WHERE user_id = current_setting('penta.remove_id')::uuid;
DELETE FROM section_memberships WHERE user_id = current_setting('penta.remove_id')::uuid;
DELETE FROM idempotency_records WHERE actor_id = current_setting('penta.remove_id')::uuid;

INSERT INTO audit_events (actor_id, entity_type, entity_id, action, domain, before_data, after_data, reason, request_id)
SELECT NULL, 'user', u.id, 'account.removed', 'administrative',
       jsonb_build_object('fullName', u.full_name, 'email', u.email, 'role', u.role, 'active', u.active),
       NULL, current_setting('penta.remove_reason'),
       'database-maintenance:remove_unused_user.sql:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  FROM users u
 WHERE u.id = current_setting('penta.remove_id')::uuid;

DELETE FROM users WHERE id = current_setting('penta.remove_id')::uuid;

-- 4. Keep or discard ----------------------------------------------------------
\if :apply
COMMIT;
\echo 'The account was removed, and the removal recorded in the audit (account.removed).'
\else
ROLLBACK;
\echo 'Dry run: nothing was changed. Run the same command with -v apply=true to remove the account.'
\endif
