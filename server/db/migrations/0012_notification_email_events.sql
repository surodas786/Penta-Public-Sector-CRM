-- Change request CR2, step 6, migration 0012: notification email events.
--
-- Additive. Connects email to the in-app notifications and to the Software
-- Procurement cycles of CR6:
--   * notification_type gains 'eoi_deadline' and 'rfp_deadline', and
--     notifications gains procurement_cycle_id (the cycle an EOI or proposal
--     deadline alert is about), with the subject CHECK extended to them;
--   * email_template_key gains the EOI and RFP deadline reminders, the team
--     and management summaries and the administrators' delivery-failure
--     notice;
--   * email_templates_security_enabled: the invitation, password reset and
--     password changed messages cannot be turned off;
--   * email_notification_settings: at most one row, the administrator's
--     reminder timing, summary schedule and management summary recipients.
--     No row means the defaults in shared/email.ts.
-- Nothing is seeded and no email is sent by this migration. New enum values
-- are compared as text in CHECKs: they cannot be used before they commit.
--
-- PRE-FLIGHT. Refuses to run, and changes nothing, if a security template
-- was turned off in Administration. Turn it on there first (the change is
-- audited), then rerun. Nothing is changed silently.
--
-- Rollback (loses notification timing and any EOI/RFP alerts):
--   DELETE FROM notifications WHERE type::text IN ('eoi_deadline', 'rfp_deadline');
--   ALTER TABLE notifications DROP CONSTRAINT notifications_subject_present;
--   ALTER TABLE notifications ADD CONSTRAINT notifications_subject_present CHECK (
--     (type IN ('follow_up_due_today', 'follow_up_overdue') AND follow_up_id IS NOT NULL AND trigger_date IS NOT NULL)
--     OR (type = 'tender_deadline' AND tender_id IS NOT NULL AND trigger_at IS NOT NULL)
--     OR (type = 'ownership_changed' AND subject_user_id IS NOT NULL));
--   ALTER TABLE notifications DROP COLUMN procurement_cycle_id;
--   ALTER TABLE email_templates DROP CONSTRAINT email_templates_security_enabled;
--   DROP TABLE email_notification_settings;
--   (The enum values stay, unused: PostgreSQL cannot drop them. Rows in
--   email_deliveries for the new emails stay as history.)
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);

DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(key::text, ', ' ORDER BY key::text) INTO problems
    FROM email_templates
   WHERE NOT enabled AND key::text IN ('invitation', 'password_reset', 'password_changed');
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0012 pre-flight failed: these security emails are turned off: %. Turn them on in Administration > Email templates, then rerun.', problems;
  END IF;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."email_template_key" ADD VALUE 'eoi_deadline';--> statement-breakpoint
ALTER TYPE "public"."email_template_key" ADD VALUE 'rfp_deadline';--> statement-breakpoint
ALTER TYPE "public"."email_template_key" ADD VALUE 'team_summary';--> statement-breakpoint
ALTER TYPE "public"."email_template_key" ADD VALUE 'management_summary';--> statement-breakpoint
ALTER TYPE "public"."email_template_key" ADD VALUE 'delivery_failures';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'eoi_deadline';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'rfp_deadline';--> statement-breakpoint
CREATE TABLE "email_notification_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"reminder_hour" integer DEFAULT 9 NOT NULL,
	"tender_reminder_hours" integer DEFAULT 72 NOT NULL,
	"eoi_reminder_hours" integer DEFAULT 72 NOT NULL,
	"rfp_reminder_hours" integer DEFAULT 72 NOT NULL,
	"summary_frequency" text DEFAULT 'weekly' NOT NULL,
	"summary_weekday" integer DEFAULT 0 NOT NULL,
	"management_summary_recipient_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "email_notification_settings_single_row" CHECK ("email_notification_settings"."id" = 1),
	CONSTRAINT "email_notification_settings_reminder_hour" CHECK ("email_notification_settings"."reminder_hour" BETWEEN 0 AND 23),
	CONSTRAINT "email_notification_settings_deadline_hours" CHECK ("email_notification_settings"."tender_reminder_hours" BETWEEN 1 AND 72
        AND "email_notification_settings"."eoi_reminder_hours" BETWEEN 1 AND 72
        AND "email_notification_settings"."rfp_reminder_hours" BETWEEN 1 AND 72),
	CONSTRAINT "email_notification_settings_frequency" CHECK ("email_notification_settings"."summary_frequency" IN ('daily', 'weekly')),
	CONSTRAINT "email_notification_settings_weekday" CHECK ("email_notification_settings"."summary_weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_present";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "procurement_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "email_notification_settings" ADD CONSTRAINT "email_notification_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_procurement_cycle_id_procurement_cycles_id_fk" FOREIGN KEY ("procurement_cycle_id") REFERENCES "public"."procurement_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_procurement_cycle_idx" ON "notifications" USING btree ("procurement_cycle_id");--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_security_enabled" CHECK ("email_templates"."enabled" OR "email_templates"."key"::text NOT IN ('invitation', 'password_reset', 'password_changed'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_present" CHECK (("notifications"."type"::text IN ('follow_up_due_today', 'follow_up_overdue') AND "notifications"."follow_up_id" IS NOT NULL AND "notifications"."trigger_date" IS NOT NULL)
        OR ("notifications"."type"::text = 'tender_deadline' AND "notifications"."tender_id" IS NOT NULL AND "notifications"."trigger_at" IS NOT NULL)
        OR ("notifications"."type"::text = 'ownership_changed' AND "notifications"."subject_user_id" IS NOT NULL)
        OR ("notifications"."type"::text IN ('eoi_deadline', 'rfp_deadline') AND "notifications"."procurement_cycle_id" IS NOT NULL AND "notifications"."trigger_at" IS NOT NULL));

--> statement-breakpoint
-- The runtime role reads and writes the timing row but never deletes it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'penta_app') THEN
    RAISE NOTICE 'Role penta_app not present; skipping runtime grants.';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON email_notification_settings TO penta_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON email_notification_settings FROM penta_app';
END $$;
