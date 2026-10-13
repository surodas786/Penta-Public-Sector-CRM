-- Change request CR6, migration 0011: Software Procurement as its own
-- procurement cycles (EOI then RFP), replacing the pipeline stages of 0010.
--
-- Penta's step 5 instruction (12 October 2026) supersedes D-CR6-2 and D-CR6-4:
-- procurement milestones stay distinct from the opportunity pipeline, in a
-- separate Software Procurement area, and goods tenders keep their own
-- workflow. So this migration:
--
--   * creates procurement_cycles: one row per procurement cycle, linked to an
--     opportunity (owner, section, access and documents are the
--     opportunity's), at most one current per opportunity, with an explicit
--     route (EOI then RFP, or the documented management-only direct RFP),
--     its milestone, the EOI and RFP fields, separate technical and financial
--     submissions, and CHECKs for every milestone's required fields, the
--     direct-RFP exception (never with an EOI) and late submissions;
--   * creates procurement_cycle_contacts and procurement_cycle_documents,
--     links to the opportunity's contacts and protected documents;
--   * adds the "Software procurement deadlines" export kind;
--   * retires 0010: drops opportunities.workflow, tenders.phase and the EOI
--     outcome columns of tenders, their constraints and types. The eight
--     pipeline stages and the 'closed' notice state cannot be dropped from
--     their enum types; new CHECKs refuse them.
--
-- PRE-FLIGHT. Refuses to run, and changes nothing, if any record still uses
-- what 0010 added: a Software Procurement opportunity, one of its stages, or
-- an EOI/RFP-phase or closed tender. Such records would be synthetic test
-- data (no real data is allowed yet); remove or correct them first. Nothing
-- is converted automatically.
--
-- Rollback (only before any procurement cycle exists):
--   DROP TABLE procurement_cycle_documents, procurement_cycle_contacts, procurement_cycles;
--   DROP TYPE procurement_document_role, participation_decision, proposal_format,
--     procurement_milestone, procurement_route;
--   ALTER TABLE opportunities DROP CONSTRAINT opportunities_stage_live;
--   ALTER TABLE tenders DROP CONSTRAINT tenders_notice_state_live;
--   then re-apply 0010's columns and constraints if they are wanted back.
--   ('procurement_deadlines' stays in report_export_kind, unused.)
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);

-- 1. Pre-flight ---------------------------------------------------------------
DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(format('opportunity %s (%s) is %s at %s', o.reference, o.id, o.workflow, o.stage), '; ')
    INTO problems
    FROM opportunities o
   WHERE o.workflow::text <> 'standard'
      OR o.stage::text IN ('eoi_published', 'eoi_submitted', 'shortlisted', 'rfp_issued', 'proposal_preparation',
                           'proposal_submitted', 'technical_evaluation', 'financial_evaluation');
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0011 pre-flight failed: %. Close or correct these Software Procurement records first.', problems;
  END IF;

  SELECT string_agg(format('tender %s (%s) has phase %s, state %s', t.reference, t.id, coalesce(t.phase::text, 'none'), t.notice_state), '; ')
    INTO problems
    FROM tenders t
   WHERE t.phase IS NOT NULL OR t.eoi_outcome IS NOT NULL OR t.notice_state::text = 'closed';
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0011 pre-flight failed: %. Remove the EOI/RFP phase from these notices first.', problems;
  END IF;
END $$;
--> statement-breakpoint

