-- Milestone 1, migration 0001.
--
-- Three things the generated schema migration cannot express:
--   1. the concurrency-safe opportunity reference sequence (plan section 5),
--   2. the circular sections.lead_user_id -> users.id foreign key,
--   3. the runtime role's privileges, including append-only audit_events
--      (plan section 4.4 / SEC-012).
--
-- Re-runnable: every statement is guarded, so applying twice is safe.

-- 1. Opportunity references -------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS opportunity_reference_seq AS bigint START WITH 1 INCREMENT BY 1;
--> statement-breakpoint

-- 2. Section lead ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sections_lead_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sections"
      ADD CONSTRAINT "sections_lead_user_id_users_id_fk"
      FOREIGN KEY ("lead_user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

-- BR-002 / plan 3.1: at most one active lead per section.
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_active_lead_per_section"
  ON "users" ("section_id")
  WHERE "role" = 'lead' AND "active" = true;
--> statement-breakpoint

-- 3. Runtime role privileges -------------------------------------------------
-- The application connects as penta_app. It owns nothing, has no DDL rights,
-- and must not be a superuser. The role is absent in some CI images, so each
-- grant is guarded.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'penta_app') THEN
    RAISE NOTICE 'Role penta_app not present; skipping runtime grants.';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO penta_app';

  -- Ordinary business tables: full row-level CRUD, no DDL.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON
             sections, users, organizations, opportunities, follow_ups,
             idempotency_records, session
           TO penta_app';

  -- SEC-012: audit rows are append-only for the runtime role. No UPDATE, no
  -- DELETE, no TRUNCATE — not through the application, not through psql.
  EXECUTE 'GRANT SELECT, INSERT ON audit_events TO penta_app';
  EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM penta_app';

  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE opportunity_reference_seq TO penta_app';

  -- Anything the migrator creates later is reachable by the runtime role,
  -- except where a future migration narrows it again.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE penta_migrator IN SCHEMA public
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO penta_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE penta_migrator IN SCHEMA public
             GRANT USAGE, SELECT ON SEQUENCES TO penta_app';
END $$;
