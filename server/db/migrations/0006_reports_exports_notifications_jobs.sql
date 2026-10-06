-- Milestone 6, migration 0006: notifications, queued report exports and
-- background jobs, plus three read indexes for reports and dashboards.
--
-- Additive: three tables, four enums and three indexes on existing tables.
-- Notifications deduplicate on a unique trigger key (BR-070); a CHECK ties
-- each alert type to the record and date it is about. A ready export must
-- carry its content and the opportunity ids it covers, which delivery uses to
-- re-check access (SEC-005).
--
-- Runtime role: notifications are inserted and retired, never deleted
-- (SELECT/INSERT/UPDATE). Exports and jobs are operational records that the
-- housekeeping job removes after expiry (SELECT/INSERT/UPDATE/DELETE).
-- TRUNCATE is revoked everywhere.
--
-- Rollback:
--   DROP TABLE notifications; DROP TABLE report_exports; DROP TABLE background_jobs;
--   DROP TYPE notification_type; DROP TYPE report_export_kind;
--   DROP TYPE report_export_status; DROP TYPE background_job_status;
--   DROP INDEX activities_occurred_at_idx; DROP INDEX opportunities_award_date_idx;
--   DROP INDEX opportunities_closed_date_idx;
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
--   Audit events written by M6 (report.*) stay: the audit trail is append-only.

CREATE TYPE "public"."background_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('follow_up_due_today', 'follow_up_overdue', 'tender_deadline', 'ownership_changed');--> statement-breakpoint
CREATE TYPE "public"."report_export_kind" AS ENUM('pipeline', 'section_owner', 'overdue_follow_ups', 'upcoming_tenders', 'outcomes', 'lost_reasons', 'opportunities');--> statement-breakpoint
CREATE TYPE "public"."report_export_status" AS ENUM('queued', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "background_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "background_jobs_attempts_bounded" CHECK ("background_jobs"."attempts" >= 0 AND "background_jobs"."attempts" <= "background_jobs"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"follow_up_id" uuid,
	"tender_id" uuid,
	"type" "notification_type" NOT NULL,
	"trigger_key" text NOT NULL,
	"trigger_date" date,
	"trigger_at" timestamp with time zone,
	"subject_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	CONSTRAINT "notifications_subject_present" CHECK (("notifications"."type" IN ('follow_up_due_today', 'follow_up_overdue') AND "notifications"."follow_up_id" IS NOT NULL AND "notifications"."trigger_date" IS NOT NULL)
        OR ("notifications"."type" = 'tender_deadline' AND "notifications"."tender_id" IS NOT NULL AND "notifications"."trigger_at" IS NOT NULL)
        OR ("notifications"."type" = 'ownership_changed' AND "notifications"."subject_user_id" IS NOT NULL)),
	CONSTRAINT "notifications_resolution_recorded" CHECK (("notifications"."resolved_at" IS NULL) = ("notifications"."resolution" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"kind" "report_export_kind" NOT NULL,
	"filters" jsonb NOT NULL,
	"status" "report_export_status" DEFAULT 'queued' NOT NULL,
	"row_count" integer,
	"file_name" text,
	"content" text,
	"opportunity_ids" uuid[],
	"failure_reason" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "report_exports_ready_complete" CHECK ("report_exports"."status" <> 'ready' OR ("report_exports"."content" IS NOT NULL AND "report_exports"."row_count" IS NOT NULL AND "report_exports"."opportunity_ids" IS NOT NULL AND "report_exports"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_follow_up_id_follow_ups_id_fk" FOREIGN KEY ("follow_up_id") REFERENCES "public"."follow_ups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_dedupe_unique" ON "background_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "background_jobs_due_idx" ON "background_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_trigger_key_unique" ON "notifications" USING btree ("trigger_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_follow_up_idx" ON "notifications" USING btree ("follow_up_id");--> statement-breakpoint
CREATE INDEX "notifications_tender_idx" ON "notifications" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX "notifications_opportunity_idx" ON "notifications" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "report_exports_requester_idx" ON "report_exports" USING btree ("requested_by","created_at");--> statement-breakpoint
CREATE INDEX "report_exports_expiry_idx" ON "report_exports" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "activities_occurred_at_idx" ON "activities" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "opportunities_award_date_idx" ON "opportunities" USING btree ("award_date");--> statement-breakpoint
CREATE INDEX "opportunities_closed_date_idx" ON "opportunities" USING btree ("closed_date");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'penta_app') THEN
    RAISE NOTICE 'Role penta_app not present; skipping runtime grants.';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON notifications TO penta_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON notifications FROM penta_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON report_exports, background_jobs TO penta_app';
  EXECUTE 'REVOKE TRUNCATE ON report_exports, background_jobs FROM penta_app';
END $$;
