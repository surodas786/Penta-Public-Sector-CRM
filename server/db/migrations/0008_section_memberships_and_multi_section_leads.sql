-- Change requests CR4 and CR5, migration 0008: multi-section leads and
-- salespeople in several sections.
--
--   * section_memberships: a salesperson's sections, with history. Only an
--     open row (ended_at IS NULL) grants anything (CR5).
--   * sections.lead_user_id becomes the single source of truth for leads. One
--     person may lead several sections; every ACTIVE section has exactly one
--     ACTIVE lead (CR4): a CHECK for presence, and a deferred constraint
--     trigger for "the lead is an active account with the lead role", checked
--     at commit so a lead can be replaced inside one transaction.
--   * users_one_active_lead_per_section (0001) is dropped: a lead is no longer
--     tied to one users.section_id.
--   * users.section_id is kept, unread and unwritten by the application, so
--     this migration can be rolled back. A later migration drops it.
--
-- PRE-FLIGHT. The migration refuses to run, and changes nothing, if the data
-- breaks the new rules: an active section without an active lead, a lead
-- pointer that disagrees with the users table, or an opportunity whose section
-- is not its owner's. Fix those through the application first. No lead is
-- ever invented here.
--
-- Rollback (clean only before any account or section change is made through
-- the new code, because the new code writes memberships and lead pointers only):
--   DROP TRIGGER IF EXISTS sections_lead_is_active_lead ON sections;
--   DROP TRIGGER IF EXISTS users_still_lead_their_sections ON users;
--   DROP FUNCTION IF EXISTS penta_check_section_lead();
--   DROP FUNCTION IF EXISTS penta_check_lead_account();
--   ALTER TABLE sections DROP CONSTRAINT sections_active_has_lead;
--   DROP INDEX IF EXISTS sections_lead_idx;
--   CREATE UNIQUE INDEX users_one_active_lead_per_section ON users (section_id)
--     WHERE role = 'lead' AND active = true;
--   DROP TABLE section_memberships;
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);

-- 1. Pre-flight ---------------------------------------------------------------
DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(format('section "%s" (%s) has no active lead', s.name, s.id), '; ')
    INTO problems
    FROM sections s
    LEFT JOIN users u ON u.id = s.lead_user_id
   WHERE s.active AND (u.id IS NULL OR NOT u.active OR u.role <> 'lead');
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0008 pre-flight failed: %. Appoint a lead or deactivate the section first.', problems;
  END IF;

  SELECT string_agg(format('section "%s" (%s) points at lead %s, whose own section is %s',
                           s.name, s.id, u.id, coalesce(u.section_id::text, 'none')), '; ')
    INTO problems
    FROM sections s
    JOIN users u ON u.id = s.lead_user_id
   WHERE s.active AND u.section_id IS DISTINCT FROM s.id;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0008 pre-flight failed: %.', problems;
  END IF;

  SELECT string_agg(format('active lead %s is in section %s but is not its lead', u.id, u.section_id), '; ')
    INTO problems
    FROM users u
    JOIN sections s ON s.id = u.section_id
   WHERE u.active AND u.role = 'lead' AND s.active AND s.lead_user_id IS DISTINCT FROM u.id;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0008 pre-flight failed: %.', problems;
  END IF;

  SELECT string_agg(format('opportunity %s is in section %s but its owner %s is in %s',
                           o.reference, o.section_id, u.id, coalesce(u.section_id::text, 'none')), '; ')
    INTO problems
    FROM opportunities o
    JOIN users u ON u.id = o.owner_id
   WHERE u.section_id IS DISTINCT FROM o.section_id;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0008 pre-flight failed: %. Transfer these records first.', problems;
  END IF;
END $$;
--> statement-breakpoint

-- 2. Memberships --------------------------------------------------------------
CREATE TABLE "section_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" uuid,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" text,
	CONSTRAINT "section_memberships_ended_consistent" CHECK (("section_memberships"."ended_at" IS NULL) = ("section_memberships"."ended_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "section_memberships" ADD CONSTRAINT "section_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_memberships" ADD CONSTRAINT "section_memberships_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_memberships" ADD CONSTRAINT "section_memberships_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_memberships" ADD CONSTRAINT "section_memberships_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "section_memberships_open_unique" ON "section_memberships" USING btree ("user_id","section_id") WHERE "section_memberships"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "section_memberships_open_section_idx" ON "section_memberships" USING btree ("section_id") WHERE "section_memberships"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "section_memberships_user_idx" ON "section_memberships" USING btree ("user_id");--> statement-breakpoint

-- Backfill: every salesperson with a section keeps it as an open membership,
-- active or not, so historical owner-section pairs stay valid. Leads get no
-- membership: the sections they lead come from sections.lead_user_id.
INSERT INTO "section_memberships" ("user_id", "section_id", "started_at")
  SELECT "id", "section_id", "created_at" FROM "users"
   WHERE "role" = 'sales' AND "section_id" IS NOT NULL;
--> statement-breakpoint

-- 3. Leads --------------------------------------------------------------------
DROP INDEX IF EXISTS "users_one_active_lead_per_section";--> statement-breakpoint
CREATE INDEX "sections_lead_idx" ON "sections" USING btree ("lead_user_id");--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_active_has_lead" CHECK (NOT "sections"."active" OR "sections"."lead_user_id" IS NOT NULL);
--> statement-breakpoint

-- The lead of an active section is an active account with the lead role. The
-- functions re-read current rows rather than trusting NEW, because they run at
-- commit, after every change in the transaction.
CREATE OR REPLACE FUNCTION penta_check_section_lead() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sections s
      LEFT JOIN users u ON u.id = s.lead_user_id
     WHERE s.id = NEW.id AND s.active
       AND (u.id IS NULL OR NOT u.active OR u.role <> 'lead')
  ) THEN
    RAISE EXCEPTION 'An active section must have an active section lead (CR4).'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sections_lead_is_active_lead';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION penta_check_lead_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sections s
      JOIN users u ON u.id = s.lead_user_id
     WHERE u.id = NEW.id AND s.active
       AND (NOT u.active OR u.role <> 'lead')
  ) THEN
    RAISE EXCEPTION 'This account still leads an active section; replace the lead first (CR4).'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'users_still_lead_their_sections';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "sections_lead_is_active_lead"
  AFTER INSERT OR UPDATE OF "lead_user_id", "active" ON "sections"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION penta_check_section_lead();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "users_still_lead_their_sections"
  AFTER UPDATE OF "role", "active" ON "users"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION penta_check_lead_account();
--> statement-breakpoint

-- 4. Runtime role ---------------------------------------------------------------
-- Membership history is kept: the runtime role may end a membership but never
-- delete one. (Default privileges from 0001 granted CRUD on the new table.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'penta_app') THEN
    RAISE NOTICE 'Role penta_app not present; skipping runtime grants.';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON section_memberships TO penta_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON section_memberships FROM penta_app';
END $$;
