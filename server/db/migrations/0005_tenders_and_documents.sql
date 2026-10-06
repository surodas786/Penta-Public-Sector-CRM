-- Milestone 5, migration 0005: tenders, documents, revisions and staged uploads.
--
-- Additive: four tables and four enums. At most one current tender per
-- opportunity is a partial unique index (FR-050, BR-080); bid chronology,
-- submission time, participation reason and late-submission explanation are
-- CHECK constraints (BR-040, FR-051). Documents are a series of revisions
-- (FR-061); a file is downloadable only when its scan verdict is clean
-- (SEC-010), which the service enforces and the verdict CHECK records.
--
-- The runtime role cannot DELETE tenders, documents or revisions: earlier
-- notices, bid history and file revisions are retained, and removal is a
-- management archive. It may DELETE staged uploads, which are never visible
-- and are removed by the abandoned-upload cleanup.
--
-- Rollback:
--   DROP TABLE document_revisions; DROP TABLE document_uploads;
--   DROP TABLE documents; DROP TABLE tenders;
--   DROP TYPE scan_state; DROP TYPE notice_state; DROP TYPE document_category;
--   DROP TYPE bid_status;
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
--   Then remove the stored files under DOCUMENT_STORAGE_DIR.

CREATE TYPE "public"."bid_status" AS ENUM('reviewing', 'preparing', 'submitted', 'not_participating');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('tender_document', 'requirements', 'meeting_notes', 'proposal', 'correspondence', 'other');--> statement-breakpoint
CREATE TYPE "public"."notice_state" AS ENUM('current', 'superseded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."scan_state" AS ENUM('pending', 'clean', 'infected', 'failed');--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"upload_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"note" text,
	"scan_state" "scan_state" DEFAULT 'pending' NOT NULL,
	"scanner" text,
	"scan_detail" text,
	"scanned_at" timestamp with time zone,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_revisions_number_positive" CHECK ("document_revisions"."revision_number" >= 1),
	CONSTRAINT "document_revisions_verdict_recorded" CHECK ("document_revisions"."scan_state" = 'pending' OR ("document_revisions"."scanned_at" IS NOT NULL AND "document_revisions"."scanner" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "document_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "document_uploads_size_positive" CHECK ("document_uploads"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"category" "document_category" NOT NULL,
	"latest_revision" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "documents_archive_consistent" CHECK (("documents"."archived_at" IS NULL) = ("documents"."archived_by" IS NULL) AND ("documents"."archived_at" IS NULL) = ("documents"."archive_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"procuring_organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"reference" text NOT NULL,
	"procurement_method" text,
	"notice_url" text,
	"publication_date" date NOT NULL,
	"clarification_deadline" timestamp with time zone,
	"submission_deadline" timestamp with time zone NOT NULL,
	"bid_status" "bid_status" NOT NULL,
	"submitted_at" timestamp with time zone,
	"participation_reason" text,
	"late_submission_note" text,
	"is_current" boolean NOT NULL,
	"notice_state" "notice_state" NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tenders_title_length" CHECK (char_length("tenders"."title") BETWEEN 3 AND 200),
	CONSTRAINT "tenders_reference_length" CHECK (char_length("tenders"."reference") BETWEEN 1 AND 200),
	CONSTRAINT "tenders_notice_url_http" CHECK ("tenders"."notice_url" IS NULL OR "tenders"."notice_url" ~* '^https?://'),
	CONSTRAINT "tenders_current_is_current_notice" CHECK ("tenders"."is_current" = ("tenders"."notice_state" = 'current')),
	CONSTRAINT "tenders_submitted_has_time" CHECK (("tenders"."bid_status" = 'submitted') = ("tenders"."submitted_at" IS NOT NULL)),
	CONSTRAINT "tenders_not_participating_reason" CHECK ("tenders"."bid_status" <> 'not_participating' OR "tenders"."participation_reason" IS NOT NULL),
	CONSTRAINT "tenders_deadline_not_before_publication" CHECK (("tenders"."submission_deadline" AT TIME ZONE 'Asia/Dhaka')::date >= "tenders"."publication_date"),
	CONSTRAINT "tenders_clarification_not_after_submission" CHECK ("tenders"."clarification_deadline" IS NULL OR "tenders"."clarification_deadline" <= "tenders"."submission_deadline"),
	CONSTRAINT "tenders_late_submission_explained" CHECK ("tenders"."submitted_at" IS NULL OR "tenders"."submitted_at" <= "tenders"."submission_deadline" OR "tenders"."late_submission_note" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_upload_id_document_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."document_uploads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_uploads" ADD CONSTRAINT "document_uploads_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_uploads" ADD CONSTRAINT "document_uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_procuring_organization_id_organizations_id_fk" FOREIGN KEY ("procuring_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_revisions_number_unique" ON "document_revisions" USING btree ("document_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_revisions_upload_unique" ON "document_revisions" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_revisions_storage_key_unique" ON "document_revisions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "document_revisions_scan_state_idx" ON "document_revisions" USING btree ("scan_state");--> statement-breakpoint
CREATE UNIQUE INDEX "document_uploads_storage_key_unique" ON "document_uploads" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "document_uploads_expiry_idx" ON "document_uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "documents_opportunity_idx" ON "documents" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenders_one_current_per_opportunity" ON "tenders" USING btree ("opportunity_id") WHERE "tenders"."is_current";--> statement-breakpoint
CREATE INDEX "tenders_opportunity_idx" ON "tenders" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "tenders_submission_deadline_idx" ON "tenders" USING btree ("submission_deadline");--> statement-breakpoint
CREATE INDEX "tenders_procuring_organization_idx" ON "tenders" USING btree ("procuring_organization_id");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'penta_app') THEN
    RAISE NOTICE 'Role penta_app not present; skipping runtime grants.';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON tenders, documents, document_revisions TO penta_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON tenders, documents, document_revisions FROM penta_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON document_uploads TO penta_app';
  EXECUTE 'REVOKE TRUNCATE ON document_uploads FROM penta_app';
END $$;