-- 2. Procurement cycles, and retiring 0010 -------------------------------------
CREATE TYPE "public"."participation_decision" AS ENUM('undecided', 'participating', 'not_participating');--> statement-breakpoint
CREATE TYPE "public"."procurement_document_role" AS ENUM('eoi', 'shortlist', 'rfp', 'proposal', 'decision');--> statement-breakpoint
CREATE TYPE "public"."procurement_milestone" AS ENUM('eoi_preparation', 'eoi_submitted', 'shortlisted', 'not_shortlisted', 'rfp_received', 'proposal_preparation', 'proposal_submitted', 'evaluation', 'awarded', 'unsuccessful', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."procurement_route" AS ENUM('eoi_rfp', 'direct_rfp');--> statement-breakpoint
CREATE TYPE "public"."proposal_format" AS ENUM('single', 'separate');--> statement-breakpoint
ALTER TYPE "public"."report_export_kind" ADD VALUE 'procurement_deadlines' BEFORE 'opportunities';--> statement-breakpoint
CREATE TABLE "procurement_cycle_contacts" (
	"cycle_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_cycle_contacts_cycle_id_contact_id_pk" PRIMARY KEY("cycle_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "procurement_cycle_documents" (
	"cycle_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"role" "procurement_document_role" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_cycle_documents_cycle_id_document_id_pk" PRIMARY KEY("cycle_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "procurement_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"procuring_organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"reference" text NOT NULL,
	"route" "procurement_route" NOT NULL,
	"milestone" "procurement_milestone" NOT NULL,
	"is_current" boolean NOT NULL,
	"submission_method" text,
	"participation" "participation_decision" DEFAULT 'undecided' NOT NULL,
	"participation_reason" text,
	"eoi_publication_date" date,
	"eoi_deadline" timestamp with time zone,
	"eoi_submitted_at" timestamp with time zone,
	"eoi_late_note" text,
	"eoi_outcome" "eoi_outcome",
	"eoi_outcome_date" date,
	"rfp_reference" text,
	"rfp_invitation_date" date,
	"clarification_deadline" timestamp with time zone,
	"proposal_deadline" timestamp with time zone,
	"proposal_format" "proposal_format" DEFAULT 'single' NOT NULL,
	"proposal_submitted_at" timestamp with time zone,
	"technical_submitted_at" timestamp with time zone,
	"financial_submitted_at" timestamp with time zone,
	"proposal_late_note" text,
	"direct_rfp_reason" text,
	"direct_rfp_approved_by" uuid,
	"outcome_date" date,
	"outcome_note" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "procurement_cycles_title_length" CHECK (char_length("procurement_cycles"."title") BETWEEN 3 AND 200),
	CONSTRAINT "procurement_cycles_reference_length" CHECK (char_length("procurement_cycles"."reference") BETWEEN 1 AND 200),
	CONSTRAINT "procurement_cycles_rfp_reference_length" CHECK ("procurement_cycles"."rfp_reference" IS NULL OR char_length("procurement_cycles"."rfp_reference") BETWEEN 1 AND 200),
	CONSTRAINT "procurement_cycles_submission_method_length" CHECK ("procurement_cycles"."submission_method" IS NULL OR char_length("procurement_cycles"."submission_method") BETWEEN 1 AND 100),
	CONSTRAINT "procurement_cycles_direct_rfp_documented" CHECK ("procurement_cycles"."route" <> 'direct_rfp' OR ("procurement_cycles"."direct_rfp_reason" IS NOT NULL AND "procurement_cycles"."direct_rfp_approved_by" IS NOT NULL
        AND "procurement_cycles"."eoi_publication_date" IS NULL AND "procurement_cycles"."eoi_deadline" IS NULL AND "procurement_cycles"."eoi_submitted_at" IS NULL
        AND "procurement_cycles"."eoi_outcome" IS NULL AND "procurement_cycles"."milestone"::text NOT IN ('eoi_preparation', 'eoi_submitted', 'shortlisted', 'not_shortlisted'))),
	CONSTRAINT "procurement_cycles_exception_only_on_direct_rfp" CHECK ("procurement_cycles"."route" = 'direct_rfp' OR ("procurement_cycles"."direct_rfp_reason" IS NULL AND "procurement_cycles"."direct_rfp_approved_by" IS NULL)),
	CONSTRAINT "procurement_cycles_eoi_submitted_when_due" CHECK ("procurement_cycles"."route" = 'direct_rfp' OR "procurement_cycles"."milestone"::text IN ('eoi_preparation', 'cancelled') OR "procurement_cycles"."eoi_submitted_at" IS NOT NULL),
	CONSTRAINT "procurement_cycles_eoi_outcome_dated" CHECK (("procurement_cycles"."eoi_outcome" IS NULL) = ("procurement_cycles"."eoi_outcome_date" IS NULL) AND ("procurement_cycles"."eoi_outcome" IS NULL OR "procurement_cycles"."eoi_submitted_at" IS NOT NULL)),
	CONSTRAINT "procurement_cycles_shortlist_milestones" CHECK (("procurement_cycles"."milestone" <> 'shortlisted' OR "procurement_cycles"."eoi_outcome" = 'shortlisted') AND ("procurement_cycles"."milestone" <> 'not_shortlisted' OR "procurement_cycles"."eoi_outcome" = 'not_shortlisted')),
	CONSTRAINT "procurement_cycles_rfp_after_shortlisting" CHECK ("procurement_cycles"."route" = 'direct_rfp' OR "procurement_cycles"."milestone"::text NOT IN ('rfp_received', 'proposal_preparation', 'proposal_submitted', 'evaluation', 'awarded', 'unsuccessful') OR "procurement_cycles"."eoi_outcome" = 'shortlisted'),
	CONSTRAINT "procurement_cycles_rfp_recorded" CHECK ("procurement_cycles"."milestone"::text NOT IN ('rfp_received', 'proposal_preparation', 'proposal_submitted', 'evaluation', 'awarded', 'unsuccessful') OR ("procurement_cycles"."rfp_reference" IS NOT NULL AND "procurement_cycles"."rfp_invitation_date" IS NOT NULL AND "procurement_cycles"."proposal_deadline" IS NOT NULL)),
	CONSTRAINT "procurement_cycles_proposal_parts" CHECK (("procurement_cycles"."proposal_format" = 'single' AND "procurement_cycles"."technical_submitted_at" IS NULL AND "procurement_cycles"."financial_submitted_at" IS NULL)
        OR ("procurement_cycles"."proposal_format" = 'separate' AND "procurement_cycles"."proposal_submitted_at" IS NULL)),
	CONSTRAINT "procurement_cycles_proposal_submitted_when_due" CHECK ("procurement_cycles"."milestone"::text NOT IN ('proposal_submitted', 'evaluation', 'awarded', 'unsuccessful') OR "procurement_cycles"."proposal_submitted_at" IS NOT NULL
        OR ("procurement_cycles"."technical_submitted_at" IS NOT NULL AND "procurement_cycles"."financial_submitted_at" IS NOT NULL)),
	CONSTRAINT "procurement_cycles_clarification_before_proposal" CHECK ("procurement_cycles"."clarification_deadline" IS NULL OR "procurement_cycles"."proposal_deadline" IS NULL OR "procurement_cycles"."clarification_deadline" <= "procurement_cycles"."proposal_deadline"),
	CONSTRAINT "procurement_cycles_late_eoi_explained" CHECK ("procurement_cycles"."eoi_submitted_at" IS NULL OR "procurement_cycles"."eoi_deadline" IS NULL OR "procurement_cycles"."eoi_submitted_at" <= "procurement_cycles"."eoi_deadline" OR "procurement_cycles"."eoi_late_note" IS NOT NULL),
	CONSTRAINT "procurement_cycles_late_proposal_explained" CHECK ("procurement_cycles"."proposal_deadline" IS NULL OR "procurement_cycles"."proposal_late_note" IS NOT NULL OR (
        COALESCE("procurement_cycles"."proposal_submitted_at", '-infinity') <= "procurement_cycles"."proposal_deadline"
        AND COALESCE("procurement_cycles"."technical_submitted_at", '-infinity') <= "procurement_cycles"."proposal_deadline"
        AND COALESCE("procurement_cycles"."financial_submitted_at", '-infinity') <= "procurement_cycles"."proposal_deadline")),
	CONSTRAINT "procurement_cycles_not_participating_reason" CHECK ("procurement_cycles"."participation" <> 'not_participating' OR "procurement_cycles"."participation_reason" IS NOT NULL),
	CONSTRAINT "procurement_cycles_ending_dated" CHECK ("procurement_cycles"."milestone"::text NOT IN ('not_shortlisted', 'awarded', 'unsuccessful', 'cancelled') OR "procurement_cycles"."outcome_date" IS NOT NULL),
	CONSTRAINT "procurement_cycles_cancellation_explained" CHECK ("procurement_cycles"."milestone" <> 'cancelled' OR "procurement_cycles"."outcome_note" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_stage_in_workflow";--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_not_shortlisted_software_only";--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_eoi_outcome_on_eoi";--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_eoi_outcome_dated";--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_closed_has_outcome";--> statement-breakpoint
DROP INDEX "opportunities_workflow_idx";--> statement-breakpoint
ALTER TABLE "procurement_cycle_contacts" ADD CONSTRAINT "procurement_cycle_contacts_cycle_id_procurement_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."procurement_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycle_contacts" ADD CONSTRAINT "procurement_cycle_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycle_contacts" ADD CONSTRAINT "procurement_cycle_contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycle_documents" ADD CONSTRAINT "procurement_cycle_documents_cycle_id_procurement_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."procurement_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycle_documents" ADD CONSTRAINT "procurement_cycle_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycle_documents" ADD CONSTRAINT "procurement_cycle_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycles" ADD CONSTRAINT "procurement_cycles_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycles" ADD CONSTRAINT "procurement_cycles_procuring_organization_id_organizations_id_fk" FOREIGN KEY ("procuring_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycles" ADD CONSTRAINT "procurement_cycles_direct_rfp_approved_by_users_id_fk" FOREIGN KEY ("direct_rfp_approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cycles" ADD CONSTRAINT "procurement_cycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procurement_cycle_contacts_contact_idx" ON "procurement_cycle_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "procurement_cycle_documents_document_idx" ON "procurement_cycle_documents" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_cycles_one_current_per_opportunity" ON "procurement_cycles" USING btree ("opportunity_id") WHERE "procurement_cycles"."is_current";--> statement-breakpoint
CREATE INDEX "procurement_cycles_opportunity_idx" ON "procurement_cycles" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "procurement_cycles_milestone_idx" ON "procurement_cycles" USING btree ("milestone");--> statement-breakpoint
CREATE INDEX "procurement_cycles_eoi_deadline_idx" ON "procurement_cycles" USING btree ("eoi_deadline");--> statement-breakpoint
CREATE INDEX "procurement_cycles_proposal_deadline_idx" ON "procurement_cycles" USING btree ("proposal_deadline");--> statement-breakpoint
CREATE INDEX "procurement_cycles_procuring_organization_idx" ON "procurement_cycles" USING btree ("procuring_organization_id");--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "workflow";--> statement-breakpoint
ALTER TABLE "tenders" DROP COLUMN "phase";--> statement-breakpoint
ALTER TABLE "tenders" DROP COLUMN "eoi_outcome";--> statement-breakpoint
ALTER TABLE "tenders" DROP COLUMN "eoi_outcome_date";--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_live" CHECK ("opportunities"."stage"::text IN ('identified', 'initial_engagement', 'requirements_discussion', 'awaiting_tender', 'tender_published', 'bid_preparation', 'bid_submitted', 'evaluation', 'awarded', 'lost'));--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_notice_state_live" CHECK ("tenders"."notice_state"::text <> 'closed');
--> statement-breakpoint
DROP TYPE "public"."opportunity_workflow";--> statement-breakpoint
DROP TYPE "public"."tender_phase";--> statement-breakpoint
-- 3. Runtime grants -------------------------------------------------------------
-- Cycles change by update and are never deleted (cancelled cycles stay as
-- history). Contact and document links can be removed; the audit keeps who
-- linked and unlinked what.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'penta_app') THEN
    RAISE NOTICE 'Role penta_app not present; skipping runtime grants.';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON procurement_cycles TO penta_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON procurement_cycles FROM penta_app';
  EXECUTE 'GRANT SELECT, INSERT, DELETE ON procurement_cycle_contacts, procurement_cycle_documents TO penta_app';
  EXECUTE 'REVOKE UPDATE, TRUNCATE ON procurement_cycle_contacts, procurement_cycle_documents FROM penta_app';
END $$;
