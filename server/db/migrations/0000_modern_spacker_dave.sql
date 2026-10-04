CREATE TYPE "public"."follow_up_state" AS ENUM('open', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."idempotency_state" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."opportunity_stage" AS ENUM('identified', 'initial_engagement', 'requirements_discussion', 'awaiting_tender', 'tender_published', 'bid_preparation', 'bid_submitted', 'evaluation', 'awarded', 'lost');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('active', 'on_hold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('ministry', 'department', 'directorate', 'authority', 'public_corporation', 'local_government', 'other');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."solution_category" AS ENUM('erp', 'custom_software', 'data_platform_analytics', 'cloud_infrastructure', 'cybersecurity', 'system_integration', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('management', 'lead', 'sales', 'admin');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"opportunity_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"domain" text DEFAULT 'commercial' NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assigned_user_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"state" "follow_up_state" DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"completion_note" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"state" "idempotency_state" DEFAULT 'in_progress' NOT NULL,
	"result_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"name" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"department" text,
	"solution_category" "solution_category" NOT NULL,
	"description" text,
	"estimated_value" numeric(14, 2) NOT NULL,
	"funding_source" text,
	"owner_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"stage" "opportunity_stage" NOT NULL,
	"status" "opportunity_status" DEFAULT 'active' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"expected_publication_date" date,
	"expected_award_date" date,
	"awarded_value" numeric(14, 2),
	"award_date" date,
	"loss_reason" text,
	"loss_note" text,
	"closed_date" date,
	"status_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "opportunities_estimated_value_nonnegative" CHECK ("opportunities"."estimated_value" >= 0),
	CONSTRAINT "opportunities_awarded_value_nonnegative" CHECK ("opportunities"."awarded_value" IS NULL OR "opportunities"."awarded_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "organization_type" NOT NULL,
	"parent_id" uuid,
	"location" text,
	"website" text,
	"basic_notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organizations_no_self_parent" CHECK ("organizations"."parent_id" IS NULL OR "organizations"."parent_id" <> "organizations"."id")
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"lead_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"section_id" uuid,
	"manager_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_organizations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_opportunity_time_idx" ON "audit_events" USING btree ("opportunity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_time_idx" ON "audit_events" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_domain_idx" ON "audit_events" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "follow_ups_opportunity_idx" ON "follow_ups" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "follow_ups_assignee_idx" ON "follow_ups" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "follow_ups_state_due_idx" ON "follow_ups" USING btree ("state","due_date");--> statement-breakpoint
CREATE INDEX "follow_ups_next_action_idx" ON "follow_ups" USING btree ("opportunity_id","due_date","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_actor_operation_key_unique" ON "idempotency_records" USING btree ("actor_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_reference_unique" ON "opportunities" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "opportunities_section_idx" ON "opportunities" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "opportunities_owner_idx" ON "opportunities" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "opportunities_stage_status_idx" ON "opportunities" USING btree ("stage","status");--> statement-breakpoint
CREATE INDEX "opportunities_organization_idx" ON "opportunities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "opportunities_expected_award_idx" ON "opportunities" USING btree ("expected_award_date");--> statement-breakpoint
CREATE INDEX "opportunities_created_at_idx" ON "opportunities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "organizations_name_idx" ON "organizations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "organizations_parent_idx" ON "organizations" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_name_unique" ON "sections" USING btree ("name");--> statement-breakpoint
CREATE INDEX "session_expire_idx" ON "session" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_section_idx" ON "users" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "users_manager_idx" ON "users" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "users_role_active_idx" ON "users" USING btree ("role","active");